import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate, schemaVersion, parseMigrationName } from "../src/data/migrate.js";

const m = (version: number, name: string, sql: string) => ({ version, name, sql });

describe("migrate", () => {
  it("starts an empty database at version 0", () => {
    const db = new Database(":memory:");
    expect(migrate(db, [])).toBe(0);
    expect(schemaVersion(db)).toBe(0);
  });

  it("applies migrations in order regardless of array order", () => {
    const db = new Database(":memory:");
    migrate(db, [
      m(2, "add_col", "ALTER TABLE t ADD COLUMN b TEXT;"),
      m(1, "init", "CREATE TABLE t (a TEXT) STRICT;"),
    ]);
    expect(schemaVersion(db)).toBe(2);
    const cols = db.prepare("PRAGMA table_info(t)").all().map((c: any) => c.name);
    expect(cols).toEqual(["a", "b"]);
  });

  it("is idempotent — running twice applies nothing the second time", () => {
    const db = new Database(":memory:");
    const list = [m(1, "init", "CREATE TABLE t (a TEXT) STRICT;")];
    migrate(db, list);
    expect(() => migrate(db, list)).not.toThrow();
    expect(schemaVersion(db)).toBe(1);
  });

  it("applies only what is pending when a new migration appears", () => {
    const db = new Database(":memory:");
    migrate(db, [m(1, "init", "CREATE TABLE t (a TEXT) STRICT;")]);
    db.prepare("INSERT INTO t (a) VALUES ('keep me')").run();
    migrate(db, [
      m(1, "init", "CREATE TABLE t (a TEXT) STRICT;"),
      m(2, "add_col", "ALTER TABLE t ADD COLUMN b TEXT;"),
    ]);
    expect(schemaVersion(db)).toBe(2);
    expect(db.prepare("SELECT a FROM t").get()).toEqual({ a: "keep me" });
  });

  it("rolls back a failing migration and leaves the version untouched", () => {
    const db = new Database(":memory:");
    migrate(db, [m(1, "init", "CREATE TABLE t (a TEXT) STRICT;")]);
    expect(() =>
      migrate(db, [
        m(1, "init", "CREATE TABLE t (a TEXT) STRICT;"),
        m(2, "broken", "CREATE TABLE ok (x TEXT) STRICT; THIS IS NOT SQL;"),
      ]),
    ).toThrow(/migration 2 \(broken\) failed/);

    expect(schemaVersion(db)).toBe(1);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name);
    expect(tables).not.toContain("ok");
  });
});

describe("parseMigrationName", () => {
  it("reads the version and name off the filename", () => {
    expect(parseMigrationName("001_init.sql")).toEqual({ version: 1, name: "init" });
    expect(parseMigrationName("017_add_body_metrics.sql")).toEqual({
      version: 17,
      name: "add_body_metrics",
    });
  });

  it("refuses an unnumbered migration rather than guessing its order", () => {
    expect(() => parseMigrationName("init.sql")).toThrow(/<number>_<name>\.sql/);
  });
});
