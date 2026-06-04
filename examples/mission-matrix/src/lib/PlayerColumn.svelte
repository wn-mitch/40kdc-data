<script lang="ts">
  import type {
    Mission,
    SecondaryCard,
    PlayerGame,
    ScoringMode,
    AssertedAward,
  } from "@alpaca-software/40kdc-data";
  import { awardsForApproach, scoreCap } from "@alpaca-software/40kdc-data";
  import { SECONDARY_DECK, secondariesByIds, secondaryName } from "./data.js";
  import MissionCard from "./MissionCard.svelte";
  import WtcGrid from "./WtcGrid.svelte";
  import SecondaryHand from "./SecondaryHand.svelte";
  import ScoringPanel from "./ScoringPanel.svelte";

  let {
    label,
    disposition,
    mission,
    card,
    game,
    activeId,
    excluded,
    discards,
    round,
    effectiveRoundCap,
    ownTotal,
    oppTotal,
    onDraw,
    onAdd,
    onSelect,
    onDiscard,
    onRestore,
    onScore,
    onRemoveScore,
    onPrimaryScore,
    onClearPrimary,
    onApproach,
  }: {
    label: string;
    disposition: string | null;
    mission: Mission | undefined;
    card: SecondaryCard | undefined;
    game: PlayerGame;
    activeId: string | null;
    /** Every card id out of the deck for this side (hand + scored + discarded). */
    excluded: string[];
    /** Manually discarded (unscored) card ids — restorable. */
    discards: string[];
    round: number;
    /** Primary VP still scorable this round, after the round and per-game caps. */
    effectiveRoundCap: number;
    ownTotal: number;
    oppTotal: number;
    onDraw: () => void;
    onAdd: (id: string) => void;
    onSelect: (id: string) => void;
    onDiscard: (id: string) => void;
    onRestore: (id: string) => void;
    onScore: (asserted: AssertedAward[]) => void;
    onRemoveScore: (index: number) => void;
    onPrimaryScore: (asserted: AssertedAward[]) => void;
    onClearPrimary: () => void;
    onApproach: (mode: ScoringMode) => void;
  } = $props();

  const hand = $derived(secondariesByIds(game.handIds));
  const activeCard = $derived(activeId ? secondariesByIds([activeId])[0] : undefined);
  // Drawable/addable pool: anything that has never left the deck on this side.
  const available = $derived(SECONDARY_DECK.filter((c) => !excluded.includes(c.id)));
  const discardCards = $derived(secondariesByIds(discards));
  const diff = $derived(ownTotal - oppTotal);
  const diffLabel = $derived(
    diff === 0 ? "Level" : `${diff > 0 ? "+" : ""}${diff} vs opponent`,
  );

  // Secondary scoring inputs for the active card (filtered by approach).
  const secondaryAwards = $derived(activeCard ? awardsForApproach(activeCard, game.approach) : []);
  const secondaryCap = $derived(activeCard ? scoreCap(activeCard, game.approach) : 0);
  // Primary scoring inputs for the mission's primary card (no `mode`, so all show).
  const primaryAwards = $derived(card ? awardsForApproach(card, game.approach) : []);
  const currentPrimary = $derived(game.rounds[round - 1]?.primary ?? 0);
  const capLabel = (c: number): string => (c === Infinity ? "∞" : String(c));
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
            class="focus-ring font-heading text-[10px] font-bold uppercase tracking-wide rounded border px-2 py-2 lg:py-0.5 transition-colors {game.approach ===
            m
              ? 'bg-accent text-accent-foreground border-accent'
              : 'bg-panel text-text-muted border-border-strong hover:border-accent hover:text-accent'}"
            aria-pressed={game.approach === m}
            onclick={() => onApproach(m)}>{m}</button
          >
        {/each}
      </div>
    </div>
  </header>

  <!-- Per-round WTC grid (read-only; primary is scored via the panel below). -->
  <WtcGrid rounds={game.rounds} current={round} />

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
      {#if mission && card && primaryAwards.length > 0}
        <!-- Score this round's primary by ticking the awards achieved; the
             commit writes the current round's cell, capped at the round/game cap. -->
        {#key `${mission.id}:${round}`}
          <ScoringPanel
            title={mission.name}
            text={card.text}
            awards={primaryAwards}
            cap={effectiveRoundCap}
            capLabel={capLabel(effectiveRoundCap)}
            commitLabel={(vp) => `Score ${vp} VP → Round ${round}`}
            emptyHint="No primary scoring for this mission."
            onCommit={onPrimaryScore}
            extraAction={{ label: "Clear round", disabled: currentPrimary === 0, onClick: onClearPrimary }}
          />
        {/key}
      {:else if mission}
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
    discards={discardCards}
    canDraw={excluded.length < SECONDARY_DECK.length}
    {onDraw}
    {onAdd}
    {onSelect}
    {onDiscard}
    {onRestore}
  />
  <div class="rounded border border-panel-border bg-panel-surface p-3">
    {#key activeCard?.id}
      {#if activeCard}
        <ScoringPanel
          title={activeCard.name}
          text={activeCard.text}
          awards={secondaryAwards}
          cap={secondaryCap}
          capLabel={capLabel(secondaryCap)}
          commitLabel={(vp) => `Score ${vp} VP & discard`}
          emptyHint="Draw a secondary and tap it to score it here."
          onCommit={onScore}
        />
      {:else}
        <div class="text-text-muted text-sm">Draw a secondary and tap it to score it here.</div>
      {/if}
    {/key}
  </div>
</section>
