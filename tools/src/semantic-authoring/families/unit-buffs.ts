import { DESIGNATION_IDS } from "../../translate/designations.js";
import { boundedInteger, enumSet, enumValue, exactKeys } from "../family-validation.js";
import type { FlatFamily } from "./types.js";
import {
  type Params, ANTECEDENT, UNIT_SUBJECTS, DICE, ENTITY_ID, UNIT_KEYWORD, LEADING_APOSTROPHE, ENTITY_ID_SCHEMA,
  DICE_SCHEMA, MODEL_KEYWORDS_SCHEMA, isObject, nonEmptyString, constTrue, strings, modelKeywordList,
} from "./buffs-and-weapons-shared.js";

/** Unit buffs: fighting first, saves, keywords, activated and core abilities, sticky objectives, acting after a move, Advance rolls and regained wounds. */

const PRINTED_KEYWORD = /^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$/u;
const SELECTION_NAME = /^[a-z][a-z0-9_-]*$/u;
const THRESHOLD_SCHEMA = { type: "integer", minimum: 2, maximum: 6 };
const PRINTED_KEYWORD_ITEMS = { type: "string", pattern: "^'?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$" };

/** A core ability's rated value: an integer from 1 to 36, or the unit's own datasheet rating. */
function abilityGrantValue(value: unknown, label: string): number | { rating: true } {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 36) return value;
  if (isObject(value) && value.rating === true && Object.keys(value).length === 1) return { rating: true };
  throw new TypeError(`${label} must be an integer from 1 to 36 or {rating: true}.`);
}

function subjectOnly(family: string, subjects: readonly string[]): (input: Params) => Params {
  return (input) => {
    exactKeys(input, ["subject"], family);
    return { subject: enumValue(input.subject, subjects, `${family}.subject`) };
  };
}

function thresholdBuff(family: string, subjects: readonly string[], extra: readonly string[], apostrophe: boolean): (input: Params) => Params {
  return (input) => {
    const hasKeywords = "model_keywords" in input;
    exactKeys(input, ["subject", "threshold", ...extra, ...(hasKeywords ? ["model_keywords"] : [])], family);
    if (hasKeywords && input.subject === "this-model") throw new TypeError(`${family}.model_keywords picks models of a unit; its subject cannot be this-model.`);
    const result: Params = {
      subject: enumValue(input.subject, subjects, `${family}.subject`),
      threshold: boundedInteger(input.threshold, 2, 6, `${family}.threshold`),
    };
    if (extra.includes("against")) result.against = fnpAgainst(input.against, `${family}.against`);
    if (hasKeywords) result.model_keywords = modelKeywordList(input.model_keywords, `${family}.model_keywords`, apostrophe ? { family, context: strings(input) } : undefined);
    return result;
  };
}

/** What a Feel No Pain covers, one at a time, in the order the rules list them. */
const FNP_AGAINST_ITEMS = ["mortal", "psychic", "devastating-wounds"] as const;

/**
 * A Feel No Pain's `against`: one closed value, or a list of two or more covered kinds ("against
 * mortal wounds, Psychic Attacks and Critical Wounds caused by attacks with [DEVASTATING WOUNDS]"),
 * in canonical order. Mortal wounds with Psychic Attacks alone keep their own value.
 */
function fnpAgainst(value: unknown, label: string): string | string[] {
  if (!Array.isArray(value)) return enumValue(value, ["all", "mortal", "psychic", "psychic-and-mortal", "damage-1-unmodified"], label);
  const items = enumSet(value, FNP_AGAINST_ITEMS, label);
  if (items.length < 2) throw new TypeError(`${label} as a list names two or more kinds; one kind is its own value.`);
  if (items.length === 2 && items.includes("mortal") && items.includes("psychic")) throw new TypeError(`${label}: mortal wounds and Psychic Attacks are psychic-and-mortal.`);
  return FNP_AGAINST_ITEMS.filter((item) => items.includes(item));
}

/** A keyword-grant list item: an optional leading apostrophe, then accented capitals checked without their accents. */
function grantedKeywords(value: unknown, label: string, raw: readonly string[], staged: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must list at least one unit keyword.`);
  const plain = value.map((item) => {
    if (typeof item !== "string") throw new TypeError(`${label} keyword ${JSON.stringify(item)} is not a unit keyword.`);
    let body = item;
    if (LEADING_APOSTROPHE.test(item)) {
      body = item.slice(1);
      if (raw.includes(body)) throw new TypeError(`keyword-grant names ${body} both with and without a leading apostrophe.`);
    }
    let checked = body;
    if (PRINTED_KEYWORD.test(body) && !/^[\x20-\x7e]*$/u.test(body)) {
      checked = body.normalize("NFD").replace(/\p{M}/gu, "");
      if (staged.includes(checked)) throw new TypeError(`keyword-grant names ${checked} both with and without accents.`);
    }
    if (!UNIT_KEYWORD.test(checked)) throw new TypeError(`${label} keyword ${JSON.stringify(item)} is not a unit keyword.`);
    return checked;
  });
  if (new Set(plain).size !== plain.length) throw new TypeError(`${label} lists a keyword twice.`);
  return value as string[];
}

function normalizeKeywordGrant(input: Params): Params {
  const keys = Object.keys(input);
  if (!Object.hasOwn(input, "subject") || !Object.hasOwn(input, "keywords") || !keys.every((key) => key === "subject" || key === "keywords" || key === "replaces")) {
    throw new TypeError("keyword-grant parameters must contain subject and keywords, and optional replaces only.");
  }
  const raw = strings(input);
  const staged = raw.map((text) => (LEADING_APOSTROPHE.test(text) ? text.slice(1) : text));
  return {
    subject: enumValue(input.subject, ["this-unit", "this-model", ANTECEDENT, "target"], "keyword-grant.subject"),
    keywords: grantedKeywords(input.keywords, "keyword-grant.keywords", raw, staged),
    ...(Object.hasOwn(input, "replaces") ? { replaces: grantedKeywords(input.replaces, "keyword-grant.replaces", raw, staged) } : {}),
  };
}

/** Two or more distinct option names, sorted so one set of options has one fingerprint. */
function optionList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 2) throw new TypeError(`${label} lists two or more options.`);
  const list = value.map((item, at) => nonEmptyString(item, `${label}[${at}]`));
  if (new Set(list).size !== list.length) throw new TypeError(`${label} lists an option twice.`);
  return [...list].sort();
}

function chooseValue(value: unknown): { count: number; from?: string[] } {
  if (!isObject(value)) throw new TypeError("ability-activate.choose must be {count, from?}.");
  const { count, from, ...extra } = value;
  if (Object.keys(extra).length) throw new TypeError("ability-activate.choose holds only count and from.");
  const picked = boundedInteger(count, 1, 9, "ability-activate.choose.count");
  if (from === undefined) return { count: picked };
  const listed = optionList(from, "ability-activate.choose.from");
  if (picked >= listed.length) throw new TypeError("ability-activate.choose.count must be fewer than the options it picks from; picking all of them is options.");
  return { count: picked, from: listed };
}

const ACTIVATE_KEYS = ["subject", "ability", "option", "options", "all_options", "chosen", "choose", "additive", "ignore_consumed", "from_event", "immediate"];
const OPTION_FORMS = ["option", "options", "all_options", "chosen", "choose"] as const;

function normalizeAbilityActivate(input: Params): Params {
  if (input.exclusive !== undefined) throw new TypeError("ability-activate takes no exclusive: an activation replaces the active option unless additive says otherwise.");
  if (!Object.hasOwn(input, "subject") || !Object.hasOwn(input, "ability") || !Object.keys(input).every((key) => ACTIVATE_KEYS.includes(key))) {
    throw new TypeError(`ability-activate parameters must contain subject and ability, and optional ${ACTIVATE_KEYS.slice(2).join(", ")} only.`);
  }
  const forms = OPTION_FORMS.filter((form) => input[form] !== undefined);
  if (forms.length > 1) throw new TypeError(`ability-activate carries one option form; found ${forms.join(", ")}.`);
  if (input.additive !== undefined && (forms.length === 0 || forms[0] === "all_options")) {
    throw new TypeError("ability-activate.additive keeps other options active, so it needs option, options, chosen or choose (all_options leaves none out).");
  }
  const result: Params = {
    subject: enumValue(input.subject, ["this-unit", "this-model", ANTECEDENT, "selected-unit", "recipient", "filtered-units"], "ability-activate.subject"),
    ability: typeof input.ability === "string" && ENTITY_ID.test(input.ability) ? input.ability : (() => { throw new TypeError("ability-activate.ability must be a kebab-case entity id."); })(),
  };
  if (input.option !== undefined) result.option = nonEmptyString(input.option, "ability-activate.option");
  if (input.options !== undefined) result.options = optionList(input.options, "ability-activate.options");
  if (input.all_options !== undefined) result.all_options = constTrue(input.all_options, "ability-activate.all_options");
  if (input.chosen !== undefined) result.chosen = constTrue(input.chosen, "ability-activate.chosen");
  if (input.choose !== undefined) result.choose = chooseValue(input.choose);
  if (input.additive !== undefined) result.additive = constTrue(input.additive, "ability-activate.additive");
  if ("ignore_consumed" in input) {
    if (input.ignore_consumed !== true) throw new TypeError("ability-activate.ignore_consumed is true or omitted.");
    if (result.chosen !== true) throw new TypeError("ability-activate.ignore_consumed goes with chosen: the option picked earlier.");
    result.ignore_consumed = true;
  }
  if ("from_event" in input) {
    if (input.from_event !== true) throw new TypeError("ability-activate.from_event is true or omitted.");
    const others = ["option", "options", "all_options", "chosen", "choose", "additive", "ignore_consumed"].filter((key) => result[key] !== undefined);
    if (others.length) throw new TypeError(`ability-activate.from_event names the triggering use's option; it takes no ${others.join(" or ")}.`);
    result.from_event = true;
  }
  if ("immediate" in input) {
    if (input.immediate !== true) throw new TypeError("ability-activate.immediate is true or omitted.");
    const others = ["options", "all_options", "chosen", "choose", "additive", "ignore_consumed", "from_event"].filter((key) => result[key] !== undefined);
    if (result.option === undefined || others.length) throw new TypeError("ability-activate.immediate resolves one named option once, now: it takes option and no other option form.");
    result.immediate = true;
  }
  return result;
}

const CORE_ABILITY_IDS = [
  "benefit-of-cover", "deadly-demise", "deep-strike", "feel-no-pain", "fights-first", "firing-deck", "hover",
  "infiltrators", "leader", "lone-operative", "scouts", "stealth", "support", "super-heavy-walker",
];

function normalizeCoreAbilityGrant(input: Params): Params {
  const ability = enumValue(input.ability, CORE_ABILITY_IDS, "core-ability-grant.ability");
  // Scouts, Firing Deck and Deadly Demise carry a rating; Deep Strike and Lone Operative may.
  const optionalValue = ability === "deep-strike" || ability === "lone-operative";
  const valued = ["scouts", "firing-deck", "deadly-demise"].includes(ability) || (optionalValue && "value" in input);
  exactKeys(input, valued ? ["subject", "ability", "value"] : ["subject", "ability"], "core-ability-grant");
  const result: Params = { subject: enumValue(input.subject, ["this-unit", "this-model", ANTECEDENT, "bearer-transport", "target"], "core-ability-grant.subject"), ability };
  if (!valued) return result;
  if (ability === "lone-operative" && !Number.isInteger(input.value)) throw new TypeError("core-ability-grant.value for Lone Operative is a range in inches.");
  if (ability === "deadly-demise" && typeof input.value === "string") {
    if (!DICE.test(input.value)) throw new TypeError("core-ability-grant.value for Deadly Demise is a whole number, {rating}, or a dice rating such as D6 or D3+1.");
    return { ...result, value: input.value };
  }
  return { ...result, value: abilityGrantValue(input.value, "core-ability-grant.value") };
}

const STICKY_SUBJECTS = ["this-unit", "this-model", "selected-unit", "recipient", "selected-objective"];

function normalizeStickyObjective(input: Params): Params {
  exactKeys(input, ["subject", "tag"].filter((key) => key in input), "sticky-objective");
  const result: Params = {};
  if ("subject" in input) result.subject = enumValue(input.subject, STICKY_SUBJECTS, "sticky-objective.subject");
  // "That objective marker is said to be Corrupted": the secured marker also carries a registered designation.
  if ("tag" in input) {
    if (typeof input.tag !== "string" || !DESIGNATION_IDS.has(input.tag)) throw new TypeError(`sticky-objective.tag ${JSON.stringify(input.tag)} is not a registered designation.`);
    if (result.subject === "selected-objective") throw new TypeError("sticky-objective.tag names the markers a unit controls; the selected objective marker takes no tag.");
    result.tag = input.tag;
  }
  return result;
}

function normalizeActAfterMove(input: Params): Params {
  exactKeys(input, ["subject", "moves", "acts"], "act-after-move");
  return {
    subject: enumValue(input.subject, ["this-unit", "this-model", ANTECEDENT], "act-after-move.subject"),
    moves: enumSet(input.moves, ["advance", "fall-back"], "act-after-move.moves"),
    acts: enumSet(input.acts, ["shoot", "charge"], "act-after-move.acts"),
  };
}

const WOUND_AMOUNTS = ["1", "2", "3", "D3", "D6", "D3+3", "D3+1", "D3+2", "all", "that-many", "2D3"];

function normalizeRegainWounds(input: Params): Params {
  const { selection, ...rest } = input;
  exactKeys(rest, ["subject", "amount", ...("per" in rest ? ["per"] : [])], "regain-wounds");
  const result: Params = {
    subject: enumValue(rest.subject, ["this-unit", "this-model", ANTECEDENT], "regain-wounds.subject"),
    amount: enumValue(rest.amount, WOUND_AMOUNTS, "regain-wounds.amount"),
  };
  if ("per" in rest) result.per = enumValue(rest.per, ["model", "unit", "one-model"], "regain-wounds.per");
  if (selection !== undefined) {
    if (rest.subject !== ANTECEDENT) throw new TypeError("regain-wounds.selection names which selected unit subject antecedent is; it takes no other subject.");
    if (typeof selection !== "string" || !SELECTION_NAME.test(selection) || selection.length > 40) throw new TypeError("regain-wounds.selection is a lowercase selection name.");
    result.selection = selection;
  }
  return result;
}

export const UNIT_BUFFS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "fights-first",
    version: 2,
    role: "EFFECT",
    label: "Fights First",
    description: "Models have the Fights First ability. \"The bearer\" is this model.",
    starter: { subject: "this-unit" },
    parameterSchema: { type: "object", required: ["subject"], properties: { subject: { enum: UNIT_SUBJECTS } }, additionalProperties: false },
    normalize: subjectOnly("fights-first", UNIT_SUBJECTS),
  },
  {
    id: "invulnerable-save",
    version: 6,
    role: "EFFECT",
    label: "Invulnerable save",
    description: "Models have an invulnerable save of the threshold or better. \"The bearer\" is this model. subject can also be antecedent (the unit an earlier leaf of the record introduced, \"that enemy unit\", \"it\", bound when the record compiles), bearer-transport (the Transport the model is embarked within), or target (the attack's target: the target unit's models get the invulnerable save, which the DSL names as the defender). model_keywords: the invulnerable save applies to only the subject's models with every listed keyword (\"**CHARACTER** models in this unit\").",
    starter: { subject: "this-unit", threshold: null },
    parameterSchema: {
      type: "object",
      required: ["subject", "threshold"],
      properties: { subject: { enum: ["this-unit", "this-model", ANTECEDENT, "bearer-transport", "target"] }, threshold: THRESHOLD_SCHEMA, model_keywords: MODEL_KEYWORDS_SCHEMA },
      additionalProperties: false,
    },
    normalize: thresholdBuff("invulnerable-save", ["this-unit", "this-model", ANTECEDENT, "bearer-transport", "target"], [], false),
  },
  {
    id: "feel-no-pain",
    version: 6,
    role: "EFFECT",
    label: "Feel No Pain",
    description: "Models ignore wounds on a roll of the threshold or more, optionally only against mortal wounds or psychic attacks. against damage-1-unmodified: only against attacks with an unmodified Damage characteristic of 1; a list of two or more of mortal, psychic and devastating-wounds (Critical Wounds caused by attacks with [DEVASTATING WOUNDS]) covers each. \"The bearer\" is this model. subject can also be antecedent: the unit an earlier leaf of the record introduced (\"that enemy unit\", \"it\"), bound when the record compiles. model_keywords: the Feel No Pain applies to only the subject's models with every listed keyword (\"**CHARACTER** models in this unit\"); a keyword can start with an apostrophe as the rules print it ('ARDMOB).",
    starter: { subject: "this-unit", threshold: null, against: "all" },
    parameterSchema: {
      type: "object",
      required: ["subject", "threshold", "against"],
      properties: {
        subject: { enum: ["this-unit", "this-model", ANTECEDENT] },
        threshold: THRESHOLD_SCHEMA,
        against: { anyOf: [
          { enum: ["all", "mortal", "psychic", "psychic-and-mortal", "damage-1-unmodified"] },
          { type: "array", items: { enum: [...FNP_AGAINST_ITEMS] }, minItems: 2, uniqueItems: true },
        ] },
        model_keywords: MODEL_KEYWORDS_SCHEMA,
      },
      additionalProperties: false,
    },
    normalize: thresholdBuff("feel-no-pain", ["this-unit", "this-model", ANTECEDENT], ["against"], true),
  },
  {
    id: "keyword-grant",
    version: 5,
    role: "EFFECT",
    label: "Grant unit keywords",
    description: "Gives the target unit keywords, optionally naming which keywords they replace. subject can also be antecedent (the unit an earlier leaf of the record introduced, \"that enemy unit\", \"it\", bound when the record compiles) or target (the attack's target unit gains keywords, which the DSL names as the defender). A keyword can carry accented capitals (KÂHL) and start with an apostrophe ('ARDMOB) as the rules print it.",
    starter: { subject: "this-unit", keywords: [] },
    parameterSchema: {
      type: "object",
      required: ["subject", "keywords"],
      properties: {
        subject: { enum: ["this-unit", "this-model", ANTECEDENT, "target"] },
        keywords: { type: "array", items: PRINTED_KEYWORD_ITEMS, minItems: 1, uniqueItems: true },
        replaces: { type: "array", items: PRINTED_KEYWORD_ITEMS, minItems: 1, uniqueItems: true },
      },
      additionalProperties: false,
    },
    normalize: normalizeKeywordGrant,
  },
  {
    id: "ability-activate",
    version: 6,
    role: "EFFECT",
    label: "Activate an ability now",
    description: "Makes a named ability resolve at once, or activates some of its options, for this unit or model, an earlier leaf's unit (antecedent), a selected unit, the unit an aura reaches (recipient), or the units a unit-filter names before the activation (filtered-units: \"active for friendly K units in addition to\"). "
      + "At most one option form: option (one option), options (two or more together: \"the Protector Imperative and the Conqueror Imperative are both active\"), all_options (every option: \"every Blessing of Khorne is active\"), "
      + "chosen (the option the player picked earlier in this rule: \"That doctrine is active\"; an optionless choice-open (the player's pick) or dice-pool-allocation-open (a roll's pick) before it says who picks and how many), "
      + "or choose {count, from?} (the player picks count options at once, from the listed ones or from all: \"the assault doctrine or tactical doctrine is active\"). With no option form the ability resolves at once. "
      + "additive: the activated options join the ones already active (\"in addition to any other combat doctrine\"); without it an activation replaces the unit's active option. "
      + "ignore_consumed goes with chosen: the option picked earlier may be one a once-per-battle selection already used (\"even if you have already selected that Vow this battle\"); a pick that says so itself is a choice-open's ignore_consumed. "
      + "from_event: the option active is the one the triggering use of another ability selected (\"the selected combat doctrine is active for this unit\" after a Strategic Acumen use); it takes no other option form, and replaces the unit's active option."
      + " immediate, with option: that option resolves once, now, for the subject instead of becoming active (\"Your unit immediately Regenerates (See Feed the Swarm)\", the Regenerate choice of Feed the Swarm).",
    starter: { subject: "this-unit", ability: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "ability"],
      properties: {
        subject: { enum: ["this-unit", "this-model", ANTECEDENT, "selected-unit", "recipient", "filtered-units"] },
        ability: ENTITY_ID_SCHEMA,
        option: { type: "string", minLength: 1 },
        options: { type: "array", items: { type: "string", minLength: 1 }, minItems: 2, uniqueItems: true, "x-optional": true },
        all_options: { const: true, "x-optional": true },
        chosen: { const: true, "x-optional": true },
        choose: {
          type: "object",
          required: ["count"],
          additionalProperties: false,
          properties: { count: { type: "integer", minimum: 1, maximum: 9 }, from: { type: "array", items: { type: "string", minLength: 1 }, minItems: 2, uniqueItems: true } },
          "x-optional": true,
        },
        additive: { const: true, "x-optional": true },
        ignore_consumed: { const: true, "x-optional": true },
        from_event: { const: true, "x-optional": true },
        immediate: { const: true, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeAbilityActivate,
  },
  {
    id: "core-ability-grant",
    version: 7,
    role: "EFFECT",
    label: "Grant a core ability",
    description: "Gives the target a core rulebook ability such as Scouts, Deep Strike, Firing Deck, or Benefit of Cover, with its datasheet rating when the ability carries one. Lone Operative can carry its range in inches as value; Deep Strike can be granted without a value, since it carries no rating; Deadly Demise can carry a dice rating (\"D6\", \"D3+1\", \"2D6\") as value. subject can also be antecedent (the unit an earlier leaf of the record introduced, \"that enemy unit\", \"it\", bound when the record compiles), bearer-transport (the Transport the unit with the ability is embarked within, granted a valued ability), or target (the attack's target unit gains the ability, such as the Benefit of Cover against that attack, which the DSL names as the defender).",
    starter: { subject: "this-unit", ability: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "ability"],
      properties: {
        subject: { enum: ["this-unit", "this-model", ANTECEDENT, "bearer-transport", "target"] },
        ability: { enum: CORE_ABILITY_IDS },
        value: {
          anyOf: [
            { type: "integer", minimum: 1, maximum: 36 },
            { type: "object", required: ["rating"], properties: { rating: { const: true } }, additionalProperties: false },
            DICE_SCHEMA,
          ],
          "x-only-when": { ability: ["scouts", "deep-strike", "firing-deck", "deadly-demise", "lone-operative"] },
        },
      },
      additionalProperties: false,
    },
    normalize: normalizeCoreAbilityGrant,
  },
  {
    id: "sticky-objective",
    version: 5,
    role: "EFFECT",
    label: "Sticky objective",
    description: "\"That objective marker remains under your control until your opponent's Level of Control over it is greater than yours at the end of a phase.\" Being within range of it is a separate condition. subject names whose objectives (default this-unit): a selected unit, or each unit a for-each loop reaches (recipient); selected-objective is the one marker this record's select-objective chose (\"that objective is secured\"). tag: a registered designation the secured markers also carry (\"That objective marker is said to be Corrupted\"), read later by an objective filter; not with selected-objective.",
    starter: {},
    parameterSchema: { type: "object", properties: { subject: { enum: STICKY_SUBJECTS }, tag: { type: "string", pattern: "^[a-z][a-z0-9-]*$", "x-optional": true } }, additionalProperties: false },
    normalize: normalizeStickyObjective,
  },
  {
    id: "act-after-move",
    version: 3,
    role: "EFFECT",
    label: "Shoot or charge after advancing or falling back",
    description: "A unit that Advanced or Fell Back this turn is still eligible to shoot, declare a charge, or both. Pick every move and action the wording names. \"The bearer\" is this model. subject can also be antecedent: the unit an earlier leaf introduced (\"your **VEHICLE** unit\" + \"is eligible to shoot and declare a charge in a turn in which it Fell Back\").",
    starter: { subject: "", moves: [], acts: [] },
    parameterSchema: {
      type: "object",
      required: ["subject", "moves", "acts"],
      properties: {
        subject: { enum: ["this-unit", "this-model", ANTECEDENT] },
        moves: { type: "array", items: { enum: ["advance", "fall-back"] }, minItems: 1, uniqueItems: true },
        acts: { type: "array", items: { enum: ["shoot", "charge"] }, minItems: 1, uniqueItems: true },
      },
      additionalProperties: false,
    },
    normalize: normalizeActAfterMove,
  },
  {
    id: "no-advance-roll",
    version: 4,
    role: "EFFECT",
    label: "No Advance roll",
    description: "\"Do not make an Advance roll for it\". What happens instead (add 6\" to Move) is its own leaf; the \"instead\" between them joins rather than replaces. \"The bearer\" is this model. subject can also be antecedent (the unit an earlier leaf introduced: \"do not make an Advance roll for it\") or event-subject (the triggering unit a move-ended event names).",
    starter: { subject: "" },
    parameterSchema: { type: "object", required: ["subject"], properties: { subject: { enum: ["this-unit", "this-model", ANTECEDENT, "event-subject"] } }, additionalProperties: false },
    normalize: subjectOnly("no-advance-roll", ["this-unit", "this-model", ANTECEDENT, "event-subject"]),
  },
  {
    id: "regain-wounds",
    version: 9,
    role: "EFFECT",
    label: "Regain lost wounds",
    description: "A model, or each model in a unit, regains lost wounds (heals). Adding to the Wounds characteristic is a different leaf. The amount is a printed number or dice amount (D3+1, D3+2, 2D3 …), all (\"regains all of its lost wounds\"), or that-many (as many wounds as the mortal wounds printed before it in its sentence, from the same roll: \"suffers D3+1 mortal wounds and … regains up to that many lost wounds\"). "
      + "per model is each model in the subject; per one-model is one model in it (\"one model in your unit regains up to 3 lost wounds\"). subject can also be antecedent: the unit an earlier leaf of the record introduced (\"that enemy unit\", \"it\"), bound when the record compiles. "
      + "selection: the bind_as of the select-unit the subject names when the record selects several units (\"one model in the selected Y unit regains\"); it goes only with subject antecedent.",
    starter: { subject: "", amount: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "amount"],
      properties: {
        subject: { enum: ["this-unit", "this-model", ANTECEDENT] },
        amount: { enum: WOUND_AMOUNTS },
        per: { enum: ["model", "unit", "one-model"] },
        selection: { type: "string", pattern: SELECTION_NAME.source, minLength: 1, maxLength: 40, "x-only-when": { subject: [ANTECEDENT] }, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeRegainWounds,
  },
];
