import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { openDb, health } from "../data/db.js";
import { systemClock } from "../data/clock.js";
import { exportAll, exportSummary } from "../data/export.js";
import { importAll, ImportError } from "../data/import.js";
import { statsRoutes, favouriteRoutes } from "./routes/stats.js";
import { exerciseRoutes } from "./routes/exercises.js";
import { programRoutes } from "./routes/programs.js";
import { sessionRoutes, setRoutes, loggedExerciseRoutes } from "./routes/sessions.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

const DATA_DIR = process.env.PANNBEN_DATA_DIR ?? join(root, "data");
const PORT = Number(process.env.PANNBEN_PORT ?? 8225);
const ZONE = process.env.TZ ?? "Europe/Stockholm";
// Loopback by default. Tailscale Serve fronts this; the container never binds
// the LAN interface. See docs/decisions/0002-transport-and-access.md.
const HOST = process.env.PANNBEN_HOST ?? "127.0.0.1";

/**
 * Which build this is, stamped in at image build time.
 *
 * `npm_package_version` is "0.1.0" forever, so until now there was no way to
 * answer "am I running the new one?" from the phone at all — which is exactly
 * why a stale service worker went unnoticed for four phases.
 */
const BUILD = process.env.PANNBEN_BUILD ?? "dev";

const db = openDb({
  file: join(DATA_DIR, "pannben.db"),
  migrationsDir: join(root, "migrations"),
});

const app = new Hono();

app.get("/api/health", (c) => {
  const h = health(db);
  return c.json({
    ok: true,
    version: process.env.npm_package_version ?? "0.1.0",
    build: BUILD,
    schemaVersion: h.schemaVersion,
    dbBytes: h.dbBytes,
    tables: h.tables,
    walMode: h.walMode,
    zone: ZONE,
    today: systemClock.today(ZONE),
    serverTime: systemClock.nowIso(),
  });
});

app.route("/api/exercises", exerciseRoutes(db, systemClock));
app.route("/api/programs", programRoutes(db, systemClock));
app.route("/api/sessions", sessionRoutes(db, systemClock, ZONE));
app.route("/api/sets", setRoutes(db, systemClock));
app.route("/api/logged-exercises", loggedExerciseRoutes(db, systemClock));
app.route("/api/stats", statsRoutes(db));
app.route("/api/favourites", favouriteRoutes(db, systemClock));

app.get("/api/export", (c) => {
  const stamp = systemClock.today(ZONE);
  c.header("Content-Disposition", `attachment; filename="pannben-export-${stamp}.json"`);
  return c.json(exportAll(db, systemClock, process.env.npm_package_version ?? "0.1.0"));
});

app.get("/api/export/summary", (c) => c.json(exportSummary(db)));

/**
 * Replace everything with the contents of an export.
 *
 * Not queued through the outbox: a restore is a deliberate, destructive act
 * done while looking at the screen, and its result — or its refusal — has to
 * arrive now rather than as a banner some seconds later. The whole thing is
 * one transaction, so a rejected file leaves the database exactly as it was.
 */
app.post("/api/import", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (body === null) return c.json({ error: "expected a JSON export file" }, 400);
  try {
    const result = importAll(db, body, systemClock);
    console.error(JSON.stringify({
      level: "info", msg: "import applied",
      schemaVersion: result.schema_version, exportedAt: result.exported_at,
      rows: result.rows,
    }));
    return c.json(result);
  } catch (err) {
    if (err instanceof ImportError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

// The built client. In dev, Vite serves this and proxies /api here instead.
const clientDir = join(root, "dist/client");
if (existsSync(clientDir)) {
  /**
   * The entry points must be revalidated; everything else is content-hashed.
   *
   * Without this the browser is free to hold its own copy of `index.html` and
   * `sw.js`, which is one of the reasons a deploy could land on the NAS and
   * never reach the phone. The hashed bundles under /assets/ change name on
   * every build, so they can be cached hard and forever.
   */
  app.use("/*", async (c, next) => {
    await next();
    const path = new URL(c.req.url).pathname;
    if (path === "/" || path === "/index.html" || path === "/sw.js") {
      c.header("Cache-Control", "no-cache");
    } else if (path.startsWith("/assets/")) {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    }
  });

  app.use("/*", serveStatic({ root: "./dist/client" }));
  app.get("*", serveStatic({ path: "./dist/client/index.html" }));
}

// A write that fails must be visible, never swallowed.
app.onError((err, c) => {
  console.error(JSON.stringify({ level: "error", msg: err.message, stack: err.stack }));
  return c.json({ ok: false, error: err.message }, 500);
});

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "pannben listening",
      host: HOST,
      port: info.port,
      dataDir: DATA_DIR,
      zone: ZONE,
      schemaVersion: health(db).schemaVersion,
    }),
  );
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(JSON.stringify({ level: "info", msg: "shutting down", signal: sig }));
    db.close();
    process.exit(0);
  });
}
