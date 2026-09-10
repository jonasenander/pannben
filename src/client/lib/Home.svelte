<script lang="ts">
  import SyncBar from "./SyncBar.svelte";
  import Chart from "./Chart.svelte";
  import BodyStrip from "./BodyStrip.svelte";
  import { uuidv7 } from "./uuid.js";
  import {
    fetchActiveSession, fetchPrograms, startSession, formatDuration,
    fetchFavouriteCharts, fetchBodyMetrics, formatNumber,
    type SessionView, type ProgramSummary, type ExerciseChart, type BodyMetric,
  } from "./api.js";

  let { onopen, onchart, onbody, onnewbody }: {
    onopen: (what: "session") => void;
    onchart: (exerciseId: string) => void;
    onbody: (metricId: string) => void;
    onnewbody: () => void;
  } = $props();

  let active = $state<SessionView | null>(null);
  let programs = $state<ProgramSummary[]>([]);
  let charts = $state<ExerciseChart[]>([]);
  let body = $state<BodyMetric[]>([]);
  let error = $state<string | null>(null);
  let starting = $state(false);
  let picking = $state(false);

  export async function reload(): Promise<void> {
    try {
      active = await fetchActiveSession();
      programs = (await fetchPrograms("active")).data;
      charts = (await fetchFavouriteCharts("8w")).data;
      body = (await fetchBodyMetrics()).data;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  $effect(() => { void reload(); });

  /**
   * The session row is created here, on picking, because the structure has to
   * be snapshotted before the first set can attach to it. Abandoning it leaves
   * an empty session, which history hides — the alternative was deferring the
   * write until the first set and losing the pick time.
   */
  async function begin(programId: string | null) {
    starting = true;
    error = null;
    try {
      await startSession(uuidv7(), programId, new Date().toISOString());
      onopen("session");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      starting = false;
    }
  }
</script>

<SyncBar />

{#if error}<p class="err">{error}</p>{/if}

{#if active}
  <button class="resume" onclick={() => onopen("session")}>
    <span class="pulse"></span>
    <span class="grow">
      <b>{active.program_name ?? "Ad-hoc session"} — in progress</b>
      <span>{formatDuration(Math.floor((Date.now() - Date.parse(active.started_at)) / 1000))}
        · {active.blocks.reduce((n, b) => n + b.exercises.reduce((m, e) => m + e.sets.length, 0), 0)} sets logged</span>
    </span>
    <span class="chev">›</span>
  </button>
{:else if picking}
  <span class="eyebrow">Pick a program</span>
  <div class="sheet">
    {#each programs as p (p.id)}
      <button class="lrow" disabled={starting} onclick={() => begin(p.id)}>
        <span class="grow">
          <span class="nm">{p.name}</span>
          <span class="mt">{p.blocks} blocks · {p.planned_sets} sets planned</span>
        </span>
        <span class="chev">›</span>
      </button>
    {/each}
  </div>
  <button class="btn ghost" disabled={starting} onclick={() => begin(null)}>
    Ad-hoc session — no program
  </button>
  <button class="link" onclick={() => (picking = false)}>Cancel</button>
{:else}
  <button class="btn" disabled={programs.length === 0} onclick={() => (picking = true)}>
    Start a session
  </button>
  {#if programs.length === 0}
    <p class="hint">Build a program first — Programs tab, then come back here.</p>
  {/if}
{/if}

{#if charts.length > 0}
  <span class="eyebrow pin">Pinned</span>
  {#each charts as chart (chart.exercise_id)}
    {@const metric = chart.metrics[0]}
    {@const summary = metric ? chart.summary[metric.key] : null}
    <button class="pinned" onclick={() => onchart(chart.exercise_id)}>
      <span class="ptop">
        <span class="pnm">{chart.exercise_name}</span>
        <span class="pv">
          {summary?.latest === null || summary?.latest === undefined
            ? "—" : formatNumber(summary.latest)}<i>{metric?.unit ?? ""}</i>
        </span>
      </span>
      {#if metric}
        <span class="plabel">{metric.label} · last 8 weeks</span>
        <Chart points={chart.points} metricKey={metric.key} unit={metric.unit}
          size="spark" label={`${chart.exercise_name} ${metric.label}`} />
      {/if}
    </button>
  {/each}
{:else if !picking}
  <p class="hint">
    No charts pinned. Open an exercise from the Exercises tab, tap
    <b>Chart</b>, then <b>Pin to home</b> to watch it here.
  </p>
{/if}

{#if body.length > 0}
  <span class="eyebrow pin">Body</span>
  {#each body as metric (metric.id)}
    <BodyStrip {metric} onopen={onbody} onlogged={reload} />
  {/each}
{:else if !picking}
  <!-- One quiet affordance, not a prompt. It sits where the strips will be, so
       it is findable without ever asking for anything — which is the whole
       brief for a thing you use once a month. -->
  <button class="add-body" onclick={onnewbody}>+ Track a body metric</button>
{/if}

<style>
  .resume { background: var(--accent); color: var(--accent-ink); border-radius: var(--r-card);
            padding: 10px var(--s4); display: flex; align-items: center;
            gap: var(--s3); min-height: 56px; width: 100%; text-align: left; }
  .pulse { width: 9px; height: 9px; border-radius: 50%; background: currentColor;
           flex: none; animation: bp 2.1s ease-in-out infinite; }
  @keyframes bp { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
  .resume .grow { flex: 1; min-width: 0; }
  .resume b { font-family: var(--f-display); font-size: 17px; line-height: 22px;
              font-weight: 700; display: block; }
  .resume span:last-of-type { font-family: var(--f-data); font-size: 13px; opacity: .9; }
  .chev { font-size: 18px; flex: none; }

  .sheet { background: var(--surface); border: 1px solid var(--line);
           border-radius: var(--r-card); overflow: hidden; }
  .lrow { display: flex; align-items: center; gap: var(--s3); padding: 10px var(--s4);
          width: 100%; text-align: left; min-height: 52px; }
  .lrow + .lrow { border-top: 1px solid var(--line); }
  .lrow .grow { flex: 1; min-width: 0; }
  .lrow .chev { color: var(--line-strong); }
  .nm { font-weight: 600; font-size: 16px; line-height: 23px; display: block; }
  .mt { font-size: 13px; line-height: 18px; color: var(--ink-muted); display: block; }

  .pin { margin-top: var(--s3); }
  .add-body {
    min-height: 44px; margin-top: var(--s2); align-self: flex-start;
    color: var(--ink-muted); font-family: var(--f-display);
    font-size: 14px; font-weight: 600;
  }
  /* A chart is a semantic unit, so it earns a card — the rows inside a list
     are not, which is why history is one surface and this is not. */
  .pinned {
    display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r-card); padding: var(--s3) var(--s4) var(--s2);
  }
  .ptop { display: flex; align-items: baseline; gap: var(--s2); }
  .pnm {
    font-family: var(--f-display); font-size: 16px; line-height: 22px; font-weight: 700;
    flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pv {
    font-family: var(--f-data); font-size: 17px; font-weight: 500;
    color: var(--ink); flex: none;
  }
  .pv i { font-style: normal; font-size: 11px; color: var(--ink-muted); margin-left: 2px; }
  .plabel { font-size: 12px; line-height: 16px; color: var(--ink-muted); }

  .eyebrow { font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
             letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted); }
  .hint { font-size: 13px; line-height: 18px; color: var(--ink-muted); margin: 0; }
  .err { font-size: 15px; color: var(--danger); margin: 0; }
  .link { font-family: var(--f-display); font-size: 15px; font-weight: 600;
          color: var(--accent); min-height: 44px; }
  .btn { display: flex; align-items: center; justify-content: center;
         height: 52px; width: 100%; border-radius: var(--r-row);
         font-family: var(--f-display); font-size: 16px; font-weight: 700;
         background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent); }
  .btn:disabled { opacity: .45; }
  .btn.ghost { background: transparent; color: var(--ink-secondary); border-color: var(--line-strong); }
</style>
