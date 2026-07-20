// Auto-update for the NITI TARA kiosk, built on electron-updater.
//
// Flow: "notify, admin confirms" (chosen for an unattended, locked kiosk).
//   1. On launch (and every few hours) we check the configured update feed.
//   2. Any newer version is downloaded silently in the background.
//   3. When the download finishes we DON'T install — we tell the renderer so it
//      can show an "update ready" notice, and we wait.
//   4. An on-site maintainer applies it with the maintenance combo
//      Ctrl + Alt + Shift + U (or window.kiosk.installUpdate()).
//
// Because the NSIS build is `perMachine`, applying the update triggers a Windows
// UAC elevation prompt — acceptable for an attended maintenance action, and the
// reason we never auto-install.
//
// The update feed (provider/url) is configured under `build.publish` in
// package.json. electron-builder bakes that into app-update.yml at pack time,
// so this module needs no URLs of its own.

const { app, ipcMain, globalShortcut } = require("electron");
const { autoUpdater } = require("electron-updater");

const INSTALL_ACCELERATOR = "Control+Alt+Shift+U";
// Re-check the feed periodically while the kiosk runs (6 hours).
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Small delay after launch before the first check, so startup isn't competing
// with the update download for network/CPU.
const FIRST_CHECK_DELAY_MS = 15 * 1000;

let updateReady = false;

function send(getWindow, status) {
  const win = getWindow && getWindow();
  if (win && !win.isDestroyed()) win.webContents.send("update-status", status);
}

// `getWindow` is a function returning the current kiosk BrowserWindow (or null).
// We take a getter rather than the window itself because the window is created
// after this module may be wired up, and could be recreated.
function initAutoUpdate(getWindow) {
  // Auto-update only makes sense for an installed build — an unpacked dev
  // checkout has no installer to apply, and electron-updater throws there.
  if (!app.isPackaged) return;

  // Download in the background, but never install without an explicit go-ahead.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("checking-for-update", () =>
    send(getWindow, { state: "checking" }),
  );
  autoUpdater.on("update-available", (info) =>
    send(getWindow, { state: "available", version: info && info.version }),
  );
  autoUpdater.on("update-not-available", () =>
    send(getWindow, { state: "none" }),
  );
  autoUpdater.on("download-progress", (p) =>
    send(getWindow, { state: "downloading", percent: Math.round(p.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    send(getWindow, { state: "ready", version: info && info.version });
  });
  autoUpdater.on("error", (err) =>
    send(getWindow, {
      state: "error",
      message: String((err && err.message) || err),
    }),
  );

  // Admin-triggered install. Only acts once a download has completed, so a
  // stray keypress before an update exists is a harmless no-op.
  const installUpdate = () => {
    if (!updateReady) return;
    // isSilent=false  → show the NSIS installer UI (and UAC prompt for perMachine)
    // isForceRunAfter=true → relaunch the kiosk once the update is applied.
    autoUpdater.quitAndInstall(false, true);
  };

  const checkNow = () => autoUpdater.checkForUpdates().catch(() => {});

  ipcMain.handle("install-update", installUpdate);
  ipcMain.handle("check-for-updates", checkNow);
  globalShortcut.register(INSTALL_ACCELERATOR, installUpdate);

  setTimeout(checkNow, FIRST_CHECK_DELAY_MS);
  setInterval(checkNow, CHECK_INTERVAL_MS);
}

module.exports = { initAutoUpdate };
