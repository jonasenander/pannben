import { cacheGet, cachePut } from "./idb.js";
import { enqueue } from "./outbox.js";

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
}

export const METRIC_SET_FIELDS: Record<MetricType, FieldSpec[]> = {
  total_weight: [
    { key: "weight", label: "kg", kind: "type" },
    { key: "reps", label: "reps", kind: "stepper", step: 1 },
  ],
  dumbbell: [
    { key: "weight", label: "kg ea", kind: "type" },
    { key: "reps", label: "reps", kind: "stepper", step: 1 },
  ],
  bodyweight_plus: [
    { key: "weight", label: "+kg", kind: "type" },
    { key: "reps", label: "reps", kind: "stepper", step: 1 },
  ],
  bodyweight: [{ key: "reps", label: "reps", kind: "stepper", step: 1 }],
  hold: [
    { key: "duration_s", label: "sec", kind: "type" },
    { key: "weight", label: "+kg", kind: "type" },
  ],
  cardio: [
    { key: "speed", label: "km/h", kind: "type" },
    { key: "duration_s", label: "sec", kind: "type" },
    { key: "distance_m", label: "m", kind: "type" },
  ],
};

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
 * Accepts a Swedish comma as readily as a point. This mirrors the data layer's
 * rule rather than hoping the keypad cooperates.
 */
export function parseDecimal(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(t)) return null;
  const v = Number(t.replace(",", "."));
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

export const formatNumber = (v: number | null | undefined): string =>
  v === null || v === undefined ? "" : String(Math.round(v * 100) / 100);

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
