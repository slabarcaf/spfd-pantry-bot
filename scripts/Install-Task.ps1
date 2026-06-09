# Register the weekly Windows scheduled task (run from the repo root or anywhere).
# Triggers: Tuesday 9:00 AM (primary) + Thursday 9:00 AM (safety net). Idempotency
# prevents a double-submit; both fire before the Friday 4pm form deadline.
# Runs as the current standard user (no admin needed; the Casa PC stays logged in).
$ErrorActionPreference = "Stop"

$root   = Split-Path $PSScriptRoot -Parent
$cfg    = Get-Content (Join-Path $root "config.json") -Raw | ConvertFrom-Json
$node   = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $root "src\index.js"

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $root

$triggers = @(
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Tuesday  -At 9:00AM),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Thursday -At 9:00AM)
)

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $cfg.taskName -Action $action -Trigger $triggers `
    -Settings $settings -Description "Auto-registers Santiago for the weekly SPFD pantry waitlist." -Force | Out-Null

Write-Host "Registered '$($cfg.taskName)'. Triggers: Tue 9:00 AM + Thu 9:00 AM." -ForegroundColor Green
Get-ScheduledTask -TaskName $cfg.taskName | Get-ScheduledTaskInfo | Format-List TaskName, NextRunTime
