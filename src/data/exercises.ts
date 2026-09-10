import type { Database } from "better-sqlite3";
import type { Clock } from "./clock.js";
import { isUuidv7 } from "./uuid.js";

export const METRIC_TYPES = [
  "bodyweight",
  "bodyweight_plus",
  "dumbbell",
  "total_weight",
  "cardio",
  "hold",
] as const;

export type MetricType = (typeof METRIC_TYPES)[number];

export interface Exercise {
  id: string;
  name: string;
  metric_type: MetricType;
  notes: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export interface ExerciseInput {
  id: string;
  name: string;
  metric_type: MetricType;
  notes?: string;
  archived_at?: string | null;
  deleted_at?: string | null;
  /** Set by the client when the edit happened; drives last-write-wins. */
  updated_at?: string;
}

/** Thrown for input the caller can fix. Never swallowed, never logged-and-ignored. */
export class ValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export type Include = "active" | "archived" | "all";

const COLUMNS = `id, name, metric_type, notes, created_at, updated_at, archived_at, deleted_at`;

export function listExercises(db: Database, include: Include = "active"): Exercise[] {
  const where =
    include === "active"
      ? "deleted_at IS NULL AND archived_at IS NULL"
      : include === "archived"
        ? "deleted_at IS NULL AND archived_at IS NOT NULL"
        : "deleted_at IS NULL";

  return db
    .prepare(`SELECT ${COLUMNS} FROM exercise WHERE ${where} ORDER BY name COLLATE NOCASE`)
    .all() as Exercise[];
}

export function getExercise(db: Database, id: string): Exercise | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM exercise WHERE id = ?`).get(id);
  return (row as Exercise | undefined) ?? null;
}

function validate(input: ExerciseInput): { name: string; notes: string } {
  if (!isUuidv7(input.id)) {
    throw new ValidationError("id must be a UUIDv7 minted by the client", "id");
  }

  const name = (input.name ?? "").trim();
  if (name.length === 0) throw new ValidationError("name is required", "name");
  if (name.length > 120) throw new ValidationError("name is longer than 120 characters", "name");

  if (!METRIC_TYPES.includes(input.metric_type)) {
    throw new ValidationError(
      `metric_type must be one of: ${METRIC_TYPES.join(", ")}`,
      "metric_type",
    );
  }

  return { name, notes: (input.notes ?? "").trim() };
}

/**
 * Create or update, keyed by the client-minted id.
 *
 * Idempotent by construction: replaying the outbox re-sends the same id with
 * the same `updated_at`, and the guard below turns that into a no-op. A replay
 * that arrives after a newer edit loses rather than resurrecting stale values.
 */
export function upsertExercise(db: Database, input: ExerciseInput, clock: Clock): Exercise {
  const { name, notes } = validate(input);
  const now = clock.nowIso();
  const updatedAt = input.updated_at ?? now;

  try {
    db.prepare(
      `INSERT INTO exercise (id, name, metric_type, notes, created_at, updated_at, archived_at, deleted_at)
       VALUES (@id, @name, @metric_type, @notes, @now, @updated_at, @archived_at, @deleted_at)
       ON CONFLICT(id) DO UPDATE SET
         name        = excluded.name,
         metric_type = excluded.metric_type,
         notes       = excluded.notes,
         updated_at  = excluded.updated_at,
         archived_at = excluded.archived_at,
         deleted_at  = excluded.deleted_at
       WHERE excluded.updated_at >= exercise.updated_at`,
    ).run({
      id: input.id,
      name,
      metric_type: input.metric_type,
      notes,
      now,
      updated_at: updatedAt,
      archived_at: input.archived_at ?? null,
      deleted_at: input.deleted_at ?? null,
    });
  } catch (cause) {
    const message = (cause as Error).message;
    if (message.includes("exercise_name_unique")) {
      throw new ConflictError(`another exercise is already called "${name}"`);
    }
    throw cause;
  }

  const saved = getExercise(db, input.id);
  if (!saved) throw new Error(`exercise ${input.id} vanished immediately after write`);
  return saved;
}

/** Legacy but real: hidden from pickers, kept in history and charts. */
export function archiveExercise(db: Database, id: string, clock: Clock): Exercise {
  return setFlag(db, id, "archived_at", clock.nowIso(), clock);
}

export function unarchiveExercise(db: Database, id: string, clock: Clock): Exercise {
  return setFlag(db, id, "archived_at", null, clock);
}

/** A mistake: hidden everywhere including charts, but still in the database. */
export function deleteExercise(db: Database, id: string, clock: Clock): Exercise {
  return setFlag(db, id, "deleted_at", clock.nowIso(), clock);
}

function setFlag(
  db: Database,
  id: string,
  column: "archived_at" | "deleted_at",
  value: string | null,
  clock: Clock,
): Exercise {
  const existing = getExercise(db, id);
  if (!existing) throw new ValidationError(`no exercise with id ${id}`, "id");

  db.prepare(`UPDATE exercise SET ${column} = ?, updated_at = ? WHERE id = ?`).run(
    value,
    clock.nowIso(),
    id,
  );
  return getExercise(db, id)!;
}

export function countExercises(db: Database): { active: number; archived: number; deleted: number } {
  const row = db
    .prepare(
      `SELECT
         SUM(deleted_at IS NULL AND archived_at IS NULL) AS active,
         SUM(deleted_at IS NULL AND archived_at IS NOT NULL) AS archived,
         SUM(deleted_at IS NOT NULL) AS deleted
       FROM exercise`,
    )
    .get() as { active: number | null; archived: number | null; deleted: number | null };

  return { active: row.active ?? 0, archived: row.archived ?? 0, deleted: row.deleted ?? 0 };
}
