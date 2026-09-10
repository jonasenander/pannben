import type { Database } from "better-sqlite3";
import type { Clock } from "./clock.js";
import { ValidationError, type MetricType } from "./exercises.js";

/**
 * Everything a chart plots, derived at read time from `logged_set`.
 *
 * Nothing here is stored. The formulas below are opinions about training, not
 * facts about the data, so they have to stay revisable without a migration —
 * which is only true while the only thing in the database is what was actually
 * lifted.
 */

/** One thing a chart can plot, and how to label its axis. */
export interface ChartMetric {
  key: string;
  label: string;
  unit: string;
  /** Longer is better for a hold; heavier is better for a squat. Both are up. */
  better: "up";
}

const M = (key: string, label: string, unit: string): ChartMetric =>
  ({ key, label, unit, better: "up" });

/**
 * Which metrics are worth plotting, per exercise type.
 *
 * The order matters: the first is the default the chart opens on, and it is the
 * one that answers "am I getting stronger at this" for that kind of exercise.
 */
const METRICS: Record<MetricType, ChartMetric[]> = {
  total_weight: [
    M("volume", "Volume", "kg"),
    M("top_weight", "Top set", "kg"),
    M("e1rm", "Est. 1RM", "kg"),
  ],
  dumbbell: [
    M("volume", "Volume", "kg"),
    M("top_weight", "Top set", "kg/hand"),
    M("e1rm", "Est. 1RM", "kg/hand"),
  ],
  // No 1RM: the bar is your body, so Epley over the added plate alone is a
  // number with no meaning behind it.
  bodyweight_plus: [
    M("volume", "Added volume", "kg"),
    M("top_weight", "Top added", "kg"),
    M("reps", "Total reps", "reps"),
  ],
  bodyweight: [
    M("reps", "Total reps", "reps"),
    M("best_set", "Best set", "reps"),
  ],
  cardio: [
    M("distance", "Distance", "m"),
    M("duration", "Duration", "min"),
    M("speed", "Speed", "km/h"),
  ],
  hold: [
    M("best_hold", "Longest hold", "s"),
    M("time_under_load", "Time under load", "s"),
  ],
};

export function metricsFor(type: MetricType): ChartMetric[] {
  return METRICS[type];
}

export interface SeriesPoint {
  session_id: string;
  date: string;
  /** Keyed by `ChartMetric.key`; null where the metric does not apply that day. */
  values: Record<string, number | null>;
}

export interface ExerciseSeries {
  exercise_id: string;
  exercise_name: string;
  metric_type: MetricType;
  metrics: ChartMetric[];
  points: SeriesPoint[];
}

export interface SeriesOptions {
  /** Inclusive `YYYY-MM-DD` bounds. */
  from?: string;
  to?: string;
}

/** Epley. Meaningless above ~12 reps, so it is not computed there. */
const E1RM_REP_CEILING = 12;
const epley = (weight: number, reps: number) => weight * (1 + reps / 30);

const round2 = (n: number) => Math.round(n * 100) / 100;

interface SetRow {
  session_id: string;
  date: string;
  weight: number | null;
  reps: number | null;
  duration_s: number | null;
  distance_m: number | null;
  speed: number | null;
}

/**
 * One point per session for one exercise, oldest first.
 *
 * Every metric is computed in the same pass and returned together, so the
 * chart's metric toggle is instant rather than a round trip — the expensive
 * part is reading the sets, and they are the same sets either way.
 */
export function exerciseSeries(
  db: Database,
  exerciseId: string,
  opts: SeriesOptions = {},
): ExerciseSeries {
  const exercise = db
    .prepare("SELECT id, name, metric_type FROM exercise WHERE id = ?")
    .get(exerciseId) as { id: string; name: string; metric_type: MetricType } | undefined;
  if (!exercise) throw new Error(`no such exercise: ${exerciseId}`);

  // Skipped sets record a decision, not work; deleted sets and deleted sessions
  // are gone. An *archived* exercise still counts — keeping its history is the
  // whole reason archiving exists as something separate from deleting.
  const rows = db
    .prepare(
      `SELECT s.id AS session_id, s.date,
              ls.weight, ls.reps, ls.duration_s, ls.distance_m, ls.speed
       FROM logged_set ls
       JOIN logged_exercise le ON le.id = ls.logged_exercise_id
       JOIN session s ON s.id = le.session_id
       WHERE le.exercise_id = @id
         AND ls.deleted_at IS NULL AND ls.skipped = 0
         AND s.deleted_at IS NULL
         AND (@from IS NULL OR s.date >= @from)
         AND (@to IS NULL OR s.date <= @to)
       ORDER BY s.date, s.started_at, ls.round_index, ls.set_index`,
    )
    .all({ id: exerciseId, from: opts.from ?? null, to: opts.to ?? null }) as SetRow[];

  // A session with nothing but skipped sets never reaches this grouping, which
  // is deliberate: a zero would read as a catastrophic drop rather than a day
  // the work did not happen.
  const bySession = new Map<string, SetRow[]>();
  for (const row of rows) {
    const existing = bySession.get(row.session_id);
    if (existing) existing.push(row);
    else bySession.set(row.session_id, [row]);
  }

  const points: SeriesPoint[] = [];
  for (const [sessionId, sets] of bySession) {
    points.push({
      session_id: sessionId,
      date: sets[0]!.date,
      values: aggregate(exercise.metric_type, sets),
    });
  }

  return {
    exercise_id: exercise.id,
    exercise_name: exercise.name,
    metric_type: exercise.metric_type,
    metrics: metricsFor(exercise.metric_type),
    points,
  };
}

/** Every metric for one exercise on one day. */
function aggregate(type: MetricType, sets: SetRow[]): Record<string, number | null> {
  const sum = (pick: (s: SetRow) => number | null) =>
    sets.reduce((n, s) => n + (pick(s) ?? 0), 0);
  const max = (pick: (s: SetRow) => number | null) => {
    const values = sets.map(pick).filter((v): v is number => v !== null);
    return values.length > 0 ? Math.max(...values) : null;
  };

  /** The best set in the range Epley is honest over. */
  const bestE1rm = (): number | null => {
    const candidates = sets
      .filter((s) => s.weight !== null && s.reps !== null && s.reps <= E1RM_REP_CEILING)
      .map((s) => epley(s.weight!, s.reps!));
    return candidates.length > 0 ? round2(Math.max(...candidates)) : null;
  };

  switch (type) {
    case "total_weight":
      return {
        volume: round2(sum((s) => (s.weight ?? 0) * (s.reps ?? 0))),
        top_weight: max((s) => s.weight),
        e1rm: bestE1rm(),
      };

    // Both hands did the work, so the volume counts both; the top set is still
    // what you picked up in one of them.
    case "dumbbell":
      return {
        volume: round2(sum((s) => (s.weight ?? 0) * 2 * (s.reps ?? 0))),
        top_weight: max((s) => s.weight),
        e1rm: bestE1rm(),
      };

    case "bodyweight_plus":
      return {
        volume: round2(sum((s) => (s.weight ?? 0) * (s.reps ?? 0))),
        top_weight: max((s) => s.weight),
        reps: sum((s) => s.reps),
      };

    case "bodyweight":
      return { reps: sum((s) => s.reps), best_set: max((s) => s.reps) };

    case "cardio":
      return {
        distance: round2(sum((s) => s.distance_m)),
        duration: round2(sum((s) => s.duration_s) / 60),
        speed: max((s) => s.speed),
      };

    case "hold":
      return { best_hold: max((s) => s.duration_s), time_under_load: sum((s) => s.duration_s) };
  }
}

export interface TrendPoint {
  date: string;
  value: number | null;
}

export interface Trend {
  /** Change per calendar day, in the metric's own unit. */
  slope_per_day: number;
  /** Value the fit predicts on a given date. */
  at: (date: string) => number;
  /** Change across the whole visible range, which is what a person reads off it. */
  change: number;
}

const DAY = 86_400_000;

/**
 * Least squares over the visible range.
 *
 * Fitted against **calendar days, not point index**. Sessions are not evenly
 * spaced — a fortnight off between two of them is real, and fitting by index
 * would draw a line far steeper than the training actually was.
 */
export function trendLine(points: TrendPoint[]): Trend | null {
  const usable = points.filter((p): p is { date: string; value: number } => p.value !== null);
  if (usable.length < 2) return null;

  const origin = Date.parse(`${usable[0]!.date}T12:00:00Z`);
  const xs = usable.map((p) => (Date.parse(`${p.date}T12:00:00Z`) - origin) / DAY);
  const ys = usable.map((p) => p.value);

  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (xs[i]! - meanX) * (ys[i]! - meanY);
    denominator += (xs[i]! - meanX) ** 2;
  }

  // Every session on one day: the fit is a vertical line, which is not a trend.
  if (denominator === 0) return null;

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  const at = (date: string) =>
    slope * ((Date.parse(`${date}T12:00:00Z`) - origin) / DAY) + intercept;

  return {
    slope_per_day: slope,
    at,
    change: at(usable.at(-1)!.date) - at(usable[0]!.date),
  };
}

// ---------------------------------------------------------------- favourites

export type FavouriteKind = "exercise" | "body_metric";

export interface Favourite {
  id: string;
  kind: FavouriteKind;
  ref_id: string;
}

export function favourites(db: Database): Favourite[] {
  return db
    .prepare("SELECT id, kind, ref_id FROM favourite ORDER BY position")
    .all() as Favourite[];
}

/**
 * Save the pinned list as one document.
 *
 * Same shape as a program save, and for the same reason: position comes from
 * array order, so reordering is an ordinary save rather than an endpoint with
 * its own correctness argument. Nothing here is logged in a gym, so it does not
 * go through the outbox — a rejection has to arrive while the screen is open.
 */
export function setFavourites(
  db: Database,
  wanted: { kind: FavouriteKind; ref_id: string }[],
  clock: Clock,
): Favourite[] {
  const seen = new Set<string>();
  for (const f of wanted) {
    const key = `${f.kind}:${f.ref_id}`;
    if (seen.has(key)) throw new ValidationError("that chart is already pinned", "ref_id");
    seen.add(key);

    if (f.kind === "exercise") {
      const exists = db
        .prepare("SELECT id FROM exercise WHERE id = ? AND deleted_at IS NULL")
        .get(f.ref_id);
      if (!exists) throw new ValidationError("no such exercise", "ref_id");
    }
  }

  const now = clock.nowIso();
  db.transaction(() => {
    db.prepare("DELETE FROM favourite").run();
    const insert = db.prepare(
      `INSERT INTO favourite (id, kind, ref_id, position, created_at, updated_at)
       VALUES (?,?,?,?,?,?)`,
    );
    wanted.forEach((f, i) => insert.run(crypto.randomUUID(), f.kind, f.ref_id, i, now, now));
  })();

  return favourites(db);
}

/**
 * Every pinned chart's series, in one read.
 *
 * The dashboard renders a handful of sparklines; a request per sparkline would
 * be a request per card on a phone that may be on a slow connection.
 *
 * A pin whose exercise has since been deleted is skipped rather than surfaced
 * as an error — the dashboard is the wrong place to learn that something was
 * cleaned up elsewhere.
 */
export function favouriteSeries(db: Database, opts: SeriesOptions = {}): ExerciseSeries[] {
  const out: ExerciseSeries[] = [];
  for (const f of favourites(db)) {
    if (f.kind !== "exercise") continue;
    const live = db
      .prepare("SELECT id FROM exercise WHERE id = ? AND deleted_at IS NULL")
      .get(f.ref_id);
    if (!live) continue;
    out.push(exerciseSeries(db, f.ref_id, opts));
  }
  return out;
}
