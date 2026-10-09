import { type FamilyExtension, properties, type Schema, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Psychic-level extensions. A unit's psyker level is a setter on the model ("has a psyker level of
 * 3"): characteristic-set takes psyker-level, which lowers to a stat-modifier `set` on this-model
 * with the stat `psyker-level` (compile-fragments.ts). The psychic-level budget reads that setter.
 */

export const PSYKER_LEVEL = "psyker-level";

/** A psyker-level setter names the model itself: no other recipient, and no weapon scope. */
function requirePsykerScope(input: Record<string, unknown>): void {
  if (input.subject !== "this-model") throw new TypeError("characteristic-set psyker-level needs subject this-model: the psyker level belongs to the model.");
  if (input.weapon_type !== undefined && input.weapon_type !== "all") throw new TypeError("characteristic-set psyker-level is not a weapon characteristic; it takes no weapon_type.");
  if (input.weapon_name !== undefined) throw new TypeError("characteristic-set psyker-level is not a weapon characteristic; it takes no weapon_name.");
}

const isPsykerItem = (item: unknown): boolean => typeof item === "object" && item !== null && (item as Record<string, unknown>).characteristic === PSYKER_LEVEL;

export const FAMILY_EXTENSIONS_16_PSYCHIC_LEVEL: readonly FamilyExtension[] = [
  {
    // "Has psyker level 2": a model setter on the psyker level, alone or in a list of pairs.
    family: "characteristic-set",
    description: "As the previous version, plus psyker-level as a characteristic: the model's psyker level is set to the value (\"has psyker level 2\"). It needs subject this-model, and takes no weapon_type or weapon_name. In a values list it can sit beside other characteristics that share the subject.",
    schema: (previous) => {
      const values = properties(previous).values!;
      const item = values.items as Schema;
      const widenedValues = { ...values, items: { ...item, properties: { ...properties(item), characteristic: widenedEnum(item, "characteristic", [PSYKER_LEVEL]) } } };
      return withProperties(previous, {
        characteristic: widenedEnum(previous, "characteristic", [PSYKER_LEVEL]),
        values: widenedValues,
      });
    },
    normalize: (input, previous) => {
      if (Array.isArray(input.values) && input.values.some(isPsykerItem)) {
        requirePsykerScope(input);
        // The previous version checks each pair as a weapon-free characteristic; psyker pairs stand in as M.
        const values = input.values as Array<Record<string, unknown>>;
        const normalized = previous({ ...input, values: values.map((item) => isPsykerItem(item) ? { ...item, characteristic: "M" } : item) }) as Record<string, unknown> & { values: Array<Record<string, unknown>> };
        return { ...normalized, values: normalized.values.map((item, index) => isPsykerItem(values[index]) ? { ...item, characteristic: PSYKER_LEVEL } : item) };
      }
      if (input.characteristic !== PSYKER_LEVEL) return previous(input);
      requirePsykerScope(input);
      return standIn(input, "characteristic", "M", previous);
    },
  },
];
