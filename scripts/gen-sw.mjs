#!/usr/bin/env node
/**
 * Generate the service worker's precache list from the actual build output.
 *
 * The bug this fixes: a hand-written list can only name stable paths, but Vite
 * emits content-hashed bundles. Those were left to the runtime cache-first
 * path — which never ran for them, because on the very first visit the worker
 * is not yet controlling the page, so the browser fetched the bundles directly
 * and the worker never saw them. Offline, the shell loaded and the script was
 * missing: a blank app.
 *
 * Reading the real filenames out of dist at build time is the only version
 * that cannot drift from what was actually shipped.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const DIST = "dist/client";
const html = readFileSync(join(DIST, "index.html"), "utf8");

// Everything index.html actually references from /assets/.
const referenced = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);

// Plus the static files copied from public/ that the app needs to boot.
const statics = readdirSync(DIST)
  .filter((f) => /\.(png|webmanifest)$/.test(f))
  .map((f) => `/${f}`);

// The type is vendored, so it precaches like any other asset. Without this the
// app opens offline in system fallback fonts, which is not the design system.
const fonts = readdirSync(join(DIST, "fonts"))
  .filter((f) => /\.(woff2|css)$/.test(f))
  .map((f) => `/fonts/${f}`);

const shell = ["/", "/index.html", ...referenced, ...statics, ...fonts];

// A version derived from the contents means a deploy invalidates the old cache
// automatically, rather than serving yesterday's bundle forever.
const version =
  "pannben-" +
  createHash("sha256").update(shell.join("|")).digest("hex").slice(0, 12);

const template = readFileSync("public/sw.js", "utf8");
const generated = template
  .replace(/const VERSION = .*;/, `const VERSION = ${JSON.stringify(version)};`)
  .replace(/const SHELL = \[[^\]]*\];/s, `const SHELL = ${JSON.stringify(shell, null, 2)};`);

if (generated === template) {
  console.error("gen-sw: neither VERSION nor SHELL was replaced — check public/sw.js");
  process.exit(1);
}

writeFileSync(join(DIST, "sw.js"), generated);
console.log(`gen-sw: ${version} precaching ${shell.length} files`);
for (const f of shell) console.log(`  ${f}`);
