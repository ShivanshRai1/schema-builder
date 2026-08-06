import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Copy monaco-editor/min/vs → public/monaco/vs for self-hosted (no CDN) loads. */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "monaco-editor", "min", "vs");
const dest = join(root, "public", "monaco", "vs");

if (!existsSync(src)) {
  console.warn("[copy-monaco] monaco-editor not installed; skip");
  process.exit(0);
}

mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("[copy-monaco] synced public/monaco/vs");
