<script lang="ts">
  import { onMount } from "svelte";
  import { teamCoverage, type Player, type TeamPlan } from "./lib/coverage";
  import { decodePlan, encodePlan, sanitizePlan } from "./lib/share-plan";
  import PlayerRow from "./lib/PlayerRow.svelte";
  import CoverageMatrix from "./lib/CoverageMatrix.svelte";
  import AppHeader from "../../_shared/AppHeader.svelte";
  import AppFooter from "../../_shared/AppFooter.svelte";
  import {
    LIST_BUILDER_URL,
    MISSION_MATRIX_URL,
  } from "../../_shared/links.js";

  /**
   * Standalone disposition-coverage planner. State lives in localStorage so it
   * survives across sessions; a captain can also pack the whole plan into a
   * `#t=` URL fragment to share it (decoded client-side, no backend).
   */
  const STORAGE_KEY = "teams-planner.v1";

  function emptyPlan(): TeamPlan {
    return { teamName: "", size: 5, players: [] };
  }

  function loadPlan(): TeamPlan {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyPlan();
      const result = sanitizePlan(JSON.parse(raw));
      return result ? result.plan : emptyPlan();
    } catch {
      return emptyPlan();
    }
  }

  let plan = $state<TeamPlan>(loadPlan());
  let toast = $state<string | null>(null);

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
    const m = location.hash.match(/^#t=(.+)$/);
    if (!m) return;
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
  });

  function flash(msg: string) {
    toast = msg;
    setTimeout(() => {
      if (toast === msg) toast = null;
    }, 4000);
  }

  function addPlayer() {
    const id = crypto.randomUUID?.() ?? `p-${plan.players.length}-${Date.now()}`;
    const next: Player = { id, name: "", factionIds: [], detachmentIds: null };
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
</script>

<div class="flex min-h-screen flex-col">
  <AppHeader
    title="Teams Planner"
    tag="Force Disposition coverage"
    homeUrl="https://40kdc.alpacasoft.dev"
  />

  <main class="mx-auto w-full max-w-3xl flex-1 px-3 py-4">
    <!-- Team controls -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <label class="flex flex-col gap-1">
        <span class="font-heading text-[10px] font-bold uppercase tracking-wider text-text-dim">Team name</span>
        <input
          class="focus-ring rounded border border-border-strong bg-panel px-2 py-1.5 text-sm text-text placeholder:text-text-dim"
          placeholder="Team name"
          value={plan.teamName}
          oninput={(e) => (plan = { ...plan, teamName: (e.currentTarget as HTMLInputElement).value })}
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="font-heading text-[10px] font-bold uppercase tracking-wider text-text-dim">Team size</span>
        <select
          class="focus-ring rounded border border-border-strong bg-panel px-2 py-1.5 text-sm text-text"
          value={String(plan.size)}
          onchange={(e) => (plan = { ...plan, size: Number((e.currentTarget as HTMLSelectElement).value) === 8 ? 8 : 5 })}
        >
          <option value="5">5 players</option>
          <option value="8">8 players</option>
        </select>
      </label>
      <div class="ml-auto flex gap-2">
        <button
          type="button"
          class="focus-ring rounded border border-border-strong px-3 py-1.5 text-xs uppercase tracking-wide text-text-muted hover:border-accent hover:text-accent"
          onclick={copyShareLink}
        >
          Copy share link
        </button>
        <button
          type="button"
          class="focus-ring rounded border border-border-strong px-3 py-1.5 text-xs uppercase tracking-wide text-text-muted hover:border-danger hover:text-danger"
          onclick={resetPlan}
        >
          Reset
        </button>
      </div>
    </div>

    <!-- Coverage summary -->
    <div class="mb-4">
      <CoverageMatrix {plan} {coverage} />
    </div>

    <!-- Players -->
    <div class="flex flex-col gap-2">
      {#each plan.players as p (p.id)}
        <PlayerRow
          player={p}
          coverage={coverage.perPlayer.get(p.id) ?? new Set()}
          onchange={updatePlayer}
          onremove={() => removePlayer(p.id)}
        />
      {/each}
    </div>

    <button
      type="button"
      class="focus-ring mt-3 w-full rounded border border-dashed border-border-strong px-3 py-2 text-sm uppercase tracking-wide text-text-muted hover:border-accent hover:text-accent"
      onclick={addPlayer}
    >
      + Add player
    </button>
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
</div>
