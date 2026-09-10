import type { Database } from "better-sqlite3";
import type { Clock } from "./clock.js";
import { isUuidv7 } from "./uuid.js";
import { ValidationError, type MetricType } from "./exercises.js";
import { getProgram } from "./programs.js";

export interface LoggedSet {
  id: string;
  logged_exercise_id: string;
  set_index: number;
  round_index: number;
  logged_at: string;
  skipped: boolean;
  to_failure: boolean;
  weight: number | null;
  reps: number | null;
  duration_s: number | null;
  distance_m: number | null;
  speed: number | null;
}

export interface LoggedExercise {
  id: string;
  block_id: string;
  exercise_id: string;
  exercise_name: string;
  metric_type: MetricType;
  target_sets: number;
  note: string;
  sets: LoggedSet[];
}

export interface SessionBlock {
  id: string;
  type: "single" | "superset";
  exercises: LoggedExercise[];
}

export interface Session {
  id: string;
  program_id: string | null;
  program_name: string | null;
  date: string;
  started_at: string;
  finished_at: string | null;
  status: "active" | "finished";
  notes: string;
  blocks: SessionBlock[];
}

/** Which metric fields a set carries, per the exercise's type. */
export const FIELDS: Record<MetricType, (keyof LoggedSet)[]> = {
  bodyweight: ["reps"],
  bodyweight_plus: ["weight", "reps"],
  dumbbell: ["weight", "reps"],
  total_weight: ["weight", "reps"],
  cardio: ["speed", "duration_s", "distance_m"],
  hold: ["duration_s", "weight"],
};

/**
 * Fields that may be left out entirely.
 *
 * Most holds carry no added weight. Requiring a number there meant a plank
 * could not be logged without typing a zero first — a demand for data that
 * does not exist, dressed up as validation.
 */
const OPTIONAL: Partial<Record<MetricType, Set<keyof LoggedSet>>> = {
  hold: new Set(["weight"]),
};

export interface StartSessionInput {
  id: string;
  program_id?: string | null;
  /** Captured when the program was picked, which may be minutes before the first set. */
  started_at?: string;
  blocks?: {
    id: string;
    type: "single" | "superset";
    exercises: { id: string; exercise_id: string; target_sets: number; note?: string }[];
  }[];
}

/**
 * Create the session row.
 *
 * Called on the *first logged set*, not when a program is picked — a program
 * opened and then abandoned must leave nothing behind. `started_at` therefore
 * arrives from the client, carrying the moment of the pick.
 */
export function startSession(db: Database, input: StartSessionInput, clock: Clock, zone: string): Session {
  if (!isUuidv7(input.id)) throw new ValidationError("id must be a UUIDv7", "id");

  const existing = db
    .prepare("SELECT id FROM session WHERE status = 'active' AND deleted_at IS NULL")
    .get() as { id: string } | undefined;
  if (existing && existing.id !== input.id) {
    throw new ValidationError(
      "a session is already in progress — finish it before starting another",
      "status",
    );
  }

  const now = clock.nowIso();
  const startedAt = input.started_at ?? now;

  // The date is taken once, in local time, from when the session *started*.
  // Deriving it later from a UTC timestamp would move a late-night session to
  // the following day.
  const date = clock.today(zone);

  let blocks = input.blocks ?? [];
  let programName: string | null = null;

  if (input.program_id) {
    const program = getProgram(db, input.program_id);
    if (!program || program.deleted_at) {
      throw new ValidationError("no such program", "program_id");
    }
    programName = program.name;

    // Snapshot the structure. Editing the program later must not rewrite what
    // this session means.
    if (blocks.length === 0) {
      blocks = program.blocks.map((b) => ({
        id: crypto.randomUUID(),
        type: b.type,
        exercises: b.entries.map((e) => ({
          id: crypto.randomUUID(),
          exercise_id: e.exercise_id,
          target_sets: e.target_sets,
          note: lastNoteFor(db, e.exercise_id) ?? "",
        })),
      }));
    }
  }

  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO session
         (id, program_id, program_name, date, started_at, status, notes, created_at, updated_at)
       VALUES (@id, @program_id, @program_name, @date, @started_at, 'active', '', @now, @now)
       ON CONFLICT(id) DO NOTHING`,
    ).run({
      id: input.id,
      program_id: input.program_id ?? null,
      program_name: programName,
      date,
      started_at: startedAt,
      now,
    });

    const already = db
      .prepare("SELECT COUNT(*) AS n FROM session_block WHERE session_id = ?")
      .get(input.id) as { n: number };
    if (already.n > 0) return; // replayed start: structure is already there

    const insBlock = db.prepare(
      "INSERT INTO session_block (id, session_id, position, type, created_at) VALUES (?,?,?,?,?)",
    );
    const insEx = db.prepare(
      `INSERT INTO logged_exercise
         (id, session_id, block_id, position, exercise_id, target_sets, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    );

    blocks.forEach((b, bi) => {
      insBlock.run(b.id, input.id, bi, b.type, now);
      b.exercises.forEach((e, ei) => {
        insEx.run(e.id, input.id, b.id, ei, e.exercise_id, e.target_sets, e.note ?? "", now, now);
      });
    });
  });

  run();
  return getSession(db, input.id)!;
}

/** The note from the last time this exercise was done — a setup detail usually carries over. */
export function lastNoteFor(db: Database, exerciseId: string): string | null {
  const row = db
    .prepare(
      `SELECT le.note FROM logged_exercise le
       JOIN session s ON s.id = le.session_id
       WHERE le.exercise_id = ? AND le.note <> '' AND s.deleted_at IS NULL
       ORDER BY s.started_at DESC LIMIT 1`,
    )
    .get(exerciseId) as { note: string } | undefined;
  return row?.note ?? null;
}

/**
 * What the same set index looked like last time.
 *
 * Same index, not "the most recent set" — after a drop set the last set of the
 * previous session is the lightest one, which is the wrong thing to offer as
 * set 1 today.
 */
export function prefillFor(
  db: Database,
  exerciseId: string,
  setIndex: number,
  excludeSessionId: string,
): Partial<LoggedSet> | null {
  const row = db
    .prepare(
      `SELECT ls.weight, ls.reps, ls.duration_s, ls.distance_m, ls.speed, ls.to_failure
       FROM logged_set ls
       JOIN logged_exercise le ON le.id = ls.logged_exercise_id
       JOIN session s ON s.id = le.session_id
       WHERE le.exercise_id = ? AND ls.set_index = ?
         AND s.id <> ? AND s.deleted_at IS NULL
         AND ls.deleted_at IS NULL AND ls.skipped = 0
       ORDER BY s.started_at DESC, ls.round_index DESC LIMIT 1`,
    )
    .get(exerciseId, setIndex, excludeSessionId) as
    | (Omit<Partial<LoggedSet>, "to_failure"> & { to_failure: number })
    | undefined;

  if (!row) return null;
  return { ...row, to_failure: row.to_failure === 1 };
}

export interface LogSetInput {
  id: string;
  logged_exercise_id: string;
  set_index: number;
  round_index?: number;
  skipped?: boolean;
  to_failure?: boolean;
  weight?: number | null;
  reps?: number | null;
  duration_s?: number | null;
  distance_m?: number | null;
  speed?: number | null;
  logged_at?: string;
  deleted_at?: string | null;
  updated_at?: string;
}

export function logSet(db: Database, input: LogSetInput, clock: Clock): LoggedSet {
  if (!isUuidv7(input.id)) throw new ValidationError("id must be a UUIDv7", "id");

  const owner = db
    .prepare(
      `SELECT le.id, e.metric_type FROM logged_exercise le
       JOIN exercise e ON e.id = le.exercise_id WHERE le.id = ?`,
    )
    .get(input.logged_exercise_id) as { id: string; metric_type: MetricType } | undefined;
  if (!owner) throw new ValidationError("no such logged exercise", "logged_exercise_id");

  if (!Number.isInteger(input.set_index) || input.set_index < 0) {
    throw new ValidationError("set_index must be a non-negative whole number", "set_index");
  }

  const skipped = input.skipped ?? false;
  const allowed = FIELDS[owner.metric_type];

  // A skipped set records that you deliberately did not do it; demanding
  // values for it would be nonsense.
  if (!skipped) {
    const optional = OPTIONAL[owner.metric_type];
    const required = allowed.filter((f) => !optional?.has(f));

    for (const field of allowed) {
      const value = input[field as keyof LogSetInput];
      if (value === null || value === undefined) {
        if (optional?.has(field)) continue;
        throw new ValidationError(
          `${owner.metric_type} sets need ${required.join(" and ")}`,
          field as string,
        );
      }
      if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
        throw new ValidationError(`${field} must be zero or more`, field as string);
      }
    }
    if (allowed.includes("reps") && !Number.isInteger(input.reps)) {
      throw new ValidationError("reps must be a whole number", "reps");
    }
  }

  const now = clock.nowIso();
  const updatedAt = input.updated_at ?? now;

  try {
  db.prepare(
    `INSERT INTO logged_set
       (id, logged_exercise_id, set_index, round_index, logged_at, skipped, to_failure,
        weight, reps, duration_s, distance_m, speed, created_at, updated_at, deleted_at)
     VALUES (@id, @logged_exercise_id, @set_index, @round_index, @logged_at, @skipped,
             @to_failure, @weight, @reps, @duration_s, @distance_m, @speed, @now,
             @updated_at, @deleted_at)
     ON CONFLICT(id) DO UPDATE SET
       set_index = excluded.set_index, round_index = excluded.round_index,
       logged_at = excluded.logged_at, skipped = excluded.skipped,
       to_failure = excluded.to_failure, weight = excluded.weight, reps = excluded.reps,
       duration_s = excluded.duration_s, distance_m = excluded.distance_m,
       speed = excluded.speed, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at
     WHERE excluded.updated_at >= logged_set.updated_at`,
  ).run({
    id: input.id,
    logged_exercise_id: input.logged_exercise_id,
    set_index: input.set_index,
    round_index: input.round_index ?? 0,
    logged_at: input.logged_at ?? now,
    skipped: skipped ? 1 : 0,
    to_failure: input.to_failure ? 1 : 0,
    weight: input.weight ?? null,
    reps: input.reps ?? null,
    duration_s: input.duration_s ?? null,
    distance_m: input.distance_m ?? null,
    speed: input.speed ?? null,
    now,
    updated_at: updatedAt,
    deleted_at: input.deleted_at ?? null,
  });
  } catch (cause) {
    // SQLite names the columns rather than the index in this message.
    const msg = (cause as Error).message;
    if (msg.includes("UNIQUE constraint failed") && msg.includes("logged_set.set_index")) {
      throw new ValidationError(
        `set ${input.set_index + 1} is already logged for this exercise`,
        "set_index",
      );
    }
    throw cause;
  }

  db.prepare("UPDATE session SET updated_at = ? WHERE id = (SELECT session_id FROM logged_exercise WHERE id = ?)")
    .run(now, input.logged_exercise_id);

  return getSet(db, input.id)!;
}

/** SQLite has no boolean: these come back as 0/1 and are converted on read. */
type SetRow = Omit<LoggedSet, "skipped" | "to_failure"> & { skipped: number; to_failure: number };

export function getSet(db: Database, id: string): LoggedSet | null {
  const row = db.prepare("SELECT * FROM logged_set WHERE id = ?").get(id) as SetRow | undefined;
  if (!row) return null;
  return { ...row, skipped: row.skipped === 1, to_failure: row.to_failure === 1 };
}

export function setExerciseNote(db: Database, loggedExerciseId: string, note: string, clock: Clock): void {
  const n = db
    .prepare("UPDATE logged_exercise SET note = ?, updated_at = ? WHERE id = ?")
    .run(note, clock.nowIso(), loggedExerciseId);
  if (n.changes === 0) throw new ValidationError("no such logged exercise", "logged_exercise_id");
}

/**
 * End the session.
 *
 * Duration stays derived from the last logged set — walking to the shower does
 * not count as training. Finishing governs UI state, not the number.
 */
export function finishSession(db: Database, id: string, clock: Clock, notes?: string): Session {
  const s = db.prepare("SELECT id FROM session WHERE id = ?").get(id);
  if (!s) throw new ValidationError("no such session", "id");
  const now = clock.nowIso();
  db.prepare(
    `UPDATE session SET status = 'finished', finished_at = ?, updated_at = ?,
       notes = COALESCE(?, notes) WHERE id = ?`,
  ).run(now, now, notes ?? null, id);
  return getSession(db, id)!;
}

export function activeSession(db: Database): Session | null {
  const row = db
    .prepare("SELECT id FROM session WHERE status = 'active' AND deleted_at IS NULL")
    .get() as { id: string } | undefined;
  return row ? getSession(db, row.id) : null;
}

export function getSession(db: Database, id: string): Session | null {
  const row = db.prepare("SELECT * FROM session WHERE id = ?").get(id) as
    | (Session & { created_at: string; updated_at: string; deleted_at: string | null })
    | undefined;
  if (!row) return null;

  const blocks = db
    .prepare("SELECT id, type FROM session_block WHERE session_id = ? ORDER BY position")
    .all(id) as { id: string; type: "single" | "superset" }[];

  const exercisesFor = db.prepare(
    `SELECT le.id, le.block_id, le.exercise_id, le.target_sets, le.note,
            e.name AS exercise_name, e.metric_type
     FROM logged_exercise le JOIN exercise e ON e.id = le.exercise_id
     WHERE le.block_id = ? ORDER BY le.position`,
  );
  const setsFor = db.prepare(
    `SELECT * FROM logged_set WHERE logged_exercise_id = ? AND deleted_at IS NULL
     ORDER BY round_index, set_index`,
  );

  return {
    id: row.id,
    program_id: row.program_id,
    program_name: row.program_name,
    date: row.date,
    started_at: row.started_at,
    finished_at: row.finished_at,
    status: row.status,
    notes: row.notes,
    blocks: blocks.map((b) => ({
      id: b.id,
      type: b.type,
      exercises: (exercisesFor.all(b.id) as Omit<LoggedExercise, "sets">[]).map((ex) => ({
        ...ex,
        sets: (setsFor.all(ex.id) as SetRow[]).map(
          (s) => ({ ...s, skipped: s.skipped === 1, to_failure: s.to_failure === 1 }),
        ),
      })),
    })),
  };
}

/** Duration = last logged set − start. Nothing accrues after you stop lifting. */
export function sessionDurationSeconds(db: Database, id: string): number | null {
  const row = db
    .prepare(
      `SELECT s.started_at, MAX(ls.logged_at) AS last_set
       FROM session s
       LEFT JOIN logged_exercise le ON le.session_id = s.id
       LEFT JOIN logged_set ls ON ls.logged_exercise_id = le.id AND ls.deleted_at IS NULL
       WHERE s.id = ?`,
    )
    .get(id) as { started_at: string; last_set: string | null } | undefined;
  if (!row?.last_set) return null;
  return Math.max(0, Math.round((Date.parse(row.last_set) - Date.parse(row.started_at)) / 1000));
}

/**
 * The session plus everything needed to render the logging screen, in one
 * request: for each exercise, what the same set index looked like last time.
 * Fetching prefill per row would be a request per set on a phone in a gym.
 */
export interface SessionView extends Session {
  duration_s: number | null;
  prefill: Record<string, (Partial<LoggedSet> | null)[]>;
}

export function getSessionView(db: Database, id: string): SessionView | null {
  const session = getSession(db, id);
  if (!session) return null;

  const prefill: Record<string, (Partial<LoggedSet> | null)[]> = {};
  for (const block of session.blocks) {
    for (const ex of block.exercises) {
      const wanted = Math.max(ex.target_sets, ex.sets.length + 1);
      prefill[ex.id] = Array.from({ length: wanted }, (_, i) =>
        prefillFor(db, ex.exercise_id, i, id),
      );
    }
  }

  return { ...session, duration_s: sessionDurationSeconds(db, id), prefill };
}

/** Correcting a mistake: hide the set without destroying the row. */
export function deleteSet(db: Database, id: string, clock: Clock): void {
  const n = db
    .prepare("UPDATE logged_set SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .run(clock.nowIso(), clock.nowIso(), id);
  if (n.changes === 0) throw new ValidationError("no such set", "id");
}

export interface SessionSummary {
  id: string;
  program_id: string | null;
  program_name: string | null;
  date: string;
  started_at: string;
  finished_at: string | null;
  status: "active" | "finished";
  notes: string;
  /** Sets actually done. A skipped set records a decision, not work. */
  set_count: number;
  exercise_count: number;
  duration_s: number | null;
}

export interface ListSessionsOptions {
  program_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * The history list.
 *
 * Counts and duration are computed in SQL rather than by loading each session:
 * the list is the one screen that touches every session ever logged.
 */
export function listSessions(db: Database, opts: ListSessionsOptions = {}): SessionSummary[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.program_id, s.program_name, s.date, s.started_at, s.finished_at,
              s.status, s.notes,
              COUNT(ls.id) AS set_count,
              COUNT(DISTINCT CASE WHEN ls.id IS NOT NULL THEN le.id END) AS exercise_count,
              MAX(ls.logged_at) AS last_set
       FROM session s
       LEFT JOIN logged_exercise le ON le.session_id = s.id
       LEFT JOIN logged_set ls ON ls.logged_exercise_id = le.id
            AND ls.deleted_at IS NULL AND ls.skipped = 0
       WHERE s.deleted_at IS NULL
         AND (@program_id IS NULL OR s.program_id = @program_id)
       GROUP BY s.id
       ORDER BY s.date DESC, s.started_at DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({
      program_id: opts.program_id ?? null,
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
    }) as (Omit<SessionSummary, "duration_s"> & { last_set: string | null })[];

  return rows.map(({ last_set, ...row }) => ({
    ...row,
    duration_s: last_set
      ? Math.max(0, Math.round((Date.parse(last_set) - Date.parse(row.started_at)) / 1000))
      : null,
  }));
}

export interface SessionPatch {
  notes?: string;
  /** A session logged on the wrong day. Local calendar date, `YYYY-MM-DD`. */
  date?: string;
}

export function updateSession(db: Database, id: string, patch: SessionPatch, clock: Clock): Session {
  const existing = db.prepare("SELECT id FROM session WHERE id = ?").get(id);
  if (!existing) throw new ValidationError("no such session", "id");

  if (patch.date !== undefined) {
    // Stored as a plain string, so nothing else will catch a malformed one.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date) || Number.isNaN(Date.parse(patch.date))) {
      throw new ValidationError("date must look like 2026-03-01", "date");
    }
  }

  const now = clock.nowIso();
  db.prepare(
    `UPDATE session SET
       notes = COALESCE(@notes, notes),
       date  = COALESCE(@date, date),
       updated_at = @now
     WHERE id = @id`,
  ).run({ id, notes: patch.notes ?? null, date: patch.date ?? null, now });

  return getSession(db, id)!;
}

/**
 * Soft-delete a whole session.
 *
 * The sets stay in the table and in exports. Deleting the *active* session is
 * how you abandon a workout you started by mistake: the partial unique index
 * ignores deleted rows, so the slot is free immediately.
 */
export function deleteSession(db: Database, id: string, clock: Clock): void {
  const now = clock.nowIso();
  const n = db
    .prepare("UPDATE session SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .run(now, now, id);
  if (n.changes === 0) throw new ValidationError("no such session", "id");
}
