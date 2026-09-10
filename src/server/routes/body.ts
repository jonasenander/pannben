import { Hono } from "hono";
import type { Database } from "better-sqlite3";
import type { Clock } from "../../data/clock.js";
import { ValidationError, type Include } from "../../data/exercises.js";
import {
  listMetricTypes, upsertMetricType, archiveMetricType, unarchiveMetricType,
  deleteMetricType, upsertEntry, deleteEntry, listEntries, latestEntry, metricSeries,
} from "../../data/body.js";

const asInclude = (raw: string | undefined): Include =>
  raw === "archived" || raw === "all" ? raw : "active";

const asDate = (raw: string | undefined) =>
  raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;

export function bodyRoutes(db: Database, clock: Clock): Hono {
  const app = new Hono();

  const bad = (err: unknown) => {
    if (err instanceof ValidationError) return { error: err.message, field: err.field };
    throw err;
  };

  /**
   * Every metric with the one number the Home strip shows, in one request.
   * A request per strip would be a request per line on a phone.
   */
  app.get("/types", (c) => {
    const types = listMetricTypes(db, asInclude(c.req.query("include")));
    return c.json({
      types: types.map((t) => {
        const latest = latestEntry(db, t.id);
        return {
          ...t,
          latest: latest ? { value: latest.value, measured_at: latest.measured_at } : null,
          points: metricSeries(db, t.id, { from: c.req.query("from") }).points,
        };
      }),
    });
  });

  /** Structural, so it goes straight to the server, not through the outbox. */
  app.put("/types/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return c.json({ error: "expected a JSON body" }, 400);
    try {
      return c.json(upsertMetricType(db, { ...(body as object), id } as never, clock));
    } catch (err) {
      return c.json(bad(err), 400);
    }
  });

  for (const [path, fn] of [
    ["archive", archiveMetricType],
    ["unarchive", unarchiveMetricType],
    ["delete", deleteMetricType],
  ] as const) {
    app.post(`/types/:id/${path}`, (c) => {
      try {
        return c.json(fn(db, c.req.param("id"), clock));
      } catch (err) {
        return c.json(bad(err), 404);
      }
    });
  }

  app.get("/types/:id/entries", (c) =>
    c.json({ entries: listEntries(db, c.req.param("id")) }));

  app.get("/types/:id/series", (c) => {
    const q = c.req.query();
    try {
      return c.json(metricSeries(db, c.req.param("id"),
        { from: asDate(q.from), to: asDate(q.to) }));
    } catch (err) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  /** A reading may be taken away from signal, so this one is queueable. */
  app.put("/entries/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return c.json({ error: "expected a JSON body" }, 400);
    try {
      return c.json(upsertEntry(db, { ...(body as object), id } as never, clock));
    } catch (err) {
      return c.json(bad(err), 400);
    }
  });

  app.delete("/entries/:id", (c) => {
    try {
      deleteEntry(db, c.req.param("id"), clock);
      return c.json({ ok: true });
    } catch (err) {
      return c.json(bad(err), 404);
    }
  });

  return app;
}
