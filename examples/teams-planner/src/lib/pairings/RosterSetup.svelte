<script lang="ts">
  import type { ForceDispositionId } from "@alpaca-software/40kdc-data";
  import { DISPOSITION_LABELS, DISPOSITIONS } from "../../../../_shared/matchup-grid.js";
  import {
    effectivePlacement,
    factionKeywordIdentity,
    fdAssignmentIssues,
    playerCoverage,
    sanitizeTeamSize,
    type Player,
    type TeamPlan,
    type TeamSize,
  } from "../coverage";
  import { ds } from "../dataset";
  import DispoPill from "../DispoPill.svelte";
  import { generateCpuTeam } from "./archetypes";
  import type { Round, SimPlayer } from "./types";

  /**
   * Pre-sim screen: pick which plan players take the table this round and the
   * disposition each fields, set the event round (drives the refused/champion
   * layout cycle), and roll the CPU opposition. Legality issues are shown but
   * never block — it's a practice tool.
   */
  let {
    plan,
    onstart,
  }: {
    plan: TeamPlan;
    onstart: (user: SimPlayer[], cpu: SimPlayer[], size: TeamSize, round: Round) => void;
  } = $props();

  let round = $state<Round>(1);
  /** Which plan players are in, by id (defaults to the first `plan.size`).
   *  Deliberately a mount-time snapshot: the simulator view remounts on every
   *  entry, and a remote plan edit mid-setup shouldn't yank selections. */
  // svelte-ignore state_referenced_locally
  let included = $state<Set<string>>(new Set(plan.players.slice(0, plan.size).map((p) => p.id)));
  /** Each included player's disposition for the round. */
  let fdByPlayer = $state<Record<string, ForceDispositionId>>(seedFds());
  let cpuTeam = $state<SimPlayer[]>([]);
  let cpuError = $state<string | null>(null);

  /** Default each player to their best-tier covered disposition, spreading
   *  across the five before repeating. */
  function seedFds(): Record<string, ForceDispositionId> {
    const out: Record<string, ForceDispositionId> = {};
    const taken = new Set<ForceDispositionId>();
    for (const p of plan.players) {
      const covered = [...playerCoverage(p)];
      const ranked = covered
        .map((d) => ({ d, eff: effectivePlacement(p, d) }))
        .sort((a, b) => tierRank(b.eff?.tier) - tierRank(a.eff?.tier));
      const fresh = ranked.find((r) => !taken.has(r.d)) ?? ranked[0];
      const fd = fresh?.d ?? DISPOSITIONS[0];
      out[p.id] = fd;
      taken.add(fd);
    }
    return out;
  }

  function tierRank(t: string | undefined): number {
    return t === "want" ? 3 : t === "pref" ? 2 : t === "could" ? 1 : 0;
  }

  function toggle(id: string) {
    const next = new Set(included);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    included = next;
  }

  const selected = $derived(plan.players.filter((p) => included.has(p.id)));
  const size = $derived(sanitizeTeamSize(selected.length));
  const sizeOk = $derived(selected.length >= 3 && selected.length <= 8);

  const issues = $derived.by(() => {
    if (!sizeOk) return [];
    const out = fdAssignmentIssues(size, selected.map((p) => fdByPlayer[p.id])).map(
      (i) => i.detail,
    );
    const keywords = new Map<string, string[]>();
    for (const p of selected) {
      // The fielded army's keyword: derived from the player's first faction.
      const f = p.factionIds[0];
      if (!f) continue;
      const k = factionKeywordIdentity(f);
      keywords.set(k, [...(keywords.get(k) ?? []), p.name || "(unnamed)"]);
    }
    for (const [k, names] of keywords) {
      if (names.length > 1) {
        out.push(
          `${names.join(" and ")} share the ${ds.factions.get(k)?.name ?? k} faction keyword`,
        );
      }
    }
    return out;
  });

  function reroll() {
    if (!sizeOk) return;
    try {
      cpuTeam = generateCpuTeam(size);
      cpuError = null;
    } catch (e) {
      cpuTeam = [];
      cpuError = e instanceof Error ? e.message : String(e);
    }
  }

  // Roll an opposing team whenever the size changes (and on first render).
  $effect(() => {
    void size;
    reroll();
  });

  function start() {
    if (!sizeOk || cpuTeam.length !== size) return;
    const user: SimPlayer[] = selected.map((p, i) => ({
      id: p.id,
      name: p.name || `Player ${i + 1}`,
      factionId: p.factionIds[0] ?? "",
      fd: fdByPlayer[p.id] ?? DISPOSITIONS[0],
    }));
    onstart(user, cpuTeam, size, round);
  }

  function coveredOptions(p: Player): ForceDispositionId[] {
    const covered = playerCoverage(p);
    return covered.size > 0 ? DISPOSITIONS.filter((d) => covered.has(d)) : DISPOSITIONS;
  }
</script>

<div class="flex flex-col gap-4">
  <section class="rounded-md border border-panel-border bg-panel-surface p-3">
    <h2 class="mb-2 font-heading text-sm font-bold uppercase tracking-wider text-text-muted">
      Your team
    </h2>
    {#if plan.players.length < 3}
      <p class="py-4 text-center text-sm text-text-dim">
        Add at least 3 players on the Plan tab to practice pairings.
      </p>
    {:else}
      <div class="flex flex-col gap-1.5">
        {#each plan.players as p (p.id)}
          <label
            class="flex flex-wrap items-center gap-2 rounded border px-2 py-1.5
                   {included.has(p.id) ? 'border-border-strong bg-panel' : 'border-transparent opacity-50'}"
          >
            <input
              type="checkbox"
              class="focus-ring h-3.5 w-3.5"
              checked={included.has(p.id)}
              onchange={() => toggle(p.id)}
            />
            <span class="min-w-[8rem] flex-1 truncate text-sm text-text">{p.name || "(unnamed)"}</span>
            <span class="truncate text-xs text-text-dim">
              {p.factionIds.map((f) => ds.factions.get(f)?.name ?? f).join(", ") || "no faction"}
            </span>
            {#if included.has(p.id)}
              <select
                class="focus-ring rounded border border-border-strong bg-panel px-1.5 py-1 text-xs text-text"
                value={fdByPlayer[p.id]}
                onchange={(e) => {
                  fdByPlayer = {
                    ...fdByPlayer,
                    [p.id]: (e.currentTarget as HTMLSelectElement).value as ForceDispositionId,
                  };
                }}
              >
                {#each coveredOptions(p) as d (d)}
                  <option value={d}>{DISPOSITION_LABELS[d]}</option>
                {/each}
              </select>
            {/if}
          </label>
        {/each}
      </div>
      <p class="mt-2 text-[11px] text-text-dim">
        {selected.length} selected — pairing modules need 3–8 players.
      </p>
      {#each issues as issue (issue)}
        <div class="mt-1 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning">
          ⚠ {issue}
        </div>
      {/each}
    {/if}
  </section>

  <section class="rounded-md border border-panel-border bg-panel-surface p-3">
    <div class="mb-2 flex items-center justify-between">
      <h2 class="font-heading text-sm font-bold uppercase tracking-wider text-text-muted">
        Opposing team
      </h2>
      <button
        type="button"
        class="focus-ring rounded border border-border-strong px-2 py-1 text-xs uppercase tracking-wide text-text-muted hover:border-accent hover:text-accent"
        onclick={reroll}
        disabled={!sizeOk}
      >
        ↻ Reroll
      </button>
    </div>
    {#if cpuError}
      <p class="text-sm text-danger">{cpuError}</p>
    {:else if cpuTeam.length === 0}
      <p class="text-sm text-text-dim">Select 3–8 players to roll an opposing team.</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each cpuTeam as p (p.id)}
          <li class="flex items-center gap-2 rounded border border-border-subtle bg-panel px-2 py-1.5">
            <span class="min-w-[10rem] flex-1 truncate text-sm text-text">{p.name}</span>
            <span class="truncate text-xs text-text-dim">{ds.factions.get(p.factionId)?.name ?? p.factionId}</span>
            <DispoPill disposition={p.fd} tier="could" />
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <div class="flex flex-wrap items-end gap-3">
    <label class="flex flex-col gap-1">
      <span class="font-heading text-[10px] font-bold uppercase tracking-wider text-text-dim">
        Event round
      </span>
      <select
        class="focus-ring rounded border border-border-strong bg-panel px-2 py-1.5 text-sm text-text"
        value={String(round)}
        onchange={(e) => (round = Number((e.currentTarget as HTMLSelectElement).value) as Round)}
      >
        <option value="1">Round 1 (refused play Layout A)</option>
        <option value="2">Round 2 (refused play Layout B)</option>
        <option value="3">Round 3 (refused play Layout C)</option>
      </select>
    </label>
    <button
      type="button"
      class="focus-ring rounded bg-accent px-4 py-2 text-sm font-semibold uppercase tracking-wide text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
      onclick={start}
      disabled={!sizeOk || cpuTeam.length !== size}
    >
      Start pairings
    </button>
  </div>
</div>
