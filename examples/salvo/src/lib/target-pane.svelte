<script lang="ts">
  import { salvo, ds } from "./store.svelte.js";
  import { resolveRosterUnit } from "@alpaca-software/40kdc-data";

  const datasetUnits = $derived(
    ds.units.all.slice().sort((a, b) => a.name.localeCompare(b.name)),
  );

  const rosterPicks = $derived(
    (salvo.targetRoster?.units ?? [])
      .map((ru, i) => ({ ru, i, view: resolveRosterUnit(ru, ds) }))
      .filter((x) => x.view !== undefined),
  );

  // Pre-fill manual stats from the picked dataset unit.
  $effect(() => {
    if (salvo.targetMode !== "dataset" || !salvo.datasetTargetUnitId) return;
    const u = ds.units.get(salvo.datasetTargetUnitId);
    if (!u) return;
    const p = u.raw.profiles[0];
    if (!p) return;
    salvo.manualTarget = {
      T: typeof p.T === "number" ? p.T : 4,
      Sv: typeof p.Sv === "number" ? p.Sv : 3,
      invuln: typeof p.invuln_sv === "number" ? p.invuln_sv : null,
      W: typeof p.W === "number" ? p.W : 1,
      modelCount: u.raw.model_count?.min ?? 1,
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

<div class="tabs">
  <button class:active={salvo.targetMode === "manual"} onclick={() => (salvo.targetMode = "manual")}>Manual</button>
  <button class:active={salvo.targetMode === "dataset"} onclick={() => (salvo.targetMode = "dataset")}>Dataset</button>
  <button
    class:active={salvo.targetMode === "roster"}
    disabled={!salvo.targetRoster}
    onclick={() => (salvo.targetMode = "roster")}>Imported list</button
  >
</div>

{#if salvo.targetMode === "dataset"}
  <div class="row">
    <label>Unit</label>
    <select
      class="grow"
      value={salvo.datasetTargetUnitId ?? ""}
      onchange={(e) => (salvo.datasetTargetUnitId = (e.currentTarget as HTMLSelectElement).value || null)}
    >
      <option value="">— pick a target unit —</option>
      {#each datasetUnits as u (`${u.raw.faction_id}/${u.id}`)}
        <option value={u.id}>{u.name}</option>
      {/each}
    </select>
  </div>
{:else if salvo.targetMode === "roster"}
  {#if rosterPicks.length === 0}
    <p class="dim" style="font-size:12px">Import a target list in the Import pane.</p>
  {:else}
    <div class="row">
      <label>Unit</label>
      <select
        class="grow"
        value={salvo.rosterTargetUnitIndex ?? ""}
        onchange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          salvo.rosterTargetUnitIndex = v === "" ? null : Number(v);
        }}
      >
        <option value="">— pick a target unit —</option>
        {#each rosterPicks as p (p.i)}
          <option value={p.i}>{p.view!.name} ({p.ru.model_count} models)</option>
        {/each}
      </select>
    </div>
  {/if}
{/if}

<div class="grid-2" style="margin-top:8px">
  <label class="row" style="margin:0">
    <span style="min-width:50px">T</span>
    <input type="number" min="1" bind:value={salvo.manualTarget.T} />
  </label>
  <label class="row" style="margin:0">
    <span style="min-width:50px">Sv</span>
    <input type="number" min="2" max="7" bind:value={salvo.manualTarget.Sv} />
  </label>
  <label class="row" style="margin:0">
    <span style="min-width:50px">Inv</span>
    <input
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
  <label class="row" style="margin:0">
    <span style="min-width:50px">W</span>
    <input type="number" min="1" bind:value={salvo.manualTarget.W} />
  </label>
  <label class="row" style="margin:0">
    <span style="min-width:50px">Models</span>
    <input type="number" min="1" bind:value={salvo.manualTarget.modelCount} />
  </label>
  <label class="row" style="margin:0">
    <span style="min-width:50px">FNP</span>
    <input
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

<div class="row" style="margin-top:8px">
  <label>Keywords</label>
  <input
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
