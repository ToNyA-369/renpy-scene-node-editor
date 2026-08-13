#!/usr/bin/env node

import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = resolve(ROOT, "EDITOR/static/vendor");
const CHECK_ONLY = process.argv.includes("--check");

const shared = {
  bundle: true,
  minify: true,
  sourcemap: false,
  legalComments: "eof",
  platform: "browser",
  target: ["safari17", "chrome120", "firefox120"],
  write: false,
  loader: {
    ".ttf": "dataurl",
    ".svg": "dataurl",
    ".png": "dataurl",
  },
  define: { "process.env.NODE_ENV": '"production"' },
};

const builds = [
  build({
    ...shared,
    entryPoints: [resolve(ROOT, "tools/editor_assets/content_editor_entry.js")],
    outfile: resolve(OUTPUT_ROOT, "content_editor.js"),
    format: "iife",
  }),
  build({
    ...shared,
    entryPoints: [resolve(ROOT, "node_modules/monaco-editor/esm/vs/editor/editor.worker.js")],
    outfile: resolve(OUTPUT_ROOT, "content_editor.worker.js"),
    format: "iife",
  }),
];

const results = await Promise.all(builds);
const outputs = results.flatMap((result) => result.outputFiles || []);
let stale = false;

for (const output of outputs) {
  const contents = Buffer.from(output.text.replace(/[ \t]+$/gm, ""));
  if (CHECK_ONLY) {
    let current = null;
    try {
      current = await readFile(output.path);
    } catch (_error) {
      // Report the missing generated asset below.
    }
    if (!current || !current.equals(contents)) {
      console.error(`Generated Editor asset is stale: ${output.path}`);
      stale = true;
    }
    continue;
  }
  await mkdir(dirname(output.path), { recursive: true });
  await writeFile(output.path, contents);
  console.log(output.path);
}

if (stale) process.exitCode = 1;
