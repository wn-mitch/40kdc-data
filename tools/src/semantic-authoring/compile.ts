import { foldStepWindow } from "./compile-step-window.js";
import { unscopedRecipientEffect } from "./compile-recipient-scope.js";
import { resolveUnitNames, type UnitNameContext } from "./compile-unit-names.js";
import { resolveRuleReferences } from "./compile-rule-refs.js";
import { foldAuraEmitter, lowerConditionalAuras } from "./compile-aura-emitter.js";
import { foldNamedRanges, requireNamedRangeAuras } from "./compile-named-range.js";
import { foldCostTables } from "./compile-cost-table.js";
import { foldAbilityUseRefresh } from "./compile-ability-use-refresh.js";
import { foldActivationPicks } from "./compile-activation.js";
import { bindAntecedents } from "./compile-antecedent.js";
import { refuseHistoryValueWithoutSource } from "./compile-history-values.js";
import { foldHistoryWindow } from "./compile-history-window.js";
import { foldAuraMoments, foldByAbility } from "./compile-named-ability.js";
import { foldObjectRange, foldStratagemTail } from "./compile-opponent-stratagem.js";
import { foldManoeuvreOwnRoll, manoeuvreLookupFor } from "./compile-manoeuvre-own-roll.js";
import { checkAbilityRollUses } from "./compile-ability-roll.js";
import type { ManoeuvreMenus } from "./named-ability-checks.js";
import { foldAsIfPhases } from "./compile-as-if.js";
import { foldCountsAsMoved } from "./compile-counts-as-moved.js";
import { foldFightNext } from "./compile-fight-next.js";
import { foldPassthroughUsed, refuseUnboundIfItDoes } from "./compile-passthrough-used.js";
import { foldBoundAttacks, nameBoundAttacks } from "./compile-bound-attacks.js";
import { bindWhenSubject } from "./compile-when-subject.js";
import { resolveAttackBackrefs } from "./compile-attack-backref.js";
import { compileReactionParts } from "./compile-reaction-parts.js";
import { compileOpposedDesignations } from "./compile-opposed-designations.js";
import { hoistResolvedSelections } from "./compile-resolved-selection.js";
import { bindArmyAntecedents, foldArmyAttachments, foldArmyPer, foldForwardComposition, resolveArmyGroups } from "./compile-army.js";
import { bindPrecedingRolls } from "./compile-preceding-roll.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { withDesignationExpiry, withResolvedReadExpiry } from "./compile-designation-expiry.js";
import { bindDesignationSubjects, foldHitFilters } from "./compile-conditions.js";
import { foldDestructionAfterAttacks, foldEffectAfterAttacks } from "./compile-destruction-after-attacks.js";
import { foldDisembarkMoment } from "./compile-disembark-moment.js";
import { foldObjectiveCriteria } from "./compile-objective-criteria.js";
import { foldDestroyedSelections } from "./compile-destroyed-selection.js";
import { compileForEachPasses } from "./compile-for-each-passes.js";
import { foldAllocatedAttackRolls, foldSelectedModelRolls } from "./compile-selected-model-roll.js";
import { bindBareFilterHits, bindBeforeFormHits, foldDestroyFilters, foldLeadingHitFilters, foldMortalWoundSources, foldTargetingWeapons, refuseBeforeFormAnaphors } from "./compile-weapon-qualified.js";
import { refuseUnmovedEventSubject } from "./compile-moved-subject.js";
import { refuseSuchFilters } from "./compile-such-filter.js";
import { bindUsedSelections } from "./compile-used-selection.js";
import { bindSelectionRefs } from "./compile-named-selections.js";
import { bindThatMany } from "./compile-that-many.js";
import { foldRollFaces } from "./compile-roll-faces.js";
import { compileWindowMoment } from "./compile-window-moment.js";
import { foldDelayedMoments } from "./compile-delayed-moment.js";
import { foldRitualTest } from "./compile-ritual-test.js";
import { foldEmergencyDisembark } from "./compile-emergency-disembark.js";
import { bulletBreaks, commaItems, ordered, placements, plainLineBreaks, shapeSignature } from "./compile-placement.js";
import { foldAlternativePools } from "./compile-dice-variants.js";
import { planContainers } from "./compile-containers.js";
import { optionalDesignationUses, timingMoments } from "./compile-redesignate.js";
import { compileNamedRegionState } from "./compile-named-region.js";
import { foldAlternativeConditions } from "./compile-alternative-conditions.js";
import { foldConditionExclusions } from "./compile-condition-exclusions.js";
import { refuseSelectionAcrossMoment } from "./compile-selection-moment.js";
import { foldUnitFilters } from "./compile-unit-filters.js";
import { mergeStackedFilters } from "./compile-unit-filter-merge.js";
import { foldWarlordTests, gatesTriggerOnWarlord } from "./compile-warlord-test.js";
import { foldEngagementExclusive } from "./compile-engagement-exclusive.js";
import { foldHolderAbilities } from "./compile-holder-abilities.js";
import { groupMembership } from "./compile-model-level.js";
import { bindTargetedTarget } from "./compile-targeting-history.js";
import { dropRedundantMenuOpeners, foldWeaponKeywords, refuseBlastRating } from "./compile-weapon-keywords.js";
import { foldWeaponScopes, hoistWeaponRecipients } from "./compile-weapon-scopes.js";
import { bindFrameAntecedents, bindScopeAttacks, bindWeaponAntecedents, bindWeaponStatAntecedents, refuseUnboundWeaponScope } from "./compile-weapon-antecedent.js";
import { bindEarlierNamed, refuseDistanceWithoutWeapon, resolveAuthoredNames, type WeaponNameContext } from "./compile-weapon-names.js";
import { bindEquippedCounts } from "./compile-equipped-count.js";
import { foldAttackProperties } from "./compile-attack-properties.js";
import { foldReturnedModelExclusions } from "./compile-returned-model-exclusions.js";
import { foldModelState } from "./compile-model-state.js";
import { foldStickyControl } from "./compile-sticky-control.js";
import { foldSetUpLimits, foldSetUpPlacement, isPlacedLimit } from "./compile-set-up-placement.js";
import { foldCountScales, markCountedSubjects } from "./compile-count-scale.js";
import { foldImpliedHealCondition } from "./compile-implied-heal.js";
import { foldWithEmbarked } from "./compile-with-embarked.js";
import { foldStanceInitial } from "./compile-stance-initial.js";
import { joinSegments, sentenceSegments, STRATAGEM_HEADER } from "./compile-segments.js";
import { compileGranted } from "./compile-granted.js";
import { compileNamedAbilityStates } from "./compile-named-ability-states.js";
import { compileOathRecord } from "./compile-oath.js";
import { foldAbilityUseContext } from "./compile-ability-use.js";
import { bindCharacteristicAmounts, bindCharacteristicFloors } from "./compile-characteristic-amount.js";
import { bindAdditiveOptions } from "./compile-additive-option.js";
import { bindIgnoreLists } from "./compile-ignore-list.js";
import type { CoreCheck } from "./core-checks.js";
import { compileWithName, NAME_FRAGMENT } from "./compile-name.js";
import { lowerPsychicRecord, psychicSegments, type PsychicSegment } from "./compile-psychic-cost.js";
import type { Mechanics } from "./entries.js";
import { bindTargetRefs, refuseBareTarget } from "./compile-target-refs.js";
import { refuseDestinationMismatch, refuseEmbarkDestination, refuseTransportAsSubject } from "./compile-transport-embark.js";
import { refuseStratagemTargetActivity } from "./compile-triggering-destruction.js";
import { planConditionOf, type ConditionOfPlan } from "./compile-connective-plan.js";
import { lowerHistoryMoments } from "./compile-connective-history.js";
import { checkOptionalCosts } from "./compile-optional-cost.js";
import { foldEmbarkedPermission } from "./compile-embarked-permission.js";
import { bindMatchedPools } from "./compile-matched-set.js";
import { foldWeaponAlreadyHas } from "./compile-weapon-already-has.js";
import { classifyLeaves } from "./compile-part-classify.js";
import { planEffects } from "./compile-part-plan.js";
import { bindParts } from "./compile-part-bindings.js";
import { assemblePart } from "./compile-part-assemble.js";
import { foldSelectedAttacks } from "./compile-selected-attacks.js";
import { foldUsedObjects } from "./compile-used-object.js";

export { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * Deterministic composition: reviewed leaves in source order become one Ability DSL entry.
 * Each family maps to one fixed fragment (`compile-fragments.ts`); these rules combine them:
 *
 * - Clauses. Sentences end at `.`, `;` or `:` (or a change of source fragment); a sentence
 *   with no effect joins the next one. Inside a sentence, an "and", "or" or "(" with an
 *   effect on both sides starts a new clause.
 * - Independent sentences. A sentence opening a new moment or "In addition," and an
 *   army-construction sentence compile alone as parts of the ability (`compile-segments.ts`);
 *   the rules below apply inside each part.
 * - Binding. Conditions before the ability's first effect gate every effect. A condition
 *   before a later sentence's first effect gates that sentence; any other condition gates only
 *   the effects of its own clause, in either word order ("if X, add 1" or "add 1 if X"). An "If" that opens
 *   its sentence gates that sentence only when a later sentence is independent of it (compile-instead-scope.ts
 *   sentenceIfGates). The conditions before a roll gate every result band of it (compile-roll-gates.ts).
 * - Attacks. An attack leaf applies to the effects after it: melee or ranged gates them, the
 *   attacking model sets their target, and an attack that targets this unit moves hit, wound
 *   and damage modifiers onto the attacker.
 * - Instead. An `instead` combinator makes its clause's effect replace the nearest earlier effect
 *   of the same family: the earlier one applies only when the clause's condition does not.
 *   After a no-advance-roll, "instead, add 6\" to Move" is what that fragment already means.
 * - Selected unit. Effects gated by "the target is the selected unit" go inside one
 *   designate-target for the ability's select-unit leaf. Without that gate, the selection is a
 *   select-units around the effects, which name the selected unit ("that unit" suffers mortal wounds).
 * - Rolls. Result bands gate their clause's effects and become dice-gated or dice-table; fighting
 *   on death takes its band and conditions as its own per-model gate (compile-dice.ts).
 * - Stratagem TARGET. The target leaves and every condition in the TARGET fragment compile to
 *   the core record's target_restrictions (conditions become its eligibility), never the effect.
 *   Several target leaves are several named targets (compile-target-groups.ts), which effects
 *   name through among-filters and anaphors (compile-target-refs.ts).
 * - Restrictions. How often compiles to `usage`; a stratagem's phases and an enhancement's
 *   eligible bearers compile to nothing and come back as checks against the core records.
 * - Two or more effects form a sequence in source order; a duration sets `scope.duration`;
 *   events other than attacks and selections become the trigger.
 *
 * No model is involved, so one approved shape produces the same kind of entry for every source.
 */

export type Compiled =
  | { ok: true; signature: string; mechanics: Mechanics; checks: CoreCheck[]; core?: CorePatch }
  | { ok: false; signature: string; errors: string[] };

type Node = Record<string, unknown>;

/** Fields the leaves set on the core record rather than the enrichment entry (a stratagem's target). */
export type CorePatch = { target_restrictions: Node | Node[] };

export { leafFragment,  } from "./compile-leaf-fragment.js";
export { shapeSignature } from "./compile-placement.js";


/**
 * A container option that carries its own moment or conditions, compiled as a whole ability and
 * returned as one ability-part: its trigger, usage and duration go on the part, its effect inside.
 */
function nestedPart(group: readonly CompileLeaf[], sourceText: string | undefined, options: CompileOptions, objective?: string, name?: string): Node {
  const own = name === undefined ? options : { ...options, name };
  const compiled = compileChecked(group, sourceText, objective === undefined ? own : { ...own, selectedObjective: objective }, true);
  if (!compiled.ok) throw new CompileError(compiled.errors[0]!);
  const { effect: body, trigger: moment, usage, scope } = compiled.mechanics;
  if (!moment && !usage && (scope.duration === undefined || scope.duration === "permanent")) return body;
  const part: Node = { type: "ability-part", effect: body };
  if (moment) part.trigger = moment;
  if (usage) part.usage = usage;
  if (scope.duration !== undefined && scope.duration !== "permanent") part.duration = scope.duration;
  return part;
}

/**
 * An ignore-modifiers list that names characteristics and rolls together ("BS, Hit rolls and
 * Wound rolls") is one leaf; the DSL's ignore-modifiers holds one kind, so it lowers to one
 * single-kind leaf per kind, on the same wording, in the list's order.
 */
function splitIgnoreModifiers(list: readonly CompileLeaf[]): CompileLeaf[] {
  return list.flatMap((leaf) => {
    if (leaf.family_id !== "ignore-modifiers" || !Array.isArray(leaf.parameters.what)) return [leaf];
    const { what, stats, rolls, except_rolls: except, ...rest } = leaf.parameters as Record<string, unknown> & { what: string[] };
    return what.map((kind) => ({ ...leaf, parameters: { ...rest, what: kind, ...(kind === "characteristics" ? (stats === undefined ? {} : { stats }) : { rolls, ...(except === undefined ? {} : { except_rolls: except }) }) } }));
  });
}

/** What the compiler knows of the record: `abilityId` is the ability "this ability" names (own-abilities.ts). */
export type CompileOptions = {
  abilityId?: string;
  /** The record's name: the text a NAME leaf indexes (compile-name.ts). */
  name?: string;
  /** The faction menus a manoeuvre die names (compile-manoeuvre-own-roll.ts). Default: read from the record's faction. */
  menuActions?: (die: string) => ManoeuvreMenus | null;
  /** The objective a select-objective container around this ability bound, when the ability is that container's body (compile-containers.ts effectsOf). Only a move-end nearest reads it. */
  selectedObjective?: string;
  /** The faction's weapons by printed name (compile-weapon-names.ts), so a named weapon resolves to its id. */
  weapons?: WeaponNameContext;
  /** Exact unit datasheet names resolve only within the owning faction. */
  units?: UnitNameContext;
};

/** Compile one ability's reviewed leaves. Failures name what is missing; nothing is guessed. */
export function compileLeaves(leaves: readonly CompileLeaf[], sourceText?: string, options: CompileOptions = {}): Compiled {
  return compileChecked(leaves, sourceText, options, false);
}

/**
 * compileLeaves, where `enclosed` says the leaves are one part of an enclosing ability (a container's option): a
 * recipient there may be the unit of a loop or aura around the container, which the enclosing compile checks on the
 * whole mechanics, so it is not refused here.
 */
function compileChecked(leaves: readonly CompileLeaf[], sourceText: string | undefined, options: CompileOptions, enclosed: boolean): Compiled {
  // "If it started that move within 6\"" reads the start of the move that triggered the ability, so the record needs that move.
  const moveStart = leaves.some((leaf) => leaf.family_id === "unit-position" && leaf.parameters.at === "move-start");
  if (moveStart && !leaves.some((leaf) => leaf.family_id === "event" && leaf.parameters.kind === "move-ended")) {
    return { ok: false, signature: shapeSignature(ordered(leaves), sourceText), errors: ["A position at the start of a move needs the record to be triggered by that move ending."] };
  }
  const result = compileUnchecked(leaves, sourceText, options);
  // "That unit must take a test" bound to an aura's recipient with no aura or loop around it reaches no unit.
  const unscoped = result.ok && !enclosed ? unscopedRecipientEffect(result.mechanics.effect) : null;
  if (unscoped !== null) return { ok: false, signature: result.signature, errors: [`A ${unscoped} effect names the unit it is applied to (recipient), but no aura or for-each-unit applies it to any unit.`] };
  // A rolled distance or a start-of-move position that a lowering path read as plain inches would be lost, not refused.
  const lost = result.ok ? lostDistance(leaves, result.mechanics) : null;
  return lost === null ? result : { ok: false, signature: result.signature, errors: [lost] };
}

/** Whether any range in the mechanics lost its distance, or a leaf's rolled or start-of-move distance is missing from them. */
function lostDistance(leaves: readonly CompileLeaf[], mechanics: unknown): string | null {
  let empty = false;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "range" && value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((inner) => inner === undefined)) empty = true;
      walk(value);
    }
  };
  walk(mechanics);
  if (empty) return "A distance lowered with no inches; its lowering path does not read this leaf's distance.";
  const text = JSON.stringify(mechanics);
  const positions = leaves.filter((leaf) => leaf.family_id === "unit-position");
  if (positions.some((leaf) => leaf.parameters.rolled_inches !== undefined) && !/"range":\{"dice":/u.test(text)) return "A rolled distance was lowered without its roll.";
  if (positions.some((leaf) => leaf.parameters.at === "move-start") && !text.includes("\"move-start\"")) return "A position at the start of a move was lowered as the position now.";
  return null;
}

function compileUnchecked(record: readonly CompileLeaf[], sourceText?: string, options: CompileOptions = {}): Compiled {
  // A mark read back after the attacks it was made for clears with the phase (compile-designation-expiry.ts); it needs the whole record.
  const leaves = withResolvedReadExpiry(record);
  // A span over the record's name compiles as its own part, beside the body (compile-name.ts).
  if (leaves.some((leaf) => leaf.fragment === NAME_FRAGMENT)) {
    return compileWithName(leaves, sourceText, options, compileLeaves, (list) => shapeSignature(ordered(list), sourceText));
  }
  // "While K units are winning, J units are losing, and vice versa": every designation of the pair is paired (compile-opposed-designations.ts).
  const opposed = compileOpposedDesignations(leaves, sourceText, options, compileLeaves, (list) => shapeSignature(ordered(list), sourceText));
  if (opposed) return opposed;
  // Two for-each-unit-select passes in separate sentences: the second is a later part (compile-for-each-passes.ts).
  const passes = compileForEachPasses(leaves, sourceText, options, compileLeaves, (list) => shapeSignature(ordered(list), sourceText));
  if (passes) return passes;
  // Printed rule and ability names resolve to their records first (compile-rule-refs.ts). Qualifiers printed apart from their host are bound first: a characteristic amount after its recipient and a floor after its change (compile-characteristic-amount.ts), an additive option after its duration (compile-additive-option.ts), an ignore-modifier list after its lead-in (compile-ignore-list.ts), a named range's defined values onto its aura (compile-named-range.ts), and a cost table's headings and rows onto its by-table spend (compile-cost-table.ts).
  let bound: CompileLeaf[];
  try {
    bound = foldCostTables(foldNamedRanges(foldAuraEmitter(bindIgnoreLists(
      bindAdditiveOptions(bindCharacteristicFloors(bindCharacteristicAmounts(resolveRuleReferences(resolveUnitNames(leaves, options.units), options.units))), sourceText),
      sourceText,
    )), options.abilityId));
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature: shapeSignature(ordered(leaves), sourceText), errors: [error.message] };
  }
  // An ability the record prints as granted compiles alone, as its holder's own (compile-granted.ts).
  // "This ability" inside a granted body is the granted one, not the record, so a body gets no id.
  const compiled = compileNamedAbilityStates(bound, sourceText,
    (host, text, oneRule) => compileGranted(host, text, (part, partText) => compileRecord(part, partText, options, oneRule), (body, bodyText) => compileLeaves(body, bodyText), options.abilityId),
    (body, text) => compileLeaves(body, text), options.abilityId);
  if (compiled.ok && bound.some((leaf) => leaf.family_id === "aura-range" && leaf.parameters.conditional_range !== undefined)) {
    try { compiled.mechanics.effect = lowerConditionalAuras(compiled.mechanics.effect); } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      return { ok: false, signature: compiled.signature, errors: [error.message] };
    }
  }
  if (compiled.ok) {
    try { requireNamedRangeAuras(bound, compiled.mechanics.effect); } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      return { ok: false, signature: compiled.signature, errors: [error.message] };
    }
  }
  if (compiled.ok && containsRollMarker(compiled.mechanics)) {
    return { ok: false, signature: compiled.signature, errors: ["A roll-result band was left unresolved in the compiled output."] };
  }
  if (compiled.ok && gatesTriggerOnWarlord(compiled.mechanics)) {
    return { ok: false, signature: compiled.signature, errors: ["A Warlord gate on an army list covers a trigger-based ability; the trigger sentence is a separate rule and this record cannot be split here."] };
  }
  return compiled;
}

/** True when any node of a compiled tree is still the internal roll-result marker (never valid DSL). */
function containsRollMarker(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRollMarker);
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.type === "__roll-result" || Object.values(record).some(containsRollMarker);
}

/**
 * One record's leaves. With `oneRule`, the record's sentences are never split into independent parts
 * (compile-segments.ts): a reviewed leaf has said they resolve together.
 */
function compileRecord(given: readonly CompileLeaf[], sourceText?: string, options: CompileOptions = {}, oneRule = false): Compiled {
  // "Those attacks" are named across the whole record before it splits into parts (compile-bound-attacks.ts).
  // "only within Engagement Range of …" folds onto the engaged state before filters attach to their neighbours (compile-engagement-exclusive.ts).
  let qualified: CompileLeaf[];
  // "if this unit is controlling an objective, that objective is secured": the control test is the secured objective's own scope (compile-sticky-control.ts).
  // "has lost any wounds" before a heal of that model is what the heal already requires (compile-implied-heal.ts).
  try { qualified = foldStickyControl(foldEngagementExclusive(foldStanceInitial(foldWithEmbarked(foldImpliedHealCondition(given))), sourceText), sourceText); } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature: shapeSignature(ordered(given), sourceText), errors: [error.message] };
  }
  let leaves: CompileLeaf[];
  try { leaves = bindWhenSubject(nameBoundAttacks(qualified), sourceText); } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature: shapeSignature(ordered(given), sourceText), errors: [error.message] };
  }
  // A before-form hit names its unit by the unit-filter after it, so its later "that unit" binds to that unit (compile-weapon-qualified.ts).
  // Optional-spend pairing is checked over the whole record: a spend in one sentence can pair with a read in another.
  try { leaves = bindBeforeFormHits(leaves, sourceText); leaves = bindBareFilterHits(leaves, sourceText); checkOptionalCosts(leaves, sourceText); refuseBeforeFormAnaphors(leaves); refuseUnmovedEventSubject(leaves); refuseSuchFilters(leaves, sourceText); } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature: shapeSignature(ordered(leaves), sourceText), errors: [error.message] };
  }
  // A record of psychic abilities compiles each heading's ability as one part with its cost (compile-psychic-cost.ts).
  let psychic: PsychicSegment[] | null;
  try { psychic = psychicSegments(leaves, sourceText); } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature: shapeSignature(ordered(leaves), sourceText), errors: [error.message] };
  }
  if (psychic) return lowerPsychicRecord(psychic, shapeSignature(ordered(leaves), sourceText), (group) => compilePart(group, sourceText, options));
  const reactions = compileReactionParts(ordered(leaves), sourceText, (group) => compilePart(group, sourceText, options));
  if (reactions !== null) return reactions;
  const oath = compileOathRecord(leaves, sourceText, (group) => compilePart(group, sourceText, options));
  if (oath !== null) return oath;
  // A moment printed within an earlier moment's duration is a part on that window (compile-window-moment.ts).
  const window = compileWindowMoment(ordered(leaves), sourceText, (group) => compilePart(group, sourceText, options));
  if (window !== null) return window;
  const segments = oneRule ? null : sentenceSegments(ordered(leaves), sourceText);
  if (!segments) return compilePart(leaves, sourceText, options);
  // Independent sentences (compile-segments.ts) compile alone and join as parts of one ability.
  const signature = shapeSignature(ordered(leaves), sourceText);
  const results = segments.map((part) => compilePart(part, sourceText, options));
  // A part that cannot stand alone ("such a unit", an "instead" of an earlier sentence's effect)
  // is still tied to the sentences before it: the ability compiles as one part.
  if (results.some((result) => !result.ok)) return compilePart(leaves, sourceText, options);
  const joined = joinSegments(results.flatMap((result) => result.ok ? [result] : []), leaves.some((leaf) => STRATAGEM_HEADER.has(leaf.family_id)));
  if (joined.errors.length) return { ok: false, signature, errors: joined.errors };
  return { ok: true, signature, mechanics: joined.mechanics, checks: joined.checks, ...(joined.core ? { core: joined.core } : {}) };
}

function compilePart(leaves: readonly CompileLeaf[], sourceText: string | undefined, options: CompileOptions): Compiled {
  const signature = shapeSignature(ordered(leaves), sourceText);
  // Read before the placement limits fold into their set-up: a destroyed moment names its object for them.
  // Only a limit on a set-up or an added unit places units; a "within N of that unit" condition does not.
  const placesFromEventObject = leaves.some((leaf) => leaf.family_id === "unit-position" && leaf.parameters.of === "event-object")
    && leaves.some((leaf) => leaf.family_id === "set-up" || leaf.family_id === "add-unit");
  let list: CompileLeaf[];
  let conditionOf: ConditionOfPlan[] = [];
  try {
    // Reviewed "if it does" connectives are planned on the leaves as reviewed, before any fold (compile-connective-plan.ts).
    // "Selected to fight, after resolving its attacks" is one moment before any connective is planned on it (compile-selected-attacks.ts).
    leaves = foldSelectedAttacks(leaves, sourceText);
    // "Each time the bearer attempts a Ritual, just before … the Psychic test": one moment (compile-ritual-test.ts).
    leaves = foldRitualTest(leaves, sourceText);
    // "Each time a model … is destroyed, after the units embarked within it … emergency disembark moves": one moment (compile-emergency-disembark.ts).
    leaves = foldEmergencyDisembark(leaves, sourceText);
    conditionOf = planConditionOf(leaves, sourceText);
    // "the selected VEHICLE model" after a use of a named ability, in a record that selects nothing itself (compile-used-selection.ts).
    leaves = bindUsedSelections(foldAbilityUseRefresh(foldAbilityUseContext(leaves)));
    // "That X unit", "the selected Y unit" naming one of several bound selections (compile-named-selections.ts).
    leaves = bindSelectionRefs(leaves);
    // "… suffers D3+1 mortal wounds and … regains up to that many lost wounds": one roll for both (compile-that-many.ts).
    leaves = bindThatMany(leaves, sourceText);
    // "When this unit makes a save roll: on an unmodified 6, …": the band narrows the moment's roll (compile-roll-faces.ts).
    leaves = foldRollFaces(leaves);
    // "… suffers 1 mortal wound after that enemy unit has shot": the effect waits for that moment (compile-delayed-moment.ts).
    leaves = foldDelayedMoments(leaves, sourceText);
    refuseBlastRating(leaves, sourceText);
    refuseStratagemTargetActivity(leaves);
    refuseUnboundIfItDoes(leaves, sourceText);
    // "that weapon" names the weapon an earlier select-weapon bound, or the attacks an earlier keyword grant gave (compile-weapon-antecedent.ts).
    // An antecedent frame takes its recipient and weapon type from the frame before it (bindFrameAntecedents).
    const weaponBound = bindFrameAntecedents(ordered(bindWeaponAntecedents(bindEarlierNamed(resolveAuthoredNames(leaves, sourceText, options.weapons, options.abilityId), options.weapons, options.abilityId))));
    // A Stratagem with several targets: references to them first (compile-target-refs.ts).
    const refs = bindTargetRefs(mergeStackedFilters(foldHolderAbilities(foldSetUpPlacement(foldManoeuvreOwnRoll(foldHistoryWindow(foldByAbility(foldAuraMoments(foldUsedObjects(foldStratagemTail(foldObjectRange(splitIgnoreModifiers(resolveAttackBackrefs(groupMembership(hoistWeaponRecipients(foldWarlordTests(foldEffectAfterAttacks(foldDestructionAfterAttacks(foldDisembarkMoment(foldStepWindow(ordered(weaponBound), sourceText), sourceText), sourceText), sourceText)), sourceText)))), sourceText), sourceText), sourceText), sourceText), sourceText), sourceText), options.menuActions ?? manoeuvreLookupFor(options.abilityId)), sourceText), sourceText, options.abilityId), sourceText), sourceText);
    const bound = foldCountScales(bindDesignationSubjects(foldAlternativePools(bindPrecedingRolls(foldBoundAttacks(refuseBareTarget(bindAntecedents(markCountedSubjects(bindArmyAntecedents(foldArmyAttachments(foldForwardComposition(refs.leaves), sourceText))), refs.focus, sourceText), isPlacedLimit)), sourceText))), sourceText);
    refuseTransportAsSubject(bound);
    refuseDestinationMismatch(bound, sourceText);
    const scoped = bindWeaponStatAntecedents(foldWeaponScopes(foldModelState(foldReturnedModelExclusions(foldFightNext(foldCountsAsMoved(foldPassthroughUsed(foldAsIfPhases(foldHitFilters(foldLeadingHitFilters(foldTargetingWeapons(foldDestroyFilters(foldMortalWoundSources(bindEquippedCounts(bound)), sourceText), sourceText), sourceText), sourceText), sourceText)), sourceText), sourceText), sourceText)), sourceText));
    const filtered = resolveArmyGroups(foldWeaponAlreadyHas(bindScopeAttacks(foldUnitFilters(foldArmyPer(foldWeaponKeywords(foldAttackProperties(bindMatchedPools(scoped), sourceText), sourceText), sourceText), sourceText))));
    // "For each X model you select, roll one D6": a plain roll inside the model selection (compile-selected-model-roll.ts);
    // "select one objective that: …": the criteria fold into the selection (compile-objective-criteria.ts).
    list = foldDestroyedSelections(foldObjectiveCriteria(foldAllocatedAttackRolls(foldSelectedModelRolls(withDesignationExpiry([...foldSetUpLimits(foldActivationPicks(foldAlternativeConditions(foldConditionExclusions(bindTargetedTarget(filtered), sourceText), sourceText)))])))));
    // A moment a reviewed "if" makes a condition is a history condition from here on (compile-connective-history.ts).
    list = lowerHistoryMoments(list, conditionOf.flatMap((plan) => plan.kind === "history" ? [plan] : []));
    refuseUnboundWeaponScope(list);
    refuseSelectionAcrossMoment(list);
    refuseDistanceWithoutWeapon(list);
    refuseEmbarkDestination(list);
    refuseHistoryValueWithoutSource(list);
    // "This ability can be used even if this unit is embarked": the designation before it may be chosen while embarked (compile-embarked-permission.ts).
    list = foldEmbarkedPermission(list);
    // A roll of a named ability's own dice needs that ability used in its clause before it (compile-ability-roll.ts).
    checkAbilityRollUses(list);
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature, errors: [error.message] };
  }
  // "within range of that objective marker": the marker this record's one select-objective chose.
  const objectiveSelections = list.filter((leaf) => leaf.family_id === "select-objective-open").map((leaf) => String(leaf.parameters.bind_as));
  list = list.map((leaf) => (leaf.family_id === "unit-position" && leaf.parameters.objective === "selected" || (leaf.family_id === "apply-mark" || leaf.family_id === "sticky-objective") && leaf.parameters.subject === "selected-objective") && objectiveSelections.length === 1
    ? { ...leaf, parameters: { ...leaf.parameters, selection_var: objectiveSelections[0] } } : leaf);
  // "in any phase" with no turn restricts nothing: it says the ability is not phase-bound.
  list = list.filter((leaf) => !(leaf.family_id === "phase-window" && leaf.parameters.phase === "any"
    && (leaf.parameters.turn === undefined || leaf.parameters.turn === "either")));
  // named-region-state is a whole ability by itself: the DSL shape it produces has no room for
  // any other leaf beside it (see compile-named-region.ts for why).
  if (list.length === 1 && list[0]!.family_id === "named-region-state") {
    try {
      const { effect: node, behavior } = compileNamedRegionState(list[0]!);
      return { ok: true, signature, mechanics: { effect: node, scope: { duration: "permanent" }, behavior, trigger: null }, checks: [] };
    } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      return { ok: false, signature, errors: [error.message] };
    }
  }
  if (list.some((leaf) => leaf.family_id === "named-region-state")) {
    return { ok: false, signature, errors: ["named-region-state must be the ability's only leaf."] };
  }
  try {
    list = dropRedundantMenuOpeners(list);
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature, errors: [error.message] };
  }
  const places = placements(list, sourceText);
  // An optional-use that is a designation's own choice ("you can select …") is the wrapped opener's, not the ability's.
  const designationOptional = optionalDesignationUses(list, places.map((place) => place.sentence));
  // "At the start of the battle": the designation's own start timing states that moment, so the leaves that say it are not also the ability's.
  const designationTiming = timingMoments(list, places.map((place) => place.sentence));
  let containerNodes: Map<number, Node>;
  let consumedByContainer: Set<number>;
  try {
    ({ nodes: containerNodes, consumed: consumedByContainer } = planContainers(list, places.map((place) => place.sentence), (group, objective, name) => nestedPart(group, sourceText, options, objective, name), bulletBreaks(list, sourceText), commaItems(list, sourceText), plainLineBreaks(list, sourceText)));
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature, errors: [error.message] };
  }
  const frame = classifyLeaves(list, places, { containerNodes, consumedByContainer, designationOptional, designationTiming, placesFromEventObject }, sourceText);
  const plan = planEffects(frame, sourceText, options);
  const bindings = bindParts(frame, plan, sourceText, options);
  if (frame.errors.length > 0) return { ok: false, signature, errors: frame.errors };
  const assembled = assemblePart(frame, plan, bindings, conditionOf, signature, sourceText, options);
  if (!assembled.ok) return assembled;
  // A selection after "those attacks" resolve is made once, outside their per-attack gate (compile-resolved-selection.ts).
  try {
    return { ...assembled, mechanics: { ...assembled.mechanics, effect: hoistResolvedSelections(assembled.mechanics.effect) as typeof assembled.mechanics.effect } };
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature, errors: [error.message] };
  }
}
