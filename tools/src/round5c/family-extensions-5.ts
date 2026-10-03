import { type FamilyExtension, keywordList, optional, standIn, withProperties } from "./family-extension-helpers.js";
import { boundedInteger, enumValue } from "./family-validation.js";

/**
 * The fifth round of family extensions: procedure text that composes from the existing dice-pool
 * container (Blessings of Khorne) and the Genestealer Cults' Cult Ambush. As in the earlier rounds,
 * a version checks only its own additions and hands the rest to the previous version.
 */

/** The DSL's dice-requirement types: a pair, triple, single die or run at or above min_value. */
export const DICE_REQUIREMENT_TYPES = ["pair", "triple", "single", "run"] as const;
/** Where a unit can be held off the battlefield. Cult Ambush is the Genestealer Cults' own. */
export const HELD_IN = ["strategic-reserves", "cult-ambush"] as const;
/** A named marker's id, as battlefield-marker labels it ("cult-ambush-marker"). */
const MARKER_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

const requirementSchema = {
  type: "object",
  required: ["type", "min_value"],
  properties: { type: { enum: DICE_REQUIREMENT_TYPES }, min_value: { type: "integer", minimum: 1, maximum: 6 } },
  additionalProperties: false,
};

function requirement(value: unknown, label: string): { type: string; min_value: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} is an object with type and min_value.`);
  const { type, min_value: minValue, ...extra } = value as Record<string, unknown>;
  if (Object.keys(extra).length) throw new TypeError(`${label} has only type and min_value.`);
  return { type: enumValue(type, DICE_REQUIREMENT_TYPES, `${label}.type`), min_value: boundedInteger(minValue, 1, 6, `${label}.min_value`) };
}

export const FAMILY_EXTENSIONS_5: readonly FamilyExtension[] = [
  {
    // "a double 4 or higher, or any triple": the option activates if any one requirement is met.
    family: "named-option",
    description: "As the previous version, or with requirement_any_of instead of requirement_type and requirement_min_value: two or more dice requirements, any one of which activates the option (\"a double 4 or higher, or any triple\" is a pair from 4 or a triple from 1).",
    schema: (previous) => withProperties(previous, { requirement_any_of: optional({ type: "array", items: requirementSchema, minItems: 2 }) }),
    normalize: (input, previous) => {
      if (!("requirement_any_of" in input)) return previous(input);
      const { requirement_any_of: anyOf, ...rest } = input;
      if ("requirement_type" in rest || "requirement_min_value" in rest) throw new TypeError("named-option names one requirement or requirement_any_of, not both.");
      if (!Array.isArray(anyOf) || anyOf.length < 2) throw new TypeError("named-option.requirement_any_of lists two or more requirements; one is requirement_type.");
      const list = anyOf.map((item, index) => requirement(item, `named-option.requirement_any_of[${index}]`));
      if (new Set(list.map((item) => `${item.type}:${item.min_value}`)).size !== list.length) throw new TypeError("named-option.requirement_any_of lists a requirement twice.");
      return { ...previous(rest), requirement_any_of: list };
    },
  },
  {
    // "Units in Cult Ambush": a unit held off the battlefield in Strategic Reserves or Cult Ambush.
    family: "unit-filter",
    description: "As the previous version, and held_in names where a unit off the battlefield is held: strategic-reserves, or cult-ambush (\"Units in Cult Ambush\").",
    schema: (previous) => withProperties(previous, { held_in: optional({ enum: HELD_IN }) }),
    normalize: (input, previous) => {
      if (!("held_in" in input)) return previous(input);
      const { held_in: heldIn, ...rest } = input;
      return { ...previous(rest), held_in: enumValue(heldIn, HELD_IN, "unit-filter.held_in") };
    },
  },
  {
    // "within 8\" of a Cult Ambush marker you placed": the distance to a named marker.
    family: "unit-position",
    description: "As the previous version, and of: marker measures a within or beyond distance to the named marker of_marker (\"within 8\\\" of a Cult Ambush marker\" is of_marker cult-ambush-marker).",
    schema: (previous) => {
      const of = (previous.properties as Record<string, Record<string, unknown>>).of!;
      const widened = Array.isArray(of.enum) ? { ...of, enum: [...(of.enum as string[]), "marker"] } : of;
      return withProperties(previous, { of: widened, of_marker: optional({ type: "string", pattern: MARKER_ID.source, "x-only-when": { of: ["marker"] } }) });
    },
    normalize: (input, previous) => {
      if (input.of !== "marker") {
        if ("of_marker" in input) throw new TypeError("unit-position.of_marker goes with of: marker.");
        return previous(input);
      }
      const { of_marker: marker, ...rest } = input;
      if (rest.kind !== "within" && rest.kind !== "beyond") throw new TypeError("unit-position of a marker measures a within or beyond distance.");
      if (typeof marker !== "string" || !MARKER_ID.test(marker)) throw new TypeError("unit-position.of_marker is the marker's kebab-case id (cult-ambush-marker).");
      return { ...standIn(rest, "of", "this-unit", previous), of_marker: marker };
    },
  },
  {
    // "Add a new unit … identical to your destroyed unit (excluding CHARACTER models), in Cult
    // Ambush, at its Starting Strength, with all of its wounds remaining and any [ONE SHOT]
    // weapons … considered as not having been shot."
    family: "add-unit",
    description: "As the previous version, and a copy can leave out models with copy_excluded_keywords, be at_starting_strength (every model, with all of its wounds), reset_one_shot its [One Shot] weapons, and be held_in strategic-reserves or cult-ambush instead of being set up.",
    schema: (previous) => withProperties(previous, {
      copy_excluded_keywords: optional({ type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true, "x-only-when": { source: ["copy-of-destroyed"] } }),
      at_starting_strength: optional({ const: true }),
      reset_one_shot: optional({ const: true, "x-only-when": { source: ["copy-of-destroyed"] } }),
      held_in: optional({ enum: HELD_IN }),
    }),
    normalize: (input, previous) => {
      const { copy_excluded_keywords: excluded, at_starting_strength: full, reset_one_shot: reset, held_in: heldIn, ...rest } = input;
      const normalized = previous(rest);
      const added: Record<string, unknown> = {};
      if ("copy_excluded_keywords" in input) {
        if (normalized.source !== "copy-of-destroyed") throw new TypeError("add-unit.copy_excluded_keywords leaves models out of a copy of the destroyed unit.");
        added.copy_excluded_keywords = keywordList(excluded, "add-unit.copy_excluded_keywords", 1);
      }
      for (const [key, value] of [["at_starting_strength", full], ["reset_one_shot", reset]] as const) {
        if (!(key in input)) continue;
        if (value !== true) throw new TypeError(`add-unit.${key} is true or absent.`);
        if (key === "reset_one_shot" && normalized.source !== "copy-of-destroyed") throw new TypeError("add-unit.reset_one_shot resets a copy's [One Shot] weapons.");
        added[key] = true;
      }
      if ("held_in" in input) added.held_in = enumValue(heldIn, HELD_IN, "add-unit.held_in");
      return { ...normalized, ...added };
    },
  },
];
