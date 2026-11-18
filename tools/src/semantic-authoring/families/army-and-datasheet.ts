import { ANTECEDENT } from "../antecedent-families.js";
import {
  booleanValue, boundedInteger, enumOrSource, enumValue, exactKeys, integerOrSource, sourceQualified,
} from "../family-validation.js";
import type { FlatFamily } from "./types.js";
import {
  type Input, KEBAB, KEBAB_ID, SOURCE, STATS, UNIT_KEYWORD, LEADING_APOSTROPHE, FIXED_SUBJECTS, KEYWORD_LIST,
  stringList,
} from "./dice-and-core-shared.js";

/** Resources, army faction, leader attachment, datasheet swaps, characteristic resolution and borrowed or selected weapons. */

// ---------------------------------------------------------------------------------------------
// leading-unit

const LEADING_SUBJECTS = ["this-model", "this-unit", "bearers-unit", ANTECEDENT, "selected-unit"] as const;
const ATTACHMENTS = ["leading", "supporting", "any", "led", "can-attach"] as const;
const FOLLOWING_FILTER = "following-filter";

function strings(value: unknown, into: string[]): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, into);
  else if (value !== null && typeof value === "object") for (const item of Object.values(value)) strings(item, into);
  return into;
}

/**
 * At least one unit keyword, upper case and sorted. A keyword can start with an apostrophe as the
 * rules print it ('ARDMOB); it is checked and sorted without it, and keeps it.
 */
function keywordList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 1) throw new TypeError(`${label} must list at least 1 keyword.`);
  const list = value.map((item) => {
    const printed = typeof item === "string" && LEADING_APOSTROPHE.test(item);
    const plain = printed ? (item as string).slice(1) : item;
    const keyword = String(plain).replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();
    if (!UNIT_KEYWORD.test(keyword)) throw new TypeError(`${label} keyword ${JSON.stringify(plain)} is not a unit keyword.`);
    if (printed && keyword !== plain) throw new TypeError(`leading-unit could not keep the leading apostrophe of ${item as string}.`);
    return { keyword, printed: printed ? `'${keyword}` : keyword };
  });
  if (new Set(list.map((item) => item.keyword)).size !== list.length) throw new TypeError(`${label} lists a keyword twice.`);
  return list.sort((a, b) => (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0)).map((item) => item.printed);
}

function normalizeLeadingUnit(input: Input): Input {
  const all = strings(input, []);
  for (const value of all) {
    if (LEADING_APOSTROPHE.test(value) && all.includes(value.slice(1))) throw new TypeError(`leading-unit names ${value.slice(1)} both with and without a leading apostrophe.`);
  }
  const { object, leader_keywords: leaders, attached_to_keywords: attachedTo, negated, ...rest } = input;
  const attachment = rest.attachment;
  if (attachment !== "can-attach") {
    if (object !== undefined) throw new TypeError("leading-unit.object goes with attachment: can-attach.");
  } else {
    if (object !== FOLLOWING_FILTER) throw new TypeError("leading-unit attachment can-attach names the unit by object: following-filter.");
    if (negated === true || leaders !== undefined) throw new TypeError("leading-unit attachment can-attach takes no negation or leader keywords.");
  }
  if (negated !== undefined && typeof negated !== "boolean") throw new TypeError("leading-unit.negated is true or false.");
  if (leaders !== undefined && attachment !== "led") throw new TypeError("leading-unit.leader_keywords names the Leader of a led unit (attachment led).");
  exactKeys(rest, ["subject", "attachment"], "leading-unit");
  const result: Input = {
    subject: enumOrSource(rest.subject, LEADING_SUBJECTS, "leading-unit.subject"),
    attachment: enumValue(attachment, ATTACHMENTS, "leading-unit.attachment"),
  };
  if (attachedTo !== undefined) result.attached_to_keywords = keywordList(attachedTo, "leading-unit.attached_to_keywords");
  if (leaders !== undefined) result.leader_keywords = keywordList(leaders, "leading-unit.leader_keywords");
  if (negated === true) result.negated = true;
  if (object !== undefined) result.object = FOLLOWING_FILTER;
  return result;
}

const RESOLUTION_RULES = ["majority", "highest", "lowest"] as const;
const RESOLUTION_TIE = ["highest", "lowest"] as const;
const RESOLUTION_APPLIES_TO = ["wound-roll", "all"] as const;
const MELEE_RANGED = ["melee", "ranged"] as const;
const RESOURCES = ["command-point", "bloodshed-point", "miracle-dice", "fate-dice", "cabal-point"] as const;
const RESOURCE_OPERATIONS = ["gain", "lose", "spend", "set"] as const;
export const ARMY_AND_DATASHEET_FAMILIES: readonly FlatFamily[] = [
  {
    id: "resource-action",
    version: 1,
    role: "EFFECT",
    label: "Change a resource",
    description: "Gains, loses, spends, or sets a named resource.",
    starter: { resource: "", operation: "", amount: null },
    parameterSchema: {
      type: "object",
      required: ["resource", "operation", "amount"],
      properties: {
        resource: { anyOf: [{ enum: RESOURCES }, SOURCE] },
        operation: { enum: RESOURCE_OPERATIONS },
        amount: { anyOf: [{ type: "integer" }, SOURCE] },
      },
      additionalProperties: false,
    },
    normalize: (input) => {
      exactKeys(input, ["resource", "operation", "amount"], "resource-action");
      return {
        resource: enumOrSource(input.resource, RESOURCES, "resource-action.resource"),
        operation: enumValue(input.operation, RESOURCE_OPERATIONS, "resource-action.operation"),
        amount: integerOrSource(input.amount, "resource-action.amount"),
      };
    },
  },
  {
    id: "army-faction",
    version: 3,
    role: "CONDITION",
    label: "Army faction is",
    description: "Requires the army to have a specified faction, or with negated, not to have it (\"If your Army Faction is not X\"). Quote the exact name from the source until a reviewer resolves it to the faction's kebab-case id (the DSL condition names the id, not free text).",
    starter: { faction: { source: "" } },
    parameterSchema: {
      type: "object",
      required: ["faction"],
      properties: {
        faction: { oneOf: [SOURCE, { type: "string", pattern: KEBAB }] },
        negated: { type: "boolean", "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: (input) => {
      const { negated, ...rest } = input;
      exactKeys(rest, ["faction"], "army-faction");
      const quoted = sourceQualified(rest.faction, "army-faction.faction");
      let faction: unknown = quoted;
      if (!quoted) {
        if (typeof rest.faction !== "string" || !KEBAB_ID.test(rest.faction)) throw new TypeError("army-faction.faction must be source-qualified or a kebab-case faction id.");
        faction = rest.faction;
      }
      return { faction, ...("negated" in input && booleanValue(negated, "army-faction.negated") ? { negated: true } : {}) };
    },
  },
  {
    id: "leading-unit",
    version: 7,
    role: "CONDITION",
    label: "While leading or supporting a unit",
    description: "Requires the subject to be attached to another unit: as its Leader (leading), in support (supporting), or in either role (any). led: the subject unit is led by a Leader, and leader_keywords lists keywords that Leader has every one of. attached_to_keywords: the unit it is attached to has every one of these keywords. negated: the attachment does not hold (\"unless it is leading a unit\"). can-attach: the subject can be attached to the unit-filter right after the leaf (object following-filter, required); it says which units a Leader may join when mustering, so it lowers only inside a list-building attachment rule, and takes no negation or leader keywords. The subject can be antecedent (an earlier leaf's unit) or selected-unit, and a keyword can start with an apostrophe as the rules print it ('ARDMOB).",
    starter: { subject: "this-model", attachment: "leading" },
    parameterSchema: {
      type: "object",
      required: ["subject", "attachment"],
      properties: {
        subject: { anyOf: [{ enum: LEADING_SUBJECTS }, SOURCE] },
        attachment: { enum: ATTACHMENTS },
        attached_to_keywords: { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true, "x-optional": true },
        leader_keywords: { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true, "x-only-when": { attachment: ["led"] }, "x-optional": true },
        negated: { type: "boolean", "x-optional": true },
        object: { enum: [FOLLOWING_FILTER], "x-only-when": { attachment: ["can-attach"] }, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeLeadingUnit,
  },
  {
    id: "datasheet-swap",
    version: 1,
    role: "EFFECT",
    label: "Swap datasheet",
    description: "The target unit uses another datasheet from then on (profile, keywords, abilities), keeping its wounds and position.",
    starter: { target: "", datasheet: "" },
    parameterSchema: { type: "object", required: ["target", "datasheet"], properties: { target: { enum: FIXED_SUBJECTS }, datasheet: { type: "string", minLength: 1 } }, additionalProperties: false },
    normalize: (input) => {
      exactKeys(input, ["target", "datasheet"], "datasheet-swap");
      if (typeof input.datasheet !== "string" || !input.datasheet) throw new TypeError("datasheet-swap.datasheet must be a nonblank string.");
      return { target: enumValue(input.target, FIXED_SUBJECTS, "datasheet-swap.target"), datasheet: input.datasheet };
    },
  },
  {
    id: "characteristic-resolution",
    version: 1,
    role: "EFFECT",
    label: "Resolve a mixed characteristic",
    description: "How a characteristic that differs between the target's models is resolved: the value most models have (with a tie-break), or the highest/lowest.",
    starter: { target: "", stat: "", rule: "" },
    parameterSchema: {
      type: "object",
      required: ["target", "stat", "rule"],
      properties: {
        target: { enum: FIXED_SUBJECTS }, stat: { enum: STATS }, rule: { enum: RESOLUTION_RULES },
        tie: { enum: RESOLUTION_TIE, "x-only-when": { rule: ["majority"] } },
        applies_to: { enum: RESOLUTION_APPLIES_TO }, incoming: { type: "boolean" },
      },
      additionalProperties: false,
    },
    normalize: (input) => {
      const rule = enumValue(input.rule, RESOLUTION_RULES, "characteristic-resolution.rule");
      exactKeys(input, ["target", "stat", "rule", ...(rule === "majority" ? ["tie"] : []), ...["applies_to", "incoming"].filter((key) => key in input)], "characteristic-resolution");
      const result: Input = {
        target: enumValue(input.target, FIXED_SUBJECTS, "characteristic-resolution.target"),
        stat: enumValue(input.stat, STATS, "characteristic-resolution.stat"),
        rule,
      };
      if (rule === "majority") result.tie = enumValue(input.tie, RESOLUTION_TIE, "characteristic-resolution.tie");
      if ("applies_to" in input) result.applies_to = enumValue(input.applies_to, RESOLUTION_APPLIES_TO, "characteristic-resolution.applies_to");
      if ("incoming" in input) {
        if (input.incoming !== true) throw new TypeError("characteristic-resolution.incoming must be true, or omitted.");
        result.incoming = true;
      }
      return result;
    },
  },
  {
    id: "borrow-weapons",
    version: 1,
    role: "EFFECT",
    label: "Fire another model's weapon (Firing Deck)",
    description: "The target (a Transport) uses one ranged weapon from each of up to max_models models embarked within it; those models cannot shoot.",
    starter: { target: "", max_models: null },
    parameterSchema: {
      type: "object",
      required: ["target", "max_models"],
      properties: {
        target: { enum: FIXED_SUBJECTS }, max_models: { type: "integer", minimum: 1 }, weapon_type: { enum: MELEE_RANGED },
        exclude_weapon_keyword: KEYWORD_LIST,
      },
      additionalProperties: false,
    },
    normalize: (input) => {
      exactKeys(input, ["target", "max_models", ...["weapon_type", "exclude_weapon_keyword"].filter((key) => key in input)], "borrow-weapons");
      const result: Input = {
        target: enumValue(input.target, FIXED_SUBJECTS, "borrow-weapons.target"),
        max_models: boundedInteger(input.max_models, 1, 12, "borrow-weapons.max_models"),
      };
      if ("weapon_type" in input) result.weapon_type = enumValue(input.weapon_type, MELEE_RANGED, "borrow-weapons.weapon_type");
      if ("exclude_weapon_keyword" in input) result.exclude_weapon_keyword = stringList(input.exclude_weapon_keyword, "borrow-weapons.exclude_weapon_keyword");
      return result;
    },
  },
  {
    id: "select-weapon",
    version: 2,
    role: "EFFECT",
    label: "Select and bind a weapon",
    description: "Pick one (or count) of the target's weapons and bind it; later weapon-qualified effects refer to it by the bound name. weapon_name: the selected weapon is the one with this printed name (exactly one weapon of the target has it).",
    starter: { target: "", bind_as: "" },
    parameterSchema: {
      type: "object",
      required: ["target", "bind_as"],
      properties: {
        target: { enum: FIXED_SUBJECTS }, count: { type: "integer", minimum: 1 }, weapon_type: { enum: MELEE_RANGED },
        weapon_keyword: { type: "string", minLength: 1 }, bind_as: { type: "string", minLength: 1 },
        weapon_name: { type: "string", minLength: 1, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: (input) => {
      const { weapon_name: name, ...rest } = input;
      exactKeys(rest, ["target", "bind_as", ...["count", "weapon_type", "weapon_keyword"].filter((key) => key in rest)], "select-weapon");
      if (typeof rest.bind_as !== "string" || !rest.bind_as) throw new TypeError("select-weapon.bind_as must be a nonblank string.");
      const result: Input = { target: enumValue(rest.target, FIXED_SUBJECTS, "select-weapon.target"), bind_as: rest.bind_as };
      if ("count" in rest) result.count = boundedInteger(rest.count, 1, 12, "select-weapon.count");
      if ("weapon_type" in rest) result.weapon_type = enumValue(rest.weapon_type, MELEE_RANGED, "select-weapon.weapon_type");
      if ("weapon_keyword" in rest) {
        if (typeof rest.weapon_keyword !== "string" || !rest.weapon_keyword) throw new TypeError("select-weapon.weapon_keyword must be a nonblank string.");
        result.weapon_keyword = rest.weapon_keyword;
      }
      if ("weapon_name" in input) {
        // The printed name, trimmed and lowercased as the DSL carries weapon names.
        if (typeof name !== "string" || name.trim().length === 0) throw new TypeError("select-weapon.weapon_name is the weapon's name as its datasheet prints it.");
        result.weapon_name = name.trim().toLowerCase();
      }
      return result;
    },
  },
];
