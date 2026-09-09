import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, health, loadMigrations } from "../src/data/db.js";

const MIGRATIONS = new URL("../migrations", import.meta.url).pathname;
const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "pannben-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("openDb", () => {
  it("creates the file and its parent directory on first run", () => {
    const file = join(scratch(), "nested", "pannben.db");
    const db = openDb({ file, migrationsDir: MIGRATIONS });
    expect(existsSync(file)).toBe(true);
    db.close();
  });

  it("applies the shipped migrations and reports the version", () => {
    const db = openDb({ file: ":memory:", migrationsDir: MIGRATIONS });
    const expected = loadMigrations(MIGRATIONS).length;
    expect(health(db).schemaVersion).toBe(expected);
    expect(expected).toBeGreaterThan(0);
    db.close();
  });

  it("reopens an existing database without reapplying migrations", () => {
    const file = join(scratch(), "pannben.db");
    const first = openDb({ file, migrationsDir: MIGRATIONS });
    const version = health(first).schemaVersion;
    first.close();

    const second = openDb({ file, migrationsDir: MIGRATIONS });
    expect(health(second).schemaVersion).toBe(version);
    second.close();
  });

  it("runs in WAL mode so a snapshot can be taken while the app is live", () => {
    const file = join(scratch(), "pannben.db");
    const db = openDb({ file, migrationsDir: MIGRATIONS });
    expect(health(db).walMode.toLowerCase()).toBe("wal");
    db.close();
  });
});

describe("health", () => {
  it("reports a real size and table count", () => {
    const db = openDb({ file: ":memory:", migrationsDir: MIGRATIONS });
    const h = health(db);
    expect(h.dbBytes).toBeGreaterThan(0);
    expect(h.tables).toBeGreaterThan(0);
    db.close();
  });
});
