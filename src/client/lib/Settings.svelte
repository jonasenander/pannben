<script lang="ts">
  type Health = {
    version: string; schemaVersion: number; dbBytes: number;
    tables: number; walMode: string; zone: string; today: string;
  };

  let health = $state<Health | null>(null);
  let summary = $state<Record<string, number> | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    Promise.all([
      fetch("/api/health").then((r) => r.json()),
      fetch("/api/export/summary").then((r) => r.json()),
    ])
      .then(([h, s]) => { health = h as Health; summary = s as Record<string, number>; })
      .catch((e: Error) => (error = e.message));
  });

  const bytes = (n: number) =>
    n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
</script>

<a class="btn" href="/api/export" download>Export everything as JSON</a>
<p class="hint">
  Every table, including archived and deleted rows — it is a backup, not a view.
  Import lands in a later phase; until then the nightly snapshot on the NAS is the
  restore path.
</p>

{#if error}
  <p class="err">{error}</p>
{:else if health}
  <div class="sheet">
    <div class="row"><span>Schema</span><span class="mono">v{health.schemaVersion}</span></div>
    <div class="row"><span>Database</span><span class="mono">{bytes(health.dbBytes)}</span></div>
    <div class="row"><span>Journal</span><span class="mono">{health.walMode}</span></div>
    <div class="row"><span>App version</span><span class="mono">{health.version}</span></div>
    <div class="row"><span>Time zone</span><span class="mono">{health.zone}</span></div>
    <div class="row"><span>Session date</span><span class="mono">{health.today}</span></div>
  </div>

  {#if summary}
    <span class="eyebrow">Rows</span>
    <div class="sheet">
      {#each Object.entries(summary) as [table, n]}
        <div class="row"><span>{table}</span><span class="mono">{n}</span></div>
      {/each}
    </div>
  {/if}
{:else}
  <p class="hint">Loading…</p>
{/if}

<div class="card">
  <span class="eyebrow">About</span>
  <p><strong>Pannben</strong> — Swedish for the frontal bone.
     <em>Att ha pannben</em>: to have the grit to keep going.</p>
</div>

<style>
  .sheet {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r-card); overflow: hidden;
  }
  .row {
    display: flex; align-items: baseline; gap: var(--s3);
    padding: 10px var(--s4); min-height: 44px;
  }
  .row + .row { border-top: 1px solid var(--line); }
  .row span:first-child { flex: 1; font-size: 15px; color: var(--ink-secondary); }
  .mono {
    font-family: var(--f-data); font-size: 15px;
    font-variant-numeric: tabular-nums;
  }
  .eyebrow {
    font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted);
  }
  .card {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r-card); padding: var(--s3) var(--s4);
  }
  .card p { margin: 4px 0 0; font-size: 15px; line-height: 21px; color: var(--ink-secondary); }
  .hint { font-size: 13px; line-height: 18px; color: var(--ink-muted); margin: 0; }
  .err { font-size: 15px; color: var(--danger); margin: 0; }
  .btn {
    display: flex; align-items: center; justify-content: center;
    height: 52px; width: 100%; border-radius: var(--r-row); text-decoration: none;
    font-family: var(--f-display); font-size: 16px; font-weight: 700;
    background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent);
  }
</style>
