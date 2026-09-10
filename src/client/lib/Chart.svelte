<script lang="ts">
  import { formatNumber } from "./api.js";
  import type { ChartPoint } from "./api.js";

  let {
    points, metricKey, unit, trend = null, size = "full", label = "",
    empty = "Nothing logged yet.",
  }: {
    points: ChartPoint[];
    metricKey: string;
    unit: string;
    trend?: { from: number; to: number } | null;
    /** `spark` is the dashboard's 48px glance; `full` carries axes and taps. */
    size?: "spark" | "full";
    label?: string;
    /**
     * What no data means here. A range filter that hides older sessions must
     * not claim the exercise was never done.
     */
    empty?: string;
  } = $props();

  /**
   * Hand-rolled SVG rather than a charting library.
   *
   * The whole design system is CSS custom properties with a dark mode that is
   * its own palette rather than an inversion. An SVG inherits those directly —
   * stroke="var(--accent)" simply works when the theme flips. A canvas library
   * has to read computed styles in JS and redraw, which is exactly the
   * mechanism that makes dark mode look like an automatic flip.
   */

  const W = 320;
  const H = $derived(size === "spark" ? 48 : 180);
  const PAD = $derived(
    size === "spark"
      ? { top: 6, right: 6, bottom: 6, left: 6 }
      : { top: 10, right: 12, bottom: 22, left: 40 },
  );

  interface Plotted { x: number; y: number; value: number; date: string; index: number }

  const plotted = $derived.by<Plotted[]>(() => {
    const usable = points
      .map((p, index) => ({
        index,
        date: p.date,
        // A body metric carries the full timestamp, so two readings on one day
        // are two points rather than one dot drawn twice.
        at: p.at ?? `${p.date}T12:00:00Z`,
        value: p.values[metricKey] ?? null,
      }))
      .filter((p): p is { index: number; date: string; at: string; value: number } =>
        p.value !== null);
    if (usable.length === 0) return [];

    const values = usable.map((p) => p.value);
    if (trend) values.push(trend.from, trend.to);

    // A flat series would collapse to a zero-height band and divide by zero.
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (hi === lo) { hi = lo + 1; lo = Math.max(0, lo - 1); }

    // A little headroom so the top point is not welded to the frame.
    const span = hi - lo;
    hi += span * 0.08;
    lo -= span * 0.08;

    const times = usable.map((p) => Date.parse(p.at));
    const first = times[0]!;
    const last = times.at(-1)!;
    const width = W - PAD.left - PAD.right;
    const height = H - PAD.top - PAD.bottom;

    return usable.map((p, i) => ({
      ...p,
      // Spaced by date, not by index — a fortnight off is real, and evenly
      // spacing the points would hide it.
      x: last === first
        ? PAD.left + width / 2
        : PAD.left + ((times[i]! - first) / (last - first)) * width,
      y: PAD.top + (1 - (p.value - lo) / (hi - lo)) * height,
    }));
  });

  const path = $derived(plotted.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));

  /** The y scale, re-derived so the axis ticks and the trend agree with the line. */
  const scale = $derived.by(() => {
    if (plotted.length === 0) return null;
    const first = plotted[0]!;
    const last = plotted.at(-1)!;
    // Two points on the plotted line give back the transform without keeping
    // lo/hi in a second place that could drift.
    if (last.value === first.value || last.y === first.y) {
      return { toY: () => first.y, toValue: () => first.value };
    }
    const k = (last.y - first.y) / (last.value - first.value);
    const m = first.y - k * first.value;
    return { toY: (v: number) => k * v + m, toValue: (y: number) => (y - m) / k };
  });

  /** Four clean ticks, rounded to something a person would say out loud. */
  const ticks = $derived.by(() => {
    if (size === "spark" || !scale || plotted.length === 0) return [];
    const values = plotted.map((p) => p.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    if (hi === lo) return [{ value: hi, y: scale.toY(hi) }];

    const step = niceStep((hi - lo) / 3);
    const out: { value: number; y: number }[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 0.01; v += step) {
      const y = scale.toY(v);
      if (y >= PAD.top - 1 && y <= H - PAD.bottom + 1) out.push({ value: round(v), y });
    }
    return out;
  });

  function niceStep(raw: number): number {
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const normalised = raw / magnitude;
    const snapped = normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1;
    return snapped * magnitude;
  }
  const round = (n: number) => Math.round(n * 100) / 100;

  const trendEnds = $derived.by(() => {
    if (!trend || !scale || plotted.length < 2) return null;
    return {
      x1: plotted[0]!.x, y1: scale.toY(trend.from),
      x2: plotted.at(-1)!.x, y2: scale.toY(trend.to),
    };
  });

  /** Tapped point, for the read-out under the chart. */
  let active = $state<number | null>(null);
  const shown = $derived(
    active !== null ? plotted.find((p) => p.index === active) ?? null : plotted.at(-1) ?? null,
  );

  const shortDate = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
</script>

{#if plotted.length === 0}
  <p class="none">{empty}</p>
{:else}
  <svg
    viewBox="0 0 {W} {H}" class={size} role="img"
    aria-label="{label || metricKey} over time, {plotted.length} sessions">
    {#if size === "full"}
      <!-- Hairline, solid, one step off the surface. Recessive by construction. -->
      {#each ticks as tick}
        <line x1={PAD.left} x2={W - PAD.right} y1={tick.y} y2={tick.y} class="grid" />
        <text x={PAD.left - 6} y={tick.y + 3.5} class="tick">{formatNumber(tick.value)}</text>
      {/each}
    {/if}

    {#if trendEnds}
      <!-- Dashed so it can never be mistaken for the data itself. -->
      <line x1={trendEnds.x1} y1={trendEnds.y1} x2={trendEnds.x2} y2={trendEnds.y2}
        class="trend" />
    {/if}

    {#if plotted.length > 1}
      <polyline points={path} class="line" />
    {/if}

    {#if size === "full"}
      {#each plotted as p}
        <!-- The ring is the surface colour, so a marker stays legible where it
             crosses the line, and it is part of the tap target. -->
        <circle cx={p.x} cy={p.y} r="4.5" class="dot" class:on={shown?.index === p.index} />
      {/each}
      <!-- Tap targets are much bigger than the marks they select. -->
      {#each plotted as p}
        <circle cx={p.x} cy={p.y} r="16" class="hit"
          role="button" tabindex="0"
          aria-label="{shortDate(p.date)}: {formatNumber(p.value)} {unit}"
          onclick={() => (active = p.index)}
          onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") active = p.index; }} />
      {/each}
      <!-- Two dates, not one per point: the ends say what range you are looking
           at, and the tapped read-out names any point you ask about. -->
      <text x={plotted[0]!.x} y={H - PAD.bottom + 15} class="xtick first">
        {shortDate(plotted[0]!.date)}</text>
      {#if plotted.length > 1}
        <text x={plotted.at(-1)!.x} y={H - PAD.bottom + 15} class="xtick last">
          {shortDate(plotted.at(-1)!.date)}</text>
      {/if}
    {:else}
      <!-- The sparkline labels nothing; its last point is the only mark. -->
      <circle cx={plotted.at(-1)!.x} cy={plotted.at(-1)!.y} r="3.5" class="dot" />
    {/if}
  </svg>

  {#if size === "full" && shown}
    <!-- One read-out rather than a number on every point. -->
    <p class="readout">
      <b>{formatNumber(shown.value)}</b><span class="u">{unit}</span>
      <span class="when">{shortDate(shown.date)}</span>
      {#if active === null}<span class="hint">— tap a point</span>{/if}
    </p>
  {/if}
{/if}

<style>
  svg { width: 100%; height: auto; display: block; overflow: visible; }
  svg.spark { max-height: 48px; }

  .line {
    fill: none; stroke: var(--accent); stroke-width: 2;
    stroke-linejoin: round; stroke-linecap: round;
  }
  .dot {
    fill: var(--accent); stroke: var(--surface); stroke-width: 2;
  }
  .dot.on { fill: var(--accent-strong); r: 6; }
  .hit { fill: transparent; cursor: pointer; }
  .hit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Not the data: muted, dashed, and behind everything else. */
  .trend { stroke: var(--ink-muted); stroke-width: 1.5; stroke-dasharray: 5 4; }

  .grid { stroke: var(--line); stroke-width: 1; }
  /* Axis text wears a text token, never the series colour. */
  .tick {
    fill: var(--ink-muted); font-family: var(--f-data); font-size: 10px;
    text-anchor: end; font-variant-numeric: tabular-nums;
  }
  .xtick { fill: var(--ink-muted); font-family: var(--f-data); font-size: 10px; }
  .xtick.first { text-anchor: start; }
  .xtick.last { text-anchor: end; }

  .readout { margin: var(--s2) 0 0; font-size: 13px; color: var(--ink-muted); }
  .readout b {
    font-family: var(--f-data); font-size: 20px; font-weight: 500; color: var(--ink);
  }
  .readout .u { font-family: var(--f-data); font-size: 12px; margin-left: 2px; }
  .readout .when { margin-left: var(--s2); }
  .readout .hint { color: var(--line-strong); }

  .none { font-size: 13px; color: var(--ink-muted); font-style: italic; margin: 0; }
</style>
