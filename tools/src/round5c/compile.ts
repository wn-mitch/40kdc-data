import { foldActivationPicks, retargetMenu } from "./compile-activation.js";
import { AURA_RECIPIENT, bindAntecedents, momentNamesUnit } from "./compile-antecedent.js";
import { checkAbilityUsedWindows, foldAuraMoments, foldByAbility, namedAbilityChecks } from "./compile-named-ability.js";
import { foldObjectRange, foldStratagemTail } from "./compile-opponent-stratagem.js";
import { foldManoeuvreOwnRoll, manoeuvreLookupFor } from "./compile-manoeuvre-own-roll.js";
import type { ManoeuvreMenus } from "./named-ability-checks.js";
import { foldAsIfPhases } from "./compile-as-if.js";
import { foldCountsAsMoved } from "./compile-counts-as-moved.js";
import { foldBoundAttacks, nameBoundAttacks } from "./compile-bound-attacks.js";
import { chooseBetweenGroups } from "./compile-choice-groups.js";
import { addsAttackGate, attackTargetBinding, isBackref, resolveAttackBackrefs } from "./compile-attack-backref.js";
import { bindArmyAntecedents, armyCoreChecks, foldArmyAttachments, foldArmyPer, resolveArmyGroups } from "./compile-army.js";
import { bindPrecedingRolls, foldConditionalTestModifiers } from "./compile-preceding-roll.js";
import { CompileError, effect, type CompileLeaf } from "./compile-fragments.js";
import { withDesignationExpiry } from "./compile-designation-expiry.js";
import { activationWindowCondition, allOf, ATTACK_EVENTS, attackTypeCondition, bindDesignationSubjects, condition, duration, foldHitFilters, negate, targetRestrictions } from "./compile-conditions.js";
import { foldDestroyFilters, foldLeadingHitFilters, refuseBeforeFormAnaphors } from "./compile-weapon-qualified.js";
import { trigger, triggerLeaves, withDestroyedObject } from "./compile-triggers.js";
import { bulletBreaks, ordered, placements, shapeSignature } from "./compile-placement.js";
import { refuseOtherwiseGates } from "./compile-otherwise.js";
import { bindDurations, CONFLICTING_DURATIONS, durationPart, NO_ROLL_AFTER_ADVANCE, NO_ROLL_PLUS_SIX, placeInWindow, refuseTestAfterMark } from "./compile-durations.js";
import { isRollMarker, resolveRolls, rollMarker } from "./compile-dice.js";
import { isContainerOpener, planContainers } from "./compile-containers.js";
import { optionalDesignationUses, timingMoments } from "./compile-redesignate.js";
import { designation, selectionHasFilter, selectUnit, wrapAura, wrapForEachUnit, wrapLeaderTarget, wrapRulesBundle, WRAP_CONDITION_FAMILIES } from "./compile-wrappers.js";
import { compileNamedRegionState } from "./compile-named-region.js";
import { selectionLimitFor } from "./compile-selection-limit.js";
import { boundSelectionPair } from "./compile-bound-selection.js";
import { bearerModelMax } from "./compile-bearer-size.js";
import { foldAlternativeConditions } from "./compile-alternative-conditions.js";
import { refuseSelectionAcrossMoment } from "./compile-selection-moment.js";
import { foldUnitFilters, mergeStackedFilters } from "./compile-unit-filters.js";
import { foldWarlordTests, gatesTriggerOnWarlord } from "./compile-warlord-test.js";
import { foldEngagementExclusive } from "./compile-engagement-exclusive.js";
import { applyHolderAllowance, foldHolderAbilities } from "./compile-holder-abilities.js";
import { destroyedFilterObject, wrapModelAura, groupMembership } from "./compile-model-level.js";
import { bindTargetedTarget, namesSelection } from "./compile-targeting-history.js";
import { dropRedundantMenuOpeners, foldWeaponKeywords, refuseBlastRating } from "./compile-weapon-keywords.js";
import { foldWeaponScopes, hoistWeaponRecipients } from "./compile-weapon-scopes.js";
import { bindFrameAntecedents, bindScopeAttacks, bindWeaponAntecedents, bindWeaponStatAntecedents, refuseUnboundWeaponScope } from "./compile-weapon-antecedent.js";
import { bindEarlierNamed, refuseDistanceWithoutWeapon, resolveAuthoredNames, type WeaponNameContext } from "./compile-weapon-names.js";
import { bindEquippedCounts } from "./compile-equipped-count.js";
import { foldAttackProperties } from "./compile-attack-properties.js";
import { foldReturnedModelExclusions } from "./compile-returned-model-exclusions.js";
import { foldModelState } from "./compile-model-state.js";
import { foldSetUpLimits, foldSetUpPlacement, isForbiddenSetUp } from "./compile-set-up-placement.js";
import { foldCountScales, markCountedSubjects } from "./compile-count-scale.js";
import { alternativeMoments, joinSegments, sentenceSegments, STRATAGEM_HEADER } from "./compile-segments.js";
import { planDelayedDestruction } from "./compile-delayed-destruction.js";
import { triggerMoveEnd, type MoveEndRule } from "./compile-move-end.js";
import { attachMoveEndNearest, bindEngagedPermissions, isBonusNode } from "./compile-move-end-nearest.js";
import { compileGranted } from "./compile-granted.js";
import { bindCharacteristicAmounts } from "./compile-characteristic-amount.js";
import { bindAdditiveOptions } from "./compile-additive-option.js";
import { bindIgnoreLists } from "./compile-ignore-list.js";
import type { CoreCheck } from "./core-checks.js";
import { compileWithName, NAME_FRAGMENT } from "./compile-name.js";
import { lowerPsychicRecord, psychicSegments, type PsychicSegment } from "./compile-psychic-cost.js";
import type { Mechanics } from "./entries.js";
import { usageFor } from "./restriction-families.js";
import { bindTargetRefs, refuseBareTarget, resolveEntry } from "./compile-target-refs.js";
import { refuseEmbarkDestination, refuseTransportAsSubject } from "./compile-transport-embark.js";
import { defenderBoundBefore } from "./compile-attack-frame.js";
import { groupedTargetRestrictions, optionalTargetGroup, severalTargets } from "./compile-target-groups.js";
import { checkOptionalCosts, flatLeaves, isSpendRead, optionalSpendLeaves, wrapOptionalSpends } from "./compile-optional-cost.js";
import { foldEmbarkedPermission } from "./compile-embarked-permission.js";
import { attackFold, isAttackMoment, triggerWindow } from "./compile-attack-window.js";
import { bindMatchedPools } from "./compile-matched-set.js";

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
 *   the effects of its own clause, in either word order ("if X, add 1" or "add 1 if X").
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

export { leafFragment, type LeafFragment } from "./compile-leaf-fragment.js";
export { shapeSignature } from "./compile-placement.js";

/**
 * Who makes an attack: a unit-filter folded onto it (compile-unit-filters.ts), any friendly or
 * enemy unit, this model, the aura's recipient or this unit. "That unit" is the unit an earlier
 * leaf introduced: the aura's recipient, else the selected unit, else this unit (a led unit).
 */
function attackerOf(attack: CompileLeaf, thatUnit: string): Node | string {
  if (attack.parameters.attacker_filter !== undefined) return structuredClone(attack.parameters.attacker_filter as Node);
  const unit = attack.parameters.unit;
  if (unit === "friendly-unit") return { owner: "friendly" };
  if (unit === "enemy-unit") return { owner: "enemy" };
  if (unit === "that-unit") return thatUnit;
  return unit === "this-model" ? "this-model" : unit === "recipient" ? "recipient" : "this-unit";
}

const gated = (gate: Node[], body: Node): Node => {
  const node = allOf(gate);
  return node ? { type: "conditional", condition: node, effect: body } : body;
};

/**
 * A condition on the attacker of the attack a designation changes ("that disembarked from this
 * TRANSPORT this turn" + "makes an attack"): it is checked per attack, not once when the
 * designation starts, because the attacker is not the unit that made the selection.
 */
const isAttackerGate = (node: Node): boolean => node.type === "happened" && (node.parameters as { subject?: unknown } | undefined)?.subject === "attacker";

/** Leaves only a stratagem has: its phase window and its TARGET. */
const STRATAGEM_FAMILIES = new Set(["use-window", "stratagem-target", "triggering-target", "target-binding"]);

/**
 * Effects that keep changing the game until something ends them, so a duration bounds them. One-off
 * results (mortal wounds, a move, a test, a set-up, regained wounds, CP) and effects that end by
 * their own rule (a designation, a sticky objective, a state change, an activated option) are not.
 */
const LASTING_EFFECTS = new Set([
  "ability-grant", "ability-modifier", "act-on-death", "borrow-weapons", "cost-modifier", "counts-as", "damage-reduction",
  "destruction-rule", "feel-no-pain", "ignore-modifiers", "invulnerable-save", "keyword-grant", "leader-model-ability-grant",
  "move-modifier", "named-region-state", "permission", "re-roll", "roll-modifier", "roll-result", "rule-state", "stat-modifier",
  "targeting", "test-exemption", "transport-capacity", "weapon-ability-grant", "weapon-ability-range", "weapon-grant",
]);

/** Whether an effect tree holds a lasting effect. */
function hasLastingEffect(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasLastingEffect);
  if (node === null || typeof node !== "object") return false;
  const record = node as Node;
  return (typeof record.type === "string" && LASTING_EFFECTS.has(record.type)) || isForbiddenSetUp(record) || Object.values(record).some(hasLastingEffect);
}

/**
 * The period a used or triggered ability's window names, which its effects last for when no
 * duration is printed (core rule 01.02.02: "In the Shooting phase" with no duration lasts until the
 * end of that Shooting phase). A window of phases is a phase; "in your turn" alone is the turn.
 */
function windowPeriod(list: readonly CompileLeaf[]): "phase" | "turn" | null {
  // A folded either-phase window ("in your Shooting phase and the Fight phase") is one any-of whose
  // alternatives are each one phase window; those alternatives are the windows. Other any-of leaves
  // (an "or" with a non-window condition) hold no window.
  const flat = list.flatMap((leaf) => {
    if (leaf.family_id !== "__any-of") return [leaf];
    const alternatives = leaf.parameters.alternatives as CompileLeaf[][];
    return alternatives.every((alternative) => alternative.length === 1 && alternative[0]!.family_id === "phase-window") ? alternatives.flat() : [];
  });
  const windows = flat.filter((leaf) => leaf.family_id === "use-window" || leaf.family_id === "activation-window"
    || (leaf.family_id === "phase-window" && leaf.parameters.phase !== "any"));
  if (windows.some((leaf) => leaf.family_id !== "phase-window" || leaf.parameters.phase !== undefined)) return "phase";
  return windows.length ? "turn" : null;
}

/** Effects that forbid something; an "instead" after one says what happens in its place. */
const PROHIBITIONS = new Set(["no-advance-roll"]);

/** A gate that tests an Advance already made ("if it Advanced this turn"): no moment where a roll can still be skipped. */
const testsMadeAdvance = (gates: Node[]) => gates.some((gate) => /"type":"happened"[^]*"move_types":\[[^\]]*"advance"/.test(JSON.stringify(gate)));

/** "Add 6 to Move": what a no-advance-roll's `advance: fixed-6` does in place of the roll. */
function isAdvanceInPlace(node: Node): boolean {
  const modifier = node.modifier as Node | undefined;
  return node.type === "stat-modifier" && node.target !== "attacker" && modifier?.stat === "M" && modifier.operation === "add"
    && Number(modifier.value) === 6 && modifier.weapon_type === undefined;
}

type PlannedEffect = { index: number; leaf: CompileLeaf; node: Node; gate: Node[]; selected: boolean; replaces: boolean };

/**
 * A container option that carries its own moment or conditions, compiled as a whole ability and
 * returned as one ability-part: its trigger, usage and duration go on the part, its effect inside.
 */
function nestedPart(group: readonly CompileLeaf[], sourceText: string | undefined, options: CompileOptions, objective?: string): Node {
  const compiled = compileLeaves(group, sourceText, objective === undefined ? options : { ...options, selectedObjective: objective });
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
    const { what, stats, rolls, ...rest } = leaf.parameters as Record<string, unknown> & { what: string[] };
    return what.map((kind) => ({ ...leaf, parameters: { ...rest, what: kind, ...(kind === "characteristics" ? (stats === undefined ? {} : { stats }) : { rolls }) } }));
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
};

/** Compile one ability's reviewed leaves. Failures name what is missing; nothing is guessed. */
export function compileLeaves(leaves: readonly CompileLeaf[], sourceText?: string, options: CompileOptions = {}): Compiled {
  // A span over the record's name compiles as its own part, beside the body (compile-name.ts).
  if (leaves.some((leaf) => leaf.fragment === NAME_FRAGMENT)) {
    return compileWithName(leaves, sourceText, options, compileLeaves, (list) => shapeSignature(ordered(list), sourceText));
  }
  // Qualifiers printed apart from their host are bound first: a characteristic amount after its recipient (compile-characteristic-amount.ts), an additive option after its duration (compile-additive-option.ts), and an ignore-modifier list after its lead-in (compile-ignore-list.ts).
  let bound: CompileLeaf[];
  try { bound = bindIgnoreLists(bindAdditiveOptions(bindCharacteristicAmounts(leaves), sourceText), sourceText); } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature: shapeSignature(ordered(leaves), sourceText), errors: [error.message] };
  }
  // An ability the record prints as granted compiles alone, as its holder's own (compile-granted.ts).
  // "This ability" inside a granted body is the granted one, not the record, so a body gets no id.
  const compiled = compileGranted(bound, sourceText, (host, text) => compileRecord(host, text, options), (body, text) => compileLeaves(body, text), options.abilityId);
  if (compiled.ok && gatesTriggerOnWarlord(compiled.mechanics)) {
    return { ok: false, signature: compiled.signature, errors: ["A Warlord gate on an army list covers a trigger-based ability; the trigger sentence is a separate rule and this record cannot be split here."] };
  }
  return compiled;
}

function compileRecord(given: readonly CompileLeaf[], sourceText?: string, options: CompileOptions = {}): Compiled {
  // "Those attacks" are named across the whole record before it splits into parts (compile-bound-attacks.ts).
  // "only within Engagement Range of …" folds onto the engaged state before filters attach to their neighbours (compile-engagement-exclusive.ts).
  let qualified: CompileLeaf[];
  try { qualified = foldEngagementExclusive(given, sourceText); } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature: shapeSignature(ordered(given), sourceText), errors: [error.message] };
  }
  const leaves = nameBoundAttacks(qualified);
  // Optional-spend pairing is checked over the whole record: a spend in one sentence can pair with a read in another.
  try { checkOptionalCosts(leaves, sourceText); refuseBeforeFormAnaphors(leaves); } catch (error) {
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
  const segments = sentenceSegments(ordered(leaves), sourceText);
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
  try {
    refuseBlastRating(leaves, sourceText);
    // "that weapon" names the weapon an earlier select-weapon bound, or the attacks an earlier keyword grant gave (compile-weapon-antecedent.ts).
    // An antecedent frame takes its recipient and weapon type from the frame before it (bindFrameAntecedents).
    const weaponBound = bindFrameAntecedents(ordered(bindWeaponAntecedents(bindEarlierNamed(resolveAuthoredNames(leaves, sourceText, options.weapons, options.abilityId), options.weapons, options.abilityId))));
    // A Stratagem with several targets: references to them first (compile-target-refs.ts).
    const refs = bindTargetRefs(mergeStackedFilters(foldHolderAbilities(foldSetUpPlacement(foldManoeuvreOwnRoll(foldByAbility(foldAuraMoments(foldStratagemTail(foldObjectRange(splitIgnoreModifiers(resolveAttackBackrefs(groupMembership(hoistWeaponRecipients(foldWarlordTests(ordered(weaponBound)), sourceText)))), sourceText), sourceText), sourceText), sourceText), options.menuActions ?? manoeuvreLookupFor(options.abilityId)), sourceText), sourceText, options.abilityId), sourceText), sourceText);
    const bound = foldCountScales(bindDesignationSubjects(bindPrecedingRolls(foldBoundAttacks(refuseBareTarget(bindAntecedents(markCountedSubjects(bindArmyAntecedents(foldArmyAttachments(refs.leaves, sourceText))), refs.focus, sourceText))), sourceText)), sourceText);
    refuseTransportAsSubject(bound);
    const scoped = bindWeaponStatAntecedents(foldWeaponScopes(foldModelState(foldReturnedModelExclusions(foldCountsAsMoved(foldAsIfPhases(foldHitFilters(foldLeadingHitFilters(foldDestroyFilters(bindEquippedCounts(bound), sourceText), sourceText), sourceText), sourceText), sourceText), sourceText)), sourceText));
    const filtered = resolveArmyGroups(bindScopeAttacks(foldUnitFilters(foldArmyPer(foldWeaponKeywords(foldAttackProperties(bindMatchedPools(scoped), sourceText), sourceText), sourceText), sourceText)));
    list = withDesignationExpiry([...foldSetUpLimits(foldActivationPicks(foldAlternativeConditions(bindTargetedTarget(filtered), sourceText)))]);
    refuseUnboundWeaponScope(list);
    refuseSelectionAcrossMoment(list);
    refuseDistanceWithoutWeapon(list);
    refuseEmbarkDestination(list);
    // "This ability can be used even if this unit is embarked": the designation before it may be chosen while embarked (compile-embarked-permission.ts).
    list = foldEmbarkedPermission(list);
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature, errors: [error.message] };
  }
  // "within range of that objective marker": the marker this record's one select-objective chose.
  const objectiveSelections = list.filter((leaf) => leaf.family_id === "select-objective-open").map((leaf) => String(leaf.parameters.bind_as));
  list = list.map((leaf) => (leaf.family_id === "unit-position" && leaf.parameters.objective === "selected" || leaf.family_id === "apply-mark" && leaf.parameters.subject === "selected-objective") && objectiveSelections.length === 1
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
    ({ nodes: containerNodes, consumed: consumedByContainer } = planContainers(list, places.map((place) => place.sentence), (group, objective) => nestedPart(group, sourceText, options, objective), bulletBreaks(list, sourceText)));
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature, errors: [error.message] };
  }
  const errors: string[] = refuseOtherwiseGates(list, places, sourceText);
  const attempt = <T>(work: () => T): T | null => {
    try {
      return work();
    } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      errors.push(error.message);
      return null;
    }
  };

  const effectSentences = new Set(list.flatMap((leaf, index) => leaf.role === "EFFECT" ? [places[index]!.sentence] : []));
  const firstSentence = Math.min(...effectSentences);
  const firstEffect = (sentence: number) => list.findIndex((leaf, index) => leaf.role === "EFFECT" && places[index]!.sentence === sentence);
  const attached = list.some((leaf) => leaf.family_id === "leading-unit");
  const global: Node[] = [];
  /** Conditions keyed by the scope they gate: a sentence's leading conditions, or one clause. */
  const sentenceGates = new Map<number, Node[]>();
  const clauseGates = new Map<number, Node[]>();
  const selectedClauses = new Set<number>();
  const selectedSentences = new Set<number>();
  let selectedGlobally = false;
  const triggers: Node[] = [];
  const triggerIndexes: number[] = [];
  const durations: string[] = [];
  const durationAt: number[] = [];
  const selections: CompileLeaf[] = [];
  const rolls: CompileLeaf[] = [];
  const combinators: number[] = [];
  const usages: Record<string, unknown>[] = [];
  const usageIndexes: number[] = [];
  const usageScopes = new Set<string>();
  // Per-model usage-limits: on a model selection each caps the selected model (selection_limit); otherwise they stay usages.
  const modelUsages: Array<{ leaf: CompileLeaf; index: number }> = [];
  let optional = false;
  // "You can spend YP …" read later as "if you spent YP during this use", or by a trigger later in the ability: the spend is the optional part, not the use.
  const optionalSpend = flatLeaves(list).some(isSpendRead);
  // An optional spend is offered by its own part, so it takes no clause gate and no instead clause's place (compile-optional-cost.ts).
  const optionalSpends = optionalSpendLeaves(list);
  const checks: CoreCheck[] = namedAbilityChecks(list);
  attempt(() => checkAbilityUsedWindows(list));
  attempt(() => checkOptionalCosts(list, sourceText));
  const targetParts: CompileLeaf[] = [];
  const targetPartIndexes: number[] = [];
  const targetConditions: Array<{ index: number; node: Node; eachTarget: boolean }> = [];
  const optionalTargets = new Set<number>();
  // Container-wrapping markers (batch 5): at most one of each is expected on a real ability.
  let auraLeaf: CompileLeaf | null = null;
  let leaderLeaf: CompileLeaf | null = null;
  let forEachLeaf: CompileLeaf | null = null;
  let rulesBundle = false;

  // "Your unit must end that move either …": the conditions after a move-must-end in its sentence
  // say where the preceding move ends, so they gate nothing and are taken out of clause binding.
  // A move-must-end or condition that a container option consumed belongs to that option, not to the outer move.
  const moveEnds: MoveEndRule[] = list.flatMap((leaf, index) => leaf.family_id === "move-must-end" && !consumedByContainer.has(index) ? [{
    index, match: String(leaf.parameters.match), cannot: leaf.parameters.polarity === "cannot",
    moveTypes: Array.isArray(leaf.parameters.move_types) ? leaf.parameters.move_types as string[] : null,
    conditions: list.flatMap((other, at) => at > index && other.role === "CONDITION" && !consumedByContainer.has(at) && places[at]!.sentence === places[index]!.sentence ? [at] : []),
    replaces: leaf.parameters.replaces === true,
  }] : []);
  const endConditions = new Set(moveEnds.flatMap((rule) => rule.conditions));
  // Conditions on the selected unit right after a selection in its sentence ("select one enemy
  // unit within 6\" of this unit", "that are on the battlefield") say which units can be selected:
  // the selection's eligibility, not a gate on the ability.
  const selectionIndex = list.findIndex((leaf) => leaf.family_id === "select-unit");
  const eligibilityIndexes = selectionIndex === -1 ? [] : list.flatMap((leaf, at) => at > selectionIndex && leaf.role === "CONDITION"
    && leaf.parameters.subject === "selected-unit" && places[at]!.sentence === places[selectionIndex]!.sentence
    && !list.slice(selectionIndex + 1, at).some((between) => between.role === "EFFECT") ? [at] : []);
  for (const at of eligibilityIndexes) endConditions.add(at);
  const battleSizeCount = list.find((leaf) => leaf.family_id === "count-by-battle-size");
  // Battle-size leaves for two or more sizes are table rows: alternatives, one per size. Each row
  // decides only its own sentence, so a row never joins the ability-wide gates (where rows would
  // AND together and the ability could never apply).
  const sizeRows = new Set(list.filter((leaf) => leaf.family_id === "battle-size").map((leaf) => String(leaf.parameters.size))).size >= 2;

  // Outside an aura or a for-each, a condition about the recipient is about each unit an effect's filter matches.
  // A clause that states a move-end and a condition: the condition gates the end rule, not a move
  // bonus in the same clause, which is available regardless.
  const endClauses = new Set(list.flatMap((leaf, at) => leaf.family_id === "move-end-nearest" || leaf.family_id === "move-end-waiver" ? [places[at]!.clause] : []));
  const perRecipient = !list.some((leaf) => leaf.family_id === "aura-range" || leaf.family_id === "for-each-unit-select");
  list.forEach((leaf, index) => {
    if (endConditions.has(index)) return;
    // A container opener's options are folded into its own node (`containerNodes.get(index)`,
    // used where planned effects are built below); the leaves that became those options never
    // separately reach condition/duration/event dispatch or their own planned effect.
    if (consumedByContainer.has(index) || designationTiming.has(index)) return;
    const { sentence, clause } = places[index]!;
    const first = firstEffect(sentence);
    const leading = first === -1 || index < first;
    const scope = (node: Node | "selected") => {
      // A result band decides only the effects of its own clause, wherever it sits in it.
      if (node !== "selected" && node.type === "__roll-result") {
        clauseGates.set(clause, [...(clauseGates.get(clause) ?? []), node]);
      } else if (!effectSentences.has(sentence) || (sentence === firstSentence && leading)) {
        if (node === "selected") selectedGlobally = true;
        else global.push(node);
      } else if (leading) {
        if (node === "selected") selectedSentences.add(sentence);
        else sentenceGates.set(sentence, [...(sentenceGates.get(sentence) ?? []), node]);
      } else if (node === "selected") {
        selectedClauses.add(clause);
      } else {
        clauseGates.set(clause, [...(clauseGates.get(clause) ?? []), node]);
      }
    };
    attempt(() => {
      // A trigger's read of an optional spend gates the clause that uses the designation (an "instead"), never the
      // sentence that holds the spend: the spend is offered until it is paid, so the read cannot gate its own offer.
      if (leaf.role === "CONDITION" && leaf.family_id === "optional-cost-paid" && leaf.parameters.window === "trigger") {
        clauseGates.set(clause, [...(clauseGates.get(clause) ?? []), condition(leaf)]);
      }
      // In the TARGET fragment no attack is being made: "target" is the candidate unit, the eligibility's default subject.
      // Each target (subject each-target) is the candidate of every group it is copied into (compile-target-groups.ts).
      // An each-target condition in RESTRICTIONS ("Each unit targeted with this Stratagem must …") is eligibility too.
      else if (leaf.role === "CONDITION" && (leaf.fragment === "TARGET" || (leaf.fragment === "RESTRICTIONS" && leaf.parameters.subject === "each-target"))) {
        const candidate = leaf.parameters.subject === "target" || leaf.parameters.subject === "each-target";
        targetConditions.push({ index, eachTarget: leaf.parameters.subject === "each-target", node: condition(candidate ? { ...leaf, parameters: { ...leaf.parameters, subject: "this-unit" } } : leaf) });
      }
      else if (leaf.role === "CONDITION" && WRAP_CONDITION_FAMILIES.has(leaf.family_id)) {
        if (leaf.family_id === "aura-range") auraLeaf = leaf;
        else leaderLeaf = leaf;
      }
      else if (leaf.role === "CONDITION" && sizeRows && leaf.family_id === "battle-size") {
        // A row whose sentence holds a count-by-battle-size is already said by that count's value
        // for this size; a row with effects gates them; a bare heading row decides nothing.
        if (list.some((other, at) => other.family_id === "count-by-battle-size" && places[at]!.sentence === sentence)) return;
        // An effectless row joins the next sentence (compile-placement.ts), so two sizes on one
        // sentence are headings over the same effect, and neither says what its size decides.
        const other = list.find((item, at) => at !== index && item.family_id === "battle-size" && places[at]!.sentence === sentence && item.parameters.size !== leaf.parameters.size);
        if (!effectSentences.has(sentence) || other) throw new CompileError(`A ${String(leaf.parameters.size)} row has no effect or count in its sentence for its battle size to decide.`);
        sentenceGates.set(sentence, [...(sentenceGates.get(sentence) ?? []), condition(leaf)]);
      }
      // "If a friendly X unit is …, that unit's …": a per-recipient condition (compile-antecedent.ts)
      // is about the units of its own sentence's effect, so it gates only that sentence.
      else if (leaf.role === "CONDITION" && perRecipient && effectSentences.has(sentence) && Object.values(leaf.parameters).includes("recipient")) {
        sentenceGates.set(sentence, [...(sentenceGates.get(sentence) ?? []), condition(leaf)]);
      }
      else if (leaf.role === "CONDITION") scope(leaf.family_id === "target-is-selected" && !namesSelection(leaf) ? "selected" : leaf.family_id === "roll-result" ? rollMarker(leaf) : condition(leaf));
      else if (leaf.role === "DURATION") { durations.push(duration(leaf)); durationAt.push(index); }
      else if (leaf.role === "COMBINATOR") combinators.push(index);
      else if (leaf.role === "RESTRICTION") {
        if (leaf.family_id === "usage-limit") {
          usages.push(usageFor(leaf.parameters));
          usageIndexes.push(index);
          if (leaf.parameters.per !== undefined) usageScopes.add(String(leaf.parameters.per));
          if (leaf.parameters.per === "model") modelUsages.push({ leaf, index });
        } else if (leaf.family_id === "usage-scope") usageScopes.add(String(leaf.parameters.per));
        else if (leaf.family_id === "optional-use" && designationOptional.has(index)) { /* the designation's own choice: its opener is wrapped optional */ }
        else if (leaf.family_id === "optional-use") {
          // "You can also target one …": that later target is optional, not the Stratagem's use.
          const group = optionalTargetGroup(list, index);
          if (group === null) optional = optional || !optionalSpend;
          else optionalTargets.add(group);
        }
        else if (leaf.family_id === "rules-bundle-marker") rulesBundle = true;
        else if (["stratagem-target", "target-binding", "triggering-target"].includes(leaf.family_id)) { targetParts.push(leaf); targetPartIndexes.push(index); }
        else if (leaf.family_id === "use-window" || leaf.family_id === "bearer-eligibility") checks.push({ kind: leaf.family_id, parameters: leaf.parameters });
        // A non-Stratagem ability has no core record to hold its phases, so they gate the whole ability.
        else if (leaf.family_id === "activation-window") global.push(activationWindowCondition(leaf.parameters));
        else if (leaf.family_id === "move-must-end" || leaf.family_id === "reserves-arrival" || leaf.family_id === "count-by-battle-size") { /* folded below */ }
        else if (leaf.family_id === "move-end-nearest" || leaf.family_id === "move-end-waiver") { /* attached below */ }
        // "this model has that ability": the menu before it already applies the chosen options;
        // "that unit has that ability": they are about the holder, not this unit.
        else if (leaf.family_id === "chosen-option-grant") {
          const opener = list.slice(0, index).map((other) => isContainerOpener(other.family_id)).lastIndexOf(true);
          if (opener < 0) throw new CompileError("\"Has that ability\" names the options chosen from a menu, but no menu opens before it.");
          const holder = String(leaf.parameters.holder);
          if (holder !== "this-unit" && holder !== "this-model" && containerNodes.has(opener)) containerNodes.set(opener, retargetMenu(containerNodes.get(opener), holder) as Node);
        }
        else throw new CompileError(`Restriction ${leaf.family_id} has no DSL fragment yet.`);
      }
      else if (leaf.role === "EVENT") {
        if (leaf.family_id === "attack") {
          // An attack whose properties compile-attack-properties.ts framed has its type on each of them;
          // a back-reference repeats its antecedent's type only where that one's gate does not reach.
          const gate = addsAttackGate(leaf) ? attackTypeCondition(leaf) : null;
          if (gate) scope(gate);
          // "targets that unit": the designation's unit needs nothing more; the selected unit scopes as a selection.
          if (leaf.parameters.target === "that-unit" && attackTargetBinding(list, index) === "selected") scope("selected");
        } else if (leaf.family_id === "select-unit") selections.push(leaf);
        else if (leaf.family_id === "for-each-unit-select") forEachLeaf = leaf;
        else if (leaf.family_id === "dice-roll") rolls.push(leaf);
        else if (!(leaf.family_id === "event" && ATTACK_EVENTS.has(String(leaf.parameters.kind)))) {
          // A list of roll kinds is one trigger per kind (compile-triggers.ts triggerLeaves).
          for (const each of triggerLeaves(leaf)) {
            triggers.push(withDestroyedObject(trigger(each), placesFromEventObject));
            triggerIndexes.push(index);
          }
          // "At the start or end of this unit's move": the other end is an alternative moment.
          if (leaf.family_id === "event" && typeof leaf.parameters.also === "string") {
            const { also, ...rest } = leaf.parameters;
            triggers.push(trigger({ ...leaf, parameters: { ...rest, kind: also } }));
            triggerIndexes.push(index);
          }
        }
      } else if (leaf.role !== "EFFECT") throw new CompileError(`Role ${leaf.role} cannot compile.`);
    });
  });

  // "a model in that unit makes an attack": the aura's recipient, else the selected unit, else the
  // unit of the moment the ability fires on, else this unit (a led unit).
  const unitMoment = list.some((leaf, at) => momentNamesUnit(list, at) && !ATTACK_EVENTS.has(String(leaf.parameters.kind)));
  const thatUnit = auraLeaf ? AURA_RECIPIENT : selections.length ? "selected-unit" : unitMoment ? "event-subject" : "this-unit";
  const planned: PlannedEffect[] = [];
  list.forEach((leaf, index) => {
    if (consumedByContainer.has(index)) return;
    if (leaf.role !== "EFFECT") return;
    const { sentence, clause } = places[index]!;
    const node = containerNodes.has(index) ? containerNodes.get(index)! : attempt(() => {
      // The nearest attack before this effect says who attacks and which way; a back-reference
      // ("that attack") is its antecedent, which still carries the attacker's filter.
      const attack = list.slice(0, index).reverse().find((item) => item.family_id === "attack" && !isBackref(item));
      return effect(leaf, {
        attached,
        attacker: attack && attack.parameters.direction === "makes" ? attackerOf(attack, thatUnit) : null,
        // A defender-bound unit-filter before the roll makes the roll the attacker's, unless an
        // attack this unit makes says otherwise.
        incoming: attack?.parameters.direction === "targeted" || (attack?.parameters.direction !== "makes" && defenderBoundBefore(list, index)),
      });
    });
    if (!node) return;
    planned.push({
      index, leaf, node,
      gate: optionalSpends.has(leaf) ? sentenceGates.get(sentence) ?? [] : [...(sentenceGates.get(sentence) ?? []), ...(isBonusNode(node) && endClauses.has(clause) ? [] : clauseGates.get(clause) ?? [])],
      selected: selectedGlobally || selectedSentences.has(sentence) || selectedClauses.has(clause),
      replaces: false,
    });
  });
  // A move-end nearest or a replacing move-must-end is an effect in its own right (it changes the move).
  const movesEnd = list.some((leaf) => leaf.family_id === "move-end-nearest" || (leaf.family_id === "move-must-end" && leaf.parameters.replaces === true));
  if (list.every((leaf) => leaf.role !== "EFFECT") && !movesEnd) errors.push("There is no effect leaf to compile.");
  // Several printed durations: each effect takes its clause's duration, else its sentence's (compile-durations.ts).
  // Bound before the "instead" fold below, which removes an effect and moves its duration to the one it folds into.
  // A per-attack duration inside a phase window folds into the phase when an attack moment ends it (compile-attack-window.ts).
  let fold = attackFold(durations, triggerWindow(list), triggers.some(isAttackMoment));
  if (fold === "refused") errors.push(CONFLICTING_DURATIONS);
  const split = fold === null && new Set(durations).size > 1;
  const firstEffectAt = list.findIndex((leaf) => leaf.role === "EFFECT");
  const leadingAt = [...new Set(triggerIndexes.filter((index) => firstEffectAt === -1 || index < firstEffectAt))];
  const binding = split ? bindDurations(list, places, durationAt, planned.map((item) => item.index), leadingAt) : null;
  if (binding?.error) errors.push(binding.error);
  const boundDuration = new Map<number, string>(binding?.effects ?? []);
  const windows = binding?.windows ?? new Map<number, string>();
  // A set-up moment beside another moment, scoping a set-up effect after it (the Deep Strike shape, 8879 and 994),
  // has no reading: the effect's scope would be one of two moments. A set-up moment that is only a trigger stays as it was.
  if (leadingAt.length >= 2 && leadingAt.some((index) => list[index]!.family_id === "event" && list[index]!.parameters.kind === "set-up"
    && planned.some((item) => item.node.type === "set-up" && item.index > index))) {
    errors.push("A set-up moment next to another moment has no reading yet.");
  }
  // A window (W1) is shared by every leading moment: each one has the same printed duration before it, or none does.
  const windowDurations = [...new Set(leadingAt.map((index) => windows.get(index)))];
  if (windows.size > 0 && (leadingAt.some((index) => !windows.has(index)) || windowDurations.length > 1)) errors.push(CONFLICTING_DURATIONS);
  const window: string | null = windows.size > 0 && windowDurations.length === 1 ? windowDurations[0]! : null;
  // "Can make an ingress move in your next Movement phase": the set-up before it returns then. A set-up
  // earlier in the same sentence wins; failing that, the first set-up after it in its sentence (1339's
  // "Remove your unit from the battlefield" is a different sentence from its battlefield set-up).
  for (const [index, leaf] of list.entries()) {
    if (leaf.family_id !== "reserves-arrival") continue;
    const sentence = places[index]!.sentence;
    const setUps = planned.filter((item) => item.node.type === "set-up");
    const setUp = setUps.filter((item) => item.index < index && places[item.index]!.sentence === sentence).at(-1)
      ?? setUps.find((item) => item.index > index && places[item.index]!.sentence === sentence)
      ?? setUps.filter((item) => item.index < index).at(-1);
    if (!setUp) { errors.push("A reserves arrival has no set-up before it."); continue; }
    const modifier = setUp.node.modifier as Node;
    modifier.arrives = "next-movement-phase";
    if (leaf.parameters.allow_first_round === true) modifier.allow_first_round = true;
  }
  const endNearestEntry = (at: number, node: Node): PlannedEffect => ({
    index: at, leaf: list[at]!, node, gate: [...(sentenceGates.get(places[at]!.sentence) ?? []), ...(clauseGates.get(places[at]!.clause) ?? [])],
    selected: selectedGlobally || selectedSentences.has(places[at]!.sentence) || selectedClauses.has(places[at]!.clause), replaces: false,
  });
  errors.push(...attachMoveEndNearest(list, planned, (at) => places[at]!.sentence, (at) => [...(sentenceGates.get(places[at]!.sentence) ?? []), ...(clauseGates.get(places[at]!.clause) ?? [])], endNearestEntry, sourceText, options.selectedObjective, consumedByContainer));
  errors.push(...bindEngagedPermissions(planned));
  for (const rule of moveEnds) {
    // "Can end that move more than 6\" … (instead of more than 8\")" replaces the usual threshold of the move the trigger names, not one a make-move makes.
    if (rule.replaces && list.some((leaf) => leaf.family_id === "make-move")) { errors.push("A move-must-end that replaces the usual threshold has no DSL form with a make-move in its ability."); continue; }
    const move = planned.filter((item) => item.index < rule.index && item.node.type === "move").at(-1);
    // A bonus move in the same sentence takes a move-end or a feasibility proviso that follows it.
    const bonus = move ? undefined : planned.filter((item) => item.index < rule.index && isBonusNode(item.node) && places[item.index]!.sentence === places[rule.index]!.sentence).at(-1);
    if (bonus && rule.cannot) { errors.push("\"Cannot end that move\" after a move bonus has no DSL form."); continue; }
    if (!move && !bonus && rule.cannot) {
      // "…, and cannot end that move within Engagement Range of them" after the trigger's move: no make-move in the ability.
      const bytes = sourceText === undefined ? null : Buffer.from(sourceText, "utf8");
      const stopBetween = (from: number, to: number) => bytes !== null && /[.;:]/u.test(bytes.subarray(list[from]!.end_byte!, list[to]!.start_byte).toString("utf8"));
      const end = triggerMoveEnd(list, rule, planned.map((item) => ({ index: item.index, node: item.node })), stopBetween, (leaf) => attempt(() => condition(leaf)));
      if ("error" in end) { errors.push(end.error); continue; }
      const { sentence, clause } = places[rule.index]!;
      const at = planned.findIndex((item) => item.index > rule.index);
      const entry = { index: rule.index, leaf: list[rule.index]!, node: end.node, gate: [...(sentenceGates.get(sentence) ?? []), ...(clauseGates.get(clause) ?? [])], selected: selectedGlobally || selectedSentences.has(sentence) || selectedClauses.has(clause), replaces: false };
      if (at === -1) planned.push(entry); else planned.splice(at, 0, entry);
      continue;
    }
    if (!move && !bonus) { errors.push("\"Must end that move\" has no move before it."); continue; }
    if (rule.moveTypes) { errors.push("\"Must end that move\" with move types has no DSL form after a make-move."); continue; }
    if (rule.conditions.length === 0) { errors.push("\"Must end that move\" names no condition for where the move ends."); continue; }
    const nodes = rule.conditions.map((at) => attempt(() => condition(list[at]!))).filter((node): node is Node => node !== null);
    if (nodes.length !== rule.conditions.length) continue;
    const where: Node = nodes.length === 1 ? nodes[0]! : { operator: rule.match === "any" ? "or" : "and", operands: nodes };
    // "Cannot end that move …": the move ends anywhere the named place is not.
    // The bonus's own end condition is its feasibility proviso as well: the bonus is available only if
    // a move can end there, and a move that takes it must end there.
    ((move ?? bonus)!.node.modifier as Node).ends_when = rule.cannot ? { operator: "not", operands: [where] } : where;
  }

  // Where an "Or:" group ends: another combinator, or a moment after the first effect (a later part).
  const leadingEffect = list.findIndex((leaf) => leaf.role === "EFFECT");
  const choiceBoundaries = [...combinators, ...triggerIndexes.filter((index) => leadingEffect !== -1 && index > leadingEffect)];
  for (const combinator of combinators) {
    const clause = places[combinator]!.clause;
    const own = planned.filter((item) => places[item.index]!.clause === clause && !optionalSpends.has(item.leaf));
    // "(instead of more than 8\")" after a move-end that replaces the usual threshold: the move-end leaf consumes
    // the instead, which replaces nothing. Any other effect in the clause is kept as it is; two or more are refused.
    const endsInstead = (leaf: CompileLeaf) => (leaf.family_id === "move-end-nearest" && leaf.parameters.instead_of !== undefined)
      || (leaf.family_id === "move-must-end" && leaf.parameters.replaces === true);
    if (list.some((leaf, at) => endsInstead(leaf) && places[at]!.clause === clause)) {
      const others = own.filter((item) => !endsInstead(item.leaf));
      if (others.length > 1) errors.push(`"Instead" needs exactly one effect besides the move-end in its clause; found ${others.length}.`);
      continue;
    }
    if (own.length !== 1) {
      errors.push(`"Instead" needs exactly one effect in its clause; found ${own.length}.`);
      continue;
    }
    const replacement = own[0]!;
    const replaced = planned.filter((item) => item.index < replacement.index && item.leaf.family_id === replacement.leaf.family_id && !item.replaces).at(-1);
    // "Do not make an Advance roll; instead, add 6\" to its Move": the no-advance-roll fragment
    // already says what happens in its place, so the clause's effect folds into it. Anything
    // else in its place has no DSL fragment.
    const previous = planned.filter((item) => item.index < replacement.index).at(-1);
    if (!replaced && previous && PROHIBITIONS.has(previous.leaf.family_id)) {
      if (isAdvanceInPlace(replacement.node)) {
        // The folded effect's duration is the no-roll's: equal to its own if it has one, else taken from the folded effect.
        const folded = boundDuration.get(replacement.index);
        const kept = boundDuration.get(previous.index);
        // Printed durations on a no-roll gated by an Advance already made would bind the lifetime of a roll that cannot be skipped.
        if ((folded !== undefined || kept !== undefined) && triggerIndexes.length === 0 && testsMadeAdvance([...global, ...previous.gate])) errors.push(NO_ROLL_AFTER_ADVANCE);
        else if (folded !== undefined && kept !== undefined && folded !== kept) errors.push(CONFLICTING_DURATIONS);
        else if (folded !== undefined && kept === undefined) boundDuration.set(previous.index, folded);
        boundDuration.delete(replacement.index);
        planned.splice(planned.indexOf(replacement), 1);
      }
      else errors.push(`"Instead" after ${previous.leaf.family_id} must add 6 to Move; ${replacement.leaf.family_id} has no DSL fragment there.`);
      continue;
    }
    // "X. Or: Y and Z" with no earlier effect of Y's kind: the player picks one group of effects.
    if (!replaced && list[combinator]!.parameters.choice === true) {
      const problem = chooseBetweenGroups(planned, combinator, choiceBoundaries.filter((index) => index !== combinator));
      if (problem) errors.push(problem);
      continue;
    }
    if (!replaced) {
      // "It can move up to 6\" instead of up to 3\"": the default it replaces is another rule's,
      // printed after "instead of", so the clause's effect already says the new value.
      const named = sourceText !== undefined && /^\s*of\b/u.test(Buffer.from(sourceText, "utf8").subarray(list[combinator]!.end_byte).toString("utf8"));
      if (!named) errors.push(`"Instead" has no earlier ${replacement.leaf.family_id} effect to replace.`);
      continue;
    }
    // "Re-roll Hit rolls of 1. Or: if …, re-roll Hit rolls": the player picks one of the two, each
    // under its own conditions.
    if (list[combinator]!.parameters.choice === true) {
      // A bound duration would sit inside the choice's options, which the choice does not carry (no split form yet).
      if (boundDuration.has(replaced.index) || boundDuration.has(replacement.index)) { errors.push(CONFLICTING_DURATIONS); continue; }
      replaced.node = { type: "choice", options: [gated(replaced.gate, replaced.node), gated(replacement.gate, replacement.node)] };
      replaced.gate = [];
      planned.splice(planned.indexOf(replacement), 1);
      continue;
    }
    const alternative = allOf(replacement.gate);
    if (!alternative) {
      errors.push(`"Instead" needs a condition in its clause saying when ${replacement.leaf.family_id} is replaced.`);
      continue;
    }
    replaced.gate = [...replaced.gate, negate(alternative)];
    // A result band that gates the replaced effect ("on a 2+ … instead") covers its replacement too:
    // the replacement joins the same roll (compile-dice.ts), and the band stays out of its condition.
    const band = replaced.gate.filter(isRollMarker);
    if (band.length === 1 && !replacement.gate.some(isRollMarker)) replacement.gate = [...band, ...replacement.gate];
    replacement.replaces = true;
  }

  // An optional spend comes before the effects of its ability, so a clause that reads its designation (an "instead") sees it set.
  if (optionalSpends.size > 0) {
    const spends = planned.filter((item) => optionalSpends.has(item.leaf));
    planned.splice(0, planned.length, ...spends, ...planned.filter((item) => !optionalSpends.has(item.leaf)));
  }

  // "Do not make an Advance roll" followed directly by "add 6\" to Move" (no moment between, no "instead"): the no-roll
  // already moves 6 in place of the roll, so the +6 is that same 6 and folds into it. The fold needs the same unit and
  // gate on both; otherwise the +6 would stack on the no-roll's move (its own move on another unit, or a gated +6).
  for (const previous of planned.filter((item) => PROHIBITIONS.has(item.leaf.family_id))) {
    const next = planned.filter((item) => item.index > previous.index).at(0);
    if (!next || !isAdvanceInPlace(next.node)) continue;
    if (triggerIndexes.some((moment) => moment > previous.index && moment < next.index)) continue;
    if (combinators.some((combinator) => places[combinator]!.clause === places[next.index]!.clause)) continue;
    if (next.node.target !== previous.node.target || next.gate.length > 0 || next.selected !== previous.selected) {
      errors.push(NO_ROLL_PLUS_SIX);
      continue;
    }
    const folded = boundDuration.get(next.index);
    const kept = boundDuration.get(previous.index);
    if (folded !== undefined && kept !== undefined && folded !== kept) errors.push(CONFLICTING_DURATIONS);
    else if (folded !== undefined && kept === undefined) boundDuration.set(previous.index, folded);
    boundDuration.delete(next.index);
    planned.splice(planned.indexOf(next), 1);
  }

  // Moments before the first effect are the ability's own (several are alternatives: "selected
  // to shoot or to fight"). A moment after an effect starts a part of a compound ability: the
  // effects from it to the next such moment fire then, as one bullet of the same ability.
  const firstEffectIndex = list.findIndex((leaf) => leaf.role === "EFFECT");
  const partStarts: Array<{ index: number; moments: number[] }> = [];
  triggerIndexes.forEach((index, position) => {
    if (firstEffectIndex === -1 || index < firstEffectIndex) return;
    const last = partStarts.at(-1);
    // A moment right after another, with no effect between, is an alternative for the same part.
    if (last && !planned.some((item) => item.index > last.index && item.index < index)) last.moments.push(position);
    else partStarts.push({ index, moments: [position] });
  });
  // "The first time this model is destroyed, at the end of the phase": one moment (compile-delayed-destruction.ts).
  const delayed = planDelayedDestruction(list, triggerIndexes, partStarts, sourceText);
  errors.push(...delayed.errors);
  // The attack-window fold applies to a single-part ability; with later parts the durations stay conflicting.
  if (partStarts.length && fold !== null) { if (fold !== "refused") errors.push(CONFLICTING_DURATIONS); fold = null; }
  for (const [position, lowering] of delayed.lowered) triggers[position] = { ...lowering.trigger, condition: lowering.condition };
  if (partStarts.some((part) => !alternativeMoments(part.moments.map((position) => list[triggerIndexes[position]!]!), sourceText))) {
    errors.push("A moment nested in another (\"each time …, at the end of the phase\") has no DSL trigger; a trigger list fires on any one of its moments.");
  }
  if (partStarts.some((part, position) => !planned.some((item) => item.index > part.index && (partStarts[position + 1] === undefined || item.index < partStarts[position + 1]!.index)))) {
    errors.push("A moment ends the ability with no effect after it.");
  }
  // A plain selection ("select one enemy unit … that unit suffers …") binds inside the part that
  // holds it. A selection that limits attacks to that unit (designation) still needs one moment.
  if (partStarts.length && selections.length && planned.some((item) => item.selected)) {
    errors.push("A unit is selected for attacks in an ability with parts; the compiler binds that only for one moment.");
  }
  // "Each model can only be selected for this ability once per turn": on a model selection the cap is
  // the selection's own selection_limit, and the usage is not the ability's (compile-selection-limit.ts).
  let selectionLimit: Node | null = null;
  // A compound ability's first-part selection is dropped by the part assembly below, so a cap on it has no reading.
  const modelSelected = selections.length === 1 && selections[0]!.parameters.target_kind === "model" && !planned.some((item) => item.selected)
    && !list.some((leaf) => leaf.family_id === "persistent-designation-open") && partStarts.length === 0;
  if (modelUsages.length && selections.some((leaf) => leaf.parameters.target_kind === "model")) {
    if (!modelSelected) errors.push("A per-model usage on a model selection may limit each selected model or each bearer; it has no decided reading yet.");
    else if (modelUsages.length > 1) errors.push("More than one per-model usage limit; the selection has one cap.");
    else {
      const { index } = modelUsages[0]!;
      const at = usageIndexes.indexOf(index);
      usages.splice(at, 1);
      usageIndexes.splice(at, 1);
      usageScopes.delete("model");
      selectionLimit = attempt(() => selectionLimitFor(modelUsages[0]!.leaf, list)) as Node | null;
    }
  }
  // "One or more units from your army with this ability": once for the army (compile-holder-abilities.ts).
  applyHolderAllowance(list, triggers, options.abilityId, usages, usageScopes);
  if (usages.length > 1) errors.push("More than one usage limit; the entry has one usage.");
  if (usageScopes.size > 1) errors.push("Conflicting usage scopes.");
  if (usages.length && usageScopes.size === 0) errors.push("Usage frequency needs a reviewed usage scope.");
  if (!usages.length && usageScopes.size) errors.push("Usage scope has no frequency.");
  if (usages.length === 1 && usageScopes.size === 1) {
    const per = usageScopes.values().next().value!;
    if (per !== "any") usages[0]!.per = per;
  }
  const target = attempt(() => groupedTargetRestrictions(list, targetPartIndexes, targetConditions, optionalTargets, sourceText, targetRestrictions));
  const selected = planned.filter((item) => item.selected);
  // A model bound by name, and a unit measured from or visible to it (compile-bound-selection.ts), is the one pair.
  const pair = attempt(() => boundSelectionPair(selections));
  if (selections.length > 1 && pair === null && errors.length === 0) errors.push("More than one unit is selected; the compiler binds only one.");
  if (pair && (selected.length > 0 || list.some((leaf) => leaf.family_id === "attack") || partStarts.length > 0 || forEachLeaf || eligibilityIndexes.length > 0 || battleSizeCount)) {
    errors.push("A bound selection's effects are only the inner unit's; attacks, parts, eligibility, battle-size counts and for-each loops are not bound with it yet.");
  }
  // A selection without "attacks against that unit" is only who "that unit" names (it suffers
  // mortal wounds, say); with it, every effect must be limited to those attacks.
  if (selections.length === 1 && selected.length > 0 && selected.length !== planned.length) errors.push("A unit is selected, but not every effect is limited to attacks against it.");
  if (selections.length === 0 && selected.length > 0) errors.push("An attack targets \"that unit\", but no select-unit leaf says which unit.");
  if (selections.length === 0 && planned.some((item) => namesSelected(item.node))) errors.push("An effect names \"that unit\", but no select-unit leaf says which unit.");
  // "Select one enemy X unit" with the bearer's attacks not aimed at it: the filter would narrow the
  // selection while the attacks stay unrestricted. An attack by the selected unit itself is the
  // selection's own attacks, and a persistent designation's attacks name its mark, so only an attack
  // by another unit with no target that unit leaves it.
  if (selections.length === 1 && selected.length === 0 && selectionHasFilter(selections[0]!)
    && !list.some((leaf) => leaf.family_id === "persistent-designation-open")
    && list.some((leaf) => leaf.family_id === "attack" && leaf.parameters.direction === "makes" && leaf.parameters.unit !== "that-unit")) {
    errors.push("A selected unit's unit-filter narrows only the selection; the bearer's attacks must target that unit, or the filter has no effect on them.");
  }
  // "Each time that VEHICLE model makes an attack": an attack gate on a model selection has no decided
  // binding; compiled as-is the gate is dropped (the same drop a unit selection shows, pre-existing).
  // A designated model's attacks ("that targets that model") keep their own refusal, below.
  if (selections.some((leaf) => leaf.parameters.target_kind === "model") && !list.some((leaf) => leaf.family_id === "target-is-selected")
    && list.some((leaf) => leaf.family_id === "attack" && leaf.parameters.direction === "makes")) {
    errors.push("An attack made by a selected model has no decided binding yet; compiling it would drop the attack gate.");
  }
  // "Select one other X model": the selector excludes only the bearer's unit, which is the selected model's only when it has one model.
  if (selections.some((leaf) => leaf.parameters.target_kind === "model" && (leaf.parameters.filter as { other?: unknown } | undefined)?.other === true)
    && bearerModelMax(options.abilityId) !== 1) {
    errors.push("An other-model selection excludes only the bearer's unit; it selects only other models when the bearer has one model.");
  }
  if (forEachLeaf && selections.length > 0) errors.push("A unit is selected and the ability also loops with for-each-unit-select; the compiler binds only one of them.");
  // Several durations: the parts that take the durations' own wrapping, with the features that read one duration are refused.
  if (split) {
    const selectsAttacks = selections.length === 1 && planned.some((item) => item.selected);
    if (rolls.length || auraLeaf || forEachLeaf || leaderLeaf || rulesBundle || optionalSpend || selectsAttacks) errors.push(CONFLICTING_DURATIONS);
    if (usages.length) errors.push("A usage limit in an ability with several durations has no reading yet.");
    if (window !== null && partStarts.length) errors.push("A moment with a window in a compound ability has no reading yet.");
    const testAfterMark = refuseTestAfterMark(planned.map((item) => ({ index: item.index, node: item.node, gate: item.gate })), (index) => partStarts.filter((part) => part.index < index).length);
    if (testAfterMark) errors.push(testAfterMark);
  }
  // forEachLeaf keeps only the last quantifier, so a second pass would replace the first one's selector.
  if (list.filter((leaf) => leaf.family_id === "for-each-unit-select").length > 1) errors.push("A record with two for-each-unit-select passes is not lowered yet; the compiler binds only one pass's units, so it refuses the record.");
  // "One enemy unit hit by those attacks" on a Stratagem target: only a select-unit's eligibility takes the hit, so it would be dropped.
  // When the window is itself an attack moment ("just after an enemy unit has shot"), the reactive trigger already is "those attacks".
  const attackMoment = list.some((leaf) => leaf.family_id === "event" && ["enemy-has-shot", "attacks-resolved", "after-shooting"].includes(String(leaf.parameters.kind)));
  if (!attackMoment && list.some((leaf) => leaf.family_id === "stratagem-target") && list.some((leaf) => leaf.family_id === "hit-by-attacks" && leaf.fragment === "TARGET")) errors.push("A hit-by-attacks qualifier on a Stratagem target has no DSL shape yet; it would be dropped.");
  if (errors.length > 0) return { ok: false, signature, errors };

  const partOf = (index: number) => partStarts.filter((part) => part.index < index).length;
  // Each effect's own duration wraps its node before the parts are built. Under a window, an effect that
  // lasts as long as the window is left bare (the window part carries it); a shorter one nests, a longer one is a sibling.
  const windowInside = new Map<number, boolean>();
  if (split) {
    for (const item of planned) {
      const bound = boundDuration.get(item.index);
      if (window === null) { if (bound !== undefined) item.node = durationPart(bound, item.node); continue; }
      const place = attempt(() => placeInWindow(bound, window));
      if (place === null) return { ok: false, signature, errors };
      windowInside.set(item.index, place !== "outside");
      if (place !== "same") item.node = durationPart(bound!, item.node);
    }
  }
  const pieces = [0, ...partStarts.map((_, position) => position + 1)].map((part) => attempt(() => resolveRolls(
    planned.filter((item) => partOf(item.index) === part),
    part === 0 ? global : [],
    // A conditional change's condition is compiled here, where its roll is resolved (compile-dice.ts).
    rolls.filter((leaf) => partOf(list.indexOf(leaf)) === part).map((leaf) => {
      const bonus = leaf.parameters.conditional_bonus as { value: number; leaf: CompileLeaf } | undefined;
      if (bonus === undefined) return leaf;
      return { ...leaf, parameters: { ...leaf.parameters, conditional_bonus: { value: bonus.value, node: condition(bonus.leaf) } } };
    }),
  )));
  if (pieces.some((piece) => !piece)) return { ok: false, signature, errors };
  // In a compound ability, a selection wraps only its own part's effects.
  const selectionPart = partStarts.length && selections.length === 1 ? partOf(list.indexOf(selections[0]!)) : null;
  if (selectionPart !== null && selectionPart > 0) {
    const own = pieces[selectionPart]!;
    pieces[selectionPart] = [selectUnit(selections[0]!, own.length === 1 ? own[0]! : { type: "sequence", steps: own }, { selectionLimit })];
  }
  let steps = pieces[0]!;
  // Under a window, the effects that last within it sit in one window part, which takes the moment as its trigger below.
  let windowHead: Node | null = null;
  if (window !== null) {
    const inside = planned.filter((item) => partOf(item.index) === 0).map((item) => windowInside.get(item.index) === true);
    if (inside.length !== steps.length) { errors.push("A window's effects have no decided order yet."); return { ok: false, signature, errors }; }
    const within = steps.filter((_, at) => inside[at]);
    if (within.length === 0) { errors.push("A moment with a window has no effect inside the window."); return { ok: false, signature, errors }; }
    const head: Node = { type: "ability-part", duration: window, effect: within.length === 1 ? within[0]! : { type: "sequence", steps: within } };
    windowHead = head;
    const merged: Node[] = [];
    steps.forEach((step, at) => {
      if (!inside[at]) merged.push(step);
      else if (!merged.includes(head)) merged.push(head);
    });
    steps = merged;
  }
  let body: Node | null = steps.length === 1 ? steps[0]! : { type: "sequence", steps };
  const scopeDuration = split ? "permanent" : (durations[0] ?? "permanent");
  // "If an enemy unit within 8\" of this unit is below Starting Strength": a gate on each unit an
  // aura or a for-each reaches holds per recipient, inside the wrap, not once around it.
  if (auraLeaf || forEachLeaf) {
    const perUnit = global.filter((node) => JSON.stringify(node).includes(`"${AURA_RECIPIENT}"`));
    if (perUnit.length) {
      global.splice(0, global.length, ...global.filter((node) => !perUnit.includes(node)));
      body = gated(perUnit, body!);
    }
  }
  const eligibility = eligibilityIndexes.length ? attempt(() => allOf(eligibilityIndexes.map((at) => condition(list[at]!)))) : null;
  if (selections.length === 1 && selected.length > 0) {
    // "Ranged attacks that target that unit": an attack-type gate says which attacks against the
    // designated unit are changed, so it narrows the designation's effect, not the selection. The
    // attacker gate ("that disembarked from this TRANSPORT") narrows it the same way.
    const attackGates = global.filter((node) => node.type === "attack-is" || isAttackerGate(node));
    if (attackGates.length) global.splice(0, global.length, ...global.filter((node) => !attackGates.includes(node)));
    body = attempt(() => designation(selections[0]!, list, gated(attackGates, body!), durations[0], eligibility));
  }
  // "Select one enemy unit to be this model's prey": a persistent designation makes that selection itself.
  // A designation's own select, possibly wrapped optional, is the body's, not a select around it.
  else if (selections.length === 1 && (body?.type === "persistent-designation" || (body?.type === "ability-part" && (body.effect as Node | undefined)?.type === "persistent-designation"))) { /* its own select */ }
  else if (pair && body) body = selectUnit(pair.outer, selectUnit(pair.inner, body, {}), {});
  else if (selections.length === 1 && (selectionPart === null || selectionPart === 0)) {
    body = selectUnit(selections[0]!, body, {
      ...(battleSizeCount ? { maxCount: { incursion: battleSizeCount.parameters.incursion, "strike-force": battleSizeCount.parameters["strike-force"], onslaught: battleSizeCount.parameters.onslaught } } : {}),
      eligibility,
      selectionLimit,
    });
  }
  else if (forEachLeaf) { const each = forEachLeaf; body = attempt(() => wrapForEachUnit(each, body!)); }
  if (!body) return { ok: false, signature, errors };
  if (auraLeaf) { const aura: CompileLeaf = auraLeaf; body = attempt(() => aura.parameters.model_recipient !== undefined ? wrapModelAura(aura, body!, triggers) : wrapAura(aura, body!)); }
  if (leaderLeaf) { const leader = leaderLeaf; body = attempt(() => wrapLeaderTarget(leader, body!)); }
  if (!body) return { ok: false, signature, errors };
  // A refusal here returns at once: the errors list was already checked above, so a later attempt() error would be dropped.
  if (optionalSpend) {
    const wrapped = attempt(() => wrapOptionalSpends(body!, list, durations) as typeof body);
    if (wrapped === null) return { ok: false, signature, errors };
    body = wrapped;
  }
  if (rulesBundle) body = wrapRulesBundle(body);
  const stratagem = list.some((leaf) => STRATAGEM_FAMILIES.has(leaf.family_id));
  const behavior = auraLeaf ? "aura" : triggers.length ? "reactive" : optional || stratagem ? "activated" : "passive";
  // A used or triggered ability with no printed duration lasts for its window's period. A passive
  // ability gated on a phase already holds only in that phase, and an aura only while in range.
  const period = durations.length === 0 && (behavior === "reactive" || behavior === "activated") && hasLastingEffect(body) ? windowPeriod(list) : null;
  // "That X unit": the WHEN moment's unit must have the keywords the target names.
  const bound = targetParts.find((leaf) => leaf.family_id === "triggering-target");
  const moments = triggers.map((node) => {
    const moment: Node = optional ? { ...node, optional: true } : { ...node };
    // The keywords narrow whoever acted: a filter subject gains all_of; this unit gets a keyword condition.
    if (bound && bound.parameters.match === "all" && (bound.parameters.keywords as string[]).length) {
      const keywords = bound.parameters.keywords as string[];
      const withKeywords = (unit: Node) => ({ ...unit, all_of: [...new Set([...((unit.all_of as string[] | undefined) ?? []), ...keywords])] });
      // When an enemy acts ("when an enemy unit targets a friendly X unit", "ends a move within 8\"
      // of a friendly X unit") the Stratagem's unit is never that enemy: it is the moment's
      // object, or else this unit, which the keywords gate.
      const enemyActs = moment.subject !== null && typeof moment.subject === "object" && (moment.subject as Node).owner === "enemy";
      // "When a friendly X unit is destroyed" + "that X unit": the destroyed unit, the moment's object.
      if (destroyedFilterObject(moment)) moment.object = withKeywords(moment.object as Node);
      else if (enemyActs) {
        if (moment.object !== null && typeof moment.object === "object" && (moment.object as Node).owner !== "enemy") moment.object = withKeywords(moment.object as Node);
        else {
          const gate: Node = { type: "has-keyword", parameters: { all_of: keywords } };
          const own = moment.condition as Node | undefined;
          moment.condition = own ? { operator: "and", operands: [own, gate] } : gate;
        }
      } else if (moment.subject !== null && typeof moment.subject === "object") moment.subject = withKeywords(moment.subject as Node);
      else {
        const gate: Node = { type: "has-keyword", parameters: { ...(moment.subject ? { subject: moment.subject } : {}), all_of: keywords } };
        const own = moment.condition as Node | undefined;
        moment.condition = own ? { operator: "and", operands: [own, gate] } : gate;
      }
    }
    return moment;
  });
  const asTrigger = (nodes: Node[]) => nodes.length === 0 ? null : nodes.length === 1 ? nodes[0]! : nodes;
  const leading = moments.filter((_, position) => !delayed.dropped.has(position) && !partStarts.some((part) => part.moments.includes(position)));
  let entryTrigger = asTrigger(leading);
  let foldedPhase = false;
  if (fold !== null && fold !== "refused") {
    // The attack moments end at the attack sequence; the other moments and the phase stay on the entry.
    // A delayed or dropped attack moment leaves nothing to end the effect, so the entry is refused.
    const attacks = leading.filter(isAttackMoment);
    if (attacks.length === 0) return { ok: false, signature, errors: ["Conflicting durations."] };
    body = { type: "ability-part", trigger: asTrigger(attacks), effect: body, duration: "attack-sequence" };
    entryTrigger = asTrigger(leading.filter((moment) => !isAttackMoment(moment)));
    foldedPhase = true;
  }
  // The window part is the moments' lifetime: its trigger is the leading moments, and the ability has no top-level trigger.
  if (windowHead) { windowHead.trigger = entryTrigger; entryTrigger = null; }
  if (partStarts.length) {
    // The first part fires on the ability's leading moment, if it has one; each later part on its own.
    const first = pieces[0]!;
    const partSteps: Node[] = entryTrigger ? [{ type: "ability-part", trigger: entryTrigger, effect: body }] : first;
    // "The first time the bearer's unit destroys an enemy unit": a usage limit right before a later
    // part's moment, after an earlier effect, limits only that part.
    const usageAt = usageIndexes.length === 1 && firstEffectIndex !== -1 && usageIndexes[0]! > firstEffectIndex ? usageIndexes[0]! : -1;
    const usagePart = usageAt === -1 ? -1 : partStarts.findIndex((part) => part.index > usageAt && !planned.some((item) => item.index > usageAt && item.index < part.index));
    partStarts.forEach((part, position) => {
      const own = pieces[position + 1]!;
      partSteps.push({
        type: "ability-part", trigger: asTrigger(part.moments.map((index) => moments[index]!)), effect: own.length === 1 ? own[0]! : { type: "sequence", steps: own },
        ...(position === usagePart ? { usage: usages[0] } : {}),
      });
    });
    if (usagePart !== -1) usages.splice(0);
    body = { type: "sequence", steps: partSteps };
    entryTrigger = null;
  }
  let resolved: ReturnType<typeof resolveEntry>;
  try {
    resolved = resolveEntry(gated(global, foldConditionalTestModifiers(body)), entryTrigger, target, severalTargets(list));
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature, errors: [error.message] };
  }
  return {
    ok: true,
    signature,
    ...(resolved.core ? { core: resolved.core } : {}),
    mechanics: {
      effect: resolved.effect,
      scope: { duration: foldedPhase ? "phase" : period ?? scopeDuration },
      // A choice with an event is an optional trigger; a choice without one is activated, as is a
      // stratagem (it has a phase window or a TARGET), which a player always chooses to use. An
      // aura-range leaf always reads as an aura, ahead of any of those.
      behavior,
      trigger: resolved.trigger as typeof entryTrigger,
      ...(usages.length ? { usage: usages[0] } : {}),
    },
    checks: [...checks, ...armyCoreChecks(list)],
  };
}

/** Whether an effect (or one nested in it) applies to the selected unit. */
function namesSelected(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(namesSelected);
  if (node === null || typeof node !== "object") return false;
  const record = node as Node;
  // A selection already compiled into a node (an option's own select-units) binds its own selected unit.
  if (record.type === "select-units") return false;
  return record.target === "selected-unit" || Object.values(record).some(namesSelected);
}

