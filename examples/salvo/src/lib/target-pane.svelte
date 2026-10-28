<script lang="ts">
  import { salvo, ds } from "./store.svelte.js";
  import { resolveRosterUnit } from "@alpaca-software/40kdc-data";
  import EmptyState from "./EmptyState.svelte";
  import DefenderBuild from "./defender-build.svelte";

  const factions = $derived(
    ds.factions.all.slice().sort((a, b) => a.name.localeCompare(b.name)),
  );

  const targetPresets = $derived(
    ds.targetProfiles.all.slice().sort((a, b) => a.name.localeCompare(b.name)),
  );

  const datasetUnits = $derived.by(() => {
    const all = ds.units.all
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    return salvo.datasetTargetFactionId
      ? all.filter((u) => u.raw.faction_id === salvo.datasetTargetFactionId)
      : all;
  });

  // If the current dataset target pick falls outside the new faction filter,
  // clear it so the dropdown doesn't display a stale value.
  $effect(() => {
    if (!salvo.datasetTargetUnitId || !salvo.datasetTargetFactionId) return;
    const u = ds.units.getAny(salvo.datasetTargetUnitId);
    if (!u || u.raw.faction_id !== salvo.datasetTargetFactionId) {
      salvo.datasetTargetUnitId = null;
    }
  });

  // Disambiguate shared chassis (e.g. Hellbrute under multiple factions) by
  // appending faction context only when the same name appears more than once.
  const sharedDatasetNames = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const u of datasetUnits) {
      counts.set(u.name, (counts.get(u.name) ?? 0) + 1);
    }
    return new Set(
      Array.from(counts.entries())
        .filter(([, n]) => n > 1)
        .map(([name]) => name),
    );
  });

  const rosterPicks = $derived(
    (salvo.targetRoster?.units ?? [])
      .map((ru, i) => ({ ru, i, view: resolveRosterUnit(ru, ds) }))
      .filter((x) => x.view !== undefined),
  );

  // Pre-fill manual stats from the picked dataset unit.
  $effect(() => {
    if (salvo.targetMode !== "dataset" || !salvo.datasetTargetUnitId) return;
    const u = ds.units.getAny(salvo.datasetTargetUnitId);
    if (!u) return;
    const p = u.raw.profiles[0];
    if (!p) return;
    // A selected preset may override the squad size; otherwise use the unit's
    // minimum. The override only applies while the preset still points at this
    // unit (it's cleared when the user picks a unit by hand).
    const preset = salvo.targetPresetId ? ds.targetProfiles.get(salvo.targetPresetId) : undefined;
    const override =
      preset && preset.unit_id === u.id && preset.faction_id === u.raw.faction_id
        ? preset.model_count_override
        : null;
    salvo.manualTarget = {
      T: typeof p.T === "number" ? p.T : 4,
      Sv: typeof p.Sv === "number" ? p.Sv : 3,
      invuln: typeof p.invuln_sv === "number" ? p.invuln_sv : null,
      W: typeof p.W === "number" ? p.W : 1,
      modelCount: override ?? u.raw.model_count?.min ?? 1,
      fnp: null,
      keywords: [
        ...((u.raw.keywords ?? []) as string[]),
        ...((u.raw.faction_keywords ?? []) as string[]),
      ],
    };
  });

  // Same for roster-selected target.
  $effect(() => {
    if (salvo.targetMode !== "roster" || salvo.rosterTargetUnitIndex === null) return;
    const entry = salvo.targetRoster?.units[salvo.rosterTargetUnitIndex];
    if (!entry) return;
    const u = resolveRosterUnit(entry, ds);
    if (!u) return;
    const p = u.raw.profiles[0];
    if (!p) return;
    salvo.manualTarget = {
      T: typeof p.T === "number" ? p.T : 4,
      Sv: typeof p.Sv === "number" ? p.Sv : 3,
      invuln: typeof p.invuln_sv === "number" ? p.invuln_sv : null,
      W: typeof p.W === "number" ? p.W : 1,
      modelCount: entry.model_count,
      fnp: null,
      keywords: [
        ...((u.raw.keywords ?? []) as string[]),
        ...((u.raw.faction_keywords ?? []) as string[]),
      ],
    };
  });
</script>

<div class="tabs" role="group" aria-label="Target source">
  <button class:active={salvo.targetMode === "dataset"} aria-pressed={salvo.targetMode === "dataset"} onclick={() => salvo.selectTargetMode("dataset")}>Dataset</button>
  <button
    class:active={salvo.targetMode === "roster"}
    aria-pressed={salvo.targetMode === "roster"}
    disabled={!salvo.targetRoster}
    title={salvo.targetRoster ? undefined : "Import a target list first"}
    onclick={() => salvo.selectTargetMode("roster")}>Imported list</button
  >
  <button class:active={salvo.targetMode === "manual"} aria-pressed={salvo.targetMode === "manual"} onclick={() => salvo.selectTargetMode("manual")}>Manual</button>
</div>

{#if salvo.targetMode === "dataset"}
  <div class="row">
    <label for="tgt-preset">Preset</label>
    <select
      id="tgt-preset"
      class="grow"
      value={salvo.targetPresetId ?? ""}
      onchange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        if (v) salvo.applyTargetPreset(v);
        else salvo.targetPresetId = null;
      }}
    >
      <option value="">Archetype preset (optional)</option>
      {#each targetPresets as p (p.id)}
        <option value={p.id}>{p.name}</option>
      {/each}
    </select>
  </div>
  <div class="row">
    <label for="tgt-faction">Faction</label>
    <select
      id="tgt-faction"
      class="grow"
      value={salvo.datasetTargetFactionId ?? ""}
      onchange={(e) => {
        salvo.targetPresetId = null;
        salvo.datasetTargetFactionId =
          (e.currentTarget as HTMLSelectElement).value || null;
      }}
    >
      <option value="">— any —</option>
      {#each factions as f (f.id)}
        <option value={f.id}>{f.name}</option>
      {/each}
    </select>
  </div>
  <div class="row">
    <label for="tgt-unit">Unit</label>
    <select
      id="tgt-unit"
      class="grow"
      value={salvo.datasetTargetUnitId ?? ""}
      onchange={(e) => {
        salvo.targetPresetId = null;
        salvo.datasetTargetUnitId = (e.currentTarget as HTMLSelectElement).value || null;
      }}
    >
      <option value="">Pick a target unit</option>
      {#each datasetUnits as u (`${u.raw.faction_id}/${u.id}`)}
        <option value={u.id}>
          {u.name}{sharedDatasetNames.has(u.name)
            ? ` · ${u.faction?.name ?? u.raw.faction_id}`
            : ""}
        </option>
      {/each}
    </select>
  </div>
{:else if salvo.targetMode === "roster"}
  {#if rosterPicks.length === 0}
    <EmptyState>Paste the opponent's list under "Target" in Import roster.</EmptyState>
  {:else}
    <div class="row">
      <label for="tgt-roster-unit">Unit</label>
      <select
        id="tgt-roster-unit"
        class="grow"
        value={salvo.rosterTargetUnitIndex ?? ""}
        onchange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          salvo.rosterTargetUnitIndex = v === "" ? null : Number(v);
        }}
      >
        <option value="">Pick a target unit</option>
        {#each rosterPicks as p (p.i)}
          <option value={p.i}>{p.view!.name} ({p.ru.model_count} models)</option>
        {/each}
      </select>
    </div>
  {/if}
{/if}

{#if salvo.targetMode === "manual"}
  <p class="hint dim">Enter the target's profile. Picking a unit fills these in.</p>
{/if}
<div class="stats-grid" role="group" aria-label="Target profile">
  <label class="stat-row">
    <span class="stat-label" title="Toughness">T</span>
    <input aria-label="Toughness" type="number" min="1" bind:value={salvo.manualTarget.T} />
  </label>
  <label class="stat-row">
    <span class="stat-label" title="Save">Sv</span>
    <input aria-label="Save" type="number" min="2" max="7" bind:value={salvo.manualTarget.Sv} />
  </label>
  <label class="stat-row">
    <span class="stat-label" title="Invulnerable save">Inv</span>
    <input aria-label="Invulnerable save"
      type="number"
      min="2"
      max="7"
      value={salvo.manualTarget.invuln ?? ""}
      placeholder="—"
      oninput={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value;
        salvo.manualTarget = { ...salvo.manualTarget, invuln: v === "" ? null : Number(v) };
      }}
    />
  </label>
  <label class="stat-row">
    <span class="stat-label" title="Wounds">W</span>
    <input aria-label="Wounds" type="number" min="1" bind:value={salvo.manualTarget.W} />
  </label>
  <label class="stat-row">
    <span class="stat-label">Models</span>
    <input type="number" min="1" bind:value={salvo.manualTarget.modelCount} />
  </label>
  <label class="stat-row">
    <span class="stat-label" title="Feel No Pain">FNP</span>
    <input aria-label="Feel No Pain"
      type="number"
      min="2"
      max="7"
      value={salvo.manualTarget.fnp ?? ""}
      placeholder="—"
      oninput={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value;
        salvo.manualTarget = { ...salvo.manualTarget, fnp: v === "" ? null : Number(v) };
      }}
    />
  </label>
</div>

<div class="row keywords-row">
  <label for="tgt-keywords">Keywords</label>
  <input
    id="tgt-keywords"
    class="grow"
    type="text"
    placeholder="comma-separated, e.g. infantry, vehicle"
    value={salvo.manualTarget.keywords.join(", ")}
    oninput={(e) => {
      const raw = (e.currentTarget as HTMLInputElement).value;
      salvo.manualTarget = {
        ...salvo.manualTarget,
        keywords: raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    }}
  />
</div>

<DefenderBuild />

<style>
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .stat-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .stat-label {
    min-width: 46px;
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .stat-row input { flex: 1; min-width: 0; }
  .keywords-row { margin-top: var(--space-2); }
  .hint { margin: 0 0 var(--space-2); font-size: var(--text-xs); }
</style>
