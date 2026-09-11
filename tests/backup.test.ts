import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no types, same as privacy-check.test.ts
import { msUntilNext } from "../scripts/backup-loop.mjs";
// @ts-expect-error — plain .mjs script
import { newestAgeMs } from "../scripts/backup-health.mjs";

/*
 * The bug these cover: the schedule used to live in a shell one-liner inside a
 * YAML block scalar, computed with `date -d "tomorrow 03:00"`. On alpine that
 * is BusyBox date, which rejects it — so the sleep went negative, sleep refused
 * it, and the container ran VACUUM INTO in a tight loop for ten hours instead
 * of once a night. Nothing could have caught it, because nothing could call it.
 */
describe("msUntilNext", () => {
  const at = (iso: string) => new Date(iso);

  it("waits until later today when the hour is still ahead", () => {
    // 01:00 local → 03:00 local is two hours away.
    const ms = msUntilNext(3, 0, at("2026-09-11T01:00:00"));
    expect(ms).toBe(2 * 3600 * 1000);
  });

  it("rolls to tomorrow once the hour has passed", () => {
    // 08:14, which is when the broken loop was found spinning.
    const ms = msUntilNext(3, 0, at("2026-09-11T08:14:00"));
    expect(ms).toBe(18 * 3600 * 1000 + 46 * 60 * 1000);
  });

  it("never returns zero or less, so a run cannot re-fire instantly", () => {
    // Exactly 03:00 means tomorrow, not now. This is the property that turns a
    // scheduled loop into a hot one when it is wrong.
    expect(msUntilNext(3, 0, at("2026-09-11T03:00:00"))).toBe(24 * 3600 * 1000);

    for (const h of [0, 3, 12, 23]) {
      for (const iso of ["2026-09-11T00:00:00", "2026-09-11T03:00:00", "2026-09-11T23:59:59"]) {
        expect(msUntilNext(h, 0, at(iso))).toBeGreaterThan(0);
      }
    }
  });

  it("stays within a day", () => {
    for (let h = 0; h < 24; h++) {
      const ms = msUntilNext(3, 0, at(`2026-09-11T${String(h).padStart(2, "0")}:30:00`));
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(24 * 3600 * 1000);
    }
  });
});

describe("newestAgeMs", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pannben-backup-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const snapshot = (name: string, ageMs: number) => {
    mkdirSync(join(dir, "backups"), { recursive: true });
    const file = join(dir, "backups", name);
    writeFileSync(file, "x");
    const when = (Date.now() - ageMs) / 1000;
    utimesSync(file, when, when);
  };

  it("is null when there is no backups directory at all", () => {
    expect(newestAgeMs(dir)).toBeNull();
  });

  it("is null when the directory holds nothing that looks like a snapshot", () => {
    mkdirSync(join(dir, "backups"), { recursive: true });
    writeFileSync(join(dir, "backups", "notes.txt"), "x");
    expect(newestAgeMs(dir)).toBeNull();
  });

  it("reports the newest snapshot, not the first one read", () => {
    snapshot("pannben-2026-09-09.sqlite", 48 * 3600 * 1000);
    snapshot("pannben-2026-09-11.sqlite", 60 * 1000);
    const age = newestAgeMs(dir)!;
    expect(age).toBeLessThan(5 * 60 * 1000);
  });

  it("reports a stale snapshot as stale, which is the whole point", () => {
    snapshot("pannben-2026-09-01.sqlite", 72 * 3600 * 1000);
    const age = newestAgeMs(dir)!;
    expect(age).toBeGreaterThan(26 * 3600 * 1000);
  });
});
