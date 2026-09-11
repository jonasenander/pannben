#!/usr/bin/env node
/**
 * Nightly snapshot. `VACUUM INTO` produces a consistent copy of a live WAL
 * database, which a plain file copy does not — Hyper Backup then picks up the
 * snapshot rather than a possibly-torn pannben.db.
 *
 * Exports the work rather than only doing it, so scripts/backup-loop.mjs can
 * call it on a schedule in-process. Run directly (`npm run backup`) it still
 * takes one snapshot and exits.
 */
import Database from "better-sqlite3";
import { mkdirSync, readdirSync, rmSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const SNAPSHOT = /^pannben-\d{4}-\d{2}-\d{2}\.sqlite$/;

/**
 * Take one snapshot and prune old ones.
 *
 * Returns the log record, or null when there is no database to copy yet — a
 * fresh deployment can start this before the app has ever opened one, and a
 * backup that has nothing to back up is not a failure.
 */
export function runBackup({
  dataDir = process.env.PANNBEN_DATA_DIR ?? join(process.cwd(), "data"),
  keep = Number(process.env.PANNBEN_BACKUP_KEEP ?? 14),
  now = new Date(),
} = {}) {
  const backups = join(dataDir, "backups");
  const source = join(dataDir, "pannben.db");

  if (!existsSync(source)) return null;

  mkdirSync(backups, { recursive: true });

  const stamp = now.toISOString().slice(0, 10);
  const target = join(backups, `pannben-${stamp}.sqlite`);

  rmSync(target, { force: true });

  const db = new Database(source, { readonly: true });
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  const kept = readdirSync(backups)
    .filter((f) => SNAPSHOT.test(f))
    .sort()
    .reverse();

  for (const stale of kept.slice(keep)) rmSync(join(backups, stale), { force: true });

  return {
    level: "info",
    msg: "backup written",
    file: target,
    bytes: statSync(target).size,
    kept: Math.min(kept.length, keep),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runBackup();
  console.log(
    JSON.stringify(result ?? { level: "warn", msg: "no database to back up yet" }),
  );
}
