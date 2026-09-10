import { describe, it, expect } from "vitest";
import { uuidv7, isUuidv7, uuidv7Time } from "../src/data/uuid.js";

describe("uuidv7", () => {
  it("is a well-formed v7 UUID", () => {
    for (let i = 0; i < 200; i++) expect(isUuidv7(uuidv7())).toBe(true);
  });

  it("carries version 7 and the RFC variant bits", () => {
    const id = uuidv7();
    expect(id[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("embeds the creation time", () => {
    const at = 1_772_000_000_000;
    expect(uuidv7Time(uuidv7({ now: () => at }))).toBe(at);
  });

  it("sorts lexicographically in creation order", () => {
    const ids = [0, 1, 2, 3, 4].map((i) => uuidv7({ now: () => 1_772_000_000_000 + i * 1000 }));
    expect([...ids].sort()).toEqual(ids);
  });

  it("stays strictly increasing inside a single millisecond", () => {
    const at = 1_772_000_000_000;
    // identical random bytes, so only the counter can separate them
    const fixed = (into: Uint8Array) => into.fill(0xab);
    const ids = Array.from({ length: 500 }, () => uuidv7({ now: () => at, randomBytes: fixed }));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not collide across many calls", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => uuidv7()));
    expect(ids.size).toBe(5000);
  });
});

describe("isUuidv7", () => {
  it("rejects anything that is not a v7 UUID", () => {
    const bad = [
      "",
      "not-a-uuid",
      "0195c8a0-0000-4000-8000-000000000000", // v4, not v7
      "0195c8a0-0000-7000-0000-000000000000", // bad variant
      "0195c8a0-0000-7000-8000-00000000000", // too short
      null,
      undefined,
      42,
      {},
    ];
    for (const b of bad) expect(isUuidv7(b), `expected ${JSON.stringify(b)} rejected`).toBe(false);
  });
});
