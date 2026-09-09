import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The privacy gate is the thing standing between a public repo and the details
 * of a private NAS, so it gets tested like any other data-layer rule: planted
 * values must fail, and legitimate lookalikes must not.
 */
const SCRIPT = new URL("../scripts/privacy-check.mjs", import.meta.url).pathname;

function scan(content: string): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "pannben-pc-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(join(dir, "f.md"), content);
    execFileSync("git", ["add", "f.md"], { cwd: dir });
    try {
      const out = execFileSync("node", [SCRIPT, "--staged"], { cwd: dir, encoding: "utf8" });
      return { code: 0, out };
    } catch (err: any) {
      return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("privacy-check catches", () => {
  const caught: [string, string][] = [
    ["tailnet hostname", "host: my-nas.tail1a2b3.ts.net"], // privacy-check:allow synthetic test fixture
    ["Tailscale CGNAT IP", "ip: 100.94.12.7"], // privacy-check:allow synthetic test fixture
    ["LAN IP", "lan: 192.168.1.42"], // privacy-check:allow synthetic test fixture
    ["LAN IP", "lan: 10.0.1.7"], // privacy-check:allow synthetic test fixture
    ["Synology share path", "path: /volume1/docker/pannben"], // privacy-check:allow synthetic test fixture
    ["NAS model number", "model: DS923+"], // privacy-check:allow synthetic test fixture
    ["email address", "me: someone@example.com"], // privacy-check:allow synthetic test fixture
    ["Tailscale auth key", "key: tskey-auth-aBcDeF-0123456789abcdef"], // privacy-check:allow synthetic test fixture
    ["GitHub token", "tok: ghp_AbCdEf0123456789AbCdEf0123456789AbCd"], // privacy-check:allow synthetic test fixture
    ["private key block", "-----BEGIN OPENSSH PRIVATE KEY-----"], // privacy-check:allow synthetic test fixture
  ];
  for (const [rule, line] of caught) {
    it(`${rule}: ${line.slice(0, 34)}`, () => {
      const r = scan(line);
      expect(r.code, `expected a failure for ${JSON.stringify(line)}`).toBe(1);
      expect(r.out).toContain(rule);
    });
  }
});

describe("privacy-check allows", () => {
  const allowed: [string, string][] = [
    ["loopback", "bind 127.0.0.1:8080"],
    ["all interfaces", "host 0.0.0.0"],
    ["placeholder host", "PANNBEN_HOSTNAME=your-nas.your-tailnet.ts.net"],
    ["docs placeholder", "open https://<nas>.<tailnet>.ts.net"],
    ["noreply commit address", "Co-Authored-By: x <x@users.noreply.github.com>"],
    ["semver that resembles an IP", '"version": "10.6.0"'],
    ["explicit escape", "internal 10.0.0.5 # privacy-check:allow example in an ADR"], // privacy-check:allow synthetic test fixture
  ];
  for (const [what, line] of allowed) {
    it(what, () => {
      const r = scan(line);
      expect(r.code, `expected ${JSON.stringify(line)} to pass:\n${r.out}`).toBe(0);
    });
  }
});
