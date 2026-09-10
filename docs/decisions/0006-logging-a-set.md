# 0006 — Logging a set

**Phase:** 4 · **Date:** 2026-09-10

## Context

The session slice is where the app either earns its place in a gym or gets
replaced by the notes app. It is also the first slice where two writes race:
the set you just logged and the set you are about to log.

## Decision

**The session row is inserted on the first logged set, not on program pick.**
`startSession` snapshots the program's blocks and entries into `session_block`,
`logged_exercise`, so a later program edit cannot rewrite a workout that already
happened. The snapshot is normalised, not a JSON blob, so history stays
queryable.

**The local date is taken at start**, in `Europe/Stockholm` via the injected
clock, so a 23:40 → 00:20 session belongs to the day it started. Both CET and
CEST are covered by tests.

**Prefill comes from the same set index of the previous session**, not the most
recent set. After a drop set — 80, 80, 60 — the most recent set is the lightest
one, and prefilling 60 into set 1 next week asks you to correct it every single
time. Same-index prefill asks for nothing in the common case. `to_failure`
carries forward the same way, as a value, not a flag on the exercise.

**Duration is the last logged set minus `started_at`.** Finish governs UI state,
not the clock — leaving the app open on the walk home does not inflate the
session.

## The two bugs this phase produced

Both were correctness bugs in the write path, both found by driving the built
app rather than by a unit test, and both are worth writing down because the
shape of the mistake will recur.

### 1. `set_index` derived from render position

The set rows were rendered from a loop, and each row took its index from its
position in that loop. That is correct exactly until the list contains anything
other than the sets — a skipped row, a round boundary, an extra set appended
past `target_sets`. Then two rows compute the same index and the second write
silently overwrites the first.

The fix is that ordering is data, not layout: `rowsFor()` builds an explicit row
list carrying its own `set_index` and `round_index`, and the row finds its set
with `find(s => s.set_index === i)` rather than by position. Migration
`005_one_set_per_slot.sql` adds a unique index over
`(logged_exercise_id, round_index, set_index)` so the database refuses the
collision even if the client computes one again.

### 2. `flush()` resolved before the flush finished

The outbox returned immediately when a drain was already in flight:

```ts
if (flushing) return;          // silently "done"
```

Callers awaited it, believed the write had landed, and called `reload()` — which
read the pre-write state. The next set then reused the index it had just seen as
free. This is the failure mode the whole outbox exists to prevent, reintroduced
by the function that reports on it.

A promise now models the work rather than a boolean modelling the state:

```ts
let inflight: Promise<void> | null = null;
export function flush(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try { for (;;) { const resolved = await drain(); if (resolved === 0) break; } }
    finally { inflight = null; }
  })();
  return inflight;
}
```

Concurrent callers join the same flush, and the loop keeps draining because a
write queued *during* a drain would otherwise sit until the next one. `await
flush()` now means what every call site already assumed it meant.

**The rule:** a boolean can say that work is happening; only a promise can say
when it is done. Any "am I already doing this?" guard that returns early is a
lie to whoever awaited it.

## Consequences

- Session structure is duplicated per session. At one workout every other day
  that is a few hundred rows a year.
- Adding an exercise mid-session appends an ad-hoc block to the snapshot, which
  is why the snapshot is a real table and not a frozen copy of the program.
