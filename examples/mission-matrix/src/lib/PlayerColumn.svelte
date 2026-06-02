<script lang="ts">
  import type {
    Mission,
    SecondaryCard,
    PlayerGame,
    ScoringMode,
    AssertedAward,
  } from "@alpaca-software/40kdc-data";
  import { SECONDARY_DECK, secondariesByIds, secondaryName } from "./data.js";
  import MissionCard from "./MissionCard.svelte";
  import WtcGrid from "./WtcGrid.svelte";
  import SecondaryHand from "./SecondaryHand.svelte";
  import ActiveSecondary from "./ActiveSecondary.svelte";

  let {
    label,
    disposition,
    mission,
    card,
    game,
    activeId,
    round,
    roundCap,
    ownTotal,
    oppTotal,
    onDraw,
    onAdd,
    onSelect,
    onDiscard,
    onScore,
    onRemoveScore,
    onPrimary,
    onApproach,
  }: {
    label: string;
    disposition: string | null;
    mission: Mission | undefined;
    card: SecondaryCard | undefined;
    game: PlayerGame;
    activeId: string | null;
    round: number;
    roundCap: number;
    ownTotal: number;
    oppTotal: number;
    onDraw: () => void;
    onAdd: (id: string) => void;
    onSelect: (id: string) => void;
    onDiscard: (id: string) => void;
    onScore: (asserted: AssertedAward[]) => void;
    onRemoveScore: (index: number) => void;
    onPrimary: (round: number, value: number) => void;
    onApproach: (mode: ScoringMode) => void;
  } = $props();

  const hand = $derived(secondariesByIds(game.handIds));
  const activeCard = $derived(activeId ? secondariesByIds([activeId])[0] : undefined);
  const available = $derived(SECONDARY_DECK.filter((c) => !game.handIds.includes(c.id)));
  const diff = $derived(ownTotal - oppTotal);
  const diffLabel = $derived(
    diff === 0 ? "Level" : `${diff > 0 ? "+" : ""}${diff} vs opponent`,
  );
</script>

<section class="flex flex-col gap-3 rounded border border-border bg-surface shadow-md p-4">
  <header class="flex items-center justify-between gap-2 flex-wrap">
    <div class="flex items-baseline gap-2 min-w-0">
      <span class="font-heading text-sm font-bold uppercase tracking-wider text-text">{label}</span>
      {#if disposition}
        <span class="font-heading text-[11px] uppercase tracking-wide text-accent truncate">{disposition}</span>
      {/if}
    </div>
    <div class="flex items-center gap-3">
      <!-- Own vs opponent score; differential on hover. -->
      <span class="flex items-baseline gap-1 cursor-help" title={diffLabel}>
        <span class="font-mono tabular-nums text-xl text-text">{ownTotal}</span>
        <span class="font-mono text-sm text-text-dim">–</span>
        <span class="font-mono tabular-nums text-sm text-text-muted">{oppTotal}</span>
      </span>
      <div class="flex items-center gap-1">
        {#each ["tactical", "fixed"] as const as m (m)}
          <button
            type="button"
            class="focus-ring font-heading text-[10px] font-bold uppercase tracking-wide rounded border px-2 py-0.5 transition-colors {game.approach ===
            m
              ? 'bg-accent text-accent-foreground border-accent'
              : 'bg-panel text-text-muted border-border hover:border-accent hover:text-accent'}"
            aria-pressed={game.approach === m}
            onclick={() => onApproach(m)}>{m}</button
          >
        {/each}
      </div>
    </div>
  </header>

  <!-- Per-round WTC grid. -->
  <WtcGrid rounds={game.rounds} current={round} {roundCap} {onPrimary} />

  <!-- Record of scored secondaries; remove one to undo a mis-score. -->
  {#if game.log.length > 0}
    <div class="flex flex-col gap-1">
      <span class="font-heading text-[10px] font-bold uppercase tracking-wider text-text-muted">Scored</span>
      <ul class="flex flex-wrap gap-1.5 m-0 p-0 list-none">
        {#each game.log as entry, i (i)}
          <li class="flex items-center gap-1.5 rounded bg-panel-surface border border-panel-border pl-2 pr-1 py-0.5">
            <span class="font-heading text-[10px] font-bold uppercase tracking-wide text-text">{secondaryName(entry.cardId)}</span>
            <span class="font-mono text-[10px] text-text-dim">R{entry.round} · {entry.vp}</span>
            <button
              type="button"
              class="focus-ring w-4 h-4 rounded-sm text-text-dim hover:text-danger leading-none"
              aria-label="Remove scored {secondaryName(entry.cardId)}"
              title="Remove (undo this score)"
              onclick={() => onRemoveScore(i)}>×</button
            >
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- Primary mission, collapsible to save vertical space at the table. -->
  <details class="group rounded border border-panel-border bg-panel-surface" open={!!mission}>
    <summary
      class="cursor-pointer list-none flex items-center gap-1 px-2 py-1.5 font-heading text-[11px] font-bold uppercase tracking-wider text-text-muted hover:text-accent"
    >
      <span class="inline-block transition-transform group-open:rotate-90">▶</span>
      Primary mission{#if mission}<span class="text-text-dim font-normal"> — {mission.name}</span>{/if}
    </summary>
    <div class="px-3 pb-3 pt-1">
      {#if mission}
        <MissionCard {mission} {card} />
      {:else}
        <div class="text-text-muted text-xs">Pick both dispositions above to reveal this primary.</div>
      {/if}
    </div>
  </details>

  <!-- Drawn secondaries + the active card's score panel. -->
  <SecondaryHand
    {hand}
    {available}
    {activeId}
    canDraw={game.handIds.length < SECONDARY_DECK.length}
    {onDraw}
    {onAdd}
    {onSelect}
    {onDiscard}
  />
  <div class="rounded border border-panel-border bg-panel-surface p-3">
    {#key activeCard?.id}
      <ActiveSecondary card={activeCard} approach={game.approach} {onScore} />
    {/key}
  </div>
</section>
