# NITI TARA — Windows Kiosk Home Screen

An Electron wrapper around the existing **NITI TARA** HTML home screen. It:

- **Auto-starts on Windows login** and shows the home screen **full-screen, locked down** (kiosk mode).
- Opens each tile's link in a **controlled browser window** (Edge, falling back to Chrome).
- **Returns to the home screen automatically when that browser window is closed.**
- Turns the `NFS_Resources` tile into an **in-app submenu** (web links + per-sector PDFs) instead of opening File Explorer.

---

## How it works

| Piece | File | Role |
|------|------|------|
| Main process | [main.js](main.js) | Creates the kiosk window, locks it down, launches + watches the controlled browser, auto-start on login. |
| Preload bridge | [preload.js](preload.js) | Exposes a minimal, safe `window.kiosk` API to the page. |
| Home-screen logic | [renderer.js](renderer.js) | Intercepts tile clicks → opens links in the controlled browser. |
| Home screen | [index.html](index.html) | Your original page (background video, tiles), with `renderer.js` added. |
| Resources submenu | [resources.html](resources.html) | In-app menu for the `NFS_Resources` tile. |
| Submenu data | `resources-data.js` *(generated)* | Built from the `NFS_Resources` folder by the script below. |
| Build script | [scripts/build-resources.js](scripts/build-resources.js) | Scans `NFS_Resources` (`.url` shortcuts + sector PDFs) into `resources-data.js`. |

**The browser round-trip:** when a tile is clicked, the main process launches Edge/Chrome in clean *app mode* against a dedicated browser profile, and drops the kiosk's always-on-top flag so the browser is usable. Because that browser uses its own profile, it is always its own process — when the user closes the window, the process exits, and the kiosk re-asserts full-screen + always-on-top and grabs focus.

---

## Prerequisites

- Windows 10/11
- [Node.js](https://nodejs.org/) 18+ (you have v23)
- Microsoft Edge (ships with Windows 11) or Google Chrome

## Install & run

```powershell
npm install          # downloads Electron + electron-builder
npm run dev          # SAFE: windowed, no lockdown, closable — use this to test
npm start            # FULL kiosk mode (full-screen, locked) — see exit combo below
```

> **Test with `npm run dev` first.** `npm start` runs the real locked kiosk: full-screen,
> always-on-top, close-prevented. The only way out is the maintenance combo:
>
> ### `Ctrl + Alt + Shift + Q`  — quits the kiosk

If you add/remove PDFs or `.url` shortcuts under `NFS_Resources`, rebuild the submenu:

```powershell
npm run build:resources
```

## Build a Windows installer

```powershell
npm run dist
```

Produces an NSIS installer under `dist/`. Installing it and launching once registers
the app to **auto-start on login** (via `app.setLoginItemSettings`).

> **App icon:** no custom icon is configured yet (avoids a build failure from a
> too-small image). To add one, create a 256×256+ `build/icon.ico` and add
> `"icon": "build/icon.ico"` under `build.win` in [package.json](package.json).

---

## Auto-start on login (use a Scheduled Task, not the Run key)

**Do NOT use the registry Run key / Startup folder.** Windows deliberately delays
and staggers Run-key apps so the desktop loads first — on a machine with many
startup programs this pushed the kiosk to **30–40s after login** (the app itself
cold-starts in ~0.3s, so the delay is purely Windows' startup throttle). Autostart
uses a **logon Scheduled Task** instead, which fires right at logon without that throttle.

**The installer manages this for you** (via [build/installer.nsh](build/installer.nsh)):

- **On install** it creates the `NITI TARA Kiosk` logon task (and clears any old Run-key entries),
  and sets the desktop wallpaper to `images/wallpaper.png` (style: Fill — see [build/installer.nsh](build/installer.nsh) to change it).
- **On uninstall** it deletes the task and clears the wallpaper value, so nothing is left
  pointing at the removed exe/image.

You normally don't need to touch this. The helper scripts are there for manual
setup / repair (run from an **elevated** PowerShell), e.g. if you installed to a
non-default path or want to (re)register the task by hand:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-autostart.ps1   -ExePath "C:\Path\To\NITI TARA.exe"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\uninstall-autostart.ps1   # removes the task
```

The app itself never registers the Run key; on launch it actively clears any stale
Run-key login item so the two mechanisms never double-launch.

> **Multi-user note:** the task is registered for the user who runs the installer.
> For a dedicated kiosk account that differs from the installing admin, run
> `scripts\install-autostart.ps1` while logged in as the kiosk user instead.

---

## About the "strict kiosk lockdown"

This app does the best it can **from inside Electron**:

- full-screen + always-on-top + frameless, `skipTaskbar`, no app menu;
- close is blocked (only the maintenance combo quits);
- it swallows the shortcuts it is allowed to (refresh, devtools, `Ctrl+W/T/N/P`, `Alt+F4`, `F11`, …).

**Electron cannot block `Alt+Tab`, the `Windows` key, or `Ctrl+Alt+Del`** — Windows reserves
these. For a *truly* locked appliance, layer one of these Windows features on top
(both available on Windows 11 **Pro**):

1. **Shell Launcher v2** *(recommended for single-app kiosks)* — replace the Windows
   shell (`explorer.exe`) with this app's `.exe` for a dedicated kiosk account, so the
   desktop/taskbar never load. Configure via the
   [`MDM_AssignedAccess` / Shell Launcher CSP](https://learn.microsoft.com/en-us/windows/configuration/shell-launcher/)
   or a provisioning package.
2. **Assigned Access** — `Settings → Accounts → Other users → Set up a kiosk` runs a
   single app for a chosen account (designed for UWP/Edge kiosk, but usable).

These OS-level options are what actually disable `Alt+Tab` / the `Windows` key. Keep this
app's in-process lockdown as the second layer.

---

## Customising tiles

- **External tiles** are plain `<a href="https://…" target="_blank">` in [index.html](index.html).
  Change the `href`; clicks are automatically routed to the controlled browser.
- **Tile 6** currently has `href="#"` (placeholder, does nothing). Give it a real URL to activate it.
- **NFS_Resources tile** points to [resources.html](resources.html); its contents come from the
  `NFS_Resources` folder via `npm run build:resources`.
