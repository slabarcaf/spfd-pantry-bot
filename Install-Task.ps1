# =============================================================================
# Install-Task.ps1 — Register the weekly Windows scheduled task that runs the
# bot. Two triggers: Tuesday 9:00 AM (primary) + Thursday 9:00 AM (safety net,
# in case Tuesday's run found no email yet). Idempotency prevents double-submit;
# both fire well before the Friday 4pm form deadline.
#
# Runs as the current (standard) user — no admin needed, since the Casa PC
# auto-logs-in and stays on 24/7.
# =============================================================================
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
. (Join-Path $root "config.ps1")   # for $TaskName

$script = Join-Path $root "Register-Spfd.ps1"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" `
    -WorkingDirectory $root

$triggers = @(
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Tuesday  -At 9:00AM),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Thursday -At 9:00AM)
)

# Start if a scheduled run was missed (e.g. PC was off), and allow it to run
# regardless of mains/battery state.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
    -Settings $settings -Description "Auto-registers Santiago for the weekly SPFD pantry waitlist form." -Force

Write-Host "Registered scheduled task '$TaskName':" -ForegroundColor Green
Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo | Format-List TaskName, NextRunTime, LastRunTime
Write-Host "Triggers: Tuesday 9:00 AM + Thursday 9:00 AM (safety)." -ForegroundColor Green
