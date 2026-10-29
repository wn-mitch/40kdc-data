import { ENTITY_ID } from "../buff-families.js";
import { type FamilyExtension, KEYWORD_ITEMS, keywordList, optional, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { boundedInteger, enumValue } from "../family-validation.js";
import { BEARER_TRANSPORT, printedKeywordsExtension } from "./shared.js";

/**
 * Versions of the selection and counting families: select-unit, for-each-unit-select,
 * stratagem-target, triggering-target, select-weapon and count-scale. Each version checks only its
 * own additions and hands the rest of a leaf to the previous version, so every earlier leaf still
 * fits it unchanged.
 */

const EXACT_COUNT: FamilyExtension = {
  // "Two **SKITARII** units from your army".
  family: "stratagem-target",
  version: 4,
  description: "As the previous version, plus count exactly with count_exact (2-10): exactly that many units, each meeting the same restrictions (\"Two **X** units\").",
  schema: (previous) => withProperties(previous, {
    count: widenedEnum(previous, "count", ["exactly"]),
    count_exact: { type: "integer", minimum: 2, maximum: 10, "x-only-when": { count: ["exactly"] } },
  }),
  normalize: (input, previous) => {
    if (input.count !== "exactly") {
      if ("count_exact" in input) throw new TypeError("stratagem-target.count_exact needs count exactly.");
      return previous(input);
    }
    const { count_exact: exact, ...rest } = input;
    const normalized = previous({ ...rest, count: "one" });
    return { ...normalized, count: "exactly", count_exact: boundedInteger(exact, 2, 10, "stratagem-target.count_exact") };
  },
};

/** A selection name: the bind_as of an earlier selection, or the name one selection binds. */
const SELECTION_NAME = { type: "string", pattern: "^[a-z][a-z0-9_-]*$", minLength: 1, maxLength: 40 };

export function selectionName(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]*$/.test(value) || value.length > 40) throw new TypeError(`${field} is a lowercase selection name.`);
  return value;
}

/** A printed weapon name, trimmed and lowercased as the DSL carries weapon names. */
function weaponName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label}.weapon_name is the weapon's name as its datasheet prints it.`);
  return value.trim().toLowerCase();
}

const SELECT_UNIT_WITHIN_ORIGIN: FamilyExtension = {
  // A selection whose distance is measured from the Transport the bearer is embarked within.
  family: "select-unit",
  version: 5,
  description: "As the previous version, plus within_origin bearer-transport: a distance (distance within) is measured from the Transport the bearer is embarked within, not from the bearer. Needs inches; not with within_of.",
  schema: (previous) => withProperties(previous, {
    within_origin: optional({ enum: [BEARER_TRANSPORT], "x-only-when": { distance: ["within"] } }),
  }),
  normalize: (input, previous) => {
    if (!("within_origin" in input)) return previous(input);
    const { within_origin: origin, ...rest } = input;
    if (origin !== BEARER_TRANSPORT) throw new TypeError(`select-unit.within_origin is bearer-transport, not ${String(origin)}.`);
    if (rest.distance !== "within") throw new TypeError("select-unit.within_origin measures a distance, so it needs distance within.");
    if (rest.inches === undefined) throw new TypeError("select-unit.within_origin needs inches.");
    if (rest.within_of !== undefined) throw new TypeError("select-unit.within_origin and within_of name two origins; give one.");
    return { ...previous(rest), within_origin: BEARER_TRANSPORT };
  },
};

/**
 * Per-unit-count timing (count-scale@2): a count-scale can say when its count is taken. A count in a rule
 * that starts at a moment and lasts is taken once, when the rule applies, and fixed for its
 * duration ("At the start of the Fight phase, until the end of the phase, +2 A for every 5 enemy
 * models within 6\""). Absent or "live" is the previous meaning, so a live leaf keeps its shape.
 * The compiler checks the on-apply rules (compile-count-scale.ts); this version checks only the
 * timing key and what it can combine with.
 */
export const TIMINGS = ["live", "on-apply"] as const;

/** The counts a count-scale takes beside the previous two. */
const MODELS_EQUIPPED_WITH = "models-equipped-with";

export const SELECTION_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "select up to two **K** units from your army", "select three enemy units".
    family: "select-unit",
    version: 3,
    description: "As the previous version, plus count: how many units are selected, exactly or (up_to) at most that many. Without count, one unit.",
    schema: (previous) => withProperties(previous, {
      count: optional({ type: "integer", minimum: 1, maximum: 10 }),
      up_to: optional({ const: true }),
    }),
    normalize: (input, previous) => {
      const { count, up_to: upTo, ...rest } = input;
      const normalized = previous(rest);
      if (count === undefined) {
        if (upTo !== undefined) throw new TypeError("select-unit.up_to needs a count.");
        return normalized;
      }
      if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 10) throw new TypeError("select-unit.count is a whole number of units from 1 to 10 (a dice count has no DSL selector).");
      if (upTo !== undefined && upTo !== true) throw new TypeError("select-unit.up_to is true or absent.");
      if (count === 1 && upTo === undefined) throw new TypeError("select-unit selects one unit by default; leave count out.");
      return { ...normalized, count, ...(upTo === true ? { up_to: true } : {}) };
    },
  },
  /**
   * Bound selections: a select-unit can bind the unit or model it selects under a name (bind_as),
   * and a later select-unit can measure its distance from that selection (within_of) or require it
   * to be visible to that selection (visible_to). "Select one enemy unit within 8\" of that model"
   * names the earlier selection, which the compiler checks (compile-bound-selection.ts).
   */
  {
    family: "select-unit",
    version: 4,
    description: "As the previous version, plus bind_as (names this selection for a later selection to refer to), within_of (the distance is measured from the named selection; requires distance within), and visible_to (visible to the named selection).",
    schema: (previous) => withProperties(previous, {
      bind_as: optional(SELECTION_NAME),
      within_of: optional(SELECTION_NAME),
      visible_to: optional(SELECTION_NAME),
    }),
    normalize: (input, previous) => {
      const { bind_as: bindAs, within_of: withinOf, visible_to: visibleTo, ...rest } = input;
      if (withinOf !== undefined && rest.distance !== "within") throw new TypeError("select-unit.within_of measures a distance, so it needs distance within.");
      const normalized = previous(rest);
      return {
        ...normalized,
        ...(bindAs !== undefined ? { bind_as: selectionName(bindAs, "select-unit.bind_as") } : {}),
        ...(withinOf !== undefined ? { within_of: selectionName(withinOf, "select-unit.within_of") } : {}),
        ...(visibleTo !== undefined ? { visible_to: selectionName(visibleTo, "select-unit.visible_to") } : {}),
      };
    },
  },
  SELECT_UNIT_WITHIN_ORIGIN,
  /**
   * A within_of and no distance of its own: "select one TRANSPORT that unit is wholly within 6\"
   * of" after a bound selection. The relation to the named selection is carried by a candidate leaf
   * (unit-position or eligible) that follows the select, so the select itself measures nothing.
   * Earlier versions require distance within for within_of; this one does not.
   */
  {
    family: "select-unit",
    version: 6,
    description: "As the previous version, plus within_of on a select whose distance is any: the relation to the named selection is carried by a candidate leaf (unit-position or eligible) that follows the select. within_of no longer requires distance within.",
    schema: (previous) => previous,
    normalize: (input, previous) => {
      const { within_of: withinOf, ...rest } = input;
      if (withinOf === undefined || rest.distance === "within") return previous(input);
      return { ...previous(rest), within_of: selectionName(withinOf, "select-unit.within_of") };
    },
  },
  {
    // "roll one D6 for each" + "enemy unit" + "within 6\" of this model": a bare quantifier, whose
    // units the unit-filter (and range or engagement) right after it name (compile-unit-filters.ts).
    family: "for-each-unit-select",
    version: 2,
    description: "As the previous version, plus the bare quantifier {} on \"each\" / \"for each\" / \"every\": the unit-filter right after it, in the same fragment, names the units, with a range or \"engaged with this unit\" after that. A later \"that unit\" is the unit of each pass.",
    schema: (previous) => ({ ...previous, required: [] }),
    normalize: (input, previous) => Object.keys(input).length === 0 ? {} : previous(input),
  },
  /**
   * A bare quantifier whose passes also take the attack's target ("roll one D6 for the target unit
   * and one D6 for each other enemy unit within 6\" of it").
   */
  {
    family: "for-each-unit-select",
    version: 3,
    description: "As the previous version, plus including target on the bare quantifier: the passes take the attack's target as well as each unit the unit-filter after it names (\"for the target unit and one D6 for each other enemy unit within 6\\\" of it\"). The filter's other then means other than the target.",
    schema: (previous) => withProperties(previous, { including: optional({ const: "target" }) }),
    normalize: (input, previous) => {
      if (!("including" in input)) return previous(input);
      const { including, ...rest } = input;
      if (including !== "target") throw new TypeError("for-each-unit-select.including is target, or omitted.");
      if (Object.keys(rest).length) throw new TypeError("for-each-unit-select.including qualifies only the bare quantifier {}; the unit-filter after it names the other units.");
      return { including: "target" };
    },
  },
  printedKeywordsExtension("stratagem-target", 3),
  /**
   * Stratagems with several targets ("One X unit and one Y unit within 6\" of it").
   */
  EXACT_COUNT,
  printedKeywordsExtension("triggering-target", 2),
  {
    // "That ADEPTUS ASTARTES INFANTRY/MOUNTED unit": every keyword in `keywords`, plus any one of `any_keywords`.
    family: "triggering-target",
    version: 3,
    description: "As the previous version, plus any_keywords: the unit also has at least one of these (a shared prefix before a slash list).",
    schema: (previous) => withProperties(previous, { any_keywords: optional({ type: "array", items: KEYWORD_ITEMS, minItems: 2, uniqueItems: true }) }),
    normalize: (input, previous) => {
      if (input.any_keywords === undefined) return previous(input);
      const { any_keywords: anyKeywords, ...rest } = input;
      const normalized = previous(rest);
      if (normalized.match === "any") throw new TypeError("triggering-target any_keywords adds to all-of keywords; match must be all.");
      return { ...normalized, any_keywords: keywordList(anyKeywords, "triggering-target any_keywords", 2) };
    },
  },
  /**
   * The one weapon a select-weapon names and binds for a later stat adjustment;
   * compile-weapon-antecedent.ts resolves it per record.
   */
  {
    // "select one of this model's Plasma rifle weapons": a named weapon, not any weapon of a type.
    family: "select-weapon",
    version: 2,
    description: "As the previous version, plus weapon_name: the selected weapon is the one with this printed name (exactly one weapon of the target has it).",
    schema: (previous) => withProperties(previous, { weapon_name: optional({ type: "string", minLength: 1 }) }),
    normalize: (input, previous) => {
      if (!("weapon_name" in input)) return previous(input);
      const { weapon_name: name, ...rest } = input;
      return { ...previous(rest), weapon_name: weaponName(name, "select-weapon") };
    },
  },
  {
    family: "count-scale",
    version: 2,
    description: "As the previous version, plus timing: live (the default, and the same leaf as no timing) or on-apply, a count in a lasting rule taken once when the rule applies. on-apply cannot count following-items.",
    schema: (previous) => withProperties(previous, { timing: optional({ enum: TIMINGS }) }),
    normalize: (input, previous) => {
      if (!("timing" in input)) return previous(input);
      const { timing, ...rest } = input;
      const checked = enumValue(timing, TIMINGS, "count-scale.timing");
      if (checked === "live") return previous(rest);
      if (rest.counts === "following-items") throw new TypeError("count-scale.timing on-apply counts a fixed set once; following-items counts one item at a time.");
      // The key stays: the compiler reads it to mark the scaling evaluated on apply.
      return { ...previous(rest), timing: checked };
    },
  },
  /**
   * A count of the models in a unit that carry a wargear item (compile-count-scale.ts).
   */
  {
    // A count of the models in the unit that carry the wargear item.
    family: "count-scale",
    version: 3,
    description: "As the previous version, and counts can be models-equipped-with with a wargear id: the models in the bearer's unit equipped with that wargear. It takes no following filter or item, and is live.",
    schema: (previous) => withProperties(widenedEnum(previous, "counts", [MODELS_EQUIPPED_WITH]), {
      wargear: optional({ type: "string", pattern: ENTITY_ID.source, "x-only-when": { counts: [MODELS_EQUIPPED_WITH] } }),
    }),
    normalize: (input, previous) => {
      if (input.counts !== MODELS_EQUIPPED_WITH) {
        if ("wargear" in input) throw new TypeError("count-scale.wargear names the wargear of counts models-equipped-with.");
        return previous(input);
      }
      const { counts: _counts, wargear, ...rest } = input;
      if (typeof wargear !== "string" || !ENTITY_ID.test(wargear)) throw new TypeError("count-scale counts models-equipped-with needs wargear, a kebab-case wargear id.");
      if (rest.timing === "on-apply") throw new TypeError("count-scale counts models-equipped-with is live; an on-apply count is not defined for it.");
      // The previous version checks per and timing; the stand-in is a value it accepts, and counts is put back after.
      return { ...previous({ ...rest, counts: "following-filter" }), counts: MODELS_EQUIPPED_WITH, wargear };
    },
  },
  /**
   * "select one or more X models": at least that many, with no upper bound.
   */
  {
    family: "select-unit",
    version: 7,
    description: "As the previous version, plus at_least: at least count (1 without a count) are selected and there is no upper bound (\"select one or more X models\"). Not with up_to.",
    schema: (previous) => withProperties(previous, { at_least: optional({ const: true }) }),
    normalize: (input, previous) => {
      const { at_least: atLeast, ...rest } = input;
      if (atLeast === undefined) return previous(input);
      if (atLeast !== true) throw new TypeError("select-unit.at_least is true or absent.");
      if (rest.up_to !== undefined) throw new TypeError("select-unit.at_least is a lower bound; up_to is an upper one, so they cannot be combined.");
      // "one or more": count 1 is the default, which the earlier versions refuse to have written out.
      const { count, ...uncounted } = rest;
      if (count === 1) return { ...previous(uncounted), at_least: true };
      return { ...previous(rest), at_least: true };
    },
  },
];
