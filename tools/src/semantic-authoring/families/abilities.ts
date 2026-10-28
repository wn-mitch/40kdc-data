import { ANTECEDENT } from "../antecedent-families.js";
import { constTrue, nonEmptyString } from "../buff-families.js";
import type { SemanticFamilyDefinition } from "../contracts.js";
import { type FamilyExtension, optional, properties, type Schema, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { boundedInteger, enumValue } from "../family-validation.js";
import { printedKeywordsExtension } from "./shared.js";

/**
 * Versions for named abilities: activating the options of an option-bearing rule (combat doctrines,
 * Doctrina Imperatives, Blessings of Khorne, Plagues) — which options an activation makes active,
 * for whom, and whether it replaces the unit's active option or joins it — plus
 * ability-record-grant and ability-modifier, and the granted-ability base families. Each version
 * checks only its own additions and hands the rest of a leaf to the previous version, so every
 * earlier leaf still fits it unchanged.
 */

/** How many abilities a printed header introduces: "the following ability", "abilities", or an unnamed "the following". */
export const PRINTED_GRANTS = ["one", "several", "unnamed"] as const;

/** A stand-in id the previous version checks the rest of a printed header with. */
const PRINTED_STAND_IN = "printed-ability";

const PRINTED_RECORD_GRANT: FamilyExtension = {
  family: "ability-record-grant",
  version: 3,
  description: "As the previous version, or printed in place of ability: the granted abilities are printed right after this wording in the same record. one is \"has the following ability:\", several is \"the following abilities:\", unnamed is \"have the following:\". Each named body starts with a granted-ability-name leaf. subject is the holder: the ability is the holder's own, so it works only while a holder is on the battlefield, and a cadence in it counts per holder.",
  schema: (previous) => {
    const { required, ...rest } = previous;
    return withProperties({ ...rest, required: (required as string[]).filter((key) => key !== "ability") }, {
      ability: optional(properties(previous).ability!),
      printed: optional({ enum: [...PRINTED_GRANTS] }),
    });
  },
  normalize: (input, previous) => {
    if (!("printed" in input)) {
      if (!("ability" in input)) throw new TypeError("ability-record-grant names an ability, or printed for abilities printed after it.");
      return previous(input);
    }
    if ("ability" in input) throw new TypeError("ability-record-grant names an ability or printed, not both.");
    if ("value" in input || "rules_bundle" in input) throw new TypeError("ability-record-grant.value and rules_bundle describe a named ability record, not a printed one.");
    const { printed, ...rest } = input;
    const { ability: _ability, ...normalized } = previous({ ...rest, ability: PRINTED_STAND_IN });
    return { ...normalized, printed: enumValue(printed, PRINTED_GRANTS, "ability-record-grant.printed") };
  },
};

export const GRANTED_ABILITY_NAME = "granted-ability-name";

/** The marker that opens one named body of a printed grant. */
export const GRANTED_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: GRANTED_ABILITY_NAME,
    version: 1,
    role: "EVENT",
    label: "Granted ability name",
    description: "Names one ability that a printed grant (ability-record-grant with printed) gives, and starts its body. The span is the printed label; a trailing \"(Aura\" stays in the span but not in label, and a parenthesised usage after the label (\"(Once per battle)\") is its own usage-limit leaf. The granted ability's id is the label's slug.",
    starter: { label: "" },
    parameterSchema: {
      type: "object",
      required: ["label"],
      properties: { label: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  },
];

export function normalizeGrantedParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== GRANTED_ABILITY_NAME) return null;
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "label") throw new TypeError("granted-ability-name parameters must be exactly: label.");
  if (typeof input.label !== "string") throw new TypeError("granted-ability-name.label must be a string.");
  const label = input.label.replaceAll("*", "").replace(/\s+/gu, " ").trim();
  if (!label) throw new TypeError("granted-ability-name.label must name the ability.");
  if (/\(|\)|:$/u.test(label)) throw new TypeError("granted-ability-name.label is the ability's name only: no \"(Aura)\", usage or trailing colon.");
  return { label };
}

/** The subject value a unit-filter folds onto a leaf (compile-antecedent.ts FILTERED_UNITS). */
const FILTERED_UNITS = "filtered-units";

export const ABILITY_MODIFIER_ANTECEDENT: FamilyExtension = {
  family: "ability-modifier",
  version: 4,
  description: "As the previous version, and subject can be antecedent: the unit an earlier leaf of the record introduced (\"that enemy unit\", \"that unit\").",
  schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [ANTECEDENT]) }),
  normalize: (input, previous) => input.subject === ANTECEDENT ? standIn(input, "subject", "this-unit", previous) : previous(input),
};

/** Units an activation can be for beyond this unit or model: an earlier leaf's unit, a selected unit, an aura's recipient. */
const ACTIVATION_SUBJECTS = [ANTECEDENT, "selected-unit", "recipient"] as const;

/** The option forms of an ability-activate leaf; a leaf carries at most one. */
const OPTION_FORMS = ["option", "options", "all_options", "chosen", "choose"] as const;

const OPTION_LIST = { type: "array", items: { type: "string", minLength: 1 }, minItems: 2, uniqueItems: true } as const;

/** Two or more distinct option names, sorted so one set of options has one fingerprint. */
function optionList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 2) throw new TypeError(`${label} lists two or more options.`);
  const list = value.map((item, at) => nonEmptyString(item, `${label}[${at}]`));
  if (new Set(list).size !== list.length) throw new TypeError(`${label} lists an option twice.`);
  return [...list].sort();
}

/** `choose: {count, from?}`: the player picks count options now, from the listed ones or from all of them. */
function chooseValue(value: unknown): { count: number; from?: string[] } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("ability-activate.choose must be {count, from?}.");
  const { count, from, ...extra } = value as Record<string, unknown>;
  if (Object.keys(extra).length) throw new TypeError("ability-activate.choose holds only count and from.");
  const picked = boundedInteger(count, 1, 9, "ability-activate.choose.count");
  if (from === undefined) return { count: picked };
  const listed = optionList(from, "ability-activate.choose.from");
  if (picked >= listed.length) throw new TypeError("ability-activate.choose.count must be fewer than the options it picks from; picking all of them is options.");
  return { count: picked, from: listed };
}

export const ABILITY_ACTIVATE_OPTIONS: FamilyExtension = {
  // "the Protector Imperative and the Conqueror Imperative are both active for that unit";
  // "every Blessing of Khorne is active for this unit"; "That doctrine is active for that VEHICLE
  // unit"; "select one combat doctrine to be active for this unit, in addition to any other".
  family: "ability-activate",
  version: 2,
  description: "As the previous version, plus: subject antecedent (an earlier leaf's unit), selected-unit or recipient (the unit an aura reaches); "
    + "at most one option form: option (one option), options (two or more together: \"the Protector Imperative and the Conqueror Imperative are both active\"), "
    + "all_options (every option: \"every Blessing of Khorne is active\"), chosen (the option the player picked earlier in this rule: \"That doctrine is active\"; "
    + "an optionless choice-open (the player's pick) or dice-pool-allocation-open (a roll's pick) before it says who picks and how many) or choose {count, from?} (the player picks count options now, from the listed ones or from all: "
    + "\"the assault doctrine or tactical doctrine is active\"); and additive: the activated options join the ones already active (\"in addition to any other combat doctrine\"). "
    + "Without additive an activation replaces the unit's active option. exclusive is gone: replacing is the default. With no option form the ability resolves now.",
  schema: (previous) => {
    const { exclusive: _exclusive, ...kept } = properties(previous);
    return withProperties({ ...previous, properties: kept }, {
      subject: widenedEnum(previous, "subject", ACTIVATION_SUBJECTS),
      options: optional({ ...OPTION_LIST }),
      all_options: optional({ const: true }),
      chosen: optional({ const: true }),
      choose: optional({
        type: "object", required: ["count"], additionalProperties: false,
        properties: { count: { type: "integer", minimum: 1, maximum: 9 }, from: { ...OPTION_LIST } },
      }),
      additive: optional({ const: true }),
    });
  },
  normalize: (input, previous) => {
    const { options, all_options: all, chosen, choose, additive, exclusive, subject, ...rest } = input;
    if (exclusive !== undefined) throw new TypeError("ability-activate.exclusive is gone from this version: an activation replaces the active option unless additive says otherwise.");
    const forms = OPTION_FORMS.filter((form) => input[form] !== undefined);
    if (forms.length > 1) throw new TypeError(`ability-activate carries one option form; found ${forms.join(", ")}.`);
    if (additive !== undefined && (forms.length === 0 || forms[0] === "all_options")) {
      throw new TypeError("ability-activate.additive keeps other options active, so it needs option, options, chosen or choose (all_options leaves none out).");
    }
    const standIn = (ACTIVATION_SUBJECTS as readonly unknown[]).includes(subject);
    const normalized = previous({ ...rest, subject: standIn ? "this-unit" : subject });
    return {
      ...normalized,
      ...(standIn ? { subject } : {}),
      ...(options !== undefined ? { options: optionList(options, "ability-activate.options") } : {}),
      ...(all !== undefined ? { all_options: constTrue(all, "ability-activate.all_options") } : {}),
      ...(chosen !== undefined ? { chosen: constTrue(chosen, "ability-activate.chosen") } : {}),
      ...(choose !== undefined ? { choose: chooseValue(choose) } : {}),
      ...(additive !== undefined ? { additive: constTrue(additive, "ability-activate.additive") } : {}),
    };
  },
};

export const STANCE_SELECT_ADDITIVE: FamilyExtension = {
  // "select one combat doctrine to be active for this unit …, in addition to any other combat doctrine".
  family: "stance-select-open",
  version: 2,
  description: "As the previous version, plus additive: the picked option joins the options already active for the unit, rather than replacing them (\"in addition to any other combat doctrine\").",
  schema: (previous) => withProperties(previous, { additive: optional({ const: true }) }),
  normalize: (input, previous) => {
    if (input.additive === undefined) return previous(input);
    const { additive, ...rest } = input;
    return { ...previous(rest), additive: constTrue(additive, "stance-select-open.additive") };
  },
};

export const CHOSEN_OPTION_HOLDER_ANTECEDENT: FamilyExtension = {
  // "until the start of your next Command phase, that unit has that ability".
  family: "chosen-option-grant",
  version: 2,
  description: "As the previous version, plus holder antecedent: the unit an earlier leaf introduced holds the chosen options (\"that unit has that ability\").",
  schema: (previous) => withProperties(previous, { holder: widenedEnum(previous, "holder", [ANTECEDENT]) }),
  normalize: (input, previous) => input.holder === ANTECEDENT ? { ...previous({ ...input, holder: "this-unit" }), holder: ANTECEDENT } : previous(input),
};

export const STANCE_CAPACITY_SHARED_OPTIONS: FamilyExtension = {
  // "You can select the assault doctrine or tactical doctrine one additional time per battle":
  // one extra selection, spent on either of the two, not one of each.
  family: "stance-selection-capacity",
  version: 2,
  description: "As the previous version, plus option_ids with allocation choose-one-option: the additional selections are one shared allowance the player may spend on any of these options, and on no other (\"select the assault doctrine or tactical doctrine one additional time per battle\" = additional_selections 1 over both).",
  schema: (previous): Schema => withProperties(previous, {
    option_ids: optional({ ...OPTION_LIST, items: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" }, "x-only-when": { allocation: ["choose-one-option"] } }),
  }),
  normalize: (input, previous) => {
    if (input.option_ids === undefined) return previous(input);
    const { option_ids: ids, ...rest } = input;
    const normalized = previous(rest);
    if (normalized.allocation !== "choose-one-option") throw new TypeError("stance-selection-capacity.option_ids narrows a shared (choose-one-option) allowance; a fixed-option one names option_id.");
    const list = optionList(ids, "stance-selection-capacity.option_ids");
    if (!list.every((id) => /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u.test(id))) throw new TypeError("stance-selection-capacity.option_ids are kebab-case option ids.");
    return { ...normalized, option_ids: list };
  },
};

/** The id shape the condition schema's stance-option-ref takes for both of its fields. */
const ENTITY_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

export const RULE_ACTIVE_OPTION: FamilyExtension = {
  // "If the Protector Imperative is active for that unit": one option of Doctrina Imperatives,
  // not an ability record of its own.
  family: "rule-active",
  version: 2,
  description: "As the previous version, or rule names one option of an option-bearing rule as {ability_id, option_id}: the rule's ability record and the option's stable id within it (\"the Protector Imperative is active\" is an option of Doctrina Imperatives). A string rule still names a whole ability record. The option id is the option's id, never its display label.",
  schema: (previous) => withProperties(previous, {
    rule: {
      oneOf: [
        properties(previous).rule!,
        {
          type: "object", required: ["ability_id", "option_id"], additionalProperties: false,
          properties: { ability_id: { type: "string", pattern: ENTITY_ID.source }, option_id: { type: "string", pattern: ENTITY_ID.source } },
        },
      ],
    },
  }),
  normalize: (input, previous) => {
    const rule = input.rule;
    if (rule === null || typeof rule !== "object") return previous(input);
    if (Array.isArray(rule)) throw new TypeError("rule-active.rule is an ability id or {ability_id, option_id}.");
    const { ability_id: abilityId, option_id: optionId, ...extra } = rule as Record<string, unknown>;
    if (Object.keys(extra).length) throw new TypeError("rule-active.rule option reference holds only ability_id and option_id.");
    if (typeof optionId !== "string" || !ENTITY_ID.test(optionId)) throw new TypeError("rule-active.rule.option_id must be a kebab-case option id.");
    // The previous version checks the ability id (and negated) as a whole-record rule.
    const checked = previous({ ...input, rule: abilityId });
    return { ...checked, rule: { ability_id: checked.rule, option_id: optionId } };
  },
};

export const ABILITY_EXTENSIONS: readonly FamilyExtension[] = [
  ABILITY_ACTIVATE_OPTIONS,
  RULE_ACTIVE_OPTION,
  {
    // "that Blessing is active for friendly TERMINATOR SQUAD units in addition to any other Blessings":
    // the activation's units are the recipients a unit-filter names (compile-additive-option.ts binds
    // the filter onto the activation as subject_filter).
    family: "ability-activate",
    version: 3,
    description: "As the previous version, plus subject filtered-units: the units a unit-filter names before the activation (\"active for friendly K units in addition to\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [FILTERED_UNITS]) }),
    normalize: (input, previous) => input.subject === FILTERED_UNITS ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
  {
    // "that Vow is active for the bearer's unit …, even if you have already selected that Vow this battle".
    family: "ability-activate",
    version: 4,
    description: "As the previous version, plus ignore_consumed: the option picked earlier may be one a once-per-battle selection already used (\"even if you have already selected that Vow this battle\"). It goes with chosen; a pick that says so itself is a choice-open's ignore_consumed.",
    schema: (previous) => withProperties(previous, { ignore_consumed: optional({ const: true }) }),
    normalize: (input, previous) => {
      if (!("ignore_consumed" in input)) return previous(input);
      const { ignore_consumed: ignore, ...rest } = input;
      if (ignore !== true) throw new TypeError("ability-activate.ignore_consumed is true or omitted.");
      const result = previous(rest);
      if (result.chosen !== true) throw new TypeError("ability-activate.ignore_consumed goes with chosen: the option picked earlier.");
      return { ...result, ignore_consumed: true };
    },
  },
  STANCE_SELECT_ADDITIVE,
  CHOSEN_OPTION_HOLDER_ANTECEDENT,
  STANCE_CAPACITY_SHARED_OPTIONS,
  /**
   * An ability a record prints as granted ("X units have the following ability: Name: …"): the
   * grant header says the bodies follow it, and each named body opens with a granted-ability-name
   * leaf. The compiler (`compile-granted.ts`) gives each body to the holder.
   */
  PRINTED_RECORD_GRANT,
  printedKeywordsExtension("ability-modifier", 3),
  /**
   * Subject antecedent: the unit an earlier filter, aura or Stratagem target names ("add 3\" to
   * that unit's Contagion Range"). Lowers to that unit as the modifier's target
   * (compile-antecedent.ts).
   */
  ABILITY_MODIFIER_ANTECEDENT,
  {
    family: "ability-modifier",
    version: 5,
    description: "As the previous version, and a used-ability reference can bind the exact used event by event_var; the binding is required when this modifier changes that event's uses.",
    schema: (previous) => {
      const ability = properties(previous).ability!;
      const branches = (ability.anyOf as Schema[]).map((branch) => {
        const branchProperties = branch.properties as Record<string, Schema> | undefined;
        if (branchProperties?.event?.const !== "used") return branch;
        return {
          ...branch,
          required: ["event", "event_var"],
          properties: {
            ...branchProperties,
            event_var: { type: "string", pattern: "^[a-z][a-z0-9_-]*$", minLength: 1 },
          },
        };
      });
      return withProperties(previous, { ability: { ...ability, anyOf: branches } });
    },
    normalize: (input, previous) => {
      const ability = input.ability;
      if (ability === null || typeof ability !== "object" || Array.isArray(ability)) return previous(input);
      const value = ability as Record<string, unknown>;
      if (value.event !== "used" || value.event_var === undefined) return previous(input);
      const eventVar = value.event_var;
      if (typeof eventVar !== "string" || !/^[a-z][a-z0-9_-]*$/u.test(eventVar)) throw new TypeError("ability-modifier.ability.event_var must be a nonblank binding name.");
      const { event_var: _eventVar, ...unbound } = value;
      const normalized = previous({ ...input, ability: unbound });
      return { ...normalized, ability: { event: "used", event_var: eventVar } };
    },
  },
  {
    // "Add 1 to the number of Orders each **K** model from your army can issue": the modifier's
    // holders are every model a unit-filter after it names (compile-unit-filter-predicates.ts postfixRecipient).
    family: "ability-modifier",
    version: 7,
    description: "As the previous version, plus subject filtered-units: the units or models a unit-filter right after the modifier names (\"the number of Orders each K model from your army can issue\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [FILTERED_UNITS]) }),
    normalize: (input, previous) => input.subject === FILTERED_UNITS ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
];
