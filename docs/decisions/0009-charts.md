# 0009 — Charts, and why not Chart.js

**Phase:** 7 · **Date:** 2026-09-10

## Context

Six phases of logging produced data that could only be read one session at a
time. This phase turns eight weeks of sets into a line.

## The plan said Chart.js. It is now hand-rolled inline SVG.

§1 of the plan named Chart.js before the design system existed. With the design
system in place that is the wrong call, and the plan is amended:

- **Theming.** The whole app is CSS custom properties with a dark mode that is
  its own palette rather than an inversion. An SVG inherits them —
  `stroke="var(--accent)"` simply works when the theme flips. A canvas library
  has to read computed styles in JavaScript and redraw, which is the exact
  mechanism that makes dark mode look automatic and wrong.
- **Weight.** ~70 kB gzipped onto a 35 kB bundle, for three fixed shapes:
  sparkline, line with a trend, stat tiles.
- **Tapping.** SVG points are real DOM nodes. Each carries its own `aria-label`
  and a 16px-radius transparent hit target over a 4.5px mark — no canvas
  hit-testing, and the target is far bigger than the thing it selects.

The accent was run through the dataviz palette validator against both surfaces
(`#1F5FA6` on `#FFFFFF`, `#4389D0` on `#15191E`) — all checks pass. There is one
series, so there is no legend: the card's own heading names what is plotted.

One deliberate departure from the general dataviz guidance: it reserves
`tabular-nums` for columns and wants proportional figures for large standalone
values. Pannben sets *all* data in Roboto Mono, which is tabular by
construction — that is an explicit, validated decision from the design system
(§11), made so weights and reps align down a column mid-workout. The house rule
wins over the general one.

## What the numbers mean

Everything is derived at read time from `logged_set`. No stored aggregates, so
the formulas below stay revisable without a migration.

- **Skipped sets are excluded** from every aggregate, and a session whose sets
  were *all* skipped produces **no point at all**. A zero there would read as a
  catastrophic drop rather than a day the work did not happen.
- **Epley `w × (1 + reps/30)`, suppressed above 12 reps.** A gap in the line is
  honest; an extrapolated 1RM from a set of 20 is not. The screen says so rather
  than leaving you to wonder where the point went.
- **No estimated 1RM for `bodyweight_plus`.** The bar is your body, so Epley
  over the added plate alone is a number with nothing behind it.
- **A dumbbell counts twice for volume** and once for the top set — both hands
  did the work, but you still only picked up one of them.
- **Archived exercises keep their charts.** That is the entire difference
  between archiving and deleting.

**The trend is fitted against calendar days, not point index.** Sessions are
not evenly spaced. A fortnight off is real, and fitting by index would draw a
line far steeper than the training actually was. Two sessions on one date give
zero variance in x, so there is no trend rather than a vertical one.

The metric toggle is chips, never a dual axis. Volume and estimated 1RM have
unrelated units; aligning two y-scales invents a correlation that is not in the
data.

## What the screenshots caught

Three things, all found by looking rather than by a test:

- **The trend tile ellipsed its own value** — `+225.4 …`. Three equal tiles and
  a mono value with the unit baked into the string. The unit moved into its own
  element and a change of 225 lost its decimal, which was noise anyway.
- **The full chart reserved an empty band** where x-axis labels should be. It
  now carries the first and last date — two labels, not one per point.
- **"Nothing logged yet" was a lie under a range filter.** An exercise last done
  five months ago reads as never done under the 8-week default. The empty
  message now names the range it is talking about.

## A bug this phase surfaced elsewhere

`FIELDS.hold` listed `weight` as required, so a plank could not be logged
without first typing a zero for added weight — a demand for data that does not
exist, dressed up as validation. Optional fields are now a real concept in
`logSet`, with tests both ways: a hold logs without a weight, and still refuses
without a duration.

## Consequences

- The dashboard is one request for all pinned charts, not one per sparkline.
- `favourite.ref_id` is deliberately not a foreign key — it points at an
  exercise today and a body-metric type in phase 8, and one column cannot
  reference two tables. The read drops anything that no longer resolves, so a
  deleted exercise quietly leaves the dashboard instead of breaking it.
