#!/usr/bin/env node
/**
 * Plausible data for building against — history and chart screens are hard to
 * judge when they are empty. Never point this at the NAS: it refuses anything
 * but a local server, and it will not touch a database that already has rows.
 */
const BASE = process.env.PANNBEN_URL ?? "http://127.0.0.1:8225";

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(BASE)) {
  console.error(`refusing to seed ${BASE} — local servers only`);
  process.exit(1);
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
let counter = 0;
function uuidv7() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const ms = Date.now();
  b[0] = (ms / 2 ** 40) & 255; b[1] = (ms / 2 ** 32) & 255; b[2] = (ms / 2 ** 24) & 255;
  b[3] = (ms / 2 ** 16) & 255; b[4] = (ms / 2 ** 8) & 255; b[5] = ms & 255;
  const c = counter++ & 0xfff;
  b[6] = 0x70 | ((c >>> 8) & 0x0f); b[7] = c & 0xff; b[8] = 0x80 | (b[8] & 0x3f);
  const h = (i) => HEX[b[i]];
  return `${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
}

const EXERCISES = [
  ["Bench press", "total_weight", "Flat, feet planted"],
  ["Incline dumbbell press", "dumbbell", "15° incline"],
  ["Cable fly", "total_weight", ""],
  ["Weighted dip", "bodyweight_plus", ""],
  ["Pull-up", "bodyweight", ""],
  ["Lat pulldown", "total_weight", ""],
  ["Seated row", "total_weight", ""],
  ["Squat", "total_weight", "High bar"],
  ["Romanian deadlift", "total_weight", ""],
  ["Plank", "hold", ""],
  ["Treadmill", "cardio", ""],
];

const existing = await (await fetch(`${BASE}/api/exercises?include=all`)).json();
if (existing.exercises.length > 0) {
  console.error(`refusing to seed: ${existing.exercises.length} exercises already exist`);
  process.exit(1);
}

for (const [name, metric_type, notes] of EXERCISES) {
  const id = uuidv7();
  const res = await fetch(`${BASE}/api/exercises/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, metric_type, notes }),
  });
  if (!res.ok) {
    console.error(`failed on ${name}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
}

// One archived, so the Archived tab is not empty while building against it.
const legacy = uuidv7();
await fetch(`${BASE}/api/exercises/${legacy}`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Pec deck", metric_type: "total_weight" }),
});
await fetch(`${BASE}/api/exercises/${legacy}/archive`, { method: "POST" });

console.log(`seeded ${EXERCISES.length} exercises + 1 archived into ${BASE}`);
