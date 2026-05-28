<script lang="ts">
  import { salvo, ds, PHASE_CHOICES } from "./store.svelte.js";
  import { resolveRosterUnit } from "@alpaca-software/40kdc-data";

  // Roster-driven unit list (each entry is "this unit, this faction"), or the
  // raw embedded unit catalog when no roster is loaded.
  const rosterUnits = $derived(
    (salvo.attackerRoster?.units ?? [])
      .map((ru, i) => ({
        ru,
        view: resolveRosterUnit(ru, ds),
        index: i,
      }))
      .filter((x) => x.view !== undefined),
  );

  // Quick-pick: every unit in the dataset, filtered by faction if one is set.
  const datasetUnits = $derived.by(() => {
    const allUnits = ds.units.all;
    const filtered = salvo.selectedFactionId
      ? allUnits.filter((u) => u.raw.faction_id === salvo.selectedFactionId)
      : allUnits;
    return filtered
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const factions = $derived(
    ds.factions.all.slice().sort((a, b) => a.name.localeCompare(b.name)),
  );

  const detachments = $derived(
    salvo.selectedFactionId
      ? ds.detachments.all.filter((d) => d.faction_id === salvo.selectedFactionId)
      : [],
  );

  const selectedUnit = $derived(
    salvo.selectedUnitId ? ds.units.get(salvo.selectedUnitId) : undefined,
  );

  const weapons = $derived(selectedUnit?.weapons ?? []);

  // Reset weapon selection when the unit changes.
  $effect(() => {
    if (!selectedUnit) return;
    if (salvo.selectedWeaponId && weapons.find((w) => w.id === salvo.selectedWeaponId)) return;
    salvo.selectedWeaponId = weapons[0]?.id ?? null;
    salvo.selectedProfileIndex = 0;
  });

  const selectedWeapon = $derived(
    salvo.selectedWeaponId ? ds.weapons.get(salvo.selectedWeaponId) : undefined,
  );

  const profiles = $derived(selectedWeapon?.raw.profiles ?? []);

  // Default models-firing: roster's reported model_count, else min model_count.
  $effect(() => {
    if (!selectedUnit) return;
    const rosterEntry = salvo.attackerRoster?.units.find(
      (u) => u.ref.id === selectedUnit.id,
    );
    if (rosterEntry) {
      salvo.modelsFiring = rosterEntry.model_count;
    } else {
      salvo.modelsFiring = selectedUnit.raw.model_count?.min ?? 1;
    }
  });

  function pickUnit(unitId: string, factionId?: string) {
    salvo.selectedUnitId = unitId;
    if (factionId) salvo.selectedFactionId = factionId;
    else {
      const u = ds.units.get(unitId);
      if (u) salvo.selectedFactionId = u.raw.faction_id;
    }
  }
</script>

{#if rosterUnits.length > 0}
  <div class="row">
    <label>From roster</label>
    <select
      class="grow"
      value={salvo.selectedUnitId ?? ""}
      onchange={(e) => pickUnit((e.currentTarget as HTMLSelectElement).value)}
    >
      <option value="">— pick a unit —</option>
      {#each rosterUnits as { ru, view, index } (index)}
        <option value={view!.id}>{view!.name} ({ru.model_count} models)</option>
      {/each}
    </select>
  </div>
{/if}

<div class="row">
  <label>Faction</label>
  <select
    class="grow"
    value={salvo.selectedFactionId ?? ""}
    onchange={(e) => {
      salvo.selectedFactionId = (e.currentTarget as HTMLSelectElement).value || null;
      salvo.selectedDetachmentId = null;
    }}
  >
    <option value="">— any —</option>
    {#each factions as f (f.id)}
      <option value={f.id}>{f.name}</option>
    {/each}
  </select>
</div>

<div class="row">
  <label>Unit</label>
  <select
    class="grow"
    value={salvo.selectedUnitId ?? ""}
    onchange={(e) => pickUnit((e.currentTarget as HTMLSelectElement).value)}
  >
    <option value="">— pick a unit —</option>
    {#each datasetUnits as u (`${u.raw.faction_id}/${u.id}`)}
      <option value={u.id}>{u.name}</option>
    {/each}
  </select>
</div>

{#if detachments.length > 0}
  <div class="row">
    <label>Detachment</label>
    <select
      class="grow"
      value={salvo.selectedDetachmentId ?? ""}
      onchange={(e) => {
        salvo.selectedDetachmentId = (e.currentTarget as HTMLSelectElement).value || null;
      }}
    >
      <option value="">— none —</option>
      {#each detachments as d (d.id)}
        <option value={d.id}>{d.name}</option>
      {/each}
    </select>
  </div>
{/if}

<div class="row">
  <label>Phase</label>
  <div class="tabs">
    {#each PHASE_CHOICES as p (p)}
      <button class:active={salvo.phase === p} onclick={() => (salvo.phase = p)}>{p}</button>
    {/each}
  </div>
</div>

{#if selectedUnit}
  <div class="row">
    <label>Weapon</label>
    <select
      class="grow"
      value={salvo.selectedWeaponId ?? ""}
      onchange={(e) => {
        salvo.selectedWeaponId = (e.currentTarget as HTMLSelectElement).value || null;
        salvo.selectedProfileIndex = 0;
      }}
    >
      {#each weapons as w (w.id)}
        <option value={w.id}>{w.name} ({w.raw.type})</option>
      {/each}
    </select>
  </div>

  {#if profiles.length > 1}
    <div class="row">
      <label>Profile</label>
      <select
        class="grow"
        value={salvo.selectedProfileIndex}
        onchange={(e) => (salvo.selectedProfileIndex = Number((e.currentTarget as HTMLSelectElement).value))}
      >
        {#each profiles as p, i (i)}
          <option value={i}>{p.name}</option>
        {/each}
      </select>
    </div>
  {/if}

  <div class="row">
    <label>Models firing</label>
    <input
      type="number"
      min="1"
      style="width:80px"
      value={salvo.modelsFiring}
      oninput={(e) => (salvo.modelsFiring = Math.max(1, Number((e.currentTarget as HTMLInputElement).value)))}
    />
    <span class="dim">of {selectedUnit.raw.model_count?.max ?? "?"}</span>
  </div>
{:else}
  <p class="dim" style="font-size:12px">Pick a faction + unit (or import a roster).</p>
{/if}
