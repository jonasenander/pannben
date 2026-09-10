-- Exercises. Referenced by id everywhere, so a rename propagates by itself.
--
-- Two ways to retire one, and they mean different things:
--   archived_at  legacy, still true of past sessions -> hidden from pickers,
--                kept in history and charts
--   deleted_at   a mistake, was never real work      -> hidden everywhere
-- Neither removes the row. Both stay in exports.

CREATE TABLE exercise (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  metric_type  TEXT NOT NULL CHECK (metric_type IN
                 ('bodyweight','bodyweight_plus','dumbbell',
                  'total_weight','cardio','hold')),
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  archived_at  TEXT,
  deleted_at   TEXT
) STRICT;

-- A second "Bench press" would silently split the history every chart reads,
-- so live names are unique case-insensitively. Deleted rows are exempt: the
-- name has to be reusable after a mistake.
CREATE UNIQUE INDEX exercise_name_unique
  ON exercise (lower(name)) WHERE deleted_at IS NULL;

-- The list screen's default query.
CREATE INDEX exercise_live ON exercise (archived_at, name) WHERE deleted_at IS NULL;
