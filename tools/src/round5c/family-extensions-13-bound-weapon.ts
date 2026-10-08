import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";
import { WEAPON_CHARACTERISTICS } from "./effect-families.js";

/**
 * Wave-9 battle-formation weapon change: a stat adjustment to the one weapon an earlier
 * select-weapon named and bound ("select one of this model's Plasma rifle weapons ... That weapon's
 * attacks have: +2 S"). Each version checks only its own additions; the bound weapon is resolved
 * per record by compile-weapon-antecedent.ts, never by the family itself.
 */

/** A printed weapon name, trimmed and lowercased as the DSL carries weapon names. */
function weaponName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label}.weapon_name is the weapon's name as its datasheet prints it.`);
  return value.trim().toLowerCase();
}

/** Remove a key from a family's required list, for a version where another check requires it instead. */
function withoutRequired(schema: Record<string, unknown>, key: string): Record<string, unknown> {
  if (!Array.isArray(schema.required)) return schema;
  return { ...schema, required: (schema.required as string[]).filter((item) => item !== key) };
}

export const FAMILY_EXTENSIONS_13_BOUND_WEAPON: readonly FamilyExtension[] = [
  {
    // "select one of this model's Plasma rifle weapons": a named weapon, not any weapon of a type.
    family: "select-weapon",
    description: "As the previous version, plus weapon_name: the selected weapon is the one with this printed name (exactly one weapon of the target has it).",
    schema: (previous) => withProperties(previous, { weapon_name: optional({ type: "string", minLength: 1 }) }),
    normalize: (input, previous) => {
      if (!("weapon_name" in input)) return previous(input);
      const { weapon_name: name, ...rest } = input;
      return { ...previous(rest), weapon_name: weaponName(name, "select-weapon") };
    },
  },
  {
    // "That weapon's attacks have:": the scope is the bound weapon, so it names no weapon_type.
    family: "weapon-property-scope",
    description: "As the previous version, plus weapon: antecedent, the weapon an earlier select-weapon bound (\"That weapon's attacks have\"). It takes subject this-model and no weapon_type; a stat adjustment after it is the only property it can scope.",
    schema: (previous) => withProperties(withoutRequired(previous, "weapon_type"), {
      weapon: optional({ enum: ["antecedent"] }),
    }),
    normalize: (input, previous) => {
      if (input.weapon === undefined) return previous(input);
      if (input.weapon !== "antecedent") throw new TypeError("weapon-property-scope.weapon takes only antecedent.");
      if ("weapon_type" in input) throw new TypeError("weapon-property-scope.weapon antecedent is the bound weapon; it takes no weapon_type.");
      if (input.subject !== "this-model") throw new TypeError("weapon-property-scope.weapon antecedent belongs to this-model, the model that made the selection.");
      return { subject: "this-model", weapon: "antecedent" };
    },
  },
  {
    // "+2 S" under "That weapon's attacks have:": the stat change lands on the bound weapon only.
    family: "characteristic-modifier",
    description: "As the previous version, plus weapon: antecedent, the one weapon an earlier select-weapon bound. Only weapon characteristics (A, WS, BS, S, AP, D) and only this-model take it; it names no weapon_name or weapon_keyword, and no weapon_type (with one, it is the previous version's equipped-weapon-count form).",
    schema: (previous) => withProperties(withoutRequired(previous, "weapon_type"), {
      weapon: optional({ enum: ["antecedent"] }),
    }),
    normalize: (input, previous) => {
      if (input.weapon === undefined) return previous(input);
      if (input.weapon !== "antecedent") throw new TypeError("characteristic-modifier.weapon takes only antecedent.");
      // With a weapon_type it is the previous version's form: the weapons an equipped-weapon count counted.
      if ("weapon_type" in input) return previous(input);
      for (const key of ["weapon_name", "weapon_keyword"]) {
        if (key in input) throw new TypeError(`characteristic-modifier.weapon antecedent is the bound weapon; it takes no ${key}.`);
      }
      // A stat adjustment under a scope takes its recipient from the scope; a stated one must be this-model.
      if (input.subject !== undefined && input.subject !== "this-model") throw new TypeError("characteristic-modifier.weapon antecedent belongs to this-model, the model that made the selection.");
      const characteristics = Array.isArray(input.characteristics) ? input.characteristics as unknown[] : [];
      if (characteristics.length === 0 || !characteristics.every((stat) => (WEAPON_CHARACTERISTICS as readonly string[]).includes(String(stat)))) {
        throw new TypeError("characteristic-modifier.weapon antecedent changes weapon characteristics only (A, WS, BS, S, AP, D).");
      }
      const { weapon: _weapon, ...rest } = input;
      // The previous version checks every other key with the weapon type it knows as "all", then the
      // antecedent scope stands in for the weapon type.
      const { weapon_type: _all, ...normalized } = previous({ ...rest, weapon_type: "all" });
      return { ...normalized, weapon: "antecedent" };
    },
  },
];
