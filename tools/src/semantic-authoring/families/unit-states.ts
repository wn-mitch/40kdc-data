import { ANTECEDENT } from "../antecedent-families.js";
import { EVENT_SUBJECT, type FamilyExtension, keywordList, optional, properties, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { enumValue } from "../family-validation.js";
import { EACH_TARGET, EMBARKED_IN, FILTERED_UNITS, FOLLOWING_FILTER, NAMED_ID, bearerTransportSubject, namedId, printedKeywordsExtension, standInEachTarget } from "./shared.js";

/**
 * Versions of the unit state conditions and effects: unit-state, battle-shock-state, rule-state,
 * unit-keyword, unit-has-ability, leading-unit, model-count and loadout. Each version checks only
 * its own additions and hands the rest of a leaf to the previous version, so every earlier leaf
 * still fits it unchanged.
 */

/**
 * Reserves states a unit-state leaf can name. in-reserves records the wording "in Reserves", which
 * the rules define as Strategic Reserves; compilation lowers it to the DSL's in-strategic-reserves.
 */
export const RESERVE_STATES = ["in-reserves", "in-strategic-reserves", "in-cult-ambush"] as const;

/** States the DSL's unit-state can read at the start of the phase or turn (strength and carrying are other predicates). */
const STATES_AT = ["engaged", "battle-shocked", "on-battlefield", "in-reserves", "in-strategic-reserves", "in-cult-ambush"] as const;

/** The unit-state families a hidden unit and a bearer's Transport extend . */
const UNIT_STATE_HIDDEN: FamilyExtension = {
  // "if that friendly unit is hidden": the core state, not a designation.
  family: "unit-state",
  version: 11,
  description: "As the previous version, plus the state hidden: the core rules' hidden state (\"if that friendly unit is hidden\"), not a designation an ability applies.",
  schema: (previous) => {
    const states = properties(previous).states!;
    const items = states.items as Record<string, unknown>;
    return withProperties(previous, { states: { ...states, items: { ...items, enum: [...(items.enum as string[]), "hidden"] } } });
  },
  normalize: (input, previous) => {
    if (!Array.isArray(input.states) || !input.states.includes("hidden")) return previous(input);
    if (input.at !== undefined) throw new TypeError("unit-state hidden has no earlier point (at).");
    const rest = input.states.filter((state) => state !== "hidden");
    // Battle-shocked stands in for a hidden-only leaf: it takes no with, as hidden takes none.
    const normalized = previous({ ...input, states: rest.length ? rest : ["battle-shocked"] });
    return { ...normalized, states: [...(rest.length ? normalized.states as string[] : []), "hidden"] };
  },
};

const UNIT_STATE_BEARER_TRANSPORT: FamilyExtension = {
  // "(or any TRANSPORT it is embarked within is on the battlefield)".
  family: "unit-state",
  version: 12,
  description: "As the previous version, plus subject bearer-transport: the Transport this model is embarked within (\"any TRANSPORT it is embarked within is on the battlefield\").",
  schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", ["bearer-transport"]) }),
  normalize: (input, previous) => input.subject === "bearer-transport" ? standIn(input, "subject", "this-unit", previous) : previous(input),
};

/** A stand-in ability id the previous version checks the rest of a leaf with, while `own` names the ability. */
const OWN_STAND_IN = "this-ability";

const UNIT_HAS_OWN_ABILITY: FamilyExtension = {
  // "one or more units with this ability": the record's own ability, whatever its id.
  family: "unit-has-ability",
  version: 3,
  description: "As the previous version, or own: true in place of ability: \"this ability\", the ability of the record the leaf is on, bound to its id when the record compiles (a duplicate record names the record datasheets carry). A leaf names ability or own, never both.",
  schema: (previous) => {
    const { required, ...rest } = previous;
    return withProperties({ ...rest, required: (required as string[]).filter((key) => key !== "ability") }, {
      ability: optional(properties(previous).ability!),
      own: optional({ const: true }),
    });
  },
  normalize: (input, previous) => {
    if (!("own" in input)) {
      if (!("ability" in input)) throw new TypeError("unit-has-ability names an ability, or own: true for this ability.");
      return previous(input);
    }
    if ("ability" in input) throw new TypeError("unit-has-ability names an ability or own: true, not both.");
    if (input.own !== true) throw new TypeError("unit-has-ability.own is true or absent.");
    const { own: _own, ...rest } = input;
    const { ability: _ability, ...normalized } = previous({ ...rest, ability: OWN_STAND_IN });
    return { ...normalized, own: true };
  },
};

const UNIT_STATE_EMBARKED: FamilyExtension = {
  // The subject is embarked within some Transport.
  family: "unit-state",
  version: 13,
  description: "As the previous version, plus embarked: the subject (this unit, this model or target) is embarked within a Transport. Embarked takes no with, no at, and no other state in the same list.",
  schema: (previous) => {
    const property = properties(previous).states!;
    const items = property.items as Record<string, unknown>;
    return withProperties(previous, { states: { ...property, items: { ...items, enum: [...(items.enum as string[]), "embarked"] } } });
  },
  normalize: (input, previous) => {
    const states = Array.isArray(input.states) ? input.states as unknown[] : [];
    if (!states.includes("embarked")) return previous(input);
    if (states.length !== 1) throw new TypeError("unit-state embarked cannot be listed with other states.");
    if (input.with !== undefined) throw new TypeError("unit-state embarked takes no with.");
    if (input.at !== undefined) throw new TypeError("unit-state embarked has no earlier point (at).");
    if (!["this-unit", "this-model", "target"].includes(String(input.subject))) {
      throw new TypeError(`unit-state embarked is about this-unit, this-model or target, not ${String(input.subject)}.`);
    }
    // The previous version has no embarked state; it checks the subject with on-battlefield standing in
    // (a this-model subject is refused for every other state).
    return standIn(input, "states", ["on-battlefield"], previous);
  },
};

const UNIT_KEYWORD_BEARER = bearerTransportSubject(
  "unit-keyword",
  5,
  "As the previous version, plus subject bearer-transport: the Transport the unit is embarked within, as a keyword condition.",
);

const THIS_MODEL = "this-model";

const ENGAGED = "engaged";

const ON_BATTLEFIELD = "on-battlefield";

const BATTLE_SHOCK_EVENT_SUBJECT: FamilyExtension = {
  family: "battle-shock-state",
  version: 2,
  description: "As the previous version, plus recipient event-subject: the unit the record's moment names becomes or stops being Battle-shocked.",
  schema: (previous) => withProperties(previous, { recipient: widenedEnum(previous, "recipient", [EVENT_SUBJECT]) }),
  normalize: (input, previous) => input.recipient === EVENT_SUBJECT ? standIn(input, "recipient", "this-unit", previous) : previous(input),
};

export const UNIT_STATE_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "There are no models embarked within this TRANSPORT": a unit is embarked within the subject.
    family: "unit-state",
    version: 7,
    description: "As the previous version, plus carrying-units: one or more units are embarked within the subject (negated: none are).",
    schema: (previous) => {
      const property = properties(previous).states!;
      const items = property.items as Record<string, unknown>;
      return withProperties(previous, { states: { ...property, items: { ...items, enum: [...(items.enum as string[]), "carrying-units"] } } });
    },
    normalize: (input, previous) => {
      const states = Array.isArray(input.states) ? input.states as unknown[] : [];
      if (!states.includes("carrying-units")) return previous(input);
      if (states.length !== 1) throw new TypeError("unit-state carrying-units cannot be listed with other states.");
      if (input.with !== undefined) throw new TypeError("unit-state carrying-units takes no with.");
      return { ...previous({ ...input, states: ["engaged"] }), states: ["carrying-units"] };
    },
  },
  {
    // "While this unit is in Reserves", "a unit in Cult Ambush": the DSL's Reserves unit-states.
    family: "unit-state",
    version: 8,
    description: "As the previous version, plus in-reserves (\"in Reserves\", which the rules define as Strategic Reserves), in-strategic-reserves and in-cult-ambush (a type of Strategic Reserves).",
    schema: (previous) => {
      const property = properties(previous).states!;
      const items = property.items as Record<string, unknown>;
      return withProperties(previous, { states: { ...property, items: { ...items, enum: [...(items.enum as string[]), ...RESERVE_STATES] } } });
    },
    normalize: (input, previous) => {
      const states = Array.isArray(input.states) ? input.states as unknown[] : [];
      const added = states.filter((state) => (RESERVE_STATES as readonly unknown[]).includes(state));
      if (added.length === 0) return previous(input);
      if (input.with !== undefined) throw new TypeError("unit-state Reserves states take no with.");
      if (new Set(states).size !== states.length) throw new TypeError("unit-state lists a state twice.");
      const older = states.filter((state) => !added.includes(state));
      const normalized = previous({ ...input, states: older.length ? older : ["on-battlefield"] });
      const kept = older.length ? normalized.states as string[] : [];
      return { ...normalized, states: [...kept, ...(added as string[])] };
    },
  },
  {
    // "engaged with one or more" + "friendly GREY KNIGHTS VEHICLE units".
    family: "unit-state",
    version: 9,
    description: "As the previous version, plus with following-filter: engaged with any unit the unit-filter right after this leaf, in the same clause, matches.",
    schema: (previous) => withProperties(previous, { with: widenedEnum(previous, "with", [FOLLOWING_FILTER]) }),
    normalize: (input, previous) => input.with === FOLLOWING_FILTER ? { ...previous({ ...input, with: "this-unit" }), with: FOLLOWING_FILTER } : previous(input),
  },
  {
    // "an enemy unit that was engaged with this unit ends a Fall Back move": the state at the start
    // of the phase or turn, not now.
    family: "unit-state",
    version: 10,
    description: "As the previous version, plus at: phase-start or turn-start reads the state as it was then (\"that was engaged with this unit\"), not now.",
    schema: (previous) => withProperties(previous, { at: optional({ enum: ["phase-start", "turn-start"], "x-only-when": { states: STATES_AT } }) }),
    normalize: (input, previous) => {
      if (input.at === undefined) return previous(input);
      const { at, ...rest } = input;
      const normalized = previous(rest);
      if (!(normalized.states as string[]).every((state) => (STATES_AT as readonly string[]).includes(state))) {
        throw new TypeError(`unit-state.at reads only ${STATES_AT.join(", ")} at an earlier point.`);
      }
      return { ...normalized, at: enumValue(at, ["phase-start", "turn-start"], "unit-state.at") };
    },
  },
  UNIT_STATE_HIDDEN,
  UNIT_STATE_BEARER_TRANSPORT,
  /**
   * Unit-state embarked: a unit is embarked within a Transport.
   */
  UNIT_STATE_EMBARKED,
  /**
   * Each-target eligibility: a unit-state or unit-position condition that holds of every Stratagem
   * target named before it ("Each unit targeted with this Stratagem must be more than 3\" away",
   * "You cannot select units that are within Engagement Range"). The previous version checks the
   * rest of a leaf; subject each-target is read as this-unit there, then restored, so the compiler
   * (compile-target-groups.ts) copies the condition into every target's eligibility.
   */
  {
    family: "unit-state",
    version: 14,
    description: "As the previous version, plus subject each-target: the condition holds of every Stratagem target named before it (\"Each unit targeted with this Stratagem must …\", \"You cannot select units that are within Engagement Range …\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EACH_TARGET]) }),
    normalize: (input, previous) => standInEachTarget(input, previous),
  },
  /**
   * Version 15: a this-model subject can be engaged (the model is in Engagement Range). Only that
   * alone-state, not negated, with no with or at is new; every other input, including the
   * this-model states the previous version accepts (on the battlefield, embarked), goes to the
   * previous version unchanged.
   */
  {
    // "cannot end that move within Engagement Range of them": the model holder's own engagement.
    family: "unit-state",
    version: 15,
    description: "As the previous version, plus a this-model subject may be engaged (alone, not negated, with no with or at): \"that model is within Engagement Range\". Other inputs are the previous version's.",
    schema: (previous) => previous,
    normalize: (input, previous) => {
      if (input.subject !== THIS_MODEL) return previous(input);
      // Only an engaged this-model condition is new; every other this-model input is the previous version's answer.
      const states = Array.isArray(input.states) ? input.states as unknown[] : [];
      if (!(states.length === 1 && states[0] === ENGAGED)) return previous(input);
      if (input.negated !== false) throw new TypeError("unit-state: an engaged this-model condition is not negated.");
      if (input.with !== undefined) throw new TypeError("unit-state: an engaged this-model condition takes no with.");
      if (input.at !== undefined) throw new TypeError("unit-state: an engaged this-model condition takes no at.");
      // The previous version refuses an engaged this-model condition; on-battlefield stands in for the check, and the states are restored.
      return standIn(input, "states", [ON_BATTLEFIELD], previous);
    },
  },
  {
    // "While a Big Mek model is embarked within this unit": a unit-filter's units embarked within a named Transport.
    family: "unit-state",
    version: 16,
    description: "As the previous version, plus embarked with a Transport: the units a unit-filter right before the leaf names (subject antecedent) are embarked within this unit or this model (with). It takes no at, no other state; negated reads \"no such unit is embarked\".",
    schema: (previous) => {
      const withSchema = (previous.properties as Record<string, Record<string, unknown>>).with!;
      const only = (withSchema["x-only-when"] ?? {}) as Record<string, string[]>;
      return withProperties(previous, { with: { ...withSchema, "x-only-when": { ...only, states: [...new Set([...(only.states ?? []), "embarked"])] } } });
    },
    normalize: (input, previous) => {
      const states = Array.isArray(input.states) ? input.states as unknown[] : [];
      if (!(states.length === 1 && states[0] === "embarked") || input.with === undefined) return previous(input);
      if (!(EMBARKED_IN as readonly unknown[]).includes(input.with)) throw new TypeError(`unit-state embarked names the Transport with this-unit or this-model, not ${JSON.stringify(input.with)}.`);
      // Any other subject keeps the previous version's refusal of a with on the embarked state.
      if (input.subject !== "antecedent") return previous(input);
      if (input.at !== undefined) throw new TypeError("unit-state embarked has no earlier point (at).");
      const { with: transport, ...rest } = input;
      // The previous version takes an embarked state of this-unit with no with; the subject and with are put back.
      return { ...previous({ ...rest, subject: "this-unit" }), subject: "antecedent", with: transport };
    },
  },
  {
    family: "unit-state",
    version: 17,
    description: "As the previous version, plus subject filtered-units (\"one or more Neurotyrants are on the battlefield\", \"no other friendly units are engaged with that unit\"); and a this-model subject may be engaged with negated, with and at, as a this-unit subject may (\"if this model is not within Engagement Range of one or more enemy units\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [FILTERED_UNITS]) }),
    normalize: (input, previous) => {
      if (input.subject === FILTERED_UNITS) return standIn(input, "subject", "this-unit", previous);
      const states = Array.isArray(input.states) ? input.states as unknown[] : [];
      if (input.subject === THIS_MODEL && states.length === 1 && states[0] === ENGAGED) {
        // A this-model engaged condition is checked as a this-unit one (negated, with, at); the subject is put back.
        if (input.with === THIS_MODEL) throw new TypeError("unit-state: a model cannot be engaged with itself.");
        return standIn(input, "subject", "this-unit", previous);
      }
      return previous(input);
    },
  },
  /**
   * Recipient event-subject: the unit a Stratagem's or ability's moment names, where the family's
   * own enum named only the bearer, a selection or an earlier leaf's unit.
   */
  BATTLE_SHOCK_EVENT_SUBJECT,
  {
    // "that enemy unit cannot have the Benefit of Cover": a rule suppressed on another unit.
    family: "rule-state",
    version: 2,
    description: "As the previous version, and the subject can be a selected unit, the triggering unit, the attack's target, or an earlier leaf's unit (antecedent): \"that enemy unit cannot have the Benefit of Cover\".",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", ["selected-unit", EVENT_SUBJECT, "target", ANTECEDENT]) }),
    normalize: (input, previous) => ["selected-unit", EVENT_SUBJECT, "target", ANTECEDENT].includes(String(input.subject))
      ? standIn(input, "subject", "this-unit", previous)
      : previous(input),
  },
  printedKeywordsExtension("unit-keyword", 4),
  UNIT_KEYWORD_BEARER,
  {
    family: "unit-keyword",
    version: 6,
    description: "As the previous version, or chosen_by instead of keywords: the subject has the keyword chosen by the named ability. The choice reference and a literal keyword list are mutually exclusive.",
    schema: (previous) => ({
      ...withProperties(previous, {
        keywords: optional(properties(previous).keywords!),
        chosen_by: optional({ type: "string", pattern: NAMED_ID.source }),
      }),
      required: (previous.required as string[]).filter((key) => key !== "keywords"),
      oneOf: [
        { required: ["keywords"], not: { required: ["chosen_by"] } },
        { required: ["chosen_by"], not: { required: ["keywords"] } },
      ],
    }),
    normalize: (input, previous) => {
      if (!("chosen_by" in input)) return previous(input);
      if ("keywords" in input) throw new TypeError("unit-keyword uses keywords or chosen_by, not both.");
      const { chosen_by, ...rest } = input;
      const choice = namedId(chosen_by, "unit-keyword.chosen_by");
      const { keywords: _keywords, ...normalized } = previous({ ...rest, keywords: ["INFANTRY"] });
      return { ...normalized, chosen_by: choice };
    },
  },
  /**
   * Units filtered by an ability ("units with this ability").
   */
  UNIT_HAS_OWN_ABILITY,
  {
    // "while this model is part of an attached unit", attached as Leader or in support.
    family: "leading-unit",
    version: 3,
    description: "As the previous version, plus attachment any: attached to a unit in either role, as its Leader or in support.",
    schema: (previous) => withProperties(previous, { attachment: widenedEnum(previous, "attachment", ["any"]) }),
    normalize: (input, previous) => input.attachment === "any" ? standIn(input, "attachment", "leading", previous) : previous(input),
  },
  {
    // "while this model is leading a **DOMINION SQUAD**": attached to a unit with those keywords.
    family: "leading-unit",
    version: 4,
    description: "As the previous version, plus attached_to_keywords: the unit it is attached to has every one of these keywords.",
    schema: (previous) => withProperties(previous, { attached_to_keywords: optional({ type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true }) }),
    normalize: (input, previous) => {
      if (!("attached_to_keywords" in input)) return previous(input);
      const { attached_to_keywords: keywords, ...rest } = input;
      return { ...previous(rest), attached_to_keywords: keywordList(keywords, "leading-unit.attached_to_keywords", 1) };
    },
  },
  {
    // "While a FARSEER model is leading this unit"; "unless it is leading a unit"; "while that unit
    // is being led".
    family: "leading-unit",
    version: 5,
    description: "As the previous version, plus attachment led (the subject unit is led by a Leader; leader_keywords: that Leader has every one of these keywords), negated (the attachment does not hold), and subject antecedent or selected-unit.",
    schema: (previous) => withProperties(previous, {
      attachment: widenedEnum(previous, "attachment", ["led"]),
      subject: widenedEnum(previous, "subject", [ANTECEDENT, "selected-unit"]),
      leader_keywords: optional({ type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true, "x-only-when": { attachment: ["led"] } }),
      negated: optional({ type: "boolean" }),
    }),
    normalize: (input, previous) => {
      const { leader_keywords: leaders, negated, ...rest } = input;
      if (negated !== undefined && typeof negated !== "boolean") throw new TypeError("leading-unit.negated is true or false.");
      if (leaders !== undefined && rest.attachment !== "led") throw new TypeError("leading-unit.leader_keywords names the Leader of a led unit (attachment led).");
      const subject = rest.subject;
      const standIn = { ...rest, ...(rest.attachment === "led" ? { attachment: "leading" } : {}), ...(subject === ANTECEDENT || subject === "selected-unit" ? { subject: "this-unit" } : {}) };
      const normalized = previous(standIn);
      return {
        ...normalized, attachment: rest.attachment, ...(subject === ANTECEDENT || subject === "selected-unit" ? { subject } : {}),
        ...(leaders !== undefined ? { leader_keywords: keywordList(leaders, "leading-unit.leader_keywords", 1) } : {}),
        ...(negated === true ? { negated: true } : {}),
      };
    },
  },
  {
    // "a CHARACTER unit with the Leader ability" + "can be attached to a" + "X unit": which units
    // a Leader can join, read at muster (compile-army.ts folds it into an attachment rule).
    family: "leading-unit",
    version: 6,
    description: "As the previous version, plus attachment can-attach: the subject can be attached to the unit-filter right after the leaf (object following-filter, required). It says which units a Leader may join when mustering, so it lowers only inside a list-building attachment rule.",
    schema: (previous) => withProperties(previous, {
      attachment: widenedEnum(previous, "attachment", ["can-attach"]),
      object: optional({ enum: [FOLLOWING_FILTER], "x-only-when": { attachment: ["can-attach"] } }),
    }),
    normalize: (input, previous) => {
      const { object, ...rest } = input;
      if (rest.attachment !== "can-attach") {
        if (object !== undefined) throw new TypeError("leading-unit.object goes with attachment: can-attach.");
        return previous(input);
      }
      if (object !== FOLLOWING_FILTER) throw new TypeError("leading-unit attachment can-attach names the unit by object: following-filter.");
      if (rest.negated === true || rest.leader_keywords !== undefined) throw new TypeError("leading-unit attachment can-attach takes no negation or leader keywords.");
      return { ...standIn(rest, "attachment", "leading", previous), object: FOLLOWING_FILTER };
    },
  },
  printedKeywordsExtension("model-count", 2),
  printedKeywordsExtension("loadout", 2),
];
