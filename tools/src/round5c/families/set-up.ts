import type { SemanticFamilyDefinition } from "../contracts.js";
import { DICE, type FamilyExtension, keywordList, optional, properties, withProperties } from "../family-extension-helpers.js";
import { enumValue, exactKeys } from "../family-validation.js";
import { HELD_IN, printedKeywordsExtension } from "./shared.js";

/**
 * Versions of set-up, add-unit, unit-size and split-unit, and the deployment-window base family.
 * Each version checks only its own additions and hands the rest of a leaf to the previous version,
 * so every earlier leaf still fits it unchanged.
 */

/** Where a set-up places a unit, as the DSL's set-up placement names it. */
const PLACEMENTS = ["closest-to-destruction", "closest-to-original", "deployment-zone", "wholly-within", "anywhere"] as const;

/** set-up parameters that place a permitted set-up; a forbidden one names its zone through a folded limit. */
const PLACING_KEYS = ["via", "marker_inches", "marker_wholly", "placement", "ignore_limits", "min_enemy_distance", "within_edge"] as const;

/**
 * "contains D3 models": the new unit's model count is a dice amount (unit-size, which the add-unit
 * before it folds in). The whole-number form keeps its 1 to 20 bound.
 */
const UNIT_SIZE_DICE: FamilyExtension = {
  family: "unit-size",
  version: 2,
  description: "As the previous version, plus models as a dice amount (D3, D6, D3+1, 2D6): the added unit holds that many models (\"containing D3 models\"). A whole number keeps its 1 to 20 bound.",
  schema: (previous) => withProperties(previous, {
    models: { anyOf: [properties(previous).models!, { type: "string", pattern: DICE.source }] },
  }),
  normalize: (input, previous) => {
    if (typeof input.models !== "string") return previous(input);
    exactKeys(input, ["models"], "unit-size");
    const dice = input.models.trim().toUpperCase();
    if (!DICE.test(dice)) throw new TypeError("unit-size.models is a whole number from 1 to 20, or a dice amount (D3, D6, D3+1, 2D6).");
    return { models: dice };
  },
};

/**
 * "a new SPORE MINES unit containing D3 models": the one new unit holds a dice amount of models.
 * The qualifier cannot be a separate leaf here, because the add-unit span must cover "to your army"
 * and the words between the two leaves are not glue; so the size sits on the add-unit itself.
 */
const ADD_UNIT_MODELS: FamilyExtension = {
  family: "add-unit",
  version: 3,
  description: "As the previous version, plus models: the one new unit of a named datasheet holds a dice amount of models (\"a new SPORE MINES unit containing D3 models\"). The count stays 1.",
  schema: (previous) => withProperties(previous, {
    models: optional({ type: "string", pattern: DICE.source, "x-only-when": { source: ["datasheet"] } }),
  }),
  normalize: (input, previous) => {
    if (!("models" in input)) return previous(input);
    const { models, ...rest } = input;
    if (rest.source !== "datasheet") throw new TypeError("add-unit.models sizes a new unit of a named datasheet.");
    if (rest.count !== "1") throw new TypeError("add-unit.models sizes one new unit, so its count is 1.");
    if (rest.join === true) throw new TypeError("add-unit.models sizes a new unit; models joining a unit are not a new unit.");
    const normalized = previous(rest);
    const dice = typeof models === "string" ? models.trim().toUpperCase() : "";
    if (!DICE.test(dice)) throw new TypeError("add-unit.models is a dice amount (D3, D6, D3+1, 2D6).");
    return { ...normalized, models: dice };
  },
};

/** `deployment-window`: "during deployment", the window before the battle starts. */
export const SET_UP_RESTRICTION_FAMILIES: readonly SemanticFamilyDefinition[] = [{
  id: "deployment-window",
  version: 1,
  role: "CONDITION",
  label: "During deployment",
  description: "Gates an effect to the deployment step, before the battle starts (\"during deployment\").",
  starter: { during: "deployment" },
  parameterSchema: {
    type: "object",
    required: ["during"],
    properties: { during: { enum: ["deployment"] } },
    additionalProperties: false,
  },
}];

/** Each parameter rule of the set-up restriction families, or null for another family. */
export function normalizeSetUpRestrictionParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "deployment-window") return null;
  exactKeys(input, ["during"], family);
  return { during: enumValue(input.during, ["deployment"], "deployment-window.during") };
}

export const SET_UP_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "set it up as close as possible to where it was destroyed", "regardless of how many units
    // are already in Strategic Reserves".
    family: "set-up",
    version: 3,
    description: "As the previous version, plus placement (as close as possible to where it was destroyed or to where it was, wholly within its deployment zone, anywhere) and ignore_limits: the set-up ignores the limits on units in or arriving from Strategic Reserves.",
    schema: (previous) => withProperties(previous, {
      placement: optional({ enum: PLACEMENTS }),
      ignore_limits: optional({ const: true }),
    }),
    normalize: (input, previous) => {
      const { placement, ignore_limits: ignore, ...rest } = input;
      const added: Record<string, unknown> = {};
      if ("placement" in input) added.placement = enumValue(placement, PLACEMENTS, "set-up.placement");
      if ("ignore_limits" in input) {
        if (ignore !== true) throw new TypeError("set-up.ignore_limits is true or absent.");
        added.ignore_limits = true;
      }
      return { ...previous(rest), ...added };
    },
  },
  {
    // "at least one of its models must be touching one of your Cult Ambush markers (that marker is
    // then removed)"; "wholly within 6\" of that Cult Ambush marker" instead of touching it.
    family: "set-up",
    version: 4,
    description: "As the previous version, plus via cult-ambush-marker (set up using a Cult Ambush marker: touching it, and the marker is removed), and with it marker_inches and marker_wholly: (wholly) within that many inches of the marker instead.",
    schema: (previous) => withProperties(previous, {
      via: optional({ enum: ["cult-ambush-marker"] }),
      marker_inches: optional({ type: "integer", minimum: 1 }),
      marker_wholly: optional({ const: true }),
    }),
    normalize: (input, previous) => {
      const { via, marker_inches: inches, marker_wholly: wholly, ...rest } = input;
      if (via === undefined && inches === undefined && wholly === undefined) return previous(input);
      if (via !== "cult-ambush-marker") throw new TypeError("set-up.via is cult-ambush-marker or absent; marker_inches and marker_wholly need it.");
      if (inches === undefined && wholly !== undefined) throw new TypeError("set-up.marker_wholly needs marker_inches.");
      if (inches !== undefined && (!Number.isInteger(inches) || (inches as number) < 1)) throw new TypeError("set-up.marker_inches is a whole number of inches, at least 1.");
      if (wholly !== undefined && wholly !== true) throw new TypeError("set-up.marker_wholly is true or absent.");
      return { ...previous(rest), via, ...(inches !== undefined ? { marker_inches: inches } : {}), ...(wholly === true ? { marker_wholly: true } : {}) };
    },
  },
  /**
   * A set-up a rule forbids or requires. "Set up as Reinforcements" is set up from Reserves (11th
   * edition has no Reinforcements rule), so it records the same strategic-reserves value.
   * "Horizontally" in a distance is a connective.
   */
  {
    // "enemy units … cannot be set up within 12\" of this model"; "that unit must be set up wholly within …".
    family: "set-up",
    version: 5,
    description: "As the previous version, plus allow false (\"cannot be set up\": the set-up this leaf names, with any placement limit after it, is forbidden) and mandatory (\"must be set up\").",
    schema: (previous) => withProperties(previous, { allow: optional({ const: false }), mandatory: optional({ const: true }) }),
    normalize: (input, previous) => {
      const { allow, mandatory, ...rest } = input;
      if (allow !== undefined && allow !== false) throw new TypeError("set-up.allow is false or absent.");
      if (mandatory !== undefined && mandatory !== true) throw new TypeError("set-up.mandatory is true or absent.");
      if (allow === false && mandatory === true) throw new TypeError("set-up cannot be both forbidden (allow false) and required (mandatory).");
      if (allow === false) {
        const placing = PLACING_KEYS.find((key) => key in rest);
        if (placing) throw new TypeError(`set-up.${placing} places a permitted set-up; a forbidden set-up (allow false) names its zone through the placement limit after it.`);
      }
      return { ...previous(rest), ...(allow === false ? { allow: false } : {}), ...(mandatory === true ? { mandatory: true } : {}) };
    },
  },
  {
    // "Add a new unit … identical to your destroyed unit (excluding CHARACTER models), in Cult
    // Ambush, at its Starting Strength, with all of its wounds remaining and any [ONE SHOT]
    // weapons … considered as not having been shot."
    family: "add-unit",
    version: 2,
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
 ADD_UNIT_MODELS,
  UNIT_SIZE_DICE,
  printedKeywordsExtension("split-unit", 2),
];
