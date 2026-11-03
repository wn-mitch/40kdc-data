/**
 * Effect fragments for dice rolls: re-rolls, roll modifiers, fixed or automatic results, critical
 * thresholds, and ignoring modifiers. `leafEffect()` in `compile-fragments.ts` delegates here for
 * those families.
 */

import { CompileError } from "./compile-error.js";
import { abilityRollOf, closed, type CompileLeaf, effect, type EffectContext, type TargetOf } from "./compile-fragments.js";
import { weaponScope } from "./compile-weapon-effects.js";

type Node = Record<string, unknown>;

/** Rolls the attacker makes; when an attack targets this unit, modifiers to them belong to the attacker. */
const ATTACKER_ROLLS = new Set(["hit", "wound", "damage"]);

/** "One Hit roll, one Wound roll or one Damage roll": the player picks one roll; each is an option with that roll alone. */
function pickOne(leaf: CompileLeaf, context: EffectContext): Node {
  const { rolls, ...rest } = leaf.parameters as { rolls: string[] } & Record<string, unknown>;
  return { type: "choice", options: rolls.map((roll) => effect({ ...leaf, parameters: { ...rest, roll } }, context)) };
}

/** The effect for a roll family, or undefined when the family is not one of them. */
export function rollEffect(leaf: CompileLeaf, context: EffectContext, target: TargetOf): Node | undefined {
  // A unit-filter folded onto a subjectless roll ("Friendly X units can re-roll …") names whose rolls.
  const rollTarget = (roll: unknown): Node | string => {
    if (leaf.parameters.subject_filter !== undefined) return structuredClone(leaf.parameters.subject_filter as Node);
    // A test taker that names the units of a unit-filter, with none folded onto this leaf, has no unit to name.
    if (leaf.parameters.test_taker === "filtered-units") throw new CompileError(`${leaf.family_id} names the units of a unit-filter, but none sits right before it.`);
    return typeof leaf.parameters.test_taker === "string" ? leaf.parameters.test_taker
      : typeof leaf.parameters.subject === "string" && (leaf.family_id === "roll-modifier" || leaf.family_id === "reroll" || leaf.family_id === "roll-auto-result") ? target(leaf.parameters.subject)
      : context.incoming && ATTACKER_ROLLS.has(String(roll)) ? "attacker" : context.attacker ?? "this-unit";
  };
  switch (leaf.family_id) {
    case "reroll": {
      // Version 3: a pick of one from several rolls is a choice of one re-roll each.
      if (Array.isArray(leaf.parameters.rolls)) {
        if (leaf.parameters.each !== true) return pickOne(leaf, context);
        // Version 4 `each`: every listed roll can be re-rolled, together.
        const { rolls, each: _each, ...rest } = leaf.parameters as { rolls: string[] } & Record<string, unknown>;
        return { type: "sequence", steps: rolls.map((roll) => effect({ ...leaf, parameters: { ...rest, roll } }, context)) };
      }
      const roll = abilityRollOf(leaf) ?? closed(leaf, "roll");
      const subset = closed(leaf, "subset");
      const modifier: Node = subset === "ones" ? { roll, subset: "ones" } : subset === "failed" ? { roll, subset: "all-failures" } : { roll, result_scope: "any-result" };
      // Version 1 leaves have neither field; version 2 adds them, weapon_type defaulting to "all".
      const count = leaf.parameters.count === undefined ? undefined : closed(leaf, "count");
      if (count !== undefined) modifier.count = count;
      Object.assign(modifier, weaponScope(leaf));
      return { type: "re-roll", target: rollTarget(roll), modifier };
    }
    case "ignore-modifiers": {
      // Version 2 lists kinds; compileLeaves splits a two-kind leaf first, so only a lone leaf
      // (a preview) reaches here with both, and it reads as one effect per kind.
      if (Array.isArray(leaf.parameters.what)) {
        const { what: kinds, stats, rolls, except_rolls: except, ...rest } = leaf.parameters as Record<string, unknown> & { what: string[] };
        const steps = kinds.map((kind) => effect({ ...leaf, parameters: { ...rest, what: kind, ...(kind === "characteristics" ? (stats === undefined ? {} : { stats }) : { rolls, ...(except === undefined ? {} : { except_rolls: except }) }) } }, context));
        return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
      }
      const what = closed(leaf, "what");
      const modifier: Node = { what };
      if (what === "characteristics") {
        const stats = leaf.parameters.stats as string[] | undefined;
        if (stats) modifier.stats = stats;
      } else {
        const rolls = leaf.parameters.rolls as string[] | undefined;
        if (rolls) modifier.rolls = rolls;
        // "(excluding modifiers to saving throws)": rolls whose modifiers still apply.
        const except = leaf.parameters.except_rolls as string[] | undefined;
        if (except) modifier.except_rolls = except;
      }
      const only = leaf.parameters.only === undefined ? undefined : closed(leaf, "only");
      if (only) modifier.only = only;
      Object.assign(modifier, weaponScope(leaf));
      return { type: "ignore-modifiers", target: target(leaf.parameters.subject), modifier };
    }
    case "roll-auto-result": {
      if (Array.isArray(leaf.parameters.rolls)) return pickOne(leaf, context);
      const roll = closed(leaf, "roll");
      const outcome = closed(leaf, "outcome");
      // "choose whether the result of that roll is a 1 or a 6": a choice of fixed results.
      if (outcome === "chosen") return { type: "choice", options: (leaf.parameters.values as number[]).map((result) => ({ type: "roll-result", target: rollTarget(roll), modifier: { roll, result } })) };
      const modifier: Node = { roll };
      if (leaf.parameters.count === 1) modifier.count = 1;
      if (outcome === "succeeds-on") modifier.succeeds_on = closed(leaf, "value");
      else if (outcome === "counts-as-6") modifier.result = 6;
      else if (outcome === "fails-on") modifier.fails_on = closed(leaf, "value");
      else modifier.result = "pass";
      Object.assign(modifier, weaponScope(leaf));
      return { type: "roll-result", target: rollTarget(roll), modifier };
    }
    case "roll-modifier": {
      // "Add 1 to Advance and Charge rolls": the same change to each roll, together.
      if (Array.isArray(leaf.parameters.rolls)) {
        const { rolls, ...rest } = leaf.parameters as { rolls: string[] } & Record<string, unknown>;
        return { type: "sequence", steps: rolls.map((roll) => effect({ ...leaf, parameters: { ...rest, roll } }, context)) };
      }
      // "+1 to hazard rolls made for its X and Y weapons" (compile-weapon-names.ts): the same change per named weapon, one step each.
      if (Array.isArray(leaf.parameters.weapon_names)) {
        const { weapon_names: names, ...rest } = leaf.parameters as Record<string, unknown> & { weapon_names: string[] };
        return { type: "sequence", steps: names.map((name) => effect({ ...leaf, parameters: { ...rest, weapon_name: name } }, context)) };
      }
      const roll = abilityRollOf(leaf) ?? closed(leaf, "roll");
      return {
        type: "roll-modifier", target: rollTarget(roll),
        modifier: {
          // "Halve Advance and Charge rolls" (roll-modifier@11) takes no value.
          roll, operation: closed(leaf, "operation"), ...(leaf.parameters.operation === "halve" ? {} : { value: typeof leaf.parameters.value_var === "string" ? { roll_var: leaf.parameters.value_var } : closed(leaf, "value") }),
          ...(leaf.parameters.cap !== undefined ? { cap: closed(leaf, "cap") } : {}), ...weaponScope(leaf),
        },
      };
    }
    case "critical-hit-threshold": {
      const value = closed(leaf, "value");
      if (typeof value !== "number") throw new CompileError("critical-hit-threshold needs a numeric threshold before it can compile.");
      const roll = leaf.parameters.roll === undefined ? "hit" : closed(leaf, "roll");
      // Folded from "if such a weapon already has that ability" (compile-weapon-already-has.ts): only the weapons that print the keyword.
      return {
        type: "roll-result", target: rollTarget(roll),
        modifier: {
          roll, critical_on: value,
          ...weaponScope(leaf),
        },
      };
    }
    default:
      return undefined;
  }
}
