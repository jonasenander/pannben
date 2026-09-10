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
