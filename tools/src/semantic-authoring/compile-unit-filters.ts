import { attackOfFilter, AURA_RECIPIENT, FILTERED_UNITS, momentOfFilter, objectEvent, targetedAttackOfFilter } from "./compile-antecedent.js";
import { EXCLUDED_FROM_ATTACKS, FILTER_SUBJECT_TARGET } from "./families/unit-filters.js";
import { destinationOf } from "./compile-move-end-nearest.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { destroyedFilter, destroyedModelAfter, destroyedObject, membershipOf, modelRecipientFilter, modelSelection, rollOwnerEvent } from "./compile-model-level.js";
import { embarkedStateBefore, foldEmbarkedExclusion } from "./compile-embarked-exclusion.js";
import { foldSelectExclusions } from "./compile-select-exclusions.js";
import { foldTriggeringDestruction, isTriggeringDestruction } from "./compile-triggering-destruction.js";
import { attackFrameRolls, defenderCompareAfter, foldAttackFrame, subjectlessRoll, targetFrameBefore } from "./compile-attack-frame.js";
import { measuresTargetedFilter, targetedWithin } from "./compile-targeted-within.js";
import { destroyingAttackBefore, destroyedByFilterAfter, destroyerSideOf, foldDestroyedByFilter, foldDestroyingAttack } from "./compile-destroying-attack.js";
import { destroyerFilterAfter, foldDestroyerFilter } from "./compile-destruction-participants.js";
import { dslUnitFilter, filterOf } from "./compile-unit-filter-dsl.js";
import { joinerBetween, mergedFilter, mergeStackedFilters } from "./compile-unit-filter-merge.js";
import {
  armyGroup, attackerAfter, bareForEach, engagedWithOwnUnit, filterDesignation, filteredAfter, followedBy, followsTargetingAttack, inheritedPostfixFilter, isFilter, madeBy,
  nearOther, nestedEngagedChain, openAura, openSelect, openTarget, orAlternative, ownedBy, ownerlessEvent, pastOwners, postfixRecipient, renamedAttackTarget, restatesObjectOwner, selectionBefore, selectOf, side,
} from "./compile-unit-filter-predicates.js";

/**
 * A unit-filter leaf ("friendly **WRAITH CONSTRUCT** unit") folded into the selection or aura it
 * names, before anything else compiles. It belongs to a scope-less select-unit right before it
 * ("select one" + filter) or a side-less aura-range right after it (filter + "within 6\" of this
 * unit"). The folded leaf carries the filter's side as its scope/side and the filter's keywords
 * as `filter`, which selectUnit and wrapAura read. A side-less range right after a selection is
 * that selection's distance; only one after a unit-filter alone is an aura.
 */

/**
 * A range right after a selection ("select one visible enemy unit within 6\" of this unit") is
 * the selection's distance, not an aura: fold it into the selection just pushed. Returns whether
 * it did.
 */
function reach(out: CompileLeaf[], range: CompileLeaf | undefined): boolean {
  if (!openAura(range)) return false;
  const selection = out.at(-1)!;
  if (selection.parameters.distance === "within") throw new CompileError("A selection already within a distance cannot take a second range.");
  out[out.length - 1] = { ...selection, parameters: { ...selection.parameters, distance: "within", inches: range!.parameters.inches,
    ...(range!.parameters.of === undefined ? {} : { within_origin: range!.parameters.of }),
    ...(range!.parameters.wholly === true ? { wholly: true } : {}),
  } };
  return true;
}

/**
 * A unit-filter with subject target ("while targeting an enemy unit") becomes the defender's
 * condition before any other fold sees it, so no neighbouring leaf (a Stratagem target, a select)
 * can take it and drop its subject.
 */
function targetNamingFilter(leaf: CompileLeaf): CompileLeaf {
  if (!isFilter(leaf) || leaf.parameters.subject !== FILTER_SUBJECT_TARGET) return leaf;
  if (leaf.fragment === "TARGET") throw new CompileError("A unit-filter with subject target needs an effect that names an attack's target.");
  if (leaf.parameters.side === "any") throw new CompileError("A unit-filter naming an attack's target must say friendly or enemy.");
  const { subject: _subject, ...rest } = leaf.parameters;
  // binds_defender: the rolls after it in this fragment are the attacker's (compile.ts reads it).
  return { ...leaf, family_id: "unit-filter-target", parameters: { ...rest, owner_explicit: true, binds_defender: true } };
}

/**
 * The model-level unit-filter after a model-destroyed event as the event's object: its side is the
 * destroyed model's owner, its keywords the model's unit keywords. A filter with any other
 * wording, or an event that already names an object, has no shape here.
 */
function foldDestroyedModelAfter(event: CompileLeaf, filter: CompileLeaf): CompileLeaf {
  const named = event.parameters;
  if (named.object_owner !== undefined || named.object_keywords !== undefined || named.object_filter !== undefined || named.subject_filter !== undefined) {
    throw new CompileError("A destroyed model named after its event needs an event that names no object of its own.");
  }
  const side = filter.parameters.side;
  if (side !== "friendly" && side !== "enemy") throw new CompileError("A destroyed model named after its event must say friendly or enemy.");
  const keywords = filter.parameters.keywords;
  if (!Array.isArray(keywords) || keywords.length === 0) throw new CompileError("A destroyed model named after its event needs unit keywords.");
  return { ...event, parameters: { ...named, object_owner: side, object_keywords: keywords } };
}

export function foldUnitFilters(input0: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (!input0.some((leaf) => isFilter(leaf) || openSelect(leaf) || openAura(leaf) || openTarget(leaf) || isTriggeringDestruction(leaf) || leaf.family_id === "for-each-unit-select" || leaf.family_id === "move-end-nearest")) return [...input0];
  // "if those attacks destroyed an enemy unit" pairs its destroyed unit before the merges below (compile-triggering-destruction.ts).
  // A filter naming the attack's target is the defender's condition, not a filter a neighbouring leaf can take.
  const input = foldTriggeringDestruction(input0.map(targetNamingFilter));
  const list = foldSelectExclusions(mergeStackedFilters(input, sourceText), mergedFilter);
  if (list.some((leaf, at) => isFilter(leaf) && leaf.parameters.datasheets !== undefined && !armyGroup(list, at))) {
    throw new CompileError("A datasheet list has no DSL unit-filter shape outside army construction.");
  }
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const leaf = list[index]!;
    const next = list[index + 1];
    if (isFilter(leaf) && leaf.parameters.excluded_from === EXCLUDED_FROM_ATTACKS) {
      // "This unit's ranged attacks (excluding Character models' attacks)": the attack frame before it
      // takes the filter's models as the attackers it leaves out, so the filter names no target.
      const frame = out.at(-1);
      if (frame?.family_id !== "attack" || frame.parameters.attacker_filter !== undefined) throw new CompileError("An attack exclusion needs an attack frame right before it with no attacker of its own.");
      if (leaf.parameters.side === "any") throw new CompileError("A unit-filter whose units receive an effect must say friendly or enemy.");
      out[out.length - 1] = { ...frame, parameters: { ...frame.parameters, attacker_filter: attackerFilter(leaf, frame) } };
      continue;
    }
    if (isFilter(leaf) && embarkedStateBefore(out.at(-1), leaf)) {
      // "TORMENTORS units embarked within it" + "(excluding Battle-shocked units)": the exclusion narrows the embarked units.
      out[out.length - 1] = foldEmbarkedExclusion(out.at(-1)!, leaf, dslUnitFilter(leaf));
      continue;
    }
    if (isFilter(leaf) && out.at(-1)?.family_id === "issue-orders-open" && out.at(-1)!.fragment === leaf.fragment) {
      // "This OFFICER can issue up to 2 Orders to" + "REGIMENT or SQUADRON units" (or one filter per
      // bullet): the units an Order can be issued to.
      out[out.length - 1] = foldOrderRecipients(out.at(-1)!, leaf);
      index = pastOwners(list, index, leaf) - 1;
      continue;
    }
    if (leaf.family_id === "move-end-nearest" && destinationOf(leaf) === "following-filter") {
      // A move-end nearest the closest unit names that unit with the unit-filter right after it: the
      // filter after it names the unit the move ends nearest. The leaf takes the filter as `of`.
      if (!isFilter(next) || next!.fragment !== leaf.fragment) throw new CompileError("A move-end nearest the closest unit needs a unit-filter right after it.");
      if (next!.parameters.side === "any") throw new CompileError("A move-end nearest the closest unit must say friendly or enemy.");
      out.push({ ...leaf, parameters: { ...leaf.parameters, of: dslUnitFilter(next!) } });
      index += 1;
    } else if (leaf.family_id === "move-end-nearest") {
      // An objective destination names no unit: it takes no filter, and a filter after it is left for its own rule.
      out.push(leaf);
    } else if (leaf.family_id === "for-each-unit-select" && !bareForEach(leaf) && leaf.parameters.filter === undefined && isFilter(next) && next!.fragment === leaf.fragment
      && (leaf.parameters.scope === undefined || leaf.parameters.scope === next!.parameters.side)) {
      // "For each enemy unit" + "ALPHA unit within 6\" of this model": the filter after a quantifier that already
      // names its side narrows the units each pass takes, and a range after the filter folds in as for a bare quantifier.
      // The quantifier keeps its printed distance; only the side and the filter come from the unit-filter.
      if (next!.parameters.side === "any") throw new CompileError("A unit-filter whose units each pass takes must say friendly or enemy.");
      out.push({ ...leaf, parameters: { ...leaf.parameters, scope: side(next!, "a for-each", { anySide: true }), filter: filterOf(next!) } });
      index += 1;
      if (reach(out, list[index + 1])) index += 1;
    } else if (bareForEach(leaf) && isFilter(next) && next!.fragment === leaf.fragment) {
      // "for each" + "enemy unit" (+ "within 6\" of this model" | "engaged with your unit"): the
      // units each pass takes, folded into the quantifier as select-unit's filter is.
      out.push({ ...leaf, parameters: { ...leaf.parameters, scope: side(next!, "a for-each", { anySide: true }), distance: "any", filter: filterOf(next!) } });
      index += 1;
      if (reach(out, list[index + 1])) index += 1;
      else if (nearOther(list[index + 1], leaf)) {
        out[out.length - 1] = { ...out.at(-1)!, parameters: { ...out.at(-1)!.parameters, near: nearOther(list[index + 1], leaf) } };
        index += 1;
      }
      else if (engagedWithOwnUnit(list[index + 1], leaf)) {
        out[out.length - 1] = { ...out.at(-1)!, parameters: { ...out.at(-1)!.parameters, engaged_with: list[index + 1]!.parameters.with } };
        index += 1;
      }
    } else if (leaf.family_id === "for-each-unit-select" && !bareForEach(leaf) && engagedWithOwnUnit(next, leaf)) {
      // "Each enemy unit" + "within Engagement Range of your unit": the units each pass takes.
      out.push({ ...leaf, parameters: { ...leaf.parameters, engaged_with: next!.parameters.with } });
      index += 1;
    } else if (selectOf(leaf) && isFilter(next) && (leaf.parameters.scope === undefined || leaf.parameters.scope === next!.parameters.side)) {
      // A select that names a side ("select one enemy unit") takes the filter of that same side. A
      // filter of the other side after it names the attacker or target instead ("friendly X units'
      // attacks that target that unit"), so it is left to the attack that follows.
      // "select one CHARACTER model in your unit": the model's unit, folded into the selection's eligibility.
      const membership = next!.parameters.level === "model" && list[index + 2]?.family_id === "membership" && list[index + 2]!.fragment === next!.fragment
        ? list[index + 2] : undefined;
      out.push({ ...leaf, parameters: {
        ...leaf.parameters, scope: side(next!, "a selection", { models: true }),
        filter: { ...filterOf(next!), ...(membership ? { membership: membershipOf(membership, list) } : {}) }, ...modelSelection(next!, list),
        visible: leaf.parameters.visible === true || next!.parameters.visible === true,
      } });
      index += membership ? 2 : 1;
      reach(out, list[index + 1]) && (index += 1);
    } else if (leaf.family_id === "select-unit" && openAura(next)) {
      out.push(leaf);
      reach(out, next) && (index += 1);
    } else if (isFilter(leaf) && leaf.parameters.level === "model" && out.at(-1)?.family_id === "roll-auto-result"
      && out.at(-1)!.parameters.subject === undefined && out.at(-1)!.parameters.subject_filter === undefined && out.at(-1)!.fragment === leaf.fragment) {
      // "change the result of one Hit roll … made for a" + "model in that unit (excluding K models)": the models whose rolls it is.
      const roll = out.at(-1)!;
      out[out.length - 1] = { ...roll, end_byte: Math.max(roll.end_byte ?? 0, leaf.end_byte ?? 0), parameters: { ...roll.parameters, subject_filter: dslUnitFilter(leaf) } };
    } else if (isFilter(leaf) && followsTargetingAttack(out.at(-1), leaf)) {
      // "makes a ranged attack that targets an enemy unit visible to the bearer": the filter the attack names is its
      // defender. Its side is always said, so it is the owner check on the defender; `visible` after it binds to it (compile-antecedent.ts).
      if (leaf.parameters.side === "any") throw new CompileError("A unit-filter naming an attack's target must say friendly or enemy.");
      out.push({ ...leaf, family_id: "unit-filter-target", parameters: { ...leaf.parameters, owner_explicit: true, attack_target_named: true } });
    } else if (isFilter(leaf) && out.at(-1)?.family_id === "leading-unit" && out.at(-1)!.fragment === leaf.fragment
      && ["leading", "any"].includes(String(out.at(-1)!.parameters.attachment)) && joinerBetween(sourceText, out.at(-1)!, leaf) === "") {
      // "while the bearer is leading a" + "X or Y unit": the unit it is attached to, lowered to the attachment's `with`.
      const attachment = out.at(-1)!;
      if (leaf.parameters.level === "model") throw new CompileError("An attachment's unit filter must name units, not models.");
      const filter = dslUnitFilter(leaf);
      const authored = attachment.parameters.attached_to_keywords as string[] | undefined;
      if (authored !== undefined) filter.all_of = [...new Set([...((filter.all_of as string[] | undefined) ?? []), ...authored])];
      out[out.length - 1] = { ...attachment, end_byte: leaf.end_byte, parameters: { ...attachment.parameters, attached_to_filter: filter } };
    } else if (isFilter(leaf) && followedBy(out.at(-1), leaf)) {
      // "within 8\" of a" + "friendly unengaged unit": the other unit of the distance or engagement
      // before it. A "from your army" after it is the filter's own wording.
      // "engaged with an enemy unit engaged with a friendly CHARACTER unit": the nested chain takes the partner too.
      const chain = nestedEngagedChain(list, index, leaf);
      const at = chain?.at ?? pastOwners(list, index, leaf);
      const condition = out.at(-1)!;
      // The condition's wording now runs through the filter it absorbed, so the words after it (an "or") sit between it and the next condition.
      const end = list[at - 1]!.end_byte ?? condition.end_byte;
      const named = chain ? { ...leaf, parameters: { ...leaf.parameters, nested_engaged_with: chain.partner } } : leaf;
      // "If a friendly X model is your Warlord": only army-includes reads a Warlord test, and only at muster.
      const filterNode = dslUnitFilter(named, { warlordTest: condition.family_id === "army-includes" });
      if (measuresTargetedFilter(condition, list[at], leaf)) {
        // "that targeted a friendly X unit" + "within 3\" of this model": the aura is the filter's within (compile-targeted-within.ts).
        out[out.length - 1] = targetedWithin(condition, filterNode, leaf, list[at]!, end);
        index = at;
      } else {
        out[out.length - 1] = { ...condition, end_byte: end, parameters: { ...condition.parameters, following_filter: filterNode } };
        index = at - 1;
      }
    } else if (isFilter(leaf) && destroyerFilterAfter(out.at(-1), leaf)) {
      out[out.length - 1] = foldDestroyerFilter(out.at(-1)!, leaf, dslUnitFilter(leaf));
    } else if (isFilter(leaf) && destroyedModelAfter(out.at(-1), leaf)) {
      // "when this unit destroys a" + "enemy CHARACTER model": the destroyed model's owner and keywords.
      out[out.length - 1] = foldDestroyedModelAfter(out.at(-1)!, leaf);
    } else if (isFilter(leaf) && rollOwnerEvent(out.at(-1), leaf)) {
      // "when a saving throw is failed for a" + "friendly VEHICLE model": whose roll it is. A
      // "from your army" of the same side after it is the filter's own wording.
      const at = pastOwners(list, index, leaf);
      const event = out.at(-1)!;
      out[out.length - 1] = { ...event, parameters: { ...event.parameters, subject_filter: dslUnitFilter(leaf) } };
      index = at - 1;
    } else if (isFilter(leaf) && next?.family_id === "aura-range") {
      // An aura's side, when it names one, is the filter's own side ("enemy X unit" + "within 3\" of this unit").
      if (next.parameters.side !== undefined && next.parameters.side !== leaf.parameters.side) throw new CompileError("An aura-range's side differs from the unit-filter before it.");
      if (leaf.parameters.visible === true) throw new CompileError("An aura reaches units whether or not they are visible; drop visible from its unit-filter.");
      // "While a friendly WAR DOG model is within 9\" of this model": each such model is the
      // recipient (compile-model-level.ts wrapModelAura), not the unit it belongs to.
      const models = leaf.parameters.level === "model" ? { model_recipient: modelRecipientFilter(leaf, dslUnitFilter(leaf)) } : {};
      // A region grant ("the area within 6\" of this model is held in a rule region") reaches units of either side:
      // its filter may say any, and wrapAura lowers it to one counts-as over every unit within the range.
      const regionGrant = leaf.parameters.side === "any" && leaf.parameters.level !== "model" && list.slice(index + 2).some((later) =>
        later.family_id === "counts-as" && later.parameters.region !== undefined && later.fragment === leaf.fragment);
      out.push({ ...next!, parameters: { ...next!.parameters, side: side(leaf, "an aura", { models: true, anySide: regionGrant }), filter: filterOf(leaf), ...models } });
      index += 1;
    } else if (openTarget(leaf) && isFilter(next)) {
      // "One" + "friendly ADEPTA SORORITAS unit" (+ "from your army"): a Stratagem's TARGET.
      const side = String(next!.parameters.side);
      if (side === "any") throw new CompileError("A Stratagem TARGET's unit-filter must say friendly or enemy.");
      const { keywords, excluded_keywords: excluded, ...rest } = filterOf(next!, true) as { keywords?: string[]; excluded_keywords?: string[] } & Record<string, unknown>;
      out.push({ ...leaf, parameters: {
        ...leaf.parameters, side: side === "friendly" ? "your-army" : "enemy", selects: next!.parameters.level ?? "unit",
        keywords: keywords ?? [], match: "all", excluded_keywords: excluded ?? [], filter: rest,
      } });
      index += 1;
    } else if (isFilter(leaf) && ownerlessEvent(list[pastOwners(list, index, leaf)])) {
      // "each time a friendly AELDARI unit" (+ "from your army") + "makes an attack": the trigger's subject.
      const at = pastOwners(list, index, leaf);
      // "when a friendly X model" + "is destroyed": what was destroyed, not who destroyed it.
      if (destroyedObject(list[at], leaf)) {
        out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, object_filter: destroyedFilter(list[at]!, leaf, dslUnitFilter(leaf, { warlordTarget: true })) } });
        index = at;
        continue;
      }
      out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, subject_filter: dslUnitFilter(leaf, { warlordTarget: true }) } });
      index = at;
      // "is selected to move" + "or" + "declares a charge": the alternative moment is the same unit's.
      for (let alternative = list[index + 1]; orAlternative(list[index]!, alternative, sourceText); alternative = list[index + 1]) {
        out.push({ ...alternative!, parameters: { ...alternative!.parameters, subject_filter: dslUnitFilter(leaf, { warlordTarget: true }) } });
        index += 1;
      }
    } else if (isFilter(leaf) && momentOfFilter(list, index) !== null) {
      // "an enemy unit" + "engaged with this unit" + "is selected to fight": the filter is the
      // moment's unit; the conditions between them (bound to that unit by compile-antecedent.ts)
      // stay where they are, with any unit-filter their own distances measure to.
      const at = momentOfFilter(list, index)!;
      const between = foldUnitFilters(list.slice(index + 1, at).filter((other) => other.family_id !== "unit-owner"));
      out.push(...between);
      // "a friendly X model" + "within 6\" of this unit" + "is destroyed": what was destroyed.
      const participant = dslUnitFilter(leaf, { warlordTarget: true });
      const named = destroyedObject(list[at], leaf) ? { object_filter: destroyedFilter(list[at]!, leaf, participant) } : { subject_filter: participant };
      out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, ...named } });
      index = at;
    } else if (isFilter(leaf) && ownedBy(list[pastOwners(list, index, leaf)], leaf.parameters.side)) {
      // "just after an ADEPTUS CUSTODES unit" + "from your army Falls Back": the event's owner is
      // the filter's own side, so the filter names the unit whose moment it is.
      const at = pastOwners(list, index, leaf);
      out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, subject_filter: dslUnitFilter(leaf, { warlordTarget: true }) } });
      index = at;
    } else if (isFilter(leaf) && destroyedByFilterAfter(out, list, index, sourceText)) {
      // "a friendly X unit is destroyed by a" + "PENITENT unit from your army": the destroyer is the
      // destruction's subject. A "from your army" right after the filter names its side (compile-destroying-attack.ts).
      const side = destroyerSideOf(list, index)!;
      foldDestroyedByFilter(out, dslUnitFilter({ ...leaf, parameters: { ...leaf.parameters, side } }));
      const owner = list[index + 1];
      if (owner?.family_id === "unit-owner" && owner.fragment === leaf.fragment) index += 1;
    } else if (isFilter(leaf) && destroyingAttackBefore(out, leaf, sourceText)) {
      // "a friendly X unit" + "is destroyed by an attack made by an enemy Y unit": the attack's maker
      // is the destruction's destroyer, so the filter is the destruction's subject (compile-destroying-attack.ts).
      foldDestroyingAttack(out, dslUnitFilter(leaf));
      index = pastOwners(list, index, leaf) - 1;
    } else if (isFilter(leaf) && attackOfFilter(list, index) !== null && attackerAfter(list[attackOfFilter(list, index)!], leaf, selectionBefore(list, index))) {
      // "a friendly model" + "that disembarked from this TRANSPORT this turn" + "makes an attack":
      // the filter is who attacks; the conditions between (bound to the attacker by
      // compile-antecedent.ts) stay ahead of the attack as gates on it.
      const at = attackOfFilter(list, index)!;
      const between = list.slice(index + 1, at).filter((other) => other.family_id !== "unit-owner");
      // "While a friendly X unit is affected by an Order, each time a model in that unit makes an
      // attack": the designation narrows who attacks, as it narrows a filter's recipients below.
      const named = withDesignation(leaf, between.filter((other) => filterDesignation(other, leaf)));
      out.push(...between.filter((other) => !filterDesignation(other, leaf)));
      out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, attacker_filter: attackerFilter(named, list[at]!) } });
      index = at;
    } else if (isFilter(leaf) && attackerAfter(list[pastOwners(list, index, leaf)], leaf, selectionBefore(list, index))) {
      // "each time a friendly AELDARI model" + "makes an attack": who attacks. A model-level filter
      // before "in your unit makes …" is those models of this unit.
      const at = pastOwners(list, index, leaf);
      out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, attacker_filter: attackerFilter(leaf, list[at]!) } });
      index = at;
    } else if (isFilter(leaf) && targetedAttackOfFilter(list, index) !== null) {
      // "While a friendly X unit" + "is within range of an objective" + "attacks that target that
      // unit": the filter is the defender. The conditions between (bound to the target by
      // compile-antecedent.ts) stay ahead of the attack; the filter follows it as the attack's
      // target, its side checked too, since its keywords alone can match either army's units.
      const at = targetedAttackOfFilter(list, index)!;
      out.push(...list.slice(index + 1, at).filter((other) => other.family_id !== "unit-owner"));
      out.push(list[at]!);
      out.push({ ...leaf, family_id: "unit-filter-target", parameters: { ...leaf.parameters, owner_explicit: true } });
      index = at;
    } else if (isFilter(leaf) && (targetFrameBefore(list, index) || defenderCompareAfter(list, index))) {
      // "Ranged attacks aimed at friendly X units where the attacker's power beats the target's resilience": the unit-filter
      // names the attack's target. The attack-filter before it (if any) stays a condition on the attack,
      // and the target condition is the filter's units, as "that targets a VEHICLE unit" folds.
      if (leaf.parameters.side === "any") throw new CompileError("A unit-filter naming an attack's target must say friendly or enemy.");
      // binds_defender: the rolls after it in this fragment are the attacker's (compile.ts reads it).
      out.push({ ...leaf, family_id: "unit-filter-target", parameters: { ...leaf.parameters, owner_explicit: true, binds_defender: true } });
    } else if (isFilter(leaf) && subjectlessRoll(list[pastOwners(list, index, leaf)]) && !out.some((before) => before.role === "EVENT" && before.fragment === leaf.fragment)) {
      // "Friendly Adeptus Astartes Dreadnought units" + "can re-roll hit rolls of 1": the units
      // whose rolls it is. After an attack or a moment in its fragment the filter belongs to that
      // instead ("destroyed by an X unit"), and the attacker already says whose rolls.
      if (leaf.parameters.side === "any") throw new CompileError("A unit-filter whose units re-roll or modify rolls must say friendly or enemy.");
      const at = pastOwners(list, index, leaf);
      out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, subject_filter: dslUnitFilter(leaf) } });
      index = at;
    } else if (isFilter(leaf) && objectEvent(out.at(-1))) {
      // "just after a mortal wound is allocated to an" + "ADEPTA SORORITAS unit": what the moment
      // happens to. A "from your army" of the same side after it is the filter's own wording.
      const at = pastOwners(list, index, leaf);
      const event = out.at(-1)!;
      out[out.length - 1] = { ...event, parameters: { ...event.parameters, object_filter: dslUnitFilter(leaf) } };
      index = at - 1;
    } else if (isFilter(leaf) && madeBy(out.at(-1), leaf, sourceText)) {
      // "each time an attack made by a" + "NURGLE model": the filter after "made by" is who attacks.
      const at = pastOwners(list, index, leaf);
      const attack = out.at(-1)!;
      out[out.length - 1] = { ...attack, parameters: { ...attack.parameters, attacker_filter: attackerFilter(leaf, attack) } };
      index = at - 1;
    } else if (isFilter(leaf) && (out.at(-1)?.family_id === "attack" || (out.at(-1)?.family_id === "attack-filter" && out.at(-2)?.family_id === "attack"))) {
      // "each time a model in this unit makes an attack" + "that targets a" + "VEHICLE unit": the
      // attack's target, also past the weapon the attack is made with ("with a melta weapon against
      // a VEHICLE unit"). "an enemy unit" alone adds nothing an attack's target is not already.
      if (Object.keys(filterOf(leaf)).length > 0 || leaf.parameters.side === "friendly") out.push({ ...leaf, family_id: "unit-filter-target" });
    } else if (isFilter(leaf) && renamedAttackTarget(out, list, leaf)) {
      // "each time an attack is allocated to an enemy model, if this unit has K and that enemy model is a" +
      // "MONSTER unit": the filter after a condition names the target the attack's own filter already named.
      if (Object.keys(filterOf(leaf)).length > 0) out.push({ ...leaf, family_id: "unit-filter-target" });
    } else if (isFilter(leaf) && restatesObjectOwner(out.at(-1), leaf)) {
      // "destroys an" (object_owner enemy) + "enemy unit": the filter only repeats the owner the moment already names.
    } else if (isFilter(leaf) && postfixRecipient(out.at(-1))) {
      // "Add 1 to the Strength characteristic of" + "**K** models from your army": the units the
      // effect before it applies to. A "from your army" after it is the filter's own wording.
      if (leaf.parameters.side === "any") throw new CompileError("A unit-filter whose units receive an effect must say friendly or enemy.");
      const at = pastOwners(list, index, leaf);
      const effect = out.at(-1)!;
      out[out.length - 1] = { ...effect, parameters: { ...effect.parameters, subject_filter: dslUnitFilter(leaf) } };
      index = at - 1;
    } else if (isFilter(leaf) && attackFrameRolls(list, index, leaf) !== null && !out.some((before) => before.role === "EVENT" && before.fragment === leaf.fragment)) {
      // "Friendly X units' ranged attacks can:" + "Re-roll one hit roll.": the attack-filter names the
      // rolls' attack type; each roll takes the filter's units and that type, and the frame is dropped.
      if (leaf.parameters.side === "any") throw new CompileError("A unit-filter whose units re-roll or modify rolls must say friendly or enemy.");
      const { frame, gates, rolls, last } = attackFrameRolls(list, index, leaf)!;
      // "aimed at a unit within 12\"": the target gates stay ahead of the rolls they condition.
      out.push(...gates, ...foldAttackFrame(dslUnitFilter(leaf), list[frame]!, rolls));
      index = last;
    } else if (isFilter(leaf) && filteredAfter(list, index) !== null) {
      // "Friendly **K** units (from your army)" + "have the Scouts ability": every unit it
      // matches receives the effect. A "from your army" between them is the filter's own wording.
      const at = filteredAfter(list, index)!;
      const between = list.slice(index + 1, at);
      const owners = between.filter((other) => other.family_id === "unit-owner");
      if (owners.some((owner) => owner.parameters.owner !== leaf.parameters.side)) throw new CompileError("A unit-filter and the \"from your army\" after it name different sides.");
      if (leaf.parameters.side === "any") throw new CompileError("A unit-filter whose units receive an effect must say friendly or enemy.");
      // "while an enemy unit is Afflicted, … that unit": the designation narrows the units the filter names.
      const named = withDesignation(leaf, between.filter((other) => filterDesignation(other, leaf)));
      // "If a friendly X unit" + "is within range of an objective" + "that unit's …": the per-recipient
      // conditions (compile-antecedent.ts) stay ahead of the effect, about its recipient.
      out.push(...between.filter((other) => other.family_id !== "unit-owner" && !filterDesignation(other, leaf)));
      out.push({ ...list[at]!, parameters: { ...list[at]!.parameters, subject_filter: dslUnitFilter(named) } });
      index = at;
      // "Friendly X units' melee attacks have +1 A and +1 S": every property of one scope after the
      // filter names the same units (a weapon ability keyword carries no subject of its own).
      for (;;) {
        const next = list[index + 1];
        if (!next || next.fragment !== leaf.fragment) break;
        if (next.family_id === "weapon-ability-keyword") { out.push(next); index += 1; continue; }
        if (!Object.values(next.parameters).includes(FILTERED_UNITS) || next.parameters.subject_filter !== undefined) break;
        out.push({ ...next, parameters: { ...next.parameters, subject_filter: dslUnitFilter(named) } });
        index += 1;
      }
    } else if (isFilter(leaf)) {
      throw new CompileError("A unit-filter needs a select-unit or attack right before it, or an aura-range or event right after it, or a Stratagem target leaf before it.");
    } else if (openSelect(leaf)) {
      throw new CompileError("A select-unit without a scope needs a unit-filter right after it.");
    } else if (openTarget(leaf)) {
      throw new CompileError("A Stratagem target leaf without a side needs a unit-filter right after it.");
    } else if (openAura(leaf)) {
      throw new CompileError("An aura-range without a side needs a unit-filter right before it.");
    } else if (bareForEach(leaf)) {
      throw new CompileError("A bare for-each-unit-select (\"each\") needs a unit-filter right after it, in its fragment.");
    } else if (inheritedPostfixFilter(out, list, index) !== undefined) {
      // "Add 2 to the Move characteristic of" + "**K** models from your army" + "and add 1 to … rolls made for such units":
      // a later leaf about the same units takes the filter the effect before it was given.
      out.push({ ...leaf, parameters: { ...leaf.parameters, subject_filter: inheritedPostfixFilter(out, list, index) } });
    } else {
      out.push(leaf);
    }
  }
  // "For each enemy unit …: that enemy unit suffers D3 mortal wounds": each pass's unit.
  const quantifier = out.findIndex((leaf) => leaf.family_id === "for-each-unit-select");
  return quantifier < 0 ? out : out.map((leaf, at) => at > quantifier && leaf.family_id === "mortal-wounds" && leaf.parameters.recipient === "that-unit"
    ? { ...leaf, parameters: { ...leaf.parameters, recipient: AURA_RECIPIENT } } : leaf);
}

function attackerFilter(filter: CompileLeaf, attack: CompileLeaf): Record<string, unknown> {
  const dsl = dslUnitFilter(filter);
  if (attack.parameters.unit !== "this-unit") return dsl;
  // The filter's own membership (groupMembership) wins over the attack's unit.
  const { owner: _owner, ...rest } = dsl;
  return { member_of: "this-unit", ...rest };
}

/** The filter narrowed to units with (or, negated, without) the designations after it; one of each at most. */
function withDesignation(filter: CompileLeaf, designations: readonly CompileLeaf[]): CompileLeaf {
  if (designations.length === 0) return filter;
  const parameters: Record<string, unknown> = { ...filter.parameters };
  for (const designation of designations) {
    const key = designation.parameters.negated === true ? "not_designated" : "designated";
    if (parameters[key] !== undefined && parameters[key] !== designation.parameters.tag) throw new CompileError("A unit-filter's units carry two designations; the DSL filter names one.");
    parameters[key] = designation.parameters.tag;
  }
  return { ...filter, parameters };
}

/**
 * The units an issue-orders' Orders can go to, from a unit-filter after its opener: friendly units by
 * keyword. Several filters (one per bullet) are alternatives, so each must name a single keyword or
 * an any-of; their keywords join one any-of. Stored on the opener as `__eligible`.
 */
function foldOrderRecipients(opener: CompileLeaf, filter: CompileLeaf): CompileLeaf {
  const { owner, ...rest } = dslUnitFilter(filter);
  if (owner !== "friendly") throw new CompileError("Orders are issued to friendly units; the unit-filter after an issue-orders opener must say friendly.");
  if (Object.keys(rest).some((key) => key !== "all_of" && key !== "any_of") || (rest.all_of !== undefined && rest.any_of !== undefined)) {
    throw new CompileError("The units an Order can go to are named by keywords only: all of them, or any one of them.");
  }
  if (opener.parameters.eligible_keyword !== undefined) throw new CompileError("An issue-orders opener that names its eligible keyword takes no unit-filter after it.");
  const previous = opener.parameters.__eligible as { all_of?: string[]; any_of?: string[] } | undefined;
  let eligible: Record<string, unknown> = rest;
  if (previous !== undefined) {
    const alternatives = (predicate: { all_of?: unknown; any_of?: unknown }): string[] => {
      if (Array.isArray(predicate.any_of)) return predicate.any_of as string[];
      if (Array.isArray(predicate.all_of) && predicate.all_of.length === 1) return predicate.all_of as string[];
      throw new CompileError("Units an Order can go to, named in several filters, must each be one keyword or an any-of.");
    };
    eligible = { any_of: [...new Set([...alternatives(previous), ...alternatives(rest)])] };
  }
  return { ...opener, end_byte: Math.max(opener.end_byte ?? opener.start_byte, filter.end_byte ?? filter.start_byte), parameters: { ...opener.parameters, __eligible: eligible } };
}
