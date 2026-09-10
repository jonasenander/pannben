import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { openDb } from "../src/data/db.js";
import { fixedClock, type Clock } from "../src/data/clock.js";
import { uuidv7 } from "../src/data/uuid.js";
import { upsertExercise, ValidationError, type MetricType } from "../src/data/exercises.js";
import { upsertProgram } from "../src/data/programs.js";
import {
  startSession, logSet, getSession, activeSession, finishSession,
  prefillFor, lastNoteFor, setExerciseNote, sessionDurationSeconds, getSet, deleteSet,
} from "../src/data/sessions.js";

const MIGRATIONS = new URL("../migrations", import.meta.url).pathname;
const ZONE = "Europe/Stockholm";
const at = (iso: string): Clock => fixedClock(iso);
const clock = at("2026-09-10T16:00:00Z");

let db: Database;
let bench: string, incline: string, fly: string, plank: string, program: string;

beforeEach(() => {
  db = openDb({ file: ":memory:", migrationsDir: MIGRATIONS });
  const add = (name: string, metric_type: MetricType) => {
    const id = uuidv7();
    upsertExercise(db, { id, name, metric_type }, clock);
    return id;
  };
  bench = add("Bench press", "total_weight");
  incline = add("Incline dumbbell press", "dumbbell");
  fly = add("Cable fly", "total_weight");
  plank = add("Plank", "hold");

  program = uuidv7();
  upsertProgram(db, {
    id: program, name: "Push A",
    blocks: [
      { id: uuidv7(), type: "single", entries: [{ id: uuidv7(), exercise_id: bench, target_sets: 3 }] },
      { id: uuidv7(), type: "superset", entries: [
        { id: uuidv7(), exercise_id: incline, target_sets: 3 },
        { id: uuidv7(), exercise_id: fly, target_sets: 3 }] },
    ],
  }, clock);
});

const start = (c: Clock = clock, id = uuidv7()) =>
  startSession(db, { id, program_id: program }, c, ZONE);

describe("starting", () => {
  it("snapshots the program structure", () => {
    const s = start();
    expect(s.program_name).toBe("Push A");
    expect(s.blocks.map((b) => b.type)).toEqual(["single", "superset"]);
    expect(s.blocks[1]!.exercises.map((e) => e.exercise_name))
      .toEqual(["Incline dumbbell press", "Cable fly"]);
  });

  it("keeps its own copy, so editing the program later changes nothing", () => {
    const s = start();
    upsertProgram(db, {
      id: program, name: "Push A rewritten",
      blocks: [{ id: uuidv7(), type: "single",
                 entries: [{ id: uuidv7(), exercise_id: plank, target_sets: 5 }] }],
      updated_at: "2026-09-11T00:00:00.000Z",
    }, at("2026-09-11T00:00:00Z"));

    const after = getSession(db, s.id)!;
    expect(after.program_name).toBe("Push A");
    expect(after.blocks).toHaveLength(2);
    expect(after.blocks[0]!.exercises[0]!.exercise_name).toBe("Bench press");
  });

  it("takes the local date at start, so a late session keeps the starting day", () => {
    // 21:40Z is 23:40 in Stockholm — still the 10th locally
    expect(start(at("2026-09-10T21:40:00Z")).date).toBe("2026-09-10");
    // 22:30Z is 00:30 on the 11th
    finishSession(db, activeSession(db)!.id, clock);
    expect(start(at("2026-09-10T22:30:00Z")).date).toBe("2026-09-11");
  });

  it("allows only one session open at a time", () => {
    start();
    expect(() => start()).toThrow(/already in progress/);
  });

  it("lets the same session id be re-sent without duplicating structure", () => {
    const id = uuidv7();
    start(clock, id);
    const again = startSession(db, { id, program_id: program }, clock, ZONE);
    expect(again.blocks).toHaveLength(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM session_block").get()).toEqual({ n: 2 });
  });

  it("supports an ad-hoc session with no program", () => {
    const s = startSession(db, { id: uuidv7(), blocks: [] }, clock, ZONE);
    expect(s.program_id).toBeNull();
    expect(s.blocks).toEqual([]);
  });
});

describe("logging sets", () => {
  const firstExercise = (s: ReturnType<typeof start>) => s.blocks[0]!.exercises[0]!;

  it("stores a set and reads it back in order", () => {
    const s = start();
    const le = firstExercise(s).id;
    logSet(db, { id: uuidv7(), logged_exercise_id: le, set_index: 0, weight: 80, reps: 8 }, clock);
    logSet(db, { id: uuidv7(), logged_exercise_id: le, set_index: 1, weight: 80, reps: 7 }, clock);
    const sets = getSession(db, s.id)!.blocks[0]!.exercises[0]!.sets;
    expect(sets.map((x) => [x.weight, x.reps])).toEqual([[80, 8], [80, 7]]);
  });

  it("accepts 0.25 kg increments", () => {
    const s = start();
    const set = logSet(db, { id: uuidv7(), logged_exercise_id: firstExercise(s).id,
                             set_index: 0, weight: 22.25, reps: 10 }, clock);
    expect(set.weight).toBe(22.25);
  });

  it("demands the fields the metric type needs", () => {
    const s = start();
    expect(() => logSet(db, { id: uuidv7(), logged_exercise_id: firstExercise(s).id,
                              set_index: 0, weight: 80 }, clock)).toThrow(/weight and reps/);
  });

  it("refuses a fractional rep", () => {
    const s = start();
    expect(() => logSet(db, { id: uuidv7(), logged_exercise_id: firstExercise(s).id,
                              set_index: 0, weight: 80, reps: 8.5 }, clock))
      .toThrow(/reps must be a whole number/);
  });

  it("lets a skipped set carry no values", () => {
    const s = start();
    const set = logSet(db, { id: uuidv7(), logged_exercise_id: firstExercise(s).id,
                             set_index: 0, skipped: true }, clock);
    expect(set.skipped).toBe(true);
    expect(set.weight).toBeNull();
  });

  it("records to_failure", () => {
    const s = start();
    const set = logSet(db, { id: uuidv7(), logged_exercise_id: firstExercise(s).id,
                             set_index: 2, weight: 75, reps: 8, to_failure: true }, clock);
    expect(set.to_failure).toBe(true);
  });

  it("keeps superset rounds distinguishable after the fact", () => {
    const s = start();
    const [a, b] = s.blocks[1]!.exercises;
    for (const round of [0, 1, 2]) {
      logSet(db, { id: uuidv7(), logged_exercise_id: a!.id, set_index: round,
                   round_index: round, weight: 22.5, reps: 10 }, clock);
      logSet(db, { id: uuidv7(), logged_exercise_id: b!.id, set_index: round,
                   round_index: round, weight: 15, reps: 14 }, clock);
    }
    const block = getSession(db, s.id)!.blocks[1]!;
    expect(block.exercises[0]!.sets.map((x) => x.round_index)).toEqual([0, 1, 2]);
    expect(block.exercises[1]!.sets).toHaveLength(3);
  });

  it("orders by index, not by timestamp", () => {
    const s = start();
    const le = firstExercise(s).id;
    // both logged in the same second, out of order
    logSet(db, { id: uuidv7(), logged_exercise_id: le, set_index: 1, weight: 80, reps: 7,
                 logged_at: "2026-09-10T16:00:00.000Z" }, clock);
    logSet(db, { id: uuidv7(), logged_exercise_id: le, set_index: 0, weight: 80, reps: 8,
                 logged_at: "2026-09-10T16:00:00.000Z" }, clock);
    expect(getSession(db, s.id)!.blocks[0]!.exercises[0]!.sets.map((x) => x.reps)).toEqual([8, 7]);
  });

  it("replaying a logged set writes it once", () => {
    const s = start();
    const input = { id: uuidv7(), logged_exercise_id: firstExercise(s).id, set_index: 0,
                    weight: 80, reps: 8, updated_at: "2026-09-10T16:00:00.000Z" };
    logSet(db, input, clock);
    logSet(db, input, at("2026-09-10T17:00:00Z"));
    expect(getSession(db, s.id)!.blocks[0]!.exercises[0]!.sets).toHaveLength(1);
  });

  it("a correction wins, a stale replay does not", () => {
    const s = start();
    const id = uuidv7();
    const base = { id, logged_exercise_id: firstExercise(s).id, set_index: 0, reps: 8 };
    logSet(db, { ...base, weight: 100, updated_at: "2026-09-10T18:00:00.000Z" }, clock);
    logSet(db, { ...base, weight: 10, updated_at: "2026-09-10T16:00:00.000Z" }, clock);
    expect(getSet(db, id)!.weight).toBe(100);
    logSet(db, { ...base, weight: 10, updated_at: "2026-09-10T19:00:00.000Z" }, clock);
    expect(getSet(db, id)!.weight).toBe(10);
  });

  it("refuses a set on an unknown exercise", () => {
    expect(() => logSet(db, { id: uuidv7(), logged_exercise_id: uuidv7(), set_index: 0,
                              weight: 80, reps: 8 }, clock)).toThrow(ValidationError);
  });
});

describe("prefill", () => {
  it("offers the same set index from last time, not the last set done", () => {
    const s1 = start(at("2026-09-03T16:00:00Z"));
    const le = s1.blocks[0]!.exercises[0]!.id;
    logSet(db, { id: uuidv7(), logged_exercise_id: le, set_index: 0, weight: 80, reps: 8 }, clock);
    logSet(db, { id: uuidv7(), logged_exercise_id: le, set_index: 1, weight: 80, reps: 7 }, clock);
    logSet(db, { id: uuidv7(), logged_exercise_id: le, set_index: 2, weight: 60, reps: 12 }, clock); // drop set
    finishSession(db, s1.id, clock);

    const s2 = start(at("2026-09-10T16:00:00Z"));
    // set 1 today must offer 80x8, not the 60x12 that happened to be last
    expect(prefillFor(db, bench, 0, s2.id)).toMatchObject({ weight: 80, reps: 8 });
    expect(prefillFor(db, bench, 2, s2.id)).toMatchObject({ weight: 60, reps: 12 });
  });

  it("carries to_failure across, like weight and reps", () => {
    const s1 = start(at("2026-09-03T16:00:00Z"));
    logSet(db, { id: uuidv7(), logged_exercise_id: s1.blocks[0]!.exercises[0]!.id,
                 set_index: 2, weight: 75, reps: 8, to_failure: true }, clock);
    finishSession(db, s1.id, clock);
    const s2 = start(at("2026-09-10T16:00:00Z"));
    expect(prefillFor(db, bench, 2, s2.id)!.to_failure).toBe(true);
  });

  it("ignores skipped sets — they are not a value to repeat", () => {
    const s1 = start(at("2026-09-03T16:00:00Z"));
    logSet(db, { id: uuidv7(), logged_exercise_id: s1.blocks[0]!.exercises[0]!.id,
                 set_index: 0, skipped: true }, clock);
    finishSession(db, s1.id, clock);
    const s2 = start(at("2026-09-10T16:00:00Z"));
    expect(prefillFor(db, bench, 0, s2.id)).toBeNull();
  });

  it("offers nothing the first time an exercise is done", () => {
    const s = start();
    expect(prefillFor(db, bench, 0, s.id)).toBeNull();
  });

  it("carries the per-exercise note forward", () => {
    const s1 = start(at("2026-09-03T16:00:00Z"));
    setExerciseNote(db, s1.blocks[1]!.exercises[0]!.id, "15° incline, feet flat", clock);
    logSet(db, { id: uuidv7(), logged_exercise_id: s1.blocks[1]!.exercises[0]!.id,
                 set_index: 0, weight: 22.5, reps: 10 }, clock);
    finishSession(db, s1.id, clock);

    expect(lastNoteFor(db, incline)).toBe("15° incline, feet flat");
    const s2 = start(at("2026-09-10T16:00:00Z"));
    expect(s2.blocks[1]!.exercises[0]!.note).toBe("15° incline, feet flat");
  });
});

describe("finishing", () => {
  it("derives duration from the last logged set, not from finishing", () => {
    const s = startSession(db, { id: uuidv7(), program_id: program,
                                 started_at: "2026-09-10T16:00:00.000Z" }, clock, ZONE);
    logSet(db, { id: uuidv7(), logged_exercise_id: s.blocks[0]!.exercises[0]!.id,
                 set_index: 0, weight: 80, reps: 8,
                 logged_at: "2026-09-10T16:45:00.000Z" }, clock);
    // finished half an hour after the last set
    finishSession(db, s.id, at("2026-09-10T17:15:00Z"));
    expect(sessionDurationSeconds(db, s.id)).toBe(45 * 60);
  });

  it("has no duration when nothing was logged", () => {
    const s = start();
    expect(sessionDurationSeconds(db, s.id)).toBeNull();
  });

  it("frees the slot for the next session", () => {
    const s = start();
    expect(activeSession(db)!.id).toBe(s.id);
    finishSession(db, s.id, clock);
    expect(activeSession(db)).toBeNull();
    expect(() => start()).not.toThrow();
  });

  it("stores end-of-session notes when given", () => {
    const s = start();
    expect(finishSession(db, s.id, clock, "Shoulder felt fine").notes).toBe("Shoulder felt fine");
  });
});

describe("one set per slot", () => {
  it("refuses a second set in the same slot rather than silently duplicating", () => {
    const s = start();
    const le = s.blocks[0]!.exercises[0]!.id;
    logSet(db, { id: uuidv7(), logged_exercise_id: le, set_index: 0, weight: 80, reps: 8 }, clock);
    expect(() =>
      logSet(db, { id: uuidv7(), logged_exercise_id: le, set_index: 0, weight: 80, reps: 7 }, clock),
    ).toThrow(/already logged/);
  });

  it("still allows the same index in a different round", () => {
    const s = start();
    const le = s.blocks[1]!.exercises[0]!.id;
    logSet(db, { id: uuidv7(), logged_exercise_id: le, set_index: 0, round_index: 0,
                 weight: 22.5, reps: 10 }, clock);
    expect(() => logSet(db, { id: uuidv7(), logged_exercise_id: le, set_index: 0,
                              round_index: 1, weight: 22.5, reps: 9 }, clock)).not.toThrow();
  });

  it("frees the slot when a set is deleted", () => {
    const s = start();
    const le = s.blocks[0]!.exercises[0]!.id;
    const first = uuidv7();
    logSet(db, { id: first, logged_exercise_id: le, set_index: 0, weight: 100, reps: 8 }, clock);
    deleteSet(db, first, clock);
    expect(() => logSet(db, { id: uuidv7(), logged_exercise_id: le, set_index: 0,
                              weight: 10, reps: 8 }, clock)).not.toThrow();
  });
});
