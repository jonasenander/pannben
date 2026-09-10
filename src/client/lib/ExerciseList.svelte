<script lang="ts">
  import Badge from "./Badge.svelte";
  import SyncBar from "./SyncBar.svelte";
  import { fetchExercises, type Exercise, type ExerciseList, type Include } from "./api.js";

  let { onopen }: { onopen: (id: string | null) => void } = $props();

  let include = $state<Include>("active");
  let view = $state<
    | { status: "loading" }
    | { status: "ok"; data: ExerciseList; stale: boolean }
    | { status: "error"; message: string }
  >({ status: "loading" });

  export async function reload(): Promise<void> {
    try {
      const { data, stale } = await fetchExercises(include);
      view = { status: "ok", data, stale };
    } catch (err) {
      view = { status: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  $effect(() => {
    void include;
    reload();
  });

  const label = (e: Exercise) =>
    e.archived_at ? "Archived" : e.notes ? e.notes : "";
</script>

<SyncBar />

<div class="chips" role="tablist">
  {#each [["active", "Active"], ["archived", "Archived"], ["all", "All"]] as const as [value, text]}
    <button
      class="chip"
      class:on={include === value}
      role="tab"
      aria-selected={include === value}
      onclick={() => (include = value)}>{text}</button>
  {/each}
</div>

{#if view.status === "ok"}
  {#if view.stale}
    <p class="hint">Showing the last synced copy — the server is unreachable.</p>
  {/if}

  {#if view.data.exercises.length === 0}
    <div class="empty">
      <p><strong>Nothing here yet.</strong></p>
      <p>
        {include === "active"
          ? "Add the exercises you actually do. You can rename them later — everything references them by id, so history follows the rename."
          : include === "archived"
            ? "Archived exercises stay in your history and charts, they just stop appearing in pickers."
            : "No exercises yet."}
      </p>
    </div>
  {:else}
    <div class="sheet">
      {#each view.data.exercises as e (e.id)}
        <button class="lrow" onclick={() => onopen(e.id)}>
          <span class="grow">
            <span class="nm">{e.name}</span>
            {#if label(e)}<span class="mt">{label(e)}</span>{/if}
          </span>
          <Badge type={e.metric_type} />
          <span class="chev">›</span>
        </button>
      {/each}
    </div>
  {/if}

  <p class="hint">
    {view.data.counts.active} active · {view.data.counts.archived} archived
  </p>
{:else if view.status === "error"}
  <p class="err">{view.message}</p>
  <button class="btn ghost" onclick={reload}>Try again</button>
{:else}
  <p class="hint">Loading…</p>
{/if}

<button class="btn" onclick={() => onopen(null)}>+ New exercise</button>

<style>
  .chips { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .chip {
    font-family: var(--f-display); font-size: 13px; font-weight: 600;
    min-height: 36px; padding: 0 var(--s3); border-radius: var(--r-pill);
    border: 1px solid var(--line-strong); color: var(--ink-secondary);
    background: transparent;
  }
  .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }

  .sheet {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r-card); overflow: hidden;
  }
  .lrow {
    display: flex; align-items: center; gap: var(--s3);
    padding: 10px var(--s4); width: 100%; text-align: left; min-height: 52px;
  }
  .lrow + .lrow { border-top: 1px solid var(--line); }
  .grow { flex: 1; min-width: 0; }
  .nm {
    font-weight: 600; font-size: 16px; line-height: 23px; display: block;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .mt {
    font-size: 13px; line-height: 18px; color: var(--ink-muted); display: block;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .chev { color: var(--line-strong); font-size: 18px; flex: none; }

  .empty {
    background: var(--surface); border: 1px dashed var(--line-strong);
    border-radius: var(--r-card); padding: var(--s4);
    color: var(--ink-secondary); font-size: 15px; line-height: 21px;
  }
  .empty p { margin: 0; }
  .empty p + p { margin-top: var(--s2); }

  .hint { font-size: 13px; line-height: 18px; color: var(--ink-muted); margin: 0; }
  .err { font-size: 15px; color: var(--danger); margin: 0; }

  .btn {
    display: flex; align-items: center; justify-content: center;
    height: 52px; width: 100%; border-radius: var(--r-row);
    font-family: var(--f-display); font-size: 16px; font-weight: 700;
    background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent);
    margin-top: auto;
  }
  .btn.ghost {
    background: transparent; color: var(--ink-secondary);
    border-color: var(--line-strong); margin-top: 0;
  }
</style>
