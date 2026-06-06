<script lang="ts">
  import type {
    ForceDispositionId,
    PlayerGame,
    ScoringMode,
    AssertedAward,
  } from "@alpaca-software/40kdc-data";
  import {
    emptyPlayerGame,
    addToHand,
    removeFromHand,
    scoreSecondary,
    removeScore,
    setPrimary,
    scoreSecondaryEvent,
    scoreTurn,
    playerTotal,
    awardsForApproach,
  } from "@alpaca-software/40kdc-data";
  import {
    DISPOSITIONS,
    DISPOSITION_LABELS,
    missionFor,
    scoringCardFor,
    drawSecondary,
    excludedIds,
    layoutsForMatchup,
    layoutAvailability,
    secondariesByIds,
    assertedFromTicks,
    emptyTicks,
    type PrimaryTicks,
    type PrimaryTicksByRound,
  } from "./lib/data.js";
  import { untrack } from "svelte";
  import PlayerColumn from "./lib/PlayerColumn.svelte";
  import Scoreboard from "./lib/Scoreboard.svelte";
  import MissionCard from "./lib/MissionCard.svelte";
  import TerrainSection from "./lib/TerrainSection.svelte";
  import Toast from "./lib/Toast.svelte";
  import PwaInstallPrompt from "./lib/PwaInstallPrompt.svelte";
  import TutorialModal from "./lib/TutorialModal.svelte";
  import SupportModal from "../../_shared/SupportModal.svelte";
  import AppHeader from "../../_shared/AppHeader.svelte";
  import AppFooter from "../../_shared/AppFooter.svelte";
  import { LAYOUT_EDITOR_URL, PATREON_URL, SALVO_URL } from "../../_shared/links.js";
  import { slide } from "svelte/transition";
  import { quintOut } from "svelte/easing";

  const DEFAULT_ROUND_CAP = 15;
  const DEFAULT_GAME_CAP = 45;

  type Side = "you" | "opp";

  // Persisted match — v2 (the v1 single-player blob is intentionally ignored).
  const STORAGE_KEY = "mission-matrix.play-aid.v3";
  interface Saved {
    dispYou: ForceDispositionId | null;
    dispOpp: ForceDispositionId | null;
    round: number;
    gameYou: PlayerGame;
    gameOpp: PlayerGame;
    activeYou: string | null;
    activeOpp: string | null;
    autoCollapse?: boolean;
    verbose?: boolean;
    // Manual (unscored) discards, per side. Optional so pre-existing v3 blobs
    // load unchanged. Scored discards live in each game's `log` already.
    discardsYou?: string[];
    discardsOpp?: string[];
    // Persistent per-round primary award ticks, per side. Optional like the
    // discards. A pre-existing blob loads with no ticks but keeps its stored
    // round primaries (the grid stays authoritative; re-tick to edit a round).
    primaryTicksYou?: PrimaryTicksByRound;
    primaryTicksOpp?: PrimaryTicksByRound;
    // Terrain card: rotate keystone labels to face each player. Optional so
    // pre-existing blobs load unchanged (defaults ON — it's a table aid).
    keystoneFacing?: boolean;
  }
  function load(): Partial<Saved> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Saved;
    } catch {
      /* ignore corrupt/absent storage */
    }
    return {};
  }
  const saved = load();

  let dispYou = $state<ForceDispositionId | null>(saved.dispYou ?? null);
  let dispOpp = $state<ForceDispositionId | null>(saved.dispOpp ?? null);
  let round = $state<number>(saved.round ?? 1);
  let gameYou = $state<PlayerGame>(saved.gameYou ?? emptyPlayerGame());
  let gameOpp = $state<PlayerGame>(saved.gameOpp ?? emptyPlayerGame());
  let activeYou = $state<string | null>(saved.activeYou ?? null);
  let activeOpp = $state<string | null>(saved.activeOpp ?? null);
  let discardsYou = $state<string[]>(saved.discardsYou ?? []);
  let discardsOpp = $state<string[]>(saved.discardsOpp ?? []);
  let primaryTicksYou = $state<PrimaryTicksByRound>(saved.primaryTicksYou ?? {});
  let primaryTicksOpp = $state<PrimaryTicksByRound>(saved.primaryTicksOpp ?? {});
  // Matrix display preferences (persisted). `autoCollapse` keeps today's behavior
  // of folding the matrix once both dispositions are picked; `verbose` expands the
  // selected disposition's row into full mission cards for comparison.
  let autoCollapse = $state<boolean>(saved.autoCollapse ?? true);
  let verbose = $state<boolean>(saved.verbose ?? false);
  let keystoneFacing = $state<boolean>(saved.keystoneFacing ?? true);
  let matrixOpen = $state<boolean>(!(saved.autoCollapse ?? true) || !(saved.dispYou && saved.dispOpp));

  // When the PWA install prompt or first-run tutorial is showing, hold back the
  // support modal so the popups never stack.
  let pwaPromptOpen = $state<boolean>(false);
  let tutorialOpen = $state<boolean>(false);

  // One-line action feedback (e.g. "Game reset"); Toast self-dismisses.
  let toast = $state<string | null>(null);
  function notify(message: string): void {
    toast = message;
  }

  // Which PlayerColumn shows below lg (mobile shows one at a time). Ephemeral:
  // not worth persisting across reloads. Columns are CSS-hidden, never
  // unmounted, so in-progress award ticks survive switching sides.
  let activeSide = $state<Side>("you");

  $effect(() => {
    const blob: Saved = {
      dispYou, dispOpp, round, gameYou, gameOpp, activeYou, activeOpp, autoCollapse, verbose,
      discardsYou, discardsOpp, primaryTicksYou, primaryTicksOpp, keystoneFacing,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
    } catch {
      /* non-fatal */
    }
  });

  const ready = $derived(dispYou !== null && dispOpp !== null);
  const isMirror = $derived(dispYou !== null && dispYou === dispOpp);
  const missionYou = $derived(ready ? missionFor(dispYou!, dispOpp!) : undefined);
  const missionOpp = $derived(ready ? missionFor(dispOpp!, dispYou!) : undefined);
  const cardYou = $derived(missionYou ? scoringCardFor(missionYou.id) : undefined);
  const cardOpp = $derived(missionOpp ? scoringCardFor(missionOpp.id) : undefined);
  const capYou = $derived(missionYou?.vp_per_round_cap ?? DEFAULT_ROUND_CAP);
  const capOpp = $derived(missionOpp?.vp_per_round_cap ?? DEFAULT_ROUND_CAP);
  const gameCapYou = $derived(missionYou?.vp_per_game_cap ?? DEFAULT_GAME_CAP);
  const gameCapOpp = $derived(missionOpp?.vp_per_game_cap ?? DEFAULT_GAME_CAP);
  const totalYou = $derived(playerTotal(gameYou));
  const totalOpp = $derived(playerTotal(gameOpp));
  // The matchup's terrain layout cards (variant-ordered; empty until both picked).
  const matchupLayouts = $derived(ready ? layoutsForMatchup(dispYou!, dispOpp!) : []);

  // Primary VP still scorable in the *current* round, after the per-round cap
  // and the remaining per-game primary room (other rounds' primary).
  const otherPrimary = (g: PlayerGame): number =>
    g.rounds.reduce((s, c, idx) => (idx === round - 1 ? s : s + c.primary), 0);
  const effCapYou = $derived(Math.max(0, Math.min(capYou, gameCapYou - otherPrimary(gameYou))));
  const effCapOpp = $derived(Math.max(0, Math.min(capOpp, gameCapOpp - otherPrimary(gameOpp))));

  // Changing a disposition mid-game swaps a side's primary card, so its stored
  // award-index ticks (and the primaries derived from them) describe the wrong
  // card — wipe both for that side. Tracked against the last *defined* mission
  // id, baselined on the effect's first run, so restoring a saved blob never
  // wipes, and toggling a disposition off and back to the same pick
  // (mission → undefined → same id) is harmless.
  const lastPrimaryId: Record<Side, string | null | undefined> = {
    you: undefined,
    opp: undefined,
  };
  $effect(() => {
    const ids: Record<Side, string | null> = {
      you: missionYou?.id ?? null,
      opp: missionOpp?.id ?? null,
    };
    // untrack: the wipe reads/writes game state the effect must not depend on.
    untrack(() => {
      for (const s of ["you", "opp"] as const) {
        const id = ids[s];
        if (lastPrimaryId[s] === undefined) {
          lastPrimaryId[s] = id; // first run — adopt the restored mission
          continue;
        }
        if (id === null) continue; // matrix mid-edit — keep everything
        if (lastPrimaryId[s] !== null && lastPrimaryId[s] !== id) {
          setPrimaryTicks(s, {});
          const g = gameOf(s);
          setGame(s, { ...g, rounds: g.rounds.map((c) => ({ ...c, primary: 0 })) });
          notify("Mission changed — primary scoring reset");
        }
        lastPrimaryId[s] = id;
      }
    });
  });

  // --- side-bound state access (keeps the two columns DRY) ---
  const gameOf = (s: Side): PlayerGame => (s === "you" ? gameYou : gameOpp);
  function setGame(s: Side, g: PlayerGame): void {
    if (s === "you") gameYou = g;
    else gameOpp = g;
  }
  const activeOf = (s: Side): string | null => (s === "you" ? activeYou : activeOpp);
  function setActive(s: Side, id: string | null): void {
    if (s === "you") activeYou = id;
    else activeOpp = id;
  }
  const discardsOf = (s: Side): string[] => (s === "you" ? discardsYou : discardsOpp);
  function setDiscards(s: Side, ids: string[]): void {
    if (s === "you") discardsYou = ids;
    else discardsOpp = ids;
  }
  const primaryTicksOf = (s: Side): PrimaryTicksByRound =>
    s === "you" ? primaryTicksYou : primaryTicksOpp;
  function setPrimaryTicks(s: Side, t: PrimaryTicksByRound): void {
    if (s === "you") primaryTicksYou = t;
    else primaryTicksOpp = t;
  }

  // Cards out of the deck per side: in hand, scored (game.log), or manually
  // discarded. The single source of truth for the draw pool and "Add card…".
  const excludedYou = $derived(excludedIds(gameYou.handIds, gameYou.log, discardsYou));
  const excludedOpp = $derived(excludedIds(gameOpp.handIds, gameOpp.log, discardsOpp));
  const excludedOf = (s: Side): string[] => (s === "you" ? excludedYou : excludedOpp);

  function addCard(s: Side, cardId: string): void {
    const g = gameOf(s);
    setGame(s, addToHand(g, cardId));
    if (!activeOf(s)) setActive(s, cardId);
  }
  function drawFor(s: Side): void {
    const card = drawSecondary(excludedOf(s));
    if (card) addCard(s, card.id);
  }
  function discardFor(s: Side, id: string): void {
    const g = removeFromHand(gameOf(s), id);
    setGame(s, g);
    if (!discardsOf(s).includes(id)) setDiscards(s, [...discardsOf(s), id]);
    if (activeOf(s) === id) setActive(s, g.handIds[0] ?? null);
  }
  /** Shuffle a held card back into the deck: it leaves the hand without
   *  entering the discard pile, so `excludedIds` drops it and it can be
   *  drawn again — for cards not doable yet (round-restricted). */
  function returnToDeckFor(s: Side, id: string): void {
    const g = removeFromHand(gameOf(s), id);
    setGame(s, g);
    if (activeOf(s) === id) setActive(s, g.handIds[0] ?? null);
  }
  /** Undo a manual discard: the card leaves the pile and returns to hand. */
  function restoreFor(s: Side, id: string): void {
    setDiscards(s, discardsOf(s).filter((d) => d !== id));
    addCard(s, id);
  }
  function scoreFor(s: Side, asserted: AssertedAward[]): void {
    const id = activeOf(s);
    if (!id) return;
    const card = secondariesByIds([id])[0];
    if (!card) return;
    const g = gameOf(s);
    const vp = scoreSecondaryEvent(asserted, card, g.approach);
    const scored = scoreSecondary(g, round, card.id, vp);
    setGame(s, scored);
    setActive(s, scored.handIds[0] ?? null);
  }
  function removeScoreFor(s: Side, index: number): void {
    setGame(s, removeScore(gameOf(s), index));
  }
  /**
   * A primary tick changed: store the round's ticks and re-bank that round's
   * primary live. The *raw* round/game caps go to `setPrimary` — it subtracts
   * the other rounds' primary itself, so passing the pre-computed effective
   * cap would double-count them.
   */
  function primaryTicksChangeFor(s: Side, ticks: PrimaryTicks): void {
    setPrimaryTicks(s, { ...primaryTicksOf(s), [round]: ticks });
    const card = s === "you" ? cardYou : cardOpp;
    const awards = card ? awardsForApproach(card, gameOf(s).approach) : [];
    const vp = scoreTurn(assertedFromTicks(awards, ticks));
    const roundCap = s === "you" ? capYou : capOpp;
    const gameCap = s === "you" ? gameCapYou : gameCapOpp;
    setGame(s, setPrimary(gameOf(s), round, vp, { roundCap, gameCap }));
  }
  function clearPrimaryFor(s: Side): void {
    setPrimaryTicks(s, { ...primaryTicksOf(s), [round]: emptyTicks() });
    setGame(s, setPrimary(gameOf(s), round, 0));
  }
  function approachFor(s: Side, mode: ScoringMode): void {
    setGame(s, { ...gameOf(s), approach: mode });
  }

  function pickYou(d: ForceDispositionId): void {
    dispYou = dispYou === d ? null : d;
    if (autoCollapse && dispYou && dispOpp) matrixOpen = false;
  }
  function pickOpp(d: ForceDispositionId): void {
    dispOpp = dispOpp === d ? null : d;
    if (autoCollapse && dispYou && dispOpp) matrixOpen = false;
  }
  function cellState(row: ForceDispositionId, col: ForceDispositionId): "your" | "opp" | null {
    if (!ready) return null;
    if (row === dispYou && col === dispOpp) return "your";
    if (row === dispOpp && col === dispYou) return "opp";
    return null;
  }

  function resetGame(): void {
    gameYou = emptyPlayerGame(gameYou.approach);
    gameOpp = emptyPlayerGame(gameOpp.approach);
    activeYou = null;
    activeOpp = null;
    discardsYou = [];
    discardsOpp = [];
    primaryTicksYou = {};
    primaryTicksOpp = {};
    round = 1;
    notify("Game reset");
  }
</script>

<div class="flex flex-col min-h-screen bg-bg">
  <AppHeader title="Mission Matrix" tag="11e WTC scoresheet">
    {#snippet nav()}
      <button type="button" class="inline-flex items-center justify-center w-6 h-6 rounded-full border border-border-strong text-text-muted hover:text-accent hover:border-accent font-heading text-xs font-bold" onclick={() => (tutorialOpen = true)} aria-label="How to use Mission Matrix">?</button>
    {/snippet}
  </AppHeader>

  <main class="flex-1 w-full max-w-[1200px] mx-auto px-4 py-5 flex flex-col gap-5">
    <!-- Collapsible disposition matrix → both primaries. -->
    <div class="rounded border border-border bg-surface">
      <div class="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          class="flex-1 min-w-0 text-left cursor-pointer flex items-center gap-2 font-heading text-[11px] font-bold uppercase tracking-wider text-text-muted hover:text-accent"
          aria-expanded={matrixOpen}
          onclick={() => (matrixOpen = !matrixOpen)}
        >
          <span class="inline-block transition-transform duration-200 {matrixOpen ? 'rotate-90' : ''}">▶</span>
          Force Disposition
          {#if ready}
            <span class="truncate text-text-dim font-normal normal-case tracking-normal">
              — You: {DISPOSITION_LABELS[dispYou!]} vs Opp: {DISPOSITION_LABELS[dispOpp!]}
            </span>
          {:else}
            <span class="truncate text-text-dim font-normal normal-case tracking-normal">— pick both to set primaries</span>
          {/if}
        </button>
        <button
          type="button"
          class="focus-ring shrink-0 font-heading text-[10px] font-bold uppercase tracking-wide rounded border px-2 py-1 transition-colors {!autoCollapse ? 'bg-accent text-accent-foreground border-accent' : 'bg-panel text-text-muted border-border-strong hover:border-accent hover:text-accent'}"
          aria-pressed={!autoCollapse}
          title="Keep the matrix open instead of collapsing it once both dispositions are picked"
          onclick={() => (autoCollapse = !autoCollapse)}
        >Keep open</button>
        <button
          type="button"
          class="focus-ring shrink-0 font-heading text-[10px] font-bold uppercase tracking-wide rounded border px-2 py-1 transition-colors {verbose ? 'bg-accent text-accent-foreground border-accent' : 'bg-panel text-text-muted border-border-strong hover:border-accent hover:text-accent'}"
          aria-pressed={verbose}
          title="Expand your selected disposition's row into full mission cards for comparison"
          onclick={() => (verbose = !verbose)}
        >Verbose</button>
      </div>

      {#if matrixOpen}
        <div class="px-3 pb-3" transition:slide={{ duration: 220, easing: quintOut }}>
        <div class="hidden sm:grid gap-1" style="grid-template-columns: minmax(120px, 0.9fr) repeat({DISPOSITIONS.length}, minmax(0, 1fr))" role="grid" aria-label="Force Disposition matchup matrix">
          <div class="flex flex-col justify-between p-2 font-heading text-[11px] uppercase tracking-wide text-text-dim">
            <span>You ▼</span><span class="self-end">Opp ▶</span>
          </div>
          {#each DISPOSITIONS as col (col)}
            <button type="button" class="focus-ring flex items-end justify-center text-center font-heading text-[11px] font-bold uppercase tracking-wider rounded border px-1 py-2 transition-colors {dispOpp === col ? 'bg-accent text-accent-foreground border-accent' : 'bg-panel text-text-muted border-border-strong hover:border-accent hover:text-accent'}" aria-pressed={dispOpp === col} onclick={() => pickOpp(col)}>
              {DISPOSITION_LABELS[col]}
            </button>
          {/each}
          {#each DISPOSITIONS as row (row)}
            <button type="button" class="focus-ring flex items-center text-left font-heading text-[11px] font-bold uppercase tracking-wider rounded border px-2 py-1 transition-colors {dispYou === row ? 'bg-accent text-accent-foreground border-accent' : 'bg-panel text-text-muted border-border-strong hover:border-accent hover:text-accent'}" aria-pressed={dispYou === row} onclick={() => pickYou(row)}>
              {DISPOSITION_LABELS[row]}
            </button>
            {#each DISPOSITIONS as col (col)}
              {@const m = missionFor(row, col)}
              {@const state = cellState(row, col)}
              {@const expanded = verbose && row === dispYou}
              {@const avail = layoutAvailability(row, col)}
              <div class="relative rounded border bg-panel text-text {expanded ? 'flex flex-col text-left px-2 pt-5 pb-2 text-xs leading-tight' : 'flex items-center justify-center text-center min-h-14 px-2 pt-3 pb-2 text-xs leading-tight'} {state === 'your' ? 'border-accent bg-accent-dim shadow-[0_0_0_2px_var(--color-accent)]' : state === 'opp' ? 'border-accent bg-accent-dim opacity-45' : 'border-border'}">
                {#if state}<span class="absolute top-1 left-1.5 font-heading text-[9px] font-bold uppercase tracking-wide {state === 'your' ? 'text-text' : 'text-accent'}">{state === "your" ? (isMirror ? "YOU·OPP" : "YOU") : "OPP"}</span>{/if}
                <!-- Terrain-layout coverage for this pairing: one dot per authored variant. -->
                <span class="absolute bottom-1 right-1.5 flex gap-0.5" role="img" aria-label="{avail} of 3 terrain layouts authored" title="{avail} of 3 terrain layouts">
                  {#each [1, 2, 3] as v (v)}
                    <span class="w-1 h-1 rounded-full {v <= avail ? 'bg-accent' : 'bg-border-strong'}"></span>
                  {/each}
                </span>
                {#if expanded}
                  <MissionCard mission={m} card={m ? scoringCardFor(m.id) : undefined} />
                {:else}
                  <span class:text-text={state === "your"}>{m?.name ?? "—"}</span>
                {/if}
              </div>
            {/each}
          {/each}
        </div>

        <div class="sm:hidden flex flex-col gap-4" role="group" aria-label="Pick dispositions">
          {#each [{ label: "You", cur: dispYou, pick: pickYou }, { label: "Opponent", cur: dispOpp, pick: pickOpp }] as group (group.label)}
            <div>
              <span class="block mb-2 font-heading text-[11px] font-bold uppercase tracking-wider text-text-muted">{group.label}</span>
              <div class="flex flex-wrap gap-2">
                {#each DISPOSITIONS as d (d)}
                  <button type="button" class="focus-ring min-h-11 font-heading text-[11px] font-bold uppercase tracking-wide rounded border px-3 py-2 transition-colors {group.cur === d ? 'bg-accent text-accent-foreground border-accent' : 'bg-panel text-text-muted border-border-strong hover:border-accent hover:text-accent'}" aria-pressed={group.cur === d} onclick={() => group.pick(d)}>
                    {DISPOSITION_LABELS[d]}
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>

        {#if verbose && dispYou}
          <div class="sm:hidden mt-4 flex flex-col gap-3" aria-label="Missions for {DISPOSITION_LABELS[dispYou]}">
            <span class="font-heading text-[11px] font-bold uppercase tracking-wider text-text-muted">
              {DISPOSITION_LABELS[dispYou]} vs each opponent
            </span>
            {#each DISPOSITIONS as col (col)}
              {@const m = missionFor(dispYou, col)}
              <div class="rounded border bg-panel px-3 py-2 {col === dispOpp ? 'border-accent bg-accent-dim shadow-[0_0_0_2px_var(--color-accent)]' : 'border-border'}">
                <span class="block mb-2 font-heading text-[10px] font-bold uppercase tracking-wide text-text-dim">
                  vs {DISPOSITION_LABELS[col]}{#if col === dispOpp} — current{/if}
                </span>
                <MissionCard mission={m} card={m ? scoringCardFor(m.id) : undefined} />
              </div>
            {/each}
          </div>
        {/if}
        </div>
      {/if}
    </div>

    <!-- Terrain layout cards for the picked matchup (setup step: see your
         table before scoring starts). -->
    {#if ready}
      <TerrainSection
        layouts={matchupLayouts}
        matchupLabel="{DISPOSITION_LABELS[dispYou!]} vs {DISPOSITION_LABELS[dispOpp!]}"
        bind:playerFacing={keystoneFacing}
      />
    {/if}

    <!-- Sticky WTC scoreboard: round, 20-point result, reset, and (mobile)
         the You/Opponent switcher. -->
    <Scoreboard
      {totalYou}
      {totalOpp}
      {round}
      onRound={(r) => (round = r)}
      onReset={resetGame}
      {activeSide}
      onSide={(s) => (activeSide = s)}
      dispYouLabel={dispYou ? DISPOSITION_LABELS[dispYou] : null}
      dispOppLabel={dispOpp ? DISPOSITION_LABELS[dispOpp] : null}
    />

    <!-- Two players: side by side on wide screens, one at a time (switcher
         above) on mobile. CSS-hidden, not {#if}: unmounting would drop
         ScoringPanel's in-progress ticks. -->
    <div class="grid gap-4 lg:grid-cols-2">
      <div class:hidden={activeSide !== "you"} class="lg:block min-w-0">
      <PlayerColumn
        label="You"
        disposition={dispYou ? DISPOSITION_LABELS[dispYou] : null}
        mission={missionYou}
        card={cardYou}
        game={gameYou}
        activeId={activeYou}
        excluded={excludedYou}
        discards={discardsYou}
        {round}
        effectiveRoundCap={effCapYou}
        ownTotal={totalYou}
        oppTotal={totalOpp}
        onDraw={() => drawFor("you")}
        onAdd={(id) => addCard("you", id)}
        onSelect={(id) => setActive("you", id)}
        onDiscard={(id) => discardFor("you", id)}
        onReturn={(id) => returnToDeckFor("you", id)}
        onRestore={(id) => restoreFor("you", id)}
        onScore={(a) => scoreFor("you", a)}
        onRemoveScore={(i) => removeScoreFor("you", i)}
        primaryTicks={primaryTicksYou[round]}
        onPrimaryTicksChange={(t) => primaryTicksChangeFor("you", t)}
        onClearPrimary={() => clearPrimaryFor("you")}
        onApproach={(m) => approachFor("you", m)}
      />
      </div>
      <div class:hidden={activeSide !== "opp"} class="lg:block min-w-0">
      <PlayerColumn
        label="Opponent"
        disposition={dispOpp ? DISPOSITION_LABELS[dispOpp] : null}
        mission={missionOpp}
        card={cardOpp}
        game={gameOpp}
        activeId={activeOpp}
        excluded={excludedOpp}
        discards={discardsOpp}
        {round}
        effectiveRoundCap={effCapOpp}
        ownTotal={totalOpp}
        oppTotal={totalYou}
        onDraw={() => drawFor("opp")}
        onAdd={(id) => addCard("opp", id)}
        onSelect={(id) => setActive("opp", id)}
        onDiscard={(id) => discardFor("opp", id)}
        onReturn={(id) => returnToDeckFor("opp", id)}
        onRestore={(id) => restoreFor("opp", id)}
        onScore={(a) => scoreFor("opp", a)}
        onRemoveScore={(i) => removeScoreFor("opp", i)}
        primaryTicks={primaryTicksOpp[round]}
        onPrimaryTicksChange={(t) => primaryTicksChangeFor("opp", t)}
        onClearPrimary={() => clearPrimaryFor("opp")}
        onApproach={(m) => approachFor("opp", m)}
      />
      </div>
    </div>
  </main>

  <AppFooter
    links={[
      { label: "Terrain layouts", href: LAYOUT_EDITOR_URL },
      { label: "Salvo", href: SALVO_URL },
    ]}
    version={__DATA_VERSION__}
    build={__BUILD_SHA__}
  />

  <TutorialModal bind:open={tutorialOpen} />
  <PwaInstallPrompt bind:open={pwaPromptOpen} suppressed={tutorialOpen} />
  <SupportModal patreonUrl={PATREON_URL} appName="Mission Matrix" enabled={!pwaPromptOpen && !tutorialOpen} />
  <Toast message={toast} onDismiss={() => (toast = null)} />
</div>
