# 0005 — A program is saved as one document

**Phase:** 3 · **Date:** 2026-09-10

## Context

A program is a tree: blocks in order, each holding exercises in order. Reordering
a block changes every position at once. The obvious REST shape — a route per
node — makes that a fan of writes that must all land, in order, through a queue
that can be interrupted at any point.

## Decision

`PUT /api/programs/:id` takes the whole tree. One transaction replaces the
program's blocks and entries wholesale.

- **Positions come from array order.** The client never sends a position, so it
  cannot send one that disagrees with what is on screen.
- **Reordering is an ordinary save**, not a special endpoint with its own
  correctness argument.
- **One queued entry** rather than a fan, so it coalesces like every other write.
- **Structure is hard-deleted on save.** This is the one place the
  never-hard-delete rule does not apply, and it is safe for a specific reason: a
  session snapshots its own copy of the blocks when it starts, so no history
  depends on these rows. Sessions are the record; programs are only the template.

Validation the server enforces and the editor mirrors: a `single` block holds
exactly one exercise, a `superset` needs at least two, target sets is a whole
number 1–50, and an entry cannot point at a deleted exercise. The editor shows
the same rules inline and disables Save, so a rejection arrives while the fix is
still in reach rather than later as a dismissed banner.

Program saves therefore bypass the outbox and go straight to the server. The
outbox is right for a set logged in a basement; it is wrong for a structural
edit whose rejection the user needs to see now.

## Consequences

- Two programs cannot be edited concurrently without one overwriting the other.
  With one user that is not a real scenario, and last-write-wins on `updated_at`
  still applies.
- A large program rewrites all its rows on every save. At this size that is
  microseconds.

## What this caught

The first editor put the exercise name, a metric badge and a set stepper on one
row. At 390px the name collapsed to "I..." and "W" — the badge won a fight it
should not have been in. The badge was removed (metric type is the point in the
exercise list, not while editing set counts) and the name moved to its own line.
Measured after: every name renders in full, with 22px spare in the stepper.
