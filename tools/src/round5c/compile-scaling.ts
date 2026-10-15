import { CompileError } from "./compile-fragments.js";

/**
 * A count folded onto an effect leaf (`compile-count-scale.ts`) as the DSL's own shapes: a
 * `scaling` block on every leaf node the effect lowers to, a `count_of` quantity in place of a 1
 * the count replaces, or one gated copy of the effect per counted item.
 */

type Node = Record<string, unknown>;

/** The modifier field a count multiplies, by DSL effect type. */
const SCALED_FIELDS: Readonly<Record<string, string>> = {
  "stat-modifier": "value", "roll-modifier": "value",
  "resource-gain": "amount", "cp-gain": "amount",
  "re-roll": "count", "return-models": "count", "mortal-wounds": "count",
};

/** Effects whose field holds a quantity, so "1 for each X" is that field counting X. */
const COUNTED_FIELDS: Readonly<Record<string, string>> = {
  "re-roll": "count", "return-models": "count", "resource-gain": "amount",
};

function scaleLeaf(node: Node, scaling: Node): Node {
  if (node.type === "sequence" && Array.isArray(node.steps)) return { ...node, steps: (node.steps as Node[]).map((step) => scaleLeaf(step, scaling)) };
  const type = String(node.type);
  const field = SCALED_FIELDS[type];
  if (field === undefined) throw new CompileError(`A count-scale multiplies an amount; ${type} has none.`);
  if (node.scaling !== undefined) throw new CompileError(`The ${type} a count-scale multiplies is already scaled.`);
  const modifier = { ...(node.modifier as Node | undefined ?? {}) };
  const { per, of, within_inches: within, keyword, max_value: max, wargear } = scaling as Record<string, unknown>;
  const counted = COUNTED_FIELDS[type];
  if (counted !== undefined && per === 1 && max === undefined && String(modifier[counted]) === "1") {
    modifier[counted] = { count_of: of, ...(keyword !== undefined ? { keyword } : {}), ...(within !== undefined ? { within_inches: within } : {}), ...(wargear !== undefined ? { wargear } : {}) };
    return { ...node, modifier };
  }
  if (modifier[field] === undefined) throw new CompileError(`The ${type} a count-scale multiplies has no ${field} to multiply.`);
  return { ...node, scaling: { ...scaling, ...(field === "value" ? {} : { field }) } };
}

/** The effect node with the count its leaf carries applied: a scaling, or one gated copy per counted item. */
export function applyCounts(parameters: Record<string, unknown>, node: Node): Node {
  if (parameters.scaling !== undefined) return scaleLeaf(node, parameters.scaling as Node);
  const items = parameters.per_item as Node[][] | undefined;
  if (items === undefined) return node;
  // "You gain 1 additional YP for each of the following": each item that holds gives one more.
  return {
    type: "sequence",
    steps: items.map((conditions) => ({
      type: "conditional",
      condition: conditions.length === 1 ? conditions[0]! : { operator: "and", operands: conditions },
      effect: structuredClone(node),
    })),
  };
}
