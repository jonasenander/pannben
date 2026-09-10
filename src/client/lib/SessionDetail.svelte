<script lang="ts">
  import SyncBar from "./SyncBar.svelte";
  import { flush } from "./outbox.js";
  import {
    fetchSession, updateSet, removeSet, updateSession, removeSession,
    shownFields, SET_SEPARATOR, parseField, formatNumber, formatMinutes, formatDate,
    type SessionView, type LoggedSet, type FieldSpec,
  } from "./api.js";

  let { id, ondone }: { id: string; ondone: () => void } = $props();

  let session = $state<SessionView | null>(null);
  let error = $state<string | null>(null);
  let editing = $state(false);
  let confirmDelete = $state(false);
  /** A set delete is one tap from a to-failure toggle, so it asks first. */
  let confirmSet = $state<string | null>(null);

  /** Which value is currently open for typing: one at a time, app-wide. */
  let openField = $state<string | null>(null);
  let draft = $state("");

  async function load() {
    try {
      session = await fetchSession(id);
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  $effect(() => { void load(); });

  const setCount = $derived(
    session
      ? session.blocks.reduce(
          (n, b) => n + b.exercises.reduce((m, e) => m + e.sets.filter((s) => !s.skipped).length, 0),
          0,
        )
      : 0,
  );

  /**
   * Corrections are tap-to-type on every field, reps included.
   *
   * During logging reps move by one and a stepper wins. A correction is not a
   * nudge — it is replacing 100 with 10, which is ninety taps on a stepper and
   * two on a keypad.
   */
  function beginEdit(set: LoggedSet, f: FieldSpec) {
    openField = `${set.id}:${f.key}`;
    draft = formatNumber(set[f.key]);
  }

  async function commitEdit(set: LoggedSet, f: FieldSpec) {
    openField = null;
    const parsed = parseField(draft, f);
    if (parsed === null || parsed === set[f.key]) return;
    await write({ ...set, [f.key]: parsed });
  }

  /** Every correction is an ordinary set write carrying the id it already has. */
  async function write(set: LoggedSet) {
    await updateSet(set);
    await flush();
    await load();
  }

  async function drop(set: LoggedSet) {
    confirmSet = null;
    await removeSet(set.id);
    await flush();
    await load();
  }

  async function saveNotes(notes: string) {
    if (!session || notes === session.notes) return;
    await updateSession(session.id, { notes });
    await flush();
    await load();
  }

  async function saveDate(date: string) {
    if (!session || date === session.date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    await updateSession(session.id, { date });
    await flush();
    await load();
  }

  async function destroy() {
    if (!session) return;
    await removeSession(session.id);
    await flush();
    ondone();
  }
</script>

<SyncBar />

{#if error}
  <p class="err">{error}</p>
  <button class="btn ghost" onclick={load}>Try again</button>
{:else if !session}
  <p class="hint">Loading…</p>
{:else}
  <div class="head">
    <div class="hgrow">
      <span class="nm">{session.program_name ?? "Ad-hoc session"}</span>
      {#if editing}
        <input
          class="dateinput" type="date" value={session.date} aria-label="Session date"
          onchange={(e) => saveDate((e.currentTarget as HTMLInputElement).value)} />
      {:else}
        <span class="date">{formatDate(session.date)}</span>
      {/if}
    </div>
    <button class="link" onclick={() => (editing = !editing)}>
      {editing ? "Done" : "Edit"}
    </button>
  </div>

  <div class="stats">
    <span><b>{setCount}</b> sets</span>
    <span><b>{formatMinutes(session.duration_s)}</b></span>
    {#if session.status === "active"}<span class="live">In progress</span>{/if}
  </div>

  {#each session.blocks as block (block.id)}
    <div class="block" class:superset={block.type === "superset"}>
      {#if block.type === "superset"}
        <span class="eyebrow">Superset</span>
      {/if}
      {#each block.exercises as ex (ex.id)}
        <div class="ex">
          <div class="exhead">
            <span class="exnm">{ex.exercise_name}</span>
            {#if ex.note}<span class="exnote">{ex.note}</span>{/if}
          </div>

          {#if ex.sets.length === 0}
            <p class="none">Nothing logged.</p>
          {:else}
            {#each ex.sets as s (s.id)}
              <div class="row" class:skip={s.skipped}>
                <span class="no">{s.set_index + 1}</span>

                {#if s.skipped}
                  <span class="v muted">not done</span>
                {:else}
                  {#each shownFields(ex.metric_type, s) as f, i}
                    {#if i > 0}<span class="x">{SET_SEPARATOR[ex.metric_type]}</span>{/if}
                    {#if editing && openField === `${s.id}:${f.key}`}
                      <span class="numf open">
                        <!-- svelte-ignore a11y_autofocus -->
                        <input
                          type="text" inputmode="decimal" autofocus
                          bind:value={draft} aria-label="{f.label}, set {s.set_index + 1}"
                          onblur={() => commitEdit(s, f)}
                          onkeydown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitEdit(s, f); }
                            if (e.key === "Escape") openField = null;
                          }} />
                        <i>{f.label}</i>
                      </span>
                    {:else if editing}
                      <button class="numf" onclick={() => beginEdit(s, f)}>
                        {formatNumber(s[f.key])}<i>{f.label}</i>
                      </button>
                    {:else}
                      <span class="v">{formatNumber(s[f.key])}<i>{f.label}</i></span>
                    {/if}
                  {/each}
                {/if}

                <span class="end">
                  {#if editing && confirmSet === s.id}
                    <button class="mini" onclick={() => (confirmSet = null)}>Keep</button>
                    <button class="mini danger" onclick={() => drop(s)}>Delete</button>
                  {:else if editing}
                    <button
                      class="tag toggle" aria-pressed={s.to_failure}
                      onclick={() => write({ ...s, to_failure: !s.to_failure })}>To failure</button>
                    <button class="drop" aria-label="Delete set {s.set_index + 1}"
                      onclick={() => (confirmSet = s.id)}>×</button>
                  {:else}
                    {#if s.to_failure}<span class="tag">To failure</span>{/if}
                    {#if s.skipped}
                      <span class="none-mark" aria-label="skipped">—</span>
                    {:else}
                      <span class="fin" aria-label="logged">✓</span>
                    {/if}
                  {/if}
                </span>
              </div>
            {/each}
          {/if}
        </div>
      {/each}
    </div>
  {/each}

  <span class="eyebrow">Session note</span>
  {#if editing}
    <textarea
      rows="3" value={session.notes} placeholder="Anything worth remembering."
      onblur={(e) => saveNotes((e.currentTarget as HTMLTextAreaElement).value)}></textarea>
  {:else}
    <p class="sessnote">{session.notes || "—"}</p>
  {/if}

  {#if editing}
    {#if confirmDelete}
      <p class="warn">
        Deleting hides the whole session from history and charts. The sets stay
        in the database and in every export.
      </p>
      <div class="pair">
        <button class="btn ghost" onclick={() => (confirmDelete = false)}>Keep it</button>
        <button class="btn danger" onclick={destroy}>Delete session</button>
      </div>
    {:else}
      <button class="btn ghost danger-text" onclick={() => (confirmDelete = true)}>
        Delete this session
      </button>
    {/if}
  {/if}
{/if}

<style>
  .head { display: flex; align-items: flex-start; gap: var(--s3); }
  .hgrow { flex: 1; min-width: 0; }
  .nm { font-family: var(--f-display); font-size: 20px; line-height: 26px;
        font-weight: 700; display: block; }
  .date { font-family: var(--f-data); font-size: 15px; color: var(--ink-muted); }
  .dateinput {
    font-family: var(--f-data); font-size: 15px; height: 40px; margin-top: 4px;
    border: 1px solid var(--line-strong); border-radius: var(--r-control);
    background: var(--surface); color: var(--ink); padding: 0 var(--s2);
  }
  .link { font-family: var(--f-display); font-size: 15px; font-weight: 600;
          color: var(--accent); min-height: 44px; flex: none; }

  .stats { display: flex; gap: var(--s3); align-items: center; flex-wrap: wrap;
           font-size: 13px; color: var(--ink-muted); }
  .stats b { font-family: var(--f-data); font-variant-numeric: tabular-nums;
             font-weight: 500; color: var(--ink-secondary); }
  .live { font-family: var(--f-display); font-size: 11px; font-weight: 700;
          letter-spacing: .06em; text-transform: uppercase;
          color: var(--accent-ink); background: var(--accent);
          border-radius: var(--r-pill); padding: 3px 9px; }

  .eyebrow { font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
             letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted); }

  /* card → divider → inset row. A superset is one unit, so it is one card. */
  .block { background: var(--surface); border: 1px solid var(--line);
           border-radius: var(--r-card); padding: var(--s3) var(--s4) var(--s3); }
  .block.superset { border-left: 3px solid var(--line-strong); }
  .ex + .ex { border-top: 1px solid var(--line); margin-top: var(--s3); padding-top: var(--s3); }
  .exhead { margin-bottom: 4px; }
  .exnm { font-family: var(--f-display); font-size: 16px; line-height: 22px; font-weight: 700;
          display: block; }
  .exnote { font-size: 13px; line-height: 18px; color: var(--ink-muted); display: block; }

  .row { display: flex; align-items: center; gap: var(--s2); min-height: 44px;
         border-top: 1px solid var(--line); }
  .no { font-family: var(--f-data); font-size: 13px; color: var(--ink-muted);
        width: 16px; flex: none; }
  .v, .numf { font-family: var(--f-data); font-variant-numeric: tabular-nums;
              font-size: 15px; font-weight: 500; color: var(--ink); flex: none; }
  .v i, .numf i { font-style: normal; font-size: 12px; color: var(--ink-muted);
                  margin-left: 2px; }
  .v.muted { color: var(--ink-muted); font-style: italic; }
  .x { color: var(--line-strong); font-size: 12px; flex: none; }

  /* An editable value has to look editable without a label saying so. */
  .numf { border: 1px solid var(--line-strong); border-radius: var(--r-control);
          background: var(--surface-inset); padding: 5px var(--s2); min-height: 36px; }
  .numf.open { border-color: var(--accent); background: var(--accent-soft); }
  .numf input { width: 3.5em; font-family: var(--f-data); font-size: 15px;
                font-weight: 500; color: var(--ink); background: transparent;
                border: 0; padding: 0; text-align: right; }

  .end { margin-left: auto; display: flex; align-items: center; gap: var(--s2); flex: none; }
  .fin { color: var(--good); font-size: 16px; font-weight: 700; }
  .none-mark { color: var(--ink-muted); }
  .tag { font-family: var(--f-ui); font-size: 11px; font-weight: 600; line-height: 15px;
         color: var(--ink-secondary); background: var(--surface-inset);
         border: 1px solid var(--line); border-radius: var(--r-pill); padding: 2px 8px; }
  .tag.toggle { min-height: 32px; }
  .tag.toggle[aria-pressed="true"] { background: var(--accent-soft);
                                     border-color: var(--accent); color: var(--accent); }
  .drop { color: var(--danger); font-size: 20px; line-height: 1; width: 36px;
          min-height: 36px; }
  .mini { font-family: var(--f-display); font-size: 13px; font-weight: 600;
          min-height: 36px; padding: 0 var(--s2); border-radius: var(--r-control);
          border: 1px solid var(--line-strong); color: var(--ink-secondary); }
  .mini.danger { border-color: var(--danger); color: var(--danger); }

  .none { font-size: 13px; color: var(--ink-muted); font-style: italic; margin: 4px 0 0; }
  .sessnote { font-size: 15px; line-height: 21px; color: var(--ink-secondary); margin: 0; }
  textarea { font-family: var(--f-ui); font-size: 15px; line-height: 21px; padding: var(--s2);
             border: 1px solid var(--line-strong); border-radius: var(--r-control);
             background: var(--surface); color: var(--ink); resize: vertical; width: 100%; }

  .warn { font-size: 13px; line-height: 18px; color: var(--ink-secondary);
          background: var(--surface-inset); border: 1px solid var(--line);
          border-radius: var(--r-row); padding: var(--s3); margin: 0; }
  .pair { display: flex; gap: var(--s2); }
  .pair .btn { flex: 1; }

  .hint { font-size: 13px; color: var(--ink-muted); margin: 0; }
  .err { font-size: 15px; color: var(--danger); margin: 0; }

  .btn { display: flex; align-items: center; justify-content: center;
         height: 52px; width: 100%; border-radius: var(--r-row);
         font-family: var(--f-display); font-size: 16px; font-weight: 700;
         background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent); }
  .btn.ghost { background: transparent; color: var(--ink-secondary); border-color: var(--line-strong); }
  .btn.ghost.danger-text { color: var(--danger); }
  .btn.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
</style>
