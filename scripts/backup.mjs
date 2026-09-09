#!/usr/bin/env node
/**
 * Nightly snapshot. `VACUUM INTO` produces a consistent copy of a live WAL
 * database, which a plain file copy does not — Hyper Backup then picks up the
 * snapshot rather than a possibly-torn pannben.db.
 */
import Database from "better-sqlite3";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.PANNBEN_DATA_DIR ?? join(process.cwd(), "data");
const KEEP = Number(process.env.PANNBEN_BACKUP_KEEP ?? 14);
const backups = join(DATA_DIR, "backups");
const source = join(DATA_DIR, "pannben.db");

mkdirSync(backups, { recursive: true });

const stamp = new Date().toISOString().slice(0, 10);
const target = join(backups, `pannben-${stamp}.sqlite`);

rmSync(target, { force: true });

const db = new Database(source, { readonly: true });
try {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const kept = readdirSync(backups)
  .filter((f) => /^pannben-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
  .sort()
  .reverse();

for (const stale of kept.slice(KEEP)) rmSync(join(backups, stale), { force: true });

console.log(
  JSON.stringify({
    level: "info",
    msg: "backup written",
    file: target,
    bytes: statSync(target).size,
    kept: Math.min(kept.length, KEEP),
  }),
);
