# =============================================================================
# Spfd-Lib.ps1 — Shared functions for the SPFD pantry auto-registration bot.
# Dot-sourced by Register-Spfd.ps1. Pure PowerShell 5.1+, no external modules.
# =============================================================================

$ErrorActionPreference = "Stop"
# Force TLS 1.2 (older Windows PowerShell defaults can break HTTPS to Google).
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------------------------------------------------------------------------
# Logging — writes to console + a rolling spfd.log next to the scripts.
# ---------------------------------------------------------------------------
function Write-SpfdLog {
    param([string]$Message, [string]$Level = "INFO")
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Write-Host $line
    $logPath = Join-Path $PSScriptRoot "spfd.log"
    Add-Content -Path $logPath -Value $line -Encoding UTF8
}

# ---------------------------------------------------------------------------
# Base64url decode (Gmail returns message bodies in base64url).
# ---------------------------------------------------------------------------
function ConvertFrom-Base64Url {
    param([string]$Data)
    if ([string]::IsNullOrEmpty($Data)) { return "" }
    $s = $Data.Replace('-', '+').Replace('_', '/')
    switch ($s.Length % 4) { 2 { $s += '==' }; 3 { $s += '=' } }
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s))
}

# ---------------------------------------------------------------------------
# Exchange the Berkeley refresh token for a short-lived access token.
# (Same OAuth pattern as melissa-bot/sheets-mcp.js.)
# ---------------------------------------------------------------------------
function Get-SpfdAccessToken {
    param($ClientId, $ClientSecret, $RefreshToken)
    $resp = Invoke-RestMethod -Method Post -Uri "https://oauth2.googleapis.com/token" `
        -ContentType "application/x-www-form-urlencoded" -Body @{
            client_id     = $ClientId
            client_secret = $ClientSecret
            refresh_token = $RefreshToken
            grant_type    = "refresh_token"
        }
    if (-not $resp.access_token) { throw "OAuth: no access_token returned" }
    return $resp.access_token
}

# ---------------------------------------------------------------------------
# Find the newest SPFD waitlist email and pull the form link out of its body.
# Returns the resolved viewform-ready URL (a forms.gle/... or docs.google.com
# /forms/... link), or $null if no matching email was found.
# ---------------------------------------------------------------------------
function Find-SpfdFormUrl {
    param($AccessToken, $Query)
    $headers = @{ Authorization = "Bearer $AccessToken" }
    $q = [Uri]::EscapeDataString($Query)
    $list = Invoke-RestMethod -Headers $headers `
        -Uri "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=$q&maxResults=5"
    if (-not $list.messages -or $list.messages.Count -eq 0) { return $null }

    # messages come back newest-first
    $msgId = $list.messages[0].id
    $msg = Invoke-RestMethod -Headers $headers `
        -Uri "https://gmail.googleapis.com/gmail/v1/users/me/messages/$msgId`?format=full"

    # Recursively gather all leaf body data and decode it.
    $text = New-Object System.Text.StringBuilder
    function Walk-Parts($part) {
        if ($part.body -and $part.body.data) {
            [void]$script:__sb.Append((ConvertFrom-Base64Url $part.body.data))
        }
        if ($part.parts) { foreach ($p in $part.parts) { Walk-Parts $p } }
    }
    $script:__sb = $text
    Walk-Parts $msg.payload
    $body = $text.ToString()

    # Prefer the short forms.gle link; fall back to a full docs.google.com form link.
    if ($body -match 'https://forms\.gle/[A-Za-z0-9]+') { return $Matches[0] }
    if ($body -match 'https://docs\.google\.com/forms/d/e/[A-Za-z0-9_-]+/viewform') { return $Matches[0] }
    return $null
}

# ---------------------------------------------------------------------------
# Fetch + parse a Google Form. Resolves forms.gle -> viewform, reads the
# FB_PUBLIC_LOAD_DATA_ blob, maps each question to its entry id by keyword, and
# picks the right day-radio option. Returns a hashtable describing the form.
# ---------------------------------------------------------------------------
function Get-SpfdFormDefinition {
    param($FormUrl, $DayPreference)

    $resp = Invoke-WebRequest -Uri $FormUrl -UseBasicParsing -MaximumRedirection 5
    $html = $resp.Content

    # The POST endpoint is embedded directly in the HTML (robust across PS 5.1 / 7).
    if ($html -notmatch '(https://docs\.google\.com/forms/d/e/[A-Za-z0-9_-]+/formResponse)') {
        throw "Could not locate the formResponse action URL in form HTML."
    }
    $responseUrl = $Matches[1]

    if ($html -notmatch 'var FB_PUBLIC_LOAD_DATA_ = ([\s\S]*?);</script>') {
        throw "Could not locate FB_PUBLIC_LOAD_DATA_ in form HTML ($responseUrl)"
    }
    $data = $Matches[1] | ConvertFrom-Json
    $questions = $data[1][1]

    $fbzx = $null
    if ($html -match 'name="fbzx" value="([^"]+)"') { $fbzx = $Matches[1] }

    $map = @{}            # logical field -> entry id
    $dayEntry = $null
    $dayValue = $null

    foreach ($q in $questions) {
        $title  = "$($q[1])"
        $fields = $q[4]
        if (-not $fields) { continue }
        $lower = $title.ToLower()

        foreach ($f in $fields) {
            $entryId = $f[0]
            $opts    = $f[1]

            if     ($lower -match 'berkeley email')                 { $map.berkeleyEmail = $entryId }
            elseif ($lower -match 'last name')                      { $map.lastName      = $entryId }
            elseif ($lower -match 'first name')                     { $map.firstName     = $entryId }
            elseif ($lower -match 'family' -or $lower -match 'how many people') { $map.familySize = $entryId }
            elseif ($opts) {
                # The day radio is the only question with options here.
                $dayEntry = $entryId
                foreach ($o in $opts) {
                    $label = "$($o[0])"
                    if ($DayPreference -eq "Both") {
                        if ($label -eq "Both") { $dayValue = $label }
                    } elseif ($label -like "$DayPreference*") {
                        $dayValue = $label
                    }
                }
            }
        }
    }

    if ($dayEntry) { $map.day = $dayEntry }

    return @{
        ResponseUrl = $responseUrl
        Fbzx        = $fbzx
        Map         = $map
        DayValue    = $dayValue
    }
}

# ---------------------------------------------------------------------------
# Build the POST body for a parsed form + the configured answers.
# ---------------------------------------------------------------------------
function Build-SpfdBody {
    param($Def, $BerkeleyEmail, $FirstName, $LastName, $FamilySize)
    $m = $Def.Map
    $body = @{
        "emailAddress"          = $BerkeleyEmail   # auto-collect email field
        "emailReceipt"          = "true"           # keep getting the confirmation email
        "entry.$($m.berkeleyEmail)" = $BerkeleyEmail
        "entry.$($m.lastName)"      = $LastName
        "entry.$($m.firstName)"     = $FirstName
        "entry.$($m.familySize)"    = $FamilySize
        "entry.$($m.day)"           = $Def.DayValue
        "fvv"                   = "1"
        "pageHistory"           = "0"
    }
    if ($Def.Fbzx) { $body["fbzx"] = $Def.Fbzx }
    return $body
}

# ---------------------------------------------------------------------------
# Submit the form. Returns $true on a recorded response.
# ---------------------------------------------------------------------------
function Submit-SpfdForm {
    param($ResponseUrl, $Body)
    $resp = Invoke-WebRequest -Uri $ResponseUrl -Method Post -Body $Body `
        -ContentType "application/x-www-form-urlencoded" -UseBasicParsing -MaximumRedirection 5
    $ok = ($resp.StatusCode -eq 200) -and ($resp.Content -match 'Your response has been recorded' -or $resp.Content -match 'freebirdFormviewerViewResponseConfirmation')
    return $ok
}

# ---------------------------------------------------------------------------
# Optional Telegram failure alert (reuses Melissa bot creds if configured).
# ---------------------------------------------------------------------------
function Send-SpfdTelegram {
    param($Token, $ChatId, $Text)
    if ([string]::IsNullOrWhiteSpace($Token) -or [string]::IsNullOrWhiteSpace($ChatId)) { return }
    try {
        Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$Token/sendMessage" `
            -Body @{ chat_id = $ChatId; text = $Text } | Out-Null
    } catch { Write-SpfdLog "Telegram alert failed: $($_.Exception.Message)" "WARN" }
}
