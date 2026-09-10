#!/usr/bin/env node
/**
 * Generate every app icon from one source image.
 *
 * Committed and repeatable rather than a hand edit, for the same reason as
 * scripts/fetch-fonts.mjs: when the artwork changes, one command regenerates
 * everything and nothing is left behind at the old design.
 *
 * Run: npm run icons
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SOURCE = "assets/pannben-logo.png";
const OUT = "public";

/**
 * How much of the maskable icon is guaranteed to survive.
 *
 * Android crops it to a circle, a squircle or a rounded square at its own
 * discretion, and only the middle 80% — a circle of 40% radius — is promised.
 * This logo's outer ring reaches 44% of half-width, so at full bleed it would
 * be shaved on the more aggressive shapes. Scaling it to 88% puts the ring at
 * roughly 39%, just inside the promise, and the padding is the artwork's own
 * background so the inset is invisible.
 */
const MASKABLE_SCALE = 0.88;

mkdirSync(OUT, { recursive: true });

const meta = await sharp(SOURCE).metadata();
if (meta.width !== meta.height) {
  console.error(`make-icons: ${SOURCE} is ${meta.width}x${meta.height} — it must be square`);
  process.exit(1);
}

/** The artwork's own ground, so padding cannot show as a seam. */
const corner = await sharp(SOURCE)
  .extract({ left: 0, top: 0, width: 24, height: 24 })
  .stats();
const [r, g, b] = corner.channels.slice(0, 3).map((c) => Math.round(c.mean));
const background = { r, g, b, alpha: 1 };
const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * Flattened onto that ground even though this source has no alpha: iOS
 * composites a transparent apple-touch-icon onto black without asking, and a
 * future source with transparency should not quietly get a black box.
 */
const square = (size) =>
  sharp(SOURCE).resize(size, size, { fit: "cover" }).flatten({ background }).png();

for (const [name, size] of [["icon-192", 192], ["icon-512", 512], ["icon-180", 180]]) {
  await square(size).toFile(`${OUT}/${name}.png`);
  console.log(`  ${name}.png  ${size}x${size}`);
}

const inner = Math.round(512 * MASKABLE_SCALE);
const pad = Math.round((512 - inner) / 2);
await sharp(SOURCE)
  .resize(inner, inner, { fit: "cover" })
  .flatten({ background })
  .extend({ top: pad, bottom: 512 - inner - pad, left: pad, right: 512 - inner - pad, background })
  .png()
  .toFile(`${OUT}/icon-maskable-512.png`);
console.log(`  icon-maskable-512.png  512x512  (artwork at ${MASKABLE_SCALE * 100}%, ground ${hex})`);

console.log(`make-icons: 4 icons from ${SOURCE}`);
console.log(`  the manifest's background_color should match ${hex} so the`);
console.log("  launch splash and the icon do not disagree");
