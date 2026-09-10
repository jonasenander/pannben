import type { Database } from "better-sqlite3";

export interface Migration {
  /** Numeric prefix of the file, e.g. 1 for 001_init.sql. */
  version: number;
  name: string;
  sql: string;
}

/**
 * Apply every migration newer than the recorded schema version, each inside its
 * own transaction. A failing migration rolls back and throws — a half-applied
 * schema is worse than a stopped container.
 */
export function migrate(db: Database, migrations: Migration[]): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = new Set<number>(
    db.prepare("SELECT version FROM schema_migrations").all().map((r: any) => r.version as number),
  );

  const pending = migrations
    .filter((m) => !applied.has(m.version))
    .sort((a, b) => a.version - b.version);

  const record = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, datetime('now'))",
  );

  for (const m of pending) {
    const run = db.transaction(() => {
      db.exec(m.sql);
      record.run(m.version, m.name);
    });
    try {
      run();
    } catch (cause) {
      throw new Error(`migration ${m.version} (${m.name}) failed: ${(cause as Error).message}`, {
        cause,
      });
    }
  }

  return schemaVersion(db);
}

export function schemaVersion(db: Database): number {
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  return row?.v ?? 0;
}

/** Parse `001_init.sql` into a version and a name. Throws on an unnumbered file. */
export function parseMigrationName(filename: string): { version: number; name: string } {
  const match = /^(\d+)[._-](.+)\.sql$/.exec(filename);
  if (!match) throw new Error(`migration filename must be <number>_<name>.sql, got: ${filename}`);
  return { version: Number(match[1]), name: match[2]! };
}
