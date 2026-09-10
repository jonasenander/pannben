<script lang="ts">
  import SyncBar from "./SyncBar.svelte";
  import {
    fetchHistory, fetchPrograms, formatMinutes, formatDate, relativeDay,
    type SessionSummary, type ProgramSummary,
  } from "./api.js";

  let { onopen }: { onopen: (id: string) => void } = $props();

  const PAGE = 25;

  let programId = $state<string | "">("");
  let programs = $state<ProgramSummary[]>([]);
  let sessions = $state<SessionSummary[]>([]);
  let stale = $state(false);
  let error = $state<string | null>(null);
  let loading = $state(true);
  /** Null until the first short page tells us there is nothing more. */
  let more = $state(true);

  export async function reload(): Promise<void> {
    loading = true;
    try {
      const { data, stale: s } = await fetchHistory({
        program_id: programId || undefined,
        limit: PAGE,
      });
      sessions = data;
      stale = s;
      more = data.length === PAGE;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function loadMore() {
    const { data } = await fetchHistory({
      program_id: programId || undefined,
      limit: PAGE,
      offset: sessions.length,
    });
    sessions = [...sessions, ...data];
    more = data.length === PAGE;
  }

  $effect(() => {
    void programId;
    void reload();
  });

  $effect(() => {
    void (async () => { programs = (await fetchPrograms("all")).data; })();
  });

  /** A month heading every time the month changes, so a long list stays navigable. */
  function monthOf(iso: string): string {
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  const grouped = $derived.by(() => {
    const out: { month: string; sessions: SessionSummary[] }[] = [];
    for (const s of sessions) {
      const month = monthOf(s.date);
      if (out.at(-1)?.month !== month) out.push({ month, sessions: [] });
      out.at(-1)!.sessions.push(s);
    }
    return out;
  });
</script>

<SyncBar />

{#if programs.length > 0}
  <label class="filter">
    <span class="eyebrow">Program</span>
    <select bind:value={programId}>
      <option value="">All programs</option>
      {#each programs as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
  </label>
{/if}

{#if error}
  <p class="err">{error}</p>
  <button class="btn ghost" onclick={reload}>Try again</button>
{:else if loading && sessions.length === 0}
  <p class="hint">Loading…</p>
{:else if sessions.length === 0}
  <div class="empty">
    <p><strong>No sessions yet.</strong></p>
    <p>
      {programId
        ? "Nothing logged against this program. Try All programs."
        : "Once you log a workout it shows up here, newest first."}
    </p>
  </div>
{:else}
  {#if stale}
    <p class="hint">Showing the last synced copy — the server is unreachable.</p>
  {/if}

  {#each grouped as group (group.month)}
    <span class="eyebrow month">{group.month}</span>
    <!-- One surface with dividers. A card per session would put 24 shadows on
         a screen whose job is to be scanned, not admired. -->
    <div class="sheet">
      {#each group.sessions as s (s.id)}
        <button class="srow" onclick={() => onopen(s.id)}>
          <span class="head">
            <span class="date">{formatDate(s.date)}</span>
            {#if s.status === "active"}
              <span class="live">In progress</span>
            {:else if relativeDay(s.date)}
              <span class="ago">{relativeDay(s.date)}</span>
            {/if}
          </span>
          <span class="nm">{s.program_name ?? "Ad-hoc session"}</span>
          <span class="stats">
            <b>{s.set_count}</b> sets
            <i>·</i> <b>{s.exercise_count}</b> exercises
            <i>·</i> <b>{formatMinutes(s.duration_s)}</b>
          </span>
          {#if s.notes}<span class="note">{s.notes}</span>{/if}
        </button>
      {/each}
    </div>
  {/each}

  {#if more}
    <button class="btn ghost" onclick={loadMore}>Load more</button>
  {/if}
{/if}

<style>
  .filter { display: flex; flex-direction: column; gap: 4px; }
  select {
    height: 44px; border-radius: var(--r-control); border: 1px solid var(--line-strong);
    background: var(--surface); color: var(--ink); padding: 0 var(--s3);
    font-family: var(--f-ui); font-size: 15px; width: 100%;
  }

  .eyebrow {
    font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted);
  }
  .month { margin-top: var(--s2); }

  .sheet {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r-card); overflow: hidden;
  }
  .srow {
    display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
    padding: 10px var(--s4); min-height: 52px;
  }
  .srow + .srow { border-top: 1px solid var(--line); }
  .head { display: flex; align-items: baseline; gap: var(--s2); }
  .date {
    font-family: var(--f-data); font-size: 15px; font-weight: 500;
    color: var(--ink); flex: 1; min-width: 0;
  }
  .ago { font-size: 12px; color: var(--ink-muted); flex: none; }
  .live {
    font-family: var(--f-display); font-size: 11px; font-weight: 700; flex: none;
    letter-spacing: .06em; text-transform: uppercase;
    color: var(--accent-ink); background: var(--accent);
    border-radius: var(--r-pill); padding: 3px 9px;
  }
  .nm {
    font-family: var(--f-display); font-size: 17px; line-height: 23px; font-weight: 700;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .stats { font-size: 13px; line-height: 18px; color: var(--ink-muted); }
  .stats b {
    font-family: var(--f-data); font-variant-numeric: tabular-nums;
    font-weight: 500; color: var(--ink-secondary);
  }
  .stats i { font-style: normal; color: var(--line-strong); margin: 0 2px; }
  .note {
    font-size: 13px; line-height: 18px; color: var(--ink-secondary);
    margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

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
  }
  .btn.ghost { background: transparent; color: var(--ink-secondary); border-color: var(--line-strong); }
</style>
