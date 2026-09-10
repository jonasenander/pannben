# 0008 — Restoring a backup

**Phase:** 6 · **Date:** 2026-09-10

## Context

Export has existed since phase 2. Until now the only way to use one was to
hand-write SQL, which means the backups were reassuring rather than useful.

## Decision

**Replace-all is the only mode.** Merge would need ID-collision handling and a
per-row rule for which side wins — real work, for a single-user restore where
the answer is always "the file". `POST /api/import` deletes every table and
reloads it from the export inside one transaction: either the whole backup
lands or nothing changed.

**Foreign keys are deferred, not disabled.** `PRAGMA defer_foreign_keys = ON`
inside the transaction moves enforcement to commit, so neither the wipe nor the
reload has to happen in dependency order — and a file whose references do not
line up still fails, just at the end, with the whole import rolled back.
Turning `foreign_keys` off would have been the same amount of code and would
have let a broken backup in.

**`schema_migrations` is never imported.** It describes the running binary, not
the data. Importing a v3 export's migration history into a v5 database would
leave it claiming to be at v3 while holding v5 tables, and the next startup
would try to apply migrations 4 and 5 a second time.

**A newer schema is refused; an older one is accepted.** Refusing forward is the
plan's rule and the safe direction — this app cannot know what a future column
means. Backwards is the case that actually happens (restoring last month's
backup after an update), so an older export is applied column by column against
the current schema, with anything the schema no longer has reported rather than
silently dropped: `tables_skipped` and `columns_skipped` come back with the
result and are shown on the screen.

**The confirmation is typed, not tapped.** `REPLACE`, into a field, with the
file's date and row count in front of you. A two-tap confirm is the same
gesture as any other button; typing a word is not something a thumb does by
accident.

## What the round-trip test caught

The first version stamped `restored_at` and `restored_from` into `app_meta`, so
a restored database could say where it came from. That is useful right up until
you notice it makes `export → import → export` non-identical — and that round
trip is the only proof a restore is lossless. The marker went and the guarantee
stayed; the import result carries the same information back to the screen that
asked for it, where it is actually read.

The staged row count also disagreed with the restored count by exactly five —
the migration rows the import correctly refuses. The screen now counts what the
import will write rather than what the file contains.

## Consequences

- The whole export is held in memory twice during an import (parsed JSON, then
  rows). At a few MB for years of training that is not worth streaming.
- A restore does not reload the page. The screen re-reads health and row counts
  itself, but a history list already open in another tab would be stale. With
  one user on one phone, that is not a scenario.
