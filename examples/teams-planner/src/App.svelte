<script lang="ts">
  import { onMount } from "svelte";
  import { teamCoverage, type Player, type TeamPlan } from "./lib/coverage";
  import { decodePlan, encodePlan, sanitizePlan } from "./lib/share-plan";
  import PlanView from "./lib/PlanView.svelte";
  import PairingsSimulator from "./lib/pairings/PairingsSimulator.svelte";
  import AppHeader from "../../_shared/AppHeader.svelte";
  import AppFooter from "../../_shared/AppFooter.svelte";
  import PwaInstallPrompt from "../../_shared/PwaInstallPrompt.svelte";
  import EntitlementGate from "../../_shared/EntitlementGate.svelte";
  import CloudSavesPane from "../../_shared/CloudSavesPane.svelte";
  import AccountChip from "../../_shared/AccountChip.svelte";
  import LiveSessionWidget from "../../_shared/LiveSessionWidget.svelte";
  import ShareLinksModal from "../../_shared/ShareLinksModal.svelte";
  import Modal from "../../_shared/Modal.svelte";
  import { maybeCaptureEntitlement } from "../../_shared/entitlement.svelte";
  import { parseDocInvite, resolveLink, type DocMeta } from "../../_shared/sync-api";
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
  import {
    diffSessionDocs,
    fromCloudPayload,
    isSessionShaped,
    planToSessionDoc,
    sessionDocToPlan,
    toSnapshotPayload,
    type SessionDoc,
  } from "./lib/session-doc";
  import {
    LIST_BUILDER_URL,
    MISSION_MATRIX_URL,
  } from "../../_shared/links.js";

  /**
   * Standalone disposition-coverage planner. State lives in localStorage so it
   * survives across sessions; a captain can also pack the whole plan into a
   * `#t=` URL fragment to share it (decoded client-side, no backend).
   */
  const STORAGE_KEY = "teams-planner.v2";
  // The pre-army model lived here; we still read it and migrate forward (then
  // resave under v2) so an upgrade never strands a saved plan.
  const LEGACY_STORAGE_KEY = "teams-planner.v1";

  function emptyPlan(): TeamPlan {
    return { teamName: "", size: 5, players: [] };
  }

  function loadPlan(): TeamPlan {
    try {
      const raw =
        localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return emptyPlan();
      const result = sanitizePlan(JSON.parse(raw));
      return result ? result.plan : emptyPlan();
    } catch {
      return emptyPlan();
    }
  }

  let plan = $state<TeamPlan>(loadPlan());
  /** Plan vs pairings-simulator tab, mirrored to `#sim` so a refresh sticks.
   *  Sim state itself is local to the simulator component (never synced). */
  let view = $state<"plan" | "sim">(location.hash === "#sim" ? "sim" : "plan");
  let toast = $state<string | null>(null);
  let pwaPromptOpen = $state<boolean>(false);
  let gateOpen = $state<boolean>(false);
  /** Header-chip cloud-saves modal. */
  let cloudOpen = $state<boolean>(false);
  /** Per-doc share dialog (live + snapshot links). */
  let shareTarget = $state<DocMeta | null>(null);
  let shareOpen = $state<boolean>(false);
  /** The cloud doc "Go live" reuses across clicks (created on first use). */
  let liveDocId = $state<string | null>(null);

  /** What the cloud pane can upload: the current plan, under its team name. */
  const cloudItems = $derived([
    { name: plan.teamName.trim() || "Team plan", payload: plan as unknown },
  ]);

  /** Every inbound payload — cloud load, shortlink, session welcome — passes
   *  through sanitizePlan, the same defensive gate the #t= path uses.
   *  fromCloudPayload first bridges session-shaped docs (live-edited saves
   *  are stored id-keyed) back to the plan shape. */
  function adoptPlan(payload: unknown, source: string): void {
    const result = sanitizePlan(fromCloudPayload(payload));
    if (result) {
      plan = result.plan;
      flash(`Opened ${source}.`);
    } else {
      flash(`That ${source} couldn't be opened.`);
    }
  }

  // ── Live shared session (patron-created, free to join) ─────────────────────
  // The plan replicates as an id-keyed SessionDoc; `lastSessionDoc` is the
  // last state this client knows the server has. Local edits diff against it
  // (id-disjoint set/del ops); remote ops/welcomes update it and replace the
  // local plan. The loop is self-stabilizing: after adopting remote state the
  // diff is empty, so nothing echoes.
  let lastSessionDoc: SessionDoc | null = null;

  registerDocSession({
    onDoc(doc) {
      if (isSessionShaped(doc)) {
        lastSessionDoc = doc;
      } else {
        // A storage-shaped doc (uploaded snapshot opened live): bridge it to
        // the id-keyed session shape. An editor replaces the room's doc so
        // the session proper runs id-keyed; the conversion is deterministic,
        // so two editors racing the replace is benign. Viewers (and the
        // read-only snapshot fallback) just convert locally.
        const sanitized = sanitizePlan(doc);
        lastSessionDoc = planToSessionDoc(sanitized ? sanitized.plan : emptyPlan());
        if (docSession.role === "editor") {
          sendOps([{ o: "set", p: [], v: lastSessionDoc }]);
        }
      }
      const result = sanitizePlan(sessionDocToPlan(lastSessionDoc));
      if (result) plan = result.plan;
    },
    onRemoteOps(ops) {
      if (!lastSessionDoc) return;
      try {
        lastSessionDoc = applyDocOps(lastSessionDoc, ops) as SessionDoc;
      } catch {
        // Divergence — the next reconnect's welcome restores exact state.
        return;
      }
      const result = sanitizePlan(sessionDocToPlan(lastSessionDoc));
      if (result) plan = result.plan;
    },
  });

  // Push local edits while live (editors only). Runs after every plan change;
  // when the change came from the session itself the diff is empty.
  $effect(() => {
    const next = planToSessionDoc(plan);
    if (docSession.status !== "connected" || docSession.role !== "editor" || !lastSessionDoc) {
      return;
    }
    const ops = diffSessionDocs(lastSessionDoc, next);
    if (ops.length > 0) {
      lastSessionDoc = next;
      sendOps(ops);
    }
  });

  // A refused create (no/lapsed entitlement) opens the gate.
  $effect(() => {
    if (docSession.entitlementRequired) gateOpen = true;
  });

  /** Make the plan a live shared cloud doc (Google-docs style) and join it.
   *  Seeds the doc with the session shape so the welcome needs no bridge. */
  async function startLive(): Promise<void> {
    const name = plan.teamName.trim() || "Team plan";
    const id = await goLive("team-plan", name, planToSessionDoc(plan), { docId: liveDocId });
    if (id) liveDocId = id;
  }

  /** ShareLinksModal's "Open live": join the doc's room as editor. */
  function openLive(docId: string, editorToken: string): void {
    liveDocId = docId;
    requestDocJoin(docId, editorToken);
  }

  const coverage = $derived(teamCoverage(plan));

  // Persist on every change. Quota/private-mode failures degrade to a toast
  // rather than throwing out of the reactive update.
  $effect(() => {
    const serialized = JSON.stringify(plan);
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      toast = "Couldn't save to local storage (quota or private mode).";
    }
  });

  // Open a shared plan from `#t=<token>`. Decoded client-side; the hash is then
  // cleared so a refresh or save can't re-trigger the import.
  onMount(() => {
    // The OAuth callback may have delivered an entitlement token in the same
    // fragment slot — capture it before any gated UI reads the stored state.
    maybeCaptureEntitlement();

    // Keep the tab in sync with back/forward navigation over `#sim`.
    window.addEventListener("hashchange", () => {
      view = location.hash === "#sim" ? "sim" : "plan";
    });

    const m = location.hash.match(/^#t=(.+)$/);
    if (m) {
      const result = decodePlan(m[1]);
      if (result) {
        plan = result.plan;
        if (result.dropped.length > 0) {
          flash(`Opened shared plan — dropped ${result.dropped.length} unknown id(s) from a different dataset.`);
        } else {
          flash("Opened shared plan.");
        }
      } else {
        flash("That share link couldn't be opened.");
      }
      history.replaceState(null, "", location.pathname + location.search);
    }

    // Join a live cloud doc from a durable link (?d=<docId>&token=…). The
    // params stay in the URL so a refresh rejoins; the widget prompts for a
    // nickname when none is remembered.
    const docInvite = parseDocInvite(location.search);
    if (docInvite) {
      requestDocJoin(docInvite.docId, docInvite.token);
    }

    // Legacy ephemeral invite links (?session=CODE&token=…) keep working.
    const invite = parseSessionInvite(location.search);
    if (invite && !docInvite) {
      joinDocSession(invite.code, invite.token, "guest");
    }

    // Open a `?s=CODE` shortlink (server-resolved; opening is free).
    const code = new URLSearchParams(location.search).get("s");
    if (code) {
      void resolveLink(code).then((res) => {
        if (res.ok && res.value.kind === "team-plan") {
          adoptPlan(res.value.payload, "shared plan");
        } else {
          flash(res.ok ? "That link isn't a team plan." : "That short link couldn't be opened.");
        }
      });
      const params = new URLSearchParams(location.search);
      params.delete("s");
      const qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
    }
  });

  function flash(msg: string) {
    toast = msg;
    setTimeout(() => {
      if (toast === msg) toast = null;
    }, 4000);
  }

  function addPlayer() {
    const id = crypto.randomUUID?.() ?? `p-${plan.players.length}-${Date.now()}`;
    const next: Player = { id, name: "", factionIds: [], armies: [], preferences: [], locked: {} };
    plan = { ...plan, players: [...plan.players, next] };
  }

  function updatePlayer(next: Player) {
    plan = { ...plan, players: plan.players.map((p) => (p.id === next.id ? next : p)) };
  }

  function removePlayer(id: string) {
    plan = { ...plan, players: plan.players.filter((p) => p.id !== id) };
  }

  async function copyShareLink() {
    const url = `${location.origin}${location.pathname}#t=${encodePlan(plan)}`;
    try {
      await navigator.clipboard.writeText(url);
      flash("Share link copied to clipboard.");
    } catch {
      // Clipboard blocked (e.g. insecure context) — drop it into the hash so it
      // can still be copied from the address bar.
      history.replaceState(null, "", url);
      flash("Couldn't reach the clipboard — link is in the address bar.");
    }
  }

  function resetPlan() {
    if (plan.players.length > 0 && !confirm("Clear the whole team plan?")) return;
    plan = emptyPlan();
  }

  function setView(next: "plan" | "sim") {
    view = next;
    // `#t=` import already cleared its hash in onMount; `#sim` is the only
    // durable fragment, so plain replacement is safe.
    history.replaceState(null, "", location.pathname + location.search + (next === "sim" ? "#sim" : ""));
  }
</script>

<div class="flex min-h-screen flex-col">
  <AppHeader
    title="Teams Planner"
    tag="Force Disposition coverage"
    homeUrl="https://40kdc.alpacasoft.dev"
  >
    {#snippet nav()}
      <AccountChip onSignIn={() => (gateOpen = true)} onOpenCloud={() => (cloudOpen = true)} />
    {/snippet}
  </AppHeader>

  <main class="mx-auto w-full max-w-6xl flex-1 px-3 py-4">
    <!-- View tabs -->
    <div class="mb-4 flex gap-1 border-b border-panel-border" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={view === "plan"}
        class="focus-ring rounded-t px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wider
               {view === 'plan' ? 'bg-panel-surface text-text' : 'text-text-dim hover:text-text-muted'}"
        onclick={() => setView("plan")}
      >
        Plan
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "sim"}
        class="focus-ring rounded-t px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wider
               {view === 'sim' ? 'bg-panel-surface text-text' : 'text-text-dim hover:text-text-muted'}"
        onclick={() => setView("sim")}
      >
        Pairings practice
      </button>
    </div>

    {#if view === "plan"}
      <PlanView
        {plan}
        {coverage}
        showGoLive={docSession.status === "idle"}
        onPlanChange={(next) => (plan = next)}
        onUpdatePlayer={updatePlayer}
        onAddPlayer={addPlayer}
        onRemovePlayer={removePlayer}
        onCopyShare={copyShareLink}
        onReset={resetPlan}
        onGoLive={startLive}
      />
    {:else}
      <PairingsSimulator {plan} />
    {/if}
  </main>

  <AppFooter
    version={__DATA_VERSION__}
    build={__BUILD_SHA__}
    links={[
      { label: "List Builder", href: LIST_BUILDER_URL },
      { label: "Mission Matrix", href: MISSION_MATRIX_URL },
    ]}
  />

  {#if toast}
    <div
      class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border-strong bg-surface px-4 py-2 text-sm text-text shadow-md"
      role="status"
    >
      {toast}
    </div>
  {/if}

  <PwaInstallPrompt
    appName="Teams Planner"
    storageKey="teams-planner.pwa-install-prompt.version"
    bind:open={pwaPromptOpen}
  />

  <!-- Cloud saves live behind the header chip (patron feature; opening links is free). -->
  <Modal bind:open={cloudOpen} title="Cloud saves">
    <CloudSavesPane
      kind="team-plan"
      localItems={cloudItems}
      onOpen={(_name, payload) => {
        cloudOpen = false;
        adoptPlan(payload, "cloud plan");
      }}
      onShare={(doc) => {
        shareTarget = doc;
        shareOpen = true;
      }}
      onFlash={flash}
      onNeedEntitlement={() => (gateOpen = true)}
    />
  </Modal>

  <ShareLinksModal
    bind:open={shareOpen}
    doc={shareTarget}
    exportPayload={toSnapshotPayload}
    onOpenLive={openLive}
    onFlash={flash}
  />

  <!-- Floating live-session presence: roster, nickname, links, snapshot fallback. -->
  <LiveSessionWidget onFlash={flash} />

  <EntitlementGate bind:open={gateOpen} feature="cloud sync and live sharing" />
</div>
