import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// pdfjs-dist's canvas rendering needs its worker script served as a static
// file the browser can fetch directly. Copying it into public/ (rather than
// bundling it) sidesteps needing Turbopack- or webpack-specific config for
// `new Worker(...)`. Runs on every `npm install` so the copy never drifts
// from whatever pdfjs-dist version is actually installed.

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const destDir = path.join(here, "..", "public");
const dest = path.join(destDir, "pdf.worker.min.mjs");

if (!existsSync(src)) {
  console.warn(`[copy-pdf-worker] not found at ${src} — skipping.`);
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log("[copy-pdf-worker] copied pdf.worker.min.mjs -> public/");
