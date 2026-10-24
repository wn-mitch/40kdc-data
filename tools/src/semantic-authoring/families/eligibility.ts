import { ANTECEDENT } from "../antecedent-families.js";
import { EVENT_SUBJECT, type FamilyExtension, KEYWORD_ITEMS, keywordList, optional, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { boundedInteger, enumValue } from "../family-validation.js";
import { FILTERED_UNITS, MATCHED_UNITS, printedKeywordsExtension } from "./shared.js";

/**
 * Versions of the eligibility and permission families: eligibility-permission, eligible,
 * targeting-restriction and bearer-eligibility. Each version checks only its own additions and
 * hands the rest of a leaf to the previous version, so every earlier leaf still fits it unchanged.
 */

/**
 * The units a targeting restriction can name on either side: the ability's own unit or model,
 * the selected unit, the triggering unit, every enemy or friendly unit, or an earlier leaf's unit.
 */
export const TARGETING_UNITS = ["this-unit", "this-model", "selected-unit", "event-subject", "enemy-units", "friendly-units", ANTECEDENT] as const;

/** A Stratagem's id, as its core or detachment record has it ("fire-overwatch"). */
const STRATAGEM_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

const EMBARK_WITHIN = "embark-within";

/** `this-unit` is the candidate being checked; `ability-unit` is the unit that carries the ability (the Transport in "this Transport"). */
const TRANSPORT_VALUES = ["this-unit", "ability-unit"] as const;

const MATCHED_TARGET: FamilyExtension = {
  // "that only targets one or more of those enemy units", "must select one or more of those enemy units as the targets of that charge".
  family: "targeting-restriction",
  version: 4,
  description: "As the previous version, plus target matched-units: the units an earlier unit-position of matching-unit introduced. by does not widen.",
  schema: (previous) => withProperties(previous, {
    target: widenedEnum(previous, "target", [MATCHED_UNITS]),
  }),
  normalize: (input, previous) => {
    if (input.target !== MATCHED_UNITS) return previous(input);
    // The previous version checks target against by; a placeholder that differs from by stands in, then target is restored.
    const placeholder = input.by === "enemy-units" ? "friendly-units" : "enemy-units";
    const { target: _target, ...rest } = input;
    return { ...previous({ ...rest, target: placeholder }), target: MATCHED_UNITS };
  },
};

/**
 * Where an embark permission puts the subject: "antecedent" (an earlier target or unit the
 * binder resolves), "following-filter" (the unit-filter right after the permission), "selection"
 * (the inner unit of a bound selection pair) or "this-unit" (the ability's own Transport).
 */
export const PERMISSION_INTO = ["antecedent", "following-filter", "selection", "this-unit"] as const;

/** The widest fight reach a leaf may name, in inches. */
const MAX_REACH = 12;

/**
 * Fight eligibility with a reach or an order. `reach` ("any models in it that are within 3" of an
 * enemy model are eligible to fight") is how far from the unit a model may be and still count as
 * eligible to fight. `next` ("must be the next unit you select to fight") puts the unit first in the
 * fight order. Both apply only to a fight permission that grants (allow true).
 */
const FIGHT_REACH_AND_NEXT: FamilyExtension = {
  family: "eligibility-permission",
  version: 8,
  description: `As the previous version, plus reach (1 to ${MAX_REACH} inches: models that far from an enemy are eligible to fight) and next (true: the unit must be the next one selected to fight). Both only with activity fight and allow true.`,
  schema: (previous) => withProperties(previous, {
    reach: optional({ type: "integer", minimum: 1, maximum: MAX_REACH, "x-only-when": { activity: ["fight"] } }),
    next: optional({ const: true, "x-only-when": { activity: ["fight"] } }),
  }),
  normalize: (input, previous) => {
    if (input.reach === undefined && input.next === undefined) return previous(input);
    const { reach, next, ...rest } = input;
    if (rest.activity !== "fight") throw new TypeError("eligibility-permission.reach and next apply only to activity: fight.");
    if (rest.allow !== true) throw new TypeError("eligibility-permission.reach and next need allow: true.");
    // The previous version checks the rest of the leaf; the new keys are checked against their own values here.
    const normalized = previous(rest);
    return {
      ...normalized,
      ...(reach !== undefined ? { reach: boundedInteger(reach, 1, MAX_REACH, "eligibility-permission.reach") } : {}),
      ...(next !== undefined ? (() => { if (next !== true) throw new TypeError("eligibility-permission.next must be true."); return { next: true }; })() : {}),
    };
  },
};

export const ELIGIBILITY_EXTENSIONS: readonly FamilyExtension[] = [
  /**
   * Permission binding: a permission to end within Engagement Range of the enemy unit that the same
   * ability's move ends nearest. The leaf says so with engaged_with_move_end, which needs despite
   * engaged. The compiler binds it to that move's allow_engagement (compile-move-end-nearest.ts).
   */
  {
    family: "eligibility-permission",
    version: 4,
    description: "As the previous version, plus engaged_with_move_end: the permission applies within Engagement Range of the enemy unit the same ability's move ends nearest, not any engaged unit (despite includes engaged).",
    schema: (previous) => withProperties(previous, {
      engaged_with_move_end: optional({ const: true, "x-only-when": { despite: ["engaged"] } }),
    }),
    normalize: (input, previous) => {
      if (input.engaged_with_move_end === undefined) return previous(input);
      const { engaged_with_move_end: flag, ...rest } = input;
      if (flag !== true) throw new TypeError("eligibility-permission.engaged_with_move_end must be true.");
      const normalized = previous(rest);
      const despite = (normalized.despite as string[] | undefined) ?? [];
      if (!despite.includes("engaged")) throw new TypeError("eligibility-permission.engaged_with_move_end needs despite to include engaged.");
      return { ...normalized, engaged_with_move_end: true };
    },
  },
  /**
   * "That unit can embark within that TRANSPORT": the permission names the Transport it embarks the
   * subject within. Only an embark permission has a destination; the binder
   * (compile-target-refs.ts) and the lowering (compile-fragments.ts) resolve the value.
   */
  {
    family: "eligibility-permission",
    version: 5,
    description: `As the previous version, plus into: the Transport an embark permission places the subject within (${PERMISSION_INTO.join(", ")}). Only with activity embark.`,
    schema: (previous) => withProperties(previous, {
      into: optional({ enum: [...PERMISSION_INTO], "x-only-when": { activity: ["embark"] } }),
    }),
    normalize: (input, previous) => {
      if (!("into" in input)) return previous(input);
      const { into, ...rest } = input;
      if (rest.activity !== "embark") throw new TypeError("eligibility-permission.into applies only to activity: embark.");
      // The previous version checks the rest of the leaf; `into` is checked here, against its own values.
      const normalized = previous(rest);
      return { ...normalized, into: enumValue(into, [...PERMISSION_INTO], "eligibility-permission.into") };
    },
  },
  /**
   * A permitted unit named by the moment that introduces it ("that unit can move within Engagement
   * Range" after a move-ended event).
   */
  {
    // "Then that unit can move within Engagement Range" after a move-ended trigger: the moving unit.
    family: "eligibility-permission",
    version: 6,
    description: `As the previous version, and the subject can be the triggering unit (${EVENT_SUBJECT}), the unit a move-ended event names.`,
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EVENT_SUBJECT]) }),
    normalize: (input, previous) => input.subject === EVENT_SUBJECT ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
  {
    // "units cannot embark within this unit": every unit the filter names loses the embark permission.
    family: "eligibility-permission",
    version: 7,
    description: "As the previous version, plus subject filtered-units: the units a unit-filter names right before the permission (\"units cannot embark within this unit\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [FILTERED_UNITS]) }),
    normalize: (input, previous) => input.subject === FILTERED_UNITS ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
  FIGHT_REACH_AND_NEXT,
  /**
   * Transport eligibility: "one friendly TRANSPORT that it is able to embark within". The subject
   * (a unit, possibly an earlier leaf's unit) is eligible to embark within the named Transport, by
   * the datasheet keyword check. Room in that Transport is a separate condition and is not part of
   * this one (compile-transport-embark.ts refuses the embark that would need it).
   */
  {
    family: "eligible",
    version: 3,
    description: `As the previous version, plus to ${EMBARK_WITHIN}: the subject is able to embark within the Transport named by transport (this-unit, the candidate being checked, or ability-unit, the unit with the ability). The subject is a unit, not a model.`,
    schema: (previous) => withProperties(previous, {
      to: widenedEnum(previous, "to", [EMBARK_WITHIN]),
      transport: optional({ enum: [...TRANSPORT_VALUES], "x-only-when": { to: [EMBARK_WITHIN] } }),
    }),
    normalize: (input, previous) => {
      if (input.to !== EMBARK_WITHIN) {
        if ("transport" in input) throw new TypeError("eligible.transport applies only to to: embark-within.");
        return previous(input);
      }
      if (!("transport" in input)) throw new TypeError("eligible to embark-within names the Transport in transport.");
      const { transport, ...rest } = input;
      if (rest.subject === "this-model" || rest.subject === "model-in-this-unit") throw new TypeError("eligible embark-within names units, not models.");
      if ("at" in rest || "source_ability_id" in rest || "source_ability_owner" in rest) throw new TypeError("eligible embark-within takes no at, source_ability_id or source_ability_owner.");
      // The previous version knows no embark-within; it checks the rest with a value it knows.
      const normalized = standIn(rest, "to", "shoot", previous);
      return { ...normalized, to: EMBARK_WITHIN, transport: enumValue(transport, [...TRANSPORT_VALUES], "eligible.transport") };
    },
  },
  {
    // "this unit can only target that enemy unit" (by this unit, target that unit); "this unit
    // cannot be targeted by ranged attacks" (target this unit, by anyone).
    family: "targeting-restriction",
    version: 3,
    description: "As the previous version, or, instead of subject, target (the unit being targeted) and optionally by (the unit that targets): \"this unit can only target that enemy unit\" is by this unit, target that unit; \"this unit cannot be targeted by ranged attacks\" is target this unit with no by. With target, stratagem names the one Stratagem (kind stratagem), and except: core-stratagems keeps Core Stratagems allowed (\"other than Core Stratagems\"). A leaf with subject reads as the previous version did.",
    schema: (previous) => {
      const schema = withProperties(previous, {
        subject: optional((previous.properties as Record<string, Record<string, unknown>>).subject!),
        by: optional({ enum: TARGETING_UNITS }),
        target: optional({ enum: TARGETING_UNITS }),
        stratagem: optional({ type: "string", pattern: STRATAGEM_ID.source, "x-only-when": { kind: ["stratagem"] } }),
        except: optional({ const: "core-stratagems", "x-only-when": { kind: ["stratagem"], may: ["cannot-target"] } }),
      });
      return { ...schema, required: (previous.required as string[]).filter((key) => key !== "subject") };
    },
    normalize: (input, previous) => {
      const { by, target, stratagem, except, ...rest } = input;
      if (!("by" in input) && !("target" in input)) {
        if ("stratagem" in input || "except" in input) throw new TypeError("targeting-restriction.stratagem and except need target (and by), not subject.");
        return previous(input);
      }
      if ("subject" in input) throw new TypeError("targeting-restriction names either subject (the previous reading) or target and by, not both.");
      if (!("target" in input)) throw new TypeError("targeting-restriction.by needs a target: the unit being targeted.");
      const added: Record<string, unknown> = { target: enumValue(target, TARGETING_UNITS, "targeting-restriction.target") };
      if ("by" in input) {
        added.by = enumValue(by, TARGETING_UNITS, "targeting-restriction.by");
        if (added.by === added.target && added.by !== ANTECEDENT) throw new TypeError("targeting-restriction.by and target name the same unit.");
      }
      const { subject: _stand, ...normalized } = previous({ ...rest, subject: "this-unit" });
      if ("stratagem" in input) {
        if (normalized.kind !== "stratagem") throw new TypeError("targeting-restriction.stratagem names the Stratagem of kind stratagem only.");
        if (typeof stratagem !== "string" || !STRATAGEM_ID.test(stratagem)) throw new TypeError("targeting-restriction.stratagem is the Stratagem's kebab-case id.");
        added.stratagem = stratagem;
      }
      if ("except" in input) {
        if (except !== "core-stratagems" || normalized.kind !== "stratagem" || normalized.may !== "cannot-target") throw new TypeError("targeting-restriction.except is core-stratagems, on a cannot-target of kind stratagem only.");
        if ("stratagem" in input) throw new TypeError("targeting-restriction.except leaves out Core Stratagems from all Stratagems; it cannot go with one named Stratagem.");
        added.except = except;
      }
      return { ...normalized, ...added };
    },
  },
  /**
   * "Those X units", the set an earlier unit-position of matching-unit matched
   * (compile-matched-set.ts).
   */
 MATCHED_TARGET,
  {
    // "ADEPTUS ASTARTES INFANTRY/MOUNTED model only": every keyword, plus any one of these.
    family: "bearer-eligibility",
    version: 3,
    description: "As the previous version, plus any_keywords: the bearer has every keyword and at least one of these (\"ADEPTUS ASTARTES INFANTRY/MOUNTED model only\" is ADEPTUS ASTARTES plus INFANTRY or MOUNTED).",
    schema: (previous) => withProperties(previous, { any_keywords: optional({ type: "array", items: KEYWORD_ITEMS, minItems: 2, uniqueItems: true }) }),
    normalize: (input, previous) => {
      if (!("any_keywords" in input)) return previous(input);
      const { any_keywords: anyKeywords, ...rest } = input;
      const normalized = previous(rest);
      if (normalized.match !== "all") throw new TypeError("bearer-eligibility.any_keywords adds one-of keywords to keywords all must have; match must be all.");
      const any = keywordList(anyKeywords, "bearer-eligibility.any_keywords", 2);
      if (any.some((keyword) => (normalized.keywords as string[]).includes(keyword))) throw new TypeError("bearer-eligibility names a keyword both as required and as one of several.");
      return { ...normalized, any_keywords: any };
    },
  },
  printedKeywordsExtension("bearer-eligibility", 4),
];
