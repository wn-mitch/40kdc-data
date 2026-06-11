<script lang="ts">
  import type { ForceDispositionId } from "@alpaca-software/40kdc-data";
  import {
    armyDetachmentPoints,
    armyDispositions,
    detachmentName,
    detachmentsForFactions,
    effectivePlacement,
    factionOptions,
    findArmy,
    placementKey,
    playerCoverage,
    setPlacementTier,
    syncPreferences,
    type Army,
    type Placement,
    type Player,
    type PrefTier,
  } from "./coverage";
  import { DISPOSITION_ABBR, DISPOSITIONS } from "../../../_shared/matchup-grid.js";
  import { DISPOSITION_COLORS, TIER_SYMBOL } from "./dispositions";
  import DispoPill from "./DispoPill.svelte";

  let {
    player,
    coverage,
    onchange,
    onremove,
  }: {
    player: Player;
    /** This player's covered dispositions, computed by the parent. */
    coverage: Set<ForceDispositionId>;
    onchange: (next: Player) => void;
    onremove: () => void;
  } = $props();

  const allFactions = factionOptions();
  const addable = $derived(allFactions.filter((f) => !player.factionIds.includes(f.id)));
  const factionName = (id: string) => allFactions.find((f) => f.id === id)?.name ?? id;

  // Every detachment available across the player's factions (name-sorted).
  const pool = $derived(detachmentsForFactions(player.factionIds));

  const DP_CAP = 3;

  /**
   * Merge a change, then re-derive the two things downstream state depends on:
   * `preferences` is reconciled against the (possibly changed) army pool, and any
   * lock that no longer resolves — disposition uncovered, army removed, or army
   * can no longer field it — is dropped. Centralized so every edit gets it free.
   */
  function patch(next: Partial<Player>) {
    const merged: Player = { ...player, ...next };
    merged.preferences = syncPreferences(merged);
    const cov = playerCoverage(merged);
    const locked: Partial<Record<ForceDispositionId, string>> = {};
    for (const d of DISPOSITIONS) {
      const armyId = merged.locked?.[d];
      if (!armyId || !cov.has(d)) continue;
      const army = findArmy(merged, armyId);
      if (army && armyDispositions(army).has(d)) locked[d] = armyId;
    }
    merged.locked = locked;
    onchange(merged);
  }

  function uid(seed: string): string {
    return crypto.randomUUID?.() ?? `${seed}-${player.armies.length}-${performance.now()}`;
  }

  // ── Factions ──────────────────────────────────────────────────────────────
  function addFaction(e: Event) {
    const sel = e.currentTarget as HTMLSelectElement;
    const id = sel.value;
    if (!id) return;
    sel.value = "";
    patch({ factionIds: [...player.factionIds, id] });
  }

  function removeFaction(id: string) {
    const factionIds = player.factionIds.filter((f) => f !== id);
    // Drop army detachments that no longer resolve within the surviving factions.
    const valid = new Set(detachmentsForFactions(factionIds).map((d) => d.id));
    const armies = player.armies
      .map((a) => ({ ...a, detachmentIds: a.detachmentIds.filter((d) => valid.has(d)) }))
      .filter((a) => a.detachmentIds.length > 0);
    patch({ factionIds, armies });
  }

  // ── Armies ────────────────────────────────────────────────────────────────
  function addArmy() {
    const army: Army = { id: uid("army"), name: `Army ${player.armies.length + 1}`, detachmentIds: [] };
    patch({ armies: [...player.armies, army] });
  }

  function updateArmy(id: string, next: Partial<Army>) {
    patch({ armies: player.armies.map((a) => (a.id === id ? { ...a, ...next } : a)) });
  }

  function removeArmy(id: string) {
    patch({ armies: player.armies.filter((a) => a.id !== id) });
  }

  function addDetachment(armyId: string, e: Event) {
    const sel = e.currentTarget as HTMLSelectElement;
    const detId = sel.value;
    if (!detId) return;
    sel.value = "";
    const army = findArmy(player, armyId);
    if (!army || army.detachmentIds.includes(detId)) return;
    updateArmy(armyId, { detachmentIds: [...army.detachmentIds, detId] });
  }

  function removeDetachment(armyId: string, detId: string) {
    const army = findArmy(player, armyId);
    if (!army) return;
    updateArmy(armyId, { detachmentIds: army.detachmentIds.filter((d) => d !== detId) });
  }

  /** Detachments not yet in this army, for its "+ detachment" picker. */
  function addableDetachments(army: Army) {
    return pool.filter((d) => !army.detachmentIds.includes(d.id));
  }

  // ── Preferences (three bands) ───────────────────────────────────────────────
  const BANDS: PrefTier[] = ["want", "pref", "could"];
  const armyName = (id: string) => findArmy(player, id)?.name || "(army)";

  // Placements grouped by band, preserving the global rank order within each.
  const banded = $derived(
    Object.fromEntries(
      BANDS.map((t) => [t, player.preferences.filter((pl) => pl.tier === t)]),
    ) as Record<PrefTier, Placement[]>,
  );

  // Drag-to-rank/retier: `dragKey` is the placement being dragged (null = idle).
  // Dropping onto a chip inserts before it in *that chip's* band; dropping on a
  // band's empty space appends to the end of that band.
  let dragKey = $state<string | null>(null);

  function onChipEnter(target: Placement) {
    if (dragKey == null || dragKey === placementKey(target)) return;
    patch({ preferences: setPlacementTier(player.preferences, dragKey, target.tier, placementKey(target)) });
  }

  function onBandDrop(tier: PrefTier) {
    if (dragKey == null) return;
    patch({ preferences: setPlacementTier(player.preferences, dragKey, tier, null) });
    dragKey = null;
  }

  // ── Collapsed summary ───────────────────────────────────────────────────────
  let collapsed = $state(false);
  const coveredCount = $derived(coverage.size);
  const effTier = (d: ForceDispositionId): PrefTier | null => effectivePlacement(player, d)?.tier ?? null;
</script>

<div class="rounded-md border border-panel-border bg-panel-surface p-3 shadow-sm">
  <div class="flex items-start gap-2">
    <button
      type="button"
      class="focus-ring rounded border border-border-strong px-2 py-1.5 leading-none text-text-muted hover:border-accent hover:text-accent"
      aria-expanded={!collapsed}
      aria-label={collapsed ? `Expand ${player.name || "player"}` : `Collapse ${player.name || "player"}`}
      onclick={() => (collapsed = !collapsed)}
    >
      <span class="inline-block transition-transform {collapsed ? '' : 'rotate-90'}">▶</span>
    </button>
    <input
      class="focus-ring min-w-0 flex-1 rounded border border-border-strong bg-panel px-2 py-1.5 text-sm text-text placeholder:text-text-dim"
      placeholder="Player name"
      value={player.name}
      oninput={(e) => patch({ name: (e.currentTarget as HTMLInputElement).value })}
    />
    <button
      type="button"
      class="focus-ring rounded border border-border-strong px-2 py-1.5 text-xs uppercase tracking-wide text-text-muted hover:border-danger hover:text-danger"
      onclick={onremove}
      aria-label="Remove player"
    >
      Remove
    </button>
  </div>

  {#if collapsed}
    <!-- Collapsed: effective per-disposition desire so the row stays scannable. -->
    <div class="mt-2 flex flex-wrap items-center gap-1.5">
      {#each DISPOSITIONS as d (d)}
        {@const t = effTier(d)}
        {#if t}
          <DispoPill disposition={d} tier={t} />
        {:else}
          <DispoPill disposition={d} tier="uncovered" />
        {/if}
      {/each}
      <span class="ml-1 text-xs text-text-dim">{coveredCount}/{DISPOSITIONS.length} covered</span>
    </div>
  {:else}
    <!-- Factions -->
    <div class="mt-2 flex flex-wrap items-center gap-1.5">
      {#each player.factionIds as id (id)}
        <span class="inline-flex items-center gap-1 rounded bg-accent-dim px-2 py-0.5 text-xs text-text">
          {factionName(id)}
          <button
            type="button"
            class="focus-ring text-text-muted hover:text-danger"
            onclick={() => removeFaction(id)}
            aria-label={`Remove ${factionName(id)}`}>×</button
          >
        </span>
      {/each}
      {#if addable.length > 0}
        <select
          class="focus-ring rounded border border-border-strong bg-panel px-2 py-0.5 text-xs text-text-muted"
          onchange={addFaction}
        >
          <option value="">+ Add faction…</option>
          {#each addable as f (f.id)}
            <option value={f.id}>{f.name}</option>
          {/each}
        </select>
      {/if}
    </div>

    <!-- Armies: prospective ≤3-DP combos. -->
    {#if player.factionIds.length > 0}
      <details class="group mt-2" open>
        <summary
          class="focus-ring flex cursor-pointer list-none items-center gap-1 font-heading text-xs font-bold uppercase tracking-wider text-text-muted hover:text-accent"
        >
          <span class="inline-block transition-transform group-open:rotate-90">▶</span>
          Armies
        </summary>
        <div class="mt-1.5 flex flex-col gap-2">
          {#each player.armies as army (army.id)}
            {@const dp = armyDetachmentPoints(army)}
            {@const over = dp > DP_CAP}
            <div class="rounded border border-border-strong bg-panel p-2">
              <div class="flex items-center gap-2">
                <input
                  class="focus-ring min-w-0 flex-1 rounded border border-border-strong bg-panel-surface px-2 py-1 text-sm text-text placeholder:text-text-dim"
                  placeholder="Army name"
                  value={army.name}
                  oninput={(e) => updateArmy(army.id, { name: (e.currentTarget as HTMLInputElement).value })}
                />
                <span
                  class="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold {over
                    ? 'bg-danger/20 text-danger'
                    : 'bg-accent-dim text-text-muted'}"
                  title={over ? `Over the ${DP_CAP} DP budget` : `${dp} of ${DP_CAP} detachment points`}
                >
                  {dp} DP
                </span>
                <button
                  type="button"
                  class="focus-ring rounded border border-border-strong px-1.5 py-0.5 text-xs text-text-muted hover:border-danger hover:text-danger"
                  onclick={() => removeArmy(army.id)}
                  aria-label={`Remove ${army.name || "army"}`}>×</button
                >
              </div>
              {#if over}
                <p class="mt-1 text-[11px] text-danger">Over budget — Strike Force allows {DP_CAP} DP.</p>
              {/if}
              <!-- Detachment chips -->
              <div class="mt-1.5 flex flex-wrap items-center gap-1">
                {#each army.detachmentIds as detId (detId)}
                  <span class="inline-flex items-center gap-1 rounded bg-panel-surface px-1.5 py-0.5 text-xs text-text">
                    {detachmentName(detId)}
                    <button
                      type="button"
                      class="focus-ring text-text-muted hover:text-danger"
                      onclick={() => removeDetachment(army.id, detId)}
                      aria-label={`Remove ${detachmentName(detId)}`}>×</button
                    >
                  </span>
                {/each}
                {#if addableDetachments(army).length > 0}
                  <select
                    class="focus-ring rounded border border-border-strong bg-panel-surface px-1.5 py-0.5 text-xs text-text-muted"
                    onchange={(e) => addDetachment(army.id, e)}
                  >
                    <option value="">+ detachment…</option>
                    {#each addableDetachments(army) as d (d.id)}
                      <option value={d.id}>{d.name} ({d.detachment_points ?? "?"} DP)</option>
                    {/each}
                  </select>
                {/if}
              </div>
              <!-- Dispositions this combo can field -->
              {#if army.detachmentIds.length > 0}
                <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {#each [...armyDispositions(army)] as fd}
                    <DispoPill disposition={fd as ForceDispositionId} tier="tag" />
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
          <button
            type="button"
            class="focus-ring rounded border border-dashed border-border-strong px-2 py-1 text-xs uppercase tracking-wide text-text-muted hover:border-accent hover:text-accent"
            onclick={addArmy}
          >
            + Add army
          </button>
        </div>
      </details>
    {/if}

    <!-- Preferences: drag each (army × disposition) into a Want / Pref / Could band. -->
    {#if player.preferences.length > 0}
      <details class="group mt-2" open>
        <summary
          class="focus-ring flex cursor-pointer list-none items-center gap-1 font-heading text-xs font-bold uppercase tracking-wider text-text-muted hover:text-accent"
        >
          <span class="inline-block transition-transform group-open:rotate-90">▶</span>
          Preferences
          <span class="font-body font-normal normal-case tracking-normal text-text-dim">(drag into a band)</span>
        </summary>
        <div class="mt-1.5 flex flex-col gap-1.5">
          {#each BANDS as tier (tier)}
            <div
              class="rounded border border-border-strong bg-panel p-1.5"
              role="list"
              ondragover={(e) => e.preventDefault()}
              ondrop={() => onBandDrop(tier)}
            >
              <div class="mb-1 flex items-center gap-1 font-heading text-[11px] font-bold uppercase tracking-wider text-text-dim">
                <span aria-hidden="true">{TIER_SYMBOL[tier]}</span>
                {tier}
              </div>
              {#if banded[tier].length === 0}
                <p class="px-1 py-0.5 text-[11px] text-text-dim">Drop here</p>
              {:else}
                <ol class="flex flex-col gap-1">
                  {#each banded[tier] as pl (placementKey(pl))}
                    <li
                      draggable="true"
                      role="listitem"
                      ondragstart={() => (dragKey = placementKey(pl))}
                      ondragenter={() => onChipEnter(pl)}
                      ondragover={(e) => e.preventDefault()}
                      ondragend={() => (dragKey = null)}
                      class="flex cursor-grab items-center gap-1.5 rounded bg-panel-surface px-2 py-1 text-sm text-text active:cursor-grabbing {dragKey ===
                      placementKey(pl)
                        ? 'opacity-50'
                        : ''}"
                    >
                      <span class="select-none text-text-dim" aria-hidden="true">⠿</span>
                      <span class="min-w-0 flex-1 truncate">{armyName(pl.armyId)}</span>
                      <span
                        class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                        style="color:{DISPOSITION_COLORS[pl.disposition]}"
                      >
                        {DISPOSITION_ABBR[pl.disposition]}
                      </span>
                    </li>
                  {/each}
                </ol>
              {/if}
            </div>
          {/each}
        </div>
      </details>
    {/if}
  {/if}
</div>
