#!/usr/bin/env node
/** Installs the pre-commit privacy gate. Runs from `npm install`. */
import { writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

if (!existsSync(".git")) process.exit(0);

const dir = join(".git", "hooks");
mkdirSync(dir, { recursive: true });

const hook = `#!/bin/sh
# Pannben privacy gate — blocks real hostnames, IPs, share paths and secrets.
exec node scripts/privacy-check.mjs --staged
`;

const path = join(dir, "pre-commit");
writeFileSync(path, hook, "utf8");
chmodSync(path, 0o755);
console.log("privacy-check installed as .git/hooks/pre-commit");
