// NITI TARA kiosk — Electron main process.
//
// Responsibilities:
//   1. Show the home screen full-screen and locked down (kiosk mode).
//   2. Auto-start on Windows login.
//   3. When a tile is clicked, open the link/PDF in a *controlled* browser
//      window (Edge or Chrome) and watch that browser's process.
//   4. When the user closes that browser, bring the home screen back to front.
//
// Dev/maintenance: run with `--dev` (or set KIOSK_DEV=1) for a normal resizable,
// closable window with no lockdown. In locked mode, the maintenance exit combo
// is  Ctrl + Alt + Shift + Q.

const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Menu,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, exec } = require("child_process");
const { pathToFileURL } = require("url");

const DEV = process.argv.includes("--dev") || process.env.KIOSK_DEV === "1";
const APP_ROOT = __dirname;
const EXIT_ACCELERATOR = "Control+Alt+Shift+Q";
// Electron always-on-top level. "screen-saver" sits above any other TOPMOST
// app on the system — full lockdown.
const ALWAYS_ON_TOP_LEVEL = "screen-saver";

// IntelliSpace (EyeRIS IntelliSpace interactive-whiteboard overlay) must float
// above the kiosk whenever it's running. We poll for its process; when it's up,
// the kiosk drops alwaysOnTop entirely so IntelliSpace's window stays on top,
// and when it exits we restore the strict "screen-saver" lockdown. The exe is
// `iscore.exe` (description: "EyeRIS IntelliSpace") — confirm with
// `tasklist /FI "IMAGENAME eq iscore.exe"` while IntelliSpace is open.
const INTELLISPACE_PROCESS_NAME = "iscore.exe";
const INTELLISPACE_POLL_INTERVAL_MS = 2500;
let intellispaceRunning = false;

let mainWindow = null;
let browserProc = null;
app.isQuitting = false;

// single instance
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => restoreKiosk());
}

// controlled browser

// First installed browser wins. Edge ships with Windows 11, so it is the
// most reliable default; Chrome is used if present.
function findBrowser() {
  const pf = process.env["PROGRAMFILES"];
  const pf86 = process.env["PROGRAMFILES(X86)"];
  const local = process.env["LOCALAPPDATA"];
  const candidates = [
    pf86 && path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    pf && path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    pf && path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    pf86 && path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    local && path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || null;
}

// Open `target` (an http(s) URL or a file:// URL) in the controlled browser.
// The browser runs against a dedicated profile so it is always its own process
// that we can watch — when it exits we know the user closed the window.
function openInBrowser(target) {
  if (browserProc) return; // one controlled browser at a time
  const browser = findBrowser();
  if (!browser) {
    // No Edge/Chrome found — fall back to the default browser. We cannot watch
    // its lifetime, so the kiosk simply stays underneath until it regains focus.
    shell.openExternal(target);
    return;
  }

  const profileDir = path.join(
    app.getPath("userData"),
    "kiosk-browser-profile",
  );
  // PDFs and videos open at 100% so the built-in PDF / video viewer shows them
  // at their natural size; web pages keep the 0.75 scale factor that fits the
  // gov.in dashboards into the kiosk view.
  const useNaturalScale = /\.(pdf|mp4|webm|mov|m4v|mkv)($|[?#])/i.test(target);
  const scaleFactor = useNaturalScale ? "1" : "0.75";

  const args = [
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--start-maximized",
    `--force-device-scale-factor=${scaleFactor}`,
    `--app=${target}`, // clean window: no tabs / address bar, just an X to close
  ];

  // Let the freshly launched browser come to the foreground.
  if (!DEV && mainWindow) mainWindow.setAlwaysOnTop(false);

  browserProc = spawn(browser, args, { windowsHide: false });
  browserProc.once("error", () => {
    browserProc = null;
    restoreKiosk();
  });
  browserProc.once("exit", () => {
    browserProc = null;
    restoreKiosk();
  });
}

// kiosk window
function createWindow() {
  const opts = {
    backgroundColor: "#000000",
    show: false,
    webPreferences: {
      preload: path.join(APP_ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  if (DEV) {
    Object.assign(opts, { width: 1280, height: 800, frame: false, fullscreen: true });
  } else {
    Object.assign(opts, {
      fullscreen: true,
      kiosk: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      autoHideMenuBar: true,
    });
  }

  mainWindow = new BrowserWindow(opts);
  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(APP_ROOT, "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // mainWindow.webContents.openDevTools();
  if (!DEV) {
    setKioskTopmost();
    // Block closing — the kiosk only exits via the maintenance combo.
    mainWindow.on("close", (e) => {
      if (!app.isQuitting) e.preventDefault();
    });
    // When the user clicks the kiosk's taskbar icon to come back from the
    // Windows desktop (show-desktop temporarily dropped the kiosk locks),
    // re-assert the locked-down state.
    //
    // The tricky bit: Explorer's "auto-hide the taskbar over a fullscreen
    // app" detector fires on foreground-window TRANSITIONS, not on flag
    // changes to the same window. A plain minimize→restore (even with
    // setFullScreen toggled) keeps the kiosk as the same logical foreground
    // window, so Explorer never re-evaluates and the taskbar stays visible.
    //
    // The fix is hide() → apply lockdown flags → show(). Hiding removes the
    // window from the foreground entirely; show() then registers as a fresh
    // fullscreen-app appearance, which Explorer DOES check, and the taskbar
    // hides as it does on initial launch.
    mainWindow.on("restore", () => {
      mainWindow.hide();
      // Drop fullscreen state so the subsequent setFullScreen(true) is a
      // real state transition Windows acts on, not a no-op.
      mainWindow.setFullScreen(false);
      mainWindow.setKiosk(false);
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.setKiosk(true);
        mainWindow.setFullScreen(true);
        setKioskTopmost();
        mainWindow.setSkipTaskbar(true);
        mainWindow.show();
        mainWindow.moveTop();
        mainWindow.focus();
      }, 100);
    });
  }

  const wc = mainWindow.webContents;

  // Anything that tries to open a new window (target="_blank", window.open)
  // is redirected to the controlled browser instead.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) openInBrowser(url);
    return { action: "deny" };
  });

  // In-app navigation (index.html <-> resources.html) is allowed; any attempt
  // to navigate the kiosk window to the web is redirected to the browser.
  const appBase = pathToFileURL(APP_ROOT + path.sep).href;
  wc.on("will-navigate", (e, url) => {
    if (url.startsWith("file://") && url.startsWith(appBase)) return;
    if (/^https?:\/\//i.test(url)) {
      e.preventDefault();
      openInBrowser(url);
    }
  });
}

// Apply the kiosk's always-on-top state based on what else is running. We
// avoid touching it while a controlled browser/SMRITI process is up (those
// flows manage alwaysOnTop themselves), and we drop it entirely when
// IntelliSpace is running so its whiteboard floats above the kiosk.
function setKioskTopmost() {
  if (!mainWindow || mainWindow.isDestroyed() || DEV) return;
  if (browserProc) return; // controlled-process flow owns alwaysOnTop right now
  if (intellispaceRunning) {
    mainWindow.setAlwaysOnTop(false);
  } else {
    mainWindow.setAlwaysOnTop(true, ALWAYS_ON_TOP_LEVEL);
  }
}

// Periodically check whether IntelliSpace is running and update the kiosk's
// always-on-top level when the state flips. Uses `tasklist` (already on every
// Windows install) — no native deps.
function checkIntellispace() {
  exec(
    `tasklist /FI "IMAGENAME eq ${INTELLISPACE_PROCESS_NAME}" /NH`,
    (err, stdout) => {
      if (err) return;
      const running =
        !!stdout &&
        stdout.toLowerCase().includes(INTELLISPACE_PROCESS_NAME.toLowerCase());
      if (running !== intellispaceRunning) {
        intellispaceRunning = running;
        setKioskTopmost();
      }
    },
  );
}

function startIntellispacePoll() {
  if (DEV) return;
  checkIntellispace(); // immediate first check
  setInterval(checkIntellispace, INTELLISPACE_POLL_INTERVAL_MS);
}

// Bring the kiosk back to the foreground (after the browser closes, or on a
// second launch attempt).
function restoreKiosk() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!DEV) {
    mainWindow.setFullScreen(true);
    mainWindow.setKiosk(true);
    setKioskTopmost();
    mainWindow.setSkipTaskbar(true);
  }
  mainWindow.show();
  mainWindow.focus();
}

// lockdown
// NOTE: Electron's globalShortcut cannot intercept Alt+Tab, the Windows key, or
// Ctrl+Alt+Del — Windows reserves those. This swallows the combos it can, and
// keeps the window always-on-top/full-screen. For a TRULY locked appliance use
// Windows Shell Launcher / Assigned Access (see README). The blocks below are
// the best-effort layer on top of that.
function registerLockdown() {
  const blocked = [
    "CommandOrControl+R",
    "CommandOrControl+Shift+R",
    "F5",
    "CommandOrControl+W",
    "CommandOrControl+Shift+W",
    "CommandOrControl+Q",
    "CommandOrControl+N",
    "CommandOrControl+T",
    "CommandOrControl+P",
    "Alt+F4",
    "F11",
    "CommandOrControl+Shift+I",
    "CommandOrControl+Shift+J",
    "CommandOrControl+Shift+C",
    "F12",
  ];
  for (const acc of blocked) {
    try {
      globalShortcut.register(acc, () => {});
    } catch (_) {
      /* reserved */
    }
  }
  globalShortcut.register(EXIT_ACCELERATOR, doQuit);
}

function doQuit() {
  app.isQuitting = true;
  try {
    if (browserProc) browserProc.kill();
  } catch (_) {
    /* ignore */
  }
  globalShortcut.unregisterAll();
  app.quit();
}

// Autostart is handled by a logon Scheduled Task (scripts/install-autostart.ps1),
// which launches without the Run-key startup throttle that delayed boot by
// 30–40s. We also proactively clear any stale Run-key login item a previous
// version of this app may have registered, so the two mechanisms never fight.
function clearStaleAutoLaunch() {
  try {
    app.setLoginItemSettings({ openAtLogin: false });
  } catch (_) {
    /* ignore */
  }
}

// --- IPC (from preload) ------------------------------------------------------

ipcMain.handle("open-url", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) openInBrowser(url);
});

ipcMain.handle("open-doc", (_e, rel) => {
  if (typeof rel !== "string") return;
  // Resolve against the app root and guard against path traversal.
  const safe = path.normalize(rel).replace(/^([\\/])+/, "");
  const abs = path.join(APP_ROOT, safe);
  if (!abs.startsWith(APP_ROOT) || !fs.existsSync(abs)) return;
  openInBrowser(pathToFileURL(abs).href);
});

ipcMain.handle("quit-kiosk", doQuit);

// Shutdown the Windows system (invoked from the power-off confirmation modal).
// /s = shutdown, /t 0 = immediately, /f = force-close apps (so the kiosk's
// close-prevention doesn't stall the shutdown).
ipcMain.handle("shutdown-system", () => {
  app.isQuitting = true; // allow our own close handler to release the window
  try {
    spawn("shutdown", ["/s", "/t", "0", "/f"], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch (_) {
    /* ignore — the user can also Ctrl+Alt+Shift+Q out */
  }
});

// Show the Windows desktop.
// In production the kiosk window is alwaysOnTop + kiosk + fullscreen, all of
// which Windows refuses to minimize (Shell.MinimizeAll / Win+D ignore
// always-on-top windows by design). Drop those states first, surface the
// kiosk on the taskbar so the user has a way to bring it back, then minimize.
// The 'restore' listener in createWindow re-asserts the locks when the
// taskbar icon is clicked.
ipcMain.handle("show-desktop", () => {
  if (!mainWindow) return;
  if (!DEV) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setKiosk(false);
    mainWindow.setFullScreen(false);
    mainWindow.setSkipTaskbar(false);
  }
  mainWindow.minimize();
  // Also ask the shell to minimize any other windows so the user gets a
  // clean desktop view (no-op if nothing else is running, typical for a kiosk).
  try {
    exec(
      'powershell -command "(New-Object -ComObject Shell.Application).MinimizeAll()"',
      (err) => {
        if (err) console.error(err);
      },
    );
  } catch (err) {
    console.error(err);
  }
});

// Launch the bundled Bhasini Smriti exe (./external/SMRITI_V3.exe).
// In dev the path resolves under the project root; in a packaged build the
// external/ folder is included by package.json's `files: ["**/*"]` and ends
// up at resources/app/external/, so the same join works there too.
// Uses the same controlled-process pattern as the browser launch: drop the
// kiosk's always-on-top so the exe is visible, watch the process, and
// re-assert kiosk mode when the user closes the exe.
ipcMain.handle("open-bhasini-exe", () => {
  if (browserProc) return; // already running a controlled foreground process
  const exe = path.join(APP_ROOT, "external", "SMRITI_V3.exe");
  if (!fs.existsSync(exe)) {
    console.error("SMRITI_V3.exe not found at", exe);
    return;
  }

  // --- Loader signaling ----------------------------------------------------
  // The renderer shows a "Launching Bhasini Smriti…" overlay as soon as we
  // emit `bhasini-loading: true`, and hides it when we emit `false`. We use
  // the kiosk window's `blur` event as the "exe is now visible" signal —
  // SMRITI takes the foreground, our window loses focus, loader closes.
  // A 15s timeout closes the loader as a fallback in case `blur` never fires
  // (e.g. SMRITI failed to open a window).
  let loaderClosed = false;
  const closeLoader = () => {
    if (loaderClosed) return;
    loaderClosed = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("bhasini-loading", false);
    }
  };
  const onBlur = () => closeLoader();
  if (mainWindow) {
    mainWindow.webContents.send("bhasini-loading", true);
    mainWindow.once("blur", onBlur);
  }
  const fallback = setTimeout(closeLoader, 15000);
  const cleanupLoader = () => {
    clearTimeout(fallback);
    if (mainWindow) mainWindow.removeListener("blur", onBlur);
    closeLoader();
  };
  // ------------------------------------------------------------------------

  if (!DEV && mainWindow) mainWindow.setAlwaysOnTop(false);
  try {
    browserProc = spawn(exe, [], {
      cwd: path.dirname(exe),
      windowsHide: false,
    });
    browserProc.once("error", (err) => {
      console.error("SMRITI_V3 spawn error:", err);
      cleanupLoader();
      browserProc = null;
      restoreKiosk();
    });
    browserProc.once("exit", () => {
      cleanupLoader();
      browserProc = null;
      restoreKiosk();
    });
  } catch (err) {
    console.error("Failed to launch SMRITI_V3.exe:", err);
    cleanupLoader();
    restoreKiosk();
  }
});

// --- lifecycle ---------------------------------------------------------------

app.whenReady().then(() => {
  createWindow();
  if (!DEV) {
    registerLockdown();
    if (app.isPackaged) clearStaleAutoLaunch();
    startIntellispacePoll();
  }
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => globalShortcut.unregisterAll());
