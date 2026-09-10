-- Body metrics: weight, waist, resting heart rate — whatever gets tracked.
--
-- Split into a definition and its readings so units and names cannot drift.
-- A reading stores only a number; what that number means lives in one place,
-- which is also why renaming a metric does not rewrite its history.
--
-- Nothing is seeded. The first metric is created deliberately, because an app
-- that assumes what you track is an app that nags about it.

CREATE TABLE body_metric_type (
  id          TEXT PRIMARY KEY,          -- UUIDv7, minted on the client
  name        TEXT NOT NULL,
  unit        TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived_at TEXT,
  deleted_at  TEXT
) STRICT;

-- Two "Weight" types would fragment the chart the same way two "Bench press"
-- exercises would fragment a lift's history.
CREATE UNIQUE INDEX body_metric_type_name
  ON body_metric_type (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE body_metric_entry (
  id          TEXT PRIMARY KEY,
  type_id     TEXT NOT NULL REFERENCES body_metric_type(id),
  -- A full timestamp, not a date: weigh yourself twice in a day if you like.
  -- There is deliberately no uniqueness here.
  measured_at TEXT NOT NULL,
  value       REAL NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
) STRICT;

CREATE INDEX body_metric_entry_by_type
  ON body_metric_entry (type_id, measured_at DESC) WHERE deleted_at IS NULL;
