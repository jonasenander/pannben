#!/usr/bin/env node
/**
 * Run the nightly snapshot on a schedule.
 *
 * This replaces a shell loop that computed its own sleep with
 * `date -d "tomorrow 03:00"`. The image is alpine, so `date` is BusyBox, which
 * accepts neither GNU relative strings nor the BSD `-v` fallback beside it.
 * Both branches failed, the substitution came back empty, the arithmetic went
 * hugely negative, `sleep` refused it, and the loop fell straight through to
 * the next backup — VACUUM INTO in a tight loop for as long as the container
 * was up, instead of once a night.
 *
 * The lesson is not "quote it better". Scheduling is arithmetic, arithmetic
 * belongs where a test can reach it, and a shell one-liner inside a YAML block
 * scalar is the one place in this repo nothing could. So the schedule is
 * computed here, in the runtime we already ship, and msUntilNext has a test.
 */
import { pathToFileURL } from "node:url";
import { runBackup } from "./backup.mjs";

/**
 * Milliseconds from `now` until the next local `hh:mm`.
 *
 * Always strictly in the future: at exactly 03:00 the answer is tomorrow, not
 * zero, so a run that finishes inside the same millisecond cannot re-fire.
 * Local time means the container's TZ, which compose sets to Europe/Stockholm.
 */
export function msUntilNext(hour, minute, now = new Date()) {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

const HOUR = Number(process.env.PANNBEN_BACKUP_HOUR ?? 3);
const MINUTE = Number(process.env.PANNBEN_BACKUP_MINUTE ?? 0);

const log = (o) => console.log(JSON.stringify(o));

function once() {
  try {
    const result = runBackup();
    log(result ?? { level: "warn", msg: "no database to back up yet" });
  } catch (err) {
    // Never let one bad night end the loop: tomorrow's backup is still worth
    // taking, and a container that exited here would take the schedule with it.
    log({ level: "error", msg: "backup failed", error: String(err?.stack ?? err) });
  }
}

/**
 * The loop runs only when this file is the process entry point.
 *
 * Without the guard, importing the module to test msUntilNext would start an
 * endless loop instead — which is the same category of mistake as burying the
 * schedule in a shell string: logic nothing can call is logic nothing can
 * check.
 */
async function loop() {
  // Once at startup, so a restart never skips a day and the healthcheck has
  // something true to read within seconds rather than at 03:00 tomorrow.
  once();

  for (;;) {
    const ms = msUntilNext(HOUR, MINUTE);
    log({
      level: "info",
      msg: "sleeping until next backup",
      ms,
      at: new Date(Date.now() + ms).toISOString(),
    });
    await new Promise((r) => setTimeout(r, ms));
    once();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await loop();
}
