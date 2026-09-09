import Database, { type Database as Db } from "better-sqlite3";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { migrate, parseMigrationName, schemaVersion, type Migration } from "./migrate.js";

export interface DbOptions {
  /** Absolute path to the SQLite file, or ":memory:" in tests. */
  file: string;
  /** Directory holding numbered .sql migrations. */
  migrationsDir: string;
}

/**
 * Open the database, apply pending migrations, and return the handle.
 *
 * WAL mode is what makes the nightly `VACUUM INTO` snapshot safe to take while
 * the app is running — Hyper Backup then copies a consistent file rather than a
 * possibly-torn live one.
 */
export function openDb({ file, migrationsDir }: DbOptions): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  migrate(db, loadMigrations(migrationsDir));
  return db;
}

export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => {
      const { version, name } = parseMigrationName(f);
      return { version, name, sql: readFileSync(join(dir, f), "utf8") };
    })
    .sort((a, b) => a.version - b.version);
}

export interface Health {
  schemaVersion: number;
  /** Bytes on disk, derived from SQLite's own page accounting. */
  dbBytes: number;
  tables: number;
  walMode: string;
}

export function health(db: Db): Health {
  const pageCount = (db.pragma("page_count", { simple: true }) as number) ?? 0;
  const pageSize = (db.pragma("page_size", { simple: true }) as number) ?? 0;
  const tables = db
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .get() as { n: number };

  return {
    schemaVersion: schemaVersion(db),
    dbBytes: pageCount * pageSize,
    tables: tables.n,
    walMode: String(db.pragma("journal_mode", { simple: true })),
  };
}
