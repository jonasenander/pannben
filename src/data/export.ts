import type { Database } from "better-sqlite3";
import { schemaVersion } from "./migrate.js";
import type { Clock } from "./clock.js";

export interface ExportFile {
  format: "pannben-export";
  schema_version: number;
  app_version: string;
  exported_at: string;
  tables: Record<string, unknown[]>;
}

/**
 * Dump every table to JSON.
 *
 * Tables are discovered from sqlite_master rather than listed here, so this
 * keeps covering new tables as later phases add them — there is no separate
 * list to forget to update, which is exactly how an export quietly starts
 * missing data.
 *
 * Soft-deleted rows are included. This is a backup, not a view: an export that
 * silently dropped rows would be worse than useless at restore time.
 *
 * `appVersion` defaults to "unknown" rather than to a version number. The
 * server always passes the real one; a caller that does not (a test, a script)
 * should say so in the file rather than stamp it with a number that was true
 * once and then quietly stopped being true.
 */
export function exportAll(db: Database, clock: Clock, appVersion = "unknown"): ExportFile {
  const tables: Record<string, unknown[]> = {};

  const names = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as { name: string }[];

  for (const { name } of names) {
    // Identifier, not a value — quoted rather than bound, and the source is
    // sqlite_master rather than anything a user typed.
    tables[name] = db.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).all();
  }

  return {
    format: "pannben-export",
    schema_version: schemaVersion(db),
    app_version: appVersion,
    exported_at: clock.nowIso(),
    tables,
  };
}

/** Row counts per table, for the settings screen. */
export function exportSummary(db: Database): Record<string, number> {
  const out: Record<string, number> = {};
  const names = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all() as { name: string }[];

  for (const { name } of names) {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`)
      .get() as { n: number };
    out[name] = row.n;
  }
  return out;
}
