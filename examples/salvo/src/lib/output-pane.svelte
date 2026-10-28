<script lang="ts">
  import {
    salvo,
    ds,
    MANUAL_BUFF_TOGGLES,
    weaponTypeForPhase,
  } from "./store.svelte.js";
  import { SvelteMap } from "svelte/reactivity";
  import {
    crunch,
    resolveBuffs,
    isLegalLeverSelection,
    type AttributedStage,
    type Buff,
    type BuffSource,
    type EngineContext,
    type EngineInput,
    clampWeaponCount,
  } from "@alpaca-software/40kdc-data";
  import EmptyState from "./EmptyState.svelte";
  import WeaponCards from "./weapon-cards.svelte";
  import {
    defaultWeaponCount,
    memberCounts,
    selectLines,
    weaponLines as buildWeaponLines,
    type LineSelection,
    type WeaponLine,
  } from "./weapon-lines.js";
  import { buildDebugSnapshot } from "./debug-export.js";
  import { scenarioContext } from "./scenario.js";
  import {
    memberLevers,
    crunchLine,
    enabledLeverBuffs,
    grantedCopies,
    memberUnits as resolveMembers,
    memberWargear,
    unionLevers,
    synthTarget,
    targetDefences,
  } from "./output-model.js";
  import {
    STAGE_COLUMNS,
    aggregateStages,
    fmt,
    fmtSigned,
    labelForSource as labelForSourceIn,
    srcKey,
    stageOf,
  } from "./projection-model.js";

  const context = $derived<EngineContext>({
    phase: salvo.phase,
    attackerStationary: salvo.contextFlags.attackerStationary,
    withinHalfRange: salvo.contextFlags.withinHalfRange,
    attackerCharged: salvo.contextFlags.attackerCharged,
    targetInCover: salvo.manualBuffsActive.has("cover"),
    attackerAttached: salvo.attachedUnitIds.length > 0,
    // Drives range-gated abilities (e.g. Furious Onslaught's 18" reroll). Unset
    // → range gates stay permissive.
    ...(salvo.targetDistance !== null ? { distanceInches: salvo.targetDistance } : {}),
    ...scenarioContext(salvo.scenario),
  });

  // Each member's levers, read as that member under its own context (as the damage matrix reads
  // them); the toggles and the selection check read their union.
  const perMember = $derived(memberLevers(ds, {
    unitId: salvo.selectedUnitId,
    factionId: salvo.selectedFactionId,
    detachmentId: salvo.selectedDetachmentId,
    attachedUnitIds: salvo.attachedUnitIds,
    supportUnitIds: salvo.supportUnitIds,
  }, context));
  const leverSelection = $derived(unionLevers(perMember));

  const stackable = $derived(leverSelection.buffs);
  const selectionValid = $derived(isLegalLeverSelection(
    stackable,
    leverSelection.groups,
    new Set(stackable.filter((b) => salvo.isBuffEnabled(b.id, b.enabled)).map((b) => b.id)),
  ));


  const manualBuffs = $derived<Buff[]>(
    MANUAL_BUFF_TOGGLES.filter((t) => salvo.manualBuffsActive.has(t.id)).map((t) =>
      t.build(),
    ),
  );

  const defensive = $derived(targetDefences(ds, salvo.targetUnitId, {
    detachmentId: salvo.defenderDetachmentId,
    stratagemIds: salvo.defenderStratagemIds,
    enhancementId: salvo.defenderEnhancementId,
    wargear: salvo.targetWargear,
  }, context));

  /** The buffs one member attacks with: its enabled levers, the manual toggles and the target's defences. */
  function buffsOf(memberId: string): Buff[] {
    const levers = perMember.find((member) => member.memberId === memberId)?.levers.buffs ?? [];
    return [...enabledLeverBuffs(levers, (b) => salvo.isBuffEnabled(b.id, b.enabled)), ...manualBuffs, ...defensive.buffs];
  }
  const contextOf = (memberId: string) => perMember.find((member) => member.memberId === memberId)?.context ?? context;
  // The selected unit's buffs, for the single-weapon projection and the debug snapshot.
  const allBuffs = $derived<Buff[]>(salvo.selectedUnitId ? buffsOf(salvo.selectedUnitId) : [...manualBuffs, ...defensive.buffs]);

  // The selected unit and its attached members.
  const memberUnits = $derived(resolveMembers(ds, salvo.selectedFactionId, [salvo.selectedUnitId, ...salvo.attachedUnitIds]));

  // Per-weapon model count (how many of a member's models carry it), read with
  // a default from an override map — no $effect seeds it, so lines appearing
  // after a unit/phase change fall through to the loadout default without a
  // fresh-ref write that would trip Svelte's update-depth guard.
  const countOverrides = $state(new SvelteMap<string, number>());
  const weaponKey = (memberId: string, weaponId: string) => `${memberId}:${weaponId}`;
  function carriedBy(memberId: string, weaponId: string): number {
    const override = countOverrides.get(weaponKey(memberId, weaponId));
    if (override !== undefined) return override;
    const loadout = memberUnits.find((member) => member.memberId === memberId)?.loadout;
    return loadout ? defaultWeaponCount(loadout, weaponId) : 0;
  }

  // Each member's equipment counts and what its wargear changes: the weapons it grants (a
  // drone's carbine) and the printed rules of wargear the loadout leaves out, as the matrix
  // scores them.
  const counts = $derived(memberUnits.map(({ memberId, unit, loadout }) =>
    memberCounts(loadout, unit.weapons.map((w) => w.id), (weaponId) => carriedBy(memberId, weaponId))));
  const wargear = $derived(memberUnits.map((member, index) =>
    memberWargear({ ds, factionId: salvo.selectedFactionId, member, counts: counts[index], buffs: buffsOf(member.memberId), context: contextOf(member.memberId) })));
  const wargearOf = (memberId: string) => {
    const index = memberUnits.findIndex((member) => member.memberId === memberId);
    return index < 0 ? undefined : { counts: counts[index], wargear: wargear[index] };
  };

  // The combined unit declares all its attacks at once: one line per profile of every
  // phase-eligible weapon across the selected unit, its attached members and their granted
  // weapons.
  const weaponLines = $derived<WeaponLine[]>(
    buildWeaponLines(
      memberUnits.map(({ memberId, unit }, index) => ({
        memberId,
        name: unit.name,
        weapons: [...unit.weapons.map((w) => w.raw), ...wargear[index].granted],
      })),
      weaponTypeForPhase(salvo.phase),
    ),
  );

  /** Models carrying a weapon: its granted copies for a granted weapon, else the carried count. */
  function shownCount(memberId: string, weaponId: string): number {
    const member = wargearOf(memberId);
    if (member?.wargear.granted.some((weapon) => weapon.id === weaponId)) {
      return grantedCopies(member.wargear.grants, member.counts, weaponId);
    }
    return carriedBy(memberId, weaponId);
  }
  const carried = (line: WeaponLine) => shownCount(line.ownerMemberId, line.weaponId);
  // Clamp the requested count into this weapon's valid range so an invalid
  // wargear config is unreachable (e.g. plasma pistols can't exceed 3 on a
  // 10-model Berzerker squad). Weapons with no bound keep a "≥0" floor.
  // A granted weapon's count follows its wargear, so it is not edited.
  function setCarried(line: WeaponLine, n: number): void {
    if (wargearOf(line.ownerMemberId)?.wargear.granted.some((weapon) => weapon.id === line.weaponId)) return;
    const bounds = memberUnits.find((member) => member.memberId === line.ownerMemberId)?.loadout.bounds;
    const count = bounds?.has(line.weaponId)
      ? clampWeaponCount(bounds, line.weaponId, n)
      : Math.max(0, Math.floor(n) || 0);
    countOverrides.set(weaponKey(line.ownerMemberId, line.weaponId), count);
  }

  // Which lines the models actually use, and with how many models: the
  // package's loadout scoring (Pistols or other ranged weapons per model, one
  // ordinary melee weapon per model), the same the damage matrix applies.
  const target = $derived(synthTarget(salvo.manualTarget));
  const selection = $derived.by<{ value: LineSelection | null; error?: string }>(() => {
    if (!selectionValid) return { value: null };
    try {
      return {
        value: selectLines({
          ds,
          members: memberUnits.map(({ memberId, loadout }, index) => ({
            memberId,
            loadout,
            counts: counts[index],
            grants: wargear[index].grants,
            buffs: wargear[index].buffs,
            context: contextOf(memberId),
          })),
          target: { unit: target, modelCount: salvo.manualTarget.modelCount },
          buffs: allBuffs,
          context,
        }),
      };
    } catch (err) {
      return { value: null, error: (err as Error).message };
    }
  });

  // Manual include/exclude per line; without one, a line is in play exactly
  // when the loadout scoring uses it.
  const inclusion = $state(new SvelteMap<string, boolean>());
  function included(id: string): boolean {
    return inclusion.get(id) ?? (selection.value?.firing.has(id) ?? false);
  }
  function toggleLine(id: string): void {
    inclusion.set(id, !included(id));
  }

  // Crunch every line with the shared (weapon-agnostic) buff stack and the
  // models firing it: the scored count when the line is used, else every model
  // carrying it. attributeStages runs the leave-one-out decomposition so each
  // cell can show which toggleable buffs lifted it.
  const lineResults = $derived(selectionValid
    ? weaponLines.map((line) => crunchLine({
        ds,
        line,
        owner: memberUnits.find((member) => member.memberId === line.ownerMemberId)?.unit.raw,
        models: selection.value?.firing.get(line.id) ?? carried(line),
        target: { unit: target, modelCount: salvo.manualTarget.modelCount },
        buffs: wargearOf(line.ownerMemberId)?.wargear.buffs ?? buffsOf(line.ownerMemberId),
        context: contextOf(line.ownerMemberId),
      }))
    : []);

  /** Human label for a buff source, bound to this app's dataset. */
  function labelForSource(s: BuffSource): string {
    return labelForSourceIn(ds, s);
  }

  // The "Combined" row, decomposed the same way per-line cells are (see
  // aggregateStages for the additive vs models-killed math).
  const aggregate = $derived.by<AttributedStage[]>(() =>
    aggregateStages(
      lineResults.filter((r) => included(r.id) && !r.error),
      salvo.manualTarget.W,
      salvo.manualTarget.modelCount,
    ),
  );

  const projection = $derived.by(() => {
    if (!selectionValid) return { error: "Selected abilities exceed an allowance or lack a required provider." };
    if (!salvo.selectedUnitId || !salvo.selectedWeaponId) return null;
    const weapon =
      (salvo.selectedFactionId
        ? ds.weapons.getInFaction(salvo.selectedWeaponId, salvo.selectedFactionId)
        : undefined) ?? ds.weapons.getAny(salvo.selectedWeaponId);
    if (!weapon) return null;
    try {
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

  const resolved = $derived.by<{ value: ReturnType<typeof resolveBuffs> | null; error?: string }>(() => {
    if (!projection || "error" in projection) return { value: null };
    try {
      return { value: resolveBuffs(allBuffs, context) };
    } catch (err) {
      return { value: null, error: (err as Error).message };
    }
  });

  let showDebug = $state(false);
  let copied = $state(false);

  async function copySnapshot(): Promise<void> {
    const snapshot = buildDebugSnapshot({
      salvo,
      ds,
      context,
      stackable,
      allBuffs,
      projection,
      resolved: resolved.value,
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

{#snippet usage(r: { id: string; models: number; ownerMemberId: string; weaponId: string })}
  {#if !selection.value?.firing.has(r.id)}
    <span class="usage dim" title="The loadout scoring uses another profile or weapon for these models">not used</span>
  {:else if r.models !== shownCount(r.ownerMemberId, r.weaponId)}
    <span class="usage dim" title="Models that use this line; the rest use another weapon">{r.models} fire</span>
  {/if}
{/snippet}

{#if !selectionValid}
  <EmptyState>Selected abilities exceed an allowance or lack a required provider. Adjust the ability toggles to see a projection.</EmptyState>
{:else if weaponLines.length === 0}
  <EmptyState>Pick a unit and target to see a projection.</EmptyState>
{:else}
  {#if leverSelection.error}
    <p class="error" role="alert">Abilities could not be read: {leverSelection.error}</p>
  {/if}
  {#if defensive.error}
    <p class="error" role="alert">Target abilities could not be read: {defensive.error}</p>
  {/if}
  {#each wargear.filter((item) => item.error) as item, index (index)}
    <p class="error" role="alert">Wargear could not be read: {item.error}</p>
  {/each}
  {#if projection && "error" in projection}
    <p class="error" role="alert">Projection failed: {projection.error}</p>
  {/if}
  {#if selection.error}
    <p class="error" role="alert">Loadout scoring failed: {selection.error}</p>
  {/if}
  {#each [...(selection.value?.violations ?? [])] as [memberId, messages] (memberId)}
    <p class="error" role="alert">Illegal wargear: {messages.join("; ")}</p>
  {/each}
  <!-- Below 640px the table becomes stacked weapon cards. -->
  <WeaponCards
    lines={lineResults}
    {aggregate}
    {included}
    {toggleLine}
    {carried}
    {setCarried}
    {labelForSource}
    {usage}
  />

  <div class="proj-table-wrap">
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
        <tr class:excluded={!included(r.id)}>
          <td>
            <input
              type="checkbox"
              checked={included(r.id)}
              onchange={() => toggleLine(r.id)}
              aria-label={`Include ${r.label} in combined total`}
            />
          </td>
          <td class="wname">
            {r.label}
            <!-- A line no model carries is dimmed, not an error. -->
            {#if r.error && r.models > 0}<span class="usage line-error" role="alert">{r.error}</span>{/if}
          </td>
          <td class="value">
            <input
              type="number"
              min="0"
              class="models-input"
              value={shownCount(r.ownerMemberId, r.weaponId)}
              oninput={(e) => setCarried(r, Number((e.currentTarget as HTMLInputElement).value))}
              aria-label={`Models carrying ${r.label}`}
            />
            {@render usage(r)}
          </td>
          {#each STAGE_COLUMNS as col, idx (col.name)}
            {@render numCell(
              r.error ? undefined : stageOf(r.attributed, col.name),
              !included(r.id) || !!r.error,
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
  </div>

  <div class="row debug-row">
    <button onclick={() => (showDebug = !showDebug)}>
      {showDebug ? "Hide" : "Show"} resolved modifiers
    </button>
    <button onclick={copySnapshot}>
      {copied ? "Copied ✓" : "Copy debug snapshot"}
    </button>
    <span class="dim">{allBuffs.length} buff(s) in play</span>
  </div>

  {#if showDebug && resolved.error}
    <p class="error" role="alert">Resolving modifiers failed: {resolved.error}</p>
  {:else if showDebug && resolved.value}
    <pre class="debug-dump">{JSON.stringify(resolved.value, null, 2)}</pre>
  {/if}
{/if}

<style>
  .hint {
    margin: 0 0 var(--space-2);
    font-size: var(--text-xs);
  }

  @media (max-width: 640px) {
    .proj-table-wrap { display: none; }
  }

  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
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
  .line-error { color: var(--danger); white-space: normal; }
  .usage {
    display: block;
    font-size: var(--text-xs);
    white-space: nowrap;
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
