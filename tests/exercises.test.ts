import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { openDb } from "../src/data/db.js";
import { fixedClock } from "../src/data/clock.js";
import { uuidv7 } from "../src/data/uuid.js";
import {
  listExercises, getExercise, upsertExercise, archiveExercise,
  unarchiveExercise, deleteExercise, countExercises,
  ValidationError, ConflictError, type MetricType,
} from "../src/data/exercises.js";

const MIGRATIONS = new URL("../migrations", import.meta.url).pathname;
const clock = fixedClock("2026-09-10T07:00:00Z");
const later = fixedClock("2026-09-10T08:00:00Z");

let db: Database;
beforeEach(() => {
  db = openDb({ file: ":memory:", migrationsDir: MIGRATIONS });
});

const make = (name: string, metric_type: MetricType = "total_weight", id = uuidv7()) =>
  upsertExercise(db, { id, name, metric_type }, clock);

describe("creating", () => {
  it("stores an exercise and reads it back", () => {
    const e = make("Bench press");
    expect(e.name).toBe("Bench press");
    expect(e.metric_type).toBe("total_weight");
    expect(e.archived_at).toBeNull();
    expect(e.deleted_at).toBeNull();
    expect(getExercise(db, e.id)).toEqual(e);
  });

  it("trims surrounding whitespace rather than storing it", () => {
    expect(make("  Cable fly  ").name).toBe("Cable fly");
  });

  it("accepts every metric type the app defines", () => {
    const types: MetricType[] = ["bodyweight", "bodyweight_plus", "dumbbell",
                                 "total_weight", "cardio", "hold"];
    for (const t of types) expect(make(`ex ${t}`, t).metric_type).toBe(t);
  });
});

describe("rejecting bad input", () => {
  it("refuses an id that is not a client-minted UUIDv7", () => {
    expect(() => upsertExercise(db, { id: "1", name: "x", metric_type: "cardio" }, clock))
      .toThrow(ValidationError);
  });

  it("refuses an empty or whitespace-only name", () => {
    for (const name of ["", "   "]) {
      expect(() => upsertExercise(db, { id: uuidv7(), name, metric_type: "cardio" }, clock))
        .toThrow(/name is required/);
    }
  });

  it("refuses an unknown metric type", () => {
    expect(() => upsertExercise(db,
      { id: uuidv7(), name: "x", metric_type: "barbell" as MetricType }, clock))
      .toThrow(/metric_type must be one of/);
  });

  it("refuses a duplicate name, case-insensitively", () => {
    make("Bench press");
    expect(() => make("bench PRESS")).toThrow(ConflictError);
  });

  it("frees the name again once the original is deleted", () => {
    const first = make("Bench press");
    deleteExercise(db, first.id, clock);
    expect(() => make("Bench press")).not.toThrow();
  });
});

describe("idempotent upsert - what the outbox depends on", () => {
  it("replaying the identical write changes nothing", () => {
    const id = uuidv7();
    const input = { id, name: "Squat", metric_type: "total_weight" as MetricType,
                    updated_at: "2026-09-10T07:00:00.000Z" };
    const first = upsertExercise(db, input, clock);
    const second = upsertExercise(db, input, later);
    expect(second).toEqual(first);
    expect(countExercises(db).active).toBe(1);
  });

  it("draining the queue twice writes one row, not two", () => {
    const queued = [
      { id: uuidv7(), name: "A", metric_type: "cardio" as MetricType },
      { id: uuidv7(), name: "B", metric_type: "hold" as MetricType },
    ];
    for (const q of queued) upsertExercise(db, q, clock);
    for (const q of queued) upsertExercise(db, q, clock);
    expect(countExercises(db).active).toBe(2);
  });

  it("a newer edit wins", () => {
    const id = uuidv7();
    upsertExercise(db, { id, name: "Old", metric_type: "cardio",
                         updated_at: "2026-09-10T07:00:00.000Z" }, clock);
    upsertExercise(db, { id, name: "New", metric_type: "cardio",
                         updated_at: "2026-09-10T09:00:00.000Z" }, clock);
    expect(getExercise(db, id)!.name).toBe("New");
  });

  it("a stale replay cannot resurrect an old value", () => {
    const id = uuidv7();
    upsertExercise(db, { id, name: "New", metric_type: "cardio",
                         updated_at: "2026-09-10T09:00:00.000Z" }, clock);
    upsertExercise(db, { id, name: "Old", metric_type: "cardio",
                         updated_at: "2026-09-10T07:00:00.000Z" }, clock);
    expect(getExercise(db, id)!.name).toBe("New");
  });

  it("keeps the original created_at across updates", () => {
    const id = uuidv7();
    const first = upsertExercise(db, { id, name: "Row", metric_type: "total_weight" }, clock);
    const updated = upsertExercise(db,
      { id, name: "Seated row", metric_type: "total_weight",
        updated_at: "2026-09-10T09:00:00.000Z" }, later);
    expect(updated.created_at).toBe(first.created_at);
    expect(updated.name).toBe("Seated row");
  });
});

describe("archive and delete", () => {
  it("archiving hides it from the active list but keeps the row", () => {
    const e = make("Old machine press");
    archiveExercise(db, e.id, later);
    expect(listExercises(db, "active").map((x) => x.name)).not.toContain("Old machine press");
    expect(listExercises(db, "archived").map((x) => x.name)).toContain("Old machine press");
    expect(getExercise(db, e.id)!.archived_at).not.toBeNull();
  });

  it("unarchiving brings it back", () => {
    const e = make("Pec deck");
    archiveExercise(db, e.id, later);
    unarchiveExercise(db, e.id, later);
    expect(getExercise(db, e.id)!.archived_at).toBeNull();
    expect(listExercises(db, "active").map((x) => x.name)).toContain("Pec deck");
  });

  it("deleting hides it from every list but leaves the row in the database", () => {
    const e = make("Typo exercise");
    deleteExercise(db, e.id, later);
    for (const scope of ["active", "archived", "all"] as const) {
      expect(listExercises(db, scope).map((x) => x.id)).not.toContain(e.id);
    }
    expect(getExercise(db, e.id)).not.toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM exercise").get()).toEqual({ n: 1 });
  });

  it("refuses to archive something that does not exist", () => {
    expect(() => archiveExercise(db, uuidv7(), clock)).toThrow(ValidationError);
  });
});

describe("listing", () => {
  it("sorts by name, ignoring case", () => {
    make("zercher squat");
    make("Bench press");
    make("arnold press");
    expect(listExercises(db).map((e) => e.name))
      .toEqual(["arnold press", "Bench press", "zercher squat"]);
  });

  it("counts each state separately", () => {
    const a = make("A"); make("B"); const c = make("C");
    archiveExercise(db, a.id, later);
    deleteExercise(db, c.id, later);
    expect(countExercises(db)).toEqual({ active: 1, archived: 1, deleted: 1 });
  });
});
