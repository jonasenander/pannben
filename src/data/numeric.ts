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

/**
 * Parse a duration.
 *
 * Two forms, and the distinction is whether there is a separator: `20:00` is
 * minutes and seconds, a bare `1200` is seconds.
 *
 * **`.` and `,` count as separators too, exactly like `:`.** A phone's numeric
 * keypad has no colon on it — iOS `inputmode="numeric"` offers digits alone and
 * `inputmode="decimal"` adds only the locale's decimal key, which on a Swedish
 * phone is a comma. Insisting on a colon would make the field unusable on the
 * one device this app is built for. So `20,00`, `20.00` and `20:00` are the
 * same twenty minutes, and the part after the separator is always seconds —
 * `1,5` is 1:05, not a minute and a half. The row redisplays it as `1:05`
 * immediately, so a wrong guess corrects itself in front of you.
 *
 * Returns whole seconds, which is what the schema stores.
 */
const DURATION_SEPARATOR = /[:.,]/;

export function parseDuration(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!DURATION_SEPARATOR.test(trimmed)) return parseCount(trimmed);

  const parts = trimmed.split(DURATION_SEPARATOR);
  if (parts.length > 3) return null;
  if (!parts.every((p) => INTEGER.test(p))) return null;

  // Seconds and minutes are positional fields, not free numbers: "1:90" is a
  // typo for "2:30", and silently accepting it would store the typo.
  const [seconds, minutes, hours] = parts.reverse().map(Number) as [number, number, number?];
  if (seconds > 59) return null;
  if (parts.length === 3 && minutes > 59) return null;

  return (hours ?? 0) * 3600 + minutes * 60 + seconds;
}

/**
 * Render seconds as `M:SS`, growing an hours field only when there is one.
 *
 * Seconds alone were the first version, and "1200" is not a length of time
 * anybody reads at a glance mid-workout.
 */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const s = whole % 60;
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
