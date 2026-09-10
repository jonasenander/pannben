<script lang="ts">
  import { subscribeSync, dismissError, flush, type SyncState } from "./outbox.js";

  let sync = $state<SyncState>({ pending: 0, error: null, online: true, flushing: false });
  $effect(() => subscribeSync((s) => (sync = s)));
</script>

{#if sync.error}
  <div class="bar bad" role="alert">
    <span class="grow">{sync.error}</span>
    <button onclick={dismissError}>Dismiss</button>
  </div>
{:else if sync.pending > 0}
  <div class="bar wait">
    <span class="dot"></span>
    <span class="grow">
      {sync.pending} change{sync.pending === 1 ? "" : "s"} waiting
      {sync.online ? "to sync" : "— offline"}
    </span>
    {#if sync.online && !sync.flushing}
      <button onclick={() => flush()}>Retry</button>
    {/if}
  </div>
{:else if !sync.online}
  <div class="bar wait"><span class="dot"></span><span class="grow">Offline — everything saved</span></div>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: 9px var(--s3);
    border-radius: var(--r-row);
    font-size: 13px;
    line-height: 18px;
    border: 1px solid var(--line);
    background: var(--surface-inset);
    color: var(--ink-secondary);
  }
  .bar.bad { border-color: var(--danger); color: var(--danger); background: transparent; }
  .grow { flex: 1; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--warning); flex: none; }
  button {
    font-family: var(--f-display);
    font-size: 13px;
    font-weight: 600;
    color: inherit;
    text-decoration: underline;
    min-height: 32px;
    padding: 0 4px;
  }
</style>
