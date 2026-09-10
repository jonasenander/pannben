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


const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`${method} ${path} → ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  return res.status === 204 ? null : res.json();
};

const existing = await (await fetch(`${BASE}/api/exercises?include=all`)).json();
if (existing.exercises.length > 0) {
  console.error(`refusing to seed: ${existing.exercises.length} exercises already exist`);
  process.exit(1);
}

/** name → id, so the programs below can be written in plain English. */
const ex = {};
for (const [name, metric_type, notes] of EXERCISES) {
  const id = uuidv7();
  await api("PUT", `/api/exercises/${id}`, { name, metric_type, notes });
  ex[name] = id;
}

// One archived, so the Archived tab is not empty while building against it.
const legacy = uuidv7();
await api("PUT", `/api/exercises/${legacy}`, { name: "Pec deck", metric_type: "total_weight" });
await api("POST", `/api/exercises/${legacy}/archive`);

// ------------------------------------------------------------------ programs

/** `[type, ...names]` — a block is a superset when it names more than one. */
const PROGRAMS = [
  ["Push A", [["Bench press", 4], ["Incline dumbbell press", 3, "Cable fly", 3], ["Weighted dip", 3]]],
  ["Pull B", [["Pull-up", 4], ["Lat pulldown", 3], ["Seated row", 3]]],
  ["Legs", [["Squat", 4], ["Romanian deadlift", 3], ["Plank", 3]]],
];

const programIds = {};
for (const [name, blocks] of PROGRAMS) {
  const id = uuidv7();
  await api("PUT", `/api/programs/${id}`, {
    name,
    blocks: blocks.map((spec) => {
      const entries = [];
      for (let i = 0; i < spec.length; i += 2) {
        entries.push({ id: uuidv7(), exercise_id: ex[spec[i]], target_sets: spec[i + 1] });
      }
      return { id: uuidv7(), type: entries.length > 1 ? "superset" : "single", entries };
    }),
  });
  programIds[name] = id;
}

// ------------------------------------------------------------------ sessions

/**
 * Eight weeks of plausible training, so history and charts have something in
 * them while they are being built.
 *
 * Backdated entirely through the API: `started_at` and each set's `logged_at`
 * are sent explicitly, and the local date is corrected afterwards with a PATCH.
 * Nothing here reaches into the database behind the app's back, which means
 * the seed exercises the same write path a phone does.
 */
const WEEKS = 8;
const ROTATION = ["Push A", "Pull B", "Legs"];
const DAY_OF_WEEK = [1, 3, 5]; // Monday, Wednesday, Friday

/** A deterministic wobble, so two runs of the seed produce the same numbers. */
let seedState = 20260101;
const rnd = () => ((seedState = (seedState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/**
 * Round to something you could actually load.
 *
 * A barbell moves in 2.5 kg steps (a 1.25 plate a side); dumbbells and stacks
 * in whole kilos. Screenshots full of 102.75 kg squats say the data is fake.
 */
const loadable = (n, step) => Math.max(step, Math.round(n / step) * step);

/** Working weight for an exercise in a given week: a slow ramp, not a straight line. */
const BASE_LOAD = {
  "Bench press": 72.5, "Incline dumbbell press": 26, "Cable fly": 22.5,
  "Weighted dip": 15, "Lat pulldown": 65, "Seated row": 62.5,
  "Squat": 95, "Romanian deadlift": 85,
};

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const today = new Date();
let created = 0;

for (let week = WEEKS - 1; week >= 0; week--) {
  for (let d = 0; d < DAY_OF_WEEK.length; d++) {
    // Anchor on the Monday of the target week, then step to the training day,
    // so sessions land on the weekdays they claim.
    const monday = new Date(today);
    monday.setDate(monday.getDate() - ((today.getDay() + 6) % 7) - week * 7);
    const day = new Date(monday);
    day.setDate(day.getDate() + (DAY_OF_WEEK[d] - 1));
    if (day > today) continue;

    const programName = ROTATION[((WEEKS - week) * 3 + d) % 3];
    const sessionId = uuidv7();
    const startedAt = new Date(day);
    startedAt.setHours(17, 40, 0, 0);

    const session = await api("PUT", `/api/sessions/${sessionId}`, {
      program_id: programIds[programName],
      started_at: startedAt.toISOString(),
    });

    let minute = 0;
    for (const block of session.blocks) {
      const rounds = block.type === "superset" ? block.exercises[0].target_sets : 1;
      for (let round = 0; round < rounds; round++) {
        for (const le of block.exercises) {
          const sets = block.type === "superset" ? 1 : le.target_sets;
          for (let i = 0; i < sets; i++) {
            const setIndex = block.type === "superset" ? round : i;
            const at = new Date(startedAt.getTime() + (minute += 3) * 60_000);
            const progress = (WEEKS - week - 1) * 1.25;
            const load = BASE_LOAD[le.exercise_name];

            const values =
              le.metric_type === "bodyweight" ? { reps: Math.max(4, 9 - setIndex + Math.floor(progress / 3)) }
              : le.metric_type === "hold" ? { duration_s: 45 + Math.round(progress) * 2, weight: 0 }
              : le.metric_type === "cardio" ? { speed: 9.5, duration_s: 900, distance_m: 2400 }
              : {
                  weight: loadable(
                    load + progress + (rnd() - 0.5) * 4,
                    le.metric_type === "dumbbell" ? 1 : 2.5,
                  ),
                  reps: Math.max(5, 9 - setIndex),
                };

            await api("PUT", `/api/sets/${uuidv7()}`, {
              logged_exercise_id: le.id,
              set_index: setIndex,
              round_index: block.type === "superset" ? round : 0,
              logged_at: at.toISOString(),
              // The last set of a straight block is where you empty the tank.
              to_failure: block.type === "single" && setIndex === sets - 1,
              ...values,
            });
          }
        }
      }
    }

    await api("POST", `/api/sessions/${sessionId}/finish`, {
      notes: week === 0 && d === 0 ? "Sleep was bad, everything felt heavy." : "",
    });
    // The server dates a session today; this is the only way to backdate one.
    await api("PATCH", `/api/sessions/${sessionId}`, { date: iso(day) });
    created += 1;
  }
}

console.log(
  `seeded ${EXERCISES.length} exercises + 1 archived, ${PROGRAMS.length} programs, ` +
  `${created} sessions into ${BASE}`,
);
