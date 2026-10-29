import type { CompileOptions } from "./compile.js";
import { targetRestrictions } from "./compile-conditions.js";
import { CONFLICTING_DURATIONS, refuseTestAfterMark } from "./compile-durations.js";
import { selectionHasFilter } from "./compile-wrappers.js";
import { selectionLimitFor } from "./compile-selection-limit.js";
import { boundSelectionPair, independentPairRefusal, independentSelectionPair } from "./compile-bound-selection.js";
import { bearerModelMax } from "./compile-bearer-size.js";
import { applyHolderAllowance } from "./compile-holder-abilities.js";
import { destroyedFilterObject } from "./compile-model-level.js";
import { alternativeMoments } from "./compile-segments.js";
import { planDelayedDestruction } from "./compile-delayed-destruction.js";
import { momentsAfterDestruction } from "./compile-nested-moment.js";
import { bindNearFriendlyTarget } from "./compile-near-friendly-target.js";
import { groupedTargetRestrictions } from "./compile-target-groups.js";
import type { PartFrame } from "./compile-part-classify.js";
import type { PlannedEffect, planEffects } from "./compile-part-plan.js";

type Node = Record<string, unknown>;

/** The parts a planned part splits into, and what its usages, selections and Stratagem targets bind to (compile-part-assemble.ts reads it). */
export type PartBindings = ReturnType<typeof bindParts>;

/**
 * Finds where a part's later moments start parts of a compound ability, moves per-model and
 * per-selected-unit usage limits onto their selection, groups the Stratagem targets, and checks
 * that the selections, counts and durations have one reading. Refusals collect in the frame's `errors`.
 */
export function bindParts(frame: PartFrame, plan: ReturnType<typeof planEffects>, sourceText: string | undefined, options: CompileOptions) {
  const {
    list, errors, attempt, triggers, triggerIndexes, durations, selections, modelUsages, usageIndexes, usages, usageScopes, selectedUnitUsages,
    targetParts, targetPartIndexes, targetConditions, optionalTargets, optionalSpends, forEachLeaf, battleSizeCount, roundCount, pairCandidates,
    pairGatesBound, rolls, auraLeaf, leaderLeaf, rulesBundle, optionalSpend,
  } = frame;
  const { planned, split } = plan;
  let { fold } = plan;
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
  // "Then, at the end of the phase" after a destruction nests under it instead (momentsAfterDestruction below).
  const afterDestruction = momentsAfterDestruction(list, triggerIndexes, partStarts, firstEffectIndex, sourceText, durations.length);
  const delayed = afterDestruction.size > 0 ? { errors: [], lowered: new Map(), dropped: new Set<number>(), nested: new Set<number>() } : planDelayedDestruction(list, triggerIndexes, partStarts, sourceText);
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
  // "Once per turn" counted per selected unit (8553): the cap is the one unit selection's selection_limit,
  // counted across every bearer, so the usage is not the ability's. Other shapes have no reading and refuse.
  if (selectedUnitUsages.length) {
    if (selectedUnitUsages.length > 1) errors.push("More than one per-selected-unit usage limit; the selection has one cap.");
    else if (selections.length !== 1) errors.push("A per-selected-unit usage needs exactly one unit selection.");
    else if (selections[0]!.parameters.target_kind === "model") errors.push("A per-selected-unit usage on a model selection has no reading.");
    else if (partStarts.length > 0 || list.some((leaf) => leaf.family_id === "persistent-designation-open")) {
      errors.push("A per-selected-unit usage with parts or a persistent designation has no reading yet.");
    } else {
      const { index } = selectedUnitUsages[0]!;
      const at = usageIndexes.indexOf(index);
      usages.splice(at, 1);
      usageIndexes.splice(at, 1);
      usageScopes.delete("selected-unit");
      selectionLimit = attempt(() => selectionLimitFor(selectedUnitUsages[0]!.leaf, list)) as Node | null;
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
  const grouped = attempt(() => groupedTargetRestrictions(list, targetPartIndexes, targetConditions, optionalTargets, sourceText, targetRestrictions));
  // "That K unit" naming the friendly K unit of the WHEN's distance clause (compile-near-friendly-target.ts).
  const target = grouped === null ? null : bindNearFriendlyTarget(list, grouped);
  const nearTarget = target !== grouped;
  // An enemy-acting moment with no friendly object gives "That K unit" only the enemy mover to bind to, which K keywords never match.
  const keyworded = targetParts.some((leaf) => leaf.family_id === "triggering-target" && leaf.parameters.match === "all" && (leaf.parameters.keywords as string[]).length > 0);
  if (keyworded && !nearTarget && target !== null && !Array.isArray(target) && target.bound_to === "triggering-unit"
    && triggers.some((moment) => moment.subject !== null && typeof moment.subject === "object" && (moment.subject as Node).owner === "enemy"
      && !destroyedFilterObject(moment) && !(moment.object !== null && typeof moment.object === "object" && (moment.object as Node).owner !== "enemy"))) {
    errors.push("A Stratagem target \"That K unit\" after an enemy-acting moment names no friendly K unit in the moment.");
  }
  const selected = planned.filter((item) => item.selected);
  // A model bound by name, and a unit measured from or visible to it (compile-bound-selection.ts), is the one pair.
  const pair = attempt(() => boundSelectionPair(selections));
  // A friendly unit and an enemy unit selected apart, neither measured from the other (compile-bound-selection.ts).
  const independent = pair === null && errors.length === 0 ? attempt(() => independentSelectionPair(selections)) : null;
  if (selections.length > 1 && pair === null && independent === null && errors.length === 0) errors.push("More than one unit is selected; the compiler binds only one.");
  if (independent) {
    const refusal = independentPairRefusal(list, { parts: partStarts.length > 0, forEach: forEachLeaf !== null, count: Boolean(battleSizeCount || roundCount) });
    if (refusal) errors.push(refusal);
  }
  // A select measured from the other selection with no distance of its own takes that measure from a candidate leaf; with none it would be unbounded.
  if (pair && typeof pair.inner.parameters.within_of === "string" && pair.inner.parameters.distance !== "within" && pairCandidates.length === 0) {
    errors.push("A selection measured from another selection with no distance needs a unit-position or eligible leaf naming that selection.");
  }
  if (pair && (selected.length > 0 || list.some((leaf) => leaf.family_id === "attack") || partStarts.length > 0 || forEachLeaf || !pairGatesBound || battleSizeCount || roundCount)) {
    errors.push("A bound selection's effects are only the inner unit's; attacks, parts, eligibility, battle-size counts and for-each loops are not bound with it yet.");
  }
  // A count (by battle size or by battle round) caps the one plain selection's max_count. A designation, a compound part,
  // a persistent designation and a for-each loop never read it, so the cap would be lost and the selection would take one unit.
  if (battleSizeCount && roundCount) errors.push("A selection takes one count, by battle size or by battle round, not both.");
  const lostCount = battleSizeCount ?? roundCount;
  const countName = roundCount && !battleSizeCount ? "round" : "size";
  if (roundCount && selections.length === 0) errors.push("A count by battle round needs the unit selection it limits.");
  if (lostCount && selections.length > 0 && !pair
    && (selected.length > 0 || partStarts.length > 0 || forEachLeaf || list.some((leaf) => leaf.family_id === "persistent-designation-open"))) {
    errors.push(`A count by battle ${countName} is carried only by a plain single selection.`);
  }
  // A selection without "attacks against that unit" is only who "that unit" names (it suffers
  // mortal wounds, say); with it, every effect must be limited to those attacks.
  // An optional spend before a designated selection is lifted out of its body (see designatedSpends below); one after it is not.
  const unlimitedItem = (item: PlannedEffect) => !optionalSpends.has(item.leaf);
  const designatedSpends = selections.length === 1 && selected.length > 0 ? planned.filter((item) => optionalSpends.has(item.leaf) && item.leaf.start_byte < selections[0]!.start_byte) : [];
  if (selections.length === 1 && selected.length > 0 && (selected.filter(unlimitedItem).length !== planned.filter(unlimitedItem).length
    || planned.some((item) => optionalSpends.has(item.leaf) && !designatedSpends.includes(item)))) errors.push("A unit is selected, but not every effect is limited to attacks against it.");
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
  // "that VEHICLE model makes an attack" (unit that-unit) is the selected model's own attack: it lowers with
  // the selection's unit as attacker (attackerOf), so only other attackers on a model selection refuse here.
  if (selections.some((leaf) => leaf.parameters.target_kind === "model") && !list.some((leaf) => leaf.family_id === "target-is-selected")
    && list.some((leaf) => leaf.family_id === "attack" && leaf.parameters.direction === "makes" && leaf.parameters.unit !== "that-unit")) {
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
    const testAfterMark = refuseTestAfterMark(planned.map((item) => ({ index: item.index, node: item.node, gate: item.gate })), (index) => partStarts.filter((part) => part.index < index).length);
    if (testAfterMark) errors.push(testAfterMark);
  }
  // forEachLeaf keeps only the last quantifier, so a second pass would replace the first one's selector.
  if (list.filter((leaf) => leaf.family_id === "for-each-unit-select").length > 1) errors.push("A record with two for-each-unit-select passes is not lowered yet; the compiler binds only one pass's units, so it refuses the record.");
  // "One enemy unit hit by those attacks" on a Stratagem target: only a select-unit's eligibility takes the hit, so it would be dropped.
  // When the window is itself an attack moment ("just after an enemy unit has shot"), the reactive trigger already is "those attacks".
  const attackMoment = list.some((leaf) => leaf.family_id === "event" && ["enemy-has-shot", "attacks-resolved", "after-shooting"].includes(String(leaf.parameters.kind)));
  if (!attackMoment && list.some((leaf) => leaf.family_id === "stratagem-target") && list.some((leaf) => leaf.family_id === "hit-by-attacks" && leaf.fragment === "TARGET")) errors.push("A hit-by-attacks qualifier on a Stratagem target has no DSL shape yet; it would be dropped.");
  return { firstEffectIndex, partStarts, afterDestruction, delayed, fold, selectionLimit, target, nearTarget, selected, pair, independent, designatedSpends };
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
