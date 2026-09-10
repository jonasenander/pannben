import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { openDb } from "../src/data/db.js";
import { fixedClock, type Clock } from "../src/data/clock.js";
import { uuidv7 } from "../src/data/uuid.js";
import { upsertExercise } from "../src/data/exercises.js";
import { upsertProgram } from "../src/data/programs.js";
import { startSession, logSet, finishSession, listSessions } from "../src/data/sessions.js";
import { exportAll, type ExportFile } from "../src/data/export.js";
import { importAll, ImportError } from "../src/data/import.js";
import { upsertMetricType, upsertEntry } from "../src/data/body.js";

const MIGRATIONS = new URL("../migrations", import.meta.url).pathname;
const ZONE = "Europe/Stockholm";
const clock: Clock = fixedClock("2026-03-01T09:00:00Z");

const fresh = () => openDb({ file: ":memory:", migrationsDir: MIGRATIONS });

/** A database with one of everything, so a round trip has something to lose. */
function populate(db: Database): void {
  const bench = uuidv7();
  upsertExercise(db, { id: bench, name: "Bench press", metric_type: "total_weight" }, clock);
  const gone = uuidv7();
  upsertExercise(db, { id: gone, name: "Pec deck", metric_type: "total_weight" }, clock);
  upsertExercise(db, { id: gone, name: "Pec deck", metric_type: "total_weight",
    deleted_at: clock.nowIso() }, clock);

  const program = uuidv7();
  upsertProgram(db, {
    id: program, name: "Push A",
    blocks: [{ id: uuidv7(), type: "single",
               entries: [{ id: uuidv7(), exercise_id: bench, target_sets: 3 }] }],
  }, clock);

  // Body metrics, so the round-trip guarantee is proven against the newest
  // tables rather than only the ones it was written for.
  const weight = uuidv7();
  upsertMetricType(db, { id: weight, name: "Weight", unit: "kg" }, clock);
  upsertEntry(db, { id: uuidv7(), type_id: weight, value: 84.2,
    measured_at: "2026-02-01T07:30:00Z" }, clock);
  upsertEntry(db, { id: uuidv7(), type_id: weight, value: 83.8,
    measured_at: "2026-03-01T07:30:00Z", note: "after a light week" }, clock);

  const session = uuidv7();
  const s = startSession(db, { id: session, program_id: program }, clock, ZONE);
  const ex = s.blocks[0]!.exercises[0]!;
  logSet(db, { id: uuidv7(), logged_exercise_id: ex.id, set_index: 0, weight: 80, reps: 8 }, clock);
  logSet(db, { id: uuidv7(), logged_exercise_id: ex.id, set_index: 1, skipped: true }, clock);
  finishSession(db, session, clock, "Felt strong");
}

let db: Database;
beforeEach(() => {
  db = fresh();
  populate(db);
});

describe("round trip", () => {
  it("export → wipe → import → identical export", () => {
    const before = exportAll(db, clock);

    const target = fresh();
    importAll(target, before, clock);
    const after = exportAll(target, clock);

    expect(after.tables).toEqual(before.tables);
  });

  it("survives a restore over a database that already has different data", () => {
    const backup = exportAll(db, clock);

    const target = fresh();
    upsertExercise(target, { id: uuidv7(), name: "Wrong squat", metric_type: "total_weight" }, clock);
    upsertExercise(target, { id: uuidv7(), name: "Wrong row", metric_type: "total_weight" }, clock);

    importAll(target, backup, clock);

    // Replace-all: nothing of the old database is left behind.
    expect(exportAll(target, clock).tables).toEqual(backup.tables);
  });

  it("brings the sessions back readable, not just the rows", () => {
    const backup = exportAll(db, clock);
    const target = fresh();
    importAll(target, backup, clock);

    const [s] = listSessions(target);
    expect(s!.program_name).toBe("Push A");
    expect(s!.set_count).toBe(1); // the skipped set is not work done
    expect(s!.notes).toBe("Felt strong");
  });

  it("keeps soft-deleted rows, because a backup is not a view", () => {
    const backup = exportAll(db, clock);
    const target = fresh();
    importAll(target, backup, clock);

    const rows = target.prepare("SELECT name, deleted_at FROM exercise").all() as
      { name: string; deleted_at: string | null }[];
    expect(rows.find((r) => r.name === "Pec deck")?.deleted_at).not.toBeNull();
  });

  it("carries the body metrics through, tables and all", () => {
    const backup = exportAll(db, clock);
    const target = fresh();
    const result = importAll(target, backup, clock);

    expect(result.rows.body_metric_type).toBe(1);
    expect(result.rows.body_metric_entry).toBe(2);
    expect(result.tables_skipped).toEqual([]);

    const rows = target
      .prepare("SELECT value, note FROM body_metric_entry ORDER BY measured_at")
      .all() as { value: number; note: string }[];
    expect(rows.map((r) => r.value)).toEqual([84.2, 83.8]);
    expect(rows[1]!.note).toBe("after a light week");
  });

  it("reports what it wrote", () => {
    const backup = exportAll(db, clock);
    const target = fresh();
    const result = importAll(target, backup, clock);

    expect(result.rows.exercise).toBe(2);
    expect(result.rows.logged_set).toBe(2);
    expect(result.tables_skipped).toEqual([]);
  });
});

describe("refusing a file it should not apply", () => {
  const good = () => exportAll(fresh(), clock);

  it("refuses a schema newer than the running app", () => {
    const file = { ...good(), schema_version: 999 } as ExportFile;
    expect(() => importAll(fresh(), file, clock)).toThrow(ImportError);
    // The message has to name both versions, or it is not actionable.
    expect(() => importAll(fresh(), file, clock)).toThrow(/v999.*v5|update Pannben/i);
  });

  it("refuses anything that is not a Pannben export", () => {
    for (const bad of [null, {}, { format: "something-else" }, { tables: {} }]) {
      expect(() => importAll(fresh(), bad as never, clock)).toThrow(ImportError);
    }
  });

  it("accepts an export from an older schema", () => {
    const file = { ...good(), schema_version: 1 } as ExportFile;
    expect(() => importAll(fresh(), file, clock)).not.toThrow();
  });

  it("leaves the database untouched when the file is bad halfway through", () => {
    const target = fresh();
    populate(target);
    const before = exportAll(target, clock);

    const corrupt = exportAll(db, clock);
    // A row the schema will refuse: metric_type is checked.
    (corrupt.tables.exercise as Record<string, unknown>[])[0]!.metric_type = "telekinesis";

    expect(() => importAll(target, corrupt, clock)).toThrow();
    // One transaction: a failed import is a no-op, not a half-wiped database.
    expect(exportAll(target, clock).tables).toEqual(before.tables);
  });

  it("does not import the migration history — that belongs to the running app", () => {
    const backup = exportAll(db, clock);
    const target = fresh();
    const versionBefore = target
      .prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };

    importAll(target, backup, clock);

    const versionAfter = target
      .prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    expect(versionAfter.v).toBe(versionBefore.v);
  });

  it("skips a table the running schema no longer has, and says so", () => {
    const backup = exportAll(db, clock);
    backup.tables.ancient_ideas = [{ id: 1 }];

    const target = fresh();
    const result = importAll(target, backup, clock);
    expect(result.tables_skipped).toEqual(["ancient_ideas"]);
  });

  it("ignores a column the running schema no longer has", () => {
    const backup = exportAll(db, clock);
    for (const row of backup.tables.exercise as Record<string, unknown>[]) {
      row.favourite_colour = "blue";
    }

    const target = fresh();
    const result = importAll(target, backup, clock);
    expect(result.rows.exercise).toBe(2);
    expect(result.columns_skipped).toEqual(["exercise.favourite_colour"]);
  });
});
