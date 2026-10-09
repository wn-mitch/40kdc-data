/**
 * Opponent Stratagem targeting (family-extensions-16-opponent-stratagem-target-event.ts): a
 * targets-selected moment whose unit is named by a range and a unit-filter ("a rival picks a squad
 * from its force within 12\" of this model with a Gadget"), and the restriction on units already
 * chosen by named Gadgets.
 */

import { ANTECEDENT } from "./antecedent-families.js";
import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { dslUnitFilter } from "./compile-unit-filters.js";
import { sameSentence } from "./compile-named-ability.js";
import { TARGETED_WITH_STRATAGEM } from "./family-extensions-16-opponent-stratagem-target-event.js";

type Node = Record<string, unknown>;

/** A targets-selected moment, the kind a Stratagem or an opponent's targeting folds into. */
const isTargetMoment = (leaf: CompileLeaf | undefined): leaf is CompileLeaf =>
  leaf?.family_id === "event" && leaf.parameters.kind === "targets-selected";

/**
 * "a rival picks a squad from its force within 12\" of this model": a targets-selected
 * moment, the unit-filter naming the targeted unit, then a within range (subject antecedent: the
 * unit that filter matched) from this unit or model. The range becomes the target filter's
 * `within` (object_filter), the DSL's own range for a unit that is the moment's object.
 */
export function foldObjectRange(list: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const moment = list[index]!;
    const filter = list[index + 1];
    const range = list[index + 2];
    const isWithin = (leaf: CompileLeaf | undefined): leaf is CompileLeaf => leaf?.family_id === "unit-position" && leaf.parameters.kind === "within" && leaf.parameters.subject === ANTECEDENT;
    // A range right after a targets-selected moment with no unit-filter naming the target between them:
    // the range would measure the moment's subject, not the unit it targeted. Refused, not folded.
    if (isTargetMoment(moment) && moment.parameters.object === undefined && moment.parameters.object_filter === undefined && isWithin(filter)
      && moment.fragment === filter!.fragment && sameSentence(sourceText, moment.end_byte, filter!.start_byte)) {
      throw new CompileError("A range from the unit a moment targets needs that unit's unit-filter between the moment and the range, in the same sentence.");
    }
    const pairs = isTargetMoment(moment) && filter?.family_id === "unit-filter" && isWithin(range)
      && moment.fragment === filter.fragment && filter.fragment === range!.fragment
      && sameSentence(sourceText, moment.end_byte, filter.start_byte)
      && sameSentence(sourceText, filter.end_byte, range!.start_byte);
    if (!pairs) {
      out.push(moment);
      continue;
    }
    if (moment.parameters.object !== undefined || moment.parameters.object_filter !== undefined) {
      throw new CompileError("A targets-selected moment that already names what it was done to cannot take a unit-filter and range after it.");
    }
    if (range!.parameters.negated === true) throw new CompileError("A range from the unit a moment targets cannot be negated; the target is within the range or not.");
    const of = range!.parameters.of;
    if (of !== "this-model" && of !== "this-unit") throw new CompileError(`A targeted unit's range is measured from this unit or this model, not ${JSON.stringify(of)}.`);
    if (typeof range!.parameters.inches !== "number") throw new CompileError("A targeted unit's range needs its inches.");
    const within = {
      of,
      range: { inches: range!.parameters.inches },
      ...(range!.parameters.wholly === true ? { wholly: true } : {}),
    };
    out.push({ ...moment, parameters: { ...moment.parameters, object_filter: { ...dslUnitFilter(filter), within } } });
    index += 2;
  }
  return out;
}

/**
 * "... picks a unit with a Gadget": the Gadget tail after a targets-selected moment in the
 * same sentence (a separate event leaf) merges into that moment as its action_kind stratagem.
 * A tail with no moment before it stays a standalone targets-selected event, as before.
 */
export function foldStratagemTail(list: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  const out: CompileLeaf[] = [];
  for (const leaf of list) {
    const moment = out.at(-1);
    const tail = isTargetMoment(leaf) && leaf.parameters.action_kind === "stratagem" && leaf.parameters.owner === undefined
      && leaf.parameters.subject === undefined && leaf.parameters.object === undefined && leaf.parameters.id === undefined && leaf.parameters.object_filter === undefined;
    const merges = tail && isTargetMoment(moment) && moment.fragment === leaf.fragment && sameSentence(sourceText, moment.end_byte, leaf.start_byte);
    if (tail && !merges) throw new CompileError("A Stratagem tail must directly follow a targets-selected moment in its sentence.");
    if (!merges) {
      out.push(leaf);
      continue;
    }
    if (moment.parameters.action_kind !== undefined) throw new CompileError("A targets-selected moment with a Stratagem tail already names its action kind.");
    out[out.length - 1] = { ...moment, parameters: { ...moment.parameters, action_kind: "stratagem" } };
  }
  return out;
}

/**
 * Restricted by named Gadgets: "not chosen by [these] Gadgets this phase". One
 * happened per Stratagem id (any player's targeting, of the leaf's unit), any of them; the leaf's
 * negation is applied by the caller.
 */
export function stratagemTargetedAnyOf(leaf: CompileLeaf, subject: string | undefined): Node {
  const ids = closed(leaf, "stratagem_ids");
  if (!Array.isArray(ids) || ids.length === 0) throw new CompileError(`unit-activity ${TARGETED_WITH_STRATAGEM} names its Stratagems in stratagem_ids.`);
  const nodes = ids.map((id): Node => ({
    type: "happened",
    parameters: { event: "targets-selected", subject: { owner: "any" }, object: subject ?? "this-unit", filter: { kind: "stratagem", id }, window: "phase" },
  }));
  return nodes.length === 1 ? nodes[0]! : { operator: "or", operands: nodes };
}

/** Whether a unit-activity leaf names the Stratagem-targeting activity, and the refusals for a malformed one. */
export function checkStratagemActivity(leaf: CompileLeaf, activities: readonly string[]): boolean {
  const named = activities.includes(TARGETED_WITH_STRATAGEM);
  if (!named) {
    if (leaf.parameters.stratagem_ids !== undefined) throw new CompileError("unit-activity stratagem_ids applies only to the Stratagem-targeting activity.");
    return false;
  }
  if (activities.length !== 1) throw new CompileError("The Stratagem-targeting activity is not mixed with another activity in one leaf.");
  return true;
}
