<script lang="ts">
  import LayoutThumb from "../../../../_shared/LayoutThumb.svelte";
  import { layoutsForMatchup } from "../../../../_shared/matchup-grid.js";
  import type { TeamPlan, TeamSize } from "../coverage";
  import { ds } from "../dataset";
  import DispoPill from "../DispoPill.svelte";
  import {
    acknowledgeReveal,
    createSim,
    randomStrategy,
    roundLayout,
    submitAccepted,
    submitAttackers,
    submitDefender,
    submitLayout,
  } from "./engine";
  import MatchupCard from "./MatchupCard.svelte";
  import PickPanel from "./PickPanel.svelte";
  import RosterSetup from "./RosterSetup.svelte";
  import type { LayoutChoice, Round, SimPlayer, SimState } from "./types";

  /**
   * The pairings practice view. Reads the plan once at setup to seed the
   * roster picker and never writes back — sim state is local and ephemeral
   * (deliberately outside the shared/synced plan doc), so a remote plan edit
   * mid-walkthrough can't yank the table out from under the exercise.
   */
  let { plan }: { plan: TeamPlan } = $props();

  const cpu = randomStrategy(Math.random);

  let sim = $state<SimState | null>(null);
  /** id → player snapshot for both sides, for lookups after pools shrink. */
  let rosterById = $state<Map<string, SimPlayer>>(new Map());

  function start(user: SimPlayer[], cpuTeam: SimPlayer[], size: TeamSize, round: Round) {
    rosterById = new Map([...user, ...cpuTeam].map((p) => [p.id, p]));
    sim = createSim(user, cpuTeam, size, round);
  }

  function restart() {
    sim = null;
  }

  const mod = $derived(sim?.current ?? null);
  const player = (id: string | undefined): SimPlayer | undefined =>
    id ? rosterById.get(id) : undefined;

  /** The two CPU attackers as players (pick-accepted options). */
  const cpuAttackerPlayers = $derived(
    (mod?.cpuAttackers ?? []).map((id) => player(id)).filter((p): p is SimPlayer => !!p),
  );

  /** Tables emitted by the module being reviewed at `module-done`. */
  const moduleTables = $derived(
    sim ? sim.results.filter((m) => m.moduleIndex === sim!.moduleIndex) : [],
  );

  /** Layout options for the user defender's table, with thumbs when authored. */
  const layoutOptions = $derived.by(() => {
    const defender = player(mod?.userDefender);
    const accepted = player(mod?.userAccepted);
    const authored = defender && accepted ? layoutsForMatchup(ds, defender.fd, accepted.fd) : [];
    return (["A", "B", "C"] as LayoutChoice[]).map((letter, i) => ({
      letter,
      layout: authored.find((l) => l.variant === i + 1),
    }));
  });

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

    {#if sim.phase === "running" && mod}
      {#if mod.step === "pick-defender"}
        <PickPanel
          title={moduleLabel(mod.kind)}
          prompt="Secretly select one member to be your Defender."
          options={sim.userPool}
          count={1}
          confirmLabel="Lock in defender"
          onconfirm={(ids) => (sim = submitDefender(sim!, ids[0], cpu))}
        />
      {:else if mod.step === "reveal-defenders"}
        <section class="rounded-md border border-panel-border bg-panel-surface p-3">
          <h3 class="font-heading text-sm font-bold uppercase tracking-wider text-text-muted">
            Defenders revealed
          </h3>
          <div class="mt-2 flex flex-wrap items-center gap-4 text-sm">
            <span class="text-text">
              Yours: <strong>{player(mod.userDefender)?.name}</strong>
              <DispoPill disposition={player(mod.userDefender)!.fd} tier="could" />
            </span>
            <span class="text-text">
              Theirs: <strong>{player(mod.cpuDefender)?.name}</strong>
              <DispoPill disposition={player(mod.cpuDefender)!.fd} tier="could" />
            </span>
          </div>
          <button
            type="button"
            class="focus-ring mt-3 rounded bg-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent-foreground hover:bg-accent-hover"
            onclick={() => (sim = acknowledgeReveal(sim!))}
          >
            Continue
          </button>
        </section>
      {:else if mod.step === "pick-attackers"}
        <PickPanel
          title={moduleLabel(mod.kind)}
          prompt={`Secretly select two of your remaining members to be Attackers against ${player(mod.cpuDefender)?.name}.`}
          options={sim.userPool.filter((p) => p.id !== mod.userDefender)}
          count={2}
          confirmLabel="Lock in attackers"
          onconfirm={(ids) => (sim = submitAttackers(sim!, [ids[0], ids[1]], cpu))}
        />
      {:else if mod.step === "reveal-attackers"}
        <section class="rounded-md border border-panel-border bg-panel-surface p-3">
          <h3 class="font-heading text-sm font-bold uppercase tracking-wider text-text-muted">
            Attackers revealed
          </h3>
          <div class="mt-2 flex flex-col gap-1 text-sm text-text">
            <p>
              You sent <strong>{mod.userAttackers?.map((id) => player(id)?.name).join(" and ")}</strong>
              against {player(mod.cpuDefender)?.name}.
            </p>
            <p>
              They sent <strong>{mod.cpuAttackers?.map((id) => player(id)?.name).join(" and ")}</strong>
              against {player(mod.userDefender)?.name}.
            </p>
          </div>
          <button
            type="button"
            class="focus-ring mt-3 rounded bg-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent-foreground hover:bg-accent-hover"
            onclick={() => (sim = acknowledgeReveal(sim!))}
          >
            Continue
          </button>
        </section>
      {:else if mod.step === "pick-accepted"}
        <PickPanel
          title={moduleLabel(mod.kind)}
          prompt={`Secretly choose which opposing Attacker ${player(mod.userDefender)?.name} will play against.`}
          options={cpuAttackerPlayers}
          count={1}
          confirmLabel="Lock in choice"
          onconfirm={(ids) => (sim = submitAccepted(sim!, ids[0], cpu))}
        />
      {:else if mod.step === "reveal-accepted"}
        <section class="rounded-md border border-panel-border bg-panel-surface p-3">
          <h3 class="font-heading text-sm font-bold uppercase tracking-wider text-text-muted">
            Match-ups decided
          </h3>
          <div class="mt-2 flex flex-col gap-1 text-sm text-text">
            <p>
              <strong>{player(mod.userDefender)?.name}</strong> plays
              <strong>{player(mod.userAccepted)?.name}</strong>.
            </p>
            <p>
              <strong>{player(mod.cpuAccepted)?.name}</strong> plays
              <strong>{player(mod.cpuDefender)?.name}</strong>.
            </p>
            {#if mod.kind === "main"}
              <p class="text-text-muted">
                The refused Attackers will play one another on Layout {roundLayout(sim.round)}.
              </p>
            {/if}
          </div>
          <button
            type="button"
            class="focus-ring mt-3 rounded bg-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent-foreground hover:bg-accent-hover"
            onclick={() => (sim = acknowledgeReveal(sim!))}
          >
            Continue
          </button>
        </section>
      {:else if mod.step === "declare-layouts"}
        <section class="rounded-md border border-panel-border bg-panel-surface p-3">
          <h3 class="font-heading text-sm font-bold uppercase tracking-wider text-text-muted">
            Declare your layout
          </h3>
          <p class="mb-2 mt-1 text-sm text-text">
            {player(mod.userDefender)?.name} (Defender) declares the layout for their table
            against {player(mod.userAccepted)?.name}.
          </p>
          <div class="flex flex-wrap gap-3">
            {#each layoutOptions as opt (opt.letter)}
              <button
                type="button"
                class="focus-ring flex w-24 flex-col items-center gap-1 rounded border border-border-strong bg-panel p-2 hover:border-accent"
                onclick={() => (sim = submitLayout(sim!, opt.letter, cpu))}
              >
                <span class="font-heading text-lg font-bold text-text">{opt.letter}</span>
                {#if opt.layout}
                  <LayoutThumb {ds} layout={opt.layout} />
                {:else}
                  <span class="py-3 text-[10px] text-text-dim">not authored</span>
                {/if}
              </button>
            {/each}
          </div>
        </section>
      {:else if mod.step === "module-done"}
        <section class="flex flex-col gap-2">
          <h3 class="font-heading text-sm font-bold uppercase tracking-wider text-text-muted">
            {moduleLabel(mod.kind)} — tables set
          </h3>
          {#each moduleTables as table (table.user.id)}
            <MatchupCard {table} />
          {/each}
          <button
            type="button"
            class="focus-ring self-start rounded bg-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent-foreground hover:bg-accent-hover"
            onclick={() => (sim = acknowledgeReveal(sim!))}
          >
            {sim.moduleIndex + 1 < sim.modules.length ? "Next module" : "Finish"}
          </button>
        </section>
      {/if}
    {:else if sim.phase === "summary"}
      <section class="flex flex-col gap-2">
        <h3 class="font-heading text-sm font-bold uppercase tracking-wider text-text-muted">
          All pairings — round {sim.round}
        </h3>
        {#each sim.results as table (table.user.id)}
          <MatchupCard {table} />
        {/each}
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
