import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { openDb } from "../src/data/db.js";
import { fixedClock, type Clock } from "../src/data/clock.js";
import { uuidv7 } from "../src/data/uuid.js";
import { upsertExercise } from "../src/data/exercises.js";
import { upsertProgram } from "../src/data/programs.js";
import { startSession, logSet, type SessionBlock } from "../src/data/sessions.js";
import { currentRound, roundsPlanned, openRounds } from "../src/data/rounds.js";

const MIGRATIONS = new URL("../migrations", import.meta.url).pathname;
const ZONE = "Europe/Stockholm";
const clock: Clock = fixedClock("2026-03-01T09:00:00Z");

let db: Database;
let incline: string, fly: string, program: string;

beforeEach(() => {
  db = openDb({ file: ":memory:", migrationsDir: MIGRATIONS });
  incline = uuidv7();
  fly = uuidv7();
  upsertExercise(db, { id: incline, name: "Incline press", metric_type: "total_weight" }, clock);
  upsertExercise(db, { id: fly, name: "Cable fly", metric_type: "total_weight" }, clock);

  program = uuidv7();
  upsertProgram(db, {
    id: program, name: "Push",
    blocks: [{ id: uuidv7(), type: "superset", entries: [
      { id: uuidv7(), exercise_id: incline, target_sets: 3 },
      { id: uuidv7(), exercise_id: fly, target_sets: 3 },
    ] }],
  }, clock);
});

function block(): SessionBlock {
  const id = uuidv7();
  const s = startSession(db, { id, program_id: program }, clock, ZONE);
  return s.blocks[0]!;
}

/** Log a set for one exercise of the block at a given round. */
function log(b: SessionBlock, which: 0 | 1, round: number) {
  const ex = b.exercises[which]!;
  logSet(db, {
    id: uuidv7(), logged_exercise_id: ex.id,
    set_index: round, round_index: round, weight: 40, reps: 10,
  }, clock);
  // Re-read so the caller sees the logged sets. Only `round_index` matters to
  // the round logic, which is the whole reason it takes a structural type.
  const fresh = db
    .prepare("SELECT round_index FROM logged_set WHERE logged_exercise_id = ? AND deleted_at IS NULL")
    .all(ex.id) as { round_index: number }[];
  ex.sets = fresh as typeof ex.sets;
}

describe("which round a superset is on", () => {
  it("starts at round 0 with nothing logged", () => {
    expect(currentRound(block())).toBe(0);
  });

  /**
   * The bug this file exists for.
   *
   * The first version took the round from the *deepest* round anyone had
   * reached, so logging the first exercise advanced the whole block — and the
   * second exercise was then rendered an open row for round 0 *and* round 1.
   * Logging the round-1 row first left a permanent hole at round 0.
   */
  it("does not advance because one exercise got there first", () => {
    const b = block();
    log(b, 0, 0);
    expect(currentRound(b)).toBe(0);
  });

  it("advances only when every exercise has closed the round", () => {
    const b = block();
    log(b, 0, 0);
    log(b, 1, 0);
    expect(currentRound(b)).toBe(1);
  });

  it("keeps advancing round by round", () => {
    const b = block();
    for (const r of [0, 1]) { log(b, 0, r); log(b, 1, r); }
    expect(currentRound(b)).toBe(2);
  });

  it("stops at the last planned round rather than running forever", () => {
    const b = block();
    for (const r of [0, 1, 2]) { log(b, 0, r); log(b, 1, r); }
    expect(currentRound(b)).toBe(roundsPlanned(b));
  });
});

describe("the rows each exercise gets", () => {
  it("gives every exercise exactly one open row, and never two", () => {
    const b = block();
    log(b, 0, 0);

    // The exercise that logged shows its record plus nothing open yet.
    expect(openRounds(b, b.exercises[0]!)).toEqual([]);
    // The one that has not shows exactly the round it owes.
    expect(openRounds(b, b.exercises[1]!)).toEqual([0]);
  });

  it("opens the next round for both once the round closes", () => {
    const b = block();
    log(b, 0, 0);
    log(b, 1, 0);
    expect(openRounds(b, b.exercises[0]!)).toEqual([1]);
    expect(openRounds(b, b.exercises[1]!)).toEqual([1]);
  });

  it("opens nothing once the block is done", () => {
    const b = block();
    for (const r of [0, 1, 2]) { log(b, 0, r); log(b, 1, r); }
    expect(openRounds(b, b.exercises[0]!)).toEqual([]);
    expect(openRounds(b, b.exercises[1]!)).toEqual([]);
  });

  it("lets an explicit next round leave a gap, which is the point of the button", () => {
    const b = block();
    log(b, 0, 0);
    // Round 0 was never closed by the second exercise; Next round forces it on.
    expect(openRounds(b, b.exercises[1]!, { forcedRound: 1 })).toEqual([1]);
    expect(openRounds(b, b.exercises[0]!, { forcedRound: 1 })).toEqual([1]);
  });

  it("a single block is unaffected: rows come from target_sets", () => {
    const id = uuidv7();
    const solo = uuidv7();
    upsertProgram(db, {
      id: solo, name: "Solo",
      blocks: [{ id: uuidv7(), type: "single",
                 entries: [{ id: uuidv7(), exercise_id: incline, target_sets: 3 }] }],
    }, clock);
    const s = startSession(db, { id, program_id: solo }, clock, ZONE);
    const b = s.blocks[0]!;
    expect(openRounds(b, b.exercises[0]!)).toEqual([0]);
  });
});
