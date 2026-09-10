<script lang="ts">
  import { uuidv7 } from "./uuid.js";
  import {
    saveExercise, METRIC_LABELS, METRIC_FIELDS,
    type Exercise, type MetricType,
  } from "./api.js";

  let { id, ondone, onchart }: {
    id: string | null;
    ondone: () => void;
    onchart: (id: string) => void;
  } = $props();

  const TYPES = Object.keys(METRIC_LABELS) as MetricType[];
  const blank = (): Exercise => ({
    id: uuidv7(),
    name: "",
    metric_type: "total_weight",
    notes: "",
    created_at: "",
    updated_at: "",
    archived_at: null,
    deleted_at: null,
  });

  let draft = $state<Exercise>(blank());
  let loading = $state(id !== null);
  let error = $state<string | null>(null);
  let confirmingDelete = $state(false);

  $effect(() => {
    if (id === null) {
      draft = blank();
      loading = false;
      return;
    }
    loading = true;
    fetch(`/api/exercises/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`server returned ${r.status}`))))
      .then((e: Exercise) => { draft = e; loading = false; })
      .catch((e: Error) => { error = e.message; loading = false; });
  });

  const nameOk = $derived(draft.name.trim().length > 0);

  async function save() {
    if (!nameOk) { error = "Give it a name first."; return; }
    await saveExercise(draft);
    ondone();
  }

  async function setFlag(field: "archived_at" | "deleted_at", on: boolean) {
    draft = { ...draft, [field]: on ? new Date().toISOString() : null };
    await saveExercise(draft);
    ondone();
  }
</script>

{#if loading}
  <p class="hint">Loading…</p>
{:else}
  <div class="field">
    <label for="ex-name">Name</label>
    <input
      id="ex-name"
      bind:value={draft.name}
      placeholder="Bench press"
      autocomplete="off"
      autocapitalize="sentences" />
  </div>

  <div class="field">
    <span class="lbl">Metric type</span>
    <div class="chips">
      {#each TYPES as t}
        <button
          class="chip"
          class:on={draft.metric_type === t}
          aria-pressed={draft.metric_type === t}
          onclick={() => (draft = { ...draft, metric_type: t })}>
          <span class="dot {t}"></span>{METRIC_LABELS[t]}
        </button>
      {/each}
    </div>
  </div>

  <div class="card">
    <span class="eyebrow">Fields logged per set</span>
    <p>{METRIC_FIELDS[draft.metric_type]}</p>
  </div>

  <div class="field">
    <label for="ex-notes">Notes</label>
    <textarea
      id="ex-notes"
      bind:value={draft.notes}
      placeholder="Anything true of this exercise in general"></textarea>
    <p class="hint">
      For how you did it on one particular day, use the note on the session instead —
      that one is expected to change week to week.
    </p>
  </div>

  {#if error}<p class="err">{error}</p>{/if}

  <button class="btn" disabled={!nameOk} onclick={save}>Save</button>

  {#if id !== null}
    <button class="btn ghost" onclick={() => onchart(id)}>Chart — progress over time</button>
  {/if}

  {#if id !== null}
    {#if draft.archived_at}
      <button class="btn ghost" onclick={() => setFlag("archived_at", false)}>
        Unarchive — show it in pickers again
      </button>
    {:else}
      <button class="btn ghost" onclick={() => setFlag("archived_at", true)}>
        Archive — keep in history, hide from pickers
      </button>
    {/if}

    {#if confirmingDelete}
      <div class="confirm">
        <p>Delete <strong>{draft.name}</strong>? It disappears from charts and history too.
           The row stays in the database and in exports.</p>
        <div class="row">
          <button class="btn ghost" onclick={() => (confirmingDelete = false)}>Cancel</button>
          <button class="btn danger" onclick={() => setFlag("deleted_at", true)}>Delete</button>
        </div>
      </div>
    {:else}
      <button class="btn danger" onclick={() => (confirmingDelete = true)}>
        Delete — it was a mistake
      </button>
    {/if}
  {/if}
{/if}

<style>
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field label, .lbl {
    font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted);
  }
  input, textarea {
    background: var(--surface-inset); border: 1px solid var(--line);
    border-radius: var(--r-control); padding: 12px var(--s3); min-height: 48px;
    font-family: var(--f-ui); font-size: 16px; line-height: 23px; width: 100%;
    color: var(--ink);
  }
  input:focus, textarea:focus { border-color: var(--accent); outline: none; }
  textarea { resize: vertical; min-height: 76px; }

  .chips { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .chip {
    font-family: var(--f-display); font-size: 13px; font-weight: 600;
    min-height: 36px; padding: 0 var(--s3); border-radius: var(--r-pill);
    border: 1px solid var(--line-strong); color: var(--ink-secondary);
    background: transparent; display: inline-flex; align-items: center; gap: 6px;
  }
  .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .dot.total_weight { background: var(--m-total); }
  .dot.bodyweight { background: var(--m-body); }
  .dot.bodyweight_plus { background: var(--m-bodyplus); }
  .dot.dumbbell { background: var(--m-db); }
  .dot.cardio { background: var(--m-cardio); }
  .dot.hold { background: var(--m-hold); }
  .chip.on .dot { background: var(--accent-ink); }

  .card {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r-card); padding: var(--s3) var(--s4);
  }
  .card p { margin: 4px 0 0; font-size: 15px; line-height: 21px; color: var(--ink-secondary); }
  .eyebrow {
    font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted);
  }

  .hint { font-size: 13px; line-height: 18px; color: var(--ink-muted); margin: 0; }
  .err { font-size: 15px; color: var(--danger); margin: 0; }

  .btn {
    display: flex; align-items: center; justify-content: center;
    height: 52px; width: 100%; border-radius: var(--r-row);
    font-family: var(--f-display); font-size: 16px; font-weight: 700;
    background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent);
  }
  .btn:disabled { opacity: 0.45; }
  .btn.ghost { background: transparent; color: var(--ink-secondary); border-color: var(--line-strong); }
  .btn.danger { background: transparent; color: var(--danger); border-color: var(--danger); }

  .confirm {
    border: 1px solid var(--danger); border-radius: var(--r-card);
    padding: var(--s3) var(--s4); display: flex; flex-direction: column; gap: var(--s3);
  }
  .confirm p { margin: 0; font-size: 15px; line-height: 21px; }
  .row { display: flex; gap: var(--s2); }
  .row .btn { flex: 1; }
</style>
