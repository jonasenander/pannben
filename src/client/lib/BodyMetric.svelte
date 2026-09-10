<script lang="ts">
  import Chart from "./Chart.svelte";
  import SyncBar from "./SyncBar.svelte";
  import { uuidv7 } from "./uuid.js";
  import { flush } from "./outbox.js";
  import {
    fetchBodySeries, fetchBodyReadings, saveReading, removeReading,
    parseDecimal, formatNumber, formatDate, RANGE_LABELS,
    type BodySeries, type BodyReading, type Range,
  } from "./api.js";

  let { id, onedit }: { id: string; onedit: (id: string) => void } = $props();

  let series = $state<BodySeries | null>(null);
  let readings = $state<BodyReading[]>([]);
  let range = $state<Range>("6m");
  let error = $state<string | null>(null);

  /** One reading open for correction, or the new one being added. */
  let editingId = $state<string | null>(null);
  let draft = $state("");
  let draftDate = $state("");
  let adding = $state(false);
  let confirmDelete = $state<string | null>(null);

  async function load() {
    try {
      series = await fetchBodySeries(id, range);
      readings = await fetchBodyReadings(id);
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  $effect(() => { void range; void load(); });

  const today = () => new Date().toISOString().slice(0, 10);

  /**
   * The change the trend line is drawing, rounded the way the exercise charts
   * round it: two decimals on a change of four kilos is arithmetic, not
   * information.
   */
  const changeText = $derived.by(() => {
    if (!series || series.change === null) return null;
    const rounded = Math.abs(series.change) >= 10
      ? Math.round(series.change)
      : Math.round(series.change * 10) / 10;
    return `${rounded > 0 ? "+" : ""}${formatNumber(rounded)}`;
  });

  function beginAdd() {
    adding = true;
    editingId = null;
    // Prefilled from the last reading: it moves a kilo or two between
    // infrequent weigh-ins, so the edit is one or two digits.
    draft = series?.latest !== null && series?.latest !== undefined
      ? formatNumber(series.latest) : "";
    draftDate = today();
  }

  function beginEdit(r: BodyReading) {
    adding = false;
    editingId = r.id;
    draft = formatNumber(r.value);
    draftDate = r.measured_at.slice(0, 10);
  }

  async function commit() {
    const value = parseDecimal(draft);
    if (value === null || !series) { error = "That is not a number"; return; }

    // Keep the time of day when correcting an existing reading; a new one
    // taken for an earlier date gets a midday stamp rather than midnight.
    const existing = readings.find((r) => r.id === editingId);
    const time = existing && existing.measured_at.slice(0, 10) === draftDate
      ? existing.measured_at.slice(10)
      : draftDate === today()
        ? new Date().toISOString().slice(10)
        : "T12:00:00.000Z";

    await saveReading({
      id: editingId ?? uuidv7(),
      type_id: id,
      value,
      measured_at: `${draftDate}${time}`,
      note: existing?.note ?? "",
    });
    await flush();
    editingId = null;
    adding = false;
    await load();
  }

  async function drop(readingId: string) {
    confirmDelete = null;
    await removeReading(readingId);
    await flush();
    await load();
  }
</script>

<SyncBar />

{#if error && !series}
  <p class="err">{error}</p>
  <button class="btn ghost" onclick={load}>Try again</button>
{:else if !series}
  <p class="hint">Loading…</p>
{:else}
  <div class="head">
    <span class="nm">{series.name}</span>
    <button class="link" onclick={() => onedit(id)}>Edit</button>
  </div>

  <div class="card">
    <span class="eyebrow">{series.name} · {series.unit}</span>
    <Chart points={series.points} metricKey="value" unit={series.unit}
      trend={series.trend_ends}
      label={`${series.name} over time`}
      empty={range === "all"
        ? "Nothing logged yet."
        : `Nothing in the last ${RANGE_LABELS[range].toLowerCase()}.`} />
  </div>

  <div class="tiles">
    <div class="tile">
      <span class="tl">Latest</span>
      <span class="tv">{#if series.latest === null}—{:else}{
        formatNumber(series.latest)}<i>{series.unit}</i>{/if}</span>
    </div>
    <div class="tile">
      <span class="tl">Readings</span>
      <span class="tv">{series.points.length}</span>
    </div>
    <div class="tile">
      <span class="tl">Change</span>
      <!-- Direction only. Neither way is an error state; this is a logbook. -->
      <span class="tv">{#if changeText === null}—{:else}{changeText}<i>{series.unit}</i>{/if}</span>
    </div>
  </div>

  <div class="chips" role="tablist" aria-label="Range">
    {#each Object.entries(RANGE_LABELS) as [value, text]}
      <button class="chip" class:on={range === value} role="tab"
        aria-selected={range === value}
        onclick={() => (range = value as Range)}>{text}</button>
    {/each}
  </div>

  {#if adding}
    <div class="entry card">
      <span class="eyebrow">New reading</span>
      <div class="row">
        <!-- svelte-ignore a11y_autofocus -->
        <input class="val" type="text" inputmode="decimal" autofocus bind:value={draft}
          aria-label="{series.name} in {series.unit}" />
        <span class="u">{series.unit}</span>
        <input class="date" type="date" bind:value={draftDate} aria-label="Date measured" />
      </div>
      <div class="pair">
        <button class="btn ghost" onclick={() => (adding = false)}>Cancel</button>
        <button class="btn" onclick={commit}>Save</button>
      </div>
    </div>
  {:else}
    <button class="btn" onclick={beginAdd}>Log a reading</button>
  {/if}

  {#if error}<p class="err">{error}</p>{/if}

  <span class="eyebrow">All readings</span>
  {#if readings.length === 0}
    <p class="hint">Nothing logged yet.</p>
  {:else}
    <div class="sheet">
      {#each readings as r (r.id)}
        <div class="lrow">
          {#if editingId === r.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input class="val" type="text" inputmode="decimal" autofocus bind:value={draft}
              aria-label="Correct {series.name}" />
            <span class="u">{series.unit}</span>
            <input class="date" type="date" bind:value={draftDate} aria-label="Date measured" />
            <button class="mini" onclick={() => (editingId = null)}>Cancel</button>
            <button class="mini go" onclick={commit}>Save</button>
          {:else if confirmDelete === r.id}
            <span class="grow warn">Delete this reading?</span>
            <button class="mini" onclick={() => (confirmDelete = null)}>Keep</button>
            <button class="mini danger" onclick={() => drop(r.id)}>Delete</button>
          {:else}
            <button class="grow tap" onclick={() => beginEdit(r)}>
              <span class="v">{formatNumber(r.value)}<i>{series.unit}</i></span>
              <span class="when">{formatDate(r.measured_at.slice(0, 10))}</span>
              {#if r.note}<span class="note">{r.note}</span>{/if}
            </button>
            <button class="drop" aria-label="Delete reading"
              onclick={() => (confirmDelete = r.id)}>×</button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .head { display: flex; align-items: baseline; gap: var(--s3); }
  .nm { font-family: var(--f-display); font-size: 20px; line-height: 26px;
        font-weight: 700; flex: 1; min-width: 0; }
  .link { font-family: var(--f-display); font-size: 15px; font-weight: 600;
          color: var(--accent); min-height: 44px; flex: none; }

  .card { background: var(--surface); border: 1px solid var(--line);
          border-radius: var(--r-card); padding: var(--s3) var(--s4) var(--s4); }
  .eyebrow { font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
             letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted);
             display: block; margin-bottom: var(--s2); }

  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s2); }
  .tile { background: var(--surface); border: 1px solid var(--line);
          border-radius: var(--r-row); padding: var(--s2) var(--s3);
          display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .tl { font-size: 12px; line-height: 16px; color: var(--ink-muted); }
  .tv { font-family: var(--f-data); font-size: 17px; line-height: 22px; font-weight: 500; }
  .tv i, .v i { font-style: normal; font-size: 11px; color: var(--ink-muted); margin-left: 2px; }

  .chips { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .chip { font-family: var(--f-display); font-size: 13px; font-weight: 600;
          min-height: 36px; padding: 0 var(--s3); border-radius: var(--r-pill);
          border: 1px solid var(--line-strong); color: var(--ink-secondary); background: transparent; }
  .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }

  .entry .row { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
  .val { flex: 1; min-width: 4em; height: 48px; text-align: right;
         font-family: var(--f-data); font-size: 20px; font-weight: 500;
         border: 1px solid var(--accent); border-radius: var(--r-control);
         background: var(--accent-soft); color: var(--ink); padding: 0 var(--s2); }
  .u { font-family: var(--f-data); font-size: 13px; color: var(--ink-muted); }
  .date { height: 48px; font-family: var(--f-data); font-size: 14px;
          border: 1px solid var(--line-strong); border-radius: var(--r-control);
          background: var(--surface); color: var(--ink); padding: 0 var(--s2); }
  .pair { display: flex; gap: var(--s2); margin-top: var(--s3); }
  .pair .btn { flex: 1; }

  .sheet { background: var(--surface); border: 1px solid var(--line);
           border-radius: var(--r-card); overflow: hidden; }
  .lrow { display: flex; align-items: center; gap: var(--s2);
          padding: var(--s2) var(--s4); min-height: 52px; flex-wrap: wrap; }
  .lrow + .lrow { border-top: 1px solid var(--line); }
  .grow { flex: 1; min-width: 0; }
  .tap { display: flex; align-items: baseline; gap: var(--s2); text-align: left; }
  .v { font-family: var(--f-data); font-size: 16px; font-weight: 500; flex: none; }
  .when { font-size: 13px; color: var(--ink-muted); }
  .note { font-size: 13px; color: var(--ink-muted); font-style: italic;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .warn { font-size: 14px; color: var(--ink-secondary); }
  .drop { color: var(--danger); font-size: 20px; line-height: 1; width: 36px; min-height: 36px; }
  .mini { font-family: var(--f-display); font-size: 13px; font-weight: 600;
          min-height: 36px; padding: 0 var(--s2); border-radius: var(--r-control);
          border: 1px solid var(--line-strong); color: var(--ink-secondary); }
  .mini.danger { border-color: var(--danger); color: var(--danger); }
  .mini.go { border-color: var(--accent); color: var(--accent); }

  .hint { font-size: 13px; line-height: 18px; color: var(--ink-muted); margin: 0; }
  .err { font-size: 15px; color: var(--danger); margin: 0; }
  .btn { display: flex; align-items: center; justify-content: center;
         height: 52px; width: 100%; border-radius: var(--r-row);
         font-family: var(--f-display); font-size: 16px; font-weight: 700;
         background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent); }
  .btn.ghost { background: transparent; color: var(--ink-secondary); border-color: var(--line-strong); }
</style>
