# Registers NITI TARA to auto-start at logon via a Scheduled Task.
#
# Why: a logon-triggered Scheduled Task fires right at logon and is NOT subject
# to the Windows Run-key "startup app" delay/throttle (which queued the kiosk
# behind ~19 other startup apps and delayed it 30-40s). This script also removes
# the old, slow Run-key autostart entries.
#
# Usage (from an ELEVATED PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#
#Requires -RunAsAdministrator
param(
  [string]$ExePath  = "C:\Program Files\NITI TARA\NITI TARA.exe",
  [string]$TaskName = "NITI TARA Kiosk"
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ExePath)) {
  throw "NITI TARA.exe not found at '$ExePath'. Install the app first, or pass -ExePath."
}

# 1) Remove the Run-key autostart entries (current user). Harmless if absent.
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
foreach ($name in @('electron.app.Electron', 'electron.app.NITI TARA')) {
  Remove-ItemProperty -Path $runKey -Name $name -ErrorAction SilentlyContinue
}

# 2) Create / replace the logon Scheduled Task (no startup delay).
$user      = "$env:USERDOMAIN\$env:USERNAME"
$action    = New-ScheduledTaskAction -Execute $ExePath -WorkingDirectory (Split-Path $ExePath)
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
               -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Registered logon task '$TaskName' -> $ExePath" -ForegroundColor Green
Write-Host "Removed Run-key autostart entries. Log off and back on to verify the faster launch." -ForegroundColor Green
