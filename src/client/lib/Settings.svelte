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

  // ---------------------------------------------------------------- import

  type ExportFile = {
    format?: string;
    schema_version?: number;
    exported_at?: string;
    app_version?: string;
    tables?: Record<string, unknown[]>;
  };

  type ImportResult = {
    rows: Record<string, number>;
    tables_skipped: string[];
    columns_skipped: string[];
    schema_version: number;
    exported_at: string;
  };

  /** The word that has to be typed. Uppercase, and not a word typed by accident. */
  const CONFIRM_WORD = "REPLACE";

  let staged = $state<{ file: ExportFile; name: string } | null>(null);
  let typed = $state("");
  let importing = $state(false);
  let importError = $state<string | null>(null);
  let imported = $state<ImportResult | null>(null);

  /**
   * Rows the import will actually write.
   *
   * `schema_migrations` is in the file but never imported — the migration
   * history belongs to the running app, not to the data — so counting it here
   * would make the staged number disagree with the result afterwards.
   */
  const stagedRows = $derived(
    staged
      ? Object.entries(staged.file.tables ?? {})
          .filter(([table]) => table !== "schema_migrations")
          .reduce((n, [, rows]) => n + rows.length, 0)
      : 0,
  );

  async function stage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0];
    input.value = ""; // so picking the same file twice still fires
    if (!chosen) return;

    importError = null;
    imported = null;
    typed = "";
    try {
      const file = JSON.parse(await chosen.text()) as ExportFile;
      if (file.format !== "pannben-export") {
        throw new Error("that file is not a Pannben export");
      }
      staged = { file, name: chosen.name };
    } catch (err) {
      staged = null;
      importError = err instanceof Error ? err.message : String(err);
    }
  }

  async function applyImport() {
    if (!staged || typed.trim().toUpperCase() !== CONFIRM_WORD) return;
    importing = true;
    importError = null;
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(staged.file),
      });
      const payload = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `server returned ${res.status}`);

      imported = payload;
      staged = null;
      typed = "";
      // Everything on screen is now describing a database that no longer exists.
      const [h, s2] = await Promise.all([
        fetch("/api/health").then((r) => r.json()),
        fetch("/api/export/summary").then((r) => r.json()),
      ]);
      health = h as Health;
      summary = s2 as Record<string, number>;
    } catch (err) {
      importError = err instanceof Error ? err.message : String(err);
    } finally {
      importing = false;
    }
  }

  const bytes = (n: number) =>
    n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
</script>

<a class="btn" href="/api/export" download>Export everything as JSON</a>
<p class="hint">
  Every table, including archived and deleted rows — it is a backup, not a view.
</p>

<span class="eyebrow">Restore from a backup</span>

{#if imported}
  <div class="card ok">
    <p><strong>Restored.</strong>
      {Object.values(imported.rows).reduce((n, r) => n + r, 0)} rows from a backup
      taken {new Date(imported.exported_at).toLocaleString()}.</p>
    {#if imported.tables_skipped.length > 0}
      <p class="hint">Skipped tables this version no longer has:
        {imported.tables_skipped.join(", ")}</p>
    {/if}
    {#if imported.columns_skipped.length > 0}
      <p class="hint">Ignored columns: {imported.columns_skipped.join(", ")}</p>
    {/if}
  </div>
{/if}

{#if importError && !staged}<p class="err">{importError}</p>{/if}

{#if staged}
  <div class="card warn">
    <p><strong>{staged.name}</strong></p>
    {#if importError}
      <!-- The refusal belongs with the file it refused, next to Cancel. -->
      <p class="err">{importError}</p>
    {/if}
    <p class="hint">
      Schema v{staged.file.schema_version} ·
      {staged.file.exported_at
        ? new Date(staged.file.exported_at).toLocaleString()
        : "no date"} ·
      {stagedRows} rows
    </p>
    <p>
      This <strong>replaces everything</strong> currently in the database —
      exercises, programs and every session logged since this backup was taken.
      It cannot be undone from inside the app.
    </p>
    <label class="confirm">
      <span class="eyebrow">Type {CONFIRM_WORD} to continue</span>
      <input type="text" bind:value={typed} autocapitalize="characters"
        autocomplete="off" spellcheck="false" aria-label="Type {CONFIRM_WORD} to confirm" />
    </label>
    <div class="pair">
      <button class="btn ghost" onclick={() => { staged = null; typed = ""; }}>Cancel</button>
      <button class="btn danger" disabled={typed.trim().toUpperCase() !== CONFIRM_WORD || importing}
        onclick={applyImport}>{importing ? "Restoring…" : "Replace everything"}</button>
    </div>
  </div>
{:else}
  <label class="btn ghost file">
    Choose a backup file
    <input type="file" accept="application/json,.json" onchange={stage} />
  </label>
  <p class="hint">
    Replace-all only, in one transaction: either the whole backup lands or
    nothing changes. A backup from a newer version of Pannben is refused.
  </p>
{/if}

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
  .btn.ghost { background: transparent; color: var(--ink-secondary); border-color: var(--line-strong); }
  .btn.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
  /* A faded red button still reads as armed. A disabled destructive action
     should look inert, not merely dim. */
  .btn:disabled { opacity: .45; }
  .btn.danger:disabled {
    opacity: 1; background: transparent; color: var(--ink-muted);
    border-color: var(--line-strong);
  }
  /* A label wrapping a hidden input: a file picker that looks like the buttons. */
  .file { cursor: pointer; }
  .file input { position: absolute; width: 1px; height: 1px; opacity: 0; }

  .card.warn { border-color: var(--danger); }
  .card.ok { border-color: var(--good); }
  .card p + p { margin-top: var(--s2); }
  .confirm { display: flex; flex-direction: column; gap: 4px; margin-top: var(--s3); }
  .confirm input {
    height: 48px; border: 1px solid var(--line-strong); border-radius: var(--r-control);
    background: var(--surface-inset); color: var(--ink); padding: 0 var(--s3);
    font-family: var(--f-data); font-size: 17px; letter-spacing: .1em;
  }
  .pair { display: flex; gap: var(--s2); margin-top: var(--s3); }
  .pair .btn { flex: 1; font-size: 15px; }
</style>
