import { describe, it, expect } from "vitest";
import { parseDecimal, parseCount, formatDecimal } from "../src/data/numeric.js";

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
