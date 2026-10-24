import { ANTECEDENT } from "../antecedent-families.js";
import { WEAPON_CHARACTERISTICS } from "../effect-families.js";
import { DICE, EVENT_SUBJECT, type FamilyExtension, keywordList, optional, properties, type Schema, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { enumValue } from "../family-validation.js";
import { WEAPON_KEYWORDS, WEAPON_NAMES_SCHEMA, bearerTransportSubject, printedKeywordsExtension, refuseWith, weaponNameList, withoutRequired } from "./shared.js";

/**
 * Versions of the families that change what a unit's models have: characteristic-modifier,
 * characteristic-set, invulnerable-save, feel-no-pain, damage-reduction, keyword-grant and
 * core-ability-grant. Each version checks only its own additions and hands the rest of a leaf to
 * the previous version, so every earlier leaf still fits it unchanged.
 */

/**
 * "**CHARACTER** models in this unit have …": the effect reaches only the subject's models with
 * every listed keyword. Lowered as a model-level DSL unit-filter of the subject's own models.
 */
const MODEL_KEYWORDS = { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true };

function modelKeywords(input: Record<string, unknown>, label: string): { rest: Record<string, unknown>; added: Record<string, unknown> } {
  const { model_keywords: keywords, ...rest } = input;
  if (!("model_keywords" in input)) return { rest, added: {} };
  // Only a unit has models to pick from; this model and the attack being made have none.
  if (rest.subject === "this-model" || rest.subject === "attack") throw new TypeError(`${label}.model_keywords picks models of a unit; its subject cannot be ${String(rest.subject)}.`);
  return { rest, added: { model_keywords: keywordList(keywords, `${label}.model_keywords`, 1) } };
}

function weaponName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label}.weapon_name is the weapon's name as its datasheet prints it.`);
  return value.trim().toLowerCase();
}

/** Model keywords on an effect family whose previous version needs nothing else changed. */
function modelKeywordsExtension(family: string, version: number, what: string): FamilyExtension {
  return {
    family,
    version,
    description: `As the previous version, plus model_keywords: ${what} only the subject's models with every listed keyword ("**CHARACTER** models in this unit").`,
    schema: (previous) => withProperties(previous, { model_keywords: optional(MODEL_KEYWORDS) }),
    normalize: (input, previous) => {
      const { rest, added } = modelKeywords(input, family);
      return { ...previous(rest), ...added };
    },
  };
}

/** Characteristic operations that scale a value instead of adding to it. */
const SCALING = ["halve", "multiply"] as const;

const CHARACTERISTIC_FLOOR: FamilyExtension = {
  // "subtract 1 from the Objective Control characteristic … (to a minimum of 1)".
  family: "characteristic-modifier",
  version: 12,
  description: "As the previous version, plus minimum: a lowered characteristic never goes below this value (\"(to a minimum of 1)\"). Only for subtract or worsen.",
  schema: (previous) => withProperties(previous, { minimum: optional({ type: "integer", minimum: 0, maximum: 20 }) }),
  normalize: (input, previous) => {
    if (input.minimum === undefined) return previous(input);
    const { minimum, ...rest } = input;
    if (!Number.isInteger(minimum) || (minimum as number) < 0 || (minimum as number) > 20) throw new TypeError("characteristic-modifier.minimum must be an integer from 0 to 20.");
    const normalized = previous(rest);
    if (normalized.operation !== "subtract" && normalized.operation !== "worsen") throw new TypeError("characteristic-modifier.minimum floors only a subtract or worsen.");
    return { ...normalized, minimum };
  },
};

/** Operations that add an amount to a characteristic. Halve takes no amount; multiply keeps its factor. */
const AMOUNT_OPERATIONS = ["add", "subtract", "improve", "worsen"] as const;

const CORE_ABILITY_GRANT_BEARER = bearerTransportSubject(
  "core-ability-grant",
  4,
  "As the previous version, plus subject bearer-transport: the Transport the unit with the ability is embarked within, granted a valued ability.",
);

const CHARACTERISTIC_MODIFIER_BEARER = bearerTransportSubject(
  "characteristic-modifier",
  16,
  "As the previous version, plus subject bearer-transport: the Transport the model is embarked within.",
);

const INVULNERABLE_SAVE_BEARER = bearerTransportSubject(
  "invulnerable-save",
  5,
  "As the previous version, plus subject bearer-transport: the Transport the model is embarked within.",
);

export const PSYKER_LEVEL = "psyker-level";

/** A psyker-level setter names the model itself: no other recipient, and no weapon scope. */
function requirePsykerScope(input: Record<string, unknown>): void {
  if (input.subject !== "this-model") throw new TypeError("characteristic-set psyker-level needs subject this-model: the psyker level belongs to the model.");
  if (input.weapon_type !== undefined && input.weapon_type !== "all") throw new TypeError("characteristic-set psyker-level is not a weapon characteristic; it takes no weapon_type.");
  if (input.weapon_name !== undefined) throw new TypeError("characteristic-set psyker-level is not a weapon characteristic; it takes no weapon_name.");
}

const isPsykerItem = (item: unknown): boolean => typeof item === "object" && item !== null && (item as Record<string, unknown>).characteristic === PSYKER_LEVEL;

/**
 * Attack-target recipients: a grant or stat change whose subject is the attack's target ("the
 * target has the benefit of cover", "the target unit has 4+ invulnerable save", "the target unit
 * has Fly"). The subject is a reviewed binding: it names `defender` in the DSL (compile-fragments.ts
 * SUBJECT_TARGETS), and no other leaf reaches the attack's target (core-ability-grant's antecedent
 * reaches the allocated model, not the target).
 */
const TARGET = "target";

/** Subject `target` stands in for this-unit with the previous version, which then checks the rest. */
const targetSubject = (family: string, version: number, description: string): FamilyExtension => ({
  family,
  version,
  description: `As the previous version, and subject can be the attack's target (${description}), which the DSL names as the defender.`,
  schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [TARGET]) }),
  normalize: (input, previous) => input.subject === TARGET ? standIn(input, "subject", "this-unit", previous) : previous(input),
});

/**
 * Attacker-side filter (characteristic-set@7). A stat setter whose subject is the attack itself: "change the Damage
 * characteristic of that attack to 1". The attack is the incoming attack when the leaf sits in an
 * allocation or roll moment, else the attack the bearer's own unit makes. Lowering:
 * compile-fragments.ts (characteristic-set, subject attack) names the same owner as a
 * characteristic-modifier with subject attack. Only the new version takes the value; earlier
 * versions keep their subject enum.
 */
const ATTACK = "attack";

/** Characteristics whose value a dice string can stand for ("has D3+3 A"). */
const DICE_CHARACTERISTICS: readonly string[] = ["A", "S", "D"];

export const CHARACTERISTIC_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "add D3 to the Attacks characteristic", "add 6\" to the Range characteristic", "models in that unit" after a trigger.
    family: "characteristic-modifier",
    version: 8,
    description: "As the previous version, plus a dice amount (D3, D6, D3+1, 2D6), the Range characteristic of weapons, and the triggering unit (event-subject) as recipient.",
    schema: (previous) => {
      const characteristics = properties(previous).characteristics!;
      const items = characteristics.items as Schema;
      return withProperties(previous, {
        subject: widenedEnum(previous, "subject", [EVENT_SUBJECT]),
        characteristics: { ...characteristics, items: { ...items, enum: [...(items.enum as string[]), "Range"] } },
        value: { anyOf: [properties(previous).value!, { type: "string", pattern: DICE.source }] },
      });
    },
    normalize: (input, previous) => {
      let staged = { ...input };
      const restore: Record<string, unknown> = {};
      if (staged.subject === EVENT_SUBJECT) {
        restore.subject = EVENT_SUBJECT;
        staged = { ...staged, subject: "this-unit" };
      }
      if (typeof staged.value === "string") {
        const dice = staged.value.trim().toUpperCase();
        if (!DICE.test(dice)) throw new TypeError("characteristic-modifier.value is a whole number or a dice amount (D3, D6, D3+1, 2D6).");
        restore.value = dice;
        staged = { ...staged, value: 1 };
      }
      const characteristics = Array.isArray(staged.characteristics) ? staged.characteristics as unknown[] : [];
      if (characteristics.includes("Range")) {
        // Range is a weapon characteristic: checked as Strength is, then named again.
        if (characteristics.includes("S")) throw new TypeError("characteristic-modifier lists Range with Strength; split them.");
        const normalized = previous({ ...staged, characteristics: characteristics.map((item) => item === "Range" ? "S" : item) });
        return { ...normalized, ...restore, characteristics: (normalized.characteristics as string[]).map((item) => item === "S" ? "Range" : item).sort() };
      }
      return { ...previous(staged), ...restore };
    },
  },
  {
    // "add 1 to the Strength characteristic of Torrent weapons equipped by models in this unit".
    family: "characteristic-modifier",
    version: 9,
    description: "As the previous version, plus weapon_keyword: the change applies only to weapons with that ability (Torrent, Rapid Fire, Psychic …).",
    schema: (previous) => withProperties(previous, { weapon_keyword: optional({ enum: WEAPON_KEYWORDS }) }),
    normalize: (input, previous) => {
      if (!("weapon_keyword" in input)) return previous(input);
      const { weapon_keyword: keyword, ...rest } = input;
      const normalized = previous(rest);
      if (normalized.weapon_type === undefined) throw new TypeError("characteristic-modifier.weapon_keyword limits a weapon characteristic; give weapon_type too.");
      return { ...normalized, weapon_keyword: enumValue(keyword, WEAPON_KEYWORDS, "characteristic-modifier.weapon_keyword") };
    },
  },
  {
    // "add 1 to the Attacks characteristic of its Nemesis force weapon", "**CHARACTER** models in this unit have +1 T".
    family: "characteristic-modifier",
    version: 10,
    description: "As the previous version, plus weapon_name (the change applies to that one weapon) and model_keywords (only the subject's models with every listed keyword).",
    schema: (previous) => withProperties(previous, { weapon_name: optional({ type: "string", minLength: 1 }), model_keywords: optional(MODEL_KEYWORDS) }),
    normalize: (input, previous) => {
      const { rest, added } = modelKeywords(input, "characteristic-modifier");
      const { weapon_name: name, ...remaining } = rest;
      const normalized = previous(remaining);
      if ("weapon_name" in rest) {
        if (normalized.weapon_type === undefined || normalized.weapon_type === "all") throw new TypeError("characteristic-modifier.weapon_name names a melee or ranged weapon; give that weapon_type.");
        added.weapon_name = weaponName(name, "characteristic-modifier");
      }
      return { ...normalized, ...added };
    },
  },
  {
    // "Halve the Damage characteristic of that attack", "triple its Attacks characteristic": the
    // DSL stat-modifier's halve and multiply. Halve takes no value; multiply names the factor.
    family: "characteristic-modifier",
    version: 11,
    description: "As the previous version, and the operation can halve the characteristic (no value) or multiply it (value: the factor, 2 to 4).",
    schema: (previous) => withProperties(previous, { operation: widenedEnum(previous, "operation", SCALING) }),
    normalize: (input, previous) => {
      if (!(SCALING as readonly string[]).includes(input.operation as string)) return previous(input);
      const { value, ...rest } = input;
      if (input.operation === "halve") {
        if (value !== undefined) throw new TypeError("characteristic-modifier halve takes no value.");
        const { value: _value, ...normalized } = previous({ ...rest, operation: "add", value: 1 });
        return { ...normalized, operation: "halve" };
      }
      if (!Number.isInteger(value) || (value as number) < 2 || (value as number) > 4) throw new TypeError("characteristic-modifier multiply needs a whole factor from 2 to 4.");
      return { ...previous({ ...rest, operation: "add", value: 1 }), operation: "multiply", value };
    },
  },
  CHARACTERISTIC_FLOOR,
  /**
   * An antecedent stat adjustment: "add 2 to the Attacks characteristic of those two weapons",
   * where the weapons are the ones an earlier equipped-weapon-count condition counted. The leaf
   * names no subject; the compiler takes the recipient and the excluded weapon from that condition.
   */
  {
    family: "characteristic-modifier",
    version: 13,
    description: "As the previous version, plus weapon: antecedent (the weapons an earlier equipped-weapon-count condition counted, excluding its named weapon). Requires a melee or ranged weapon_type and no weapon_name or weapon_keyword.",
    schema: (previous) => withProperties(previous, { weapon: optional({ enum: ["antecedent"] }) }),
    normalize: (input, previous) => {
      if (input.weapon === undefined) return previous(input);
      const { weapon, ...rest } = input;
      if (weapon !== "antecedent") throw new TypeError("characteristic-modifier.weapon is antecedent or absent.");
      const normalized = previous(rest);
      if (normalized.weapon_type !== "melee" && normalized.weapon_type !== "ranged") throw new TypeError("characteristic-modifier.weapon antecedent needs a melee or ranged weapon_type.");
      if (normalized.weapon_name !== undefined || normalized.weapon_keyword !== undefined) throw new TypeError("characteristic-modifier.weapon antecedent takes no weapon_name or weapon_keyword.");
      return { ...normalized, weapon: "antecedent" };
    },
  },
  /**
   * A battle-formation weapon change: a stat adjustment to the one weapon an earlier select-weapon
   * named and bound ("select one of this model's Plasma rifle weapons ... That weapon's attacks
   * have: +2 S"). The bound weapon is resolved per record by compile-weapon-antecedent.ts, never by
   * the family itself.
   */
  {
    // "+2 S" under "That weapon's attacks have:": the stat change lands on the bound weapon only.
    family: "characteristic-modifier",
    version: 14,
    description: "As the previous version, plus weapon: antecedent, the one weapon an earlier select-weapon bound. Only weapon characteristics (A, WS, BS, S, AP, D) and only this-model take it; it names no weapon_name or weapon_keyword, and no weapon_type (with one, it is the previous version's equipped-weapon-count form).",
    schema: (previous) => withProperties(withoutRequired(previous, "weapon_type"), {
      weapon: optional({ enum: ["antecedent"] }),
    }),
    normalize: (input, previous) => {
      if (input.weapon === undefined) return previous(input);
      if (input.weapon !== "antecedent") throw new TypeError("characteristic-modifier.weapon takes only antecedent.");
      // With a weapon_type it is the previous version's form: the weapons an equipped-weapon count counted.
      if ("weapon_type" in input) return previous(input);
      for (const key of ["weapon_name", "weapon_keyword"]) {
        if (key in input) throw new TypeError(`characteristic-modifier.weapon antecedent is the bound weapon; it takes no ${key}.`);
      }
      // A stat adjustment under a scope takes its recipient from the scope; a stated one must be this-model.
      if (input.subject !== undefined && input.subject !== "this-model") throw new TypeError("characteristic-modifier.weapon antecedent belongs to this-model, the model that made the selection.");
      const characteristics = Array.isArray(input.characteristics) ? input.characteristics as unknown[] : [];
      if (characteristics.length === 0 || !characteristics.every((stat) => (WEAPON_CHARACTERISTICS as readonly string[]).includes(String(stat)))) {
        throw new TypeError("characteristic-modifier.weapon antecedent changes weapon characteristics only (A, WS, BS, S, AP, D).");
      }
      const { weapon: _weapon, ...rest } = input;
      // The previous version checks every other key with the weapon type it knows as "all", then the
      // antecedent scope stands in for the weapon type.
      const { weapon_type: _all, ...normalized } = previous({ ...rest, weapon_type: "all" });
      return { ...normalized, weapon: "antecedent" };
    },
  },
  /**
   * A characteristic change can leave its amount out. A recipient filter can sit between the change
   * and its amount ("Improve the Objective Control characteristic of K models from your army by
   * 2"), so the amount is a separate leaf that `compile-characteristic-amount.ts` binds back onto
   * the change before lowering.
   */
  {
    family: "characteristic-modifier",
    version: 15,
    description: "As the previous version, and the amount (value) is optional for add, subtract, improve and worsen: a change without one takes its amount from a characteristic-amount leaf after its recipient. Halve and multiply are as before.",
    schema: (previous) => {
      const required = ((previous.required ?? []) as string[]).filter((key) => key !== "value");
      return { ...withProperties(previous, { value: optional(properties(previous).value!) }), required } as Schema;
    },
    normalize: (input, previous) => {
      if (input.value !== undefined || !(AMOUNT_OPERATIONS as readonly string[]).includes(input.operation as string)) return previous(input);
      // The previous version checks an amount, so the value is checked as 1 and then removed.
      const { value: _value, ...normalized } = previous({ ...input, value: 1 });
      return normalized;
    },
  },
  CHARACTERISTIC_MODIFIER_BEARER,
  /**
   * Named weapons, as weapon-property-scope version 6 names them: a list fans out to one step per
   * name (compile-fragments.ts).
   */
  {
    // "add 3 to the Attacks characteristic of X and Y" and "improve the AP characteristic of those weapons by 1".
    family: "characteristic-modifier",
    version: 17,
    description: "As the previous version, plus weapon_names (two to eight printed weapon names, \"of X and Y\") and weapon: earlier-named (\"those weapons\": the weapons the earlier named weapon leaves of this ability name, bound before compilation). Both need weapon_type (all is allowed). Names take no weapon_name, weapon_keyword or weapon; earlier-named takes no names of its own.",
    schema: (previous) => withProperties(previous, { weapon_names: optional(WEAPON_NAMES_SCHEMA), weapon: widenedEnum(previous, "weapon", ["earlier-named"]) }),
    normalize: (input, previous) => {
      if (input.weapon === "earlier-named") {
        refuseWith(input, ["weapon_name", "weapon_names", "weapon_keyword"], "characteristic-modifier.weapon earlier-named");
        if (input.weapon_type === undefined) throw new TypeError("characteristic-modifier.weapon earlier-named needs weapon_type (all is allowed).");
        const { weapon: _weapon, ...rest } = input;
        return { ...previous(rest), weapon: "earlier-named" };
      }
      if (!("weapon_names" in input)) return previous(input);
      refuseWith(input, ["weapon_name", "weapon_keyword", "weapon"], "characteristic-modifier.weapon_names");
      if (input.weapon_type === undefined) throw new TypeError("characteristic-modifier.weapon_names needs weapon_type (all is allowed).");
      const { weapon_names: names, ...rest } = input;
      return { ...previous(rest), weapon_names: weaponNameList(names, "characteristic-modifier.weapon_names") };
    },
  },
  targetSubject("characteristic-modifier", 18, "a reviewed recipient: the target unit's characteristic changes"),
  {
    // "the Damage characteristic of its arco-flails is 2".
    family: "characteristic-set",
    version: 4,
    description: "As the previous version, plus weapon_name: the change applies to that one weapon.",
    schema: (previous) => withProperties(previous, { weapon_name: optional({ type: "string", minLength: 1 }) }),
    normalize: (input, previous) => {
      if (!("weapon_name" in input)) return previous(input);
      const { weapon_name: name, ...rest } = input;
      const normalized = previous(rest);
      if (normalized.weapon_type === undefined || normalized.weapon_type === "all") throw new TypeError("characteristic-set.weapon_name names a melee or ranged weapon; give that weapon_type.");
      return { ...normalized, weapon_name: weaponName(name, "characteristic-set") };
    },
  },
  {
    // "The bearer has a Move characteristic of 7\" and a Save characteristic of 3+": one leaf over
    // the list, each item a characteristic and its value, sharing the subject and scope.
    family: "characteristic-set",
    version: 5,
    description: "As the previous version, plus values: two or more {characteristic, value} pairs set together (\"has a Move characteristic of 7\\\" and a Save characteristic of 3+\") in place of characteristic and value.",
    schema: (previous) => {
      const item = { type: "object", required: ["characteristic", "value"], properties: { characteristic: properties(previous).characteristic!, value: properties(previous).value! }, additionalProperties: false };
      const widened = withProperties(previous, { values: optional({ type: "array", minItems: 2, items: item }) });
      return { ...widened, required: ((previous.required as string[] | undefined) ?? []).filter((key) => key !== "characteristic" && key !== "value") };
    },
    normalize: (input, previous) => {
      if (input.values === undefined) return previous(input);
      const { values, ...rest } = input;
      if (!Array.isArray(values) || values.length < 2) throw new TypeError("characteristic-set.values lists two or more characteristics.");
      if (rest.characteristic !== undefined || rest.value !== undefined) throw new TypeError("characteristic-set.values replaces characteristic and value.");
      const items = values.map((item) => {
        const { characteristic, value } = previous({ ...rest, ...(item as Record<string, unknown>) }) as Record<string, unknown>;
        return { characteristic, value };
      });
      const { characteristic: _c, value: _v, ...shared } = previous({ ...rest, ...(values[0] as Record<string, unknown>) }) as Record<string, unknown>;
      return { ...shared, values: items };
    },
  },
  /**
   * Psychic level: a unit's psyker level is a setter on the model ("has a psyker level of 3"):
   * characteristic-set takes psyker-level, which lowers to a stat-modifier `set` on this-model with
   * the stat `psyker-level` (compile-fragments.ts). The psychic-level budget reads that setter.
   */
  {
    // "Has psyker level 2": a model setter on the psyker level, alone or in a list of pairs.
    family: "characteristic-set",
    version: 6,
    description: "As the previous version, plus psyker-level as a characteristic: the model's psyker level is set to the value (\"has psyker level 2\"). It needs subject this-model, and takes no weapon_type or weapon_name. In a values list it can sit beside other characteristics that share the subject.",
    schema: (previous) => {
      const values = properties(previous).values!;
      const item = values.items as Schema;
      const widenedValues = { ...values, items: { ...item, properties: { ...properties(item), characteristic: widenedEnum(item, "characteristic", [PSYKER_LEVEL]) } } };
      return withProperties(previous, {
        characteristic: widenedEnum(previous, "characteristic", [PSYKER_LEVEL]),
        values: widenedValues,
      });
    },
    normalize: (input, previous) => {
      if (Array.isArray(input.values) && input.values.some(isPsykerItem)) {
        requirePsykerScope(input);
        // The previous version checks each pair as a weapon-free characteristic; psyker pairs stand in as M.
        const values = input.values as Array<Record<string, unknown>>;
        const normalized = previous({ ...input, values: values.map((item) => isPsykerItem(item) ? { ...item, characteristic: "M" } : item) }) as Record<string, unknown> & { values: Array<Record<string, unknown>> };
        return { ...normalized, values: normalized.values.map((item, index) => isPsykerItem(values[index]) ? { ...item, characteristic: PSYKER_LEVEL } : item) };
      }
      if (input.characteristic !== PSYKER_LEVEL) return previous(input);
      requirePsykerScope(input);
      return standIn(input, "characteristic", "M", previous);
    },
  },
  {
    family: "characteristic-set",
    version: 7,
    description: "As the previous version, and the subject can be attack: the weapon making the attack, whoever makes it (the attacker of an incoming attack, else this unit's attacks).",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [ATTACK]) }),
    normalize: (input, previous) => input.subject === ATTACK ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
  {
    // "change the Attacks characteristic of Torrent weapons to 6".
    family: "characteristic-set",
    version: 8,
    description: "As the previous version, plus weapon_keyword: the set applies to the weapons that print this weapon ability (\"the Attacks characteristic of Torrent weapons\"). It needs weapon_type (all is allowed) and a weapon characteristic, and takes no weapon_name or values.",
    schema: (previous) => withProperties(previous, { weapon_keyword: optional({ enum: WEAPON_KEYWORDS }) }),
    normalize: (input, previous) => {
      if (!("weapon_keyword" in input)) return previous(input);
      refuseWith(input, ["weapon_name", "values"], "characteristic-set.weapon_keyword");
      if (input.weapon_type === undefined) throw new TypeError("characteristic-set.weapon_keyword needs weapon_type (all is allowed).");
      if (!(WEAPON_CHARACTERISTICS as readonly string[]).includes(String(input.characteristic))) {
        throw new TypeError("characteristic-set.weapon_keyword selects weapons, so it sets a weapon characteristic.");
      }
      const { weapon_keyword: keyword, ...rest } = input;
      return { ...previous(rest), weapon_keyword: enumValue(keyword, WEAPON_KEYWORDS, "characteristic-set.weapon_keyword") };
    },
  },
  {
    family: "characteristic-set",
    version: 9,
    description: "As the previous version, plus a dice string value (\"D3+3\") for the characteristics A, S and D.",
    schema: (previous) => {
      const value = properties(previous).value as Schema;
      return withProperties(previous, { value: { ...value, anyOf: [...(value.anyOf as Schema[]), { type: "string", pattern: DICE.source }] } });
    },
    normalize: (input, previous) => {
      if (typeof input.value !== "string") return previous(input);
      if (!DICE.test(input.value)) throw new TypeError("characteristic-set.value must be an integer, {source}, or a dice string such as D3+3.");
      if (!DICE_CHARACTERISTICS.includes(String(input.characteristic))) throw new TypeError("characteristic-set: only A, S and D take a dice value.");
      return standIn(input, "value", 1, previous);
    },
  },
  modelKeywordsExtension("invulnerable-save", 4, "the invulnerable save applies to"),
  INVULNERABLE_SAVE_BEARER,
  targetSubject("invulnerable-save", 6, "the target unit's models get the invulnerable save"),
  modelKeywordsExtension("feel-no-pain", 4, "the Feel No Pain applies to"),
  /**
   * A model-level recipient: a model a unit-filter introduced earlier in the record.
   */
  {
    // "when a saving throw is failed for a friendly X model …, change the Damage of that attack to
    // 0": the model whose save it was, which compile-antecedent.ts binds to the roll's subject.
    family: "damage-reduction",
    version: 2,
    description: "As the previous version, plus subject antecedent: the unit or model an earlier leaf introduced (\"… for a friendly X model within 6\", change the Damage of that attack to 0\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [ANTECEDENT]) }),
    normalize: (input, previous) => input.subject === ANTECEDENT ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
  printedKeywordsExtension("keyword-grant", 3),
  targetSubject("keyword-grant", 4, "the target unit gains keywords"),
  {
    // "this model has the Lone Operative 9\" ability".
    family: "core-ability-grant",
    version: 3,
    description: "As the previous version, and Lone Operative can carry its range in inches as value.",
    schema: (previous) => {
      const value = properties(previous).value!;
      const only = value["x-only-when"] as { ability: string[] };
      return withProperties(previous, { value: { ...value, "x-only-when": { ability: [...only.ability, "lone-operative"] } } });
    },
    normalize: (input, previous) => {
      if (input.ability !== "lone-operative" || !("value" in input)) return previous(input);
      if (!Number.isInteger(input.value)) throw new TypeError("core-ability-grant.value for Lone Operative is a range in inches.");
      return standIn(input, "ability", "scouts", previous);
    },
  },
  CORE_ABILITY_GRANT_BEARER,
  // "each time a model in this unit makes a ranged attack, enemy units have the benefit of cover against the attack".
  targetSubject("core-ability-grant", 5, "the attack's target unit gains the ability, such as the Benefit of Cover against that attack"),
  {
    // "this unit has the Deep Strike ability": Deep Strike prints no rating.
    family: "core-ability-grant",
    version: 6,
    description: "As the previous version, and Deep Strike is granted without a value; it carries no rating.",
    schema: (previous) => previous,
    normalize: (input, previous) => {
      if (input.ability !== "deep-strike" || "value" in input) return previous(input);
      const { value: _stand, ...normalized } = previous({ ...input, value: 1 });
      return normalized;
    },
  },
];
