import { cacheGet, cachePut } from "./idb.js";
import { enqueue } from "./outbox.js";
// The parsing rules are shared with the server rather than reimplemented here:
// numeric.ts imports nothing, so the client runs the same code the data
// layer's tests already cover.
import {
  parseDecimal, parseCount, formatDecimal, parseDuration, formatDuration as formatSeconds,
} from "../../data/numeric.js";

export { parseDecimal, parseDuration, formatSeconds };

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
  /**
   * Steppers for small whole numbers, `duration` for anything measured in
   * time, everything else tap-to-type.
   */
  kind: "stepper" | "type" | "duration";
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
    { key: "duration_s", label: "time", kind: "duration" },
    // Most holds carry no added weight, so the zero is not worth reading back.
    { key: "weight", label: "+kg", kind: "type", optional: true },
  ],
  // Time and distance are what a run is; speed is the extra the machine
  // happened to show, and is never derived from the other two.
  cardio: [
    { key: "duration_s", label: "time", kind: "duration", optional: true },
    { key: "distance_m", label: "m", kind: "type", optional: true },
    { key: "speed", label: "km/h", kind: "type", optional: true },
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
  if (field.kind === "duration") return parseDuration(raw);
  return field.integer ? parseCount(raw) : parseDecimal(raw);
}

/**
 * At least one of these must be present — mirrors `REQUIRE_ANY` in
 * `src/data/sessions.ts`. Deliberately duplicated rather than fetched: the Log
 * set button has to know whether it is enabled before anything is sent, the
 * same way the program editor mirrors its own validation.
 */
export const REQUIRE_ANY: Partial<Record<MetricType, string[]>> = {
  cardio: ["duration_s", "distance_m"],
};

/** Whether this set carries enough to be worth logging. */
export function canLog(
  metric: MetricType,
  values: Record<string, number | null>,
): boolean {
  const present = (key: string) => values[key] !== null && values[key] !== undefined;
  if (!METRIC_SET_FIELDS[metric].every((f) => f.optional || present(f.key))) return false;
  const anyOf = REQUIRE_ANY[metric];
  return !anyOf || anyOf.some(present);
}

/** Render one field's stored value the way that field is read. */
export function formatField(value: number | null | undefined, field: FieldSpec): string {
  if (value === null || value === undefined) return "";
  return field.kind === "duration" ? formatSeconds(value) : formatDecimal(value);
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

// ------------------------------------------------------------------ charts

export interface ChartMetric {
  key: string;
  label: string;
  unit: string;
  better: "up";
}

/**
 * The least a chart needs. An exercise series and a body-metric series are
 * different things everywhere else, but `Chart.svelte` only ever reads a date
 * and a value, so they meet here rather than in two near-identical components.
 */
export interface ChartPoint {
  date: string;
  /** Full timestamp where one exists, so same-day points do not collapse. */
  at?: string;
  values: Record<string, number | null>;
}

export interface SeriesPoint extends ChartPoint {
  session_id: string;
}

export interface MetricSummary {
  latest: number | null;
  best: number | null;
  /** Change across the visible range, read off the fitted trend. */
  change: number | null;
  slope_per_day: number | null;
}

export interface ExerciseChart {
  exercise_id: string;
  exercise_name: string;
  metric_type: MetricType;
  metrics: ChartMetric[];
  points: SeriesPoint[];
  summary: Record<string, MetricSummary>;
  /** The trend as its two endpoints — the client draws, it does not fit. */
  trend_ends: Record<string, { from: number; to: number } | null>;
}

/** 8 weeks, 6 months, or everything. Ranges are `from` bounds, computed here. */
export type Range = "8w" | "6m" | "all";

export const RANGE_LABELS: Record<Range, string> = {
  "8w": "8 weeks", "6m": "6 months", all: "All",
};

export function rangeFrom(range: Range, today = new Date()): string | undefined {
  if (range === "all") return undefined;
  const d = new Date(today);
  d.setDate(d.getDate() - (range === "8w" ? 56 : 183));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function fetchExerciseChart(id: string, range: Range): Promise<ExerciseChart> {
  const from = rangeFrom(range);
  const key = `chart:${id}:${range}`;
  try {
    const res = await fetch(`/api/stats/exercises/${id}${from ? `?from=${from}` : ""}`);
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const data = (await res.json()) as ExerciseChart;
    await cachePut(key, data);
    return data;
  } catch (err) {
    const cached = await cacheGet<ExerciseChart>(key);
    if (cached) return cached;
    throw err;
  }
}

/** Every pinned chart in one request — a request per sparkline would be worse. */
export async function fetchFavouriteCharts(
  range: Range = "8w",
): Promise<{ data: ExerciseChart[]; stale: boolean }> {
  const from = rangeFrom(range);
  const key = `favourite-charts:${range}`;
  try {
    const res = await fetch(`/api/stats/favourites${from ? `?from=${from}` : ""}`);
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const { charts } = (await res.json()) as { charts: ExerciseChart[] };
    await cachePut(key, charts);
    return { data: charts, stale: false };
  } catch (err) {
    const cached = await cacheGet<ExerciseChart[]>(key);
    if (cached) return { data: cached, stale: true };
    throw err;
  }
}

export interface Favourite {
  id: string;
  kind: "exercise" | "body_metric";
  ref_id: string;
}

export async function fetchFavourites(): Promise<Favourite[]> {
  const res = await fetch("/api/favourites");
  if (!res.ok) throw new Error(`server returned ${res.status}`);
  return ((await res.json()) as { favourites: Favourite[] }).favourites;
}

/**
 * Pinning is a structural edit, not something logged in a gym: it goes straight
 * to the server so a rejection lands while the screen is still open.
 */
export async function saveFavourites(
  wanted: { kind: "exercise" | "body_metric"; ref_id: string }[],
): Promise<Favourite[]> {
  const res = await fetch("/api/favourites", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ favourites: wanted }),
  });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? `server returned ${res.status}`);
  }
  return ((await res.json()) as { favourites: Favourite[] }).favourites;
}

// ------------------------------------------------------------ body metrics

export interface BodyMetric {
  id: string;
  name: string;
  unit: string;
  position: number;
  archived_at: string | null;
  deleted_at: string | null;
  /** The number on the strip, or null before anything is logged. */
  latest: { value: number; measured_at: string } | null;
  points: ChartPoint[];
}

export interface BodyReading {
  id: string;
  type_id: string;
  measured_at: string;
  value: number;
  note: string;
}

export interface BodySeries {
  type_id: string;
  name: string;
  unit: string;
  points: ChartPoint[];
  trend: { slope_per_day: number; change: number } | null;
  trend_ends: { from: number; to: number } | null;
  latest: number | null;
  change: number | null;
}

export async function fetchBodyMetrics(
  include: Include = "active",
): Promise<{ data: BodyMetric[]; stale: boolean }> {
  const key = `body-types:${include}`;
  try {
    const res = await fetch(`/api/body/types?include=${include}`);
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const { types } = (await res.json()) as { types: BodyMetric[] };
    await cachePut(key, types);
    return { data: types, stale: false };
  } catch (err) {
    const cached = await cacheGet<BodyMetric[]>(key);
    if (cached) return { data: cached, stale: true };
    throw err;
  }
}

/** Structural, like a program save: straight to the server so a clash shows now. */
export async function saveBodyMetric(
  type: { id: string; name: string; unit: string },
): Promise<BodyMetric> {
  const res = await fetch(`/api/body/types/${type.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...type, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? `server returned ${res.status}`);
  }
  return (await res.json()) as BodyMetric;
}

export async function bodyMetricAction(
  id: string,
  action: "archive" | "unarchive" | "delete",
): Promise<void> {
  const res = await fetch(`/api/body/types/${id}/${action}`, { method: "POST" });
  if (!res.ok) throw new Error(`server returned ${res.status}`);
}

export async function fetchBodySeries(id: string, range: Range): Promise<BodySeries> {
  const from = rangeFrom(range);
  const key = `body-series:${id}:${range}`;
  try {
    const res = await fetch(`/api/body/types/${id}/series${from ? `?from=${from}` : ""}`);
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const data = (await res.json()) as BodySeries;
    await cachePut(key, data);
    return data;
  } catch (err) {
    const cached = await cacheGet<BodySeries>(key);
    if (cached) return cached;
    throw err;
  }
}

export async function fetchBodyReadings(id: string): Promise<BodyReading[]> {
  const key = `body-entries:${id}`;
  try {
    const res = await fetch(`/api/body/types/${id}/entries`);
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const { entries } = (await res.json()) as { entries: BodyReading[] };
    await cachePut(key, entries);
    return entries;
  } catch (err) {
    const cached = await cacheGet<BodyReading[]>(key);
    if (cached) return cached;
    throw err;
  }
}

/**
 * A reading goes through the outbox — it is a quick write that may happen with
 * no signal, and correcting one is the same write carrying the id it has.
 */
export async function saveReading(
  entry: { id: string; type_id: string; value: number; measured_at?: string; note?: string },
): Promise<void> {
  await enqueue("PUT", `/api/body/entries/${entry.id}`, {
    ...entry,
    updated_at: new Date().toISOString(),
  });
}

export async function removeReading(id: string): Promise<void> {
  await enqueue("DELETE", `/api/body/entries/${id}`, null);
}

/** "6 days ago", "Today" — how long since the last reading, said plainly. */
export function sinceReading(iso: string, now = new Date()): string {
  const days = Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}
