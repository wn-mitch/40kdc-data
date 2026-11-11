/**
 * Effect fragments that set or change characteristics, including the defender-side Damage
 * reduction. `leafEffect()` in `compile-fragments.ts` delegates here for those families.
 */

import { CompileError } from "./compile-error.js";
import { attackOwner, closed, type CompileLeaf, effect, type EffectContext, models, type TargetOf } from "./compile-fragments.js";
import { weaponScope } from "./compile-weapon-effects.js";
import { WEAPON_CHARACTERISTICS } from "./effect-families.js";
import { ARMY_MODELS } from "./families/characteristics.js";

/** The models from your army a change reaches (subject army-models), narrowed by its model keywords. */
function armyModels(leaf: CompileLeaf): Record<string, unknown> {
  const keywords = leaf.parameters.model_keywords as string[] | undefined;
  const excluded = leaf.parameters.excluded_model_keywords as string[] | undefined;
  return { owner: "friendly", level: "model", ...(keywords ? { all_of: keywords } : {}), ...(excluded ? { none_of: excluded } : {}) };
}

type Node = Record<string, unknown>;

/** The lowest value a characteristic change leaves one characteristic at: its own floor, else the change's minimum. */
function floorOf(leaf: CompileLeaf, stat: string): unknown {
  const own = (leaf.parameters.characteristic_minimums as Record<string, number> | undefined)?.[stat];
  return own ?? (leaf.parameters.minimum !== undefined ? closed(leaf, "minimum") : undefined);
}

/** The effect for a characteristic family, or undefined when the family is not one of them. */
export function characteristicEffect(leaf: CompileLeaf, context: EffectContext, target: TargetOf): Node | undefined {
  switch (leaf.family_id) {
    case "characteristic-set": {
      // A list set together: each pair is one setter with the shared subject and scope.
      if (Array.isArray(leaf.parameters.values)) {
        const { values, ...rest } = leaf.parameters as { values: Array<Record<string, unknown>> } & Record<string, unknown>;
        return { type: "sequence", steps: values.map((item) => effect({ ...leaf, parameters: { ...rest, ...item } }, context)) };
      }
      const subject = leaf.parameters.subject;
      const characteristic = closed(leaf, "characteristic");
      const weaponType = leaf.parameters.weapon_type;
      if (leaf.family_version >= 3 && subject === undefined) throw new CompileError("Characteristic setter needs a reviewed recipient.");
      if (leaf.family_version >= 3 && (WEAPON_CHARACTERISTICS as readonly string[]).includes(String(characteristic)) && weaponType === undefined) {
        throw new CompileError("A weapon characteristic setter needs a reviewed weapon scope.");
      }
      // The attack being made belongs to whoever attacks, as for characteristic-modifier below.
      const owner = subject === "attack" && leaf.family_version >= 7 ? attackOwner(context) : models(leaf, target(subject));
      // AP is printed negative ("an Armour Penetration characteristic of -2"); the DSL stores its magnitude.
      const value = closed(leaf, "value");
      return {
        type: "stat-modifier", target: owner,
        modifier: {
          stat: characteristic, operation: "set", value: characteristic === "AP" && typeof value === "number" ? Math.abs(value) : value, ...weaponScope(leaf),
        },
      };
    }
    case "characteristic-modifier": {
      // An additive change needs its amount: a change left without one is not lowered as a change of nothing.
      if (leaf.parameters.value === undefined && leaf.parameters.operation !== "halve") {
        throw new CompileError("Stat adjustment needs an amount; a change with no amount needs a characteristic amount leaf after its recipient.");
      }
      if (leaf.family_version < 2) {
        return { type: "stat-modifier", target: target(leaf.parameters.subject), modifier: { stat: closed(leaf, "characteristic"), operation: closed(leaf, "operation"), value: closed(leaf, "value") } };
      }
      if (leaf.parameters.subject === undefined) throw new CompileError("Stat adjustment needs a reviewed recipient.");
      if (leaf.parameters.weapon_type === undefined && leaf.parameters.weapon_var === undefined && (leaf.parameters.characteristics as string[]).some((stat) => stat === "Range" || (WEAPON_CHARACTERISTICS as readonly string[]).includes(stat))) {
        throw new CompileError("Stat adjustment needs a reviewed weapon scope.");
      }
      // The attack being made belongs to whoever attacks: the attacker when it targets this unit.
      // A weapon characteristic of "this model" names the bearer's own weapons: an attached leader's
      // bearer stays the model, not the led unit (so a Psychic-weapon scope does not widen to the unit).
      // "that unit" bound to the bearer (compile-antecedent.ts) is the led unit's models, so only an authored "this model" qualifies.
      const authoredBearer = !(leaf.antecedent_keys ?? []).includes("subject");
      const bearerWeapons = leaf.parameters.subject === "this-model" && authoredBearer && (leaf.parameters.characteristics as string[]).some((stat) => (WEAPON_CHARACTERISTICS as readonly string[]).includes(stat));
      const owner = leaf.parameters.subject === "attack" ? attackOwner(context)
        : leaf.parameters.subject === ARMY_MODELS ? armyModels(leaf)
        : models(leaf, bearerWeapons ? "this-model" : target(leaf.parameters.subject));
      // Subtracting a fixed amount from the Damage of the attack currently being allocated is a
      // defender-side reduction, not an offensive change to the attacker's weapon profile. Keep the
      // distinction narrow: other operations, moments, recipients, and non-fixed amounts remain
      // ordinary stat modifiers. Allocation to this model reduces only that model's damage.
      const allocatedDamageReduction = context.defended === true
        && leaf.parameters.subject === "attack"
        && leaf.parameters.operation === "subtract"
        && Number.isInteger(leaf.parameters.value)
        && (leaf.parameters.value as number) >= 1
        && (leaf.parameters.minimum === undefined || leaf.parameters.minimum === 1);
      // A list of named weapons (compile-weapon-names.ts) changes each characteristic for each weapon: one step per pair.
      const named = Array.isArray(leaf.parameters.weapon_names) ? leaf.parameters.weapon_names as string[] : undefined;
      const names: Array<string | undefined> = named ?? [leaf.parameters.weapon_name === undefined ? undefined : closed(leaf, "weapon_name") as string];
      const steps = (leaf.parameters.characteristics as string[]).flatMap((stat) => names.map((weaponName) => {
        const scopedLeaf = weaponName === undefined ? leaf : { ...leaf, parameters: { ...leaf.parameters, weapon_name: weaponName } };
        if (allocatedDamageReduction && stat === "D") {
          return {
            type: "damage-reduction", target: context.allocatedTo === "this-model" || context.allocatedTo === "selected-unit" ? context.allocatedTo : "this-unit",
            modifier: { reduction: closed(leaf, "value"), ...weaponScope(scopedLeaf) },
          };
        }
        return {
          type: "stat-modifier", target: owner,
          modifier: {
            stat, operation: closed(leaf, "operation"),
            ...(leaf.parameters.value !== undefined ? { value: closed(leaf, "value") } : {}),
            ...weaponScope(scopedLeaf),
            // A floor on this characteristic alone (compile-characteristic-amount.ts bindCharacteristicFloors), else the change's own.
            ...(floorOf(leaf, stat) !== undefined ? { minimum: floorOf(leaf, stat) } : {}),
          },
        };
      }));
      return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
    }
    case "damage-reduction": {
      const reductionRaw = String(closed(leaf, "reduction"));
      const reduction = /^\d+$/u.test(reductionRaw) ? Number(reductionRaw) : reductionRaw;
      return { type: "damage-reduction", target: target(leaf.parameters.subject), modifier: { reduction, ...weaponScope(leaf) } };
    }
    default:
      return undefined;
  }
}
