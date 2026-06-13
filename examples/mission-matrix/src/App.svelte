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
  import { onMount, untrack } from "svelte";
  import PlayerColumn from "./lib/PlayerColumn.svelte";
  import Scoreboard from "./lib/Scoreboard.svelte";
  import MissionCard from "./lib/MissionCard.svelte";
  import TerrainSection from "./lib/TerrainSection.svelte";
  import Toast from "./lib/Toast.svelte";
  import PwaInstallPrompt from "../../_shared/PwaInstallPrompt.svelte";
  import TutorialModal from "./lib/TutorialModal.svelte";
  import SupportModal from "../../_shared/SupportModal.svelte";
  import AppHeader from "../../_shared/AppHeader.svelte";
  import AppFooter from "../../_shared/AppFooter.svelte";
  import { LAYOUT_EDITOR_URL, PATREON_URL, SALVO_URL } from "../../_shared/links.js";
  import { slide } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  // Cloud saves + live shared sessions (patron-gated), reusing the shared
  // backbone the list-builder and teams-planner examples already ride.
  import AccountChip from "../../_shared/AccountChip.svelte";
  import CloudSavesPane from "../../_shared/CloudSavesPane.svelte";
  import EntitlementGate from "../../_shared/EntitlementGate.svelte";
  import ShareLinksModal from "../../_shared/ShareLinksModal.svelte";
  import LiveSessionWidget from "../../_shared/LiveSessionWidget.svelte";
  import Modal from "../../_shared/Modal.svelte";
  import LiveShareModal from "./lib/LiveShareModal.svelte";
  import { maybeCaptureEntitlement, storedEntitlement } from "../../_shared/entitlement.svelte";
  import {
    createDoc,
    putDoc,
    resolveLink,
    parseDocInvite,
    type DocMeta,
  } from "../../_shared/sync-api";
  import {
    docSession,
    goLive,
    joinDocSession,
    parseSessionInvite,
    registerDocSession,
    requestDocJoin,
    sendOps,
  } from "../../_shared/doc-session.svelte";
  import { applyDocOps } from "../../_shared/doc-protocol";
  import { STORAGE_KEY, autoSaveName, type Saved } from "./lib/save.js";
  import {
    savedToSessionDoc,
    sessionDocToSaved,
    fromCloudPayload,
    toSnapshotPayload,
    diffSessionDocs,
    isSessionShaped,
    type SessionDoc,
  } from "./lib/session-doc.js";

  const DEFAULT_ROUND_CAP = 15;
  const DEFAULT_GAME_CAP = 45;

  type Side = "you" | "opp";

  // Persisted match shape (`Saved`) + storage key now live in ./lib/save.ts so
  // the cloud/live-session adapter can share the type.
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

  // Command Points per side — a plain counter (see PlayerColumn), not enforced.
  let cpYou = $state<number>(saved.cpYou ?? 0);
  let cpOpp = $state<number>(saved.cpOpp ?? 0);

  // Cloud-save state. `cloudDocId` binds this game to one cloud doc so re-saves
  // overwrite it (rather than spawning a doc per round); `cloudName` is the
  // editable save name (null → use the auto-name); `cloudUpdatedAt` powers the
  // cross-device conflict prompt.
  let cloudDocId = $state<string | null>(saved.cloudDocId ?? null);
  let cloudName = $state<string | null>(saved.cloudName ?? null);
  let cloudUpdatedAt = $state<number | null>(null);
  let cloudOpen = $state<boolean>(false);
  let gateOpen = $state<boolean>(false);
  let cloudBusy = $state<boolean>(false);
  let nameField = $state<string>("");
  let cloudPane = $state<{ refresh: () => Promise<void> } | null>(null);
  // Per-doc live/snapshot share dialog.
  let shareTarget = $state<DocMeta | null>(null);
  let shareOpen = $state<boolean>(false);
  // The cloud doc the live session reuses across "Go live" clicks.
  let liveDocId = $state<string | null>(null);
  // Opponent-facing QR/link sheet (shown after Go live).
  let liveShareOpen = $state<boolean>(false);

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

  /** The whole match as the persisted/uploadable `Saved` blob. */
  function currentSaved(): Saved {
    return {
      dispYou, dispOpp, round, gameYou, gameOpp, activeYou, activeOpp, autoCollapse, verbose,
      discardsYou, discardsOpp, primaryTicksYou, primaryTicksOpp, keystoneFacing,
      cpYou, cpOpp, cloudDocId, cloudName,
    };
  }

  /**
   * Replace all match state from a loaded/received blob (cloud open, live
   * welcome/op, shortlink). Re-baselines `lastPrimaryId` so the mission-change
   * guard below treats the load as a fresh baseline instead of wiping the
   * primary scoring it just restored. Cloud-binding fields are intentionally
   * left to the caller (a live peer must not adopt our cloud doc id).
   */
  function adoptSaved(s: Saved): void {
    dispYou = s.dispYou ?? null;
    dispOpp = s.dispOpp ?? null;
    round = s.round ?? 1;
    gameYou = s.gameYou ?? emptyPlayerGame();
    gameOpp = s.gameOpp ?? emptyPlayerGame();
    activeYou = s.activeYou ?? null;
    activeOpp = s.activeOpp ?? null;
    discardsYou = s.discardsYou ?? [];
    discardsOpp = s.discardsOpp ?? [];
    primaryTicksYou = s.primaryTicksYou ?? {};
    primaryTicksOpp = s.primaryTicksOpp ?? {};
    cpYou = s.cpYou ?? 0;
    cpOpp = s.cpOpp ?? 0;
    keystoneFacing = s.keystoneFacing ?? true;
    autoCollapse = s.autoCollapse ?? true;
    verbose = s.verbose ?? false;
    matrixOpen = !(s.autoCollapse ?? true) || !(s.dispYou && s.dispOpp);
    lastPrimaryId.you = undefined;
    lastPrimaryId.opp = undefined;
  }

  $effect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSaved()));
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
    cpYou = 0;
    cpOpp = 0;
    round = 1;
    // A new match is a new cloud save — unbind so the next save creates a fresh
    // doc instead of overwriting the previous game.
    cloudDocId = null;
    cloudName = null;
    cloudUpdatedAt = null;
    notify("Game reset");
  }

  function cpChangeFor(s: Side, delta: number): void {
    if (s === "you") cpYou = Math.max(0, cpYou + delta);
    else cpOpp = Math.max(0, cpOpp + delta);
  }

  // ── Cloud saves + live sessions ──────────────────────────────────────────────

  // The intelligent default save name (matchup + missions + scoreline + date).
  const autoName = $derived(
    autoSaveName({
      dispYou,
      dispOpp,
      missionYouName: missionYou?.name ?? null,
      missionOppName: missionOpp?.name ?? null,
      totalYou,
      totalOpp,
      round,
      now: new Date(),
    }),
  );

  // Seed the editable name field each time the cloud modal opens: the saved
  // override if one exists, else the live auto-name. Reading `autoName` only
  // inside the open transition keeps it from re-seeding mid-edit.
  let cloudModalWasOpen = false;
  $effect(() => {
    if (cloudOpen && !cloudModalWasOpen) nameField = (cloudName ?? "").trim() || autoName;
    cloudModalWasOpen = cloudOpen;
  });

  // A refused create/goLive (no/lapsed entitlement) pops the gate.
  $effect(() => {
    if (docSession.entitlementRequired) gateOpen = true;
  });

  /** Save (or overwrite) the current game in the cloud, bound to `cloudDocId`. */
  async function saveToCloud(): Promise<void> {
    const token = storedEntitlement();
    if (!token) {
      gateOpen = true;
      return;
    }
    const name = nameField.trim() || autoName;
    const payload = savedToSessionDoc(currentSaved());
    cloudBusy = true;
    try {
      if (cloudDocId) {
        let res = await putDoc(token, cloudDocId, {
          name,
          payload,
          ifUpdatedAt: cloudUpdatedAt ?? undefined,
        });
        if (!res.ok && "conflict" in res) {
          const overwrite = confirm(
            `“${res.conflict.name}” changed in the cloud since this device last saved it ` +
              `(${new Date(res.conflict.updated_at).toLocaleString()}). Overwrite it?`,
          );
          if (!overwrite) return;
          res = await putDoc(token, cloudDocId, { name, payload });
        }
        if (res.ok) {
          cloudUpdatedAt = res.updated_at;
          cloudName = name;
          notify(`Updated “${name}” in the cloud.`);
        } else if ("error" in res && res.error === "doc_live") {
          notify("This game is live right now — changes save automatically.");
        } else if ("error" in res && res.status === 404) {
          // Deleted on another device — drop the stale binding and recreate.
          cloudDocId = null;
          cloudUpdatedAt = null;
          await saveToCloud();
          return;
        } else {
          notify("Cloud save failed.");
        }
      } else {
        const res = await createDoc(token, { kind: "mission-matrix", name, payload });
        if (res.ok) {
          cloudDocId = res.value.id;
          cloudUpdatedAt = res.value.updated_at;
          cloudName = name;
          notify(`Saved “${name}” to the cloud.`);
        } else if (res.error === "doc_quota_exceeded") {
          notify("Cloud is full — delete some saves first.");
        } else if (res.status === 401 || res.status === 403) {
          gateOpen = true;
        } else {
          notify("Cloud save failed.");
        }
      }
      await cloudPane?.refresh();
    } finally {
      cloudBusy = false;
    }
  }

  /** Make this game a live shared cloud doc and join it as editor. Reuses the
   *  bound cloud doc when there is one, so the live session and the saved game
   *  are the same document. */
  async function startLive(): Promise<void> {
    const name = (cloudName ?? "").trim() || autoName;
    const id = await goLive("mission-matrix", name, savedToSessionDoc(currentSaved()), {
      docId: liveDocId ?? cloudDocId,
    });
    if (id) {
      liveDocId = id;
      cloudDocId = id;
      // Hand the phone across the table: show the opponent the QR right away.
      cloudOpen = false;
      liveShareOpen = true;
    }
  }

  /** ShareLinksModal's "Open live": join the doc's room as editor. */
  function openLive(docId: string, editorToken: string): void {
    liveDocId = docId;
    requestDocJoin(docId, editorToken);
  }

  // Live replication: the match rides as a side-keyed SessionDoc. `lastSessionDoc`
  // is the last state this client knows the server holds; local edits diff
  // against it, remote ops/welcomes replace it then adopt into the UI. Adopting
  // re-bases `lastSessionDoc` first, so the push effect sees an empty diff and
  // nothing echoes.
  let lastSessionDoc: SessionDoc | null = null;

  registerDocSession({
    onDoc(doc) {
      if (isSessionShaped(doc)) {
        lastSessionDoc = doc;
      } else {
        // A storage-shaped doc (uploaded snapshot opened live): bridge it to the
        // side-keyed session shape. An editor replaces the room's doc so the
        // session proper runs side-keyed; viewers just convert locally.
        lastSessionDoc = savedToSessionDoc(fromCloudPayload(doc) as Saved);
        if (docSession.role === "editor") {
          sendOps([{ o: "set", p: [], v: lastSessionDoc }]);
        }
      }
      adoptSaved(sessionDocToSaved(lastSessionDoc));
    },
    onRemoteOps(ops) {
      if (!lastSessionDoc) return;
      try {
        lastSessionDoc = applyDocOps(lastSessionDoc, ops) as SessionDoc;
      } catch {
        // Divergence — the next reconnect's welcome restores exact state.
        return;
      }
      adoptSaved(sessionDocToSaved(lastSessionDoc));
    },
  });

  // Push local edits while live (editors only). When the change came from the
  // session itself the diff is empty, so this is a no-op.
  $effect(() => {
    const next = savedToSessionDoc(currentSaved());
    if (docSession.status !== "connected" || docSession.role !== "editor" || !lastSessionDoc) {
      return;
    }
    const ops = diffSessionDocs(lastSessionDoc, next);
    if (ops.length > 0) {
      lastSessionDoc = next;
      sendOps(ops);
    }
  });

  onMount(() => {
    // The OAuth callback may have delivered an entitlement token in the URL
    // fragment — capture it before any gated UI reads the stored state.
    maybeCaptureEntitlement();

    // Join a live cloud doc from a durable link (?d=<docId>&token=…).
    const docInvite = parseDocInvite(location.search);
    if (docInvite) requestDocJoin(docInvite.docId, docInvite.token);

    // Legacy ephemeral invite links (?session=CODE&token=…).
    const invite = parseSessionInvite(location.search);
    if (invite && !docInvite) joinDocSession(invite.code, invite.token, "guest");

    // Open a `?s=CODE` snapshot shortlink (server-resolved; opening is free).
    const code = new URLSearchParams(location.search).get("s");
    if (code) {
      void resolveLink(code).then((res) => {
        if (res.ok && res.value.kind === "mission-matrix") {
          adoptSaved(fromCloudPayload(res.value.payload) as Saved);
          notify("Opened shared game.");
        } else {
          notify(res.ok ? "That link isn't a Mission Matrix game." : "That short link couldn't be opened.");
        }
      });
      const params = new URLSearchParams(location.search);
      params.delete("s");
      const qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
    }
  });
</script>

<div class="flex flex-col min-h-screen bg-bg">
  <AppHeader title="Mission Matrix" tag="11e WTC scoresheet">
    {#snippet nav()}
      <div class="flex items-center gap-2">
        <AccountChip onSignIn={() => (gateOpen = true)} onOpenCloud={() => (cloudOpen = true)} />
        <button type="button" class="inline-flex items-center justify-center w-6 h-6 rounded-full border border-border-strong text-text-muted hover:text-accent hover:border-accent font-heading text-xs font-bold" onclick={() => (tutorialOpen = true)} aria-label="How to use Mission Matrix">?</button>
      </div>
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
        cp={cpYou}
        onCpChange={(d) => cpChangeFor("you", d)}
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
        cp={cpOpp}
        onCpChange={(d) => cpChangeFor("opp", d)}
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
  <PwaInstallPrompt
    appName="Mission Matrix"
    storageKey="mission-matrix.pwa-install-prompt.version"
    bind:open={pwaPromptOpen}
    suppressed={tutorialOpen}
  />
  <SupportModal patreonUrl={PATREON_URL} appName="Mission Matrix" enabled={!pwaPromptOpen && !tutorialOpen} />

  <!-- Cloud saves live behind the header chip (patron feature; opening links is
       free). Saving is bound to one doc per game (overwrite on re-save); the
       pane below lists/opens/deletes/shares every saved game. -->
  <Modal bind:open={cloudOpen} title="Cloud saves">
    <div class="flex flex-col gap-2">
      <label class="font-heading text-[10px] font-bold uppercase tracking-wider text-text-muted" for="cloud-name">
        Save name
      </label>
      <input
        id="cloud-name"
        class="min-h-11 w-full rounded border border-border-strong bg-panel px-3 py-2 font-body text-sm text-text placeholder:text-text-dim focus-ring"
        bind:value={nameField}
        placeholder={autoName}
        aria-label="Cloud save name"
      />
      <div class="flex gap-2">
        <button
          type="button"
          class="focus-ring min-h-11 flex-1 rounded bg-accent px-3 py-2 font-heading text-xs font-bold uppercase tracking-wide text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-40"
          disabled={cloudBusy}
          onclick={saveToCloud}
        >
          ↑ {cloudDocId ? "Update cloud save" : "Save to cloud"}
        </button>
        {#if docSession.status === "idle"}
          <button
            type="button"
            class="focus-ring min-h-11 rounded border border-border-strong bg-panel px-3 py-2 font-heading text-xs font-bold uppercase tracking-wide text-text-muted transition-colors hover:border-accent hover:text-accent"
            onclick={startLive}
            title="Share a live link — score this game together with your opponent in real time"
          >
            ⦿ Go live
          </button>
        {:else}
          <button
            type="button"
            class="focus-ring min-h-11 rounded border border-border-strong bg-panel px-3 py-2 font-heading text-xs font-bold uppercase tracking-wide text-text-muted transition-colors hover:border-accent hover:text-accent"
            onclick={() => {
              cloudOpen = false;
              liveShareOpen = true;
            }}
            title="Show the QR code to share this live game with your opponent"
          >
            ▦ Share QR
          </button>
        {/if}
      </div>
    </div>

    <div class="mt-3">
      <CloudSavesPane
        bind:this={cloudPane}
        kind="mission-matrix"
        localItems={[]}
        onOpen={(name, payload, doc) => {
          cloudOpen = false;
          adoptSaved(fromCloudPayload(payload) as Saved);
          cloudDocId = doc?.id ?? null;
          cloudUpdatedAt = doc?.updatedAt ?? null;
          cloudName = name;
          notify(`Opened “${name}”.`);
        }}
        onShare={(doc) => {
          shareTarget = doc;
          shareOpen = true;
        }}
        onFlash={notify}
        onNeedEntitlement={() => (gateOpen = true)}
      />
    </div>
  </Modal>

  <ShareLinksModal
    bind:open={shareOpen}
    doc={shareTarget}
    exportPayload={toSnapshotPayload}
    onOpenLive={openLive}
    onFlash={notify}
  />

  <!-- Floating live-session presence: roster, nickname, links, snapshot fallback. -->
  <LiveSessionWidget onFlash={notify} />

  <!-- Opponent-facing QR + link for the live session. -->
  <LiveShareModal bind:open={liveShareOpen} onFlash={notify} />

  <EntitlementGate bind:open={gateOpen} feature="cloud sync and live sharing" />

  <Toast message={toast} onDismiss={() => (toast = null)} />
</div>
