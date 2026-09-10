# 0010 — What the first real workout found

**Phase:** 7b · **Date:** 2026-09-10

## Context

Phases 4–7 were verified by 182 passing tests and by driving the built app with
Playwright at a phone viewport, in both themes, reading the screenshots. All of
that passed. The first session logged *on a phone, in a gym, by a person* found
seven problems in twenty minutes.

That is the finding worth recording. Everything below is a consequence.

## The superset bug, and why no test could see it

`roundOf(block)` returned the deepest round reached by **any** exercise in the
block, and `rowsFor()` then gave **every** exercise that many rows. Log the
first exercise of a superset and the block's round became 1 — so the second
exercise, which had logged nothing, was rendered an open row for round 0 *and*
round 1. Two rows both claiming to be the next thing to do.

Cosmetic only until you use the wrong one. Logging round 1 first leaves a
permanent hole at round 0, and prefill matches on index, so next week's session
offers set 1 from a set that was never done.

The rule is inverted: a superset is on the **lowest round somebody still
owes**, not the highest anyone has reached. An exercise that has closed the
current round shows a record and nothing open until every exercise has closed
it.

**Why it survived:** the logic lived inside the Svelte component as index
arithmetic over the render, where the only way to exercise it is to render it.
It now lives in `src/data/rounds.ts` over structural types, with
`tests/superset.test.ts` covering the exact repro. This is the second time a
correctness bug has hidden in row-position arithmetic — the first was phase 4's
duplicate `set_index`, ADR 0006. Ordering is data. It keeps being data.

## "Next round" was specified, never built, and reported as done

§4 of the plan describes it. Phase 4 shipped without it and was called
complete. There is no cleverness to recover here: the phase checklist was
written from what had been built rather than from what had been specified.

It exists now, and it earns its place even though the round advances by itself:
it is the only way to *deliberately* leave an exercise out of a round, which
the plan explicitly allows ("an unlogged row is simply not logged").

## Cardio was three required numbers

`FIELDS.cardio` demanded speed, duration *and* distance. A run is a time, a
distance, or both — and the speed on the treadmill display is not the same
number as distance ÷ time, so it is **never derived**. A chart that silently
mixes "what the machine said" with "what the average worked out to" is worse
than a chart with gaps.

`REQUIRE_ANY` joins the `OPTIONAL` set added in phase 7: at least one of a named
group must be present. The client mirrors the rule so the Log set button knows
whether it is enabled, the same way the program editor mirrors its validation.

## Duration: seconds are not a length of time

`1200` is not something anyone reads mid-workout. Durations now display as
`M:SS` and accept either `20:00` or a bare `1200`.

**And `.` and `,` count as separators too.** This is the part that matters: a
phone's numeric keypad has no colon on it. iOS `inputmode="numeric"` offers
digits alone and `inputmode="decimal"` adds only the locale's decimal key — a
comma on a Swedish phone. A colon-only field would have been unusable on the
one device this app exists for. `20,00`, `20.00` and `20:00` are the same
twenty minutes; the part after the separator is always seconds, and the row
redisplays it immediately so a wrong guess corrects itself in front of you.

The unit label is dropped from logged durations: `20:00` says it is a time,
`20:00 time` says it twice. It stays on the entry boxes, where it names which
box is which.

## Rows that ran off their own card

`.line` in `SetRow` and `.row` in `SessionDetail` were non-wrapping flex rows.
Cardio puts three values on them, and at 390px the row ran past the card,
taking the delete × with it. Both wrap now. This is the third layout bug found
by looking rather than assuming, and the check is now part of the Playwright
pass: every row measured against its card, and the document measured for
horizontal scroll.

## The installed app kept serving an old build

Four causes, all of them present at once:

1. `register()` without `updateViaCache: "none"` — the browser could hand back
   its own cached copy of `/sw.js`.
2. Nothing ever called `registration.update()`. A home-screen PWA *resumes*; it
   does not cold-start. Without asking on every foreground it can go for weeks
   without looking.
3. `skipWaiting` and `clients.claim` were already there, so a new worker did
   take control — but the page *running* was still the old HTML and the old
   bundle, and nothing swapped it out.
4. `serveStatic` sent no `Cache-Control`, so `/index.html` and `/sw.js` could
   sit in the HTTP cache as well. They are `no-cache` now; the content-hashed
   assets under `/assets/` are `immutable` for a year.

The reload guard took three attempts, and the failures are instructive. First
version reloaded on *every* `controllerchange`, which includes a worker taking
initial control — a visible flash on first visit for nothing. Second version
suppressed reloads whenever the page had loaded uncontrolled, which silently
disabled updates for that whole page. The rule is: skip the first claim on a
page that started with no worker, treat every change after that as a
replacement.

**And make it answerable.** `/api/health` reported `version: "0.1.0"` forever,
so "am I on the new build?" could not be checked from the phone at all — which
is exactly why a stale worker went unnoticed across four phases. The short git
SHA is now a build arg, comes back from `/api/health`, and sits on the Settings
screen under the schema version.

## A test that was wrong, briefly

The first attempt at verifying the update flow appended a CSS *comment* as its
"new build". Vite strips comments, so the output was byte-identical and the
browser correctly found nothing to update. The test reported the app broken
when the app was fine. Worth recording: a deploy test has to deploy something
that actually differs.

## Consequences

- Session cancellation reuses `deleteSession`, which already freed the active
  slot — only the button was missing. Soft, so the sets stay in the database
  and in every export; they just leave history and the charts.
- `src/data/rounds.ts` is imported by the client from the data layer, like
  `numeric.ts`. Both are pure modules with no I/O, which is what makes that
  safe.
