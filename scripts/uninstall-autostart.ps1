# Removes the NITI TARA logon Scheduled Task created by install-autostart.ps1.
#
# Usage (from an ELEVATED PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\uninstall-autostart.ps1
#
#Requires -RunAsAdministrator
param([string]$TaskName = "NITI TARA Kiosk")

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed scheduled task '$TaskName' (if it existed)." -ForegroundColor Green
