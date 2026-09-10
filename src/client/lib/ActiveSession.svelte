<script lang="ts">
  import SetRow from "./SetRow.svelte";
  import SyncBar from "./SyncBar.svelte";
  import Badge from "./Badge.svelte";
  import { uuidv7 } from "./uuid.js";
  import {
    fetchActiveSession, logSet, setExerciseNote, finishSession, removeSession,
    formatDuration,
    type SessionView, type SessionBlock, type LoggedExercise, type LoggedSet,
  } from "./api.js";
  import {
    currentRound, roundsPlanned, blockDone, openRounds, remainingRounds,
  } from "../../data/rounds.js";
  import { flush } from "./outbox.js";

  let { onfinished }: { onfinished: () => void } = $props();

  let session = $state<SessionView | null>(null);
  let error = $state<string | null>(null);
  let elapsed = $state("00:00");
  let finishing = $state(false);
  let discarding = $state(false);
  let notes = $state("");

  /** A superset asked to close before its last round. */
  let endingBlock = $state<string | null>(null);

  export async function reload(): Promise<void> {
    try {
      session = await fetchActiveSession();
      if (session) notes = session.notes;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  $effect(() => { void reload(); });

  // A running clock, because knowing you are 40 minutes in changes what you do.
  $effect(() => {
    const tick = () => {
      if (!session) return;
      const secs = Math.floor((Date.now() - Date.parse(session.started_at)) / 1000);
      elapsed = formatDuration(Math.max(0, secs));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  });

  /**
   * The rows to render, as data rather than index arithmetic over the DOM.
   *
   * Ordering and rounds come from `src/data/rounds.ts`, which is tested
   * without a browser — this used to be inline arithmetic here, and it was
   * wrong in a way no test could see: see docs/decisions/0010.
   */
  interface Row { setIndex: number; roundIndex: number; logged: LoggedSet | undefined }

  function rowsFor(ex: LoggedExercise, block: SessionBlock): Row[] {
    if (block.type === "superset") {
      const open = openRounds(block, ex);
      const rounds = [...new Set([...ex.sets.map((s) => s.round_index), ...open])]
        .sort((a, b) => a - b);
      return rounds.map((r) => ({
        setIndex: r,
        roundIndex: r,
        logged: ex.sets.find((s) => s.round_index === r),
      }));
    }
    const highest = ex.sets.reduce((m, s) => Math.max(m, s.set_index + 1), 0);
    const count = Math.max(ex.target_sets, highest + (blockDone(block) ? 0 : 1));
    return Array.from({ length: count }, (_, i) => ({
      setIndex: i,
      roundIndex: 0,
      logged: ex.sets.find((s) => s.set_index === i),
    }));
  }

  const currentIndex = $derived(
    session ? Math.max(0, session.blocks.findIndex((b) => !blockDone(b))) : 0,
  );

  async function log(ex: LoggedExercise, values: Partial<LoggedSet>) {
    await logSet({ id: uuidv7(), logged_exercise_id: ex.id, ...values } as never);
    await flush();
    await reload();
  }

  async function skip(ex: LoggedExercise, setIndex: number, round: number) {
    await logSet({
      id: uuidv7(), logged_exercise_id: ex.id,
      set_index: setIndex, round_index: round, skipped: true,
    } as never);
    await flush();
    await reload();
  }

  async function saveNote(ex: LoggedExercise, note: string) {
    await setExerciseNote(ex.id, note);
    await flush();
  }

  /**
   * Close a superset before its last round.
   *
   * Rounds advance by themselves once every exercise has logged, so this is the
   * only thing a button here can mean. The rounds not done are written as
   * skipped sets, so history says "round 3 — not done" rather than looking like
   * the superset was only ever two rounds long. Skipped sets are already left
   * out of every volume and 1RM number.
   */
  async function endSuperset(block: SessionBlock) {
    endingBlock = null;
    for (const { exerciseIndex, rounds } of remainingRounds(block)) {
      const ex = block.exercises[exerciseIndex]!;
      for (const round of rounds) {
        await logSet({
          id: uuidv7(), logged_exercise_id: ex.id,
          set_index: round, round_index: round, skipped: true,
        } as never);
      }
    }
    await flush();
    await reload();
  }

  /** How much a confirm has to warn about. */
  const roundsLeft = (block: SessionBlock) =>
    roundsPlanned(block) - currentRound(block);

  /**
   * Abandon a session started by mistake.
   *
   * Soft: the rows stay in the database and in every export, they just leave
   * history and the charts. The partial unique index ignores deleted rows, so
   * the active slot frees immediately and a new session can start.
   */
  async function discard() {
    if (!session) return;
    await removeSession(session.id);
    await flush();
    onfinished();
  }

  const loggedCount = $derived(
    session
      ? session.blocks.reduce(
          (n, b) => n + b.exercises.reduce((m, e) => m + e.sets.length, 0), 0)
      : 0,
  );

  async function finish() {
    if (!session) return;
    await flush();
    await finishSession(session.id, notes);
    onfinished();
  }
</script>

{#if error}
  <p class="err">{error}</p>
{:else if session}
  <div class="head">
    <span class="grow">
      <b>{session.program_name ?? "Ad-hoc session"}</b>
      <span class="mono">{elapsed} · {session.blocks.reduce(
        (n, b) => n + b.exercises.reduce((m, e) => m + e.sets.length, 0), 0)} sets</span>
    </span>
    <button class="finish" onclick={() => (finishing = true)}>Finish</button>
  </div>

  <SyncBar />

  {#each session.blocks as block, bi (block.id)}
    {@const round = currentRound(block)}
    {@const rounds = roundsPlanned(block)}
    {@const done = blockDone(block)}
    <!-- Past quiet, current strong, future neutral. The accent rule marks
         state without drowning the numbers. -->
    <section class="block" class:done class:current={!done && bi === currentIndex}>
      <header>
        <span class="grow">
          {#if block.type === "superset"}
            <b>Superset · Round {Math.min(round + 1, rounds)} of {rounds}</b>
            <span class="ss">{block.exercises.map((e) => e.exercise_name).join(" + ")}</span>
          {:else}
            <b>{block.exercises[0]?.exercise_name}</b>
            <span class="ss">
              Single · {block.exercises[0]?.sets.length ?? 0} of {block.exercises[0]?.target_sets} sets
            </span>
          {/if}
        </span>
        {#if block.type === "single" && block.exercises[0]}
          <Badge type={block.exercises[0].metric_type} />
        {/if}
      </header>

      {#each block.exercises as ex (ex.id)}
        <div class="ex">
          {#if block.type === "superset"}
            <div class="exh">
              <b>{ex.exercise_name}</b>
              <Badge type={ex.metric_type} />
            </div>
          {/if}

          <div class="sets">
            {#each rowsFor(ex, block) as row (ex.id + ":" + row.roundIndex + ":" + row.setIndex)}
              <SetRow
                metricType={ex.metric_type}
                setIndex={row.setIndex}
                roundIndex={row.roundIndex}
                logged={row.logged}
                prefill={session.prefill[ex.id]?.[row.setIndex] ?? null}
                onlog={(v) => log(ex, v)}
                onskip={() => skip(ex, row.setIndex, row.roundIndex)} />
            {/each}
          </div>

          <input
            class="note" placeholder="How you did it today — bench angle, grip…"
            value={ex.note}
            onchange={(e) => saveNote(ex, (e.currentTarget as HTMLInputElement).value)} />
        </div>
      {/each}

      {#if block.type === "superset" && !done}
        {#if endingBlock === block.id}
          <!-- "Stop after round 2" would claim round 2 was finished, and the
               usual reason to press this is that it is half done. -->
          <p class="ending">
            Stop here? The {roundsLeft(block) === 1
              ? "last round"
              : `remaining ${roundsLeft(block)} rounds`} will show in history as
            not done.
          </p>
          <div class="pair">
            <button class="next-round" onclick={() => (endingBlock = null)}>Keep going</button>
            <button class="next-round go" onclick={() => endSuperset(block)}>End it</button>
          </div>
        {:else}
          <!-- Rounds advance on their own once both exercises log, so the only
               thing this can mean is leaving before the end. It says so. -->
          <button class="next-round" onclick={() => (endingBlock = block.id)}>
            End this superset
          </button>
        {/if}
      {/if}
    </section>
  {/each}

  {#if finishing}
    <div class="confirm">
      <p>Finish <strong>{session.program_name ?? "this session"}</strong>?</p>
      <input class="note" bind:value={notes} placeholder="Session notes (optional)" />
      <p class="hint">
        Duration counts to your last logged set, not to now — walking to the
        shower is not training.
      </p>
      <div class="row">
        <button class="btn ghost" onclick={() => (finishing = false)}>Keep going</button>
        <button class="btn" onclick={finish}>Finish</button>
      </div>
    </div>
  {:else if discarding}
    <div class="confirm danger">
      <p>Discard <strong>{session.program_name ?? "this session"}</strong>?</p>
      <p class="hint">
        {loggedCount === 0
          ? "Nothing has been logged yet."
          : `${loggedCount} set${loggedCount === 1 ? "" : "s"} logged. They leave history and charts, but stay in the database and in every export.`}
      </p>
      <div class="row">
        <button class="btn ghost" onclick={() => (discarding = false)}>Keep going</button>
        <button class="btn danger" onclick={discard}>Discard</button>
      </div>
    </div>
  {:else}
    <button class="btn" onclick={() => (finishing = true)}>Finish session</button>
    <button class="btn ghost quiet" onclick={() => (discarding = true)}>Discard session</button>
  {/if}
{:else}
  <p class="hint">No session in progress.</p>
{/if}

<style>
  /* Ending the block is not closing a set: outline, not filled, and it sits
     under the exercises it applies to rather than among the set actions. */
  .next-round {
    width: 100%; min-height: 44px; margin-top: var(--s2);
    border: 1px solid var(--line-strong); border-radius: var(--r-row);
    background: transparent; color: var(--ink-secondary);
    font-family: var(--f-display); font-size: 15px; font-weight: 600;
  }

  .next-round.go { border-color: var(--accent); color: var(--accent); }
  .pair { display: flex; gap: var(--s2); }
  .pair .next-round { flex: 1; }
  .ending {
    font-size: 13px; line-height: 18px; color: var(--ink-secondary);
    background: var(--surface-inset); border: 1px solid var(--line);
    border-radius: var(--r-row); padding: var(--s2) var(--s3); margin: var(--s2) 0 0;
  }

  /* Discarding is rare and destructive: quiet until it is asked for. */
  .btn.ghost.quiet { color: var(--ink-muted); font-size: 15px; height: 44px; }
  .confirm.danger { border-color: var(--danger); }
  .btn.danger { background: var(--danger); border-color: var(--danger); color: #fff; }

  .head { display: flex; align-items: center; gap: var(--s3); }
  .head .grow { flex: 1; min-width: 0; }
  .head b { font-family: var(--f-display); font-size: 20px; line-height: 24px;
            font-weight: 700; display: block; }
  .mono { font-family: var(--f-data); font-size: 13px; color: var(--ink-muted);
          font-variant-numeric: tabular-nums; }
  .finish { font-family: var(--f-display); font-size: 15px; font-weight: 600;
            color: var(--accent); min-height: 44px; flex: none; }

  .block { background: var(--surface); border: 1px solid var(--line);
           border-radius: var(--r-card); overflow: hidden; position: relative; }
  .block.done { background: var(--surface-inset); box-shadow: none; }
  .block.done > header { background: transparent; }
  .block.done > header b { font-weight: 600; color: var(--ink-secondary); }
  .block.current { box-shadow: var(--shadow-active); }
  .block.current::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0;
                           width: 3px; background: var(--accent); }
  .block > header { display: flex; align-items: center; gap: var(--s2);
                    padding: 10px var(--s3); border-bottom: 1px solid var(--line);
                    background: var(--surface-raised); }
  .block > header .grow { flex: 1; min-width: 0; }
  .block > header b { font-family: var(--f-display); font-size: 17px; line-height: 22px;
                      font-weight: 700; display: block; }
  .ss { font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
        letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted); }

  .ex { padding: 10px var(--s3) var(--s3); }
  .ex + .ex { border-top: 1px solid var(--line); }
  .exh { display: flex; align-items: center; gap: var(--s2); margin-bottom: var(--s2); }
  .exh b { font-size: 16px; line-height: 23px; font-weight: 600; flex: 1; min-width: 0; }
  .sets { display: flex; flex-direction: column; gap: 6px; }

  .note { width: 100%; background: var(--surface-inset);
          border: 1px dashed var(--line-strong); border-radius: var(--r-control);
          padding: 8px var(--s3); font-size: 15px; line-height: 21px;
          color: var(--ink); font-family: var(--f-ui); margin-top: var(--s2); }
  .note:focus { border-style: solid; border-color: var(--accent); outline: none; }

  .hint { font-size: 13px; line-height: 18px; color: var(--ink-muted); margin: 0; }
  .err { font-size: 15px; color: var(--danger); margin: 0; }

  .btn { display: flex; align-items: center; justify-content: center;
         height: 52px; width: 100%; border-radius: var(--r-row);
         font-family: var(--f-display); font-size: 16px; font-weight: 700;
         background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent); }
  .btn.ghost { background: transparent; color: var(--ink-secondary); border-color: var(--line-strong); }
  .confirm { border: 1px solid var(--accent); border-radius: var(--r-card);
             padding: var(--s3) var(--s4); display: flex; flex-direction: column; gap: var(--s3); }
  .confirm p { margin: 0; font-size: 15px; line-height: 21px; }
  .row { display: flex; gap: var(--s2); } .row .btn { flex: 1; }
</style>
