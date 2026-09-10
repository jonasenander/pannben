import { describe, it, expect } from "vitest";
import {
  parseDecimal, parseCount, formatDecimal, parseDuration, formatDuration,
} from "../src/data/numeric.js";

describe("parseDecimal", () => {
  it("accepts a point, as a keyboard with a point produces", () => {
    expect(parseDecimal("82.6")).toBe(82.6);
  });

  it("accepts a comma, as a Swedish keypad produces", () => {
    expect(parseDecimal("82,6")).toBe(82.6);
  });

  it("keeps 0.25 kg increments intact", () => {
    expect(parseDecimal("22,25")).toBe(22.25);
    expect(parseDecimal("142.75")).toBe(142.75);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseDecimal("  60,5 ")).toBe(60.5);
  });

  it("rejects rather than guessing", () => {
    for (const bad of ["", "   ", "abc", "8,2,6", "-5", "1e3", "NaN", "∞"]) {
      expect(parseDecimal(bad), `expected ${JSON.stringify(bad)} to be rejected`).toBeNull();
    }
  });

  it("rounds to two decimals so floats never drift into the database", () => {
    expect(parseDecimal("0,1")).toBe(0.1);
    expect(parseDecimal("22,255")).toBe(22.26);
  });
});

describe("parseCount", () => {
  it("takes whole reps", () => {
    expect(parseCount("10")).toBe(10);
    expect(parseCount(" 8 ")).toBe(8);
    expect(parseCount("0")).toBe(0);
  });

  it("refuses a fractional rep", () => {
    expect(parseCount("8.5")).toBeNull();
    expect(parseCount("8,5")).toBeNull();
  });

  it("refuses a negative count", () => {
    expect(parseCount("-3")).toBeNull();
  });
});

describe("formatDecimal", () => {
  it("does not pad whole numbers with a false decimal", () => {
    expect(formatDecimal(80)).toBe("80");
    expect(formatDecimal(22.5)).toBe("22.5");
    expect(formatDecimal(22.25)).toBe("22.25");
  });
});

describe("parseDuration", () => {
  it("takes M:SS, which is how a person says a running time", () => {
    expect(parseDuration("20:00")).toBe(1200);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("0:45")).toBe(45);
  });

  it("takes the decimal key as a separator, because a phone keypad has no colon", () => {
    // iOS offers digits and, at most, the locale decimal key — a comma here.
    // Demanding a colon would make the field unusable on the target device.
    expect(parseDuration("20,00")).toBe(1200);
    expect(parseDuration("20.00")).toBe(1200);
    expect(parseDuration("1,30")).toBe(90);
    // The part after the separator is seconds, never a fraction of a minute.
    expect(parseDuration("1,5")).toBe(65);
  });

  it("takes bare seconds too, so an old habit still works", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("1200")).toBe(1200);
  });

  it("takes H:MM:SS for a long one", () => {
    expect(parseDuration("1:05:30")).toBe(3930);
  });

  it("pads a lazy seconds field", () => {
    // "1:5" is unambiguous: one minute five seconds.
    expect(parseDuration("1:5")).toBe(65);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseDuration("  2:15 ")).toBe(135);
  });

  it("rejects rather than guessing", () => {
    for (const bad of ["", "abc", "1:", ":30", "1:2:3:4", "-1:00", "1:90", "1,60"]) {
      expect(parseDuration(bad), bad).toBeNull();
    }
  });

  it("accepts a number as seconds", () => {
    expect(parseDuration(90)).toBe(90);
    expect(parseDuration(0)).toBe(0);
    expect(parseDuration(1.5)).toBeNull(); // half a second is a typo
  });
});

describe("formatDuration", () => {
  it("always shows minutes and seconds", () => {
    expect(formatDuration(1200)).toBe("20:00");
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(45)).toBe("0:45");
    expect(formatDuration(0)).toBe("0:00");
  });

  it("grows an hours field only when there is one", () => {
    expect(formatDuration(3930)).toBe("1:05:30");
    expect(formatDuration(3599)).toBe("59:59");
  });

  it("round-trips with parseDuration", () => {
    for (const seconds of [0, 45, 90, 599, 1200, 3599, 3930, 7325]) {
      expect(parseDuration(formatDuration(seconds)), String(seconds)).toBe(seconds);
    }
  });
});
