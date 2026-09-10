/**
 * UUIDv7 — a time-ordered UUID.
 *
 * IDs are minted on the client so a row created with no signal owns its final
 * identity immediately; there is no server-side reconciliation step and no
 * temporary id to rewrite once the outbox drains. Time-ordering means rows sort
 * by creation without a separate column, and index inserts stay at the hot end
 * of the btree rather than scattering like a v4 would.
 *
 * Layout (RFC 9562):
 *   48 bits  unix milliseconds, big-endian
 *    4 bits  version (7)
 *   12 bits  sub-millisecond counter, for monotonicity within one tick
 *    2 bits  variant (0b10)
 *   62 bits  random
 */

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

let lastMs = -1;
let counter = 0;

export interface UuidOptions {
  /** Injectable for tests; defaults to the wall clock. */
  now?: () => number;
  /** Injectable for tests; must fill the array with random bytes. */
  randomBytes?: (into: Uint8Array) => void;
}

const defaultRandom = (into: Uint8Array): void => {
  crypto.getRandomValues(into);
};

export function uuidv7(opts: UuidOptions = {}): string {
  const now = opts.now ?? Date.now;
  const random = opts.randomBytes ?? defaultRandom;

  const ms = now();

  // Within the same millisecond, keep counting up so ids stay strictly
  // ordered. 12 bits is 4096 per ms — far more than this app can produce.
  if (ms === lastMs) {
    counter += 1;
    if (counter > 0xfff) counter = 0xfff; // saturate rather than wrap backwards
  } else {
    lastMs = ms;
    counter = 0;
  }

  const b = new Uint8Array(16);
  random(b);

  b[0] = (ms / 2 ** 40) & 0xff;
  b[1] = (ms / 2 ** 32) & 0xff;
  b[2] = (ms / 2 ** 24) & 0xff;
  b[3] = (ms / 2 ** 16) & 0xff;
  b[4] = (ms / 2 ** 8) & 0xff;
  b[5] = ms & 0xff;

  b[6] = 0x70 | ((counter >>> 8) & 0x0f); // version 7 + counter high nibble
  b[7] = counter & 0xff;
  b[8] = 0x80 | (b[8]! & 0x3f); // variant 0b10

  const h = (i: number) => HEX[b[i]!]!;
  return (
    h(0) + h(1) + h(2) + h(3) + "-" +
    h(4) + h(5) + "-" +
    h(6) + h(7) + "-" +
    h(8) + h(9) + "-" +
    h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** True for a well-formed v7 UUID. Used to reject client-supplied junk ids. */
export function isUuidv7(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** The embedded creation time, for assertions and debugging. */
export function uuidv7Time(id: string): number {
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
