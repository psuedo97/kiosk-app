// electron-builder afterPack hook — minifies JS / HTML / CSS in the packed
// app output before NSIS bundles it into the installer. Source files in the
// repo stay readable; only the shipped copy is minified.
//
// - Skips vendored `*.min.*` files (Bootstrap, jQuery, popper — already minified).
// - Skips heavy data dirs (NFS_Resources, external, images) since they contain
//   no JS/HTML/CSS and walking them would be slow.
// - Keeps object property names (terser default), so `window.kiosk.openURL`
//   and the like still work in the renderer.

const fs = require("fs");
const path = require("path");
const { minify: minifyJs } = require("terser");
const { minify: minifyHtml } = require("html-minifier-terser");
const CleanCSS = require("clean-css");

const cleanCss = new CleanCSS({ returnPromise: false });

const SKIP_DIRS = new Set([
  ".claude",
  "node_modules",
  ".git",
  "external",
  "NFS_Resources",
  "images",
]);

async function walk(dir, fn) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), fn);
    } else if (entry.isFile()) {
      await fn(path.join(dir, entry.name));
    }
  }
}

async function minifyOne(file) {
  const name = path.basename(file);
  if (name.includes(".min.")) return null; // vendor file, already minified
  const ext = path.extname(file).toLowerCase();
  if (![".js", ".html", ".css"].includes(ext)) return null;

  const src = fs.readFileSync(file, "utf8");
  const before = src.length;
  try {
    if (ext === ".js") {
      const out = await minifyJs(src, { compress: true, mangle: true });
      if (!out.code) return null;
      fs.writeFileSync(file, out.code, "utf8");
      return { before, after: out.code.length };
    }
    if (ext === ".html") {
      const out = await minifyHtml(src, {
        collapseWhitespace: true,
        removeComments: true,
        minifyJS: true,
        minifyCSS: true,
      });
      fs.writeFileSync(file, out, "utf8");
      return { before, after: out.length };
    }
    if (ext === ".css") {
      const out = cleanCss.minify(src);
      if (!out.styles) return null;
      fs.writeFileSync(file, out.styles, "utf8");
      return { before, after: out.styles.length };
    }
  } catch (e) {
    console.warn(`[afterPack] skip ${name}: ${e.message}`);
  }
  return null;
}

exports.default = async function afterPack(context) {
  const appDir = path.join(context.appOutDir, "resources", "app");
  if (!fs.existsSync(appDir)) {
    console.warn("[afterPack] resources/app not found at", appDir);
    return;
  }
  let totalBefore = 0;
  let totalAfter = 0;
  let count = 0;
  await walk(appDir, async (file) => {
    const r = await minifyOne(file);
    if (r) {
      totalBefore += r.before;
      totalAfter += r.after;
      count++;
    }
  });
  const saved = totalBefore - totalAfter;
  const pct = totalBefore ? ((saved / totalBefore) * 100).toFixed(1) : "0.0";
  console.log(
    `[afterPack] minified ${count} files: ${totalBefore} → ${totalAfter} bytes (saved ${saved} / ${pct}%).`,
  );
};