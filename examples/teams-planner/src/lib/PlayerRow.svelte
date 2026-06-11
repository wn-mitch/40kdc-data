<script lang="ts">
  import type { ForceDispositionId } from "@alpaca-software/40kdc-data";
  import {
    detachmentsForFactions,
    factionOptions,
    type Player,
  } from "./coverage";
  import {
    DISPOSITION_ABBR,
    DISPOSITION_LABELS,
    DISPOSITIONS,
  } from "../../../_shared/matchup-grid.js";

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

  // Factions still available to add (not already on this player).
  const addable = $derived(allFactions.filter((f) => !player.factionIds.includes(f.id)));
  const factionName = (id: string) => allFactions.find((f) => f.id === id)?.name ?? id;

  // Detachments reachable from the player's factions — the narrowing checklist.
  const detachments = $derived(detachmentsForFactions(player.factionIds));
  const narrowing = $derived(player.detachmentIds != null);

  function patch(next: Partial<Player>) {
    onchange({ ...player, ...next });
  }

  function addFaction(e: Event) {
    const sel = e.currentTarget as HTMLSelectElement;
    const id = sel.value;
    if (!id) return;
    sel.value = "";
    // Adding a faction widens the detachment pool; when narrowing is on, keep
    // the new faction's detachments included so coverage doesn't silently shrink.
    const next: Partial<Player> = { factionIds: [...player.factionIds, id] };
    if (player.detachmentIds != null) {
      next.detachmentIds = detachmentsForFactions([...player.factionIds, id]).map((d) => d.id);
    }
    patch(next);
  }

  function removeFaction(id: string) {
    const factionIds = player.factionIds.filter((f) => f !== id);
    const next: Partial<Player> = { factionIds };
    // Drop any narrowed detachments that no longer resolve.
    if (player.detachmentIds != null) {
      const valid = new Set(detachmentsForFactions(factionIds).map((d) => d.id));
      next.detachmentIds = player.detachmentIds.filter((d) => valid.has(d));
    }
    patch(next);
  }

  function toggleNarrowing(on: boolean) {
    // On → start from "all detachments" (coverage unchanged) and let the user
    // uncheck. Off → null, meaning every detachment in the factions.
    patch({ detachmentIds: on ? detachments.map((d) => d.id) : null });
  }

  function toggleDetachment(id: string, on: boolean) {
    const set = new Set(player.detachmentIds ?? []);
    if (on) set.add(id);
    else set.delete(id);
    patch({ detachmentIds: detachments.map((d) => d.id).filter((d) => set.has(d)) });
  }
</script>

<div class="rounded-md border border-panel-border bg-panel-surface p-3 shadow-sm">
  <div class="flex items-start gap-2">
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

  <!-- Covered dispositions (live) -->
  <div class="mt-2 flex flex-wrap gap-1">
    {#each DISPOSITIONS as d (d)}
      {@const has = coverage.has(d)}
      <span
        class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide
               {has ? 'bg-accent text-accent-foreground' : 'bg-panel text-text-dim line-through'}"
        title={DISPOSITION_LABELS[d]}
      >
        {DISPOSITION_ABBR[d]}
      </span>
    {/each}
  </div>

  <!-- Detachment narrowing -->
  {#if detachments.length > 0}
    <div class="mt-2 text-xs">
      <label class="flex cursor-pointer items-center gap-1.5 text-text-muted">
        <input
          type="checkbox"
          checked={narrowing}
          onchange={(e) => toggleNarrowing((e.currentTarget as HTMLInputElement).checked)}
        />
        Limit to specific detachments
      </label>
      {#if narrowing}
        <div class="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-2">
          {#each detachments as det (det.id)}
            <label class="flex cursor-pointer items-center gap-1.5 rounded bg-panel px-2 py-1 text-text">
              <input
                type="checkbox"
                checked={player.detachmentIds?.includes(det.id) ?? false}
                onchange={(e) => toggleDetachment(det.id, (e.currentTarget as HTMLInputElement).checked)}
              />
              <span class="min-w-0 flex-1 truncate">{det.name}</span>
              {#each det.force_dispositions ?? [] as fd}
                <span class="text-[10px] uppercase text-text-dim" title={DISPOSITION_LABELS[fd as ForceDispositionId]}>
                  {DISPOSITION_ABBR[fd as ForceDispositionId]}
                </span>
              {/each}
            </label>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
