<script lang="ts">
  import Home from "./lib/Home.svelte";
  import ActiveSession from "./lib/ActiveSession.svelte";
  import ExerciseList from "./lib/ExerciseList.svelte";
  import ExerciseEdit from "./lib/ExerciseEdit.svelte";
  import ProgramList from "./lib/ProgramList.svelte";
  import ProgramEdit from "./lib/ProgramEdit.svelte";
  import History from "./lib/History.svelte";
  import SessionDetail from "./lib/SessionDetail.svelte";
  import ChartDetail from "./lib/ChartDetail.svelte";
  import Settings from "./lib/Settings.svelte";
  import { initOutbox, flush } from "./lib/outbox.js";

  type Screen =
    | { name: "home" }
    | { name: "session" }
    | { name: "history" }
    | { name: "session-detail"; id: string }
    | { name: "exercises" }
    | { name: "exercise-edit"; id: string | null }
    | { name: "chart"; id: string }
    | { name: "programs" }
    | { name: "program-edit"; id: string | null }
    | { name: "settings" };

  type Tab = "home" | "history" | "exercises" | "programs";

  let stack = $state<Screen[]>([{ name: "home" }]);
  const current = $derived(stack[stack.length - 1]!);
  const tab = $derived<Tab>(
    current.name === "programs" || current.name === "program-edit"
      ? "programs"
      : current.name === "exercises" || current.name === "exercise-edit"
          || current.name === "chart"
        ? "exercises"
        : current.name === "history" || current.name === "session-detail"
          ? "history"
          : "home",
  );

  let home = $state<Home | undefined>();
  let activeSession = $state<ActiveSession | undefined>();
  let exerciseList = $state<ExerciseList | undefined>();
  let programList = $state<ProgramList | undefined>();
  let history = $state<History | undefined>();

  const go = (s: Screen) => (stack = [...stack, s]);
  const back = () => { if (stack.length > 1) stack = stack.slice(0, -1); };
  const switchTab = (name: Tab) => (stack = [{ name }]);

  // Coming back from an editor: the write may be queued, so drain and re-read.
  async function doneEditing() {
    back();
    await flush();
    await exerciseList?.reload();
    await programList?.reload();
    await history?.reload();
    await home?.reload();
  }

  const title = $derived.by(() => {
    switch (current.name) {
      case "home": return "Pannben";
      case "session": return "Session";
      case "history": return "History";
      case "session-detail": return "Session";
      case "exercises": return "Exercises";
      case "chart": return "Chart";
      case "exercise-edit": return current.id === null ? "New exercise" : "Edit exercise";
      case "programs": return "Programs";
      case "program-edit": return current.id === null ? "New program" : "Edit program";
      case "settings": return "Settings";
    }
  });

  $effect(() => { void initOutbox(); });
</script>

<div class="app">
  <header class="top">
    {#if stack.length > 1}
      <button class="back" onclick={back} aria-label="Back">‹</button>
    {/if}
    <h1>{title}<span class="sub">Pannben</span></h1>
    {#if stack.length === 1}
      <button class="act" onclick={() => go({ name: "settings" })}>Settings</button>
    {/if}
  </header>

  <main class="body">
    {#if current.name === "home"}
      <Home bind:this={home}
        onopen={() => go({ name: "session" })}
        onchart={(id) => go({ name: "chart", id })} />
    {:else if current.name === "session"}
      <ActiveSession bind:this={activeSession}
        onfinished={async () => { stack = [{ name: "home" }]; await home?.reload(); }} />
    {:else if current.name === "history"}
      <History bind:this={history} onopen={(id) => go({ name: "session-detail", id })} />
    {:else if current.name === "session-detail"}
      <SessionDetail id={current.id}
        ondone={async () => { back(); await history?.reload(); await home?.reload(); }} />
    {:else if current.name === "exercises"}
      <ExerciseList bind:this={exerciseList} onopen={(id) => go({ name: "exercise-edit", id })} />
    {:else if current.name === "exercise-edit"}
      <ExerciseEdit id={current.id} ondone={doneEditing}
        onchart={(id) => go({ name: "chart", id })} />
    {:else if current.name === "chart"}
      <ChartDetail id={current.id} onchanged={() => home?.reload()} />
    {:else if current.name === "programs"}
      <ProgramList bind:this={programList} onopen={(id) => go({ name: "program-edit", id })} />
    {:else if current.name === "program-edit"}
      <ProgramEdit id={current.id} ondone={doneEditing} />
    {:else}
      <Settings />
    {/if}
  </main>

  {#if stack.length === 1}
    <nav class="tabs">
      <button class:on={tab === "home"} onclick={() => switchTab("home")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" /></svg>
        Home
      </button>
      <button class:on={tab === "history"} onclick={() => switchTab("history")}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 7v5.5l3.5 2" /><circle cx="12" cy="12" r="8.5" /></svg>
        History
      </button>
      <button class:on={tab === "exercises"} onclick={() => switchTab("exercises")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16M4 12h16M4 18.5h16" /></svg>
        Exercises
      </button>
      <button class:on={tab === "programs"} onclick={() => switchTab("programs")}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 4h14v5H5zM5 12h14v3H5zM5 17.5h14v3H5z" /></svg>
        Programs
      </button>
    </nav>
  {/if}
</div>

<style>
  .app { display: flex; flex-direction: column; min-height: 100dvh; }

  .top {
    flex: none; background: var(--surface); border-bottom: 1px solid var(--line);
    padding: 11px var(--s4) 10px; padding-top: calc(11px + env(safe-area-inset-top));
    min-height: 60px; display: flex; align-items: center; gap: var(--s3);
  }
  .back { font-size: 22px; line-height: 1; color: var(--ink-secondary); margin-left: -6px; padding: 2px 6px; }
  h1 { font-family: var(--f-display); font-size: 20px; line-height: 24px;
       font-weight: 700; margin: 0; flex: 1; min-width: 0; }
  .sub { display: block; font-family: var(--f-data); font-size: 13px; line-height: 18px;
         font-weight: 400; color: var(--ink-muted); }
  .act { font-family: var(--f-display); font-size: 15px; font-weight: 600;
         color: var(--accent); flex: none; min-height: 44px; }

  .body { flex: 1; padding: var(--s3) var(--s4) var(--s6);
          display: flex; flex-direction: column; gap: 10px; }

  /* A flat plane. No blur, no floating capsule. */
  .tabs {
    flex: none; display: grid; grid-template-columns: repeat(4, 1fr);
    background: var(--surface); border-top: 1px solid var(--line);
    padding: var(--s2) var(--s1) 10px;
    padding-bottom: calc(10px + env(safe-area-inset-bottom));
  }
  .tabs button {
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    min-height: 44px; justify-content: center; color: var(--ink-muted);
    font-family: var(--f-display); font-size: 12px; line-height: 15px; font-weight: 600;
    border-radius: var(--r-control);
  }
  .tabs svg { width: 22px; height: 22px; stroke: currentColor; fill: none;
              stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .tabs button.on { color: var(--accent); font-weight: 700; }
</style>
