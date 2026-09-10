<script lang="ts">
  import Chart from "./Chart.svelte";
  import SyncBar from "./SyncBar.svelte";
  import {
    fetchExerciseChart, fetchFavourites, saveFavourites, formatNumber,
    RANGE_LABELS, type ExerciseChart, type Range, type Favourite,
  } from "./api.js";

  let { id, onchanged }: { id: string; onchanged?: () => void } = $props();

  let chart = $state<ExerciseChart | null>(null);
  let range = $state<Range>("8w");
  let metricKey = $state<string | null>(null);
  let error = $state<string | null>(null);
  let pinned = $state<Favourite[]>([]);
  let busy = $state(false);

  async function load() {
    try {
      chart = await fetchExerciseChart(id, range);
      // Default to the first metric — per type, that is the one that answers
      // "am I getting stronger at this".
      if (!metricKey || !chart.metrics.some((m) => m.key === metricKey)) {
        metricKey = chart.metrics[0]?.key ?? null;
      }
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  $effect(() => { void range; void load(); });
  $effect(() => {
    void (async () => { pinned = await fetchFavourites().catch(() => []); })();
  });

  const isPinned = $derived(pinned.some((f) => f.kind === "exercise" && f.ref_id === id));
  const metric = $derived(chart?.metrics.find((m) => m.key === metricKey) ?? null);
  const summary = $derived(metricKey && chart ? chart.summary[metricKey] ?? null : null);

  async function togglePin() {
    busy = true;
    try {
      const next = isPinned
        ? pinned.filter((f) => !(f.kind === "exercise" && f.ref_id === id))
        : [...pinned, { kind: "exercise" as const, ref_id: id }];
      pinned = await saveFavourites(next.map((f) => ({ kind: f.kind, ref_id: f.ref_id })));
      onchanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  /**
   * The number the trend line is drawing, across the visible range.
   *
   * The unit goes in its own element rather than into this string: at three
   * equal tiles, "+225.4 kg" as one mono value overflows and ellipses, which
   * loses the digits rather than the decoration. A decimal on a change of 225
   * is noise anyway.
   */
  const changeText = $derived.by(() => {
    if (!summary || summary.change === null) return null;
    const magnitude = Math.abs(summary.change);
    const rounded = magnitude >= 10
      ? Math.round(summary.change)
      : Math.round(summary.change * 10) / 10;
    return `${rounded > 0 ? "+" : ""}${formatNumber(rounded)}`;
  });
</script>

<SyncBar />

{#if error}
  <p class="err">{error}</p>
  <button class="btn ghost" onclick={load}>Try again</button>
{:else if !chart}
  <p class="hint">Loading…</p>
{:else}
  <div class="head">
    <span class="nm">{chart.exercise_name}</span>
    <button class="link" disabled={busy} aria-pressed={isPinned} onclick={togglePin}>
      {isPinned ? "Unpin" : "Pin to home"}
    </button>
  </div>

  <!-- A toggle, not two y-scales: volume and 1RM have unrelated units, and a
       dual axis invents a correlation that is not in the data. -->
  <div class="chips" role="tablist" aria-label="Metric">
    {#each chart.metrics as m (m.key)}
      <button class="chip" class:on={metricKey === m.key} role="tab"
        aria-selected={metricKey === m.key}
        onclick={() => (metricKey = m.key)}>{m.label}</button>
    {/each}
  </div>

  {#if metric && metricKey}
    <div class="card">
      <span class="eyebrow">{metric.label} · {metric.unit}</span>
      <Chart
        points={chart.points} metricKey={metricKey} unit={metric.unit}
        trend={chart.trend_ends[metricKey] ?? null}
        label={`${chart.exercise_name} ${metric.label}`}
        empty={range === "all"
          ? "Nothing logged yet."
          : `Nothing in the last ${RANGE_LABELS[range].toLowerCase()}.`} />
    </div>

    <div class="tiles">
      <!-- A dash has no unit: "— m" reads as a measurement that came back empty
           rather than as nothing having been measured. -->
      <div class="tile">
        <span class="tl">Latest</span>
        <span class="tv">{#if summary?.latest === null || summary?.latest === undefined}—{:else}{
          formatNumber(summary.latest)}<i>{metric.unit}</i>{/if}</span>
      </div>
      <div class="tile">
        <span class="tl">Best</span>
        <span class="tv">{#if summary?.best === null || summary?.best === undefined}—{:else}{
          formatNumber(summary.best)}<i>{metric.unit}</i>{/if}</span>
      </div>
      <div class="tile">
        <span class="tl">Trend</span>
        <span class="tv" class:up={(summary?.change ?? 0) > 0}
          class:down={(summary?.change ?? 0) < 0}>{changeText ?? "—"}{#if changeText}<i
            >{metric.unit}</i>{/if}</span>
      </div>
    </div>
  {/if}

  <div class="chips" role="tablist" aria-label="Range">
    {#each Object.entries(RANGE_LABELS) as [value, text]}
      <button class="chip" class:on={range === value} role="tab"
        aria-selected={range === value}
        onclick={() => (range = value as Range)}>{text}</button>
    {/each}
  </div>

  <p class="hint">
    {chart.points.length} session{chart.points.length === 1 ? "" : "s"} in range.
    {#if metricKey === "e1rm"}
      Estimated 1RM uses Epley and is left out of any session whose best set was
      above 12 reps, where the formula stops meaning anything.
    {/if}
  </p>
{/if}

<style>
  .head { display: flex; align-items: baseline; gap: var(--s3); }
  .nm {
    font-family: var(--f-display); font-size: 20px; line-height: 26px;
    font-weight: 700; flex: 1; min-width: 0;
  }
  .link {
    font-family: var(--f-display); font-size: 15px; font-weight: 600;
    color: var(--accent); min-height: 44px; flex: none;
  }
  .link[aria-pressed="true"] { color: var(--ink-muted); }

  .chips { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .chip {
    font-family: var(--f-display); font-size: 13px; font-weight: 600;
    min-height: 36px; padding: 0 var(--s3); border-radius: var(--r-pill);
    border: 1px solid var(--line-strong); color: var(--ink-secondary);
    background: transparent;
  }
  .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }

  /* One layer of chrome, so the plotted data outweighs its own frame. */
  .card {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r-card); padding: var(--s3) var(--s4) var(--s4);
  }
  .eyebrow {
    font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted);
    display: block; margin-bottom: var(--s2);
  }

  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s2); }
  .tile {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r-row); padding: var(--s2) var(--s3);
    display: flex; flex-direction: column; gap: 2px; min-width: 0;
  }
  .tl { font-size: 12px; line-height: 16px; color: var(--ink-muted); }
  .tv {
    font-family: var(--f-data); font-size: 17px; line-height: 22px; font-weight: 500;
    color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .tv i { font-style: normal; font-size: 11px; color: var(--ink-muted); margin-left: 2px; }
  /* Direction, not judgement — a lighter squat week is not an error state. */
  .tv.up { color: var(--good); }
  .tv.down { color: var(--ink-secondary); }

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
