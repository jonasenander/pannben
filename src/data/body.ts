import type { Database } from "better-sqlite3";
import type { Clock } from "./clock.js";
import { isUuidv7 } from "./uuid.js";
import { ValidationError, type Include } from "./exercises.js";
import { trendLine, type Trend, type SeriesOptions } from "./stats.js";

/**
 * Body metrics: weight, waist, resting heart rate — whatever gets tracked.
 *
 * A type carries the name and the unit; a reading carries only a number and
 * when it was taken. That split is why renaming a metric cannot rewrite its
 * history, and why a reading can never disagree with its own unit.
 *
 * Nothing is seeded. An app that assumes what you track is an app that ends up
 * nagging about it.
 */

export interface MetricType {
  id: string;
  name: string;
  unit: string;
  position: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export interface MetricTypeInput {
  id: string;
  name: string;
  unit: string;
  position?: number;
  archived_at?: string | null;
  deleted_at?: string | null;
  updated_at?: string;
}

export function listMetricTypes(db: Database, include: Include = "active"): MetricType[] {
  const where =
    include === "active"
      ? "deleted_at IS NULL AND archived_at IS NULL"
      : include === "archived"
        ? "deleted_at IS NULL AND archived_at IS NOT NULL"
        : "deleted_at IS NULL";
  return db
    .prepare(`SELECT * FROM body_metric_type WHERE ${where} ORDER BY position, lower(name)`)
    .all() as MetricType[];
}

export function getMetricType(db: Database, id: string): MetricType | null {
  return (db.prepare("SELECT * FROM body_metric_type WHERE id = ?").get(id) as MetricType) ?? null;
}

/**
 * One write verb, as everywhere else: create, rename, archive and delete are
 * all field changes on the same row, so every one of them is idempotent.
 */
export function upsertMetricType(db: Database, input: MetricTypeInput, clock: Clock): MetricType {
  if (!isUuidv7(input.id)) throw new ValidationError("id must be a UUIDv7", "id");

  const name = input.name?.trim() ?? "";
  if (name === "") throw new ValidationError("a metric needs a name", "name");

  // Without a unit the stored number means nothing, and no chart axis can
  // honestly label itself.
  const unit = input.unit?.trim() ?? "";
  if (unit === "") throw new ValidationError("a metric needs a unit, such as kg or cm", "unit");

  const clash = db
    .prepare(
      `SELECT id FROM body_metric_type
       WHERE lower(name) = lower(?) AND deleted_at IS NULL AND id <> ?`,
    )
    .get(name, input.id);
  if (clash) throw new ValidationError(`there is already a metric called ${name}`, "name");

  const now = clock.nowIso();
  db.prepare(
    `INSERT INTO body_metric_type
       (id, name, unit, position, created_at, updated_at, archived_at, deleted_at)
     VALUES (@id, @name, @unit, @position, @now, @updated_at, @archived_at, @deleted_at)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, unit = excluded.unit, position = excluded.position,
       updated_at = excluded.updated_at, archived_at = excluded.archived_at,
       deleted_at = excluded.deleted_at
     WHERE excluded.updated_at >= body_metric_type.updated_at`,
  ).run({
    id: input.id,
    name,
    unit,
    position: input.position ?? nextPosition(db),
    now,
    updated_at: input.updated_at ?? now,
    archived_at: input.archived_at ?? null,
    deleted_at: input.deleted_at ?? null,
  });

  return getMetricType(db, input.id)!;
}

function nextPosition(db: Database): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM body_metric_type")
    .get() as { n: number };
  return row.n;
}

const setFlag = (
  db: Database,
  id: string,
  column: "archived_at" | "deleted_at",
  value: string | null,
  clock: Clock,
): MetricType => {
  const now = clock.nowIso();
  const n = db
    .prepare(`UPDATE body_metric_type SET ${column} = ?, updated_at = ? WHERE id = ?`)
    .run(value, now, id);
  if (n.changes === 0) throw new ValidationError("no such metric", "id");
  return getMetricType(db, id)!;
};

/** Hidden from the strips, kept in history and charts. */
export const archiveMetricType = (db: Database, id: string, clock: Clock) =>
  setFlag(db, id, "archived_at", clock.nowIso(), clock);

export const unarchiveMetricType = (db: Database, id: string, clock: Clock) =>
  setFlag(db, id, "archived_at", null, clock);

/**
 * Soft, like everything else. The readings stay in the table and in every
 * export; they simply stop being reachable, and the name frees up.
 */
export const deleteMetricType = (db: Database, id: string, clock: Clock) =>
  setFlag(db, id, "deleted_at", clock.nowIso(), clock);

// ------------------------------------------------------------------ readings

export interface MetricEntry {
  id: string;
  type_id: string;
  measured_at: string;
  value: number;
  note: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MetricEntryInput {
  id: string;
  type_id: string;
  value: number;
  measured_at?: string;
  note?: string;
  deleted_at?: string | null;
  updated_at?: string;
}

/**
 * Log or correct a reading.
 *
 * Goes through the outbox on the client, like a set: a weigh-in is a quick
 * write that may happen with no signal, and correcting one is the same write
 * carrying the id it already has.
 */
export function upsertEntry(db: Database, input: MetricEntryInput, clock: Clock): MetricEntry {
  if (!isUuidv7(input.id)) throw new ValidationError("id must be a UUIDv7", "id");

  const type = db
    .prepare("SELECT id FROM body_metric_type WHERE id = ? AND deleted_at IS NULL")
    .get(input.type_id);
  if (!type) throw new ValidationError("no such metric", "type_id");

  if (typeof input.value !== "number" || !Number.isFinite(input.value) || input.value < 0) {
    throw new ValidationError("a reading must be zero or more", "value");
  }

  const now = clock.nowIso();
  db.prepare(
    `INSERT INTO body_metric_entry
       (id, type_id, measured_at, value, note, created_at, updated_at, deleted_at)
     VALUES (@id, @type_id, @measured_at, @value, @note, @now, @updated_at, @deleted_at)
     ON CONFLICT(id) DO UPDATE SET
       type_id = excluded.type_id, measured_at = excluded.measured_at,
       value = excluded.value, note = excluded.note,
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
     WHERE excluded.updated_at >= body_metric_entry.updated_at`,
  ).run({
    id: input.id,
    type_id: input.type_id,
    measured_at: input.measured_at ?? now,
    value: input.value,
    note: input.note ?? "",
    now,
    updated_at: input.updated_at ?? now,
    deleted_at: input.deleted_at ?? null,
  });

  return getEntry(db, input.id)!;
}

export function getEntry(db: Database, id: string): MetricEntry | null {
  return (db.prepare("SELECT * FROM body_metric_entry WHERE id = ?").get(id) as MetricEntry) ?? null;
}

export function deleteEntry(db: Database, id: string, clock: Clock): void {
  const now = clock.nowIso();
  const n = db
    .prepare("UPDATE body_metric_entry SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, id);
  if (n.changes === 0) throw new ValidationError("no such reading", "id");
}

/** Newest first: the reading you just took is the one you want to see. */
export function listEntries(db: Database, typeId: string, limit = 200): MetricEntry[] {
  return db
    .prepare(
      `SELECT * FROM body_metric_entry
       WHERE type_id = ? AND deleted_at IS NULL
       ORDER BY measured_at DESC LIMIT ?`,
    )
    .all(typeId, limit) as MetricEntry[];
}

/** The number on the strip, and what the next entry prefills with. */
export function latestEntry(db: Database, typeId: string): MetricEntry | null {
  return (
    (db
      .prepare(
        `SELECT * FROM body_metric_entry
         WHERE type_id = ? AND deleted_at IS NULL
         ORDER BY measured_at DESC LIMIT 1`,
      )
      .get(typeId) as MetricEntry) ?? null
  );
}

// -------------------------------------------------------------------- charts

export interface MetricPoint {
  entry_id: string;
  /** Local date, for the axis label. */
  date: string;
  /** Full timestamp, so two readings on one day are two points, not one. */
  at: string;
  values: Record<string, number | null>;
}

export interface MetricSeries {
  type_id: string;
  name: string;
  unit: string;
  points: MetricPoint[];
  trend: Trend | null;
  /**
   * The trend as its two endpoints. The chart draws a line between two points;
   * evaluating here keeps the fitting maths out of the client, exactly as the
   * exercise chart route already does.
   */
  trend_ends: { from: number; to: number } | null;
  latest: number | null;
  change: number | null;
}

/**
 * The series a chart plots, oldest first.
 *
 * `trendLine` is the same one the exercise charts use, and for the same
 * reason it matters more here: it fits against calendar days rather than point
 * index, so six weigh-ins spread across a year are not treated as six
 * consecutive days.
 */
export function metricSeries(
  db: Database,
  typeId: string,
  opts: SeriesOptions = {},
): MetricSeries {
  const type = getMetricType(db, typeId);
  if (!type) throw new ValidationError("no such metric", "id");

  const rows = db
    .prepare(
      `SELECT id, measured_at, value FROM body_metric_entry
       WHERE type_id = @id AND deleted_at IS NULL
         AND (@from IS NULL OR substr(measured_at, 1, 10) >= @from)
         AND (@to IS NULL OR substr(measured_at, 1, 10) <= @to)
       ORDER BY measured_at`,
    )
    .all({ id: typeId, from: opts.from ?? null, to: opts.to ?? null }) as {
    id: string;
    measured_at: string;
    value: number;
  }[];

  const points: MetricPoint[] = rows.map((r) => ({
    entry_id: r.id,
    date: r.measured_at.slice(0, 10),
    at: r.measured_at,
    values: { value: r.value },
  }));

  const trend = trendLine(points.map((p) => ({ date: p.date, value: p.values.value ?? null })));

  return {
    type_id: type.id,
    name: type.name,
    unit: type.unit,
    points,
    trend,
    trend_ends:
      trend && points.length >= 2
        ? { from: trend.at(points[0]!.date), to: trend.at(points.at(-1)!.date) }
        : null,
    latest: points.at(-1)?.values.value ?? null,
    change: trend ? Math.round(trend.change * 100) / 100 : null,
  };
}
