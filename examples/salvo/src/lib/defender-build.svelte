<script lang="ts">
  import { salvo, ds } from "./store.svelte.js";
  import { defenderDetachments, defenderEnhancements, defenderStratagems } from "./defender.js";

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

  function toggleStratagem(id: string, on: boolean): void {
    const rest = salvo.defenderStratagemIds.filter((item) => item !== id);
    salvo.defenderStratagemIds = on ? [...rest, id] : rest;
  }
</script>

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
