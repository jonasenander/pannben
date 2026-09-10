-- Programs: an ordered list of blocks, each an ordered list of exercises.
--
--   program
--     └── program_block   single | superset
--           └── program_entry  -> exercise, with a target set count
--
-- target_sets decides how many empty set rows appear when logging. It carries
-- no default *values*: a field is either empty or prefilled from history.

CREATE TABLE program (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  archived_at  TEXT,
  deleted_at   TEXT
) STRICT;

CREATE UNIQUE INDEX program_name_unique
  ON program (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE program_block (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES program(id),
  position    INTEGER NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('single','superset')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;

CREATE INDEX program_block_order ON program_block (program_id, position);

CREATE TABLE program_entry (
  id           TEXT PRIMARY KEY,
  block_id     TEXT NOT NULL REFERENCES program_block(id),
  position     INTEGER NOT NULL,
  exercise_id  TEXT NOT NULL REFERENCES exercise(id),
  target_sets  INTEGER NOT NULL CHECK (target_sets BETWEEN 1 AND 50),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;

CREATE INDEX program_entry_order ON program_entry (block_id, position);
CREATE INDEX program_entry_exercise ON program_entry (exercise_id);
