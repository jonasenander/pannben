# 0012 — Body metrics

**Phase:** 8 · **Date:** 2026-09-10

## Context

The last unbuilt slice, and the one with the strongest brief attached:
*"solve it in a reasonable way. Don't be a dick. I weigh myself rarely."*

That rules out most of what a fitness app does here. No streak, no reminder, no
"you haven't weighed in for 12 days", no goal weight, no BMI, no empty chart
demanding to be filled. A reading is logged when there is a reading.

## Decision

**A strip on Home, not a fifth tab.** A tab is a permanent fixture and implies
something visited often; this is used monthly. The strip carries the name, the
latest value, how long ago, a sparkline and a **Log** button, and tapping it
opens the detail screen. All non-archived metrics get one — they are one line
each, and a second "pinned" concept on top would be two mechanisms showing the
same thing. The `favourite` table already accepts `kind = 'body_metric'` if
that ever changes.

**Nothing is seeded.** The app does not assume what you track. That creates a
discovery problem, solved with **one quiet row** at the bottom of Home:
`+ Track a body metric`. Not a banner, not a prompt, not dismissible — an
affordance sitting exactly where the strips will be, replaced by them once a
metric exists.

**A type carries the name and the unit; a reading carries only a number.** That
split is why renaming a metric cannot rewrite its history and why a reading can
never disagree with its own unit. A metric without a unit is refused: the
number would mean nothing and no axis could honestly label itself.

**`measured_at` is a full timestamp with no uniqueness constraint.** Weigh
yourself twice in a day and both are points. The chart spaces by that timestamp
rather than by date, so the two do not collapse into one dot.

## What was reused rather than rebuilt

This phase is small because three things already existed and fit:

- **`trendLine`** fits against calendar days rather than point index, which
  matters more here than anywhere: five readings across nine months must not be
  drawn as five consecutive days.
- **`Chart.svelte` needed no changes.** It only ever read a date and a value, so
  the prop type relaxed to a structural `ChartPoint` that both series kinds
  satisfy — plus an optional full timestamp for the same-day case.
- **Export and import needed no work at all.** `exportAll` walks
  `sqlite_master` and the import defers foreign keys. `tests/import.test.ts`
  now carries body metrics through the byte-identical round trip, so ADR 0008's
  guarantee is proven against the newest tables rather than only the ones it
  was written for.

## Write path

Readings go **through the outbox**, like sets: a weigh-in is a quick write that
may happen away from signal, and correcting one is the same write carrying the
id it already has. Creating or renaming a *type* goes straight to the server,
like a program save — it is structural and its rejection has to arrive while
the screen is open (ADR 0005).

## Consequences

- `metricSeries` returns the trend as two endpoints, the way the exercise chart
  route does, so the client draws rather than fits.
- Deleting a metric is soft and frees its name for reuse; the readings stay in
  the database and in every export.
- The change tile rounds the way the exercise tiles round — two decimals on a
  change of four kilos is arithmetic, not information.
