<script lang="ts">
  import {
    salvo,
    ds,
    MANUAL_BUFF_TOGGLES,
    weaponTypeForPhase,
    type ManualTarget,
  } from "./store.svelte.js";
  import { SvelteSet, SvelteMap } from "svelte/reactivity";
  import { slide } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import {
    attributeStages,
    crunch,
    resolveBuffs,
    isLegalLeverSelection,
    type AttributedStage,
    type Buff,
    type BuffSource,
    type EngineContext,
    type EngineInput,
    type StackableBuff,
    type StackableBuffGroup,
    type Unit,
    type Weapon,
    clampWeaponCount,
    loadoutHitModifier,
    profileEngineInput,
  } from "@alpaca-software/40kdc-data";
  import EmptyState from "./EmptyState.svelte";
  import {
    defaultWeaponCount,
    memberLoadout,
    selectLines,
    weaponLines as buildWeaponLines,
    type LineSelection,
    type WeaponLine,
  } from "./weapon-lines.js";
  import { buildDebugSnapshot } from "./debug-export.js";
  import { activeSupport, defenderBuffs } from "./defender.js";
  import { scenarioContext } from "./scenario.js";
  import {
    STAGE_COLUMNS,
    aggregateStages,
    fmt,
    fmtSigned,
    labelForSource as labelForSourceIn,
    srcKey,
    stageOf,
  } from "./projection-model.js";

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
    // Drives range-gated abilities (e.g. Furious Onslaught's 18" reroll). Unset
    // → range gates stay permissive.
    ...(salvo.targetDistance !== null ? { distanceInches: salvo.targetDistance } : {}),
    ...scenarioContext(salvo.scenario),
  });

  // Ability/army/detachment/attached levers — weapon-independent, shared by
  // every weapon line. We pass no weaponProfiles: each line's intrinsic weapon
  // keywords are auto-injected by crunch (engine.ts profileBuffsFor), so adding
  // them here too would double-count additive keyword effects.
  const leverSelection = $derived.by<{ buffs: StackableBuff[]; groups: StackableBuffGroup[]; error?: string }>(() => {
    if (!salvo.selectedUnitId) return { buffs: [], groups: [] };
    try {
      return ds.stackableBuffsFor(
        {
          unitId: salvo.selectedUnitId,
          factionId: salvo.selectedFactionId ?? undefined,
          detachmentId: salvo.selectedDetachmentId ?? undefined,
          attachedUnitIds: salvo.attachedUnitIds,
          supportingUnitIds: activeSupport(ds, salvo.selectedFactionId, [salvo.selectedUnitId, ...salvo.attachedUnitIds], salvo.supportUnitIds),
          weaponProfiles: [],
        },
        context,
      );
    } catch (err) {
      return { buffs: [], groups: [], error: (err as Error).message };
    }
  });

  const stackable = $derived(leverSelection.buffs);
  const selectionValid = $derived(isLegalLeverSelection(
    stackable,
    leverSelection.groups,
    new Set(stackable.filter((b) => salvo.isBuffEnabled(b.id, b.enabled)).map((b) => b.id)),
  ));

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

  const defensive = $derived.by<{ buffs: Buff[]; error?: string }>(() => {
    // Defensive abilities for the target — only meaningful when the target
    // is a dataset/roster unit, not the manual stat block.
    const targetUnitId = salvo.targetUnitId;
    if (!targetUnitId) return { buffs: [] };
    const tUnit = ds.units.getAny(targetUnitId);
    if (!tUnit) return { buffs: [], error: `Target unit ${targetUnitId} is not in the dataset` };
    try {
      return {
        buffs: defenderBuffs(ds, tUnit, {
          detachmentId: salvo.defenderDetachmentId,
          stratagemIds: salvo.defenderStratagemIds,
          enhancementId: salvo.defenderEnhancementId,
        }, context),
      };
    } catch (err) {
      return { buffs: [], error: (err as Error).message };
    }
  });
  const defensiveBuffs = $derived(defensive.buffs);

  const allBuffs = $derived<Buff[]>([...datasetBuffs, ...manualBuffs, ...defensiveBuffs]);

  // The combined unit declares all its attacks at once: one line per profile of
  // every phase-eligible weapon across the selected unit AND its attached
  // members. Resolve each member within the selected faction so a shared
  // chassis (e.g. `chaos-land-raider`) uses this faction's copy.
  const memberUnits = $derived.by(() =>
    [salvo.selectedUnitId, ...salvo.attachedUnitIds].flatMap((memberId) => {
      if (!memberId) return [];
      const unit =
        (salvo.selectedFactionId && ds.units.getInFaction(memberId, salvo.selectedFactionId)) ||
        ds.units.getAny(memberId);
      return unit ? [{ memberId, unit, loadout: memberLoadout(ds, unit.raw) }] : [];
    }),
  );

  const weaponLines = $derived<WeaponLine[]>(
    buildWeaponLines(
      memberUnits.map(({ memberId, unit }) => ({ memberId, name: unit.name, weapons: unit.weapons.map((w) => w.raw) })),
      weaponTypeForPhase(salvo.phase),
    ),
  );

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
  // Clamp the requested count into this weapon's valid range so an invalid
  // wargear config is unreachable (e.g. plasma pistols can't exceed 3 on a
  // 10-model Berzerker squad). Weapons with no bound keep a "≥0" floor.
  function setCarried(line: WeaponLine, n: number): void {
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
          members: memberUnits.map(({ memberId, unit, loadout }) => ({
            memberId,
            loadout,
            counts: new Map(unit.weapons.map((w) => [w.id, carriedBy(memberId, w.id)] as const).filter(([, n]) => n > 0)),
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
  /** Models firing a line: the scored count when it is used, else every model carrying it. */
  function firing(line: WeaponLine): number {
    return selection.value?.firing.get(line.id) ?? carriedBy(line.ownerMemberId, line.weaponId);
  }

  // Crunch every line with the shared (weapon-agnostic) buff stack and the
  // models firing it. The engine injects each weapon's intrinsic keywords.
  // attributeStages runs the leave-one-out decomposition so each cell can show
  // which toggleable buffs lifted it.
  function lineHitModifier(line: WeaponLine): number {
    const owner = memberUnits.find((member) => member.memberId === line.ownerMemberId)?.unit.raw;
    return owner ? loadoutHitModifier(owner, line.weaponRaw.profiles[line.profileIndex], context) : 0;
  }

  const lineResults = $derived.by(() => {
    if (!selectionValid) return [];
    return weaponLines.map((line) => {
      const models = firing(line);
      if (models <= 0) return { ...line, models, attributed: [] as AttributedStage[], error: "no models carry this weapon" };
      try {
        // The same engine input the selection scored, including any Big Guns Never Tire penalty.
        const attributed = attributeStages(
          profileEngineInput({
            weapon: line.weaponRaw,
            profileIndex: line.profileIndex,
            target: { unit: target, modelCount: salvo.manualTarget.modelCount },
            modelsFiring: models,
            buffs: allBuffs,
            context,
            hitModifier: lineHitModifier(line),
          }),
          ds,
        );
        return { ...line, models, attributed, error: undefined as string | undefined };
      } catch (err) {
        return { ...line, models, attributed: [] as AttributedStage[], error: (err as Error).message };
      }
    });
  });

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

  // Below 640px each weapon line renders as a stacked card: headline damage
  // and kills always visible, the full pipeline + buff breakdown behind a
  // per-card toggle (the hover popover has no touch equivalent).
  const expandedCards = $state(new SvelteSet<string>());
  function toggleCard(id: string): void {
    if (expandedCards.has(id)) expandedCards.delete(id);
    else expandedCards.add(id);
  }
  const COMBINED_CARD = "__combined__";

  const projection = $derived.by(() => {
    if (!selectionValid) return { error: "Selected abilities exceed an allowance or lack a required provider." };
    if (!salvo.selectedUnitId || !salvo.selectedWeaponId) return null;
    const weapon =
      (salvo.selectedFactionId
        ? ds.weapons.getInFaction(salvo.selectedWeaponId, salvo.selectedFactionId)
        : undefined) ?? ds.weapons.getAny(salvo.selectedWeaponId);
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

{#snippet stageBreakdown(s: AttributedStage)}
  <div class="bk">
    <span class="bk-row bk-baseline"><span>baseline</span><span class="num">{fmt(s.baseline)}</span></span>
    {#each s.lifts as l (srcKey(l.source))}
      <span class="bk-row"><span>{labelForSource(l.source)}</span><span class="num delta">{fmtSigned(l.delta)}</span></span>
    {/each}
    {#if s.residual}
      <span class="bk-row overlap"><span>overlap (capped)</span><span class="num delta">{fmtSigned(s.residual)}</span></span>
    {/if}
    {#if s.intrinsics.length}
      <span class="bk-intrinsics">weapon: {s.intrinsics.join(", ")}</span>
    {/if}
  </div>
{/snippet}

{#snippet cardDetail(stages: AttributedStage[], id: string)}
  <div
    class="wcard-detail"
    id="wcard-detail-{id}"
    role="region"
    transition:slide={{ duration: 200, easing: quintOut }}
  >
    {#each STAGE_COLUMNS as col (col.name)}
      {@const s = stageOf(stages, col.name)}
      <div class="wcard-stage">
        <span class="stage-label">{col.full}</span>
        <span class="stage-value num">{s ? fmt(s.expected) : "—"}</span>
      </div>
      {#if s && (s.lifts.length > 0 || s.residual !== 0 || s.intrinsics.length > 0)}
        {@render stageBreakdown(s)}
      {/if}
    {/each}
  </div>
{/snippet}

{#snippet usage(r: { id: string; models: number; ownerMemberId: string; weaponId: string })}
  {#if !selection.value?.firing.has(r.id)}
    <span class="usage dim" title="The loadout scoring uses another profile or weapon for these models">not used</span>
  {:else if r.models !== carriedBy(r.ownerMemberId, r.weaponId)}
    <span class="usage dim" title="Models that use this line; the rest use another weapon">{r.models} fire</span>
  {/if}
{/snippet}

{#snippet headline(stages: AttributedStage[])}
  <div class="wcard-headline">
    <span class="metric">
      <span class="metric-label" title="Expected damage after feel-no-pain">damage</span>
      <span class="metric-num">{fmt(stageOf(stages, "after-fnp")?.expected ?? NaN)}</span>
    </span>
    <span class="metric">
      <span class="metric-label" title="Expected models killed">killed</span>
      <span class="metric-num">{fmt(stageOf(stages, "models-killed")?.expected ?? NaN)}</span>
    </span>
  </div>
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
  {#if selection.error}
    <p class="error" role="alert">Loadout scoring failed: {selection.error}</p>
  {/if}
  {#each [...(selection.value?.violations ?? [])] as [memberId, messages] (memberId)}
    <p class="error" role="alert">Illegal wargear: {messages.join("; ")}</p>
  {/each}
  <!-- Below 640px the table becomes stacked weapon cards: headline numbers up
       front, the full pipeline and buff breakdown behind a per-card toggle. -->
  <div class="proj-cards">
    <article class="wcard combined">
      <div class="wcard-top">
        <button
          class="wcard-toggle"
          aria-expanded={expandedCards.has(COMBINED_CARD)}
          aria-controls="wcard-detail-{COMBINED_CARD}"
          onclick={() => toggleCard(COMBINED_CARD)}
        >
          <span class="chev" class:open={expandedCards.has(COMBINED_CARD)} aria-hidden="true"></span>
          <span class="wcard-name">Combined</span>
        </button>
      </div>
      {@render headline(aggregate)}
      {#if expandedCards.has(COMBINED_CARD)}
        {@render cardDetail(aggregate, COMBINED_CARD)}
      {/if}
    </article>

    {#each lineResults as r (r.id)}
      <article class="wcard" class:excluded={!included(r.id)}>
        <div class="wcard-top">
          <input
            type="checkbox"
            checked={included(r.id)}
            onchange={() => toggleLine(r.id)}
            aria-label={`Include ${r.label} in combined total`}
          />
          <button
            class="wcard-toggle"
            aria-expanded={expandedCards.has(r.id)}
            aria-controls="wcard-detail-{r.id}"
            onclick={() => toggleCard(r.id)}
          >
            <span class="chev" class:open={expandedCards.has(r.id)} aria-hidden="true"></span>
            <span class="wcard-name">{r.label}</span>
          </button>
          <label class="wcard-models">
            <span>models</span>
            <input
              type="number"
              min="0"
              class="models-input"
              value={carriedBy(r.ownerMemberId, r.weaponId)}
              oninput={(e) => setCarried(r, Number((e.currentTarget as HTMLInputElement).value))}
              aria-label={`Models carrying ${r.label}`}
            />
            {@render usage(r)}
          </label>
        </div>
        {#if r.error}
          <p class="error">{r.error}</p>
        {:else}
          {@render headline(r.attributed)}
          {#if expandedCards.has(r.id)}
            {@render cardDetail(r.attributed, r.id)}
          {/if}
        {/if}
      </article>
    {/each}
  </div>

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
          <td class="wname">{r.label}</td>
          <td class="value">
            <input
              type="number"
              min="0"
              class="models-input"
              value={carriedBy(r.ownerMemberId, r.weaponId)}
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

  /* ── card view (phones) vs table view ──────────────────────────────────── */
  .proj-cards { display: none; }
  @media (max-width: 640px) {
    .proj-table-wrap { display: none; }
    .proj-cards {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin-bottom: var(--space-3);
    }
  }

  .wcard {
    background: var(--panel-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
  }
  .wcard.excluded > :not(.wcard-top),
  .wcard.excluded .wcard-toggle { opacity: 0.45; }
  .wcard.combined { border-color: var(--accent-dim); }
  .wcard.combined .metric-num { color: var(--accent); }

  .wcard-top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 32px;
  }
  .wcard-top input[type="checkbox"] { cursor: pointer; flex: 0 0 auto; }
  .wcard-toggle {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    background: none;
    border: none;
    padding: var(--space-1) 0;
    text-align: left;
    font-size: var(--text-sm);
    color: var(--text);
  }
  .wcard-toggle:hover { border: none; color: var(--accent); }
  .wcard-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-right: 1.5px solid var(--muted);
    border-bottom: 1.5px solid var(--muted);
    transform: rotate(-45deg);
    transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
    margin-left: 2px;
  }
  .chev.open { transform: rotate(45deg); border-color: var(--text); }
  .wcard-models {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--muted);
    font-size: var(--text-2xs);
  }

  .wcard-headline {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-1) 0 var(--space-1) calc(7px + 2px + var(--space-2));
  }
  .metric {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .metric-label {
    font-family: var(--font-heading);
    font-size: var(--text-2xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--muted);
  }
  .metric-num {
    font-family: var(--font-mono);
    font-size: var(--text-md);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .wcard-detail {
    margin-top: var(--space-1);
    padding: var(--space-2) 0 var(--space-1) calc(7px + 2px + var(--space-2));
    border-top: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .wcard-stage {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-xs);
  }
  .stage-label { color: var(--muted); }
  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .bk {
    margin: 1px 0 var(--space-1);
    padding-left: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: var(--text-2xs);
    border-left: 1px solid var(--border-subtle);
  }
  .bk-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .bk-baseline { color: var(--dim); }
  .bk-row.overlap { color: var(--dim); font-style: italic; }
  .bk .delta { color: var(--accent); }
  .bk-intrinsics { color: var(--dim); }
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
