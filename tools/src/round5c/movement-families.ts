import type { SemanticFamilyDefinition } from "./contracts.js";
import {
  boundedInteger, booleanValue, enumOrSource, enumOrSourceSchema, enumSet, enumValue, sourceQualifiedSchema, type SourceQualifiedValue,
} from "./family-validation.js";

/**
 * Movement and placement: a unit making a move, a move's own rules changing (moving through
 * terrain or models, no vertical distance), setting a unit up on the battlefield or into
 * Strategic Reserves, battlefield markers, and how models count against a Transport's capacity.
 */

/** Who a movement effect changes; a Leader attachment does not fold these into the unit the way
 * buff subjects do, since a move is made by a physical body, so the family's own value is kept. */
export const MOVE_SUBJECTS = ["this-unit", "this-model", "selected-unit"] as const;
const MOVE_ACTOR_SUBJECTS = ["this-unit", "this-model"] as const;

export const MOVE_TYPES = [
  "normal", "advance", "fall-back", "charge", "pile-in", "consolidation", "surge", "scout", "ingress", "disembark", "embark", "pulse-jet",
] as const;
const MOVE_SUBSET = ["normal", "advance", "fall-back", "charge"] as const;
const PASSTHROUGH_ITEMS = ["models", "all-terrain", "tall-terrain", "terrain-le-4", "non-titanic-models"] as const;
const SETUP_TO = ["battlefield", "strategic-reserves"] as const;
const SETUP_FROM = ["strategic-reserves", "transport", "battlefield"] as const;
const MARKER_OPERATIONS = ["place", "relocate"] as const;
const TRANSPORT_SUBJECT_KINDS = ["unit-models", "single-model"] as const;
const TRANSPORT_SHAPES = ["grouped-models", "fixed-model-spaces", "equivalent-model", "capacity"] as const;
/** The three occupancy shapes, as distinct from the Transport's own "capacity" shape. */
const TRANSPORT_OCCUPANCY_SHAPES = ["grouped-models", "fixed-model-spaces", "equivalent-model"] as const;
const TRANSPORT_ELIGIBILITY_KINDS = ["requires-capacity-keyword", "embark-as-keyword"] as const;
const EQUIVALENT_BY = ["keyword", "count"] as const;
const ROUNDING = ["up", "down"] as const;

const DICE_PATTERN = "^(\\d*D(3|6)(\\+\\d+)?|\\d+)$";
/** The dice-expression branch samples a few representative values for the leaf form and audit; the
 * normalize function still accepts the full dice-expression pattern, not only these three. */
const distanceSchema = { anyOf: [{ type: "integer", minimum: 0 }, { enum: ["D3", "D6", "2D6"] }, sourceQualifiedSchema] };

/** A move or set-up distance: a non-negative integer, a dice expression, or an exact source snippet. */
function distanceValue(value: unknown, label: string): number | string | SourceQualifiedValue {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && new RegExp(DICE_PATTERN, "u").test(value)) return value;
  if (value !== null && typeof value === "object" && "source" in value && typeof (value as { source: unknown }).source === "string") {
    const source = (value as { source: string }).source;
    if (source && source === source.trim()) return { source };
  }
  throw new TypeError(`${label} must be a non-negative integer, a dice expression, or an exact source snippet.`);
}

function keySet(input: Record<string, unknown>, required: readonly string[], optional: readonly string[], family: string): void {
  const keys = Object.keys(input);
  const allowed = new Set([...required, ...optional]);
  for (const key of keys) if (!allowed.has(key)) throw new TypeError(`${family} parameters must be one of: ${[...allowed].join(", ")}.`);
  for (const key of required) if (!(key in input)) throw new TypeError(`${family} parameters must include ${key}.`);
}

export const MOVEMENT_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "make-move",
    version: 1,
    role: "EFFECT",
    label: "Make a move",
    description: "The target makes a named kind of move: normal, Advance, Fall Back, charge, Pile In, Consolidation, Surge, Scout, ingress, disembark, embark, or Pulse Jet. distance and ends_within_inches are optional.",
    starter: { subject: "this-unit", move_type: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "move_type"],
      properties: {
        subject: enumOrSourceSchema(MOVE_SUBJECTS),
        move_type: enumOrSourceSchema(MOVE_TYPES),
        distance: distanceSchema,
        ends_within_inches: { type: "integer", minimum: 1, maximum: 48 },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "make-move",
    version: 2,
    role: "EFFECT",
    label: "Make a move",
    description: "As version 1, plus an optional counts_as_move: for rules that check what the unit did this turn, the move counts as a different named kind of move (or as Remaining Stationary).",
    starter: { subject: "this-unit", move_type: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "move_type"],
      properties: {
        subject: enumOrSourceSchema(MOVE_SUBJECTS),
        move_type: enumOrSourceSchema(MOVE_TYPES),
        distance: distanceSchema,
        ends_within_inches: { type: "integer", minimum: 1, maximum: 48 },
        counts_as_move: { enum: [...MOVE_TYPES, "remain-stationary"] },
      },
      additionalProperties: false,
    },
  },
  {
    id: "move-through",
    version: 1,
    role: "EFFECT",
    label: "Move through terrain or models",
    description: "The target's moves treat models or a kind of terrain feature as though they were not there; applies_to_moves and ignore_vertical are optional.",
    starter: { subject: "this-unit", passthrough: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "passthrough"],
      properties: {
        subject: enumOrSourceSchema(MOVE_ACTOR_SUBJECTS),
        passthrough: enumOrSourceSchema(PASSTHROUGH_ITEMS),
        applies_to_moves: { type: "array", items: { enum: MOVE_SUBSET }, minItems: 1, uniqueItems: true },
        ignore_vertical: { const: true },
      },
      additionalProperties: false,
    },
  },
  {
    id: "set-up",
    version: 1,
    role: "EFFECT",
    label: "Set up",
    description: "Set the target up on the battlefield or into Strategic Reserves; from, min_enemy_distance, within_edge and round_offset are optional.",
    starter: { subject: "this-unit", to: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "to"],
      properties: {
        subject: enumOrSourceSchema(MOVE_SUBJECTS),
        to: enumOrSourceSchema(SETUP_TO),
        from: enumOrSourceSchema(SETUP_FROM),
        min_enemy_distance: { type: "integer", minimum: 0 },
        within_edge: { type: "integer", minimum: 0 },
        round_offset: { type: "integer" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "battlefield-marker",
    version: 1,
    role: "EFFECT",
    label: "Place or relocate a marker",
    description: "Place a named marker, or relocate it up to a distance; operation and distance are optional.",
    starter: { subject: "this-unit", label: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "label"],
      properties: {
        subject: enumOrSourceSchema(MOVE_ACTOR_SUBJECTS),
        // The enum branch is only a sample for the leaf form and audit; any nonblank label id normalizes.
        label: { anyOf: [{ enum: ["cult-ambush-marker", "beacon-marker"] }, { type: "string", minLength: 1 }] },
        operation: { enum: MARKER_OPERATIONS },
        distance: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    id: "transport-capacity",
    version: 1,
    role: "EFFECT",
    label: "Transport capacity occupancy",
    description:
      "How models count against this Transport's capacity, in one of four shapes: grouped-models (models_per_group " +
      "occupy spaces_per_group, rounded up or down), fixed-model-spaces (each model occupies spaces_per_model), " +
      "equivalent-model (each model counts as another kind of model, named by transport_eligibility_kind/" +
      "transport_eligibility_keyword and equivalent_by/equivalent_model_keyword/equivalent_model_count), or " +
      "capacity (this model's own Transport capacity, and which units are eligible to embark). model_keyword and " +
      "the eligibility pair are optional on the first three shapes.",
    starter: { shape: "" },
    parameterSchema: {
      type: "object",
      required: ["shape"],
      properties: {
        shape: { enum: TRANSPORT_SHAPES },
        subject_kind: { enum: TRANSPORT_SUBJECT_KINDS, "x-only-when": { shape: TRANSPORT_OCCUPANCY_SHAPES } },
        model_keyword: { anyOf: [{ enum: ["Gunner"] }, { type: "string", minLength: 1 }], "x-only-when": { shape: TRANSPORT_OCCUPANCY_SHAPES } },
        // A Transport's own eligibility to carry (requires_capacity_keyword) or a unit's own eligibility to
        // embark (embark_as_keyword) share one kind+keyword pair, so the audit never has to attach both at once.
        transport_eligibility_kind: { enum: TRANSPORT_ELIGIBILITY_KINDS, "x-only-when": { shape: TRANSPORT_OCCUPANCY_SHAPES } },
        transport_eligibility_keyword: { anyOf: [{ enum: ["Firestorm Ridgerunner"] }, { type: "string", minLength: 1 }], "x-only-when": { shape: TRANSPORT_OCCUPANCY_SHAPES } },
        models_per_group: { type: "integer", minimum: 1, "x-only-when": { shape: ["grouped-models"] } },
        spaces_per_group: { type: "integer", minimum: 1, "x-only-when": { shape: ["grouped-models"] } },
        rounding: { enum: ROUNDING, "x-only-when": { shape: ["grouped-models"] } },
        spaces_per_model: { type: "integer", minimum: 1, "x-only-when": { shape: ["fixed-model-spaces"] } },
        // Which of equivalent_model_keyword/equivalent_model_count applies; the two never co-occur.
        equivalent_by: { enum: EQUIVALENT_BY, "x-only-when": { shape: ["equivalent-model"] } },
        equivalent_model_keyword: { anyOf: [{ enum: ["Ork Boy"] }, { type: "string", minLength: 1 }], "x-only-when": { shape: ["equivalent-model"], equivalent_by: ["keyword"] } },
        equivalent_model_count: { type: "integer", minimum: 1, "x-only-when": { shape: ["equivalent-model"], equivalent_by: ["count"] } },
        capacity: { type: "integer", minimum: 1, "x-only-when": { shape: ["capacity"] } },
        capacity_keywords: {
          type: "array", items: { anyOf: [{ enum: ["CHARACTER"] }, { type: "string", minLength: 1 }] }, minItems: 1, uniqueItems: true,
          "x-only-when": { shape: ["capacity"] },
        },
      },
      additionalProperties: false,
    },
  },
  {
    id: "move-distance",
    version: 1,
    role: "EFFECT",
    label: "Moves go further",
    description: "\"Each time a model in your unit makes a Pile-in or Consolidation move, it can move up to 6\\\" instead of up to 3\\\"\": the named kinds of move go `bonus` inches further than normal (3 here).",
    starter: { subject: "this-unit", move_types: [], bonus: null },
    parameterSchema: {
      type: "object",
      required: ["subject", "move_types", "bonus"],
      properties: {
        subject: { enum: ["this-unit", "this-model"] },
        move_types: { type: "array", items: { enum: MOVE_TYPES }, minItems: 1, uniqueItems: true },
        bonus: { type: "integer", minimum: 1, maximum: 24 },
      },
      additionalProperties: false,
    },
  },
  {
    id: "reserves-arrival",
    version: 1,
    role: "RESTRICTION",
    label: "Arrives from reserves next Movement phase",
    description: "\"This unit can make an ingress move in your next Movement phase (including in your first turn)\": the unit set up into Strategic Reserves just before it returns in your next Movement phase; allow_first_round when that can be the first battle round.",
    starter: { allow_first_round: false },
    parameterSchema: {
      type: "object",
      required: ["allow_first_round"],
      properties: { allow_first_round: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    id: "move-must-end",
    version: 1,
    role: "RESTRICTION",
    label: "Where a move must end",
    description: "\"Your unit must end that move either wholly within your deployment zone or within range of an objective marker\": the conditions that follow it in the same sentence say where the unit must be when the move before it ends. match is any for \"either … or\", all when every condition must hold.",
    starter: { match: "" },
    parameterSchema: {
      type: "object",
      required: ["match"],
      properties: { match: { enum: ["any", "all"] } },
      additionalProperties: false,
    },
  },
];

export function normalizeMovementParameters(family: string, input: Record<string, unknown>, version = 1): Record<string, unknown> | null {
  switch (family) {
    case "move-distance": {
      const keys = Object.keys(input).sort().join();
      if (keys !== "bonus,move_types,subject") throw new TypeError("move-distance parameters must be exactly: subject, move_types, bonus.");
      return {
        subject: enumValue(input.subject, ["this-unit", "this-model"], "move-distance.subject"),
        move_types: enumSet(input.move_types, MOVE_TYPES, "move-distance.move_types"),
        bonus: boundedInteger(input.bonus, 1, 24, "move-distance.bonus"),
      };
    }
    case "reserves-arrival": {
      if (Object.keys(input).join() !== "allow_first_round" || typeof input.allow_first_round !== "boolean") throw new TypeError("reserves-arrival parameters must be exactly: allow_first_round (true or false).");
      return { allow_first_round: input.allow_first_round };
    }
    case "move-must-end": {
      const keys = Object.keys(input);
      if (keys.length !== 1 || keys[0] !== "match") throw new TypeError("move-must-end parameters must be exactly: match.");
      return { match: enumValue(input.match, ["any", "all"], "move-must-end.match") };
    }
    case "make-move": {
      const optional = version >= 2 ? ["distance", "ends_within_inches", "counts_as_move"] : ["distance", "ends_within_inches"];
      keySet(input, ["subject", "move_type"], optional, family);
      const result: Record<string, unknown> = {
        subject: enumOrSource(input.subject, MOVE_SUBJECTS, "make-move.subject"),
        move_type: enumOrSource(input.move_type, MOVE_TYPES, "make-move.move_type"),
      };
      if (input.distance !== undefined) result.distance = distanceValue(input.distance, "make-move.distance");
      if (input.ends_within_inches !== undefined) result.ends_within_inches = boundedInteger(input.ends_within_inches, 1, 48, "make-move.ends_within_inches");
      if (version >= 2 && input.counts_as_move !== undefined) {
        result.counts_as_move = enumValue(input.counts_as_move, [...MOVE_TYPES, "remain-stationary"], "make-move.counts_as_move");
      }
      return result;
    }
    case "move-through": {
      keySet(input, ["subject", "passthrough"], ["applies_to_moves", "ignore_vertical"], family);
      const result: Record<string, unknown> = {
        subject: enumOrSource(input.subject, MOVE_ACTOR_SUBJECTS, "move-through.subject"),
        passthrough: enumOrSource(input.passthrough, PASSTHROUGH_ITEMS, "move-through.passthrough"),
      };
      if (input.applies_to_moves !== undefined) result.applies_to_moves = enumSet(input.applies_to_moves, MOVE_SUBSET, "move-through.applies_to_moves");
      if (input.ignore_vertical !== undefined) {
        if (booleanValue(input.ignore_vertical, "move-through.ignore_vertical") !== true) throw new TypeError("move-through.ignore_vertical must be true, or omitted.");
        result.ignore_vertical = true;
      }
      return result;
    }
    case "set-up": {
      keySet(input, ["subject", "to"], ["from", "min_enemy_distance", "within_edge", "round_offset"], family);
      const result: Record<string, unknown> = {
        subject: enumOrSource(input.subject, MOVE_SUBJECTS, "set-up.subject"),
        to: enumOrSource(input.to, SETUP_TO, "set-up.to"),
      };
      if (input.from !== undefined) result.from = enumOrSource(input.from, SETUP_FROM, "set-up.from");
      if (input.min_enemy_distance !== undefined) result.min_enemy_distance = numberValue(input.min_enemy_distance, "set-up.min_enemy_distance");
      if (input.within_edge !== undefined) result.within_edge = numberValue(input.within_edge, "set-up.within_edge");
      if (input.round_offset !== undefined) result.round_offset = integerValue(input.round_offset, "set-up.round_offset");
      return result;
    }
    case "battlefield-marker": {
      keySet(input, ["subject", "label"], ["operation", "distance"], family);
      const label = input.label;
      if (typeof label !== "string" || label.trim().length === 0) throw new TypeError("battlefield-marker.label must be a nonblank string.");
      const result: Record<string, unknown> = { subject: enumOrSource(input.subject, MOVE_ACTOR_SUBJECTS, "battlefield-marker.subject"), label };
      if (input.operation !== undefined) result.operation = enumValue(input.operation, MARKER_OPERATIONS, "battlefield-marker.operation");
      if (input.distance !== undefined) result.distance = numberValue(input.distance, "battlefield-marker.distance");
      return result;
    }
    case "transport-capacity": {
      const shape = enumValue(input.shape, TRANSPORT_SHAPES, "transport-capacity.shape");
      if (shape === "capacity") {
        keySet(input, ["shape", "capacity"], ["capacity_keywords"], family);
        const result: Record<string, unknown> = { shape, capacity: boundedInteger(input.capacity, 1, 26, "transport-capacity.capacity") };
        if (input.capacity_keywords !== undefined) result.capacity_keywords = stringArray(input.capacity_keywords, "transport-capacity.capacity_keywords");
        return result;
      }
      // The three occupancy shapes share subject_kind, an optional model_keyword, and an optional
      // eligibility_kind+eligibility_keyword pair — given together or not at all, never one alone.
      const eligibilityOptional = ["model_keyword", "transport_eligibility_kind", "transport_eligibility_keyword"];
      const shared = () => {
        const result: Record<string, unknown> = { shape, subject_kind: enumValue(input.subject_kind, TRANSPORT_SUBJECT_KINDS, "transport-capacity.subject_kind") };
        if (input.model_keyword !== undefined) result.model_keyword = nonblankString(input.model_keyword, "transport-capacity.model_keyword");
        const hasKind = input.transport_eligibility_kind !== undefined;
        const hasKeyword = input.transport_eligibility_keyword !== undefined;
        if (hasKind !== hasKeyword) throw new TypeError("transport-capacity: transport_eligibility_kind and transport_eligibility_keyword must be given together.");
        if (hasKind) {
          const kind = enumValue(input.transport_eligibility_kind, TRANSPORT_ELIGIBILITY_KINDS, "transport-capacity.transport_eligibility_kind");
          const keyword = nonblankString(input.transport_eligibility_keyword, "transport-capacity.transport_eligibility_keyword");
          result.transport_eligibility_kind = kind;
          result.transport_eligibility_keyword = keyword;
        }
        return result;
      };
      if (shape === "grouped-models") {
        keySet(input, ["shape", "subject_kind", "models_per_group", "spaces_per_group", "rounding"], eligibilityOptional, family);
        const result = shared();
        result.models_per_group = boundedInteger(input.models_per_group, 1, 50, "transport-capacity.models_per_group");
        result.spaces_per_group = boundedInteger(input.spaces_per_group, 1, 50, "transport-capacity.spaces_per_group");
        result.rounding = enumValue(input.rounding, ROUNDING, "transport-capacity.rounding");
        if (result.subject_kind === "single-model" && result.models_per_group !== 1) {
          throw new TypeError("transport-capacity.models_per_group must be 1 when subject_kind is single-model.");
        }
        return result;
      }
      if (shape === "fixed-model-spaces") {
        keySet(input, ["shape", "subject_kind", "spaces_per_model"], eligibilityOptional, family);
        const result = shared();
        result.spaces_per_model = boundedInteger(input.spaces_per_model, 1, 50, "transport-capacity.spaces_per_model");
        return result;
      }
      // equivalent-model: equivalent_by says which of equivalent_model_keyword/equivalent_model_count applies.
      keySet(input, ["shape", "subject_kind", "equivalent_by"], [...eligibilityOptional, "equivalent_model_keyword", "equivalent_model_count"], family);
      const result = shared();
      const by = enumValue(input.equivalent_by, EQUIVALENT_BY, "transport-capacity.equivalent_by");
      result.equivalent_by = by;
      if (by === "keyword") {
        if (input.equivalent_model_keyword === undefined || input.equivalent_model_count !== undefined) {
          throw new TypeError("transport-capacity: equivalent_by keyword needs equivalent_model_keyword only.");
        }
        result.equivalent_model_keyword = nonblankString(input.equivalent_model_keyword, "transport-capacity.equivalent_model_keyword");
      } else {
        if (input.equivalent_model_count === undefined || input.equivalent_model_keyword !== undefined) {
          throw new TypeError("transport-capacity: equivalent_by count needs equivalent_model_count only.");
        }
        result.equivalent_model_count = boundedInteger(input.equivalent_model_count, 1, 20, "transport-capacity.equivalent_model_count");
      }
      return result;
    }
    default:
      return null;
  }
}

function nonblankString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value;
  throw new TypeError(`${label} must be a nonblank string.`);
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a nonempty list of strings.`);
  return value.map((item) => nonblankString(item, label));
}

function numberValue(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`${label} must be a non-negative integer.`);
}

function integerValue(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new TypeError(`${label} must be an integer.`);
}
