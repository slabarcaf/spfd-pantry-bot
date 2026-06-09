# =============================================================================
# Register-Spfd.ps1 — Entry point. Run weekly by Task Scheduler.
#
#   .\Register-Spfd.ps1            # find email, parse form, SUBMIT
#   .\Register-Spfd.ps1 -DryRun    # do everything EXCEPT submit; print the plan
# =============================================================================
param([switch]$DryRun)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

. (Join-Path $root "config.ps1")
. (Join-Path $root "Spfd-Lib.ps1")

$localCfg = Join-Path $root "config.local.ps1"
if (-not (Test-Path $localCfg)) {
    Write-SpfdLog "Missing config.local.ps1 — copy config.local.ps1.example and fill it in." "ERROR"
    exit 1
}
. $localCfg

try {
    # --- 1. Hard stop after StopDate: stop submitting + remove the scheduled task ---
    if ((Get-Date).Date -ge ([datetime]$StopDate).Date) {
        Write-SpfdLog "Stop date ($StopDate) reached. Disabling bot." "INFO"
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-SpfdLog "Scheduled task '$TaskName' removed. Goodbye." "INFO"
        exit 0
    }

    # --- 2. Load idempotency state (URLs already submitted) ---
    $statePath = Join-Path $root "state.json"
    $submitted = @()
    if (Test-Path $statePath) {
        $submitted = @((Get-Content $statePath -Raw | ConvertFrom-Json).submitted)
    }

    # --- 3. Auth + find this week's form ---
    $token = Get-SpfdAccessToken -ClientId $GoogleClientId -ClientSecret $GoogleClientSecret -RefreshToken $GoogleRefreshToken
    $formUrl = Find-SpfdFormUrl -AccessToken $token -Query $GmailQuery
    if (-not $formUrl) {
        Write-SpfdLog "No SPFD waitlist email found in the last 5 days. Nothing to do." "INFO"
        exit 0
    }
    Write-SpfdLog "Found form link: $formUrl"

    if ($submitted -contains $formUrl) {
        Write-SpfdLog "Already submitted this week's form ($formUrl). Skipping." "INFO"
        exit 0
    }

    # --- 4. Parse the form ---
    $def = Get-SpfdFormDefinition -FormUrl $formUrl -DayPreference $DayPreference

    # Sanity check: every required field must have been mapped.
    $missing = @()
    foreach ($k in 'berkeleyEmail','lastName','firstName','familySize','day') {
        if (-not $def.Map.$k) { $missing += $k }
    }
    if (-not $def.DayValue) { $missing += "day-option('$DayPreference')" }
    if ($missing.Count -gt 0) {
        throw "Could not map required fields: $($missing -join ', '). Form layout may have changed."
    }

    $body = Build-SpfdBody -Def $def -BerkeleyEmail $BerkeleyEmail -FirstName $FirstName -LastName $LastName -FamilySize $FamilySize

    # --- 5. Submit (or dry-run print) ---
    if ($DryRun) {
        Write-SpfdLog "DRY RUN — would POST to: $($def.ResponseUrl)" "INFO"
        Write-SpfdLog "DRY RUN — day option selected: '$($def.DayValue)'" "INFO"
        $body.GetEnumerator() | Sort-Object Name | ForEach-Object {
            Write-Host ("    {0} = {1}" -f $_.Name, $_.Value)
        }
        Write-SpfdLog "DRY RUN complete. No data submitted." "INFO"
        exit 0
    }

    $ok = Submit-SpfdForm -ResponseUrl $def.ResponseUrl -Body $body
    if ($ok) {
        Write-SpfdLog "SUBMITTED successfully for '$($def.DayValue)'." "INFO"
        $submitted += $formUrl
        @{ submitted = $submitted } | ConvertTo-Json | Set-Content -Path $statePath -Encoding UTF8
    } else {
        throw "Form POST did not return a recorded-response confirmation."
    }
}
catch {
    $err = $_.Exception.Message
    Write-SpfdLog "FAILED: $err" "ERROR"
    Send-SpfdTelegram -Token $TelegramToken -ChatId $TelegramChatId -Text "SPFD pantry bot FAILED: $err"
    exit 1
}
