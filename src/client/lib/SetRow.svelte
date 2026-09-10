<script lang="ts">
  import {
    METRIC_SET_FIELDS, shownFields, SET_SEPARATOR, parseField, formatField, canLog,
    type LoggedSet, type MetricType, type FieldSpec,
  } from "./api.js";

  let {
    metricType, setIndex, roundIndex = 0, logged, prefill, onlog, onskip,
  }: {
    metricType: MetricType;
    setIndex: number;
    roundIndex?: number;
    logged: LoggedSet | undefined;
    prefill: Partial<LoggedSet> | null;
    onlog: (values: Partial<LoggedSet>) => void;
    onskip: () => void;
  } = $props();

  const fields = METRIC_SET_FIELDS[metricType];

  // Prefilled from the same set index of the previous session, to_failure
  // included — so an exercise you always take to failure arrives already marked.
  let values = $state<Record<string, number | null>>(
    Object.fromEntries(fields.map((f) => [f.key, prefill?.[f.key] ?? null])),
  );
  let toFailure = $state(prefill?.to_failure ?? false);
  let editing = $state<string | null>(null);
  let editText = $state("");

  const nudge = (f: FieldSpec, delta: number) =>
    (values = { ...values, [f.key]: Math.max(0, (values[f.key] ?? 0) + delta * (f.step ?? 1)) });

  function beginEdit(f: FieldSpec) {
    editing = f.key;
    editText = formatField(values[f.key], f);
  }

  function commitEdit(f: FieldSpec) {
    const parsed = parseField(editText, f);
    // An emptied optional field means "I did not measure this", not "keep the
    // old value" — that is the whole point of it being optional.
    if (parsed !== null) values = { ...values, [f.key]: parsed };
    else if (f.optional && editText.trim() === "") values = { ...values, [f.key]: null };
    editing = null;
  }

  const ready = $derived(canLog(metricType, values));

  function log() {
    if (!ready) return;
    onlog({ ...values, to_failure: toFailure, set_index: setIndex, round_index: roundIndex });
  }
</script>

{#if logged}
  <!-- A record, not a workstation: compact, and the same green check whatever
       else is true of it, so "did I log this?" stays answerable down the column. -->
  <div class="row done" class:skip={logged.skipped} data-set-index={setIndex}>
    <span class="no">{setIndex + 1}</span>
    {#if logged.skipped}
      <span class="v muted">not done</span>
    {:else}
      {#each shownFields(metricType, logged) as f, i}
        {#if i > 0}<span class="x">{SET_SEPARATOR[metricType]}</span>{/if}
        <!-- "20:00" says it is a time; "20:00 time" says it twice. The
             label stays on the entry boxes, where it names which box is which. -->
        <span class="v">{formatField(logged[f.key], f)}{#if f.kind !== "duration"}<i
          >{f.label}</i>{/if}</span>
      {/each}
    {/if}
    <span class="end">
      {#if logged.to_failure}<span class="tag">To failure</span>{/if}
      {#if logged.skipped}
        <span class="none" aria-label="skipped">—</span>
      {:else}
        <span class="fin" aria-label="logged">✓</span>
      {/if}
    </span>
  </div>
{:else}
  <div class="row entry" data-set-index={setIndex} data-round={roundIndex}>
    <div class="line">
      <span class="no">{setIndex + 1}</span>
      {#each fields as f}
        {#if f.kind === "stepper"}
          <div class="step">
            <button onclick={() => nudge(f, -1)} aria-label="Fewer {f.label}">−</button>
            <span class="nv">
              <span class="n">{values[f.key] ?? "–"}</span><span class="u">{f.label}</span>
            </span>
            <button onclick={() => nudge(f, 1)} aria-label="More {f.label}">+</button>
          </div>
        {:else if editing === f.key}
          <!-- Tap to type: a gym with adjustable dumbbells allows any 0.25 kg
               combination, so no fixed step size is right. -->
          <span class="numf">
            <!-- svelte-ignore a11y_autofocus -->
            <input
              type="text" inputmode="decimal" autofocus
              bind:value={editText}
              aria-label={f.label}
              onblur={() => commitEdit(f)}
              onkeydown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitEdit(f); }
                if (e.key === "Escape") editing = null;
              }} />
            <span class="u">{f.label}</span>
          </span>
        {:else}
          <button class="numf" onclick={() => beginEdit(f)}>
            <span class="n">{values[f.key] === null ? "–" : formatField(values[f.key], f)}</span>
            <span class="u">{f.label}</span>
          </button>
        {/if}
      {/each}
    </div>

    <div class="acts">
      <!-- An annotation, not an action: it closes nothing, so it is a pill
           rather than a button, and the difference survives greyscale. -->
      <button
        class="failure-tag" aria-pressed={toFailure}
        onclick={() => (toFailure = !toFailure)}>
        <span class="mk">{toFailure ? "✓" : ""}</span>To failure
      </button>
      <button class="skip-set" onclick={onskip}>Skip</button>
      <button class="log-set" disabled={!ready} onclick={log}>Log set</button>
    </div>
  </div>
{/if}

<style>
  .row { display: flex; align-items: center; gap: var(--s2); }

  .no { font-family: var(--f-data); font-size: 13px; color: var(--ink-muted);
        width: 14px; flex: none; }

  .done { height: 46px; padding: 0 var(--s3);
          border: 1px solid var(--line); border-radius: var(--r-row); }
  .done .v { font-family: var(--f-data); font-size: 15px; line-height: 20px;
             font-weight: 500; font-variant-numeric: tabular-nums; }
  .done .v i { font-style: normal; font-size: 13px; color: var(--ink-muted); margin-left: 2px; }
  .done .v.muted { color: var(--ink-muted); }
  .done .x { color: var(--ink-muted); font-size: 13px; }
  .done .end { margin-left: auto; display: flex; align-items: center;
               gap: var(--s2); flex: none; }
  .done .fin { color: var(--good); font-size: 15px; }
  .done .none { color: var(--ink-muted); font-size: 15px; }
  .done .tag {
    font-family: var(--f-display); font-size: 12px; font-weight: 600;
    letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-muted);
    border: 1px solid var(--line); height: 26px; padding: 0 8px;
    border-radius: var(--r-pill); display: inline-flex; align-items: center;
  }
  .skip { opacity: 0.6; }

  .entry { flex-direction: column; align-items: stretch; gap: var(--s2);
           padding: 10px; border: 1px solid var(--accent);
           border-radius: var(--r-group); background: var(--accent-soft); }
  /* Cardio puts three values on this line and they do not fit at 390px.
     Wrapping is the fix; the row number stays put as the anchor. */
  .line { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
  .acts { display: flex; align-items: center; gap: var(--s2); }

  .numf, .step { height: 48px; background: var(--surface);
                 border: 1px solid var(--line-strong); border-radius: var(--r-control);
                 display: flex; align-items: center; min-width: 0; }
  .numf { flex: 1 1 0; justify-content: center; gap: 5px; padding: 0 6px; }
  .step { flex: 1.55 1 0; }
  .step button { width: 36px; height: 100%; font-size: 22px;
                 color: var(--ink-secondary); flex: none; }
  .step button:first-child { border-right: 1px solid var(--line); }
  .step button:last-child { border-left: 1px solid var(--line); }
  .nv { flex: 1; min-width: 0; overflow: hidden; display: flex;
        align-items: baseline; justify-content: center; gap: 4px; }

  /* The value holds its width; the unit label is what yields, so a three-digit
     weight can never be clipped by a stepper button. */
  .n { font-family: var(--f-data); font-size: 20px; line-height: 24px; font-weight: 500;
       font-variant-numeric: tabular-nums; flex: none; }
  .numf .n { border-bottom: 1px dashed var(--line-strong); padding-bottom: 2px; }
  .u { font-family: var(--f-display); font-size: 10px; font-weight: 600;
       letter-spacing: 0.03em; text-transform: uppercase; color: var(--ink-muted);
       white-space: nowrap; flex: 0 1 auto; min-width: 0; overflow: hidden; }
  .numf input { width: 100%; min-width: 0; background: none; border: 0; outline: none;
                text-align: center; font-family: var(--f-data); font-size: 20px;
                font-weight: 500; padding: 0; color: var(--ink); }

  .failure-tag {
    min-height: 36px; padding: 0 var(--s3); border-radius: var(--r-pill);
    background: transparent; color: var(--ink-secondary); border: 1px solid var(--line);
    font-family: var(--f-display); font-size: 13px; font-weight: 600;
    display: inline-flex; align-items: center; gap: 7px; margin-right: auto;
  }
  .failure-tag .mk { width: 15px; height: 15px; border-radius: 50%;
                     border: 1.5px solid var(--line-strong); flex: none;
                     display: flex; align-items: center; justify-content: center;
                     font-size: 10px; line-height: 1; }
  .failure-tag[aria-pressed="true"] { background: var(--surface-inset);
                                      color: var(--ink); border-color: var(--ink-secondary); }
  .failure-tag[aria-pressed="true"] .mk { background: var(--ink-secondary);
                                          color: var(--surface); border-color: var(--ink-secondary); }

  .skip-set { height: 48px; padding: 0 var(--s3); border-radius: var(--r-row);
              background: transparent; color: var(--ink-secondary);
              border: 1px solid var(--line-strong);
              font-family: var(--f-display); font-size: 15px; font-weight: 600; flex: none; }
  .log-set { height: 48px; padding: 0 20px; border-radius: var(--r-row);
             background: var(--accent); color: var(--accent-ink);
             border: 1px solid var(--accent);
             font-family: var(--f-display); font-size: 16px; font-weight: 700; flex: none; }
  .log-set:disabled { opacity: 0.45; }
</style>
