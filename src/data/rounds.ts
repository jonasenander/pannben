/**
 * Which round a superset is on, and which rows are open.
 *
 * This lived inside the active-session component as index arithmetic, which is
 * why it was wrong and why nothing caught it: `roundOf` returned the deepest
 * round reached by *any* exercise in the block, and every exercise was then
 * rendered that many rows. Logging the first exercise's round 1 gave the
 * second exercise an open row for round 0 *and* round 1 — two rows claiming to
 * be the next thing to do, and logging the wrong one left a permanent hole at
 * round 0 that prefill would then match against.
 *
 * The rule is the other way round: a superset is on the **lowest round that
 * somebody still owes**. It is here, over structural types, so it is tested
 * without a browser.
 */

export interface RoundExercise {
  target_sets: number;
  sets: { round_index: number }[];
}

export interface RoundBlock {
  type: "single" | "superset";
  exercises: RoundExercise[];
}

/** Rounds the block plans: the deepest target among its exercises. */
export function roundsPlanned(block: RoundBlock): number {
  return Math.max(1, ...block.exercises.map((e) => e.target_sets));
}

const hasLogged = (ex: RoundExercise, round: number) =>
  ex.sets.some((s) => s.round_index === round);

/**
 * The round the block is on: the lowest round at which some exercise has not
 * logged. Equal to `roundsPlanned` once every round is closed, which is what
 * "the block is done" means.
 */
export function currentRound(block: RoundBlock): number {
  const planned = roundsPlanned(block);
  for (let round = 0; round < planned; round++) {
    if (block.exercises.some((ex) => !hasLogged(ex, round))) return round;
  }
  return planned;
}

export const blockDone = (block: RoundBlock): boolean =>
  block.type === "superset"
    ? currentRound(block) >= roundsPlanned(block)
    : block.exercises.every((e) => e.sets.length >= e.target_sets);

export interface OpenRoundOptions {
  /**
   * A round the person moved to deliberately, via **Next round**, without
   * closing the one before. Leaving an exercise out of a round is allowed —
   * an unlogged row is simply not logged — so the block cannot insist on
   * finishing a round nobody intends to finish.
   */
  forcedRound?: number;
}

/**
 * The rounds this exercise should show an entry row for.
 *
 * At most one. An exercise that has already logged the round it owes shows a
 * record and nothing else until the whole round closes.
 */
export function openRounds(
  block: RoundBlock,
  exercise: RoundExercise,
  opts: OpenRoundOptions = {},
): number[] {
  if (block.type !== "superset") {
    // A single block has one round; its rows come from `target_sets`.
    return blockDone(block) ? [] : [0];
  }

  const planned = roundsPlanned(block);
  const round = Math.min(opts.forcedRound ?? currentRound(block), planned - 1);
  if (round < 0 || currentRound(block) >= planned) return [];
  return hasLogged(exercise, round) ? [] : [round];
}

/** Whether a **Next round** button has anywhere left to go. */
export function canAdvance(block: RoundBlock, forcedRound?: number): boolean {
  if (block.type !== "superset") return false;
  const at = forcedRound ?? currentRound(block);
  return at < roundsPlanned(block) - 1;
}
