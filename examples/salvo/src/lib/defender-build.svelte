<script lang="ts">
  import { salvo, ds } from "./store.svelte.js";
  import { isLegalLeverSelection, type StackableBuff } from "@alpaca-software/40kdc-data";
  import {
    defaultTargetWargear,
    defenderDetachments,
    defenderEnhancements,
    defenderLevers,
    defenderStratagems,
    targetWargearChoices,
    type DefenderLevers,
  } from "./defender.js";

  const unit = $derived(salvo.targetUnitId ? ds.units.getAny(salvo.targetUnitId) : undefined);
  const detachments = $derived(unit ? defenderDetachments(ds, unit.factionId) : []);
  // A detachment from another faction is not offered, so it reads as unset.
  const detachmentId = $derived(
    salvo.defenderDetachmentId && detachments.some((d) => d.id === salvo.defenderDetachmentId)
      ? salvo.defenderDetachmentId
      : null,
  );
  const stratagems = $derived(unit && detachmentId ? defenderStratagems(ds, unit, detachmentId, salvo.phase) : []);
  const enhancements = $derived(unit && detachmentId ? defenderEnhancements(ds, unit, detachmentId) : []);

  const wargearChoices = $derived(unit ? targetWargearChoices(ds, unit) : []);
  const wargear = $derived(unit ? salvo.targetWargear ?? defaultTargetWargear(ds, unit) : {});
  // A chosen item is carried by one model, or by as many as the default loadout gives it.
  function toggleWargear(id: string, on: boolean): void {
    if (!unit) return;
    const next = { ...wargear };
    if (on) next[id] = defaultTargetWargear(ds, unit)[id] ?? 1;
    else delete next[id];
    salvo.defenderWargear = { unitId: unit.id, wargear: next };
  }

  // The target's optional abilities, listed under the context the projection crunches with, so a
  // lever behind an answered condition (a roll in Needs) appears exactly when it can apply.
  const levers = $derived.by<DefenderLevers & { error?: string }>(() => {
    if (!unit) return { buffs: [], groups: [] };
    try {
      return defenderLevers(ds, unit, {
        detachmentId,
        stratagemIds: salvo.defenderStratagemIds,
        enhancementId: salvo.defenderEnhancementId,
        wargear: salvo.targetWargear,
      }, salvo.projectionContext);
    } catch (err) {
      return { buffs: [], groups: [], error: (err as Error).message };
    }
  });
  const leverOn = (lever: StackableBuff) => salvo.targetLeverIds.includes(lever.id);
  const poolLabel = (id: string) => levers.groups.find((group) => group.id === id);
  // Turning a lever off is always allowed; turning one on must keep every pool within its allowance.
  function canToggleLever(lever: StackableBuff): boolean {
    if (leverOn(lever)) return true;
    const selected = new Set(levers.buffs.filter(leverOn).map((item) => item.id));
    selected.add(lever.id);
    return isLegalLeverSelection(levers.buffs, levers.groups, selected);
  }

  function toggleStratagem(id: string, on: boolean): void {
    const rest = salvo.defenderStratagemIds.filter((item) => item !== id);
    salvo.defenderStratagemIds = on ? [...rest, id] : rest;
  }
</script>

{#if unit && wargearChoices.length > 0}
  <div class="section-label">Target's wargear</div>
  <div class="ability-list">
    {#each wargearChoices as item (item.id)}
      <label class="ability-row" class:active={(wargear[item.id] ?? 0) > 0}>
        <input
          type="checkbox"
          checked={(wargear[item.id] ?? 0) > 0}
          onchange={(e) => toggleWargear(item.id, (e.currentTarget as HTMLInputElement).checked)}
        />
        <span class="name">{item.name}{(wargear[item.id] ?? 0) > 1 ? ` ×${wargear[item.id]}` : ""}</span>
      </label>
    {/each}
  </div>
{/if}
{#if unit}
  <div class="section-label">Target's optional abilities</div>
  {#if levers.error}
    <p class="error" role="alert">Target abilities could not be read: {levers.error}</p>
  {/if}
  <div class="ability-list">
    {#each levers.buffs as lever (lever.id)}
      {@const pool = lever.group ? poolLabel(lever.group) : undefined}
      <label class="ability-row" class:active={leverOn(lever)} class:dim={!canToggleLever(lever)}>
        <input
          type="checkbox"
          checked={leverOn(lever)}
          disabled={!canToggleLever(lever)}
          onchange={(e) => salvo.setTargetLever(lever.id, (e.currentTarget as HTMLInputElement).checked)}
        />
        <span class="name">{lever.label}{#if pool}<small> · allowance {pool.maxActivations}</small>{/if}</span>
        <span class="chip activation">optional</span>
      </label>
    {:else}
      <p class="dim">No optional ability in the {salvo.phase} phase.</p>
    {/each}
    <p class="hint dim">An ability behind a roll is listed once that roll is answered under Needs.</p>
  </div>
{/if}
{#if unit}
  <div class="section-label">Defender's army</div>
  <div class="row">
    <label for="def-detachment">Detachment</label>
    <select
      id="def-detachment"
      class="grow"
      value={detachmentId ?? ""}
      onchange={(e) => {
        salvo.defenderDetachmentId = (e.currentTarget as HTMLSelectElement).value || null;
        salvo.defenderStratagemIds = [];
        salvo.defenderEnhancementId = null;
      }}
    >
      <option value="">— none —</option>
      {#each detachments as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
    </select>
  </div>
  {#if detachmentId}
    <div class="row">
      <label for="def-enhancement">Enhancement</label>
      <select
        id="def-enhancement"
        class="grow"
        disabled={enhancements.length === 0}
        value={salvo.defenderEnhancementId ?? ""}
        onchange={(e) => (salvo.defenderEnhancementId = (e.currentTarget as HTMLSelectElement).value || null)}
      >
        <option value="">{enhancements.length === 0 ? "— this unit cannot take one —" : "— none —"}</option>
        {#each enhancements as enh (enh.id)}<option value={enh.id}>{enh.name}</option>{/each}
      </select>
    </div>
    <div class="ability-list">
      {#each stratagems as s (s.id)}
        <label class="ability-row" class:active={salvo.defenderStratagemIds.includes(s.id)}>
          <input
            type="checkbox"
            checked={salvo.defenderStratagemIds.includes(s.id)}
            onchange={(e) => toggleStratagem(s.id, (e.currentTarget as HTMLInputElement).checked)}
          />
          <span class="name">{s.name} <small>· {s.cpCost} CP</small></span>
          <span class="chip stratagem">stratagem</span>
        </label>
      {:else}
        <p class="dim">No Stratagem of this detachment targets this unit in the {salvo.phase} phase.</p>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .hint { margin: var(--space-1) 0 0; font-size: var(--text-xs); }
</style>
