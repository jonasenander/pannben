-- Phase 1 groundwork. Feature tables arrive with the slices that need them:
-- exercises in phase 2, programs in phase 3, sessions in phase 4.
--
-- Every table in this app carries created_at/updated_at as ISO-8601 UTC text,
-- and nothing is ever hard-deleted.

CREATE TABLE app_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;

INSERT INTO app_meta (key, value, updated_at)
VALUES ('created_at', datetime('now'), datetime('now'));
