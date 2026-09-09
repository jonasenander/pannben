import { describe, it, expect } from "vitest";
import { fixedClock } from "../src/data/clock.js";

describe("clock", () => {
  it("stores instants as ISO-8601 UTC", () => {
    expect(fixedClock("2026-09-09T21:40:00Z").nowIso()).toBe("2026-09-09T21:40:00.000Z");
  });

  it("gives a session started 23:40 local the day it started, not the UTC day", () => {
    // 21:40Z is 23:40 in Stockholm (CEST, UTC+2) — still the 9th locally.
    expect(fixedClock("2026-09-09T21:40:00Z").today("Europe/Stockholm")).toBe("2026-09-09");
  });

  it("rolls the local date over at local midnight, not at 00:00Z", () => {
    // 22:30Z is 00:30 on the 10th in Stockholm.
    expect(fixedClock("2026-09-09T22:30:00Z").today("Europe/Stockholm")).toBe("2026-09-10");
    // and the same instant is still the 9th in UTC
    expect(fixedClock("2026-09-09T22:30:00Z").today("UTC")).toBe("2026-09-09");
  });

  it("handles winter time too", () => {
    // 23:30Z in January is 00:30 on the 10th in Stockholm (CET, UTC+1).
    expect(fixedClock("2026-01-09T23:30:00Z").today("Europe/Stockholm")).toBe("2026-01-10");
  });
});
