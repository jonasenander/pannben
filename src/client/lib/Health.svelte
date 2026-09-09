<script lang="ts">
  type Health = {
    ok: boolean;
    version: string;
    schemaVersion: number;
    dbBytes: number;
    tables: number;
    walMode: string;
    zone: string;
    today: string;
    serverTime: string;
  };

  let state = $state<
    { status: "loading" } | { status: "ok"; data: Health } | { status: "error"; message: string }
  >({ status: "loading" });

  async function load() {
    state = { status: "loading" };
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error(`server returned ${res.status}`);
      state = { status: "ok", data: (await res.json()) as Health };
    } catch (err) {
      // Surfaced, never swallowed — a silent failure here reads as "working".
      state = { status: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  function bytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  $effect(() => {
    load();
  });
</script>

<section class="card" aria-live="polite">
  <div class="head">
    <span class="eyebrow">Health</span>
    {#if state.status === "ok"}
      <span class="pill good"><span class="dot"></span>Reachable</span>
    {:else if state.status === "error"}
      <span class="pill bad"><span class="dot"></span>Unreachable</span>
    {:else}
      <span class="pill"><span class="dot"></span>Checking</span>
    {/if}
  </div>

  {#if state.status === "ok"}
    {@const d = state.data}
    <dl>
      <div><dt>Schema</dt><dd class="mono">v{d.schemaVersion}</dd></div>
      <div><dt>Tables</dt><dd class="mono">{d.tables}</dd></div>
      <div><dt>Database</dt><dd class="mono">{bytes(d.dbBytes)}</dd></div>
      <div><dt>Journal</dt><dd class="mono">{d.walMode}</dd></div>
      <div><dt>App version</dt><dd class="mono">{d.version}</dd></div>
      <div><dt>Time zone</dt><dd class="mono">{d.zone}</dd></div>
      <div><dt>Session date</dt><dd class="mono">{d.today}</dd></div>
    </dl>
  {:else if state.status === "error"}
    <p class="err">{state.message}</p>
    <button class="btn ghost" onclick={load}>Try again</button>
  {:else}
    <p class="waiting">Contacting the API…</p>
  {/if}
</section>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-card);
    padding: var(--s4);
    box-shadow: var(--shadow-card);
  }
  .head { display: flex; align-items: center; gap: var(--s2); margin-bottom: var(--s3); }
  .eyebrow {
    flex: 1;
    font-family: var(--f-display);
    font-size: 12px;
    line-height: 15px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border-radius: var(--r-pill);
    border: 1px solid var(--line);
    font-family: var(--f-display);
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-secondary);
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--ink-muted); }
  .pill.good .dot { background: var(--good); }
  .pill.bad { border-color: var(--danger); color: var(--danger); }
  .pill.bad .dot { background: var(--danger); }

  dl { margin: 0; display: flex; flex-direction: column; }
  dl div {
    display: flex;
    align-items: baseline;
    gap: var(--s3);
    padding: 9px 0;
  }
  dl div + div { border-top: 1px solid var(--line); }
  dt { flex: 1; font-size: 15px; line-height: 21px; color: var(--ink-secondary); }
  dd {
    margin: 0;
    font-family: var(--f-data);
    font-size: 15px;
    line-height: 20px;
    font-variant-numeric: tabular-nums;
  }

  .waiting { margin: 0; font-size: 15px; color: var(--ink-muted); }
  .err { margin: 0 0 var(--s3); font-size: 15px; color: var(--danger); }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 48px;
    width: 100%;
    border-radius: var(--r-row);
    font-family: var(--f-display);
    font-size: 16px;
    font-weight: 700;
    background: var(--accent);
    color: var(--accent-ink);
    border: 1px solid var(--accent);
  }
  .btn.ghost {
    background: transparent;
    color: var(--ink-secondary);
    border-color: var(--line-strong);
  }
</style>
