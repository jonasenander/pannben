/**
 * Clock access sits behind an interface so session timing is testable without
 * waiting for real seconds to pass.
 */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  /** An ISO-8601 UTC instant — how every timestamp is stored. */
  nowIso(): string;
  /**
   * The local calendar date in `zone`, as YYYY-MM-DD. A session that starts
   * 23:40 and ends 00:20 belongs to the day it started, so this is taken once
   * at session start rather than derived from a UTC timestamp later.
   */
  today(zone: string): string;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
  today: (zone) => localDate(new Date(), zone),
};

/** A clock frozen at a fixed instant, for tests. */
export function fixedClock(iso: string): Clock {
  const at = new Date(iso);
  return {
    now: () => at.getTime(),
    nowIso: () => at.toISOString(),
    today: (zone) => localDate(at, zone),
  };
}

function localDate(at: Date, zone: string): string {
  // en-CA renders as YYYY-MM-DD, which is the format we store.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
