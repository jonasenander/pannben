#!/usr/bin/env node
/**
 * Blocks anything describing the real deployment from entering a public repo.
 *
 * Runs as a pre-commit hook over staged content, and in CI over the whole tree.
 * An intentional exception needs an inline `privacy-check:allow <reason>`
 * comment on the same line, so every bypass is visible in the diff.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";

const RULES = [
  { name: "tailnet hostname", re: /\b[\w-]+\.[\w-]+\.ts\.net\b/gi },
  { name: "Tailscale CGNAT IP", re: /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g },
  // Each range spelled out to a full four octets — "10.6.0" in a lockfile is a
  // version string, not an address, and must not trip the gate.
  {
    name: "LAN IP",
    re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
  },
  { name: "Synology share path", re: /\/volume\d+\//g },
  { name: "email address", re: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g },
  { name: "NAS model number", re: /\b(?:DS|RS)\d{3,4}(?:\+|play|j|xs)?\b/g },
  { name: "Tailscale auth key", re: /\btskey-[A-Za-z0-9-]+/g },
  { name: "GitHub token", re: /\b(?:ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]{10,}/g },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "private key block", re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g },
];

// Documentation placeholders and loopback are not secrets.
const ALLOW = [
  /^127\.0\.0\.1$/, /^0\.0\.0\.0$/,
  /^your-nas\.your-tailnet\.ts\.net$/i,
  /^<nas>\.<tailnet>\.ts\.net$/i,
  /^nas\.tailnet-name\.ts\.net$/i,
  /^noreply@anthropic\.com$/i,
  /^[\w.+-]+@users\.noreply\.github\.com$/i,
];
// Note: share paths are never allowlisted. Docs use ${PANNBEN_DATA_DIR}.

const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|\.vite|backups|screenshots)(\/|$)/;
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|sqlite|db)$/i;

const staged = process.argv.includes("--staged");

function filesToCheck() {
  if (staged) {
    return execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" })
      .split("\n").filter(Boolean);
  }
  return execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
}

const findings = [];

for (const file of filesToCheck()) {
  if (SKIP_DIRS.test(file) || BINARY.test(file)) continue;
  if (!existsSync(file) || statSync(file).isDirectory()) continue;

  const content = staged
    ? execSync(`git show :${JSON.stringify(file)}`, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    : readFileSync(file, "utf8");

  content.split("\n").forEach((line, i) => {
    if (line.includes("privacy-check:allow")) return;
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      for (const m of line.matchAll(rule.re)) {
        if (ALLOW.some((a) => a.test(m[0]))) continue;
        findings.push({ file, line: i + 1, rule: rule.name, match: m[0] });
      }
    }
  });
}

if (findings.length === 0) {
  console.log(`privacy-check: clean (${staged ? "staged changes" : "whole tree"})`);
  process.exit(0);
}

console.error("\nprivacy-check FAILED — this repo is public.\n");
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  ${f.rule}: ${f.match}`);
}
console.error(`
${findings.length} finding(s). Move real values into .env (gitignored) and use a
placeholder here, or add an inline "privacy-check:allow <reason>" comment if the
match is genuinely harmless.
`);
process.exit(1);
