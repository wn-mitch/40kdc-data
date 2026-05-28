<script lang="ts">
  import {
    salvo,
    ds,
    MANUAL_BUFF_TOGGLES,
    type ManualTarget,
  } from "./store.svelte.js";
  import {
    crunch,
    resolveBuffs,
    type Buff,
    type EngineContext,
    type EngineInput,
    type Unit,
  } from "@alpaca-software/40kdc-data";

  function synthTarget(t: ManualTarget): Unit {
    return {
      id: "salvo-manual-target",
      name: "Manual target",
      faction_id: "salvo-manual",
      profiles: [
        {
          name: "manual",
          M: 6,
          T: t.T,
          W: t.W,
          Sv: t.Sv,
          ...(t.invuln !== null ? { invuln_sv: t.invuln } : {}),
          Ld: 7,
          OC: 1,
        },
      ],
      keywords: t.keywords,
      faction_keywords: [],
      model_count: { min: t.modelCount, max: t.modelCount },
      game_version: { edition: "11th", dataslate: "pre-launch-provisional" },
    } as Unit;
  }

  const context = $derived<EngineContext>({
    phase: salvo.phase,
    attackerStationary: salvo.contextFlags.attackerStationary,
    withinHalfRange: salvo.contextFlags.withinHalfRange,
    targetInCover: salvo.manualBuffsActive.has("cover"),
  });

  const datasetBuffs = $derived.by<Buff[]>(() => {
    if (!salvo.selectedUnitId || !salvo.selectedWeaponId) return [];
    try {
      // Single source of truth with the abilities pane: enumerate every lever,
      // then keep the ones the user has on (defaults + their overrides).
      const { buffs } = ds.stackableBuffsFor(
        {
          unitId: salvo.selectedUnitId,
          factionId: salvo.selectedFactionId ?? undefined,
          detachmentId: salvo.selectedDetachmentId ?? undefined,
          attachedLeaderId: salvo.attachedLeaderId ?? undefined,
          weaponProfiles: [
            { weaponId: salvo.selectedWeaponId, profileIndex: salvo.selectedProfileIndex },
          ],
        },
        context,
      );
      return buffs
        .filter((b) => salvo.isBuffEnabled(b.id, b.enabled))
        .flatMap((b) => b.buffs);
    } catch {
      return [];
    }
  });

  const manualBuffs = $derived<Buff[]>(
    MANUAL_BUFF_TOGGLES.filter((t) => salvo.manualBuffsActive.has(t.id)).map((t) =>
      t.build(),
    ),
  );

  const defensiveBuffs = $derived.by<Buff[]>(() => {
    // Defensive abilities for the target — only meaningful when the target
    // is a dataset/roster unit, not the manual stat block.
    if (salvo.targetMode === "manual") return [];
    const targetUnitId =
      salvo.targetMode === "dataset"
        ? salvo.datasetTargetUnitId
        : salvo.targetRoster?.units[salvo.rosterTargetUnitIndex ?? -1]?.ref.id ?? null;
    if (!targetUnitId) return [];
    const tUnit = ds.units.get(targetUnitId);
    if (!tUnit) return [];
    try {
      return ds.defensiveBuffsFor(
        { unitId: tUnit.id, factionId: tUnit.raw.faction_id },
        context,
      );
    } catch {
      return [];
    }
  });

  const allBuffs = $derived<Buff[]>([...datasetBuffs, ...manualBuffs, ...defensiveBuffs]);

  const projection = $derived.by(() => {
    if (!salvo.selectedUnitId || !salvo.selectedWeaponId) return null;
    const weapon = ds.weapons.get(salvo.selectedWeaponId);
    if (!weapon) return null;
    try {
      const target = synthTarget(salvo.manualTarget);
      const input: EngineInput = {
        attacker: {
          weapon: weapon.raw,
          profileIndex: salvo.selectedProfileIndex,
        },
        target: {
          unit: target,
          profileIndex: 0,
          modelCount: salvo.manualTarget.modelCount,
        },
        modelsFiring: salvo.modelsFiring,
        buffs: allBuffs,
        context,
      };
      return crunch(input, ds);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  const resolved = $derived.by(() => {
    if (!projection || "error" in projection) return null;
    try {
      return resolveBuffs(allBuffs, context);
    } catch {
      return null;
    }
  });

  let showDebug = $state(false);

  function fmt(n: number): string {
    return Number.isFinite(n) ? n.toFixed(2) : "—";
  }
</script>

{#if !projection}
  <p class="dim" style="font-size:12px">Pick a unit, weapon, and target to see a projection.</p>
{:else if "error" in projection}
  <div class="error">{projection.error}</div>
{:else}
  {@const stages = projection.stages}
  <table class="stages">
    <thead>
      <tr>
        <th>Stage</th>
        <th style="text-align:right">Expected</th>
        <th>Detail</th>
      </tr>
    </thead>
    <tbody>
      {#each stages as s (s.name)}
        <tr class:total={s.name === "models-killed"}>
          <td>{s.name}</td>
          <td class="value">{fmt(s.expected)}</td>
          <td class="dim">{s.detail}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="row" style="margin-top:14px">
    <button onclick={() => (showDebug = !showDebug)}>
      {showDebug ? "Hide" : "Show"} resolved modifiers
    </button>
    <span class="dim">{allBuffs.length} buff(s) in play</span>
  </div>

  {#if showDebug && resolved}
    <pre style="background:var(--panel-2);padding:8px;border-radius:4px;font-size:11px;overflow-x:auto;max-height:240px">{JSON.stringify(
        resolved,
        null,
        2,
      )}</pre>
  {/if}
{/if}
