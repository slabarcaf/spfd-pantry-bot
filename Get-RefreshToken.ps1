# =============================================================================
# Get-RefreshToken.ps1 — ONE-TIME: mint a Berkeley refresh token with the
# gmail.readonly scope, using the loopback (localhost) OAuth flow.
#
# Run it, sign in as santiago.labarca@berkeley.edu in the browser that opens,
# approve, then copy the printed refresh token into config.local.ps1.
#
# Reuses the SAME Google OAuth client as the Melissa project. Provide the
# client id/secret either via config.local.ps1 or when prompted.
# =============================================================================
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = $PSScriptRoot
$localCfg = Join-Path $root "config.local.ps1"
if (Test-Path $localCfg) { . $localCfg }

if ([string]::IsNullOrWhiteSpace($GoogleClientId))     { $GoogleClientId     = Read-Host "Google Client ID" }
if ([string]::IsNullOrWhiteSpace($GoogleClientSecret)) { $GoogleClientSecret = Read-Host "Google Client Secret" }

$scope = "https://www.googleapis.com/auth/gmail.readonly"
$port  = 53682
$redirect = "http://localhost:$port/"

$authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" +
    "client_id=$([Uri]::EscapeDataString($GoogleClientId))" +
    "&redirect_uri=$([Uri]::EscapeDataString($redirect))" +
    "&response_type=code" +
    "&scope=$([Uri]::EscapeDataString($scope))" +
    "&access_type=offline&prompt=consent"

Write-Host "Opening browser for Google consent..." -ForegroundColor Cyan
Write-Host "If it doesn't open, paste this URL manually:`n$authUrl`n"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($redirect)
$listener.Start()
Start-Process $authUrl

$context = $listener.GetContext()   # blocks until Google redirects back
$code = $context.Request.QueryString["code"]
$respHtml = "<html><body style='font-family:sans-serif'><h2>Done. You can close this tab and return to the terminal.</h2></body></html>"
$buf = [Text.Encoding]::UTF8.GetBytes($respHtml)
$context.Response.OutputStream.Write($buf, 0, $buf.Length)
$context.Response.OutputStream.Close()
$listener.Stop()

if (-not $code) { throw "No authorization code received." }

$tok = Invoke-RestMethod -Method Post -Uri "https://oauth2.googleapis.com/token" `
    -ContentType "application/x-www-form-urlencoded" -Body @{
        code          = $code
        client_id     = $GoogleClientId
        client_secret = $GoogleClientSecret
        redirect_uri  = $redirect
        grant_type    = "authorization_code"
    }

if (-not $tok.refresh_token) {
    throw "No refresh_token returned. Revoke prior access at https://myaccount.google.com/permissions and retry (prompt=consent should force it)."
}

Write-Host "`n================ REFRESH TOKEN ================" -ForegroundColor Green
Write-Host $tok.refresh_token
Write-Host "===============================================" -ForegroundColor Green
Write-Host "Paste this into config.local.ps1 as `$GoogleRefreshToken." -ForegroundColor Yellow
