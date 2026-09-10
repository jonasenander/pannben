-- Two sets cannot occupy the same slot in the same exercise.
--
-- A replay reuses the same id and is handled by ON CONFLICT(id); a *different*
-- id landing on the same (exercise, round, index) is a bug, not a retry. The
-- first version of the logging screen produced exactly that when a flush
-- resolved early and the screen re-read stale state. Better a loud failure
-- than two sets silently claiming to be set 1.
CREATE UNIQUE INDEX logged_set_one_per_slot
  ON logged_set (logged_exercise_id, round_index, set_index)
  WHERE deleted_at IS NULL;
