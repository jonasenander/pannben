#!/usr/bin/env node
/**
 * Vendor the three type families into public/fonts/.
 *
 * The app used to <link> Google Fonts at runtime. Three things were wrong with
 * that: the app is a PWA whose whole point is working in a basement gym, where
 * fonts.googleapis.com is not reachable and every screen fell back to system
 * type; a cold open told Google about it; and the design system's type scale
 * was only ever true when the phone had signal.
 *
 * Run this when a weight is added or a family changes. The .woff2 files are
 * committed, so a build never depends on the network.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "public/fonts";

/** Only the weights the design system actually uses — see docs/decisions/0003. */
const SPEC = "family=Archivo:wght@600;700"
  + "&family=Barlow+Semi+Condensed:wght@400;500;600"
  + "&family=Roboto+Mono:wght@400;500";

// Ask as a modern browser or Google serves the .ttf fallback stylesheet.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const css = await (
  await fetch(`https://fonts.googleapis.com/css2?${SPEC}&display=swap`, {
    headers: { "user-agent": UA },
  })
).text();

mkdirSync(OUT, { recursive: true });

/**
 * Keep the `latin` subset only.
 *
 * Google splits each face across ~7 unicode ranges. Swedish needs å ä ö, which
 * live in `latin` (U+00C0–00FF), so the other six are 150 kB of Vietnamese and
 * Cyrillic this app will never render.
 */
const blocks = css.split("/*").filter((b) => b.trimStart().startsWith("latin */"));
if (blocks.length === 0) {
  console.error("fetch-fonts: no latin blocks in the stylesheet — did the format change?");
  process.exit(1);
}

const out = [
  "/* Vendored from Google Fonts by scripts/fetch-fonts.mjs — latin subset only.",
  " * Do not edit by hand; re-run the script instead. */",
  "",
];

for (const block of blocks) {
  const face = `@font-face {${block.split("{").slice(1).join("{")}`.replace(/\}\s*$/, "}");
  const family = /font-family: '([^']+)'/.exec(face)?.[1];
  const weight = /font-weight: (\d+)/.exec(face)?.[1];
  const url = /url\((https:[^)]+\.woff2)\)/.exec(face)?.[1];
  if (!family || !weight || !url) {
    console.error(`fetch-fonts: could not parse a @font-face block:\n${face}`);
    process.exit(1);
  }

  const name = `${family.toLowerCase().replace(/\s+/g, "-")}-${weight}.woff2`;
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  writeFileSync(join(OUT, name), bytes);

  out.push(
    face
      .replace(/url\(https:[^)]+\)/, `url(/fonts/${name})`)
      .replace(/^\s*/gm, (m) => (m.length > 2 ? "  " : m)),
    "",
  );
  console.log(`  ${name}  ${(bytes.length / 1024).toFixed(1)} kB`);
}

writeFileSync(join(OUT, "fonts.css"), out.join("\n"));
console.log(`fetch-fonts: ${blocks.length} faces into ${OUT}`);
