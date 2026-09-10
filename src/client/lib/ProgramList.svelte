<script lang="ts">
  import SyncBar from "./SyncBar.svelte";
  import { fetchPrograms, type ProgramSummary, type Include } from "./api.js";

  let { onopen }: { onopen: (id: string | null) => void } = $props();

  let include = $state<Include>("active");
  let state = $state<
    | { status: "loading" }
    | { status: "ok"; data: ProgramSummary[]; stale: boolean }
    | { status: "error"; message: string }
  >({ status: "loading" });

  export async function reload(): Promise<void> {
    try {
      const { data, stale } = await fetchPrograms(include);
      state = { status: "ok", data, stale };
    } catch (err) {
      state = { status: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  $effect(() => { void include; reload(); });

  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
</script>

<SyncBar />

<div class="chips" role="tablist">
  {#each [["active", "Active"], ["archived", "Archived"], ["all", "All"]] as const as [value, text]}
    <button class="chip" class:on={include === value} role="tab"
      aria-selected={include === value} onclick={() => (include = value)}>{text}</button>
  {/each}
</div>

{#if state.status === "ok"}
  {#if state.stale}<p class="hint">Showing the last synced copy — the server is unreachable.</p>{/if}

  {#if state.data.length === 0}
    <div class="empty">
      <p><strong>No programs yet.</strong></p>
      <p>A program is the template you log against: an ordered list of blocks,
         each holding one exercise or a superset of several.</p>
    </div>
  {:else}
    <div class="sheet">
      {#each state.data as p (p.id)}
        <button class="lrow" onclick={() => onopen(p.id)}>
          <span class="grow">
            <span class="nm">{p.name}</span>
            <span class="mt">
              {plural(p.blocks, "block")} · {plural(p.planned_sets, "set")} planned
              {#if p.archived_at}· archived{/if}
            </span>
          </span>
          <span class="chev">›</span>
        </button>
      {/each}
    </div>
  {/if}
{:else if state.status === "error"}
  <p class="err">{state.message}</p>
  <button class="btn ghost" onclick={reload}>Try again</button>
{:else}
  <p class="hint">Loading…</p>
{/if}

<p class="hint">
  Editing a program never changes sessions you already logged — the structure is
  copied into the session when it starts.
</p>

<button class="btn" onclick={() => onopen(null)}>+ New program</button>

<style>
  .chips { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .chip {
    font-family: var(--f-display); font-size: 13px; font-weight: 600;
    min-height: 36px; padding: 0 var(--s3); border-radius: var(--r-pill);
    border: 1px solid var(--line-strong); color: var(--ink-secondary); background: transparent;
  }
  .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .sheet { background: var(--surface); border: 1px solid var(--line);
           border-radius: var(--r-card); overflow: hidden; }
  .lrow { display: flex; align-items: center; gap: var(--s3);
          padding: 10px var(--s4); width: 100%; text-align: left; min-height: 52px; }
  .lrow + .lrow { border-top: 1px solid var(--line); }
  .grow { flex: 1; min-width: 0; }
  .nm { font-weight: 600; font-size: 16px; line-height: 23px; display: block;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mt { font-size: 13px; line-height: 18px; color: var(--ink-muted); display: block; }
  .chev { color: var(--line-strong); font-size: 18px; flex: none; }
  .empty { background: var(--surface); border: 1px dashed var(--line-strong);
           border-radius: var(--r-card); padding: var(--s4);
           color: var(--ink-secondary); font-size: 15px; line-height: 21px; }
  .empty p { margin: 0; } .empty p + p { margin-top: var(--s2); }
  .hint { font-size: 13px; line-height: 18px; color: var(--ink-muted); margin: 0; }
  .err { font-size: 15px; color: var(--danger); margin: 0; }
  .btn { display: flex; align-items: center; justify-content: center;
         height: 52px; width: 100%; border-radius: var(--r-row);
         font-family: var(--f-display); font-size: 16px; font-weight: 700;
         background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent);
         margin-top: auto; }
  .btn.ghost { background: transparent; color: var(--ink-secondary);
               border-color: var(--line-strong); margin-top: 0; }
</style>
