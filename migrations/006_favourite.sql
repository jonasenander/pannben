-- Charts pinned to the dashboard.
--
-- A pin is a structural edit, not something logged in a gym, so it goes
-- straight to the server like a program save rather than through the outbox.
-- `ref_id` is deliberately not a foreign key: it points at an exercise today
-- and a body-metric type in phase 8, and one column cannot reference two
-- tables. The read joins and drops anything that no longer resolves.

CREATE TABLE favourite (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('exercise','body_metric')),
  ref_id      TEXT NOT NULL,
  position    INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;

-- The same thing cannot be pinned twice.
CREATE UNIQUE INDEX favourite_one_per_ref ON favourite (kind, ref_id);
CREATE INDEX favourite_order ON favourite (position);
