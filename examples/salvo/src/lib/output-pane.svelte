<script lang="ts">
  import {
    salvo,
    ds,
    MANUAL_BUFF_TOGGLES,
    weaponTypeForPhase,
    type ManualTarget,
  } from "./store.svelte.js";
  import { SvelteSet, SvelteMap } from "svelte/reactivity";
  import {
    attributeStages,
    crunch,
    resolveBuffs,
    type AttributedStage,
    type Buff,
    type BuffSource,
    type EngineContext,
    type EngineInput,
    type StackableBuff,
    type Stage,
    type StageLift,
    type Unit,
    type Weapon,
  } from "@alpaca-software/40kdc-data";
  import EmptyState from "./EmptyState.svelte";
  import { buildDebugSnapshot } from "./debug-export.js";

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
    attackerCharged: salvo.contextFlags.attackerCharged,
    targetInCover: salvo.manualBuffsActive.has("cover"),
    attackerAttached: salvo.attachedUnitIds.length > 0,
  });

  // Ability/army/detachment/attached levers — weapon-independent, shared by
  // every weapon line. We pass no weaponProfiles: each line's intrinsic weapon
  // keywords are auto-injected by crunch (engine.ts profileBuffsFor), so adding
  // them here too would double-count additive keyword effects.
  const stackable = $derived.by<StackableBuff[]>(() => {
    if (!salvo.selectedUnitId) return [];
    try {
      const { buffs } = ds.stackableBuffsFor(
        {
          unitId: salvo.selectedUnitId,
          factionId: salvo.selectedFactionId ?? undefined,
          detachmentId: salvo.selectedDetachmentId ?? undefined,
          attachedUnitIds: salvo.attachedUnitIds,
          weaponProfiles: [],
        },
        context,
      );
      return buffs;
    } catch {
      return [];
    }
  });

  const datasetBuffs = $derived<Buff[]>(
    stackable
      // Weapon-keyword buffs are injected per-line by the engine; never share them.
      .filter((b) => b.source.kind !== "weapon-keyword")
      .filter((b) => salvo.isBuffEnabled(b.id, b.enabled))
      .flatMap((b) => b.buffs),
  );

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

  // The combined unit declares all its attacks at once: one line per profile of
  // every phase-eligible weapon across the selected unit AND its attached
  // members. Each line carries its owning member so volume (model count) and the
  // disambiguating label come from the right unit.
  type WeaponLine = {
    id: string;
    weaponId: string;
    profileIndex: number;
    label: string;
    weaponRaw: Weapon;
    ownerMemberId: string;
    defaultModels: number;
  };
  const weaponLines = $derived.by<WeaponLine[]>(() => {
    const members = [salvo.selectedUnitId, ...salvo.attachedUnitIds].filter(
      (id): id is string => !!id,
    );
    const multiMember = members.length > 1;
    const lines: WeaponLine[] = [];
    for (const memberId of members) {
      const unit = ds.units.get(memberId);
      if (!unit) continue;
      const defaultModels = unit.raw.model_count?.min ?? 1;
      for (const w of unit.weapons) {
        if (w.raw.type !== weaponTypeForPhase(salvo.phase)) continue;
        w.raw.profiles.forEach((p, profileIndex) => {
          const weaponPart =
            w.raw.profiles.length > 1 ? `${w.name} — ${p.name}` : w.name;
          lines.push({
            id: `${memberId}:${w.id}:${profileIndex}`,
            weaponId: w.id,
            profileIndex,
            label: multiMember ? `${unit.name} · ${weaponPart}` : weaponPart,
            weaponRaw: w.raw,
            ownerMemberId: memberId,
            defaultModels,
          });
        });
      }
    }
    return lines;
  });

  // Per-line model count (volume). Read-with-default from an override map — no
  // $effect seeds it, so lines appearing after a unit/phase change fall through
  // to their owning member's model count without a fresh-ref write that would
  // trip Svelte's update-depth guard.
  const modelsOverrides = $state(new SvelteMap<string, number>());
  function modelsFor(line: WeaponLine): number {
    return modelsOverrides.get(line.id) ?? line.defaultModels;
  }
  function setModels(id: string, n: number): void {
    modelsOverrides.set(id, Math.max(1, Math.floor(n) || 1));
  }

  // Crunch every line with the shared (weapon-agnostic) buff stack and that
  // line's own model count. The engine injects each weapon's intrinsic
  // keywords. attributeStages runs the leave-one-out decomposition so each
  // cell can show which toggleable buffs lifted it.
  const lineResults = $derived.by(() => {
    return weaponLines.map((line) => {
      try {
        const target = synthTarget(salvo.manualTarget);
        const attributed = attributeStages(
          {
            attacker: { weapon: line.weaponRaw, profileIndex: line.profileIndex },
            target: { unit: target, profileIndex: 0, modelCount: salvo.manualTarget.modelCount },
            modelsFiring: modelsFor(line),
            buffs: allBuffs,
            context,
          },
          ds,
        );
        return { ...line, attributed, error: undefined as string | undefined };
      } catch (err) {
        return { ...line, attributed: [] as AttributedStage[], error: (err as Error).message };
      }
    });
  });

  /** The 7 pipeline stages as ordered columns, abbreviated with a full title. */
  const STAGE_COLUMNS: { name: Stage["name"]; short: string; full: string }[] = [
    { name: "attacks", short: "Atk", full: "Attacks" },
    { name: "hits", short: "Hit", full: "Hits" },
    { name: "wounds", short: "Wnd", full: "Wounds" },
    { name: "unsaved", short: "Uns", full: "Unsaved" },
    { name: "damage", short: "Dmg", full: "Damage" },
    { name: "after-fnp", short: "FNP", full: "After FNP" },
    { name: "models-killed", short: "Kill", full: "Models killed" },
  ];

  function stageOf(attributed: AttributedStage[], name: Stage["name"]): AttributedStage | undefined {
    return attributed.find((s) => s.name === name);
  }

  /** Stable per-source key — mirrors the engine's buff grouping. */
  function srcKey(s: BuffSource): string {
    if (s.kind === "ability") return `a:${s.abilityId}:${s.sourceUnitId ?? ""}`;
    if (s.kind === "manual") return `m:${s.label}`;
    return `w:${s.weaponId}:${s.keywordId}`;
  }

  /** Human label for a buff source, resolving ability/unit names from the dataset. */
  function labelForSource(s: BuffSource): string {
    if (s.kind === "manual") return s.label;
    if (s.kind === "weapon-keyword") return s.keywordId;
    const name = ds.abilities.get(s.abilityId)?.name ?? s.abilityId;
    if (s.abilityKind === "attached" && s.sourceUnitId) {
      const unit = ds.units.get(s.sourceUnitId)?.name ?? s.sourceUnitId;
      return `${name} · ${unit}`;
    }
    return name;
  }

  // Excluded set (default empty = all included). An exclude-set means lines
  // that appear after a unit/phase change are included with no $effect — so we
  // never write a fresh Set into an effect that reads the same state.
  const excludedLines = $state(new SvelteSet<string>());
  function toggleLine(id: string): void {
    if (excludedLines.has(id)) excludedLines.delete(id);
    else excludedLines.add(id);
  }
  const EPS = 1e-6;

  // The "Combined" row: one AttributedStage per pipeline stage, decomposed the
  // same way per-line cells are so the aggregate cells hover too. Stages 1–6
  // sum by linearity (expected, baseline, residual, and per-source lifts all
  // add); models-killed is NOT additive — its lift is recomputed through the
  // cap formula on the summed after-fnp, never summed from per-line kills.
  const aggregate = $derived.by<AttributedStage[]>(() => {
    const included = lineResults.filter((r) => !excludedLines.has(r.id) && !r.error);
    const W = salvo.manualTarget.W;
    const modelCount = salvo.manualTarget.modelCount;
    const killed = (afterFnp: number) => (W > 0 ? Math.min(modelCount, afterFnp / W) : 0);

    // Sum a source-keyed lift map across the included lines for one stage.
    function sumLifts(name: Stage["name"]): Map<string, StageLift> {
      const map = new Map<string, StageLift>();
      for (const r of included) {
        for (const l of stageOf(r.attributed, name)?.lifts ?? []) {
          const key = srcKey(l.source);
          const cur = map.get(key);
          if (cur) cur.delta += l.delta;
          else map.set(key, { source: l.source, delta: l.delta });
        }
      }
      return map;
    }

    const out: AttributedStage[] = [];
    const additive: Stage["name"][] = ["attacks", "hits", "wounds", "unsaved", "damage", "after-fnp"];
    for (const name of additive) {
      let expected = 0;
      let baseline = 0;
      let residual = 0;
      const intrinsics = new Set<string>();
      for (const r of included) {
        const s = stageOf(r.attributed, name);
        if (!s) continue;
        expected += s.expected;
        baseline += s.baseline;
        residual += s.residual;
        for (const k of s.intrinsics) intrinsics.add(k);
      }
      out.push({
        name,
        expected,
        detail: name === "attacks" ? `${included.length} weapon line(s)` : "",
        baseline,
        lifts: [...sumLifts(name).values()].filter((l) => Math.abs(l.delta) > EPS),
        residual: Math.abs(residual) > EPS ? residual : 0,
        intrinsics: [...intrinsics],
      });
    }

    // models-killed via the aggregate (non-additive) path.
    const sumAfterFnp = included.reduce(
      (s, r) => s + (stageOf(r.attributed, "after-fnp")?.expected ?? 0),
      0,
    );
    const sumAfterFnpBaseline = included.reduce(
      (s, r) => s + (stageOf(r.attributed, "after-fnp")?.baseline ?? 0),
      0,
    );
    const killedExpected = killed(sumAfterFnp);
    const killedBaseline = killed(sumAfterFnpBaseline);
    const killedLifts: StageLift[] = [];
    let killedLiftSum = 0;
    for (const { source, delta } of sumLifts("after-fnp").values()) {
      const d = killedExpected - killed(sumAfterFnp - delta);
      killedLiftSum += d;
      if (Math.abs(d) > EPS) killedLifts.push({ source, delta: d });
    }
    const killedResidual = killedExpected - killedBaseline - killedLiftSum;
    out.push({
      name: "models-killed",
      expected: killedExpected,
      detail: `W${W} per model, capped at ${modelCount}`,
      baseline: killedBaseline,
      lifts: killedLifts,
      residual: Math.abs(killedResidual) > EPS ? killedResidual : 0,
      intrinsics: [],
    });
    return out;
  });

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
  let copied = $state(false);

  function fmt(n: number): string {
    return Number.isFinite(n) ? n.toFixed(2) : "—";
  }

  function fmtSigned(n: number): string {
    if (!Number.isFinite(n)) return "—";
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  }

  async function copySnapshot(): Promise<void> {
    const snapshot = buildDebugSnapshot({
      salvo,
      ds,
      context,
      stackable,
      allBuffs,
      projection,
      resolved,
    });
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard blocked (insecure context / permissions) — fall back to a
      // prompt so the snapshot is still recoverable by hand.
      window.prompt("Copy the debug snapshot:", JSON.stringify(snapshot));
    }
  }
</script>

{#snippet numCell(s: AttributedStage | undefined, dimmed: boolean, openLeft: boolean)}
  <td class="value numcell" class:dim-cell={dimmed} tabindex={s && !dimmed ? 0 : -1}>
    {s ? fmt(s.expected) : "—"}
    {#if s && !dimmed}
      <span class="lift-pop" class:left={openLeft}>
        <span class="pop-head">{s.name}</span>
        {#if s.detail}<span class="pop-detail">{s.detail}</span>{/if}
        <span class="pop-row pop-baseline"><span>baseline</span><span class="num">{fmt(s.baseline)}</span></span>
        {#each s.lifts as l (srcKey(l.source))}
          <span class="pop-row"><span>{labelForSource(l.source)}</span><span class="num delta">{fmtSigned(l.delta)}</span></span>
        {/each}
        {#if s.residual}
          <span class="pop-row overlap"><span>overlap (capped)</span><span class="num delta">{fmtSigned(s.residual)}</span></span>
        {/if}
        {#if s.intrinsics.length}
          <span class="pop-intrinsics">weapon: {s.intrinsics.join(", ")}</span>
        {/if}
      </span>
    {/if}
  </td>
{/snippet}

{#if weaponLines.length === 0}
  <EmptyState>Pick a unit and target to see a projection.</EmptyState>
{:else}
  <p class="hint dim">Hover any value for the per-buff breakdown.</p>
  <table class="stages proj">
    <thead>
      <tr>
        <th></th>
        <th>Weapon</th>
        <th class="r">Models</th>
        {#each STAGE_COLUMNS as col (col.name)}
          <th class="r" title={col.full}>{col.short}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each lineResults as r (r.id)}
        <tr class:excluded={excludedLines.has(r.id)}>
          <td>
            <input
              type="checkbox"
              checked={!excludedLines.has(r.id)}
              onchange={() => toggleLine(r.id)}
              aria-label={`Include ${r.label} in combined total`}
            />
          </td>
          <td class="wname">{r.label}</td>
          <td class="value">
            <input
              type="number"
              min="1"
              class="models-input"
              value={modelsFor(r)}
              oninput={(e) => setModels(r.id, Number((e.currentTarget as HTMLInputElement).value))}
              aria-label={`Models firing ${r.label}`}
            />
          </td>
          {#each STAGE_COLUMNS as col, idx (col.name)}
            {@render numCell(
              r.error ? undefined : stageOf(r.attributed, col.name),
              excludedLines.has(r.id) || !!r.error,
              idx >= 4,
            )}
          {/each}
        </tr>
      {/each}
      <tr class="total">
        <td></td>
        <td>Combined</td>
        <td></td>
        {#each STAGE_COLUMNS as col, idx (col.name)}
          {@render numCell(stageOf(aggregate, col.name), false, idx >= 4)}
        {/each}
      </tr>
    </tbody>
  </table>

  <div class="row debug-row">
    <button onclick={() => (showDebug = !showDebug)}>
      {showDebug ? "Hide" : "Show"} resolved modifiers
    </button>
    <button onclick={copySnapshot}>
      {copied ? "Copied ✓" : "Copy debug snapshot"}
    </button>
    <span class="dim">{allBuffs.length} buff(s) in play</span>
  </div>

  {#if showDebug && resolved}
    <pre class="debug-dump">{JSON.stringify(resolved, null, 2)}</pre>
  {/if}
{/if}

<style>
  .hint {
    margin: 0 0 var(--space-2);
    font-size: var(--text-xs);
  }
  .proj { margin-bottom: var(--space-3); width: 100%; }
  .proj th.r,
  .proj td.numcell { text-align: right; }
  .proj th.r { cursor: help; }
  .proj .wname { white-space: nowrap; }
  .proj tr.excluded td { opacity: 0.45; }
  .proj input[type="checkbox"] { cursor: pointer; }
  .proj tr.total td { font-weight: 600; }
  .models-input {
    width: 52px;
    text-align: right;
    font-family: var(--font-mono);
  }

  /* Per-cell buff-lift popover. The cell is the positioning context; the
     popover is revealed purely on hover / keyboard focus, content precomputed. */
  .numcell { position: relative; }
  .numcell[tabindex="0"] { cursor: help; }
  .numcell.dim-cell { opacity: 0.45; }
  .lift-pop {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 50;
    min-width: 180px;
    max-width: 280px;
    margin-top: 2px;
    padding: var(--space-2);
    text-align: left;
    background: var(--panel-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    font-size: var(--text-2xs);
    white-space: normal;
  }
  .lift-pop.left { left: auto; right: 0; }
  .numcell:hover .lift-pop,
  .numcell:focus-within .lift-pop { display: block; }
  .pop-head {
    display: block;
    font-weight: 600;
    text-transform: capitalize;
    margin-bottom: 2px;
  }
  .pop-detail {
    display: block;
    color: var(--dim);
    margin-bottom: var(--space-1);
    font-family: var(--font-mono);
  }
  .pop-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .pop-baseline { color: var(--dim); }
  .pop-row.overlap { color: var(--dim); font-style: italic; }
  .pop-row .num { font-family: var(--font-mono); }
  .pop-row .delta { color: var(--accent, inherit); }
  .pop-intrinsics {
    display: block;
    margin-top: var(--space-1);
    color: var(--dim);
  }
  .debug-row { margin-top: var(--space-3); }
  .debug-dump {
    background: var(--panel-2);
    padding: var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--dim);
    overflow-x: auto;
    max-height: 240px;
  }
</style>
