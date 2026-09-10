import { Hono } from "hono";
import type { Database } from "better-sqlite3";
import type { Clock } from "../../data/clock.js";
import { ValidationError, ConflictError } from "../../data/exercises.js";
import {
  listPrograms, getProgram, upsertProgram,
  archiveProgram, unarchiveProgram, deleteProgram,
} from "../../data/programs.js";
import { prefillFor } from "../../data/sessions.js";

export function programRoutes(db: Database, clock: Clock): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const raw = c.req.query("include") ?? "active";
    const include = raw === "archived" || raw === "all" ? raw : "active";
    const programs = listPrograms(db, include);

    /**
     * `?full=1` returns each program's whole tree.
     *
     * This exists for the gym: the app is only reachable over Tailscale, so no
     * signal means no server at all, and starting a session needs the block
     * structure the server would otherwise snapshot. Cached whole, it can be
     * snapshotted on the phone instead. Three programs is a small response.
     */
    if (c.req.query("full") === "1") {
      return c.json({
        programs: programs
          .map((p) => getProgram(db, p.id))
          .filter((p): p is NonNullable<typeof p> => p !== null && !p.deleted_at),
      });
    }

    return c.json({ programs });
  });

  /**
   * What each exercise in this program looked like last time, by set index.
   *
   * Prefill is the reason the common case is typing nothing at all, so losing
   * it offline would be losing most of the value. Cached alongside the program
   * tree, an offline session starts prefilled exactly as an online one does.
   */
  app.get("/:id/prefill", (c) => {
    const program = getProgram(db, c.req.param("id"));
    if (!program || program.deleted_at) return c.json({ error: "not found" }, 404);

    const prefill: Record<string, unknown[]> = {};
    for (const block of program.blocks) {
      for (const entry of block.entries) {
        prefill[entry.exercise_id] = Array.from(
          { length: Math.max(entry.target_sets, 1) + 1 },
          // No session to exclude yet: the one being started does not exist.
          (_, i) => prefillFor(db, entry.exercise_id, i, ""),
        );
      }
    }
    return c.json({ prefill });
  });

  app.get("/:id", (c) => {
    const found = getProgram(db, c.req.param("id"));
    if (!found || found.deleted_at) return c.json({ error: "not found" }, 404);
    return c.json(found);
  });

  // The whole tree in one write, so reordering is atomic and the queued entry
  // coalesces to a single document rather than a fan of per-node edits.
  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return c.json({ error: "expected a JSON body" }, 400);
    if (typeof body.id === "string" && body.id !== id) {
      return c.json({ error: "id in the body does not match the URL" }, 400);
    }

    try {
      return c.json(upsertProgram(db, { ...(body as object), id } as never, clock));
    } catch (err) {
      if (err instanceof ValidationError) return c.json({ error: err.message, field: err.field }, 400);
      if (err instanceof ConflictError) return c.json({ error: err.message }, 409);
      throw err;
    }
  });

  const flag = (path: string, fn: (db: Database, id: string, clock: Clock) => unknown) =>
    app.post(path, (c) => {
      const id = c.req.param("id");
      if (!id) return c.json({ error: "missing id" }, 400);
      try {
        return c.json(fn(db, id, clock) as object);
      } catch (err) {
        if (err instanceof ValidationError) return c.json({ error: err.message }, 404);
        throw err;
      }
    });

  flag("/:id/archive", archiveProgram);
  flag("/:id/unarchive", unarchiveProgram);
  flag("/:id/delete", deleteProgram);

  return app;
}
