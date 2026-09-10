import { cacheGet, cachePut } from "./idb.js";
import { enqueue } from "./outbox.js";
// The parsing rules are shared with the server rather than reimplemented here:
// numeric.ts imports nothing, so the client runs the same code the data
// layer's tests already cover.
import { parseDecimal, parseCount, formatDecimal } from "../../data/numeric.js";

export { parseDecimal };

export type MetricType =
  | "bodyweight" | "bodyweight_plus" | "dumbbell"
  | "total_weight" | "cardio" | "hold";

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

export interface ExerciseList {
  exercises: Exercise[];
  counts: { active: number; archived: number; deleted: number };
}

export const METRIC_LABELS: Record<MetricType, string> = {
  total_weight: "Total weight",
  dumbbell: "Dumbbell",
  bodyweight: "Bodyweight",
  bodyweight_plus: "BW + load",
  cardio: "Cardio",
  hold: "Hold",
};

export const METRIC_FIELDS: Record<MetricType, string> = {
  total_weight: "Weight, reps. Volume is weight × reps.",
  dumbbell: "Weight per hand, reps. Volume is weight × 2 × reps.",
  bodyweight: "Reps only. Progress is total reps.",
  bodyweight_plus: "Added weight, reps.",
  cardio: "Speed, duration, distance.",
  hold: "Duration, and added weight if you use any.",
};

export type Include = "active" | "archived" | "all";

/**
 * Read the list, preferring the network but falling back to the last good
 * response. An empty screen when the server is unreachable reads as "your data
 * is gone", which is the wrong thing to tell someone mid-workout.
 */
export async function fetchExercises(
  include: Include,
): Promise<{ data: ExerciseList; stale: boolean }> {
  const key = `exercises:${include}`;
  try {
    const res = await fetch(`/api/exercises?include=${include}`);
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const data = (await res.json()) as ExerciseList;
    await cachePut(key, data);
    return { data, stale: false };
  } catch (err) {
    const cached = await cacheGet<ExerciseList>(key);
    if (cached) return { data: cached, stale: true };
    throw err;
  }
}

/**
 * One write verb for every change. Archive, unarchive, rename and delete are
 * all field edits on the same row, which keeps the queued write coalescible
 * and the replay idempotent.
 */
export async function saveExercise(exercise: Exercise): Promise<void> {
  const body = { ...exercise, updated_at: new Date().toISOString() };
  await enqueue("PUT", `/api/exercises/${exercise.id}`, body);
}

// ---------------------------------------------------------------- programs

export type BlockType = "single" | "superset";

export interface ProgramEntry {
  id: string;
  exercise_id: string;
  target_sets: number;
  exercise_name?: string;
  metric_type?: MetricType;
}

export interface ProgramBlock {
  id: string;
  type: BlockType;
  entries: ProgramEntry[];
}

export interface Program {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  blocks: ProgramBlock[];
}

export interface ProgramSummary {
  id: string;
  name: string;
  archived_at: string | null;
  blocks: number;
  planned_sets: number;
}

export async function fetchPrograms(
  include: Include,
): Promise<{ data: ProgramSummary[]; stale: boolean }> {
  const key = `programs:${include}`;
  try {
    const res = await fetch(`/api/programs?include=${include}`);
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const { programs } = (await res.json()) as { programs: ProgramSummary[] };
    await cachePut(key, programs);
    return { data: programs, stale: false };
  } catch (err) {
    const cached = await cacheGet<ProgramSummary[]>(key);
    if (cached) return { data: cached, stale: true };
    throw err;
  }
}

/**
 * Saved as one document. Reordering touches every position at once, so a
 * whole-tree write keeps it atomic and leaves a single queued entry.
 *
 * Structural saves go straight to the server rather than through the outbox:
 * the server validates the shape (a single block holds one exercise, a superset
 * needs two), and a rejection has to reach the person while the editor is still
 * open and fixable — not surface later as a dismissed banner.
 */
export async function saveProgram(program: Program): Promise<Program> {
  const body = { ...program, updated_at: new Date().toISOString() };
  const res = await fetch(`/api/programs/${program.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `server returned ${res.status}`);
  }
  return (await res.json()) as Program;
}

// ---------------------------------------------------------------- sessions

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
  type: BlockType;
  exercises: LoggedExercise[];
}

export interface SessionView {
  id: string;
  program_id: string | null;
  program_name: string | null;
  date: string;
  started_at: string;
  finished_at: string | null;
  status: "active" | "finished";
  notes: string;
  duration_s: number | null;
  blocks: SessionBlock[];
  prefill: Record<string, (Partial<LoggedSet> | null)[]>;
}

/** Which inputs a set shows, and how each one behaves. */
export interface FieldSpec {
  key: "weight" | "reps" | "duration_s" | "distance_m" | "speed";
  label: string;
  /** Steppers for small whole numbers; everything else is tap-to-type. */
  kind: "stepper" | "type";
  step?: number;
  /** Shown as an input, but left off a logged row when it is zero. */
  optional?: true;
  /** Fractions are refused before the write is queued, not after. */
  integer?: true;
}

export const METRIC_SET_FIELDS: Record<MetricType, FieldSpec[]> = {
  total_weight: [
    { key: "weight", label: "kg", kind: "type" },
    { key: "reps", label: "reps", kind: "stepper", step: 1, integer: true },
  ],
  dumbbell: [
    { key: "weight", label: "kg ea", kind: "type" },
    { key: "reps", label: "reps", kind: "stepper", step: 1, integer: true },
  ],
  bodyweight_plus: [
    { key: "weight", label: "+kg", kind: "type" },
    { key: "reps", label: "reps", kind: "stepper", step: 1, integer: true },
  ],
  bodyweight: [{ key: "reps", label: "reps", kind: "stepper", step: 1, integer: true }],
  hold: [
    { key: "duration_s", label: "sec", kind: "type", integer: true },
    // Most holds carry no added weight, so the zero is not worth reading back.
    { key: "weight", label: "+kg", kind: "type", optional: true },
  ],
  cardio: [
    { key: "speed", label: "km/h", kind: "type" },
    { key: "duration_s", label: "sec", kind: "type", integer: true },
    { key: "distance_m", label: "m", kind: "type" },
  ],
};

/**
 * `×` only where the numbers actually multiply.
 *
 * 80 kg × 8 reps is a product — that is what volume means. 63 sec × 0 kg is
 * not; a hold and a cardio row list independent facts about one effort.
 */
export const SET_SEPARATOR: Record<MetricType, string> = {
  total_weight: "×", dumbbell: "×", bodyweight_plus: "×",
  bodyweight: "×", hold: "·", cardio: "·",
};

/** The fields worth rendering on a set already logged. */
export function shownFields(metric: MetricType, set: Partial<LoggedSet>): FieldSpec[] {
  return METRIC_SET_FIELDS[metric].filter(
    (f) => !f.optional || (set[f.key] !== null && set[f.key] !== undefined && set[f.key] !== 0),
  );
}

export async function fetchActiveSession(): Promise<SessionView | null> {
  const res = await fetch("/api/sessions/active");
  if (!res.ok) throw new Error(`server returned ${res.status}`);
  return (await res.json()) as SessionView | null;
}

/**
 * Create the session. Called as the first set is logged, carrying the earlier
 * moment the program was picked — so a program opened and abandoned leaves
 * nothing behind, but the duration still counts from when you started.
 */
export async function startSession(
  id: string,
  programId: string | null,
  startedAt: string,
): Promise<SessionView> {
  const res = await fetch(`/api/sessions/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ program_id: programId, started_at: startedAt }),
  });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? `server returned ${res.status}`);
  }
  return (await res.json()) as SessionView;
}

/** Sets go through the outbox: this is the write that happens in a basement. */
export async function logSet(set: Partial<LoggedSet> & { id: string }): Promise<void> {
  await enqueue("PUT", `/api/sets/${set.id}`, { ...set, updated_at: new Date().toISOString() });
}

export async function setExerciseNote(loggedExerciseId: string, note: string): Promise<void> {
  await enqueue("PUT", `/api/logged-exercises/${loggedExerciseId}/note`, { note });
}

export async function finishSession(id: string, notes?: string): Promise<void> {
  const res = await fetch(`/api/sessions/${id}/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  if (!res.ok) throw new Error(`server returned ${res.status}`);
}

/**
 * Parse a typed value for one field.
 *
 * Reps and seconds are whole numbers in the schema, so 8,5 reps is a write the
 * server will reject. Catching it here means the field refuses the value while
 * the keypad is still open, rather than the correction appearing to work and
 * then failing in the sync bar a second later.
 */
export function parseField(raw: string, field: FieldSpec): number | null {
  return field.integer ? parseCount(raw) : parseDecimal(raw);
}

export const formatNumber = (v: number | null | undefined): string =>
  v === null || v === undefined ? "" : formatDecimal(v);

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- history

export interface SessionSummary {
  id: string;
  program_id: string | null;
  program_name: string | null;
  date: string;
  started_at: string;
  finished_at: string | null;
  status: "active" | "finished";
  notes: string;
  set_count: number;
  exercise_count: number;
  duration_s: number | null;
}

export async function fetchHistory(
  opts: { program_id?: string; limit?: number; offset?: number } = {},
): Promise<{ data: SessionSummary[]; stale: boolean }> {
  const params = new URLSearchParams();
  if (opts.program_id) params.set("program_id", opts.program_id);
  params.set("limit", String(opts.limit ?? 50));
  params.set("offset", String(opts.offset ?? 0));

  const key = `history:${params.toString()}`;
  try {
    const res = await fetch(`/api/sessions?${params}`);
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const { sessions } = (await res.json()) as { sessions: SessionSummary[] };
    await cachePut(key, sessions);
    return { data: sessions, stale: false };
  } catch (err) {
    const cached = await cacheGet<SessionSummary[]>(key);
    if (cached) return { data: cached, stale: true };
    throw err;
  }
}

export async function fetchSession(id: string): Promise<SessionView> {
  const key = `session:${id}`;
  try {
    const res = await fetch(`/api/sessions/${id}`);
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const data = (await res.json()) as SessionView;
    await cachePut(key, data);
    return data;
  } catch (err) {
    const cached = await cacheGet<SessionView>(key);
    if (cached) return cached;
    throw err;
  }
}

/**
 * A correction is an ordinary set write with the id it already has, so it
 * replays and coalesces like any other. There is no separate edit endpoint.
 */
export async function updateSet(set: LoggedSet): Promise<void> {
  await enqueue("PUT", `/api/sets/${set.id}`, { ...set, updated_at: new Date().toISOString() });
}

export async function removeSet(id: string): Promise<void> {
  await enqueue("DELETE", `/api/sets/${id}`, null);
}

export async function updateSession(
  id: string,
  patch: { notes?: string; date?: string },
): Promise<void> {
  await enqueue("PATCH", `/api/sessions/${id}`, patch);
}

export async function removeSession(id: string): Promise<void> {
  await enqueue("DELETE", `/api/sessions/${id}`, null);
}

/** "Tuesday 3 March" — the phone's locale, not a hand-rolled month table. */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/**
 * How long ago, for the recent handful only.
 *
 * Beyond a week the month heading already places the session, and a column of
 * "3 weeks ago · 3 weeks ago · 3 weeks ago" is noise that makes the dates
 * harder to scan rather than easier.
 */
export function relativeDay(iso: string, today = new Date()): string {
  const then = new Date(`${iso}T12:00:00`);
  const noon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const days = Math.round((noon.getTime() - then.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return `${days} days ago`;
  return "";
}

/**
 * Self-labelling duration for lists — "48 min", "1h 05m".
 *
 * `formatDuration`'s HH:MM is right next to a running clock, where the colon
 * reads as time elapsed. In a row that already says "10 sets · 3 exercises",
 * a bare "00:48" is ambiguous with a rep count.
 */
export function formatMinutes(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
