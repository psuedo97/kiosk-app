; Custom NSIS hooks for the NITI TARA installer.
; electron-builder auto-includes this file (build/installer.nsh) and inserts
; these macros into the generated installer/uninstaller. They manage the logon
; Scheduled Task used for auto-start and set the desktop wallpaper, so
; install/uninstall is self-contained and never leaves orphaned state behind.

!macro customInstall
  ; Register the logon Scheduled Task (bypasses the slow Run-key startup throttle).
  ; The bundled PowerShell script also clears any stale Run-key autostart entries.
  ; The perMachine installer runs elevated, so the script's admin requirement is met.
  nsExec::Exec 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\app\scripts\install-autostart.ps1" -ExePath "$INSTDIR\NITI TARA.exe"'

  ; Set the desktop wallpaper to the bundled image (for the current/installing user).
  ; WallpaperStyle: 10=Fill (default), 6=Fit, 2=Stretch, 22=Span, 0=Center, 1=Tile(+TileWallpaper=1).
  ;WriteRegStr HKCU "Control Panel\Desktop" "Wallpaper" "$INSTDIR\resources\app\images\wallpaper.png"
  ;WriteRegStr HKCU "Control Panel\Desktop" "WallpaperStyle" "10"
  ;WriteRegStr HKCU "Control Panel\Desktop" "TileWallpaper" "0"
  ; Apply it live: SystemParametersInfo(SPI_SETDESKWALLPAPER=20, 0, path, SPIF_UPDATEINIFILE|SPIF_SENDWININICHANGE=3)
  ;System::Call 'user32::SystemParametersInfoW(i 20, i 0, w "$INSTDIR\resources\app\images\wallpaper.png", i 3)'

  ; ---- Install the Roboto font system-wide ----------------------------------
  ; Copy the two variable-font files into Windows' Fonts directory and register
  ; them in HKLM so any app on the machine can use "Roboto". The perMachine
  ; installer is elevated, so writing to $FONTS and HKLM is allowed.
  ; The bundled filenames contain a comma (`wdth,wght`); we rename to a clean
  ; filename on copy to keep the registry entry and font-list display tidy.
  SetOutPath "$FONTS"
  CopyFiles /SILENT "$INSTDIR\resources\app\assets\Roboto\Roboto-VariableFont_wdth,wght.ttf" "$FONTS\Roboto-VariableFont.ttf"
  CopyFiles /SILENT "$INSTDIR\resources\app\assets\Roboto\static\Roboto-Black.ttf" "$FONTS\Roboto-Black.ttf"
  WriteRegStr HKLM "Software\Microsoft\Windows NT\CurrentVersion\Fonts" "Roboto (TrueType)" "Roboto-VariableFont.ttf"
  WriteRegStr HKLM "Software\Microsoft\Windows NT\CurrentVersion\Fonts" "Roboto Black (TrueType)" "Roboto-Black.ttf"
  ; Broadcast WM_FONTCHANGE (0x001D) so running apps refresh their font cache
  ; without needing a reboot. We MUST use SendMessageTimeout, not SendMessage —
  ; the latter waits indefinitely for every top-level window in the system,
  ; which hangs the installer at the end if any tray app / service is slow to
  ; pump its message queue. SMTO_ABORTIFHUNG (0x0002) skips unresponsive
  ; windows; the 1500ms per-window timeout is more than enough for healthy apps.
  System::Call "user32::SendMessageTimeoutW(p 0xffff, i 0x001d, p 0, p 0, i 0x0002, i 1500, *p .r0)"
!macroend

!macro customUnInstall
  ; Remove the logon Scheduled Task so nothing is left pointing at the deleted exe.
  nsExec::Exec 'schtasks /Delete /TN "NITI TARA Kiosk" /F'
  ; Clear the wallpaper registry value so it doesn't point at the removed file.
  ;DeleteRegValue HKCU "Control Panel\Desktop" "Wallpaper"

  ; Roboto / Roboto Black are intentionally NOT removed here — the fonts stay
  ; installed on the machine after uninstall so other apps that rely on them
  ; keep working. (The user explicitly asked for this behavior.)
!macroend
