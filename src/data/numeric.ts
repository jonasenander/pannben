/**
 * Numeric parsing for every value a person types into Pannben.
 *
 * A Swedish phone keypad produces a comma as the decimal separator; a laptop
 * keyboard produces a point. Both mean the same weight, so both are accepted
 * here rather than hoped for in the UI. Anything else is rejected outright —
 * a swallowed parse failure in the write path is silent data loss, which is
 * the one failure mode this app has no redundancy for.
 */

/** Two decimals is enough for 0.25 kg plate maths and keeps floats honest. */
const PRECISION = 2;

const DECIMAL = /^\d+(?:[.,]\d+)?$/;
const INTEGER = /^\d+$/;

/**
 * Parse a weight, distance, speed or duration.
 * Returns null when the input is not a plain non-negative decimal.
 */
export function parseDecimal(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? round(raw) : null;
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!DECIMAL.test(trimmed)) return null;

  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? round(value) : null;
}

/**
 * Parse a count — reps, rounds, sets. Whole numbers only: half a rep is a
 * typo, not a measurement.
 */
export function parseCount(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  return INTEGER.test(trimmed) ? Number(trimmed) : null;
}

/** Render a stored number without inventing trailing zeros. */
export function formatDecimal(value: number): string {
  return String(round(value));
}

function round(value: number): number {
  const factor = 10 ** PRECISION;
  return Math.round(value * factor) / factor;
}
