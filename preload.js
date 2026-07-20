// Safe bridge between the renderer (home screen / submenu) and the main process.
// Exposes only a tiny, explicit API on window.kiosk — no Node access leaks
// into the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kiosk", {
  // Open an external http(s) link in the controlled browser.
  openURL: (url) => ipcRenderer.invoke("open-url", url),
  // Open a local document (app-root-relative path, e.g. a sector PDF).
  openDoc: (rel) => ipcRenderer.invoke("open-doc", rel),
  // Maintenance: quit the kiosk.
  quit: () => ipcRenderer.invoke("quit-kiosk"),
  // Shutdown the Windows system (called from the power-off confirmation modal).
  shutdown: () => ipcRenderer.invoke("shutdown-system"),
  //show desktop
  showDesktopBtn: () => ipcRenderer.invoke("show-desktop"),
  //open exe
  openBhasiniSmritiExe: () => ipcRenderer.invoke("open-bhasini-exe"),
  // Subscribe to loader state changes from main while the Bhasini exe launches.
  // cb(isLoading: boolean). Returns an unsubscribe function.
  onBhasiniLoading: (cb) => {
    const listener = (_e, isLoading) => cb(isLoading);
    ipcRenderer.on("bhasini-loading", listener);
    return () => ipcRenderer.removeListener("bhasini-loading", listener);
  },

  // --- Auto-update ----------------------------------------------------------
  // Subscribe to update status from main. cb(status) where status is e.g.
  // { state: "ready", version: "1.2.0" } | { state: "downloading", percent }.
  // Returns an unsubscribe function.
  onUpdateStatus: (cb) => {
    const listener = (_e, status) => cb(status);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
  // Maintenance: apply a downloaded update now (same as Ctrl+Alt+Shift+U).
  installUpdate: () => ipcRenderer.invoke("install-update"),
  // Maintenance: force an immediate feed check.
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  //To get the app information
  appInfo: () => ipcRenderer.invoke("app-info"),
});
