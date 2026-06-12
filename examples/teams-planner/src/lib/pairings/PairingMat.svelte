<script lang="ts">
  import LayoutThumb from "../../../../_shared/LayoutThumb.svelte";
  import { layoutsForMatchup } from "../../../../_shared/matchup-grid.js";
  import { ds } from "../dataset";
  import {
    acknowledgeReveal,
    roundLayout,
    submitAccepted,
    submitAttackers,
    submitDefender,
    submitLayout,
  } from "./engine";
  import CardRow from "./CardRow.svelte";
  import FactionCard from "./FactionCard.svelte";
  import MatSlot from "./MatSlot.svelte";
  import TableTile from "./TableTile.svelte";
  import { receiveCard, sendCard } from "./transitions";
  import type { CpuStrategy, LayoutChoice, SimPlayer, SimState } from "./types";

  /**
   * The pairing mat — the board a physical teams event lays on the front
   * table, as a screen. Their pool runs along the top, yours along the
   * bottom; between them sit the color-coded card slots (blue DEFENDER, red
   * ATTACKERS, like the printed mats) and a center strip carrying the
   * current step's prompt + lock button. Resolved tables accumulate in the
   * TABLES rail.
   *
   * Picks are click-to-place (click a pool card to arm it, click a slot) or
   * drag-and-drop — one state, two gestures. The engine is untouched: this
   * renders `SimState` and calls the same reducers the form UI did.
   */
  let {
    sim,
    cpu,
    onstate,
  }: {
    sim: SimState;
    cpu: CpuStrategy;
    onstate: (next: SimState) => void;
  } = $props();

  const mod = $derived(sim.current);

  /** id → snapshot for everyone, so slots can render players after pools shrink. */
  const byId = $derived(
    new Map(
      [...sim.userPool, ...sim.cpuPool, ...sim.results.flatMap((m) => [m.user, m.cpu])].map((p) => [
        p.id,
        p,
      ]),
    ),
  );
  const player = (id: string | undefined): SimPlayer | undefined => (id ? byId.get(id) : undefined);

  // ── Local pick staging (committed to the engine on Lock) ────────────────────
  // The step's slots are interchangeable (one defender, two equal attacker
  // slots), so clicking a pool card flies it straight into the next open slot
  // — no intermediate "armed" state to learn. Dragging onto a slot is the
  // same placement; clicking a staged card takes it back.
  /** Staged-but-unlocked placements for the current step, in slot order. */
  let staged = $state<string[]>([]);

  $effect(() => {
    // Any engine step change clears local staging.
    void mod?.step;
    staged = [];
  });

  const stepNeeds = $derived(
    mod?.step === "pick-defender" ? 1 : mod?.step === "pick-attackers" ? 2 : 0,
  );
  // The engine only removes players from the pools when the module resolves
  // (submitLayout), so mid-module the pools still *contain* everyone who's
  // sitting in a slot. The board shows each card exactly once: pool views
  // exclude placed/staged ids — except at module-done, where the slots clear
  // (pairings flew to the tables rail) and the engine's pools are the truth
  // again (a skirmish's refused attacker is legitimately back).
  const userPlaced = $derived(
    mod && mod.step !== "module-done"
      ? new Set([...staged, mod.userDefender, ...(mod.userAttackers ?? [])].filter(Boolean))
      : new Set<string>(),
  );
  const cpuPlaced = $derived(
    mod && mod.step !== "module-done"
      ? new Set([mod.cpuDefender, ...(mod.cpuAttackers ?? [])].filter(Boolean))
      : new Set<string>(),
  );
  const poolView = $derived(sim.userPool.filter((p) => !userPlaced.has(p.id)));
  const cpuPoolView = $derived(sim.cpuPool.filter((p) => !cpuPlaced.has(p.id)));
  /** Pool cards still available to stage (eligibility per step). */
  const pickablePool = $derived.by(() => {
    if (!mod) return [];
    if (mod.step === "pick-defender" || mod.step === "pick-attackers") return poolView;
    return [];
  });

  /** Place a card (click on pool card, or drop onto a slot). */
  function place(id: string | null) {
    if (!id || staged.length >= stepNeeds) return;
    if (!pickablePool.some((p) => p.id === id)) return;
    staged = [...staged, id];
  }

  /** Click a staged card to take it back to the pool. */
  function unstage(id: string) {
    staged = staged.filter((s) => s !== id);
  }

  function lock() {
    if (!mod) return;
    if (mod.step === "pick-defender" && staged.length === 1) {
      onstate(submitDefender(sim, staged[0], cpu));
    } else if (mod.step === "pick-attackers" && staged.length === 2) {
      onstate(submitAttackers(sim, [staged[0], staged[1]], cpu));
    }
  }

  // ── Step-derived slot/prompt facts ───────────────────────────────────────────
  const prompt = $derived.by(() => {
    if (!mod) return "";
    switch (mod.step) {
      case "pick-defender":
        return "Secretly select one member to be your Defender.";
      case "reveal-defenders":
        return "Defenders revealed.";
      case "pick-attackers":
        return `Secretly select two of your remaining members to be Attackers against ${player(mod.cpuDefender)?.name}.`;
      case "reveal-attackers":
        return "Attackers revealed.";
      case "pick-accepted":
        return `Choose which opposing Attacker ${player(mod.userDefender)?.name} will play against — click one of their attackers.`;
      case "reveal-accepted":
        return "Match-ups decided.";
      case "declare-layouts":
        return `${player(mod.userDefender)?.name} (Defender) declares the layout for their table against ${player(mod.userAccepted)?.name}.`;
      case "module-done":
        return "Tables set.";
    }
  });

  const secret = $derived(mod?.step === "pick-defender" || mod?.step === "pick-attackers");
  /** CPU placements render face-down until their reveal step passes. */
  const cpuDefenderRevealed = $derived(
    !!mod && mod.step !== "pick-defender" && mod.step !== "reveal-defenders"
      ? true
      : mod?.step === "reveal-defenders",
  );
  const cpuAttackersRevealed = $derived(
    !!mod &&
      ["reveal-attackers", "pick-accepted", "reveal-accepted", "declare-layouts", "module-done"].includes(
        mod.step,
      ),
  );
  const userRevealed = $derived(!secret);

  /** Layout options for the declare step. */
  const layoutOptions = $derived.by(() => {
    const defender = player(mod?.userDefender);
    const accepted = player(mod?.userAccepted);
    const authored = defender && accepted ? layoutsForMatchup(ds, defender.fd, accepted.fd) : [];
    return (["A", "B", "C"] as LayoutChoice[]).map((letter, i) => ({
      letter,
      layout: authored.find((l) => l.variant === i + 1),
    }));
  });

  const moduleTables = $derived(sim.results.filter((m) => m.moduleIndex === sim.moduleIndex));
  const moduleLabel = $derived(
    mod?.kind === "skirmish" ? "Initial Skirmish" : mod?.kind === "main" ? "Main Engagement" : "",
  );
  const continueLabel = $derived(
    mod?.step === "module-done"
      ? sim.moduleIndex + 1 < sim.modules.length
        ? "Next module"
        : "Finish"
      : "Continue",
  );
  const showContinue = $derived(
    !!mod &&
      ["reveal-defenders", "reveal-attackers", "reveal-accepted", "module-done"].includes(mod.step),
  );
</script>

<div class="mat-grid">
  <div class="board rounded-lg border border-panel-border">
    <!-- Their pool -->
    <CardRow label="Their pool" players={cpuPoolView} size="sm" />

    <!-- Their slot rank -->
    <div class="slots their">
      <MatSlot label="Their defender" kind="defender">
        {#if mod?.cpuDefender && mod.step !== "module-done"}
          <FactionCard player={player(mod.cpuDefender)!} face={cpuDefenderRevealed ? "up" : "down"} />
        {/if}
      </MatSlot>
      {#each [0, 1] as i (i)}
        {@const id = mod?.step !== "module-done" ? mod?.cpuAttackers?.[i] : undefined}
        <MatSlot
          label="Their attacker {i + 1}"
          kind="attacker"
          active={mod?.step === "pick-accepted" && !!id}
          onplace={() => {
            if (mod?.step === "pick-accepted" && id) onstate(submitAccepted(sim, id, cpu));
          }}
        >
          {#if id}
            <FactionCard
              player={player(id)!}
              face={cpuAttackersRevealed ? "up" : "down"}
              selectable={mod?.step === "pick-accepted"}
              onpick={() => {
                if (mod?.step === "pick-accepted") onstate(submitAccepted(sim, id, cpu));
              }}
              title={mod?.step === "pick-accepted"
                ? `${player(id)?.name} — have your Defender play this attacker`
                : undefined}
            />
          {/if}
        </MatSlot>
      {/each}
    </div>

    <!-- Center strip: prompt + step controls -->
    <div class="center">
      <p class="prompt">
        <span class="module">{moduleLabel}</span>
        {prompt}
        {#if secret}
          <span class="simul">Your opponent picks simultaneously — both reveal together.</span>
        {/if}
      </p>

      {#if mod?.step === "declare-layouts"}
        <div class="layouts">
          {#each layoutOptions as opt (opt.letter)}
            <button
              type="button"
              class="focus-ring layout-btn"
              onclick={() => onstate(submitLayout(sim, opt.letter, cpu))}
            >
              <span class="layout-letter">{opt.letter}</span>
              {#if opt.layout}
                <LayoutThumb {ds} layout={opt.layout} />
              {:else}
                <span class="unauthored">not authored</span>
              {/if}
            </button>
          {/each}
        </div>
      {:else if stepNeeds > 0}
        <button
          type="button"
          class="focus-ring lock"
          disabled={staged.length !== stepNeeds}
          onclick={lock}
        >
          {mod?.step === "pick-defender" ? "Lock in defender" : "Lock in attackers"}
        </button>
      {:else if showContinue}
        <button type="button" class="focus-ring lock" onclick={() => onstate(acknowledgeReveal(sim))}>
          {continueLabel}
        </button>
      {/if}

      {#if mod?.kind === "main" && (mod.step === "reveal-accepted" || mod.step === "declare-layouts")}
        <p class="note">The refused Attackers will play one another on Layout {roundLayout(sim.round)}.</p>
      {/if}
    </div>

    <!-- Your slot rank -->
    <div class="slots yours">
      <MatSlot
        label="Your defender"
        kind="defender"
        active={mod?.step === "pick-defender" && staged.length < 1}
        onplace={place}
      >
        {#if mod?.step === "pick-defender" || !mod?.userDefender}
          {#if staged[0]}
            <div in:receiveCard={{ key: staged[0] }} out:sendCard={{ key: staged[0] }}>
              <FactionCard
                player={player(staged[0])!}
                face="down"
                selectable
                onpick={() => unstage(staged[0])}
                title="{player(staged[0])?.name} — click to take back"
              />
            </div>
          {/if}
        {:else if mod.step !== "module-done"}
          <FactionCard player={player(mod.userDefender)!} face={userRevealed ? "up" : "down"} />
        {/if}
      </MatSlot>
      {#each [0, 1] as i (i)}
        <MatSlot
          label="Your attacker {i + 1}"
          kind="attacker"
          active={mod?.step === "pick-attackers" && staged.length <= i}
          onplace={place}
        >
          {#if mod?.step === "pick-attackers"}
            {#if staged[i]}
              <div in:receiveCard={{ key: staged[i] }} out:sendCard={{ key: staged[i] }}>
                <FactionCard
                  player={player(staged[i])!}
                  face="down"
                  selectable
                  onpick={() => unstage(staged[i])}
                  title="{player(staged[i])?.name} — click to take back"
                />
              </div>
            {/if}
          {:else if mod?.userAttackers?.[i] && mod.step !== "module-done"}
            <FactionCard player={player(mod.userAttackers[i])!} face={userRevealed ? "up" : "down"} />
          {/if}
        </MatSlot>
      {/each}
    </div>

    <!-- Your pool -->
    <CardRow
      label="Your pool"
      players={poolView}
      selectable={stepNeeds > 0}
      onpick={(p) => place(p.id)}
      size="sm"
    />
  </div>

  <!-- Tables rail -->
  <aside class="tables">
    <span class="rail-label">Tables</span>
    {#if sim.results.length === 0}
      <p class="rail-empty">Resolved match-ups land here.</p>
    {/if}
    {#each sim.results as table (table.user.id)}
      <TableTile {table} />
    {/each}
    {#if mod?.step === "module-done"}
      <p class="rail-note">{moduleTables.length} table{moduleTables.length === 1 ? "" : "s"} set this module.</p>
    {/if}
  </aside>
</div>

<style>
  .mat-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
    gap: 0.75rem;
    align-items: start;
  }
  @media (max-width: 56rem) {
    .mat-grid {
      grid-template-columns: 1fr;
    }
  }
  .board {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    /* Neoprene-ish board texture: faint grid over a deep panel tone. */
    background:
      repeating-linear-gradient(0deg, transparent 0 23px, rgba(255, 255, 255, 0.025) 23px 24px),
      repeating-linear-gradient(90deg, transparent 0 23px, rgba(255, 255, 255, 0.025) 23px 24px),
      var(--color-panel, #16171c);
  }
  .slots {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
  }
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-block: 1px dashed color-mix(in srgb, var(--color-border-strong, #66666f) 45%, transparent);
  }
  .prompt {
    text-align: center;
    font-size: 0.85rem;
    color: var(--color-text, #ececf0);
    max-width: 42rem;
  }
  .module {
    display: block;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-dim, #8a8f9c);
    margin-bottom: 0.15rem;
  }
  .simul {
    display: block;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-dim, #8a8f9c);
    margin-top: 0.2rem;
  }
  .note {
    font-size: 0.7rem;
    color: var(--color-text-muted, #b9bdc7);
  }
  .lock {
    border-radius: 0.25rem;
    background: var(--color-accent, #14b8a6);
    color: var(--color-accent-foreground, #0a1f1c);
    padding: 0.4rem 1rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .lock:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .layouts {
    display: flex;
    gap: 0.75rem;
  }
  .layout-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    width: 6rem;
    padding: 0.5rem;
    border: 1px solid var(--color-border-strong, #66666f);
    border-radius: 0.375rem;
    background: var(--color-panel, #16171c);
  }
  .layout-btn:hover {
    border-color: var(--color-accent, #14b8a6);
  }
  .layout-letter {
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--color-text, #ececf0);
  }
  .unauthored {
    font-size: 0.6rem;
    color: var(--color-text-dim, #8a8f9c);
    padding: 1rem 0;
  }
  .tables {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .rail-label {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-dim, #8a8f9c);
  }
  .rail-empty,
  .rail-note {
    font-size: 0.7rem;
    font-style: italic;
    color: var(--color-text-dim, #8a8f9c);
  }
</style>
