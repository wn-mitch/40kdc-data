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
  } from "@alpaca-software/40kdc-data";
  import {
    DISPOSITIONS,
    DISPOSITION_LABELS,
    missionFor,
    scoringCardFor,
    drawSecondary,
    excludedIds,
    secondariesByIds,
  } from "./lib/data.js";
  import PlayerColumn from "./lib/PlayerColumn.svelte";
  import Scoreboard from "./lib/Scoreboard.svelte";
  import MissionCard from "./lib/MissionCard.svelte";
  import Toast from "./lib/Toast.svelte";
  import PwaInstallPrompt from "./lib/PwaInstallPrompt.svelte";
  import TutorialModal from "./lib/TutorialModal.svelte";
  import SupportModal from "../../_shared/SupportModal.svelte";
  import { slide } from "svelte/transition";
  import { quintOut } from "svelte/easing";

  const HOME_URL = "https://40kdc.alpacasoft.dev";
  const REPO_URL = "https://github.com/wn-mitch/40kdc-data";
  const PACKAGE_URL = "https://www.npmjs.com/package/@alpaca-software/40kdc-data";
  const PUBLISHER_URL = "https://alpacasoft.dev";
  const PATREON_URL = "https://www.patreon.com/c/AlpacaSoftware";
  // Base-aware path to the Alpaca mark (also the PWA/favicon icon).
  const ALPACA_ICON = `${import.meta.env.BASE_URL}favicon-32x32.png`;
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
  // Matrix display preferences (persisted). `autoCollapse` keeps today's behavior
  // of folding the matrix once both dispositions are picked; `verbose` expands the
  // selected disposition's row into full mission cards for comparison.
  let autoCollapse = $state<boolean>(saved.autoCollapse ?? true);
  let verbose = $state<boolean>(saved.verbose ?? false);
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
      discardsYou, discardsOpp,
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

  // Primary VP still scorable in the *current* round, after the per-round cap
  // and the remaining per-game primary room (other rounds' primary).
  const otherPrimary = (g: PlayerGame): number =>
    g.rounds.reduce((s, c, idx) => (idx === round - 1 ? s : s + c.primary), 0);
  const effCapYou = $derived(Math.max(0, Math.min(capYou, gameCapYou - otherPrimary(gameYou))));
  const effCapOpp = $derived(Math.max(0, Math.min(capOpp, gameCapOpp - otherPrimary(gameOpp))));

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
  function scorePrimaryFor(s: Side, asserted: AssertedAward[]): void {
    const roundCap = s === "you" ? capYou : capOpp;
    const gameCap = s === "you" ? gameCapYou : gameCapOpp;
    setGame(s, setPrimary(gameOf(s), round, scoreTurn(asserted), { roundCap, gameCap }));
  }
  function clearPrimaryFor(s: Side): void {
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
    round = 1;
    notify("Game reset");
  }
</script>

<div class="flex flex-col min-h-screen bg-bg">
  <header class="flex items-center justify-between gap-4 h-11 px-4 bg-surface border-b border-border shrink-0">
    <a class="flex items-baseline gap-3 no-underline text-inherit min-w-0" href={REPO_URL} target="_blank" rel="noreferrer noopener">
      <h1 class="m-0 font-heading text-lg font-extrabold uppercase tracking-wider leading-none text-accent">
        Mission Matrix
      </h1>
      <span class="hidden sm:inline truncate font-heading text-xs uppercase tracking-wide text-text-muted">
        11e WTC scoresheet
      </span>
    </a>
    <nav class="flex items-center gap-3 shrink-0">
      <button type="button" class="inline-flex items-center justify-center w-6 h-6 rounded-full border border-border-strong text-text-muted hover:text-accent hover:border-accent font-heading text-xs font-bold" onclick={() => (tutorialOpen = true)} aria-label="How to use Mission Matrix">?</button>
      <a class="font-heading text-[11px] font-bold uppercase tracking-wide text-text-muted hover:text-accent no-underline whitespace-nowrap" href={HOME_URL} aria-label="Back to 40kdc-data examples">← 40kdc-data</a>
      <a class="inline-flex items-center text-text-muted hover:text-accent" href={REPO_URL} target="_blank" rel="noreferrer noopener" aria-label="GitHub repository">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
        </svg>
      </a>
      <a class="hidden md:inline text-text-muted hover:text-accent no-underline" href={PACKAGE_URL} target="_blank" rel="noreferrer noopener">
        <code class="font-mono text-[11px]">@alpaca-software/40kdc-data</code>
      </a>
    </nav>
  </header>

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
              <div class="relative rounded border bg-panel text-text {expanded ? 'flex flex-col text-left px-2 pt-5 pb-2 text-xs leading-tight' : 'flex items-center justify-center text-center min-h-14 px-2 pt-3 pb-2 text-xs leading-tight'} {state === 'your' ? 'border-accent bg-accent-dim shadow-[0_0_0_2px_var(--color-accent)]' : state === 'opp' ? 'border-accent bg-accent-dim opacity-45' : 'border-border'}">
                {#if state}<span class="absolute top-1 left-1.5 font-heading text-[9px] font-bold uppercase tracking-wide {state === 'your' ? 'text-text' : 'text-accent'}">{state === "your" ? (isMirror ? "YOU·OPP" : "YOU") : "OPP"}</span>{/if}
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
        onRestore={(id) => restoreFor("you", id)}
        onScore={(a) => scoreFor("you", a)}
        onRemoveScore={(i) => removeScoreFor("you", i)}
        onPrimaryScore={(a) => scorePrimaryFor("you", a)}
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
        onRestore={(id) => restoreFor("opp", id)}
        onScore={(a) => scoreFor("opp", a)}
        onRemoveScore={(i) => removeScoreFor("opp", i)}
        onPrimaryScore={(a) => scorePrimaryFor("opp", a)}
        onClearPrimary={() => clearPrimaryFor("opp")}
        onApproach={(m) => approachFor("opp", m)}
      />
      </div>
    </div>
  </main>

  <footer class="flex items-center gap-2 px-4 py-2 mt-auto bg-surface border-t border-border text-[11px] text-text-dim shrink-0">
    <a class="text-text-muted hover:text-accent no-underline" href={REPO_URL} target="_blank" rel="noreferrer noopener">github.com/wn-mitch/40kdc-data</a>
    <span aria-hidden="true">·</span>
    <span class="inline-flex items-center gap-1.5">
      <img src={ALPACA_ICON} alt="" width="16" height="16" class="rounded-[3px]" aria-hidden="true" />
      powered by <a class="text-text-muted hover:text-accent no-underline" href={PACKAGE_URL} target="_blank" rel="noreferrer noopener"><code class="font-mono">@alpaca-software/40kdc-data</code></a>
    </span>
    <span aria-hidden="true">·</span>
    <a class="text-text-muted hover:text-accent no-underline" href={PUBLISHER_URL} target="_blank" rel="noreferrer noopener">alpacasoft.dev</a>
    <span aria-hidden="true">·</span>
    <a class="text-text-muted hover:text-accent no-underline" href={PATREON_URL} target="_blank" rel="noreferrer noopener">Support on Patreon</a>
  </footer>

  <TutorialModal bind:open={tutorialOpen} />
  <PwaInstallPrompt bind:open={pwaPromptOpen} suppressed={tutorialOpen} />
  <SupportModal patreonUrl={PATREON_URL} appName="Mission Matrix" enabled={!pwaPromptOpen && !tutorialOpen} />
  <Toast message={toast} onDismiss={() => (toast = null)} />
</div>
