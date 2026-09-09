import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { openDb, health } from "../data/db.js";
import { systemClock } from "../data/clock.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

const DATA_DIR = process.env.PANNBEN_DATA_DIR ?? join(root, "data");
const PORT = Number(process.env.PANNBEN_PORT ?? 8225);
const ZONE = process.env.TZ ?? "Europe/Stockholm";
// Loopback by default. Tailscale Serve fronts this; the container never binds
// the LAN interface. See docs/decisions/0002-transport-and-access.md.
const HOST = process.env.PANNBEN_HOST ?? "127.0.0.1";

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
    schemaVersion: h.schemaVersion,
    dbBytes: h.dbBytes,
    tables: h.tables,
    walMode: h.walMode,
    zone: ZONE,
    today: systemClock.today(ZONE),
    serverTime: systemClock.nowIso(),
  });
});

// The built client. In dev, Vite serves this and proxies /api here instead.
const clientDir = join(root, "dist/client");
if (existsSync(clientDir)) {
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
