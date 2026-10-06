import { ANTECEDENT } from "./antecedent-families.js";
import { constTrue, nonEmptyString } from "./buff-families.js";
import { type FamilyExtension, optional, properties, type Schema, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { boundedInteger } from "./family-validation.js";

/**
 * Family versions for activating the options of an option-bearing rule (combat doctrines,
 * Doctrina Imperatives, Blessings of Khorne, Plagues): which options an activation makes active,
 * for whom, and whether it replaces the unit's active option or joins it. They are listed in
 * FAMILY_EXTENSIONS_11.
 */

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
  description: "As the previous version, plus holder antecedent: the unit an earlier leaf introduced holds the chosen options (\"that unit has that ability\").",
  schema: (previous) => withProperties(previous, { holder: widenedEnum(previous, "holder", [ANTECEDENT]) }),
  normalize: (input, previous) => input.holder === ANTECEDENT ? { ...previous({ ...input, holder: "this-unit" }), holder: ANTECEDENT } : previous(input),
};

export const STANCE_CAPACITY_SHARED_OPTIONS: FamilyExtension = {
  // "You can select the assault doctrine or tactical doctrine one additional time per battle":
  // one extra selection, spent on either of the two, not one of each.
  family: "stance-selection-capacity",
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
