<script lang="ts">
  import type { TeamPlan, TeamSize } from "../coverage";
  import { createSim, randomStrategy, roundLayout } from "./engine";
  import PairingMat from "./PairingMat.svelte";
  import RosterSetup from "./RosterSetup.svelte";
  import TableTile from "./TableTile.svelte";
  import type { Round, SimPlayer, SimState } from "./types";

  /**
   * The pairings practice view. Reads the plan once at setup to seed the
   * roster picker and never writes back — sim state is local and ephemeral
   * (deliberately outside the shared/synced plan doc), so a remote plan edit
   * mid-walkthrough can't yank the table out from under the exercise.
   */
  let { plan }: { plan: TeamPlan } = $props();

  const cpu = randomStrategy(Math.random);

  let sim = $state<SimState | null>(null);

  function start(user: SimPlayer[], cpuTeam: SimPlayer[], size: TeamSize, round: Round) {
    sim = createSim(user, cpuTeam, size, round);
  }

  function restart() {
    sim = null;
  }

  const moduleLabel = (kind: string) =>
    kind === "skirmish" ? "Initial Skirmish" : kind === "main" ? "Main Engagement" : "Champion";
</script>

<div class="flex flex-col gap-4">
  {#if !sim}
    <RosterSetup {plan} onstart={start} />
  {:else}
    <!-- Module progress strip -->
    <ol class="flex flex-wrap gap-1.5">
      {#each sim.modules as m, i (i)}
        <li
          class="rounded px-2 py-1 font-heading text-[10px] font-bold uppercase tracking-wider
                 {i < sim.moduleIndex || sim.phase === 'summary'
                   ? 'bg-success/15 text-success'
                   : i === sim.moduleIndex
                     ? 'bg-accent-dim text-text'
                     : 'bg-panel text-text-dim'}"
        >
          {i + 1}. {moduleLabel(m)}
        </li>
      {/each}
      <li class="ml-auto self-center text-[11px] text-text-dim">
        Round {sim.round} — refused/champion tables play Layout {roundLayout(sim.round)}
      </li>
    </ol>

    {#if sim.phase === "running"}
      <PairingMat {sim} {cpu} onstate={(next) => (sim = next)} />
    {:else if sim.phase === "summary"}
      <section class="flex flex-col gap-2">
        <h3 class="font-heading text-sm font-bold uppercase tracking-wider text-text-muted">
          All pairings — round {sim.round}
        </h3>
        <div class="grid gap-2 md:grid-cols-2">
          {#each sim.results as table (table.user.id)}
            <TableTile {table} />
          {/each}
        </div>
      </section>
    {/if}

    <div class="flex gap-2">
      <button
        type="button"
        class="focus-ring rounded border border-border-strong px-3 py-1.5 text-xs uppercase tracking-wide text-text-muted hover:border-danger hover:text-danger"
        onclick={restart}
      >
        {sim.phase === "summary" ? "Run again" : "Abandon and restart"}
      </button>
    </div>
  {/if}
</div>
