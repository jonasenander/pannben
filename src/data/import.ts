import type { Database } from "better-sqlite3";
import type { Clock } from "./clock.js";
import { schemaVersion } from "./migrate.js";
import type { ExportFile } from "./export.js";

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export interface ImportResult {
  /** Rows written, per table. */
  rows: Record<string, number>;
  /** Tables in the file that this schema no longer has. */
  tables_skipped: string[];
  /** `table.column` pairs in the file that this schema no longer has. */
  columns_skipped: string[];
  schema_version: number;
  exported_at: string;
}

/**
 * The migration history describes the running binary, not the data.
 *
 * Importing a v3 export's `schema_migrations` into a v5 database would leave it
 * claiming to be at v3 while holding v5 tables, and the next startup would try
 * to apply migrations 4 and 5 again.
 */
const NEVER_IMPORTED = new Set(["schema_migrations"]);

/**
 * Replace everything in the database with the contents of an export.
 *
 * Replace-all is the only mode. Merge semantics would need ID-collision
 * handling and a rule for which side wins per row — real work, for a
 * single-user restore where the answer is always "the file".
 */
export function importAll(db: Database, file: ExportFile, clock: Clock): ImportResult {
  // The clock is deliberately unused: an import writes nothing of its own.
  //
  // The first version stamped `restored_at` into app_meta, which is useful
  // right up until you notice it makes export → import → export non-identical.
  // That round trip is the only proof a restore is lossless, so the marker
  // went and the guarantee stayed; the import result carries the same
  // information back to the screen that asked for it.
  void clock;

  const parsed = validate(file);
  const running = schemaVersion(db);

  if (parsed.schema_version > running) {
    throw new ImportError(
      `this export is from schema v${parsed.schema_version} and the app is running v${running} — `
      + "update Pannben before restoring it",
    );
  }

  // Tables and columns as they exist *now*. An older export may name things
  // that have since been dropped, and this is where they are noticed.
  const present = new Map<string, Set<string>>();
  for (const { name } of db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all() as { name: string }[]) {
    const cols = (db.pragma(`table_info("${quote(name)}")`) as { name: string }[]).map((c) => c.name);
    present.set(name, new Set(cols));
  }

  const rows: Record<string, number> = {};
  const tablesSkipped: string[] = [];
  const columnsSkipped: string[] = [];

  const run = db.transaction(() => {
    // Foreign keys are enforced at commit rather than per statement, so neither
    // the wipe nor the reload has to happen in dependency order — and a file
    // whose references do not line up still fails, just at the end.
    db.pragma("defer_foreign_keys = ON");

    for (const name of present.keys()) {
      if (NEVER_IMPORTED.has(name)) continue;
      db.prepare(`DELETE FROM "${quote(name)}"`).run();
    }

    for (const [name, tableRows] of Object.entries(parsed.tables)) {
      if (NEVER_IMPORTED.has(name)) continue;

      const columns = present.get(name);
      if (!columns) {
        tablesSkipped.push(name);
        continue;
      }
      if (!Array.isArray(tableRows)) {
        throw new ImportError(`table "${name}" is not a list of rows`);
      }

      rows[name] = 0;
      let insert: ReturnType<Database["prepare"]> | null = null;
      let signature = "";

      for (const row of tableRows as Record<string, unknown>[]) {
        if (row === null || typeof row !== "object") {
          throw new ImportError(`table "${name}" holds something that is not a row`);
        }

        const keys = Object.keys(row).filter((k) => {
          if (columns.has(k)) return true;
          const label = `${name}.${k}`;
          if (!columnsSkipped.includes(label)) columnsSkipped.push(label);
          return false;
        });

        if (keys.length === 0) throw new ImportError(`a row in "${name}" has no usable columns`);

        // Rows in one table usually share a shape; only re-prepare when it changes.
        const shape = keys.join(",");
        if (shape !== signature) {
          signature = shape;
          insert = db.prepare(
            `INSERT INTO "${quote(name)}" (${keys.map((k) => `"${quote(k)}"`).join(",")})
             VALUES (${keys.map((k) => `@${k}`).join(",")})`,
          );
        }

        insert!.run(Object.fromEntries(keys.map((k) => [k, toSqlite(row[k])])));
        rows[name] += 1;
      }
    }
  });

  try {
    run();
  } catch (cause) {
    if (cause instanceof ImportError) throw cause;
    const failure = new ImportError(
      `the import was rolled back — nothing changed: ${(cause as Error).message}`,
    );
    failure.cause = cause;
    throw failure;
  }

  return {
    rows,
    tables_skipped: tablesSkipped,
    columns_skipped: columnsSkipped,
    schema_version: parsed.schema_version,
    exported_at: parsed.exported_at,
  };
}

function validate(file: unknown): ExportFile {
  if (file === null || typeof file !== "object") {
    throw new ImportError("that is not a Pannben export");
  }
  const f = file as Partial<ExportFile>;
  if (f.format !== "pannben-export") {
    throw new ImportError("that is not a Pannben export — the format marker is missing");
  }
  if (typeof f.schema_version !== "number" || !Number.isInteger(f.schema_version)) {
    throw new ImportError("the export does not say which schema it came from");
  }
  if (f.tables === null || typeof f.tables !== "object") {
    throw new ImportError("the export has no tables in it");
  }
  return f as ExportFile;
}

/** SQLite takes numbers, strings, null and buffers. Booleans arrive from JSON. */
function toSqlite(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  if (value !== null && typeof value === "object") {
    throw new ImportError(`cannot store ${JSON.stringify(value)} in a column`);
  }
  return value;
}

const quote = (identifier: string) => identifier.replace(/"/g, '""');
