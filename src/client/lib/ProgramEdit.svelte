<script lang="ts">
  import { uuidv7 } from "./uuid.js";
  import Badge from "./Badge.svelte";
  import {
    saveProgram, fetchExercises,
    type Program, type ProgramBlock, type Exercise, type BlockType,
  } from "./api.js";

  let { id, ondone }: { id: string | null; ondone: () => void } = $props();

  const blank = (): Program => ({
    id: uuidv7(), name: "", created_at: "", updated_at: "",
    archived_at: null, deleted_at: null, blocks: [],
  });

  let draft = $state<Program>(blank());
  let exercises = $state<Exercise[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let picking = $state<{ blockId: string } | null>(null);
  let confirmingDelete = $state(false);

  $effect(() => {
    const load = async () => {
      loading = true;
      try {
        const [{ data }] = await Promise.all([fetchExercises("active")]);
        exercises = data.exercises;
        if (id !== null) {
          const res = await fetch(`/api/programs/${id}`);
          if (!res.ok) throw new Error(`server returned ${res.status}`);
          draft = (await res.json()) as Program;
        } else {
          draft = blank();
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        loading = false;
      }
    };
    void load();
  });

  const nameOk = $derived(draft.name.trim().length > 0);

  function addBlock(type: BlockType) {
    draft = { ...draft, blocks: [...draft.blocks, { id: uuidv7(), type, entries: [] }] };
    picking = { blockId: draft.blocks[draft.blocks.length - 1]!.id };
  }

  function addEntry(blockId: string, exercise: Exercise) {
    draft = {
      ...draft,
      blocks: draft.blocks.map((b) =>
        b.id !== blockId ? b : {
          ...b,
          entries: [...b.entries, {
            id: uuidv7(), exercise_id: exercise.id, target_sets: 3,
            exercise_name: exercise.name, metric_type: exercise.metric_type,
          }],
        }),
    };
    picking = null;
  }

  const mutate = (blockId: string, fn: (b: ProgramBlock) => ProgramBlock) =>
    (draft = { ...draft, blocks: draft.blocks.map((b) => (b.id === blockId ? fn(b) : b)) });

  const setTarget = (blockId: string, entryId: string, delta: number) =>
    mutate(blockId, (b) => ({
      ...b,
      entries: b.entries.map((e) =>
        e.id !== entryId ? e : { ...e, target_sets: Math.min(50, Math.max(1, e.target_sets + delta)) }),
    }));

  const removeEntry = (blockId: string, entryId: string) =>
    mutate(blockId, (b) => ({ ...b, entries: b.entries.filter((e) => e.id !== entryId) }));

  const removeBlock = (blockId: string) =>
    (draft = { ...draft, blocks: draft.blocks.filter((b) => b.id !== blockId) });

  function moveBlock(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= draft.blocks.length) return;
    const blocks = [...draft.blocks];
    [blocks[index], blocks[to]] = [blocks[to]!, blocks[index]!];
    draft = { ...draft, blocks };
  }

  /** The server enforces these too; showing them here keeps the fix in reach. */
  const problems = $derived(
    draft.blocks.flatMap((b, i) =>
      b.type === "single" && b.entries.length !== 1
        ? [`Block ${i + 1} is a single block, so it holds exactly one exercise.`]
        : b.type === "superset" && b.entries.length < 2
          ? [`Block ${i + 1} is a superset, so it needs at least two exercises.`]
          : []),
  );

  async function save() {
    error = null;
    try {
      await saveProgram(draft);
      ondone();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function flag(field: "archived_at" | "deleted_at", on: boolean) {
    try {
      await saveProgram({ ...draft, [field]: on ? new Date().toISOString() : null });
      ondone();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
</script>

{#if loading}
  <p class="hint">Loading…</p>
{:else}
  <div class="field">
    <label for="prog-name">Program name</label>
    <input id="prog-name" bind:value={draft.name} placeholder="Push A" autocomplete="off" />
  </div>

  {#each draft.blocks as block, i (block.id)}
    <!-- A block is the semantic unit, so it gets the card. Its exercises are
         inset rows inside it, which is what makes a superset read as one thing. -->
    <section class="block">
      <header>
        <span class="grow">
          <b>Block {i + 1} · {block.type === "single" ? "Single" : "Superset"}</b>
          {#if block.type === "superset"}<span class="ss">Logged round by round</span>{/if}
        </span>
        <button class="icon" onclick={() => moveBlock(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
        <button class="icon" onclick={() => moveBlock(i, 1)} disabled={i === draft.blocks.length - 1} aria-label="Move down">↓</button>
        <button class="icon danger" onclick={() => removeBlock(block.id)} aria-label="Remove block">×</button>
      </header>

      <div class="body">
        {#each block.entries as entry (entry.id)}
          <!-- Name on its own line: it is the content, and truncating an
               exercise name to "I..." helps nobody. Controls sit under it. -->
          <div class="entry">
            <span class="nm">{entry.exercise_name}</span>
            <div class="controls">
              <div class="step">
                <button onclick={() => setTarget(block.id, entry.id, -1)} aria-label="Fewer sets">−</button>
                <span class="nv"><span class="n">{entry.target_sets}</span><span class="u">sets</span></span>
                <button onclick={() => setTarget(block.id, entry.id, 1)} aria-label="More sets">+</button>
              </div>
              <button class="icon danger" onclick={() => removeEntry(block.id, entry.id)} aria-label="Remove exercise">×</button>
            </div>
          </div>
        {/each}

        {#if picking?.blockId === block.id}
          <div class="picker">
            <span class="eyebrow">Add an exercise</span>
            {#each exercises.filter((e) => !block.entries.some((x) => x.exercise_id === e.id)) as e (e.id)}
              <button class="pick" onclick={() => addEntry(block.id, e)}>
                <span class="grow">{e.name}</span><Badge type={e.metric_type} />
              </button>
            {/each}
            <button class="link" onclick={() => (picking = null)}>Cancel</button>
          </div>
        {:else}
          <button class="link" onclick={() => (picking = { blockId: block.id })}>
            + Add exercise{block.type === "superset" ? " to this superset" : ""}
          </button>
        {/if}
      </div>
    </section>
  {/each}

  <div class="chips">
    <button class="chip" onclick={() => addBlock("single")}>+ Single block</button>
    <button class="chip" onclick={() => addBlock("superset")}>+ Superset block</button>
  </div>

  {#if problems.length > 0}
    <div class="warn">
      {#each problems as p}<p>{p}</p>{/each}
    </div>
  {/if}

  <p class="hint">
    Target sets decides how many empty rows appear when you log. It sets no
    values — those come from your last session or stay blank.
  </p>

  {#if error}<p class="err">{error}</p>{/if}

  <button class="btn" disabled={!nameOk || problems.length > 0} onclick={save}>Save program</button>

  {#if id !== null}
    {#if draft.archived_at}
      <button class="btn ghost" onclick={() => flag("archived_at", false)}>Unarchive</button>
    {:else}
      <button class="btn ghost" onclick={() => flag("archived_at", true)}>Archive</button>
    {/if}
    {#if confirmingDelete}
      <div class="confirm">
        <p>Delete <strong>{draft.name}</strong>? Sessions already logged against it keep
           their own copy of the structure and are unaffected.</p>
        <div class="row">
          <button class="btn ghost" onclick={() => (confirmingDelete = false)}>Cancel</button>
          <button class="btn danger" onclick={() => flag("deleted_at", true)}>Delete</button>
        </div>
      </div>
    {:else}
      <button class="btn danger" onclick={() => (confirmingDelete = true)}>Delete program</button>
    {/if}
  {/if}
{/if}

<style>
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field label {
    font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted);
  }
  input {
    background: var(--surface-inset); border: 1px solid var(--line);
    border-radius: var(--r-control); padding: 12px var(--s3); min-height: 48px;
    font-family: var(--f-ui); font-size: 16px; line-height: 23px; width: 100%; color: var(--ink);
  }
  input:focus { border-color: var(--accent); outline: none; }

  .block {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r-card); overflow: hidden;
  }
  .block > header {
    display: flex; align-items: center; gap: 4px; padding: 10px var(--s3);
    border-bottom: 1px solid var(--line); background: var(--surface-raised);
  }
  .block > header .grow { flex: 1; min-width: 0; }
  .block > header b {
    font-family: var(--f-display); font-size: 17px; line-height: 22px;
    font-weight: 700; display: block;
  }
  .ss {
    font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted);
  }
  .body { padding: 10px var(--s3) var(--s3); display: flex; flex-direction: column; gap: 6px; }

  .entry {
    display: flex; flex-direction: column; gap: 6px; padding: 10px;
    background: var(--surface-inset); border: 1px solid var(--line); border-radius: var(--r-row);
  }
  .entry .nm { font-size: 16px; line-height: 23px; font-weight: 600; }
  .controls { display: flex; align-items: center; gap: var(--s2); }
  .controls .step { margin-right: auto; }

  .step {
    height: 44px; width: 132px; flex: none; display: flex; align-items: center;
    background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--r-control);
  }
  .step button { width: 34px; height: 100%; font-size: 19px; color: var(--ink-secondary); flex: none; }
  .step button:first-child { border-right: 1px solid var(--line); }
  .step button:last-child { border-left: 1px solid var(--line); }
  .nv { flex: 1; min-width: 0; display: flex; align-items: baseline;
        justify-content: center; gap: 4px; overflow: hidden; }
  .n { font-family: var(--f-data); font-size: 16px; font-weight: 500;
       font-variant-numeric: tabular-nums; flex: none; }
  .u { font-family: var(--f-display); font-size: 9px; font-weight: 600; letter-spacing: 0.03em;
       text-transform: uppercase; color: var(--ink-muted); white-space: nowrap;
       flex: 0 1 auto; min-width: 0; overflow: hidden; }

  .icon {
    width: 36px; height: 36px; flex: none; border-radius: var(--r-control);
    color: var(--ink-secondary); font-size: 17px;
    display: flex; align-items: center; justify-content: center;
  }
  .icon:disabled { opacity: 0.3; }
  .icon.danger { color: var(--danger); }

  .picker { display: flex; flex-direction: column; gap: 4px;
            border: 1px dashed var(--line-strong); border-radius: var(--r-row); padding: var(--s2); }
  .pick { display: flex; align-items: center; gap: var(--s2); min-height: 44px;
          padding: 0 var(--s2); text-align: left; border-radius: var(--r-control); }
  .pick:hover { background: var(--surface-inset); }
  .pick .grow { flex: 1; min-width: 0; font-size: 16px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .link { font-family: var(--f-display); font-size: 15px; font-weight: 600;
          color: var(--accent); min-height: 44px; text-align: left; }
  .eyebrow { font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
             letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted); }

  .chips { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .chip { font-family: var(--f-display); font-size: 13px; font-weight: 600; min-height: 36px;
          padding: 0 var(--s3); border-radius: var(--r-pill);
          border: 1px solid var(--line-strong); color: var(--ink-secondary); background: transparent; }

  .warn { border: 1px solid var(--warning); border-radius: var(--r-group);
          padding: 10px var(--s3); color: var(--ink); font-size: 15px; line-height: 21px; }
  .warn p { margin: 0; } .warn p + p { margin-top: 4px; }

  .hint { font-size: 13px; line-height: 18px; color: var(--ink-muted); margin: 0; }
  .err { font-size: 15px; color: var(--danger); margin: 0; }

  .btn { display: flex; align-items: center; justify-content: center;
         height: 52px; width: 100%; border-radius: var(--r-row);
         font-family: var(--f-display); font-size: 16px; font-weight: 700;
         background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent); }
  .btn:disabled { opacity: 0.45; }
  .btn.ghost { background: transparent; color: var(--ink-secondary); border-color: var(--line-strong); }
  .btn.danger { background: transparent; color: var(--danger); border-color: var(--danger); }
  .confirm { border: 1px solid var(--danger); border-radius: var(--r-card);
             padding: var(--s3) var(--s4); display: flex; flex-direction: column; gap: var(--s3); }
  .confirm p { margin: 0; font-size: 15px; line-height: 21px; }
  .row { display: flex; gap: var(--s2); } .row .btn { flex: 1; }
</style>
