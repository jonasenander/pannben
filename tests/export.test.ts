import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { openDb } from "../src/data/db.js";
import { fixedClock } from "../src/data/clock.js";
import { uuidv7 } from "../src/data/uuid.js";
import { upsertExercise, deleteExercise, archiveExercise } from "../src/data/exercises.js";
import { exportAll, exportSummary } from "../src/data/export.js";

const MIGRATIONS = new URL("../migrations", import.meta.url).pathname;
const clock = fixedClock("2026-09-10T07:00:00Z");

let db: Database;
beforeEach(() => {
  db = openDb({ file: ":memory:", migrationsDir: MIGRATIONS });
});

describe("exportAll", () => {
  it("stamps the format, schema version and time", () => {
    const out = exportAll(db, clock);
    expect(out.format).toBe("pannben-export");
    expect(out.schema_version).toBeGreaterThan(0);
    expect(out.exported_at).toBe("2026-09-10T07:00:00.000Z");
  });

  it("says \"unknown\" rather than inventing a version when none is passed", () => {
    // The number in an export has to come from the running app. A default that
    // is itself a version number goes stale silently, which is how /api/health
    // reported 0.1.0 for four phases after it stopped being true.
    expect(exportAll(db, clock).app_version).toBe("unknown");
    expect(exportAll(db, clock, "1.0.0").app_version).toBe("1.0.0");
  });

  it("discovers tables instead of listing them, so new ones are covered", () => {
    const names = Object.keys(exportAll(db, clock).tables);
    expect(names).toContain("exercise");
    expect(names).toContain("schema_migrations");
    expect(names).toContain("app_meta");
  });

  it("includes archived and soft-deleted rows - it is a backup, not a view", () => {
    const keep = upsertExercise(db, { id: uuidv7(), name: "Keep", metric_type: "cardio" }, clock);
    const gone = upsertExercise(db, { id: uuidv7(), name: "Gone", metric_type: "cardio" }, clock);
    const old = upsertExercise(db, { id: uuidv7(), name: "Old", metric_type: "cardio" }, clock);
    deleteExercise(db, gone.id, clock);
    archiveExercise(db, old.id, clock);

    const rows = exportAll(db, clock).tables.exercise as { id: string }[];
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(keep.id);
    expect(ids).toContain(gone.id);
    expect(ids).toContain(old.id);
    expect(rows).toHaveLength(3);
  });

  it("round-trips through JSON without loss", () => {
    upsertExercise(db, { id: uuidv7(), name: "Bänkpress", metric_type: "total_weight",
                         notes: 'Quote " and backslash \\ and åäö' }, clock);
    const out = exportAll(db, clock);
    const parsed = JSON.parse(JSON.stringify(out));
    expect(parsed).toEqual(out);
    expect((parsed.tables.exercise as any[])[0].notes).toContain("åäö");
  });

  it("exports an empty table as an empty array, not a missing key", () => {
    expect(exportAll(db, clock).tables.exercise).toEqual([]);
  });
});

describe("exportSummary", () => {
  it("counts rows per table", () => {
    upsertExercise(db, { id: uuidv7(), name: "A", metric_type: "cardio" }, clock);
    upsertExercise(db, { id: uuidv7(), name: "B", metric_type: "cardio" }, clock);
    const s = exportSummary(db);
    expect(s.exercise).toBe(2);
    expect(s.schema_migrations).toBeGreaterThan(0);
  });
});
