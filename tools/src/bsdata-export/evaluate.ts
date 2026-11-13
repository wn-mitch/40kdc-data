/**
 * Evaluates the subset of BSData modifier logic the exporter emits (and the
 * same subset where BSData uses it): a field's base value, then each modifier
 * in order whose conditions hold. Used to check that an exported entry prices
 * and bounds a unit the way the package does, and to compare entries with
 * BSData's. Anything outside the subset throws `UnsupportedLogic`.
 */
import { children, str, type BsNode } from "./source.js";

export class UnsupportedLogic extends Error {}

export interface EvalContext {
  /** Models in the unit being evaluated. */
  readonly modelCount: number;
  /** Ids that count as this unit's model groups/entries (BSData sometimes counts a model group by id). */
  readonly modelScopes?: ReadonlySet<string>;
  /** Earlier copies of the same entry in the force. */
  readonly earlierCopies: number;
  /** The army's primary catalogue id. */
  readonly primaryCatalogueId: string;
  /** Entry ids selected in the army (battle size, detachments, toggles). */
  readonly selected: ReadonlySet<string>;
}

function compare(type: string, actual: number, value: number): boolean {
  switch (type) {
    case "atLeast":
      return actual >= value;
    case "greaterThan":
      return actual > value;
    case "atMost":
      return actual <= value;
    case "lessThan":
      return actual < value;
    case "equalTo":
      return actual === value;
    case "notEqualTo":
      return actual !== value;
    default:
      throw new UnsupportedLogic(`condition type ${type}`);
  }
}

function conditionHolds(condition: BsNode, entryId: string, ctx: EvalContext): boolean {
  const type = str(condition, "type") ?? "";
  const scope = str(condition, "scope") ?? "";
  const childId = str(condition, "childId") ?? "";
  const field = str(condition, "field") ?? "";
  const value = typeof condition.value === "number" ? condition.value : Number(condition.value ?? 0);
  if (scope === "primary-catalogue") {
    const is = childId === ctx.primaryCatalogueId;
    if (type === "instanceOf") return is;
    if (type === "notInstanceOf") return !is;
    throw new UnsupportedLogic(`primary-catalogue ${type}`);
  }
  if (field !== "selections") throw new UnsupportedLogic(`condition field ${field}`);
  const countsModels =
    (childId === "model" && (scope === entryId || scope === "self")) ||
    (ctx.modelScopes?.has(childId) === true && (scope === entryId || scope === "self"));
  if (countsModels) return compare(type, ctx.modelCount, value);
  if (scope === "force" || scope === "roster") return compare(type, ctx.selected.has(childId) ? 1 : 0, value);
  throw new UnsupportedLogic(`condition ${childId} in ${scope}`);
}

function localGroupHolds(group: BsNode, entryId: string, ctx: EvalContext): boolean {
  const conditions = children(group, "conditions");
  const ordinal =
    conditions.length === 2 &&
    conditions.some((c) => str(c, "type") === "before" && str(c, "childId") === "any") &&
    conditions.some((c) => str(c, "type") === "instanceOf" && str(c, "childId") === entryId);
  if (!ordinal) throw new UnsupportedLogic("local condition group other than an earlier-copies count");
  return compare(str(group, "type") ?? "", ctx.earlierCopies, Number(group.value ?? 0));
}

function groupHolds(group: BsNode, entryId: string, ctx: EvalContext): boolean {
  const results = [
    ...children(group, "conditions").map((c) => conditionHolds(c, entryId, ctx)),
    ...children(group, "conditionGroups").map((g) => groupHolds(g, entryId, ctx)),
    ...children(group, "localConditionGroups").map((g) => localGroupHolds(g, entryId, ctx)),
  ];
  const type = str(group, "type") ?? "and";
  if (type === "and") return results.every(Boolean);
  if (type === "or") return results.some(Boolean);
  throw new UnsupportedLogic(`condition group ${type}`);
}

function modifierApplies(modifier: BsNode, entryId: string, ctx: EvalContext): boolean {
  if (children(modifier, "repeats").length > 0) throw new UnsupportedLogic("repeating modifier");
  return groupHolds({ type: "and", conditions: modifier.conditions, conditionGroups: modifier.conditionGroups }, entryId, ctx);
}

/** Every modifier on a node, including those inside modifier groups, with the group's conditions folded in. */
function modifiersOf(node: BsNode): BsNode[] {
  const out = [...children(node, "modifiers")];
  for (const group of children(node, "modifierGroups")) {
    for (const modifier of modifiersOf(group)) {
      out.push({
        ...modifier,
        conditionGroups: [
          ...children(modifier, "conditionGroups"),
          { type: "and", conditions: group.conditions, conditionGroups: group.conditionGroups },
        ],
      });
    }
  }
  return out;
}

/**
 * The value of `field` on `node` after its modifiers: `base`, then each
 * applying `set`/`increment`/`decrement` targeting `field`, in order.
 */
export function evaluateField(node: BsNode, entryId: string, field: string, base: number, ctx: EvalContext): number {
  let value = base;
  for (const modifier of modifiersOf(node)) {
    if (str(modifier, "field") !== field) continue;
    if (!modifierApplies(modifier, entryId, ctx)) continue;
    const amount = Number(modifier.value);
    const type = str(modifier, "type");
    if (type === "set") value = amount;
    else if (type === "increment") value += amount;
    else if (type === "decrement") value -= amount;
    else throw new UnsupportedLogic(`modifier type ${type}`);
  }
  return value;
}

/** An entry's points under `ctx`. */
export function evaluatePoints(entry: BsNode, ptsTypeId: string, ctx: EvalContext): number {
  const id = str(entry, "id")!;
  const base = children(entry, "costs").find((c) => str(c, "typeId") === ptsTypeId);
  return evaluateField(entry, id, ptsTypeId, typeof base?.value === "number" ? base.value : 0, ctx);
}

/** A constraint's value on `node` under `ctx`; `entryId` is the unit entry model counts are scoped to. */
export function evaluateConstraint(node: BsNode, constraintId: string, entryId: string, ctx: EvalContext): number {
  const constraint = children(node, "constraints").find((c) => str(c, "id") === constraintId);
  if (!constraint) throw new Error(`no constraint ${constraintId}`);
  return evaluateField(node, entryId, constraintId, Number(constraint.value), ctx);
}
