# 0007 — Correcting history, and vendoring the type

**Phase:** 5 · **Date:** 2026-09-10

## Context

Phase 4 made it possible to log a workout. This one makes it possible to have
been wrong about it — the fat-fingered 100 that should have been 10, the set
logged against the wrong exercise, the session that happened on Sunday but was
logged on Monday.

## Decision

**There is no edit endpoint.** A correction is `PUT /api/sets/:id` carrying the
id the set already has — the same write the phone makes in the gym. It queues,
coalesces and replays identically, and the `updated_at` guard makes a stale
replay lose to the correction rather than undo it. Adding a second write path
for "the same thing, but later" would have meant a second set of idempotency
arguments to get right.

Session-level corrections — the note, and the date when a session was logged on
the wrong day — go through `PATCH /api/sessions/:id`, the one place a stored
date can be changed at all. `startSession` takes the date from the clock and
never from the client, so without this the only way to move a session would be
to relog it.

**Deletes stay soft, and a soft-deleted set frees its slot.** The
one-set-per-slot index from migration 005 is partial on `deleted_at IS NULL`, so
deleting set 1 and logging a new set 1 works — which is what "delete this, I'll
redo it" has to mean. Deleting the *active* session is how you abandon a workout
started by mistake: the partial unique index ignores deleted rows, so the next
session starts immediately.

**A gap in the set numbers is left visible.** Delete set 2 of four and the
session reads 1, 3, 4. Renumbering would be tidier and would also be a lie —
`set_index` is what prefill matches on, so shifting them would rewrite what set
3 was last week.

**Corrections are tap-to-type on every field, reps included.** During logging
reps move by one and a stepper wins. A correction is not a nudge — it is
replacing 100 with 10, which is ninety taps on a stepper and two on a keypad.
The two contexts get different controls because they are different actions.

**Reps and seconds refuse a fraction before the write is queued.** The client
was carrying its own copy of the decimal parser; it now imports the data
layer's `numeric.ts`, which is a pure module the existing tests already cover.
A field that reads as accepted and then fails in the sync bar a second later is
the worst of both.

## The history list is not cards

The first version made each session a card with a shadow, following "a session
is a semantic unit". Twenty-three of them stacked read as twenty-three things
demanding attention on a screen whose entire job is to be scanned. It is now
one continuous surface with dividers and a month heading — the same treatment
§11 gives the exercise list — and the relative label ("3 days ago") is dropped
past a week, because a column of "3 weeks ago · 3 weeks ago · 3 weeks ago"
makes the dates harder to read, not easier.

## The type is vendored, not linked

Unrelated to history, found while screenshotting it: `index.html` linked
fonts.googleapis.com at runtime. Three things were wrong with that.

- The app is a PWA whose whole point is a basement gym with no signal. Offline,
  every screen fell back to system type — so the design system was only ever
  true when the phone had a connection.
- A cold open told Google about it.
- Every screenshot taken so far was in fallback fonts, which means the type in
  them was never what would ship.

`scripts/fetch-fonts.mjs` now vendors the seven faces the design system uses
into `public/fonts/`, latin subset only (Swedish needs å ä ö, which live in
`latin`; the other six ranges are 150 kB of Cyrillic and Vietnamese this app
will never render). 224 kB committed, precached by the service worker like any
other asset.

## `×` only where the numbers multiply

A hold rendered as `63 sec × 0 +kg`. Nothing there is a product, and the added
weight is zero on almost every hold. Separators are now per metric type, and an
optional field is left off a logged row when it carries nothing — which is a
display rule, not a schema change: the field is still there to type into.

## Consequences

- History is paged at 25 with an explicit "Load more". A year of training is
  ~150 sessions, so this matters sooner than it looks.
- `listSessions` counts and durations are computed in SQL rather than by
  loading each session, because this is the one screen whose cost grows with
  every workout ever logged.
- `npm run seed` now builds programs and eight weeks of backdated sessions,
  entirely through the API — it exercises the same write path a phone does
  rather than reaching into the database behind the app's back.
