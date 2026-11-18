import { ANTECEDENT } from "../antecedent-families.js";
import { boundedInteger, enumValue, exactKeys } from "../family-validation.js";
import { constTrue, isObject, KEBAB_ID, namedId, noParameters, nonEmptyString, present, type Params } from "./containers-and-abilities-shared.js";
import type { FlatFamily } from "./types.js";

/** Container openers (Orders, choices, stances, move types, dice pools) and the leaves that name their options. */

/** A list of distinct strings, as given (an empty string included). */
function distinctStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must list at least one keyword.`);
  if (value.some((item) => typeof item !== "string")) throw new TypeError(`${label} lists only strings.`);
  if (new Set(value).size !== value.length) throw new TypeError(`${label} lists a value twice.`);
  return [...value] as string[];
}

/** Two or more distinct non-empty strings, sorted so one set has one fingerprint. */
function optionList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 2) throw new TypeError(`${label} lists two or more options.`);
  const list = value.map((item, at) => nonEmptyString(item, `${label}[${at}]`));
  if (new Set(list).size !== list.length) throw new TypeError(`${label} lists an option twice.`);
  return [...list].sort();
}

// ── Containers and their options ────────────────────────────────────────────────────────────────

const STANCE_MODES = ["re-selectable", "consumable"] as const;
const STANCE_SCOPES = ["army", "unit"] as const;
const DICE_REQUIREMENT_TYPES = ["pair", "triple", "single", "run"] as const;
const ORDER_RULES = ["issuer", "one-at-a-time", "ineligible-state", "ends-on-state", "benefit", "only-orders"] as const;
const ORDER_STATES = ["battle-shocked"] as const;
const MOVE_TYPE_KINDS = ["normal", "advance", "fall-back", "charge", "pile-in", "consolidation", "ingress", "surge", "scout", "disembark", "embark", "pulse-jet"] as const;
const MOVE_TYPE_MODES = ["ordered-retreat", "desperate-escape", "ongoing", "engaging", "objective", "rapid", "tactical", "combat", "emergency", "assault", "shock"] as const;
const MOVE_TYPE_SECTIONS = ["eligible", "effect", "before", "while", "after"] as const;
const RANDOM_DICE = ["D3", "D6"] as const;

/** An or_random's dice and count. */
function randomPick(random: unknown, family: string): { dice: string; count: number } {
  if (!isObject(random)) throw new TypeError(`${family}.or_random is an object with dice and count.`);
  const { dice, count, ...extra } = random;
  if (Object.keys(extra).length) throw new TypeError(`${family}.or_random has only dice and count.`);
  return { dice: enumValue(dice, RANDOM_DICE, `${family}.or_random.dice`), count: boundedInteger(count, 1, 3, `${family}.or_random.count`) };
}

function leaderTarget(input: Params): Params {
  exactKeys(input, present(input, ["leader_keywords"]), "leader-target");
  return "leader_keywords" in input ? { leader_keywords: distinctStrings(input.leader_keywords, "leader-target.leader_keywords") } : {};
}

function orderRule(input: Params): Params {
  const rule = enumValue(input.rule, ORDER_RULES, "order-rule.rule");
  if (rule === "only-orders") {
    exactKeys(input, ["rule", "orders"], "order-rule");
    if (!Array.isArray(input.orders) || input.orders.length === 0 || input.orders.some((name) => typeof name !== "string" || name.trim() === "")) {
      throw new TypeError("order-rule.orders is the Orders' names as printed, one or more.");
    }
    return { rule, orders: [...new Set((input.orders as string[]).map((name) => name.trim()))] };
  }
  const needs = rule === "issuer" || rule === "benefit" ? ["rule", "keywords"] : rule === "one-at-a-time" ? ["rule"] : ["rule", "state"];
  exactKeys(input, needs, "order-rule");
  if (needs.includes("keywords")) {
    if (!Array.isArray(input.keywords) || input.keywords.length === 0 || input.keywords.some((k) => typeof k !== "string" || k.trim() === "")) {
      throw new TypeError("order-rule.keywords is the keywords as printed, one or more.");
    }
    return { rule, keywords: [...new Set((input.keywords as string[]).map((k) => k.trim()))] };
  }
  if (needs.includes("state")) return { rule, state: enumValue(input.state, ORDER_STATES, "order-rule.state") };
  return { rule };
}

function dicePoolAllocationOpen(input: Params): Params {
  exactKeys(input, ["pool_count", "pool_die", "max_activations"], "dice-pool-allocation-open");
  return {
    pool_count: boundedInteger(input.pool_count, 1, 99, "dice-pool-allocation-open.pool_count"),
    pool_die: String(input.pool_die),
    max_activations: boundedInteger(input.max_activations, 1, 99, "dice-pool-allocation-open.max_activations"),
  };
}

function moveTypeOpen(input: Params): Params {
  exactKeys(input, present(input, ["name", "move_type", "mode", "setup_inches", "distance_inches", "distance_dice"]), "move-type-open");
  if (typeof input.name !== "string" || !input.name.trim()) throw new RangeError("move-type-open.name must be the move type's printed name.");
  const result: Params = { name: input.name.trim(), move_type: enumValue(input.move_type, MOVE_TYPE_KINDS, "move-type-open.move_type") };
  if ("mode" in input) result.mode = enumValue(input.mode, MOVE_TYPE_MODES, "move-type-open.mode");
  if ("setup_inches" in input) result.setup_inches = boundedInteger(input.setup_inches, 1, 24, "move-type-open.setup_inches");
  if ("distance_inches" in input) result.distance_inches = boundedInteger(input.distance_inches, 1, 48, "move-type-open.distance_inches");
  if ("distance_dice" in input) {
    if (typeof input.distance_dice !== "string" || !/^\d*D\d+(\+\d+)?$/u.test(input.distance_dice)) throw new RangeError("move-type-open.distance_dice must be a dice expression such as D6+18.");
    result.distance_dice = input.distance_dice;
  }
  return result;
}

function moveTypeSection(input: Params): Params {
  exactKeys(input, ["section"], "move-type-section");
  return { section: enumValue(input.section, MOVE_TYPE_SECTIONS, "move-type-section.section") };
}

function stanceSelectionCapacity(input: Params): Params {
  const family = "stance-selection-capacity";
  exactKeys(input, ["stance_id", "additional_selections", "allocation", ...present(input, ["scope", "option_id", "option_ids"])], family);
  const allocation = enumValue(input.allocation, ["choose-one-option", "fixed-option"], `${family}.allocation`);
  if (allocation === "fixed-option" && !("option_id" in input)) throw new TypeError(`${family}.option_id is required when allocation is fixed-option.`);
  if (allocation !== "fixed-option" && "option_id" in input) throw new TypeError(`${family}.option_id only applies when allocation is fixed-option.`);
  const result: Params = {
    stance_id: String(input.stance_id),
    additional_selections: boundedInteger(input.additional_selections, 1, 99, `${family}.additional_selections`),
    allocation,
  };
  if ("scope" in input) result.scope = enumValue(input.scope, STANCE_SCOPES, `${family}.scope`);
  if ("option_id" in input) result.option_id = String(input.option_id);
  if ("option_ids" in input) {
    if (allocation !== "choose-one-option") throw new TypeError(`${family}.option_ids narrows a shared (choose-one-option) allowance; a fixed-option one names option_id.`);
    const list = optionList(input.option_ids, `${family}.option_ids`);
    if (!list.every((id) => KEBAB_ID.test(id))) throw new TypeError(`${family}.option_ids are kebab-case option ids.`);
    result.option_ids = list;
  }
  return result;
}

function issueOrdersOpen(input: Params): Params {
  const family = "issue-orders-open";
  exactKeys(input, present(input, ["count", "range", "eligible_keyword", "recipient", "counts_toward_limit"]), family);
  const result: Params = {};
  if ("count" in input) result.count = boundedInteger(input.count, 1, 99, `${family}.count`);
  if ("range" in input) result.range = boundedInteger(input.range, 1, 48, `${family}.range`);
  if ("eligible_keyword" in input) result.eligible_keyword = String(input.eligible_keyword);
  if ("recipient" in input) result.recipient = enumValue(input.recipient, [ANTECEDENT], `${family}.recipient`);
  if ("counts_toward_limit" in input) {
    if (input.counts_toward_limit !== false) throw new TypeError(`${family}.counts_toward_limit is false, for an Order outside the officer's limit; leave it out otherwise.`);
    result.counts_toward_limit = false;
  }
  return result;
}

function choiceOpen(input: Params): Params {
  const family = "choice-open";
  exactKeys(input, present(input, ["choice_label", "min_choices", "max_choices", "or_random", "ignore_consumed", "chosen_by"]), family);
  const result: Params = {};
  if ("choice_label" in input) result.choice_label = String(input.choice_label);
  if ("min_choices" in input) result.min_choices = boundedInteger(input.min_choices, 0, 99, `${family}.min_choices`);
  if ("max_choices" in input) result.max_choices = boundedInteger(input.max_choices, 1, 99, `${family}.max_choices`);
  if ("or_random" in input) result.or_random = randomPick(input.or_random, family);
  if ("ignore_consumed" in input) {
    if (input.ignore_consumed !== true) throw new TypeError(`${family}.ignore_consumed is true or omitted.`);
    if ("or_random" in input) throw new TypeError(`${family}.ignore_consumed is a pick by the player, not a random one.`);
    result.ignore_consumed = true;
  }
  if ("chosen_by" in input) {
    if (input.chosen_by !== "opponent") throw new TypeError(`${family}.chosen_by is opponent or omitted.`);
    if ("or_random" in input || "ignore_consumed" in input) throw new TypeError(`${family} chosen by the opponent is a plain pick: no or_random or ignore_consumed.`);
    result.chosen_by = "opponent";
  }
  return result;
}

function stanceSelectOpen(input: Params): Params {
  const family = "stance-select-open";
  exactKeys(input, present(input, ["scope", "mode", "min_choices", "max_choices", "additive", "or_random"]), family);
  const result: Params = { scope: enumValue(input.scope, STANCE_SCOPES, `${family}.scope`), mode: enumValue(input.mode, STANCE_MODES, `${family}.mode`) };
  if ("min_choices" in input) result.min_choices = boundedInteger(input.min_choices, 0, 99, `${family}.min_choices`);
  if ("max_choices" in input) result.max_choices = boundedInteger(input.max_choices, 1, 99, `${family}.max_choices`);
  if ("additive" in input) result.additive = constTrue(input.additive, `${family}.additive`);
  if ("or_random" in input) result.or_random = randomPick(input.or_random, family);
  return result;
}

/** One dice requirement of a requirement_any_of. */
function requirement(value: unknown, label: string): { type: string; min_value: number } {
  if (!isObject(value)) throw new TypeError(`${label} is an object with type and min_value.`);
  const { type, min_value: minValue, ...extra } = value;
  if (Object.keys(extra).length) throw new TypeError(`${label} has only type and min_value.`);
  return { type: enumValue(type, DICE_REQUIREMENT_TYPES, `${label}.type`), min_value: boundedInteger(minValue, 1, 6, `${label}.min_value`) };
}

function namedOption(input: Params): Params {
  const family = "named-option";
  const single = "requirement_type" in input ? ["requirement_type", "requirement_min_value"] : [];
  if ("requirement_any_of" in input && ("requirement_type" in input || "requirement_min_value" in input)) {
    throw new TypeError(`${family} names one requirement or requirement_any_of, not both.`);
  }
  exactKeys(input, ["label", ...single, ...present(input, ["requirement_any_of", "option_id", "warp_charge"])], family);
  const result: Params = { label: String(input.label) };
  if (single.length) {
    result.requirement_type = enumValue(input.requirement_type, DICE_REQUIREMENT_TYPES, `${family}.requirement_type`);
    result.requirement_min_value = boundedInteger(input.requirement_min_value, 1, 6, `${family}.requirement_min_value`);
  }
  if ("requirement_any_of" in input) {
    const anyOf = input.requirement_any_of;
    if (!Array.isArray(anyOf) || anyOf.length < 2) throw new TypeError(`${family}.requirement_any_of lists two or more requirements; one is requirement_type.`);
    const list = anyOf.map((item, index) => requirement(item, `${family}.requirement_any_of[${index}]`));
    if (new Set(list.map((item) => `${item.type}:${item.min_value}`)).size !== list.length) throw new TypeError(`${family}.requirement_any_of lists a requirement twice.`);
    result.requirement_any_of = list;
  }
  if ("option_id" in input) result.option_id = namedId(input.option_id, `${family}.option_id`);
  if ("warp_charge" in input) result.warp_charge = boundedInteger(input.warp_charge, 2, 18, `${family}.warp_charge`);
  return result;
}

function forEachUnitSelect(input: Params): Params {
  const family = "for-each-unit-select";
  if ("units" in input) {
    const { units, ...rest } = input;
    if (units !== ANTECEDENT) throw new TypeError(`${family}.units is antecedent, or omitted.`);
    if (Object.keys(rest).length) throw new TypeError(`${family}.units antecedent takes its side and filter from the earlier unit-filter, so it has no other parameter.`);
    return { units: ANTECEDENT };
  }
  if ("including" in input) {
    const { including, ...rest } = input;
    if (including !== "target") throw new TypeError(`${family}.including is target, or omitted.`);
    if (Object.keys(rest).length) throw new TypeError(`${family}.including qualifies only the bare quantifier {}; the unit-filter after it names the other units.`);
    return { including: "target" };
  }
  if (Object.keys(input).length === 0) return {};
  exactKeys(input, ["scope", "distance", ...present(input, ["inches"])], family);
  return {
    scope: enumValue(input.scope, ["enemy", "friendly"], `${family}.scope`),
    distance: enumValue(input.distance, ["any", "within"], `${family}.distance`),
    ...("inches" in input ? { inches: boundedInteger(input.inches, 1, 48, `${family}.inches`) } : {}),
  };
}

const rulesBundleMarker = noParameters("rules-bundle-marker");

export const CONTAINER_OPENERS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "leader-target",
    version: 1,
    role: "CONDITION",
    label: "The attached leader model",
    description: "Wraps the ability's effects onto the leader model attached to this unit, instead of the bearer, for as long as it leads. \"While this model is leading a unit, the attached Character model has the Fights First ability.\"",
    starter: {},
    parameterSchema: {type: "object", properties: {leader_keywords: {type: "array", items: {type: "string", minLength: 1}, minItems: 1, uniqueItems: true}}, additionalProperties: false},
    normalize: leaderTarget,
  },
  {
    id: "rules-bundle-marker",
    version: 1,
    role: "RESTRICTION",
    label: "Is a rules bundle",
    description: "The ability's whole body is a named bundle of rules that another ability grants by name, rather than an effect fired on its own (Sororitas and penitent enhancement bundles).",
    starter: {},
    parameterSchema: {type: "object", properties: {}, additionalProperties: false},
    normalize: rulesBundleMarker,
  },
  {
    id: "order-rule",
    version: 2,
    role: "RESTRICTION",
    label: "How Orders work",
    description: "A rule of the record's issue-orders, wherever it is printed: issuer (the models with this ability that issue Orders, by keyword; each datasheet sets how many and to whom), one-at-a-time (a unit is affected by one Order; a later one replaces it), ineligible-state (units in this state cannot be issued an Order), ends-on-state (an Order stops affecting a unit that enters this state), benefit (only models with these keywords gain an Order's benefit), or only-orders (the officer issues only these Orders of its menu, by their printed names).",
    starter: {rule: ""},
    parameterSchema: {type: "object", required: ["rule"], properties: {rule: {enum: ["issuer", "one-at-a-time", "ineligible-state", "ends-on-state", "benefit", "only-orders"]}, keywords: {type: "array", minItems: 1, uniqueItems: true, items: {type: "string", minLength: 1}}, state: {enum: ["battle-shocked"]}, orders: {type: "array", minItems: 1, uniqueItems: true, items: {type: "string", minLength: 1}}}, additionalProperties: false},
    normalize: orderRule,
  },
  {
    id: "dice-pool-allocation-open",
    version: 1,
    role: "EFFECT",
    label: "Allocate a dice pool",
    description: "Opens a dice-pool-allocation: every later sentence must open with a named-option leaf carrying that option's dice requirement; its effect is what spending that requirement does.",
    starter: {pool_count: null, pool_die: ""},
    parameterSchema: {type: "object", required: ["pool_count", "pool_die", "max_activations"], properties: {pool_count: {type: "integer", minimum: 1}, pool_die: {type: "string", minLength: 1}, max_activations: {type: "integer", minimum: 1}}, additionalProperties: false},
    normalize: dicePoolAllocationOpen,
  },
  {
    id: "move-type-open",
    version: 1,
    role: "EFFECT",
    label: "Define a move type",
    description: "Opens a move type an army rule defines (Special Move Types): its printed name, the move it is or extends (disembark for an Assault or Shock Disembark, with that mode; pulse-jet for a move of its own), and the set-up distance or maximum distance it prints. The sentences after it, up to the next move-type-open, fold into it under their move-type-section markers.",
    starter: {name: "", move_type: ""},
    parameterSchema: {type: "object", required: ["name", "move_type"], properties: {name: {type: "string", minLength: 1}, move_type: {enum: ["normal", "advance", "fall-back", "charge", "pile-in", "consolidation", "ingress", "surge", "scout", "disembark", "embark", "pulse-jet"]}, mode: {enum: ["ordered-retreat", "desperate-escape", "ongoing", "engaging", "objective", "rapid", "tactical", "combat", "emergency", "assault", "shock"]}, setup_inches: {type: "integer", minimum: 1, maximum: 24}, distance_inches: {type: "integer", minimum: 1, maximum: 48}, distance_dice: {type: "string", pattern: "^\\d*D\\d+(\\+\\d+)?$"}}, additionalProperties: false},
    normalize: moveTypeOpen,
  },
  {
    id: "move-type-section",
    version: 1,
    role: "EVENT",
    label: "Move type section",
    description: "Marks which part of the enclosing move type the leaves after it state, up to the next marker: eligible (condition leaves on the moving unit and its Transport, beyond the rule allowing the move), effect (the core move it is made as; no leaves), before (what resolves before it moves), while (move-modifier leaves on how it moves) or after (what applies once it has moved, with each duration).",
    starter: {section: ""},
    parameterSchema: {type: "object", required: ["section"], properties: {section: {enum: ["eligible", "effect", "before", "while", "after"]}}, additionalProperties: false},
    normalize: moveTypeSection,
  },
  {
    id: "stance-selection-capacity",
    version: 2,
    role: "EFFECT",
    label: "Extra stance selections",
    description: "Widens how many times a named stance-select's options may be picked: pooled across any option, or pinned to one named option (Gladius Task Force's Codex Discipline). With allocation choose-one-option, option_ids limits the pooled allowance to these options: the additional selections are one shared allowance the player may spend on any of them, and on no other (\"select the assault doctrine or tactical doctrine one additional time per battle\" = additional_selections 1 over both).",
    starter: {stance_id: "", additional_selections: null, allocation: ""},
    parameterSchema: {type: "object", required: ["stance_id", "additional_selections", "allocation"], properties: {scope: {enum: ["army", "unit"]}, stance_id: {type: "string", minLength: 1}, additional_selections: {type: "integer", minimum: 1}, allocation: {enum: ["choose-one-option", "fixed-option"]}, option_id: {type: "string", minLength: 1, "x-only-when": {allocation: ["fixed-option"]}}, option_ids: {type: "array", items: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, minItems: 2, uniqueItems: true, "x-only-when": {allocation: ["choose-one-option"]}, "x-optional": true}}, additionalProperties: false},
    normalize: stanceSelectionCapacity,
  },
  {
    id: "issue-orders-open",
    version: 2,
    role: "EFFECT",
    label: "Issue Orders",
    description: "Opens an issue-orders: every later sentence must open with a named-option leaf giving that Order's name; its effect is what the Order does (Astra Militarum Voice of Command). recipient antecedent sends the Order to the unit the moment before it names, not to an eligible unit the officer picks; counts_toward_limit false keeps the Order out of the Orders the officer can issue this turn.",
    starter: {},
    parameterSchema: {type: "object", properties: {count: {type: "integer", minimum: 1}, range: {type: "integer", minimum: 1, maximum: 48}, eligible_keyword: {type: "string", minLength: 1}, recipient: {enum: ["antecedent"], "x-optional": true}, counts_toward_limit: {enum: [false], "x-optional": true}}, additionalProperties: false},
    normalize: issueOrdersOpen,
  },
  {
    id: "choice-open",
    version: 4,
    role: "EFFECT",
    label: "Choose one of the following",
    description: "Opens a choice: every later sentence's effect becomes one option (min/max default to one). Composes with an earlier select-unit/for-each-unit-select, an earlier roll, and ability parts the same way any other effect leaf does. or_random says the options may instead be picked at random: {dice, count} rolls count dice (D3 or D6) and applies the option numbered by each result, the options being numbered in order from 1 to the die's faces. ignore_consumed lets the pick take an option a once-per-battle selection already used (\"even if you have already selected that imperative this battle\"); only an optionless pick an ability-activate names takes it, and never with or_random. chosen_by opponent: the opponent picks the option, not the player using the ability; such a pick takes no or_random or ignore_consumed.",
    starter: {},
    parameterSchema: {type: "object", properties: {choice_label: {type: "string", minLength: 1}, min_choices: {type: "integer", minimum: 0}, max_choices: {type: "integer", minimum: 1}, or_random: {type: "object", required: ["dice", "count"], properties: {dice: {enum: ["D3", "D6"]}, count: {type: "integer", minimum: 1, maximum: 3}}, additionalProperties: false, "x-optional": true}, ignore_consumed: {const: true, "x-optional": true}, chosen_by: {enum: ["opponent"], "x-optional": true}}, additionalProperties: false},
    normalize: choiceOpen,
  },
  {
    id: "stance-select-open",
    version: 3,
    role: "EFFECT",
    label: "Select a stance",
    description: "Opens a stance-select: every later sentence must open with a named-option leaf giving that stance's name; its effect is that option's bundle (Gladius Combat Doctrines, Admech Doctrina Imperatives). Composes with an earlier select-unit/for-each-unit-select, an earlier roll, and ability parts the same way any other effect leaf does. additive: the picked option joins the options already active for the unit, rather than replacing them (\"in addition to any other combat doctrine\"). or_random says the pick may instead be rolled: {dice, count} rolls count dice (D3 or D6) and applies the option numbered by each result, the options other than the one in force from the start being numbered in order from 1 to the die's faces. A rolled option already active has no additional effect.",
    starter: {scope: "", mode: ""},
    parameterSchema: {type: "object", required: ["scope", "mode"], properties: {scope: {enum: ["army", "unit"]}, mode: {enum: ["re-selectable", "consumable"]}, min_choices: {type: "integer", minimum: 0}, max_choices: {type: "integer", minimum: 1}, additive: {const: true, "x-optional": true}, or_random: {type: "object", required: ["dice", "count"], properties: {dice: {enum: ["D3", "D6"]}, count: {type: "integer", minimum: 1, maximum: 3}}, additionalProperties: false, "x-optional": true}}, additionalProperties: false},
    normalize: stanceSelectOpen,
  },
  {
    id: "named-option",
    version: 4,
    role: "EVENT",
    label: "Named option",
    description: "Opens one option of the enclosing stance-select, issue-orders or dice-pool-allocation with its name; under dice-pool-allocation it also carries the option's dice requirement: requirement_type and requirement_min_value, or requirement_any_of, two or more dice requirements any one of which activates the option (\"a double 4 or higher, or any triple\" is a pair from 4 or a triple from 1). option_id is the option's reviewed stable identity. warp_charge, on a Ritual of a ritual menu, is the Psychic test result it needs (2-18), from the Ritual's card where its text does not print it.",
    starter: {label: ""},
    parameterSchema: {type: "object", required: ["label"], properties: {label: {type: "string", minLength: 1}, requirement_type: {enum: ["pair", "triple", "single", "run"]}, requirement_min_value: {type: "integer", minimum: 1, maximum: 6, "x-only-when": {requirement_type: ["pair", "triple", "single", "run"]}}, requirement_any_of: {type: "array", items: {type: "object", required: ["type", "min_value"], properties: {type: {enum: ["pair", "triple", "single", "run"]}, min_value: {type: "integer", minimum: 1, maximum: 6}}, additionalProperties: false}, minItems: 2, "x-optional": true}, option_id: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", "x-optional": true}, warp_charge: {type: "integer", minimum: 2, maximum: 18, "x-optional": true}}, additionalProperties: false},
    normalize: namedOption,
  },
  {
    id: "for-each-unit-select",
    version: 4,
    role: "EVENT",
    label: "For each unit",
    description: "The ability resolves its effects separately for every matching enemy or friendly unit, instead of once for a single selected unit. The DSL's for-each-unit selector has no visibility gate, unlike select-unit. The bare quantifier {} on \"each\" / \"for each\" / \"every\" leaves the units to the unit-filter right after it, in the same fragment, with a range or \"engaged with this unit\" after that; a later \"that unit\" is the unit of each pass. including target, alone, adds the attack's target to the passes of a bare quantifier (\"for the target unit and one D6 for each other enemy unit within 6\\\" of it\"), and the filter's other then means other than the target. units antecedent, alone: each pass takes one of the units the nearest earlier unit-filter named (\"such a unit\" after \"each X unit has that ability\"); a later \"it\" / \"that unit\" is the unit of each pass.",
    starter: {scope: "", distance: ""},
    parameterSchema: {type: "object", required: [], properties: {scope: {enum: ["enemy", "friendly"]}, distance: {enum: ["any", "within"]}, inches: {type: "integer", minimum: 1, maximum: 48, "x-only-when": {distance: ["within"]}}, including: {const: "target", "x-optional": true}, units: {const: "antecedent", "x-optional": true}}, additionalProperties: false},
    normalize: forEachUnitSelect,
  },
];
