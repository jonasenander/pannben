<script lang="ts">
  import { uuidv7 } from "./uuid.js";
  import { saveBodyMetric, bodyMetricAction, fetchBodyMetrics, type BodyMetric } from "./api.js";

  let { id, ondone }: { id: string | null; ondone: () => void } = $props();

  let name = $state("");
  let unit = $state("");
  let existing = $state<BodyMetric | null>(null);
  let error = $state<string | null>(null);
  let saving = $state(false);
  let confirmDelete = $state(false);

  $effect(() => {
    if (id === null) return;
    void (async () => {
      const all = (await fetchBodyMetrics("all")).data;
      const found = all.find((m) => m.id === id) ?? null;
      existing = found;
      if (found) { name = found.name; unit = found.unit; }
    })();
  });

  const ready = $derived(name.trim() !== "" && unit.trim() !== "");

  async function save() {
    if (!ready) return;
    saving = true;
    error = null;
    try {
      await saveBodyMetric({ id: id ?? uuidv7(), name: name.trim(), unit: unit.trim() });
      ondone();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  async function act(action: "archive" | "unarchive" | "delete") {
    try {
      await bodyMetricAction(id!, action);
      ondone();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div class="field">
  <label for="bm-name">Name</label>
  <input id="bm-name" bind:value={name} placeholder="Weight"
    autocomplete="off" autocapitalize="sentences" />
</div>

<div class="field">
  <label for="bm-unit">Unit</label>
  <input id="bm-unit" bind:value={unit} placeholder="kg"
    autocomplete="off" autocapitalize="none" />
  <p class="hint">
    Whatever the number is measured in — kg, cm, bpm. A reading stores only the
    number, so the unit lives here and can never disagree with it.
  </p>
</div>

{#if error}<p class="err">{error}</p>{/if}

<button class="btn" disabled={!ready || saving} onclick={save}>Save</button>

{#if id !== null && existing}
  {#if existing.archived_at}
    <button class="btn ghost" onclick={() => act("unarchive")}>
      Unarchive — show it on Home again
    </button>
  {:else}
    <button class="btn ghost" onclick={() => act("archive")}>
      Archive — hide it from Home, keep the readings
    </button>
  {/if}

  {#if confirmDelete}
    <p class="warn">
      Deleting hides this metric and every reading of it. They stay in the
      database and in every export, and the name frees up for reuse.
    </p>
    <div class="pair">
      <button class="btn ghost" onclick={() => (confirmDelete = false)}>Keep it</button>
      <button class="btn danger" onclick={() => act("delete")}>Delete</button>
    </div>
  {:else}
    <button class="btn ghost danger-text" onclick={() => (confirmDelete = true)}>
      Delete this metric
    </button>
  {/if}
{/if}

<style>
  .field { display: flex; flex-direction: column; gap: var(--s1); }
  label {
    font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted);
  }
  input {
    height: 52px; border: 1px solid var(--line-strong); border-radius: var(--r-control);
    background: var(--surface); color: var(--ink); padding: 0 var(--s3);
    font-family: var(--f-ui); font-size: 16px;
  }
  .hint { font-size: 13px; line-height: 18px; color: var(--ink-muted); margin: 0; }
  .err { font-size: 15px; color: var(--danger); margin: 0; }
  .warn {
    font-size: 13px; line-height: 18px; color: var(--ink-secondary);
    background: var(--surface-inset); border: 1px solid var(--line);
    border-radius: var(--r-row); padding: var(--s3); margin: 0;
  }
  .pair { display: flex; gap: var(--s2); }
  .pair .btn { flex: 1; }
  .btn {
    display: flex; align-items: center; justify-content: center;
    height: 52px; width: 100%; border-radius: var(--r-row);
    font-family: var(--f-display); font-size: 16px; font-weight: 700;
    background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent);
  }
  .btn:disabled { opacity: .45; }
  .btn.ghost { background: transparent; color: var(--ink-secondary); border-color: var(--line-strong); }
  .btn.ghost.danger-text { color: var(--danger); }
  .btn.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
</style>
