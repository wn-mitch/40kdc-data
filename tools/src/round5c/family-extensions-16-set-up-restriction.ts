import type { SemanticFamilyDefinition } from "./contracts.js";
import { DESIGNATION_IDS } from "../translate/designations.js";
import { DICE, type FamilyExtension, optional, properties, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { enumOrSourceSchema, enumValue, exactKeys } from "./family-validation.js";
import { MARK_TAGS } from "./economy-families.js";

/**
 * Wave-10 set-up restriction: the families a set-up's placement and its objective or designation
 * limits need. Each extension checks only its own additions and hands the rest of a leaf to the
 * previous version (family-extensions.ts). `deployment-window` is a new condition family.
 */

const DESIGNATION_PATTERN = "^[a-z0-9][a-z0-9-]*[a-z0-9]$";
const OBJECTIVE_CONTROLLERS = ["any", "you", "opponent"] as const;
const SELECTED_OBJECTIVE = "selected-objective";
/** Designations the set-up records tag an objective marker or a unit with, beyond the earlier apply-mark tags. */
const WIDENED_TAGS = ["corrupted", "warded"] as const;

/** A registered designation id: the registry is checked in normalize, the pattern in the schema. */
function designationId(value: unknown, label: string): string {
  if (typeof value !== "string" || !DESIGNATION_IDS.has(value)) throw new TypeError(`${label} ${JSON.stringify(value)} is not a registered designation.`);
  return value;
}

/**
 * "contains D3 models": the new unit's model count is a dice amount (unit-size, which the add-unit
 * before it folds in). The whole-number form keeps its 1 to 20 bound.
 */
const UNIT_SIZE_DICE: FamilyExtension = {
  family: "unit-size",
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

/**
 * A distance measured to an objective marker (of objective, by its designation and controller),
 * to the enemy deployment zone (beyond only), or to matching units that carry or lack a
 * designation (of_designated, of_not_designated, with of_side).
 */
const UNIT_POSITION_WIDENED: FamilyExtension = {
  family: "unit-position",
  description: "As the previous version, plus of objective (within or beyond an objective marker that carries objective_tag, a registered designation, and is controlled_by any, you or opponent), of enemy-deployment-zone (beyond only), and of_designated / of_not_designated on of matching-unit: units that carry, or do not carry, a registered designation (with of_side).",
  schema: (previous) => withProperties(previous, {
    of: widenedEnum(previous, "of", ["objective", "enemy-deployment-zone"]),
    // Redefined without x-only-when: the kinds it may qualify differ by `of`, so normalize checks them.
    objective_tag: optional({ type: "string", pattern: DESIGNATION_PATTERN }),
    controlled_by: optional({ enum: [...OBJECTIVE_CONTROLLERS] }),
    of_designated: optional({ type: "string", pattern: DESIGNATION_PATTERN, "x-only-when": { of: ["matching-unit"] } }),
    of_not_designated: optional({ type: "string", pattern: DESIGNATION_PATTERN, "x-only-when": { of: ["matching-unit"] } }),
  }),
  normalize: (input, previous) => {
    if (input.of === "objective") return objectiveDistance(input, previous);
    if (input.of === "enemy-deployment-zone") {
      if (input.kind !== "beyond") throw new TypeError("unit-position of enemy-deployment-zone measures a beyond distance (more than N away from it).");
      if (input.objective_tag !== undefined || input.controlled_by !== undefined) throw new TypeError("unit-position.objective_tag and controlled_by describe an objective marker only.");
      return standIn(input, "of", "this-unit", previous);
    }
    if (input.of_designated !== undefined || input.of_not_designated !== undefined) return designatedUnits(input, previous);
    if (input.objective_tag !== undefined && input.objective === undefined) throw new TypeError("unit-position.objective_tag qualifies of objective or objective-range.");
    return previous(input);
  },
};

function objectiveDistance(input: Record<string, unknown>, previous: (rest: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> {
  const { objective_tag: tag, controlled_by: controlled, ...rest } = input;
  if (rest.kind !== "within" && rest.kind !== "beyond") throw new TypeError("unit-position of objective measures a within or beyond distance.");
  if (rest.objective !== undefined) throw new TypeError("unit-position.objective names an objective-range; a distance to an objective names it by objective_tag.");
  if (tag === undefined) throw new TypeError("unit-position of objective needs objective_tag: the designation the marker carries.");
  const designation = designationId(tag, "unit-position.objective_tag");
  if (controlled !== undefined) enumValue(controlled, [...OBJECTIVE_CONTROLLERS], "unit-position.controlled_by");
  const normalized = standIn(rest, "of", "this-unit", previous);
  return { ...normalized, of: "objective", objective_tag: designation, ...(controlled !== undefined ? { controlled_by: controlled } : {}) };
}

function designatedUnits(input: Record<string, unknown>, previous: (rest: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> {
  const { of_designated: designated, of_not_designated: notDesignated, of_side: side, ...rest } = input;
  if (rest.of !== "matching-unit") throw new TypeError("unit-position.of_designated describes of: matching-unit only.");
  if (rest.of_other !== undefined) throw new TypeError("unit-position.of_other is not combined with of_designated.");
  const sideValue = enumValue(side, ["friendly", "enemy"], "unit-position.of_side");
  const designations = {
    ...(designated !== undefined ? { of_designated: designationId(designated, "unit-position.of_designated") } : {}),
    ...(notDesignated !== undefined ? { of_not_designated: designationId(notDesignated, "unit-position.of_not_designated") } : {}),
  };
  if (rest.of_keywords !== undefined) return { ...previous({ ...rest, of_side: sideValue }), ...designations };
  // Without keywords the matching-unit form has no keyword list to check; the distance and its
  // place are checked as a unit-ref ("this-unit") and the units are restored.
  const normalized = standIn({ ...rest, of: "matching-unit" }, "of", "this-unit", previous);
  return { ...normalized, of_side: sideValue, ...designations };
}

/**
 * apply-mark@5: the tag a record selects an objective marker to carry (selected-objective, a
 * marker the record's select leaf binds), and any registered designation as the tag. Both are
 * staged through a value the previous version accepts, then put back.
 */
const APPLY_MARK_OBJECTIVE: FamilyExtension = {
  family: "apply-mark",
  description: "As the previous version, plus subject selected-objective (the objective marker a select leaf of this record bound), and the tags warded and corrupted.",
  schema: (previous) => withProperties(previous, {
    subject: widenedEnum(previous, "subject", [SELECTED_OBJECTIVE]),
    tag: enumOrSourceSchema([...MARK_TAGS, ...WIDENED_TAGS]),
  }),
  normalize: (input, previous) => {
    const objective = input.subject === SELECTED_OBJECTIVE;
    const widenedTag = typeof input.tag === "string" && (WIDENED_TAGS as readonly string[]).includes(input.tag) && !MARK_TAGS.includes(input.tag);
    if (!objective && !widenedTag) return previous(input);
    const tag = widenedTag ? designationId(input.tag, "apply-mark.tag") : undefined;
    const staged: Record<string, unknown> = { ...input };
    if (objective) staged.subject = "selected-unit";
    if (tag !== undefined) staged.tag = MARK_TAGS[0];
    const normalized = previous(staged);
    return { ...normalized, ...(objective ? { subject: SELECTED_OBJECTIVE } : {}), ...(tag !== undefined ? { tag } : {}) };
  },
};

export const FAMILY_EXTENSIONS_16_SET_UP_RESTRICTION: readonly FamilyExtension[] = [UNIT_SIZE_DICE, ADD_UNIT_MODELS, UNIT_POSITION_WIDENED, APPLY_MARK_OBJECTIVE];

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
