import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { openDb } from "../src/data/db.js";
import { fixedClock, type Clock } from "../src/data/clock.js";
import { uuidv7 } from "../src/data/uuid.js";
import { ValidationError } from "../src/data/exercises.js";
import {
  listMetricTypes, upsertMetricType, archiveMetricType, deleteMetricType,
  upsertEntry, deleteEntry, listEntries, latestEntry, metricSeries,
} from "../src/data/body.js";

const MIGRATIONS = new URL("../migrations", import.meta.url).pathname;
const at = (iso: string): Clock => fixedClock(iso);
const clock = at("2026-03-01T07:30:00Z");

let db: Database;
let weight: string;

beforeEach(() => {
  db = openDb({ file: ":memory:", migrationsDir: MIGRATIONS });
  weight = uuidv7();
  upsertMetricType(db, { id: weight, name: "Weight", unit: "kg" }, clock);
});

const reading = (value: number, iso: string, id = uuidv7()) =>
  upsertEntry(db, { id, type_id: weight, value, measured_at: iso }, at(iso));

describe("metric types", () => {
  it("starts with nothing — the app does not assume what you track", () => {
    const fresh = openDb({ file: ":memory:", migrationsDir: MIGRATIONS });
    expect(listMetricTypes(fresh)).toEqual([]);
  });

  it("carries its own name and unit", () => {
    const [t] = listMetricTypes(db);
    expect([t!.name, t!.unit]).toEqual(["Weight", "kg"]);
  });

  it("refuses a second metric with the same name", () => {
    expect(() => upsertMetricType(db, { id: uuidv7(), name: "weight", unit: "lb" }, clock))
      .toThrow(ValidationError);
  });

  it("refuses a metric with no unit, because the number would mean nothing", () => {
    expect(() => upsertMetricType(db, { id: uuidv7(), name: "Waist", unit: "  " }, clock))
      .toThrow(ValidationError);
  });

  it("renames without touching the readings", () => {
    reading(84.2, "2026-03-01T07:30:00Z");
    upsertMetricType(db, { id: weight, name: "Bodyweight", unit: "kg" },
      at("2026-04-01T07:30:00Z"));
    expect(listMetricTypes(db)[0]!.name).toBe("Bodyweight");
    expect(listEntries(db, weight)).toHaveLength(1);
  });

  it("replays an identical upsert as a no-op, and a stale one loses", () => {
    upsertMetricType(db, { id: weight, name: "Weight", unit: "kg" }, clock);
    expect(listMetricTypes(db)).toHaveLength(1);

    upsertMetricType(db, { id: weight, name: "Stale", unit: "kg" },
      at("2020-01-01T00:00:00Z"));
    expect(listMetricTypes(db)[0]!.name).toBe("Weight");
  });

  it("hides an archived metric from the default list but keeps it findable", () => {
    archiveMetricType(db, weight, at("2026-04-01T07:30:00Z"));
    expect(listMetricTypes(db)).toEqual([]);
    expect(listMetricTypes(db, "all")).toHaveLength(1);
  });
});

describe("readings", () => {
  it("comes back newest first, because that is what you just looked at", () => {
    reading(85.0, "2026-01-10T07:30:00Z");
    reading(84.2, "2026-03-01T07:30:00Z");
    reading(84.6, "2026-02-05T07:30:00Z");

    expect(listEntries(db, weight).map((e) => e.value)).toEqual([84.2, 84.6, 85.0]);
  });

  it("takes two readings on the same day, which is the point of a timestamp", () => {
    reading(85.1, "2026-03-01T06:00:00Z");
    reading(84.4, "2026-03-01T20:00:00Z");
    expect(listEntries(db, weight)).toHaveLength(2);
  });

  it("knows the latest, for the strip and for prefill", () => {
    reading(85.0, "2026-01-10T07:30:00Z");
    reading(84.2, "2026-03-01T07:30:00Z");
    expect(latestEntry(db, weight)?.value).toBe(84.2);
  });

  it("has no latest before anything is logged", () => {
    expect(latestEntry(db, weight)).toBeNull();
  });

  it("is idempotent on replay, and a stale replay loses", () => {
    const id = uuidv7();
    reading(84.2, "2026-03-01T07:30:00Z", id);
    reading(84.2, "2026-03-01T07:30:00Z", id);
    expect(listEntries(db, weight)).toHaveLength(1);

    upsertEntry(db, { id, type_id: weight, value: 99, measured_at: "2026-03-01T07:30:00Z" },
      at("2020-01-01T00:00:00Z"));
    expect(listEntries(db, weight)[0]!.value).toBe(84.2);
  });

  it("corrects a reading in place", () => {
    const id = uuidv7();
    reading(48.2, "2026-03-01T07:30:00Z", id);
    upsertEntry(db, { id, type_id: weight, value: 84.2, measured_at: "2026-03-01T07:30:00Z" },
      at("2026-03-02T07:30:00Z"));
    expect(listEntries(db, weight)[0]!.value).toBe(84.2);
  });

  it("refuses a reading that is not a number, or is negative", () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(() => upsertEntry(db, { id: uuidv7(), type_id: weight, value: bad,
        measured_at: "2026-03-01T07:30:00Z" }, clock), String(bad)).toThrow(ValidationError);
    }
  });

  it("refuses a reading against a metric that does not exist", () => {
    expect(() => upsertEntry(db, { id: uuidv7(), type_id: uuidv7(), value: 84,
      measured_at: "2026-03-01T07:30:00Z" }, clock)).toThrow(ValidationError);
  });

  it("soft-deletes: gone from the list, still in the database", () => {
    const id = uuidv7();
    reading(84.2, "2026-03-01T07:30:00Z", id);
    deleteEntry(db, id, at("2026-03-02T07:30:00Z"));

    expect(listEntries(db, weight)).toEqual([]);
    const row = db.prepare("SELECT value FROM body_metric_entry WHERE id = ?").get(id);
    expect(row).toBeTruthy();
  });
});

describe("the chart series", () => {
  it("comes back oldest first, so the line reads left to right", () => {
    reading(85.0, "2026-01-10T07:30:00Z");
    reading(84.2, "2026-03-01T07:30:00Z");
    reading(84.6, "2026-02-05T07:30:00Z");

    const s = metricSeries(db, weight);
    expect(s.points.map((p) => p.values.value)).toEqual([85.0, 84.6, 84.2]);
    expect(s.name).toBe("Weight");
    expect(s.unit).toBe("kg");
  });

  it("carries a full timestamp, so two readings in a day are two points", () => {
    reading(85.1, "2026-03-01T06:00:00Z");
    reading(84.4, "2026-03-01T20:00:00Z");
    const s = metricSeries(db, weight);
    expect(s.points).toHaveLength(2);
    expect(s.points[0]!.at).not.toBe(s.points[1]!.at);
  });

  it("clips to a range", () => {
    for (const d of ["2026-01-10", "2026-02-05", "2026-03-01"]) reading(84, `${d}T07:30:00Z`);
    expect(metricSeries(db, weight, { from: "2026-02-01" }).points).toHaveLength(2);
    expect(metricSeries(db, weight, { to: "2026-02-28" }).points).toHaveLength(2);
  });

  it("leaves out a deleted reading", () => {
    const id = uuidv7();
    reading(84.2, "2026-03-01T07:30:00Z", id);
    reading(84.6, "2026-02-05T07:30:00Z");
    deleteEntry(db, id, at("2026-03-02T07:30:00Z"));
    expect(metricSeries(db, weight).points).toHaveLength(1);
  });

  it("comes back empty, not broken, for a metric never logged", () => {
    expect(metricSeries(db, weight).points).toEqual([]);
  });

  it("gives the chart two endpoints to draw the trend between", () => {
    reading(86, "2026-01-10T07:30:00Z");
    reading(84, "2026-03-01T07:30:00Z");
    const s = metricSeries(db, weight);
    expect(s.trend_ends).not.toBeNull();
    expect(s.trend_ends!.from).toBeGreaterThan(s.trend_ends!.to);
  });

  it("draws no trend through a single reading", () => {
    reading(84, "2026-03-01T07:30:00Z");
    expect(metricSeries(db, weight).trend_ends).toBeNull();
  });

  it("survives readings months apart — the whole point of weighing rarely", () => {
    reading(88, "2025-09-01T07:30:00Z");
    reading(86, "2026-01-15T07:30:00Z");
    reading(84, "2026-06-01T07:30:00Z");
    const s = metricSeries(db, weight);
    expect(s.points).toHaveLength(3);
    // Fitted against calendar days, so a five-month gap is a five-month gap.
    expect(s.trend!.slope_per_day).toBeLessThan(0);
  });
});

describe("deleting a metric", () => {
  it("takes its readings out of the list, but not out of the database", () => {
    reading(84.2, "2026-03-01T07:30:00Z");
    deleteMetricType(db, weight, at("2026-04-01T07:30:00Z"));

    expect(listMetricTypes(db, "all")).toEqual([]);
    // The rows survive, so an export still carries them.
    const n = db.prepare("SELECT COUNT(*) AS n FROM body_metric_entry").get() as { n: number };
    expect(n.n).toBe(1);
  });

  it("frees the name for reuse", () => {
    deleteMetricType(db, weight, at("2026-04-01T07:30:00Z"));
    expect(() => upsertMetricType(db, { id: uuidv7(), name: "Weight", unit: "kg" },
      at("2026-04-02T07:30:00Z"))).not.toThrow();
  });
});
