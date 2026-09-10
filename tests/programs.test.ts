import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { openDb } from "../src/data/db.js";
import { fixedClock } from "../src/data/clock.js";
import { uuidv7 } from "../src/data/uuid.js";
import { upsertExercise, deleteExercise, ValidationError, ConflictError } from "../src/data/exercises.js";
import {
  upsertProgram, getProgram, listPrograms,
  archiveProgram, deleteProgram, type ProgramInput,
} from "../src/data/programs.js";

const MIGRATIONS = new URL("../migrations", import.meta.url).pathname;
const clock = fixedClock("2026-09-10T07:00:00Z");
const later = fixedClock("2026-09-10T09:00:00Z");

let db: Database;
let bench: string, incline: string, fly: string, dip: string;

beforeEach(() => {
  db = openDb({ file: ":memory:", migrationsDir: MIGRATIONS });
  const add = (name: string) => {
    const id = uuidv7();
    upsertExercise(db, { id, name, metric_type: "total_weight" }, clock);
    return id;
  };
  bench = add("Bench press");
  incline = add("Incline dumbbell press");
  fly = add("Cable fly");
  dip = add("Weighted dip");
});

const single = (exercise_id: string, target_sets = 3) => ({
  id: uuidv7(), type: "single" as const,
  entries: [{ id: uuidv7(), exercise_id, target_sets }],
});
const superset = (ids: string[], target_sets = 3) => ({
  id: uuidv7(), type: "superset" as const,
  entries: ids.map((exercise_id) => ({ id: uuidv7(), exercise_id, target_sets })),
});

const pushA = (): ProgramInput => ({
  id: uuidv7(),
  name: "Push A",
  blocks: [single(bench), superset([incline, fly]), single(dip)],
});

describe("saving a program as one document", () => {
  it("stores blocks and entries in the order given", () => {
    const p = upsertProgram(db, pushA(), clock);
    expect(p.blocks.map((b) => b.type)).toEqual(["single", "superset", "single"]);
    expect(p.blocks[1]!.entries.map((e) => e.exercise_name))
      .toEqual(["Incline dumbbell press", "Cable fly"]);
  });

  it("joins the exercise name and metric type for display", () => {
    const p = upsertProgram(db, pushA(), clock);
    expect(p.blocks[0]!.entries[0]!.exercise_name).toBe("Bench press");
    expect(p.blocks[0]!.entries[0]!.metric_type).toBe("total_weight");
  });

  it("reordering is an ordinary save, not a special case", () => {
    const input = pushA();
    upsertProgram(db, input, clock);
    const reordered = { ...input, blocks: [...input.blocks!].reverse(),
                        updated_at: "2026-09-10T09:00:00.000Z" };
    const p = upsertProgram(db, reordered, later);
    expect(p.blocks.map((b) => b.type)).toEqual(["single", "superset", "single"]);
    expect(p.blocks[0]!.entries[0]!.exercise_name).toBe("Weighted dip");
  });

  it("replaces structure wholesale rather than accumulating orphans", () => {
    const input = pushA();
    upsertProgram(db, input, clock);
    upsertProgram(db, { ...input, blocks: [single(bench)],
                        updated_at: "2026-09-10T09:00:00.000Z" }, later);
    expect(getProgram(db, input.id)!.blocks).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM program_block").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM program_entry").get()).toEqual({ n: 1 });
  });

  it("allows an empty program while you are still building it", () => {
    const p = upsertProgram(db, { id: uuidv7(), name: "Empty", blocks: [] }, clock);
    expect(p.blocks).toEqual([]);
  });
});

describe("refusing structure that cannot be logged", () => {
  it("a single block holds exactly one exercise", () => {
    expect(() => upsertProgram(db, {
      id: uuidv7(), name: "Bad",
      blocks: [{ id: uuidv7(), type: "single",
                 entries: [bench, fly].map((exercise_id) => ({ id: uuidv7(), exercise_id, target_sets: 3 })) }],
    }, clock)).toThrow(/exactly one exercise/);
  });

  it("a superset needs at least two", () => {
    expect(() => upsertProgram(db, {
      id: uuidv7(), name: "Bad", blocks: [{ id: uuidv7(), type: "superset",
        entries: [{ id: uuidv7(), exercise_id: bench, target_sets: 3 }] }],
    }, clock)).toThrow(/at least two exercises/);
  });

  it("refuses an unknown or deleted exercise", () => {
    expect(() => upsertProgram(db, { id: uuidv7(), name: "Ghost", blocks: [single(uuidv7())] }, clock))
      .toThrow(/unknown exercise/);

    deleteExercise(db, fly, clock);
    expect(() => upsertProgram(db, { id: uuidv7(), name: "Gone", blocks: [single(fly)] }, clock))
      .toThrow(/deleted exercise/);
  });

  it("refuses a nonsense target set count", () => {
    for (const n of [0, -1, 51, 2.5]) {
      expect(() => upsertProgram(db,
        { id: uuidv7(), name: `n${n}`, blocks: [single(bench, n)] }, clock))
        .toThrow(/target sets/);
    }
  });

  it("refuses a duplicate program name", () => {
    upsertProgram(db, pushA(), clock);
    expect(() => upsertProgram(db, { ...pushA(), name: "PUSH a" }, clock)).toThrow(ConflictError);
  });

  it("leaves the old structure intact when a save is rejected", () => {
    const input = pushA();
    upsertProgram(db, input, clock);
    expect(() => upsertProgram(db, { ...input, name: "Push A",
      blocks: [single(bench), single(uuidv7())],
      updated_at: "2026-09-10T09:00:00.000Z" }, later)).toThrow(ValidationError);
    expect(getProgram(db, input.id)!.blocks).toHaveLength(3);
  });
});

describe("replay safety", () => {
  it("replaying the same save changes nothing", () => {
    const input = { ...pushA(), updated_at: "2026-09-10T07:00:00.000Z" };
    const first = upsertProgram(db, input, clock);
    const second = upsertProgram(db, input, later);
    expect(second).toEqual(first);
    expect(db.prepare("SELECT COUNT(*) AS n FROM program_block").get()).toEqual({ n: 3 });
  });

  it("a stale replay cannot undo a newer edit", () => {
    const input = pushA();
    upsertProgram(db, { ...input, updated_at: "2026-09-10T09:00:00.000Z" }, later);
    upsertProgram(db, { ...input, name: "Stale", blocks: [],
                        updated_at: "2026-09-10T07:00:00.000Z" }, clock);
    const p = getProgram(db, input.id)!;
    expect(p.name).toBe("Push A");
    expect(p.blocks).toHaveLength(3);
  });
});

describe("listing", () => {
  it("summarises block and planned-set counts", () => {
    upsertProgram(db, pushA(), clock);
    const [p] = listPrograms(db);
    expect(p!.name).toBe("Push A");
    expect(p!.blocks).toBe(3);
    expect(p!.planned_sets).toBe(12); // 3 + (3+3) + 3
  });

  it("separates active, archived and deleted", () => {
    const a = upsertProgram(db, pushA(), clock);
    const b = upsertProgram(db, { ...pushA(), name: "Pull B" }, clock);
    archiveProgram(db, a.id, later);
    deleteProgram(db, b.id, later);
    expect(listPrograms(db, "active")).toHaveLength(0);
    expect(listPrograms(db, "archived").map((p) => p.name)).toEqual(["Push A"]);
    expect(listPrograms(db, "all").map((p) => p.name)).toEqual(["Push A"]);
    expect(getProgram(db, b.id)).not.toBeNull(); // still in the database
  });

  it("reports zero planned sets for an empty program", () => {
    upsertProgram(db, { id: uuidv7(), name: "Empty", blocks: [] }, clock);
    expect(listPrograms(db)[0]!.planned_sets).toBe(0);
  });
});
