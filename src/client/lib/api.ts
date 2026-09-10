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
