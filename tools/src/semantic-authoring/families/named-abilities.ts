import { ANTECEDENT } from "../antecedent-families.js";
import { booleanValue, boundedInteger, enumSet, enumValue, exactKeys } from "../family-validation.js";
import { kebabId, namedId, noParameters, present, type Params } from "./containers-and-abilities-shared.js";
import type { FlatFamily } from "./types.js";

/** Named abilities (use, definition, grant, exchange, suppression), named ranges, list qualifiers, menus and designations. */

// ── Named abilities ─────────────────────────────────────────────────────────────────────────────

const USED_ACTIVITY_KINDS = ["ability", "manoeuvre", "stratagem", "action", "dark-pact", "act-of-faith", "ritual", "order"] as const;
/** The activities a use can name by id; the rest are named only as a kind. */
const NAMED_ACTIVITIES = ["ability", "manoeuvre", "stratagem", "action"] as const;
const ABILITY_USED_SUBJECTS = ["this-unit", "this-model", ANTECEDENT, "event-subject", "recipient", "selected-unit"] as const;
const ABILITY_USED_WINDOWS = ["now", "phase", "turn"] as const;

function manoeuvreOwnRoll(input: Params): Params {
  exactKeys(input, ["die"], "manoeuvre-own-roll");
  return { die: enumValue(input.die, ["D6"], "manoeuvre-own-roll.die") };
}

function byAbility(input: Params): Params {
  exactKeys(input, ["id"], "by-ability");
  return { id: namedId(input.id, "by-ability.id") };
}

function abilityUsed(input: Params): Params {
  const family = "ability-used";
  exactKeys(input, ["subject", "activity", "window", "negated", ...present(input, ["id"])], family);
  const activity = enumValue(input.activity, USED_ACTIVITY_KINDS, `${family}.activity`);
  const result: Params = {
    subject: enumValue(input.subject, ABILITY_USED_SUBJECTS, `${family}.subject`),
    activity,
    window: enumValue(input.window, ABILITY_USED_WINDOWS, `${family}.window`),
    negated: booleanValue(input.negated, `${family}.negated`),
  };
  if ("id" in input) {
    if (!(NAMED_ACTIVITIES as readonly string[]).includes(activity)) throw new TypeError(`${family}.id names one ${NAMED_ACTIVITIES.join(", ")}; a ${activity} is named only as a kind.`);
    result.id = namedId(input.id, `${family}.id`);
  }
  return result;
}

const NAMED_ABILITY_SUBJECTS = ["this-unit", "this-model", ANTECEDENT, "selected-unit", "recipient", "filtered-units"] as const;

/** The parameters hold exactly these keys. */
function ownKeys(input: Params, keys: readonly string[], family: string): void {
  if (Object.keys(input).length !== keys.length || !keys.every((key) => Object.hasOwn(input, key))) {
    throw new TypeError(`${family} parameters must be exactly: ${keys.join(", ") || "none"}.`);
  }
}

/** The subject, ability_id and definition_id every named-ability operation carries. */
function namedAbilityReference(input: Params, family: string): Params {
  if (!(NAMED_ABILITY_SUBJECTS as readonly unknown[]).includes(input.subject)) throw new TypeError(`${family}.subject must be a supported recipient.`);
  return { subject: input.subject, ability_id: kebabId(input.ability_id, `${family}.ability_id`), definition_id: kebabId(input.definition_id, `${family}.definition_id`) };
}

function namedAbilityDefinition(input: Params): Params {
  const family = "named-ability-definition";
  ownKeys(input, ["definition_id", "label"], family);
  if (typeof input.label !== "string" || !input.label.trim()) throw new TypeError(`${family}.label must name the definition.`);
  return { definition_id: kebabId(input.definition_id, `${family}.definition_id`), label: input.label.trim() };
}

function namedAbilityDefinitionEnd(input: Params): Params {
  ownKeys(input, [], "named-ability-definition-end");
  return {};
}

function namedAbilityGrant(input: Params): Params {
  ownKeys(input, ["subject", "ability_id", "definition_id"], "named-ability-grant");
  return namedAbilityReference(input, "named-ability-grant");
}

function namedAbilityExchange(input: Params): Params {
  const family = "named-ability-exchange";
  ownKeys(input, ["subject", "ability_id", "definition_id", "exchange_with"], family);
  const result = namedAbilityReference(input, family);
  result.exchange_with = kebabId(input.exchange_with, `${family}.exchange_with`);
  if (result.exchange_with === result.definition_id) throw new TypeError("A named ability exchange requires two distinct definitions.");
  return result;
}

function namedAbilitySuppression(input: Params): Params {
  const family = "named-ability-suppression";
  ownKeys(input, ["subject", "ability_id", "definition_id", "except_from", ...(Object.hasOwn(input, "additional_definitions") ? ["additional_definitions"] : [])], family);
  const result = namedAbilityReference(input, family);
  if (input.except_from !== "this-ability") throw new TypeError(`${family}.except_from must be this-ability.`);
  result.except_from = input.except_from;
  if (input.additional_definitions !== undefined) {
    if (!Array.isArray(input.additional_definitions) || !input.additional_definitions.length) throw new TypeError(`${family}.additional_definitions must list named abilities.`);
    const additional = input.additional_definitions.map((value) => kebabId(value, `${family}.additional_definitions`));
    if (new Set([result.definition_id, ...additional]).size !== additional.length + 1) throw new TypeError(`${family} cannot suppress the same definition twice.`);
    result.additional_definitions = additional;
  }
  return result;
}

function resourceBeforeAbilityDetermination(input: Params): Params {
  const family = "resource-before-ability-determination";
  ownKeys(input, ["pool"], family);
  return { pool: kebabId(input.pool, `${family}.pool`) };
}

function grantedAbilityName(input: Params): Params {
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "label") throw new TypeError("granted-ability-name parameters must be exactly: label.");
  if (typeof input.label !== "string") throw new TypeError("granted-ability-name.label must be a string.");
  const label = input.label.replaceAll("*", "").replace(/\s+/gu, " ").trim();
  if (!label) throw new TypeError("granted-ability-name.label must name the ability.");
  if (/\(|\)|:$/u.test(label)) throw new TypeError("granted-ability-name.label is the ability's name only: no \"(Aura)\", usage or trailing colon.");
  return { label };
}

// ── Named ranges, list qualifiers, menus and designations ───────────────────────────────────────

const NAMED_RANGE_NAMES = ["contagion", "synapse"] as const;

const namedRangeLeaf = (family: string) => (input: Params): Params => {
  exactKeys(input, ["range", "inches"], family);
  return { range: enumValue(input.range, NAMED_RANGE_NAMES, `${family}.range`), inches: boundedInteger(input.inches, 1, 24, `${family}.inches`) };
};

const IGNORE_STATS = ["M", "T", "Sv", "W", "Ld", "OC", "A", "WS", "BS", "S", "AP", "D", "Range", "detection-range", "psyker-level"] as const;
const IGNORE_ROLLS = [
  "hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage", "attacks", "psychic", "surge", "hazard", "any",
  "resource-die", "blessings-of-khorne", "desperate-escape", "deadly-demise", "all",
] as const;

function ignoreModifierList(input: Params): Params {
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.some((key) => key !== "stats" && key !== "rolls")) throw new TypeError("ignore-modifier-list parameters are stats and/or rolls, and at least one of them.");
  const result: Params = {};
  if (input.stats !== undefined) result.stats = enumSet(input.stats, IGNORE_STATS, "ignore-modifier-list.stats");
  if (input.rolls !== undefined) result.rolls = enumSet(input.rolls, IGNORE_ROLLS, "ignore-modifier-list.rolls");
  return result;
}

const MENU_HOLDERS = ["this-model", "this-unit", ANTECEDENT] as const;

function menuOptionsGrant(input: Params): Params {
  const stray = Object.keys(input).filter((key) => key !== "holder");
  if (stray.length) throw new TypeError(`menu-options-grant has no parameter ${stray[0]}.`);
  if (!(MENU_HOLDERS as readonly unknown[]).includes(input.holder)) throw new TypeError(`menu-options-grant.holder must be one of ${MENU_HOLDERS.join(", ")}.`);
  return { holder: input.holder };
}

function designationOnce(input: Params): Params {
  const stray = Object.keys(input).filter((key) => key !== "tag");
  if (stray.length) throw new TypeError(`designation-once has no parameter ${stray[0]}.`);
  if (typeof input.tag !== "string" || input.tag.trim() === "") throw new TypeError("designation-once.tag names a designation.");
  return { tag: input.tag.trim() };
}

const conditionExclusion = noParameters("condition-exclusion");
const otherwise = noParameters("otherwise");
const additiveOption = noParameters("additive-option");
const namedRangeValue = namedRangeLeaf("named-range-value");
const namedRangeCap = namedRangeLeaf("named-range-cap");

export const NAMED_ABILITIES_FAMILIES: readonly FlatFamily[] = [
  {
    id: "manoeuvre-own-roll",
    version: 1,
    role: "CONDITION",
    label: "Manoeuvre that rolls a die",
    description: "The used manoeuvre is one whose own effect rolls this die (\"an Agile Manoeuvre that involves rolling a D6\"). Folds into the used-manoeuvre moment before it and names the manoeuvres from the faction's menus.",
    starter: {die: ""},
    parameterSchema: {type: "object", required: ["die"], properties: {die: {enum: ["D6"]}}, additionalProperties: false},
    normalize: manoeuvreOwnRoll,
  },
  {
    id: "by-ability",
    version: 1,
    role: "CONDITION",
    label: "Through a named ability",
    description: "The moment just before it happened through this ability (its enrichment ability id): \"pinned by a friendly X unit's Foo ability\", \"a move made using its Bar ability\". Folds into that moment.",
    starter: {id: ""},
    parameterSchema: {type: "object", required: ["id"], properties: {id: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}}, additionalProperties: false},
    normalize: byAbility,
  },
  {
    id: "ability-used",
    version: 1,
    role: "CONDITION",
    label: "Unit used a named ability",
    description: "The subject used a rule of this activity (one named by id for an ability, manoeuvre, Stratagem or action) in the window: the moment being resolved (it is performing it: \"while it is performing a Foo\"), this phase or this turn (\"in a turn in which it used its Bar ability\"). Negated: it did not.",
    starter: {subject: "", activity: "", window: "", negated: false},
    parameterSchema: {type: "object", required: ["subject", "activity", "window", "negated"], properties: {subject: {enum: ["this-unit", "this-model", "antecedent", "event-subject", "recipient", "selected-unit"]}, activity: {enum: ["ability", "manoeuvre", "stratagem", "action", "dark-pact", "act-of-faith", "ritual", "order"]}, id: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", "x-optional": true}, window: {enum: ["now", "phase", "turn"]}, negated: {type: "boolean"}}, additionalProperties: false},
    normalize: abilityUsed,
  },
  {
    id: "named-ability-suppression",
    version: 2,
    role: "EFFECT",
    label: "Named ability suppression",
    description: "Suppress one named ability except when granted by this rule. The exception is source provenance, not an activation choice. additional_definitions names other abilities suppressed by the same operator and provenance exception. Recipient, timing and other operations remain separate leaves.",
    starter: {subject: "this-unit", ability_id: "", definition_id: "", except_from: "this-ability"},
    parameterSchema: {type: "object", properties: {subject: {enum: ["this-unit", "this-model", "antecedent", "selected-unit", "recipient", "filtered-units"]}, ability_id: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, definition_id: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, except_from: {const: "this-ability"}, additional_definitions: {type: "array", items: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, minItems: 1, uniqueItems: true, "x-optional": true}}, required: ["subject", "ability_id", "definition_id", "except_from"], additionalProperties: false},
    normalize: namedAbilitySuppression,
  },
  {
    id: "granted-ability-name",
    version: 1,
    role: "EVENT",
    label: "Granted ability name",
    description: "Names one ability that a printed grant (ability-record-grant with printed) gives, and starts its body. The span is the printed label; a trailing \"(Aura\" stays in the span but not in label, and a parenthesised usage after the label (\"(Once per battle)\") is its own usage-limit leaf. The granted ability's id is the label's slug.",
    starter: {label: ""},
    parameterSchema: {type: "object", required: ["label"], properties: {label: {type: "string", minLength: 1}}, additionalProperties: false},
    normalize: grantedAbilityName,
  },
  {
    id: "named-ability-definition",
    version: 1,
    role: "EVENT",
    label: "Named ability definition",
    description: "A printed heading opens a named ability body. Its stable definition_id belongs to this record; subsequent independently reviewed leaves define its mechanics, up to the next definition heading or definition-end marker. This declares a definition, never grants it.",
    starter: {definition_id: "", label: ""},
    parameterSchema: {type: "object", properties: {definition_id: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, label: {type: "string", minLength: 1}}, required: ["definition_id", "label"], additionalProperties: false},
    normalize: namedAbilityDefinition,
  },
  {
    id: "named-ability-definition-end",
    version: 1,
    role: "EVENT",
    label: "End named ability definitions",
    description: "A section boundary ends the last named ability body and returns subsequent leaves to the containing rule.",
    starter: {},
    parameterSchema: {type: "object", properties: {}, required: [], additionalProperties: false},
    normalize: namedAbilityDefinitionEnd,
  },
  {
    id: "named-ability-grant",
    version: 1,
    role: "EFFECT",
    label: "Named ability grant",
    description: "Grant one named inline definition to the separately specified recipient. Timing, conditions and duration are separate leaves.",
    starter: {subject: "this-unit", ability_id: "", definition_id: ""},
    parameterSchema: {type: "object", properties: {subject: {enum: ["this-unit", "this-model", "antecedent", "selected-unit", "recipient", "filtered-units"]}, ability_id: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, definition_id: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}}, required: ["subject", "ability_id", "definition_id"], additionalProperties: false},
    normalize: namedAbilityGrant,
  },
  {
    id: "named-ability-exchange",
    version: 1,
    role: "EFFECT",
    label: "Named ability exchange",
    description: "Atomically exchange the currently held one of two named abilities for the other. Exactly one must be held; no player chooses a stance. Payment and timing are separate leaves.",
    starter: {subject: "this-unit", ability_id: "", definition_id: "", exchange_with: ""},
    parameterSchema: {type: "object", properties: {subject: {enum: ["this-unit", "this-model", "antecedent", "selected-unit", "recipient", "filtered-units"]}, ability_id: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, definition_id: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, exchange_with: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}}, required: ["subject", "ability_id", "definition_id", "exchange_with"], additionalProperties: false},
    normalize: namedAbilityExchange,
  },
  {
    id: "resource-before-ability-determination",
    version: 1,
    role: "COMBINATOR",
    label: "Resource income before ability determination",
    description: "At a shared phase-end event, resolve this pool's income before checking which named abilities are granted. The income, grants, resource thresholds, phase and player are separate reviewed leaves. This only specifies resolution order.",
    starter: {pool: ""},
    parameterSchema: {type: "object", properties: {pool: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}}, required: ["pool"], additionalProperties: false},
    normalize: resourceBeforeAbilityDetermination,
  },
  {
    id: "named-range-value",
    version: 1,
    role: "CONDITION",
    label: "How far a named range reaches",
    description: "\"the Contagion Range is three inches\": the distance a named range (contagion, synapse) has in the record that defines it. A battle-round leaf right before it limits the value to those battle rounds; the record's values then form one per-battle-round table from the first battle round, whose last entry holds for the rest of the battle. Without a battle-round leaf the range is that distance throughout.",
    starter: {range: "", inches: null},
    parameterSchema: {type: "object", required: ["range", "inches"], properties: {range: {enum: ["contagion", "synapse"]}, inches: {type: "integer", minimum: 1, maximum: 24}}, additionalProperties: false},
    normalize: namedRangeValue,
  },
  {
    id: "named-range-cap",
    version: 1,
    role: "CONDITION",
    label: "Cap on a named range",
    description: "\"Contagion Range cannot be greater than 12\" after modifiers\": the named range, every extension and modifier included, never exceeds this many inches. It caps the aura of the record that defines the range.",
    starter: {range: "", inches: null},
    parameterSchema: {type: "object", required: ["range", "inches"], properties: {range: {enum: ["contagion", "synapse"]}, inches: {type: "integer", minimum: 1, maximum: 24}}, additionalProperties: false},
    normalize: namedRangeCap,
  },
  {
    id: "condition-exclusion",
    version: 1,
    role: "CONDITION",
    label: "Excluding units that",
    description: "Qualifies the conditions that follow it, up to the closing parenthesis (or the end of the sentence): the units meeting all of them are excluded. Takes no parameters.",
    starter: {},
    parameterSchema: {type: "object", properties: {}, additionalProperties: false},
    normalize: conditionExclusion,
  },
  {
    id: "otherwise",
    version: 1,
    role: "COMBINATOR",
    label: "Otherwise",
    description: "The sentence this leaf opens is the else branch of the sentence before it: it applies when that sentence's leading condition does not hold (\"If your unit is not engaged, it can move … Otherwise, it can fall back\"). Takes no parameters.",
    starter: {},
    parameterSchema: {type: "object", properties: {}, additionalProperties: false},
    normalize: otherwise,
  },
  {
    id: "additive-option",
    version: 1,
    role: "CONDITION",
    label: "Additive option qualifier",
    description: "\"in addition to any other <noun>\" after the duration of an option activation. The binder sets additive on the ability-activate before it and drops this leaf. It names no option of its own.",
    starter: {},
    parameterSchema: {type: "object", properties: {}, additionalProperties: false},
    normalize: additiveOption,
  },
  {
    id: "ignore-modifier-list",
    version: 1,
    role: "CONDITION",
    label: "Ignore-modifier list",
    description: "One item of the list after an ignore-modifiers lead-in: the characteristics it names (stats) or the rolls it names (rolls). At least one of the two. The binder folds the items onto the lead-in and drops these leaves.",
    starter: {stats: ["BS"]},
    parameterSchema: {type: "object", properties: {stats: {type: "array", items: {enum: ["M", "T", "Sv", "W", "Ld", "OC", "A", "WS", "BS", "S", "AP", "D", "Range", "detection-range", "psyker-level"]}, minItems: 1, uniqueItems: true}, rolls: {type: "array", items: {enum: ["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage", "attacks", "psychic", "surge", "hazard", "any", "resource-die", "blessings-of-khorne", "desperate-escape", "deadly-demise", "all"]}, minItems: 1, uniqueItems: true}}, anyOf: [{required: ["stats"]}, {required: ["rolls"]}], additionalProperties: false},
    normalize: ignoreModifierList,
  },
  {
    id: "menu-options-grant",
    version: 1,
    role: "EFFECT",
    label: "Every option of a menu",
    description: "\"It has both of the following abilities\" / \"has all of those abilities\" after a menu: every option of the last menu opened before it applies to the holder at once, without a choice. holder this-model or this-unit, or antecedent for the unit an earlier leaf introduced (\"such a unit\"). A record with no menu opener before it cannot compile.",
    starter: {holder: ""},
    parameterSchema: {type: "object", required: ["holder"], properties: {holder: {enum: ["this-model", "this-unit", "antecedent"]}}, additionalProperties: false},
    normalize: menuOptionsGrant,
  },
  {
    id: "designation-once",
    version: 1,
    role: "RESTRICTION",
    label: "Designation applied once",
    description: "\"Each enemy unit can only be marked as a Spotted unit once per phase\": the selection before the leaf takes only units that do not already carry the tag. tag is the designation (a registered designation id). The tag the record applies must last at most the window the rule prints.",
    starter: {tag: ""},
    parameterSchema: {type: "object", required: ["tag"], properties: {tag: {type: "string", minLength: 1}}, additionalProperties: false},
    normalize: designationOnce,
  },
];
