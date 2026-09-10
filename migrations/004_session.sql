-- Sessions. The record of what you actually did, as opposed to what you planned.
--
-- The block structure is copied in here at start rather than referenced, so
-- editing a program later cannot rewrite the meaning of a session you already
-- logged. Normalised rather than a JSON blob so it stays queryable by the
-- charts.

CREATE TABLE session (
  id            TEXT PRIMARY KEY,
  program_id    TEXT REFERENCES program(id),   -- nullable: ad-hoc sessions
  program_name  TEXT,                          -- snapshot, survives a rename
  date          TEXT NOT NULL,                 -- local calendar date at start
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL CHECK (status IN ('active','finished')),
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
) STRICT;

-- Only one session can be open at a time. A partial unique index makes that a
-- database guarantee rather than something the UI has to remember.
CREATE UNIQUE INDEX session_one_active
  ON session ((1)) WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX session_by_date ON session (date DESC) WHERE deleted_at IS NULL;

CREATE TABLE session_block (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES session(id),
  position    INTEGER NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('single','superset')),
  created_at  TEXT NOT NULL
) STRICT;

CREATE INDEX session_block_order ON session_block (session_id, position);

CREATE TABLE logged_exercise (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES session(id),
  block_id    TEXT NOT NULL REFERENCES session_block(id),
  position    INTEGER NOT NULL,
  exercise_id TEXT NOT NULL REFERENCES exercise(id),
  target_sets INTEGER NOT NULL DEFAULT 3,
  -- How it was done *this time* -- a bench angle, a grip. Expected to vary
  -- session to session, which is why it does not live on the exercise.
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;

CREATE INDEX logged_exercise_order ON logged_exercise (block_id, position);
CREATE INDEX logged_exercise_by_exercise ON logged_exercise (exercise_id);

CREATE TABLE logged_set (
  id                  TEXT PRIMARY KEY,
  logged_exercise_id  TEXT NOT NULL REFERENCES logged_exercise(id),
  set_index           INTEGER NOT NULL,   -- position within the exercise
  round_index         INTEGER NOT NULL DEFAULT 0,  -- superset round
  logged_at           TEXT NOT NULL,
  skipped             INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0,1)),
  to_failure          INTEGER NOT NULL DEFAULT 0 CHECK (to_failure IN (0,1)),

  -- Metric fields. Which are used depends on the exercise's metric_type; the
  -- rest stay null rather than being crammed into one overloaded column.
  weight     REAL,      -- total, per-hand, or added, per metric_type
  reps       INTEGER,
  duration_s INTEGER,
  distance_m REAL,
  speed      REAL,

  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
) STRICT;

-- Ordering never depends on timestamps: two sets logged in the same second
-- must still come back in the order they were done.
CREATE INDEX logged_set_order
  ON logged_set (logged_exercise_id, round_index, set_index) WHERE deleted_at IS NULL;
