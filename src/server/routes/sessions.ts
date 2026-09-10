import { Hono } from "hono";
import type { Database } from "better-sqlite3";
import type { Clock } from "../../data/clock.js";
import { ValidationError } from "../../data/exercises.js";
import {
  startSession, logSet, finishSession, activeSession,
  getSessionView, setExerciseNote, deleteSet,
} from "../../data/sessions.js";

export function sessionRoutes(db: Database, clock: Clock, zone: string): Hono {
  const app = new Hono();

  /** Rethrow anything that is not the caller's fault, so it reaches the logger. */
  const asBadRequest = (err: unknown) => {
    if (err instanceof ValidationError) return { error: err.message, field: err.field };
    throw err;
  };

  app.get("/active", (c) => {
    const s = activeSession(db);
    return c.json(s ? getSessionView(db, s.id) : null);
  });

  app.get("/:id", (c) => {
    const s = getSessionView(db, c.req.param("id"));
    return s ? c.json(s) : c.json({ error: "not found" }, 404);
  });

  /**
   * Create the session. The client calls this as it logs the first set, not
   * when the program is picked — a program opened and abandoned leaves nothing
   * behind — and sends the earlier `started_at` along.
   */
  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return c.json({ error: "expected a JSON body" }, 400);
    try {
      startSession(db, { ...(body as object), id } as never, clock, zone);
      return c.json(getSessionView(db, id));
    } catch (err) {
      return c.json(asBadRequest(err), 400);
    }
  });

  app.post("/:id/finish", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { notes?: string };
    try {
      finishSession(db, c.req.param("id"), clock, body.notes);
      return c.json(getSessionView(db, c.req.param("id")));
    } catch (err) {
      return c.json(asBadRequest(err), 400);
    }
  });

  return app;
}

/** Sets and per-exercise notes: the highest-traffic writes in the app. */
export function setRoutes(db: Database, clock: Clock): Hono {
  const app = new Hono();

  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return c.json({ error: "expected a JSON body" }, 400);
    try {
      return c.json(logSet(db, { ...(body as object), id } as never, clock));
    } catch (err) {
      if (err instanceof ValidationError) return c.json({ error: err.message, field: err.field }, 400);
      throw err;
    }
  });

  app.delete("/:id", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "missing id" }, 400);
    try {
      deleteSet(db, id, clock);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  return app;
}

export function loggedExerciseRoutes(db: Database, clock: Clock): Hono {
  const app = new Hono();

  app.put("/:id/note", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as { note?: string } | null;
    if (!id || body === null) return c.json({ error: "expected { note }" }, 400);
    try {
      setExerciseNote(db, id, body.note ?? "", clock);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  return app;
}
