#!/usr/bin/env node
/**
 * Lay phone screens out side by side for the README.
 *
 * Input is a directory of 390×844 screenshots taken at deviceScaleFactor 2
 * against a locally seeded instance — never the NAS, and never real training
 * data. Capture them with Playwright at that viewport, then:
 *
 *   node scripts/compose-screenshots.mjs <dir-of-pngs>
 *
 * Composited at 2x and left there, so the type stays crisp when GitHub scales
 * the strip down to its content width. Rounded corners because the frame is a
 * phone, and one shared ground so the strip reads as a single image rather
 * than several pasted together.
 */
import sharp from "sharp";
import { mkdirSync, existsSync } from "node:fs";

const RAW = process.argv[2];
if (!RAW || !existsSync(RAW)) {
  console.error("usage: node scripts/compose-screenshots.mjs <dir-of-pngs>");
  process.exit(1);
}

const OUT = "docs/img";
const W = 390, H = 844, R = 22, GAP = 20, PAD = 24, SCALE = 2;

mkdirSync(OUT, { recursive: true });

/** Round the corners, the way the device does. */
async function rounded(file) {
  const w = W * SCALE, h = H * SCALE;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
       <rect width="${w}" height="${h}" rx="${R * SCALE}" ry="${R * SCALE}" fill="#fff"/></svg>`);
  return sharp(`${RAW}/${file}.png`)
    .resize(w, h)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function strip(name, files, ground) {
  const tiles = await Promise.all(files.map(rounded));
  const width = (PAD * 2 + files.length * W + (files.length - 1) * GAP) * SCALE;
  const height = (PAD * 2 + H) * SCALE;
  await sharp({ create: { width, height, channels: 4, background: ground } })
    .composite(tiles.map((input, i) => ({
      input, left: (PAD + i * (W + GAP)) * SCALE, top: PAD * SCALE,
    })))
    .png({ compressionLevel: 9, palette: true })
    .toFile(`${OUT}/${name}.png`);
  console.log(`  ${name}.png  ${width}x${height}  ${files.join("  ")}`);
}

// The grounds are the app's own --ground tokens, light and dark.
await strip("screens-light", ["home-light", "session-light", "chart-light", "history-light"],
  { r: 0xe7, g: 0xe9, b: 0xec, alpha: 1 });
await strip("screens-dark", ["session-dark", "chart-dark", "program-dark"],
  { r: 0x08, g: 0x0a, b: 0x0d, alpha: 1 });

console.log("compose-screenshots: 2 strips into docs/img");
