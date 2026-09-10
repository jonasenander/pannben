import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { openDb } from "../src/data/db.js";
import { fixedClock, type Clock } from "../src/data/clock.js";
import { uuidv7 } from "../src/data/uuid.js";
import { upsertExercise, ValidationError, type MetricType } from "../src/data/exercises.js";
import { upsertProgram } from "../src/data/programs.js";
import {
  startSession, logSet, finishSession, getSession, activeSession,
  listSessions, updateSession, deleteSession, getSet, deleteSet,
} from "../src/data/sessions.js";

const MIGRATIONS = new URL("../migrations", import.meta.url).pathname;
const ZONE = "Europe/Stockholm";
const at = (iso: string): Clock => fixedClock(iso);

let db: Database;
let bench: string, row: string, pushA: string, pullB: string;

beforeEach(() => {
  db = openDb({ file: ":memory:", migrationsDir: MIGRATIONS });
  const c = at("2026-01-01T09:00:00Z");
  const add = (name: string, metric_type: MetricType) => {
    const id = uuidv7();
    upsertExercise(db, { id, name, metric_type }, c);
    return id;
  };
  bench = add("Bench press", "total_weight");
  row = add("Barbell row", "total_weight");

  const program = (name: string, exercise: string) => {
    const id = uuidv7();
    upsertProgram(db, {
      id, name,
      blocks: [{ id: uuidv7(), type: "single",
                 entries: [{ id: uuidv7(), exercise_id: exercise, target_sets: 3 }] }],
    }, c);
    return id;
  };
  pushA = program("Push A", bench);
  pullB = program("Pull B", row);
});

/** A finished session on the given day, with `sets` sets logged a minute apart. */
function past(day: string, programId: string, sets: number): string {
  const id = uuidv7();
  const c = at(`${day}T09:00:00Z`);
  const s = startSession(db, { id, program_id: programId }, c, ZONE);
  const ex = s.blocks[0]!.exercises[0]!;
  for (let i = 0; i < sets; i++) {
    logSet(db, { id: uuidv7(), logged_exercise_id: ex.id, set_index: i, weight: 80, reps: 8 },
      at(`${day}T09:0${i + 1}:00Z`));
  }
  finishSession(db, id, at(`${day}T10:00:00Z`));
  return id;
}

describe("the history list", () => {
  it("comes back newest first", () => {
    past("2026-03-01", pushA, 3);
    past("2026-03-05", pullB, 2);
    past("2026-03-03", pushA, 1);

    expect(listSessions(db).map((s) => s.date))
      .toEqual(["2026-03-05", "2026-03-03", "2026-03-01"]);
  });

  it("carries what the row shows: program, duration and set count", () => {
    past("2026-03-01", pushA, 3);
    const [s] = listSessions(db);
    expect(s!.program_name).toBe("Push A");
    expect(s!.set_count).toBe(3);
    // Three sets logged at 09:01, 09:02, 09:03 against a 09:00 start.
    expect(s!.duration_s).toBe(180);
  });

  it("keeps the name the session was logged under after the program is renamed", () => {
    past("2026-03-01", pushA, 1);
    upsertProgram(db, {
      id: pushA, name: "Push A (v2)",
      blocks: [{ id: uuidv7(), type: "single",
                 entries: [{ id: uuidv7(), exercise_id: bench, target_sets: 5 }] }],
    }, at("2026-04-01T09:00:00Z"));

    expect(listSessions(db)[0]!.program_name).toBe("Push A");
  });

  it("filters by program", () => {
    past("2026-03-01", pushA, 3);
    past("2026-03-02", pullB, 3);
    past("2026-03-03", pushA, 3);

    expect(listSessions(db, { program_id: pushA }).map((s) => s.date))
      .toEqual(["2026-03-03", "2026-03-01"]);
  });

  it("pages, so a year of training does not arrive at once", () => {
    for (let d = 1; d <= 5; d++) past(`2026-03-0${d}`, pushA, 1);

    expect(listSessions(db, { limit: 2 }).map((s) => s.date))
      .toEqual(["2026-03-05", "2026-03-04"]);
    expect(listSessions(db, { limit: 2, offset: 2 }).map((s) => s.date))
      .toEqual(["2026-03-03", "2026-03-02"]);
  });

  it("does not count a skipped set as work done", () => {
    const id = uuidv7();
    const c = at("2026-03-01T09:00:00Z");
    const s = startSession(db, { id, program_id: pushA }, c, ZONE);
    const ex = s.blocks[0]!.exercises[0]!;
    logSet(db, { id: uuidv7(), logged_exercise_id: ex.id, set_index: 0, weight: 80, reps: 8 }, c);
    logSet(db, { id: uuidv7(), logged_exercise_id: ex.id, set_index: 1, skipped: true }, c);

    expect(listSessions(db)[0]!.set_count).toBe(1);
  });

  it("includes the session still in progress, marked as such", () => {
    past("2026-03-01", pushA, 2);
    const live = uuidv7();
    startSession(db, { id: live, program_id: pullB }, at("2026-03-02T09:00:00Z"), ZONE);

    const [first, second] = listSessions(db);
    expect(first!.status).toBe("active");
    expect(second!.status).toBe("finished");
  });

  it("leaves a deleted session out", () => {
    const gone = past("2026-03-01", pushA, 1);
    past("2026-03-02", pullB, 1);
    deleteSession(db, gone, at("2026-03-03T09:00:00Z"));

    expect(listSessions(db).map((s) => s.program_name)).toEqual(["Pull B"]);
  });
});

describe("correcting a session afterwards", () => {
  it("fixes the set where 10 was typed as 100", () => {
    const id = past("2026-03-01", pushA, 3);
    const target = getSession(db, id)!.blocks[0]!.exercises[0]!.sets[1]!;
    expect(target.reps).toBe(8);

    logSet(db, { ...target, reps: 10 }, at("2026-03-02T09:00:00Z"));

    expect(getSet(db, target.id)!.reps).toBe(10);
    // Correcting one set does not disturb its neighbours.
    const sets = getSession(db, id)!.blocks[0]!.exercises[0]!.sets;
    expect(sets.map((s) => s.reps)).toEqual([8, 10, 8]);
    expect(sets.map((s) => s.set_index)).toEqual([0, 1, 2]);
  });

  it("frees the slot when a set is deleted, so it can be logged again", () => {
    const id = past("2026-03-01", pushA, 2);
    const ex = getSession(db, id)!.blocks[0]!.exercises[0]!;
    const later = at("2026-03-02T09:00:00Z");

    deleteSet(db, ex.sets[0]!.id, later);
    expect(getSession(db, id)!.blocks[0]!.exercises[0]!.sets.map((s) => s.set_index))
      .toEqual([1]);

    // The one-set-per-slot index ignores deleted rows, so set 1 can be redone.
    logSet(db, { id: uuidv7(), logged_exercise_id: ex.id, set_index: 0, weight: 85, reps: 6 }, later);
    expect(getSession(db, id)!.blocks[0]!.exercises[0]!.sets.map((s) => s.weight))
      .toEqual([85, 80]);
  });

  it("edits the session note", () => {
    const id = past("2026-03-01", pushA, 1);
    updateSession(db, id, { notes: "Shoulder felt off" }, at("2026-03-02T09:00:00Z"));
    expect(getSession(db, id)!.notes).toBe("Shoulder felt off");
  });

  it("moves a session logged on the wrong day", () => {
    const id = past("2026-03-01", pushA, 1);
    updateSession(db, id, { date: "2026-02-28" }, at("2026-03-02T09:00:00Z"));
    expect(getSession(db, id)!.date).toBe("2026-02-28");
  });

  it("refuses a date that is not a date", () => {
    const id = past("2026-03-01", pushA, 1);
    expect(() => updateSession(db, id, { date: "1 mars" }, at("2026-03-02T09:00:00Z")))
      .toThrow(ValidationError);
  });

  it("deleting the session in progress clears the way for a new one", () => {
    const live = uuidv7();
    startSession(db, { id: live, program_id: pushA }, at("2026-03-01T09:00:00Z"), ZONE);
    expect(activeSession(db)!.id).toBe(live);

    deleteSession(db, live, at("2026-03-01T10:00:00Z"));
    expect(activeSession(db)).toBeNull();

    // The partial unique index would refuse this if the row were still active.
    const next = uuidv7();
    expect(() => startSession(db, { id: next, program_id: pushA },
      at("2026-03-01T11:00:00Z"), ZONE)).not.toThrow();
  });

  it("refuses to touch a session that does not exist", () => {
    expect(() => updateSession(db, uuidv7(), { notes: "x" }, at("2026-03-02T09:00:00Z")))
      .toThrow(ValidationError);
    expect(() => deleteSession(db, uuidv7(), at("2026-03-02T09:00:00Z")))
      .toThrow(ValidationError);
  });
});
