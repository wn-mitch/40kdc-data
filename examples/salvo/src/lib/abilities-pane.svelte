<script lang="ts">
  import {
    salvo,
    ds,
    MANUAL_BUFF_TOGGLES,
    CONTEXT_FLAG_TOGGLES,
  } from "./store.svelte.js";
  import { isLegalLeverSelection } from "@alpaca-software/40kdc-data";
  import type {
    Buff,
    AbilityNeed,
    EngineContext,
    StackableBuff,
    StackableBuffGroup,
  } from "@alpaca-software/40kdc-data";
  import EmptyState from "./EmptyState.svelte";
  import { scenarioContext } from "./scenario.js";
  import { coveringLever, leverRows, memberLevers, memberMortalSources, unionLevers, type LeverRow } from "./output-model.js";
  import { defenderNeeds } from "./defender.js";
  import { needToggles, unansweredContext } from "./scenario.js";
  import NeedsList from "./needs-list.svelte";
  import MortalSourcesList from "./mortal-sources-list.svelte";

  // EngineContext for the DSL→Buff translator. Without this the translator
  // defaults to `{ phase: "shooting" }`, so phase-gated branches misfire when
  // the fight tab is open.
  const attackerKeywords = $derived.by<string[]>(() => {
    if (!salvo.selectedUnitId) return [];
    const u =
      (salvo.selectedFactionId &&
        ds.units.getInFaction(salvo.selectedUnitId, salvo.selectedFactionId)) ||
      ds.units.getAny(salvo.selectedUnitId);
    if (!u) return [];
    return [
      ...((u.raw.keywords ?? []) as string[]),
      ...((u.raw.faction_keywords ?? []) as string[]),
    ].map((k) => k.toLowerCase());
  });

  const engineContext = $derived<EngineContext>({
    phase: salvo.phase,
    attackerStationary: salvo.contextFlags.attackerStationary,
    withinHalfRange: salvo.contextFlags.withinHalfRange,
    attackerCharged: salvo.contextFlags.attackerCharged,
    attackerKeywords,
    targetKeywords: salvo.manualTarget.keywords.map((k) => k.toLowerCase()),
    attackerAttached: salvo.attachedUnitIds.length > 0,
    ...(salvo.targetDistance !== null ? { distanceInches: salvo.targetDistance } : {}),
    ...scenarioContext(salvo.scenario),
  });

  const member = $derived({
    unitId: salvo.selectedUnitId,
    factionId: salvo.selectedFactionId,
    detachmentId: salvo.selectedDetachmentId,
    attachedUnitIds: salvo.attachedUnitIds,
    supportUnitIds: salvo.supportUnitIds,
  });
  const weapons = $derived(salvo.selectedWeaponId ? [{ weaponId: salvo.selectedWeaponId, profileIndex: salvo.selectedProfileIndex }] : []);

  // Every buff the attacker could stack, as toggleable levers. The package
  // does the DSL walk once and hands back (buff, enabled) pairs plus the
  // activation groups (dice-pool / choice) that cap how many fire at once.
  const leversIn = (context: EngineContext) => unionLevers(memberLevers(ds, member, context, weapons));
  const perMember = $derived(memberLevers(ds, member, engineContext, weapons));
  const stackable = $derived.by<{ buffs: StackableBuff[]; groups: StackableBuffGroup[]; needs: AbilityNeed[]; error?: string }>(() => unionLevers(perMember));
  // One row per ability across the combined unit's members, switched on and off together.
  const rows = $derived(leverRows(perMember));

  // The defending unit's undecided conditions, read with the same build the projection uses.
  function targetNeedsIn(context: EngineContext): AbilityNeed[] {
    const unit = salvo.targetUnitId ? ds.units.getAny(salvo.targetUnitId) : undefined;
    if (!unit) return [];
    try {
      return defenderNeeds(ds, unit, {
        detachmentId: salvo.defenderDetachmentId,
        stratagemIds: salvo.defenderStratagemIds,
        enhancementId: salvo.defenderEnhancementId,
        wargear: salvo.targetWargear,
      }, context);
    } catch {
      // The projection pane reports a defender build that fails; here it only hides its needs.
      return [];
    }
  }
  // Mortal wounds the combined unit's abilities inflict outside its attacks.
  const mortalIn = (context: EngineContext) => memberMortalSources(ds, member, { ...context, targetModelCount: salvo.manualTarget.modelCount });
  const mortal = $derived(mortalIn(engineContext));
  // One toggle per condition across the attacker's levers, its mortal-wound sources and the
  // defender's rules, read with no condition answered so an answered toggle stays listed.
  const needs = $derived.by(() => {
    const context = unansweredContext(engineContext);
    const answered = context !== engineContext;
    return needToggles([
      ...(answered ? leversIn(context) : stackable).needs,
      ...(answered ? mortalIn(context) : mortal).needs,
      ...targetNeedsIn(context),
    ]);
  });

  // Free-standing levers (always-on abilities, stratagems, weapon keywords).
  const ungrouped = $derived(rows.filter((row) => !row.lever.group));

  // Levers that belong to a capped activation pool (e.g. Blessings of Khorne).
  const pools = $derived.by(() => {
    const byGroup = new Map<string, LeverRow[]>();
    for (const row of rows) {
      if (!row.lever.group) continue;
      const list = byGroup.get(row.lever.group) ?? [];
      list.push(row);
      byGroup.set(row.lever.group, list);
    }
    return stackable.groups
      .map((g) => ({ group: g, levers: byGroup.get(g.id) ?? [] }))
      .filter((p) => p.levers.length > 0);
  });

  function enabled(b: StackableBuff): boolean {
    return salvo.isBuffEnabled(b.id, b.enabled);
  }

  function activeInGroup(groupId: string): number {
    return stackable.buffs.filter(
      (b) => (b.group === groupId || b.groups?.includes(groupId)) && enabled(b),
    ).length;
  }

  const byId = $derived(new Map(stackable.buffs.map((lever) => [lever.id, lever])));

  /** A row is on when any member's copy is on. */
  function rowEnabled(row: LeverRow): boolean {
    return row.ids.some((id) => {
      const lever = byId.get(id);
      return lever !== undefined && enabled(lever);
    });
  }

  function canToggle(row: LeverRow): boolean {
    // Removing a selection is always available, including recovery from stale state.
    if (rowEnabled(row)) return true;
    const selected = new Set(stackable.buffs.filter(enabled).map((lever) => lever.id));
    for (const id of row.ids) selected.add(id);
    return isLegalLeverSelection(stackable.buffs, stackable.groups, selected);
  }

  function toggle(row: LeverRow) {
    if (!canToggle(row)) return;
    const next = !rowEnabled(row);
    for (const id of row.ids) salvo.setBuffEnabled(id, next);
  }

  /** The enabled lever that already grants a manual toggle's effect, which disables the toggle. */
  function coveredBy(t: (typeof MANUAL_BUFF_TOGGLES)[number]): StackableBuff | undefined {
    return coveringLever(t.build(), stackable.buffs, enabled);
  }

  function toggleManual(id: string) {
    const next = new Set(salvo.manualBuffsActive);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    salvo.manualBuffsActive = next;
  }


  function sourceChip(b: StackableBuff): string {
    if (b.source.kind === "weapon-keyword") return "weapon";
    if (b.source.kind === "manual") return "manual";
    if (b.source.abilityKind === "attached") {
      return "attached";
    }
    return b.source.abilityKind === "detachment-stratagem" ? "stratagem" : b.source.abilityKind;
  }

  function describeBuff(b: Buff): string {
    const c = b.contribution;
    if (c.type === "extra-keyword") {
      const v = c.keywordRef.parameters?.value;
      return `${c.keywordRef.keyword_id}${typeof v === "number" ? ` ${v}` : ""}`;
    }
    return "value" in c ? `${c.type} ${c.value}` : c.type;
  }

  function summary(b: StackableBuff): string {
    const effects = b.buffs.map(describeBuff).join(", ") || "no effect";
    // Name the combined-unit member an attached buff came from.
    if (
      b.source.kind === "ability" &&
      b.source.abilityKind === "attached" &&
      b.source.sourceUnitId
    ) {
      const name = ds.units.getAny(b.source.sourceUnitId)?.name ?? b.source.sourceUnitId;
      return `from ${name} · ${effects}`;
    }
    return effects;
  }
</script>

{#if !salvo.selectedUnitId}
  <EmptyState>Pick an attacker unit to see eligible buffs.</EmptyState>
{:else if stackable.error}
  <p class="error" role="alert">Abilities could not be read: {stackable.error}</p>
{:else if stackable.buffs.length === 0}
  <EmptyState>No buffs available in the {salvo.phase} phase.</EmptyState>
{:else}
  <div class="ability-list">
    {#each ungrouped as row (row.key)}
      <label class="ability-row" class:active={rowEnabled(row)}>
        <input type="checkbox" checked={rowEnabled(row)} disabled={!canToggle(row)} onchange={() => toggle(row)} />
        <span class="name">
          {row.lever.label}
          <small>· {summary(row.lever)}</small>
        </span>
        <span class="chip {sourceChip(row.lever)}">{sourceChip(row.lever)}</span>
      </label>
    {/each}

    {#each pools as p (p.group.id)}
      <div class="section-label">
        {p.group.label} · base allowance {p.group.maxActivations}
        ({activeInGroup(p.group.id)} selected)
      </div>
      {#each p.levers as row (row.key)}
        {@const atCap = !canToggle(row)}
        <label class="ability-row" class:active={rowEnabled(row)} class:dim={atCap}>
          <input
            type="checkbox"
            checked={rowEnabled(row)}
            disabled={atCap}
            onchange={() => toggle(row)}
          />
          <span class="name">
            {row.lever.label}
            <small>· {summary(row.lever)}</small>
          </span>
          <span class="chip activation">activation</span>
        </label>
      {/each}
    {/each}
  </div>
{/if}

<MortalSourcesList sources={mortal.sources} unverified={mortal.unverified} error={mortal.error} />

<NeedsList toggles={needs} />

<hr />

<div class="section-label">Manual toggles</div>
<div class="ability-list">
  {#each MANUAL_BUFF_TOGGLES as t (t.id)}
    {@const cover = coveredBy(t)}
    <label class="ability-row" class:active={!cover && salvo.manualBuffsActive.has(t.id)} class:dim={cover !== undefined}>
      <input
        type="checkbox"
        checked={!cover && salvo.manualBuffsActive.has(t.id)}
        disabled={cover !== undefined}
        onchange={() => toggleManual(t.id)}
      />
      <span class="name">
        {t.label}
        {#if cover}<small>· already from {cover.label}</small>{/if}
      </span>
      <span class="chip manual">manual</span>
    </label>
  {/each}
  {#each CONTEXT_FLAG_TOGGLES as t (t.id)}
    <label class="ability-row" class:active={salvo.contextFlags[t.id]}>
      <input
        type="checkbox"
        checked={salvo.contextFlags[t.id]}
        onchange={(e) =>
          (salvo.contextFlags = {
            ...salvo.contextFlags,
            [t.id]: (e.currentTarget as HTMLInputElement).checked,
          })}
      />
      <span class="name">{t.label}</span>
      <span class="chip manual">context</span>
    </label>
  {/each}
  <label class="ability-row" class:active={salvo.targetDistance !== null}>
    <span class="name">Distance to target (")</span>
    <input
      type="number"
      min="0"
      max="72"
      style="width: 64px"
      value={salvo.targetDistance ?? ""}
      placeholder="—"
      oninput={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value;
        salvo.targetDistance = v === "" ? null : Number(v);
      }}
    />
    <span class="chip manual">gates range abilities</span>
  </label>
</div>
