<script lang="ts">
  import Chart from "./Chart.svelte";
  import { uuidv7 } from "./uuid.js";
  import { flush } from "./outbox.js";
  import {
    saveReading, parseDecimal, formatNumber, sinceReading, type BodyMetric,
  } from "./api.js";

  let { metric, onopen, onlogged }: {
    metric: BodyMetric;
    onopen: (id: string) => void;
    onlogged: () => void;
  } = $props();

  /**
   * One line per metric: the number, when it was taken, the shape it has been
   * making, and a way to add to it. Weighing yourself is a monthly act for
   * some people, so this has to be present without ever asking for anything.
   */

  let logging = $state(false);
  let draft = $state("");
  let error = $state<string | null>(null);
  let saving = $state(false);

  function begin() {
    // Prefilled with the last reading: weight moves a kilo or two between
    // infrequent weigh-ins, so the edit is one or two digits.
    draft = metric.latest ? formatNumber(metric.latest.value) : "";
    error = null;
    logging = true;
  }

  async function save() {
    const value = parseDecimal(draft);
    if (value === null) {
      error = `${draft.trim() === "" ? "Enter" : "That is not"} a number`;
      return;
    }
    saving = true;
    try {
      await saveReading({ id: uuidv7(), type_id: metric.id, value });
      await flush();
      logging = false;
      draft = "";
      onlogged();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<div class="strip">
  <button class="top" onclick={() => onopen(metric.id)}>
    <span class="nm">{metric.name}</span>
    {#if metric.latest}
      <span class="v">{formatNumber(metric.latest.value)}<i>{metric.unit}</i></span>
      <span class="when">{sinceReading(metric.latest.measured_at)}</span>
    {:else}
      <span class="when none">nothing logged</span>
    {/if}
    <span class="chev">›</span>
  </button>

  {#if metric.points.length > 1}
    <Chart points={metric.points} metricKey="value" unit={metric.unit}
      size="spark" label={`${metric.name} over time`} />
  {/if}

  {#if logging}
    <div class="entry">
      <!-- Tap-to-type on a decimal keypad, same rule as weight on a set. -->
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text" inputmode="decimal" autofocus bind:value={draft}
        aria-label="{metric.name} in {metric.unit}"
        onkeydown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") logging = false; }} />
      <span class="u">{metric.unit}</span>
      <button class="cancel" onclick={() => (logging = false)}>Cancel</button>
      <button class="save" disabled={saving} onclick={save}>Save</button>
    </div>
    {#if error}<p class="err">{error}</p>{/if}
  {:else}
    <button class="log" onclick={begin}>Log {metric.name.toLowerCase()}</button>
  {/if}
</div>

<style>
  .strip {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r-card); padding: var(--s3) var(--s4) var(--s2);
    display: flex; flex-direction: column; gap: var(--s2);
  }
  .top {
    display: flex; align-items: baseline; gap: var(--s2);
    width: 100%; text-align: left; min-height: 32px;
  }
  .nm {
    font-family: var(--f-display); font-size: 16px; line-height: 22px; font-weight: 700;
    flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .v { font-family: var(--f-data); font-size: 17px; font-weight: 500; flex: none; }
  .v i { font-style: normal; font-size: 11px; color: var(--ink-muted); margin-left: 2px; }
  .when { font-size: 12px; color: var(--ink-muted); flex: none; }
  .when.none { flex: 1; }
  .chev { color: var(--line-strong); font-size: 16px; flex: none; }

  .log {
    min-height: 40px; border: 1px solid var(--line-strong); border-radius: var(--r-row);
    background: transparent; color: var(--ink-secondary);
    font-family: var(--f-display); font-size: 14px; font-weight: 600;
  }

  .entry { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
  .entry input {
    flex: 1; min-width: 4em; height: 48px; text-align: right;
    font-family: var(--f-data); font-size: 20px; font-weight: 500;
    border: 1px solid var(--accent); border-radius: var(--r-control);
    background: var(--accent-soft); color: var(--ink); padding: 0 var(--s2);
  }
  .entry .u { font-family: var(--f-data); font-size: 13px; color: var(--ink-muted); }
  .cancel, .save {
    min-height: 48px; padding: 0 var(--s3); border-radius: var(--r-control);
    font-family: var(--f-display); font-size: 15px; font-weight: 700;
  }
  .cancel { border: 1px solid var(--line-strong); color: var(--ink-secondary); font-weight: 600; }
  .save { background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent); }
  .save:disabled { opacity: .45; }
  .err { font-size: 13px; color: var(--danger); margin: 0; }
</style>
