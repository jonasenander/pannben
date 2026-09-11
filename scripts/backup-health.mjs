#!/usr/bin/env node
/**
 * Is this container doing its job?
 *
 * The backup container used to inherit the image's HEALTHCHECK, which fetches
 * /api/health — inside a container that deliberately runs no server. It could
 * never pass, so it sat permanently unhealthy (a yellow "warning" in Synology
 * Container Manager) and said nothing at all about backups. A signal that is
 * always red is the same as no signal, except that it also hides the real one.
 *
 * Health here means what it should mean for this container: a snapshot exists
 * and is recent. 26 hours rather than 24, so a nightly job is not marked
 * unhealthy by an hour's drift or by the clocks going forward.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SNAPSHOT } from "./backup.mjs";

const DATA_DIR = process.env.PANNBEN_DATA_DIR ?? join(process.cwd(), "data");
const MAX_AGE_MS = Number(process.env.PANNBEN_BACKUP_MAX_AGE_H ?? 26) * 3600 * 1000;

/** The newest snapshot's age in ms, or null when there is none. */
export function newestAgeMs(dataDir = DATA_DIR, now = Date.now()) {
  const dir = join(dataDir, "backups");
  let newest = null;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!SNAPSHOT.test(name)) continue;
    const { mtimeMs } = statSync(join(dir, name));
    if (newest === null || mtimeMs > newest) newest = mtimeMs;
  }
  return newest === null ? null : now - newest;
}

/**
 * The probe runs only when this file is the process entry point.
 *
 * Without the guard, importing the module to test newestAgeMs runs the check
 * instead — and a check that fails calls process.exit(1), taking the test
 * runner with it. Exactly the mistake this file's sibling was written to avoid;
 * it wanted making twice before it stuck.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const age = newestAgeMs();
  if (age === null) {
    console.error("no snapshot yet");
    process.exit(1);
  } else if (age > MAX_AGE_MS) {
    console.error(`newest snapshot is ${Math.round(age / 3600000)}h old`);
    process.exit(1);
  } else {
    console.log(`newest snapshot is ${Math.round(age / 60000)}m old`);
  }
}
