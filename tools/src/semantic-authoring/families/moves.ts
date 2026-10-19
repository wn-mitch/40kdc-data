import { ANTECEDENT } from "../antecedent-families.js";
import type { SemanticFamilyDefinition } from "../contracts.js";
import { DICE, EVENT_SUBJECT, type FamilyExtension, KEYWORD_ITEMS, keywordList, optional, properties, type Schema, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { enumSet, enumValue, exactKeys } from "../family-validation.js";
import { MOVE_SUBSET, PASSTHROUGH_ITEMS } from "../movement-families.js";
import { FILTERED_UNITS, PASSTHROUGH_USED_VALUES } from "./shared.js";

/**
 * Versions of the move families (make-move, move-end-nearest, move-must-end, move-through,
 * act-after-move, no-advance-roll), and the counts-as-moved and move-passthrough-used base
 * families. Each version checks only its own additions and hands the rest of a leaf to the previous
 * version, so every earlier leaf still fits it unchanged.
 */

/** act-after-move and no-advance-roll whose unit an earlier leaf introduced ("it", "your **X** unit"). */
function subjectAntecedent(family: string, version: number, example: string): FamilyExtension {
  return {
    family,
    version,
    description: `As the previous version, plus subject antecedent: the unit an earlier leaf introduced (${example}).`,
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [ANTECEDENT]) }),
    normalize: (input, previous) => input.subject === ANTECEDENT ? standIn(input, "subject", "this-unit", previous) : previous(input),
  };
}

const OWNERS = ["friendly", "enemy", "any"] as const;

const TYPED_KEYS = ["kind", "owner", "all_of", "excluding"] as const;

/** The typed models item: `kind` is always models, and the keyword lists are unit keywords. */
const TYPED_MODELS_SCHEMA: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: {
    kind: { const: "models" },
    owner: { enum: [...OWNERS] },
    all_of: { type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true },
    excluding: { type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true },
  },
};

function isTypedItem(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !("source" in value);
}

/**
 * Checks a typed models item and returns it with its keyword lists in canonical form. A typed item
 * of any other kind is refused here, since the typed item does not cover terrain.
 */
function normalizeTypedModels(item: Record<string, unknown>): Record<string, unknown> {
  if (item.kind !== "models") throw new TypeError("move-through.passthrough typed item must have kind models.");
  for (const key of Object.keys(item)) {
    if (!(TYPED_KEYS as readonly string[]).includes(key)) throw new TypeError(`move-through.passthrough item has an unknown key: ${key}.`);
  }
  const result: Record<string, unknown> = { kind: "models" };
  if (item.owner !== undefined) result.owner = enumValue(item.owner, OWNERS, "move-through.passthrough.owner");
  if (item.all_of !== undefined) result.all_of = keywordList(item.all_of, "move-through.passthrough.all_of", 1);
  if (item.excluding !== undefined) result.excluding = keywordList(item.excluding, "move-through.passthrough.excluding", 1);
  return result;
}

/** The objective destinations version 2 adds; following-filter is the version 1 unit destination. */
const OBJECTIVE_TO = ["closest-objective-marker", "selected-objective"] as const;

const TO_VALUES = ["following-filter", ...OBJECTIVE_TO] as const;

/**
 * Two listed passthrough tokens, sorted into canonical order. A typed models item is refused here: a
 * typed item names one owner and keyword set, and a clause with two kinds of thing needs two leaves.
 */
function passthroughPair(value: unknown[]): string[] {
  if (value.length !== 2) throw new TypeError("move-through.passthrough lists exactly two tokens, or names one.");
  const list = value.map((item) => {
    if (typeof item !== "string") throw new TypeError("move-through.passthrough lists tokens only; a typed models item stands alone.");
    return enumValue(item, PASSTHROUGH_ITEMS, "move-through.passthrough");
  });
  if (list[0] === list[1]) throw new TypeError("move-through.passthrough lists a token twice.");
  return [...list].sort();
}

export const MOVE_PASSTHROUGH_USED_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "move-passthrough-used",
    version: 1,
    role: "CONDITION",
    label: "Moved through permitted terrain",
    description: "\"But if it does, after it has moved, …\": the move-ended moment that follows it happened only when the move passed through the named terrain under the move-through before it. It qualifies that moment and gates nothing by itself.",
    starter: { passthrough: "" },
    parameterSchema: {
      type: "object",
      required: ["passthrough"],
      properties: { passthrough: { enum: PASSTHROUGH_USED_VALUES } },
      additionalProperties: false,
    },
  },
];

/** move-passthrough-used@1 parameters: the terrain kind the move passed through. */
export function normalizeMovePassthroughUsedParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "move-passthrough-used") return null;
  exactKeys(input, ["passthrough"], family);
  return { passthrough: enumValue(input.passthrough, PASSTHROUGH_USED_VALUES, "move-passthrough-used.passthrough") };
}

/** The disembark modes the DSL names; the move's modifier carries one as `mode`. */
export const DISEMBARK_MODES = ["rapid", "tactical", "combat", "emergency", "assault"] as const;

/** "Do not make an Advance roll for it" under a move-ended trigger: the unit the event names. */
const NO_ADVANCE_ROLL_EVENT_SUBJECT: FamilyExtension = {
  family: "no-advance-roll",
  version: 4,
  description: `As the previous version, and the subject can be the triggering unit (${EVENT_SUBJECT}), the unit a move-ended event names.`,
  schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EVENT_SUBJECT]) }),
  normalize: (input, previous) => input.subject === EVENT_SUBJECT ? standIn(input, "subject", "this-unit", previous) : previous(input),
};

/**
 * counts-as-moved: a status that makes a unit count as having made a move this turn or phase (a
 * status that makes carried units count as having made a move). It is a modifier that folds into
 * the disembark permission before it (compile-counts-as-moved.ts), so it gates nothing and has no
 * subject: the disembarking units are not a subject the DSL can name for a permission.
 */

/** The move kinds a counts-as-moved status can name. Only "normal" is evidenced; widen by a new version. */
export const COUNTS_AS_MOVED_MOVE_TYPES = ["normal"] as const;

/** The only printed period the status takes: "that phase". Absent means the DSL default applies. */
export const COUNTS_AS_MOVED_WINDOWS = ["phase"] as const;

export const COUNTS_AS_MOVED_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "counts-as-moved",
    version: 1,
    role: "CONDITION",
    label: "Counts as having made a move",
    description: "The units a disembark permission before it allows count as having made a move of that kind this turn (or this phase, when window is phase). It qualifies that permission and gates nothing.",
    starter: { move_type: "" },
    parameterSchema: {
      type: "object",
      required: ["move_type"],
      properties: {
        move_type: { enum: COUNTS_AS_MOVED_MOVE_TYPES },
        window: { enum: COUNTS_AS_MOVED_WINDOWS },
      },
      additionalProperties: false,
    },
  },
];

/** Normalizes counts-as-moved parameters; returns null for any other family. */
export function normalizeCountsAsMovedParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "counts-as-moved") return null;
  if (!("move_type" in input)) throw new TypeError("counts-as-moved.move_type is required.");
  exactKeys(input, ["move_type", ...("window" in input ? ["window"] : [])], family);
  const result: Record<string, unknown> = {
    move_type: enumValue(input.move_type, COUNTS_AS_MOVED_MOVE_TYPES, "counts-as-moved.move_type"),
  };
  if ("window" in input) result.window = enumValue(input.window, COUNTS_AS_MOVED_WINDOWS, "counts-as-moved.window");
  return result;
}

export const MOVE_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "that unit can make a Normal move" after a trigger: the triggering unit moves.
    family: "make-move",
    version: 4,
    description: "As the previous version, and the triggering unit (event-subject) can be the one that moves.",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EVENT_SUBJECT]) }),
    normalize: (input, previous) => input.subject === EVENT_SUBJECT ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
  {
    // "it can make a Normal move of up to D3+3\"".
    family: "make-move",
    version: 5,
    description: "As the previous version, and a distance can be a dice amount plus a number (D3+3, D6+1).",
    schema: (previous) => {
      // One flat list of alternatives, so samplers and readers see each branch.
      const distance = properties(previous).distance!;
      return withProperties(previous, { distance: { anyOf: [...(distance.anyOf as Schema[] ?? [distance]), { type: "string", pattern: DICE.source }] } });
    },
    normalize: (input, previous) => {
      if (typeof input.distance !== "string" || ["D3", "D6", "2D6"].includes(input.distance)) return previous(input);
      const dice = input.distance.trim().toUpperCase();
      if (!DICE.test(dice)) throw new TypeError("make-move.distance is inches, D3, D6, 2D6 or a dice amount plus a number (D3+3).");
      return { ...standIn(input, "distance", "D3", previous), distance: dice };
    },
  },
  {
    // "units embarked within this unit can make an assault disembark move": the filter's units move, in a named mode.
    family: "make-move",
    version: 6,
    description: "As the previous version, plus subject filtered-units (the units a unit-filter names right before the move) and mode: the disembark mode the move uses (rapid, tactical, combat, emergency, assault). Mode needs move_type disembark.",
    schema: (previous) => withProperties(previous, {
      subject: widenedEnum(previous, "subject", [FILTERED_UNITS]),
      mode: optional({ enum: [...DISEMBARK_MODES], "x-only-when": { move_type: ["disembark"] } }),
    }),
    normalize: (input, previous) => {
      const { mode, ...rest } = input;
      if (mode !== undefined) {
        if (rest.move_type !== "disembark") throw new TypeError("make-move.mode names a disembark mode, so it needs move_type disembark.");
        if (!(DISEMBARK_MODES as readonly unknown[]).includes(mode)) throw new TypeError(`make-move.mode is one of ${DISEMBARK_MODES.join(", ")}, not ${JSON.stringify(mode)}.`);
      }
      const normalized = rest.subject === FILTERED_UNITS ? standIn(rest, "subject", "this-unit", previous) : previous(rest);
      return mode === undefined ? normalized : { ...normalized, mode };
    },
  },
  /**
   * Version 2: the destination can be an objective marker (any one, or the one a select-objective
   * bound), per unit or per model, and instead_of names the closest enemy unit the move need not
   * end closer to.
   */
  {
    // "must end that move as close as possible to the closest objective marker"
    family: "move-end-nearest",
    version: 2,
    description: "As the previous version, and to may be closest-objective-marker (any objective marker) or selected-objective (the objective a select-objective bound). per (unit or model) applies to an objective destination only. instead_of closest-enemy-unit names the enemy unit the move is not required to end closer to, with any destination.",
    schema: (previous) => withProperties(previous, {
      to: widenedEnum(previous, "to", [...OBJECTIVE_TO]),
      per: optional({ enum: ["unit", "model"], "x-only-when": { to: [...OBJECTIVE_TO] } }),
      instead_of: optional({ const: "closest-enemy-unit" }),
    }),
    normalize: (input) => {
      const allowed = ["to", "per", "instead_of"];
      for (const key of Object.keys(input)) {
        if (!allowed.includes(key)) throw new TypeError(`move-end-nearest.${key} is not a parameter of version 2.`);
      }
      const to = enumValue(input.to, TO_VALUES, "move-end-nearest.to");
      const result: Record<string, unknown> = { to };
      if (input.per !== undefined) {
        if (to === "following-filter") throw new TypeError("move-end-nearest.per applies only to an objective destination.");
        result.per = enumValue(input.per, ["unit", "model"], "move-end-nearest.per");
      }
      if (input.instead_of !== undefined) {
        if (input.instead_of !== "closest-enemy-unit") throw new TypeError("move-end-nearest.instead_of must be closest-enemy-unit.");
        result.instead_of = "closest-enemy-unit";
      }
      return result;
    },
  },
  /**
   * Version 3: the destination can be the enemy unit the trigger names (to: event-subject), "as
   * close as possible to that enemy unit". The unit comes from the event, not from a unit-filter
   * after the leaf, and the end takes no per-model form and no instead_of.
   */
  {
    // "must end that move as close as possible to that enemy unit" (the unit the trigger names).
    family: "move-end-nearest",
    version: 3,
    description: "As the previous version, and to: event-subject ends the move as close as possible to the enemy unit the trigger names. It takes no per and no instead_of.",
    schema: (previous) => withProperties(previous, { to: widenedEnum(previous, "to", [EVENT_SUBJECT]) }),
    normalize: (input, previous) => {
      if (input.to !== EVENT_SUBJECT) return previous(input);
      if (input.per !== undefined) throw new TypeError("move-end-nearest.per applies to an objective destination; a move-end nearest the enemy unit names no per-model form.");
      if (input.instead_of !== undefined) throw new TypeError("move-end-nearest.instead_of has no form with a move-end to the enemy unit the trigger names.");
      for (const key of Object.keys(input)) {
        if (key !== "to") throw new TypeError(`move-end-nearest.${key} is not a parameter of version 3 with to: event-subject.`);
      }
      return { to: EVENT_SUBJECT };
    },
  },
  {
    // "but cannot end that move within Engagement Range of them".
    family: "move-must-end",
    version: 2,
    description: "As the previous version, plus polarity: must (the default) says where the move must end; cannot says where it must not end (\"cannot end that move within Engagement Range of them\"), so the conditions after it are negated together.",
    schema: (previous) => withProperties(previous, { polarity: optional({ enum: ["must", "cannot"] }) }),
    normalize: (input, previous) => {
      if (input.polarity === undefined) return previous(input);
      const { polarity, ...rest } = input;
      const value = enumValue(polarity, ["must", "cannot"], "move-must-end.polarity");
      return value === "must" ? previous(rest) : { ...previous(rest), polarity: "cannot" };
    },
  },
  /**
   * move_types: the restriction covers only the listed kinds of move, as in "unless it made a
   * Charge move, cannot end that move within Engagement Range of them". Absent, the restriction
   * covers every move its trigger names.
   */
  {
    family: "move-must-end",
    version: 3,
    description: "As the previous version, plus move_types: the restriction covers only the listed move kinds (\"cannot end a Normal or Advance move within Engagement Range of them\"). Absent, it covers every move the trigger names.",
    schema: (previous) => withProperties(previous, {
      move_types: optional({ type: "array", items: { enum: [...MOVE_SUBSET] }, minItems: 1, uniqueItems: true }),
    }),
    normalize: (input, previous) => {
      if (input.move_types === undefined) return previous(input);
      const { move_types: moveTypes, ...rest } = input;
      return { ...previous(rest), move_types: enumSet(moveTypes, MOVE_SUBSET, "move-must-end.move_types") };
    },
  },
  /**
   * Version 4: a cannot-end restriction can replace the usual end threshold. Its move kinds come
   * from the trigger, not the leaf (move_types stays restricted to MOVE_SUBSET in version 3).
   */
  {
    // "can end that move more than 6\" horizontally from all enemy units (instead of more than 8\")"
    family: "move-must-end",
    version: 4,
    description: "As the previous version, plus replaces: true, for a cannot restriction that replaces the usual end threshold (\"instead of more than 8\\\"\"). Its move kinds come from the trigger. Absent, the restriction adds to the usual rules.",
    schema: (previous) => withProperties(previous, {
      replaces: optional({ const: true, "x-only-when": { polarity: ["cannot"] } }),
    }),
    normalize: (input, previous) => {
      if (input.replaces === undefined) return previous(input);
      if (input.replaces !== true) throw new TypeError("move-must-end.replaces must be true, or omitted.");
      if (input.polarity !== "cannot") throw new TypeError("move-must-end.replaces applies only to polarity cannot.");
      const { replaces: _replaces, ...rest } = input;
      return { ...previous(rest), replaces: true };
    },
  },
  /**
   * A typed models item in place of a free token. The item names whose models a move may pass
   * (friendly, enemy or any owner), which keywords they must have, and which keywords exclude a
   * model from the set. Version 1's string tokens keep their meaning.
   */
  {
    family: "move-through",
    version: 3,
    description: "As the previous version, and passthrough can be a typed models item: models of an owner (friendly, enemy or any) with every all_of keyword, excluding models with any excluding keyword.",
    schema: (previous) => withProperties(previous, {
      passthrough: { anyOf: [properties(previous).passthrough!, TYPED_MODELS_SCHEMA] },
    }),
    normalize: (input, previous) => {
      if (!isTypedItem(input.passthrough)) return previous(input);
      const typed = normalizeTypedModels(input.passthrough);
      // The previous version checks every other key with a token it accepts standing in for the item.
      return { ...previous({ ...input, passthrough: "models" }), passthrough: typed };
    },
  },
  /**
   * A move-through that passes two listed kinds of model or terrain in one clause ("models and
   * terrain features").
   */
  {
    family: "move-through",
    version: 4,
    description: `As the previous version, plus subject event-subject (the unit a move-ended event names) and passthrough as a list of two listed tokens (${PASSTHROUGH_ITEMS.join(", ")}).`,
    schema: (previous) => withProperties(previous, {
      subject: widenedEnum(previous, "subject", [EVENT_SUBJECT]),
      passthrough: {
        anyOf: [
          properties(previous).passthrough!,
          { type: "array", items: { enum: [...PASSTHROUGH_ITEMS] }, minItems: 2, maxItems: 2, uniqueItems: true },
        ],
      },
    }),
    normalize: (input, previous) => {
      const event = input.subject === EVENT_SUBJECT;
      // The previous version checks the leaf with this unit standing in for the triggering unit.
      const staged = event ? { ...input, subject: "this-unit" } : input;
      const restore = (result: Record<string, unknown>) => event ? { ...result, subject: EVENT_SUBJECT } : result;
      if (!Array.isArray(input.passthrough)) return restore(previous(staged));
      const pair = passthroughPair(input.passthrough);
      // A token stands in for the list while the previous version checks the other keys; the list replaces it.
      return restore({ ...previous({ ...staged, passthrough: "models" }), passthrough: pair });
    },
  },
  subjectAntecedent("act-after-move", 3, "\"your **VEHICLE** unit\" + \"is eligible to shoot and declare a charge in a turn in which it Fell Back\""),
  subjectAntecedent("no-advance-roll", 3, "\"do not make an Advance roll for it\""),
 NO_ADVANCE_ROLL_EVENT_SUBJECT,
  /**
   * An explicit movement-distance override: "that Advance has no maximum distance". This is
   * deliberately a move modifier, not a make-move action, so it changes the selected Advance
   * while leaving independent move-through and move-end restrictions in the same clause intact.
   * The canonical effect carries `maximum: "unlimited"`; no numeric distance is invented.
   */
  {
    family: "move-distance",
    version: 2,
    description: "As version 1, plus maximum: unlimited for the explicitly named Advance move; this changes the selected move's distance ceiling without creating another move.",
    schema: (previous) => {
      const withoutBonusRequired = { ...previous, required: ((previous.required as string[] | undefined) ?? []).filter((key) => key !== "bonus") };
      const schema = withProperties(withoutBonusRequired, {
        bonus: optional(properties(previous).bonus!),
        maximum: { const: "unlimited", "x-only-when": { move_types: ["advance"] } },
      });
      return { ...schema, anyOf: [{ required: ["bonus"] }, { required: ["maximum"] }], not: { required: ["bonus", "maximum"] } };
    },
    normalize: (input, previous) => {
      if (input.maximum === undefined) return previous(input);
      if (input.maximum !== "unlimited") throw new TypeError("move-distance.maximum must be unlimited.");
      if (input.bonus !== undefined) throw new TypeError("move-distance.maximum and bonus are mutually exclusive.");
      if (!Array.isArray(input.move_types) || input.move_types.length !== 1 || input.move_types[0] !== "advance") {
        throw new TypeError("move-distance.maximum unlimited applies only to exactly one advance move.");
      }
      const { maximum: _maximum, ...rest } = input;
      const normalized = previous({ ...rest, bonus: 1 });
      const { bonus: _bonus, ...result } = normalized;
      return { ...result, maximum: "unlimited" };
    },
  },
];
