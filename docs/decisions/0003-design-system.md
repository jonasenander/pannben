# 0003 — Design system

**Phase:** 0b · **Date:** 2026-09-09

## Context

The functional prototype was deliberately unstyled. Applying a visual design
after ten phases of building would mean retrofitting it across sixteen screens
by hand, so the design pass was pulled forward: prototype screenshots went to an
external design AI, and what came back is treated as a **token set** rather than
a picture to match.

## Decision

Adopt the returned spec, with its governing rule: **radius means grouping,
colour means state, elevation means attention.** Card, shadow and accent are
hierarchy tools, not default decoration.

Tokens live in `src/client/app.css`. Light and dark are separate palettes; dark
is not an inversion, and its hierarchy comes from surface steps and borders
rather than large shadows.

Three values from the spec were **overridden** after checking them:

| Token | Spec | Used | Reason |
|---|---|---|---|
| light `--ink-muted` | `#7C858F` | `#5F6772` | 3.08:1 on `--ground`; fails AA for the 12–13px metadata it styles |
| dark `--ink-muted` | `#747F8B` | `#7A8592` | 4.33:1, just under AA |
| dark button text | `white` | `#080A0D` | White on `--accent` `#4389D0` is 3.67:1; dark ink is 5.41:1 |

Metric-badge colours were kept unchanged — they are functional taxonomy,
validated for deuteranopia separation and ≥3:1 against both surfaces, and always
carry a text label so colour is never the only signal.

Two dimensions were also adjusted after building the spec on a real 390px
screen: the live set row was 190px tall, pushing the second exercise of a
superset off the fold, and app-bar titles at the specified 28px wrapped exercise
names across three lines. Only the live set row carries its actions; pending
rows show their numbers alone.

## Consequences

- Phases 2–9 are built inside the system rather than restyled afterwards.
- Phase 10 shrinks from "apply a design" to "polish".
- Numeric controls let the *unit label* shrink before the *value* does, so a
  three-digit weight can never be clipped by a stepper button.
