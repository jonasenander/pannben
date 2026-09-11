# 0014 — The backup container was lying, twice

**Status:** accepted

## Context

Synology Container Manager showed `pannben-backup` as a yellow **warning**.
Two independent bugs were behind it, and they pointed in opposite directions:
one made a working container look broken, the other made a broken container
look fine.

### The schedule never worked

The nightly snapshot was scheduled by a shell loop in `docker-compose.yml`:

```sh
sleep $(( $(date -d "tomorrow 03:00" +%s 2>/dev/null || date -v+1d -j -f "%H:%M" "03:00" +%s) - $(date +%s) ))
```

The image is `node:22-alpine`, so `date` is BusyBox. `-d "tomorrow 03:00"` is a
GNU form BusyBox does not parse, and the fallback beside it uses `-v`/`-j`,
which are BSD flags BusyBox does not have either. Both branches failed, the
command substitution produced an empty string, the arithmetic evaluated to a
large negative number, `sleep` refused it — and the loop fell straight through
to the next iteration.

The container had been running `VACUUM INTO` in a tight loop for ten hours.
Sixteen log lines inside ten milliseconds. It was never a nightly job.

Nothing caught this for four phases because nothing *could*: the logic lived in
a shell string inside a YAML block scalar, which is the one place in this
repository no test can reach.

### The healthcheck could never pass

`pannben-backup` runs the same image as `pannben`, and that image carries a
`HEALTHCHECK` that fetches `/api/health`. The backup service overrides the
command to a scheduling loop and runs no server at all, so the probe could only
ever fail. Overriding `entrypoint` or `command` does not clear an image's
healthcheck.

So the container reported `unhealthy` from about 100 seconds after every start,
forever, regardless of whether a single backup had ever been written. A signal
that is always red is the same as no signal — except worse, because it occupies
the place where the real one would have gone. Had the hot loop instead been a
loop that never ran, this healthcheck would have said exactly the same thing.

## Decision

**Scheduling is arithmetic, so it moves to where a test can reach it.**
`scripts/backup-loop.mjs` computes the delay in Node — the runtime the image
already ships — and exports `msUntilNext(hour, minute, now)` so
`tests/backup.test.ts` can check it. The property that matters is that the
answer is always strictly positive: at exactly 03:00 the next run is tomorrow,
not now. That single property is the difference between a scheduled loop and a
hot one.

This is the same rule `CLAUDE.md` already states for row-position arithmetic in
Svelte components, applied to a place nobody thought of as code. A shell
one-liner in compose is code. It just had no tests and no reviewer.

`scripts/backup.mjs` now exports `runBackup()` rather than only performing it,
so the loop and `npm run backup` share one implementation. It returns `null`
instead of throwing when there is no database yet, since a fresh deployment can
start the backup container before the app has ever created one.

**A healthcheck has to describe the container it is attached to.**
`scripts/backup-health.mjs` asks the only question that means anything here:
does a snapshot exist, and is it recent? The window is 26 hours rather than 24,
so an hour of drift or a clock change does not raise a false alarm. The loop
also takes one snapshot at startup, so a restart never skips a day and health
is answerable within seconds instead of at 03:00 tomorrow.

## Postscript: the same mistake, one file later

`backup-health.mjs` ran its probe at module top level, so importing it to test
`newestAgeMs` executed the check — and a failing check calls `process.exit(1)`,
which takes the test runner down with it. The entry-point guard had been written
for `backup-loop.mjs` twenty minutes earlier and simply not applied to its
sibling.

It passed locally and failed in CI, which is the interesting part. A leftover
gitignored `data/backups/` in the working tree, left by an earlier run, made the
probe succeed and exit 0 — so the import was harmless *there*. CI checks out
clean, found no snapshot, and exited 1. Local state that CI does not have will
hide exactly this class of bug, and "it passed on my machine" was literally true
and completely worthless.

So the invariant is now a test rather than a habit: each of these scripts is
imported in a fresh child process, from a fresh working directory, and must
produce no output and exit 0. Removing a guard fails it. A script that is both a
CLI and a module has to be silent as a module, and three files needed that rule
before one of them wrote it down.

## Consequences

- A yellow warning on `pannben-backup` now means backups have actually stopped,
  which is worth getting out of bed for. It previously meant nothing.
- `docker logs pannben-backup` is now two lines a day — the snapshot and the
  time of the next one — instead of a firehose.
- The failure mode was silent in the worst way. Backups *were* being written the
  whole time, so every check short of reading the logs said the system was fine;
  the only visible symptom was a warning caused by the unrelated second bug.
  Finding it depended on the warning being investigated rather than dismissed.
