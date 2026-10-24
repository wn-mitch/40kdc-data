<script lang="ts">
  import { salvo, ds } from "./store.svelte.js";
  import {
    buildMatrix,
    resolveTarget,
    cellValue,
    matrixToMarkdown,
    enumerateLoadouts,
    rankLoadouts,
    type ResolvedTarget,
    type LoadoutRanking,
  } from "./compare-model.js";
  import EmptyState from "./EmptyState.svelte";

  const factions = $derived(
    ds.factions.all.slice().sort((a, b) => a.name.localeCompare(b.name)),
  );

  const allProfiles = $derived(
    ds.targetProfiles.all.slice().sort((a, b) => a.name.localeCompare(b.name)),
  );

  // Empty selection means "all profiles".
  const selectedProfileIds = $derived(
    salvo.compareTargetIds.length > 0
      ? salvo.compareTargetIds
      : allProfiles.map((p) => p.id),
  );

  const targets = $derived.by<ResolvedTarget[]>(() =>
    selectedProfileIds
      .map((id) => ds.targetProfiles.get(id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
      .map((p) => resolveTarget(ds, p))
      .filter((t): t is ResolvedTarget => t !== null),
  );

  const attackers = $derived(
    salvo.compareFactionId
      ? ds.units.all
          .filter((u) => u.raw.faction_id === salvo.compareFactionId)
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
  );

  const matrix = $derived.by(() => {
    if (!salvo.compareFactionId || attackers.length === 0 || targets.length === 0) {
      return [];
    }
    return buildMatrix(
      ds,
      attackers,
      targets,
      salvo.compareDistance,
      salvo.comparePhase,
      "best-weapon",
    );
  });

  // --- Loadouts sub-mode -------------------------------------------------
  const loadoutResult = $derived.by<{ value: ReturnType<typeof enumerateLoadouts> | null; error?: string }>(() => {
    if (salvo.compareMode !== "loadouts" || !salvo.compareFactionId || !salvo.compareLoadoutUnitId) {
      return { value: null };
    }
    try {
      return { value: enumerateLoadouts(ds, salvo.compareFactionId, salvo.compareLoadoutUnitId) };
    } catch (err) {
      return { value: null, error: (err as Error).message };
    }
  });
  const loadoutEnum = $derived(loadoutResult.value);

  const loadoutRankings = $derived.by<LoadoutRanking[]>(() => {
    if (!loadoutEnum || loadoutEnum.configs.length === 0 || targets.length === 0) return [];
    return rankLoadouts(
      ds,
      loadoutEnum.configs,
      targets,
      salvo.compareDistance,
      salvo.comparePhase,
    );
  });

  function toggleProfile(id: string): void {
    const set = new Set(salvo.compareTargetIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    salvo.compareTargetIds = [...set];
  }

  let copied = $state(false);
  async function exportMarkdown(): Promise<void> {
    const md = matrixToMarkdown(matrix, targets, "best-weapon");
    try {
      await navigator.clipboard.writeText(md);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard blocked (e.g. insecure context) — no-op; the table is on screen.
    }
  }
</script>

<div class="controls">
  <div class="row">
    <div class="phase-toggle mode-toggle">
      <button class:active={salvo.compareMode === "matrix"} onclick={() => (salvo.compareMode = "matrix")}>Unit × target matrix</button>
      <button class:active={salvo.compareMode === "loadouts"} onclick={() => (salvo.compareMode = "loadouts")}>Best loadout</button>
    </div>
  </div>

  <div class="row">
    <label for="cmp-faction">Attacker faction</label>
    <select
      id="cmp-faction"
      class="grow"
      value={salvo.compareFactionId ?? ""}
      onchange={(e) =>
        (salvo.compareFactionId = (e.currentTarget as HTMLSelectElement).value || null)}
    >
      <option value="">— pick a faction —</option>
      {#each factions as f (f.id)}
        <option value={f.id}>{f.name}</option>
      {/each}
    </select>
  </div>

  {#if loadoutResult.error}
    <p class="error" role="alert">Loadouts could not be enumerated: {loadoutResult.error}</p>
  {/if}
  {#if salvo.compareMode === "loadouts"}
    <div class="row">
      <label for="cmp-unit">Unit</label>
      <select
        id="cmp-unit"
        class="grow"
        value={salvo.compareLoadoutUnitId ?? ""}
        onchange={(e) =>
          (salvo.compareLoadoutUnitId = (e.currentTarget as HTMLSelectElement).value || null)}
      >
        <option value="">— pick a unit —</option>
        {#each attackers as u (`${u.raw.faction_id}/${u.id}`)}
          <option value={u.id}>{u.name}</option>
        {/each}
      </select>
    </div>
  {/if}

  <div class="row">
    <label for="cmp-distance">Distance (")</label>
    <input
      id="cmp-distance"
      type="number"
      min="1"
      max="72"
      bind:value={salvo.compareDistance}
    />
    <div class="phase-toggle">
      {#each ["shooting", "fight"] as const as ph (ph)}
        <button
          class:active={salvo.comparePhase === ph}
          onclick={() => (salvo.comparePhase = ph)}>{ph}</button
        >
      {/each}
    </div>
  </div>

  <div class="profiles">
    <span class="profiles-label">Targets</span>
    <div class="chips">
      {#each allProfiles as p (p.id)}
        <label class="chip" class:on={selectedProfileIds.includes(p.id)}>
          <input
            type="checkbox"
            checked={salvo.compareTargetIds.includes(p.id)}
            onchange={() => toggleProfile(p.id)}
          />
          {p.name}
        </label>
      {/each}
      {#if salvo.compareTargetIds.length === 0}
        <span class="hint">all profiles</span>
      {/if}
    </div>
  </div>
</div>

{#if salvo.compareMode === "matrix"}
  {#if matrix.length === 0}
    <EmptyState>Pick an attacker faction to rank its units against the target archetypes.</EmptyState>
  {:else}
    <div class="actions">
      <span class="caption">
        Expected models killed per model firing each unit's best {salvo.comparePhase} weapon at
        {salvo.compareDistance}". Bold ≥ 1.0.
      </span>
      <button onclick={exportMarkdown}>{copied ? "Copied!" : "Export markdown"}</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="unit-col">Unit</th>
            {#each targets as t (t.profileId)}
              <th title={t.profileName}>{t.profileName}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each matrix as row (row.unitId)}
            <tr>
              <td class="unit-col">{row.unitName}</td>
              {#each row.cells as cell (cell.targetProfileId)}
                {@const v = cellValue(cell, "best-weapon")}
                <td
                  class:strong={v >= 1}
                  class:zero={v === 0}
                  title={cell.best
                    ? `${cell.best.weaponName}${cell.best.withinHalfRange ? " (half range)" : ""}`
                    : "no weapon reaches"}
                >
                  {v ? v.toFixed(2) : "—"}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{:else if loadoutRankings.length === 0}
  <EmptyState>Pick an attacker faction and a unit to rank its shooting loadouts.</EmptyState>
{:else}
  <div class="actions">
    <span class="caption">
      Models killed per loadout at {salvo.compareDistance}" (damage totalled across the loadout,
      then capped). Counts default to 1 per weapon — the dataset doesn't store mount counts, so
      compare slots relatively. Bold ≥ 1.0.
    </span>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="unit-col">Loadout</th>
          {#each targets as t (t.profileId)}
            <th title={t.profileName}>{t.profileName}</th>
          {/each}
          <th title="summed damage per 100 points">Dmg/100pt</th>
        </tr>
      </thead>
      <tbody>
        {#each loadoutRankings as r (r.config.label)}
          <tr>
            <td class="unit-col" title={r.config.label}>{r.config.label}</td>
            {#each r.results as res (res.targetProfileId)}
              <td class:strong={res.kills >= 1} class:zero={res.kills === 0}>
                {res.kills ? res.kills.toFixed(2) : "—"}
              </td>
            {/each}
            <td>{r.scorePer100Points !== null ? r.scorePer100Points.toFixed(1) : "—"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .row label {
    min-width: 110px;
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .row input[type="number"] {
    width: 80px;
  }
  .phase-toggle {
    display: flex;
    gap: 2px;
    margin-left: auto;
  }
  .phase-toggle button.active {
    background: var(--accent, #444);
    color: #fff;
  }
  .profiles {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
  }
  .profiles-label {
    min-width: 110px;
    color: var(--muted);
    font-size: var(--text-xs);
    padding-top: 4px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--text-xs);
    padding: 2px 6px;
    border: 1px solid var(--border, #333);
    border-radius: 4px;
    cursor: pointer;
  }
  .chip.on {
    border-color: var(--accent, #777);
  }
  .hint {
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .caption {
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .table-wrap {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    font-size: var(--text-sm);
    width: 100%;
  }
  th,
  td {
    padding: 4px 8px;
    text-align: right;
    border-bottom: 1px solid var(--border, #2a2a2a);
    white-space: nowrap;
  }
  th {
    color: var(--muted);
    font-weight: 500;
    font-size: var(--text-xs);
  }
  .unit-col {
    text-align: left;
    position: sticky;
    left: 0;
    background: var(--bg, #1a1a1a);
  }
  td.strong {
    font-weight: 700;
    color: var(--accent-text, #e8e8e8);
  }
  td.zero {
    color: var(--muted);
  }
</style>
