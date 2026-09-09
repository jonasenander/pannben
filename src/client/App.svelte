<script lang="ts">
  import Health from "./lib/Health.svelte";
</script>

<div class="app">
  <header class="top">
    <h1>Pannben<span class="sub">walking skeleton</span></h1>
  </header>

  <main class="body">
    <Health />

    <p class="hint">
      Nothing to log yet. This phase proves the deployment loop, the transport and
      the install — exercises arrive next.
    </p>
  </main>
</div>

<style>
  .app { display: flex; flex-direction: column; min-height: 100dvh; }

  .top {
    flex: none;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
    padding: 11px var(--s4) 10px;
    padding-top: calc(11px + env(safe-area-inset-top));
    min-height: 60px;
    display: flex;
    align-items: center;
  }
  h1 {
    font-family: var(--f-display);
    font-size: 20px;
    line-height: 24px;
    font-weight: 700;
    margin: 0;
  }
  .sub {
    display: block;
    font-family: var(--f-data);
    font-size: 13px;
    line-height: 18px;
    font-weight: 400;
    color: var(--ink-muted);
  }

  .body {
    flex: 1;
    padding: var(--s3) var(--s4) var(--s6);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .hint { font-size: 13px; line-height: 18px; color: var(--ink-muted); margin: 0; }
</style>
