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
});
