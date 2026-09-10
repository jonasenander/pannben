import { Hono } from "hono";
import type { Database } from "better-sqlite3";
import type { Clock } from "../../data/clock.js";
import { ValidationError } from "../../data/exercises.js";
import {
  exerciseSeries, trendLine, favourites, setFavourites, favouriteSeries,
  type SeriesOptions, type ExerciseSeries, type ChartMetric,
} from "../../data/stats.js";

/** `YYYY-MM-DD`, or nothing. A malformed range is ignored rather than fatal. */
const asDate = (raw: string | undefined) =>
  raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;

/**
 * A series plus everything drawn on top of it: the trend for each metric, and
 * the numbers the stat tiles show. Computed here so the client renders rather
 * than calculates — the same arithmetic on the phone would be a second place
 * for the formulas to drift.
 */
function withTrends(series: ExerciseSeries) {
  const summary: Record<string, {
    latest: number | null;
    best: number | null;
    change: number | null;
    slope_per_day: number | null;
  }> = {};

  // The trend goes out as its two endpoints rather than a slope: the chart only
  // ever draws a line between two points, and evaluating here keeps the fitting
  // maths out of the client entirely.
  const trend_ends: Record<string, { from: number; to: number } | null> = {};

  for (const metric of series.metrics) {
    const points = series.points.map((p) => ({ date: p.date, value: p.values[metric.key] ?? null }));
    const present = points.map((p) => p.value).filter((v): v is number => v !== null);
    const dated = points.filter((p) => p.value !== null);
    const fit = trendLine(points);

    summary[metric.key] = {
      latest: present.at(-1) ?? null,
      best: present.length > 0 ? Math.max(...present) : null,
      change: fit ? Math.round(fit.change * 100) / 100 : null,
      slope_per_day: fit ? fit.slope_per_day : null,
    };

    trend_ends[metric.key] = fit
      ? { from: fit.at(dated[0]!.date), to: fit.at(dated.at(-1)!.date) }
      : null;
  }

  return { ...series, summary, trend_ends };
}

export function statsRoutes(db: Database): Hono {
  const app = new Hono();

  app.get("/exercises/:id", (c) => {
    const q = c.req.query();
    const opts: SeriesOptions = { from: asDate(q.from), to: asDate(q.to) };
    try {
      return c.json(withTrends(exerciseSeries(db, c.req.param("id"), opts)));
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("no such exercise")) {
        return c.json({ error: "no such exercise" }, 404);
      }
      throw err;
    }
  });

  /** Every pinned chart, in one request rather than one per card. */
  app.get("/favourites", (c) => {
    const q = c.req.query();
    const opts: SeriesOptions = { from: asDate(q.from), to: asDate(q.to) };
    return c.json({ charts: favouriteSeries(db, opts).map(withTrends) });
  });

  return app;
}

export function favouriteRoutes(db: Database, clock: Clock): Hono {
  const app = new Hono();

  app.get("/", (c) => c.json({ favourites: favourites(db) }));

  /** The pinned list as one document — position comes from array order. */
  app.put("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { favourites?: { kind: "exercise" | "body_metric"; ref_id: string }[] } | null;
    if (!body || !Array.isArray(body.favourites)) {
      return c.json({ error: "expected { favourites: [...] }" }, 400);
    }
    try {
      return c.json({ favourites: setFavourites(db, body.favourites, clock) });
    } catch (err) {
      if (err instanceof ValidationError) return c.json({ error: err.message, field: err.field }, 400);
      throw err;
    }
  });

  return app;
}

export type { ChartMetric };
