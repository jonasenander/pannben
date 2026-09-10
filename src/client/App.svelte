<script lang="ts">
  import ExerciseList from "./lib/ExerciseList.svelte";
  import ExerciseEdit from "./lib/ExerciseEdit.svelte";
  import Settings from "./lib/Settings.svelte";
  import { initOutbox, flush } from "./lib/outbox.js";

  type Screen =
    | { name: "exercises" }
    | { name: "exercise-edit"; id: string | null }
    | { name: "settings" };

  let stack = $state<Screen[]>([{ name: "exercises" }]);
  const current = $derived(stack[stack.length - 1]!);

  let list = $state<ExerciseList | undefined>();

  const go = (s: Screen) => (stack = [...stack, s]);
  const back = () => { if (stack.length > 1) stack = stack.slice(0, -1); };

  // Returning from the editor: the write is queued, so re-read to pick it up.
  async function doneEditing() {
    back();
    await flush();
    await list?.reload();
  }

  const TITLES: Record<Screen["name"], string> = {
    exercises: "Exercises",
    "exercise-edit": "Exercise",
    settings: "Settings",
  };

  $effect(() => { void initOutbox(); });
</script>

<div class="app">
  <header class="top">
    {#if stack.length > 1}
      <button class="back" onclick={back} aria-label="Back">‹</button>
    {/if}
    <h1>
      {current.name === "exercise-edit"
        ? (current.id === null ? "New exercise" : "Edit exercise")
        : TITLES[current.name]}
      <span class="sub">Pannben</span>
    </h1>
    {#if current.name === "exercises"}
      <button class="act" onclick={() => go({ name: "settings" })}>Settings</button>
    {/if}
  </header>

  <main class="body">
    {#if current.name === "exercises"}
      <ExerciseList bind:this={list} onopen={(id) => go({ name: "exercise-edit", id })} />
    {:else if current.name === "exercise-edit"}
      <ExerciseEdit id={current.id} ondone={doneEditing} />
    {:else}
      <Settings />
    {/if}
  </main>
</div>

<style>
  .app { display: flex; flex-direction: column; min-height: 100dvh; }

  .top {
    flex: none; background: var(--surface); border-bottom: 1px solid var(--line);
    padding: 11px var(--s4) 10px;
    padding-top: calc(11px + env(safe-area-inset-top));
    min-height: 60px; display: flex; align-items: center; gap: var(--s3);
  }
  .back {
    font-size: 22px; line-height: 1; color: var(--ink-secondary);
    margin-left: -6px; padding: 2px 6px;
  }
  h1 {
    font-family: var(--f-display); font-size: 20px; line-height: 24px;
    font-weight: 700; margin: 0; flex: 1; min-width: 0;
  }
  .sub {
    display: block; font-family: var(--f-data); font-size: 13px; line-height: 18px;
    font-weight: 400; color: var(--ink-muted);
  }
  .act {
    font-family: var(--f-display); font-size: 15px; font-weight: 600;
    color: var(--accent); flex: none; min-height: 44px;
  }

  .body {
    flex: 1; padding: var(--s3) var(--s4) var(--s6);
    display: flex; flex-direction: column; gap: 10px;
  }
</style>
