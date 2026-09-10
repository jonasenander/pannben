import { Hono } from "hono";
import type { Database } from "better-sqlite3";
import type { Clock } from "../../data/clock.js";
import {
  listExercises, getExercise, upsertExercise, archiveExercise,
  unarchiveExercise, deleteExercise, countExercises,
  ValidationError, ConflictError, type Include,
} from "../../data/exercises.js";

export function exerciseRoutes(db: Database, clock: Clock): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const raw = c.req.query("include") ?? "active";
    const include: Include =
      raw === "archived" || raw === "all" || raw === "active" ? raw : "active";

    return c.json({
      exercises: listExercises(db, include),
      counts: countExercises(db),
    });
  });

  app.get("/:id", (c) => {
    const found = getExercise(db, c.req.param("id"));
    if (!found || found.deleted_at) return c.json({ error: "not found" }, 404);
    return c.json(found);
  });

  /**
   * The only write verb. Rename, archive, unarchive and delete are all field
   * changes on the same row, so they need no endpoints of their own — and one
   * idempotent route is far easier to replay from the outbox than four.
   */
  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return c.json({ error: "expected a JSON body" }, 400);

    // The URL is authoritative: a body id disagreeing with it is a client bug,
    // and silently trusting either one would write to the wrong row.
    if (typeof body.id === "string" && body.id !== id) {
      return c.json({ error: "id in the body does not match the URL" }, 400);
    }

    try {
      const saved = upsertExercise(
        db,
        { ...(body as object), id } as Parameters<typeof upsertExercise>[1],
        clock,
      );
      return c.json(saved);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ error: err.message, field: err.field }, 400);
      }
      if (err instanceof ConflictError) return c.json({ error: err.message }, 409);
      throw err; // unexpected: let the error handler log and return 500
    }
  });

  const flag = (
    path: string,
    fn: (db: Database, id: string, clock: Clock) => unknown,
  ) =>
    app.post(path, (c) => {
      // `path` is not a literal type here, so Hono cannot infer the param.
      const id = c.req.param("id");
      if (!id) return c.json({ error: "missing id" }, 400);
      try {
        return c.json(fn(db, id, clock) as object);
      } catch (err) {
        if (err instanceof ValidationError) return c.json({ error: err.message }, 404);
        throw err;
      }
    });

  flag("/:id/archive", archiveExercise);
  flag("/:id/unarchive", unarchiveExercise);
  flag("/:id/delete", deleteExercise);

  return app;
}
