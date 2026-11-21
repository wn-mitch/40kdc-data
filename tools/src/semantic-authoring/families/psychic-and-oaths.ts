import { boundedInteger, enumSet, enumValue, exactKeys } from "../family-validation.js";
import { namedId, noParameters, present, type Params } from "./containers-and-abilities-shared.js";
import type { FlatFamily } from "./types.js";

/** Psychic abilities and Rituals, and the Oath families. */

// ── Psychic abilities and Rituals ───────────────────────────────────────────────────────────────

function psychicLevelCost(input: Params): Params {
  exactKeys(input, ["level"], "psychic-level-cost");
  return { level: boundedInteger(input.level, 1, 6, "psychic-level-cost.level") };
}

function testDoubles(input: Params): Params {
  exactKeys(input, ["on"], "test-doubles");
  return { on: enumValue(input.on, ["double"], "test-doubles.on") };
}

/** psychic-test: a ritual menu's Psychic test; dark-pact-test: the Leadership test of the Dark Pact moment (a 2D6 roll). */
const ROLL_TOTAL_VARS = ["psychic-test", "dark-pact-test"] as const;

function rollTotal(input: Params): Params {
  exactKeys(input, ["roll_var", "min"], "roll-total");
  return { roll_var: enumValue(input.roll_var, ROLL_TOTAL_VARS, "roll-total.roll_var"), min: boundedInteger(input.min, 2, input.roll_var === "dark-pact-test" ? 12 : 18, "roll-total.min") };
}

// ── Oaths ───────────────────────────────────────────────────────────────────────────────────────

const OATH_DOMAINS = ["deed", "quality"] as const;
const OATH_SUBJECTS = ["this-model", "this-unit"] as const;
const OATH_DURATIONS = ["phase", "turn", "battle-round", "battle", "permanent"] as const;
const OWNERS = ["friendly", "enemy", "any"] as const;

/** An Oath leaf: its ability, plus subject and domains where the family takes them. */
const oathLeaf = (family: string, keys: readonly string[]) => (input: Params): Params => {
  exactKeys(input, keys, family);
  const result: Params = { ability: namedId(input.ability, `${family}.ability`) };
  if ("subject" in input) result.subject = enumValue(input.subject, OATH_SUBJECTS, `${family}.subject`);
  if ("domains" in input) result.domains = enumSet(input.domains, OATH_DOMAINS, `${family}.domains`);
  return result;
};

function oathQualityPersistence(input: Params): Params {
  const family = "oath-quality-persistence";
  exactKeys(input, ["ability", "recipient_ability", "owner", ...present(input, ["duration"])], family);
  return {
    ability: namedId(input.ability, `${family}.ability`),
    recipient_ability: namedId(input.recipient_ability, `${family}.recipient_ability`),
    owner: enumValue(input.owner, OWNERS, `${family}.owner`),
    ...("duration" in input ? { duration: enumValue(input.duration, OATH_DURATIONS, `${family}.duration`) } : {}),
  };
}

function oathDeedReward(input: Params): Params {
  const family = "oath-deed-reward";
  exactKeys(input, ["ability", "subject", "applies_to"], family);
  return {
    ability: namedId(input.ability, `${family}.ability`),
    subject: enumValue(input.subject, OATH_SUBJECTS, `${family}.subject`),
    applies_to: enumValue(input.applies_to, ["additional"], `${family}.applies_to`),
  };
}

function oathRewardSelection(input: Params): Params {
  exactKeys(input, ["method"], "oath-reward-selection");
  return { method: enumValue(input.method, ["any", "chosen", "random"], "oath-reward-selection.method") };
}

const ritualMenuOpen = noParameters("ritual-menu-open");
const ritualManifest = noParameters("ritual-manifest");
const oathDetermine = oathLeaf("oath-determine", ["ability", "subject"]);
const oathFulfilled = oathLeaf("oath-fulfilled", ["ability"]);
const oathSelectionHistory = oathLeaf("oath-selection-history", ["ability", "subject", "domains"]);
const oathDuplicateResult = oathLeaf("oath-duplicate-result", ["ability", "subject", "domains"]);
const oathExhaustion = oathLeaf("oath-exhaustion", ["ability", "subject", "domains"]);

export const PSYCHIC_AND_OATHS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "psychic-level-cost",
    version: 1,
    role: "RESTRICTION",
    label: "Psychic level cost",
    description: "The psychic level a psychic ability costs (\"psychic level 2\" in its heading). The ability can be used only while the unit's psychic-level pool holds that many, and each use spends them.",
    starter: {level: 1},
    parameterSchema: {type: "object", required: ["level"], properties: {level: {type: "integer", minimum: 1, maximum: 6}}, additionalProperties: false},
    normalize: psychicLevelCost,
  },
  {
    id: "ritual-menu-open",
    version: 1,
    role: "EFFECT",
    label: "Ritual menu",
    description: "\"can attempt Rituals from those listed\": the Rituals after it are named options (each with its Warp Charge), attempted with the Psychic test printed between this leaf and the first Ritual. Takes no parameters.",
    starter: {},
    parameterSchema: {type: "object", properties: {}, additionalProperties: false},
    normalize: ritualMenuOpen,
  },
  {
    id: "ritual-manifest",
    version: 1,
    role: "COMBINATOR",
    label: "Ritual manifests",
    description: "\"If that model is not destroyed, the combined total of all the dice … is the Psychic test result. If this equals or exceeds the Warp Charge value …, that model manifests that Ritual\": the rule that closes a ritual menu's Psychic test. Takes no parameters.",
    starter: {},
    parameterSchema: {type: "object", properties: {}, additionalProperties: false},
    normalize: ritualManifest,
  },
  {
    id: "test-doubles",
    version: 1,
    role: "CONDITION",
    label: "Test rolled a double",
    description: "\"if one or more doubles or triples were rolled during this test\": any two of the test's dice show the same result (a triple holds a double). Only a ritual menu's Psychic test reads it.",
    starter: {on: "double"},
    parameterSchema: {type: "object", required: ["on"], properties: {on: {enum: ["double"]}}, additionalProperties: false},
    normalize: testDoubles,
  },
  {
    id: "roll-total",
    version: 2,
    role: "CONDITION",
    label: "Roll total is at least",
    description: "\"If the Psychic test result for this Ritual was 10+\": the total of the named roll is at least min. roll_var psychic-test is a ritual menu's Psychic test; dark-pact-test is the Leadership test of the Dark Pact moment (event used dark-pact with passed) the record opens with (\"if the result of that test was 8 or more\"), min at most 12.",
    starter: {roll_var: "psychic-test", min: 10},
    parameterSchema: {type: "object", required: ["roll_var", "min"], properties: {roll_var: {enum: ["psychic-test", "dark-pact-test"]}, min: {type: "integer", minimum: 2, maximum: 18}}, additionalProperties: false},
    normalize: rollTotal,
  },
  {
    id: "oath-determine",
    version: 1,
    role: "EFFECT",
    label: "oath determine",
    description: "Repeat the referenced rule's Oath determination procedure, without selecting an invented stance option.",
    starter: {},
    parameterSchema: {type: "object", properties: {ability: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, subject: {enum: ["this-model", "this-unit"]}}, required: ["ability", "subject"], additionalProperties: false},
    normalize: oathDetermine,
  },
  {
    id: "oath-fulfilled",
    version: 1,
    role: "CONDITION",
    label: "oath fulfilled",
    description: "The current Oath of the referenced rule is fulfilled.",
    starter: {},
    parameterSchema: {type: "object", properties: {ability: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}}, required: ["ability"], additionalProperties: false},
    normalize: oathFulfilled,
  },
  {
    id: "oath-selection-history",
    version: 1,
    role: "RESTRICTION",
    label: "oath selection history",
    description: "Previously selected entries in the named Oath domains are ineligible for selection.",
    starter: {},
    parameterSchema: {type: "object", properties: {ability: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, subject: {enum: ["this-model", "this-unit"]}, domains: {type: "array", items: {enum: ["deed", "quality"]}, minItems: 1, uniqueItems: true}}, required: ["ability", "subject", "domains"], additionalProperties: false},
    normalize: oathSelectionHistory,
  },
  {
    id: "oath-duplicate-result",
    version: 1,
    role: "RESTRICTION",
    label: "oath duplicate result",
    description: "A random result already selected in the named domains is replaced by choosing an unselected entry, not by rerolling.",
    starter: {},
    parameterSchema: {type: "object", properties: {ability: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, subject: {enum: ["this-model", "this-unit"]}, domains: {type: "array", items: {enum: ["deed", "quality"]}, minItems: 1, uniqueItems: true}}, required: ["ability", "subject", "domains"], additionalProperties: false},
    normalize: oathDuplicateResult,
  },
  {
    id: "oath-exhaustion",
    version: 1,
    role: "RESTRICTION",
    label: "oath exhaustion",
    description: "Do not determine another Oath when all entries in every named domain have been selected.",
    starter: {},
    parameterSchema: {type: "object", properties: {ability: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, subject: {enum: ["this-model", "this-unit"]}, domains: {type: "array", items: {enum: ["deed", "quality"]}, minItems: 1, uniqueItems: true}}, required: ["ability", "subject", "domains"], additionalProperties: false},
    normalize: oathExhaustion,
  },
  {
    id: "oath-quality-persistence",
    version: 1,
    role: "EFFECT",
    label: "oath quality persistence",
    description: "Fulfilled Oath Qualities continue on army models with the named recipient ability. An omitted duration retains the parent rule's lifetime.",
    starter: {},
    parameterSchema: {type: "object", properties: {ability: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, recipient_ability: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, owner: {enum: ["friendly", "enemy", "any"]}, duration: {enum: ["phase", "turn", "battle-round", "battle", "permanent"]}}, required: ["ability", "recipient_ability", "owner"], additionalProperties: false},
    normalize: oathQualityPersistence,
  },
  {
    id: "oath-deed-reward",
    version: 1,
    role: "EVENT",
    label: "oath deed reward",
    description: "The following reward belongs to completion of an additional Oath's Deed, not to its initial determination or the initial Oath.",
    starter: {},
    parameterSchema: {type: "object", properties: {ability: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, subject: {enum: ["this-model", "this-unit"]}, applies_to: {const: "additional"}}, required: ["ability", "subject", "applies_to"], additionalProperties: false},
    normalize: oathDeedReward,
  },
  {
    id: "oath-reward-selection",
    version: 1,
    role: "RESTRICTION",
    label: "oath reward selection",
    description: "Which selection methods the additional Deed reward covers; any includes both chosen and random outcomes.",
    starter: {},
    parameterSchema: {type: "object", properties: {method: {enum: ["any", "chosen", "random"]}}, required: ["method"], additionalProperties: false},
    normalize: oathRewardSelection,
  },

];
