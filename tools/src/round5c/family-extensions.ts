import type { SemanticFamilyDefinition } from "./contracts.js";
import { ANTECEDENT } from "./antecedent-families.js";
import { DICE, EVENT_SUBJECT, type FamilyExtension, KEYWORD_ITEMS, keywordList, optional, properties, type Schema, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { FAMILY_EXTENSIONS_2 } from "./family-extensions-2.js";
import { FAMILY_EXTENSIONS_3 } from "./family-extensions-3.js";
import { ROLL_KINDS } from "./dice-families.js";
import { enumValue } from "./family-validation.js";

/**
 * Families that gained one more version after the antecedent versions, each widening what the
 * previous version could say without changing anything it already said. A version here checks
 * only its own additions and hands the rest of a leaf to the previous version, so every earlier
 * leaf still fits it unchanged and `family-versions.ts` moves leaves across by identity.
 */

export type { FamilyExtension } from "./family-extension-helpers.js";

const FAMILY_EXTENSIONS_1: readonly FamilyExtension[] = [
  {
    // "ADEPTUS ASTARTES INFANTRY/MOUNTED model only": every keyword, plus any one of these.
    family: "bearer-eligibility",
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
  {
    // "while this unit is within 6\" of one or more friendly **K** units".
    family: "unit-position",
    description: "As the previous version, and a within/beyond distance can be measured to any unit matching a filter: of matching-unit with of_keywords (every keyword), of_side (friendly or enemy) and of_other (a unit other than the subject).",
    schema: (previous) => withProperties(previous, {
      of: widenedEnum(previous, "of", ["matching-unit"]),
      of_keywords: { type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true, "x-only-when": { of: ["matching-unit"] } },
      of_side: { enum: ["friendly", "enemy"], "x-only-when": { of: ["matching-unit"] } },
      of_other: optional({ const: true, "x-only-when": { of: ["matching-unit"] } }),
    }),
    normalize: (input, previous) => {
      const extras = ["of_keywords", "of_side", "of_other"].filter((key) => key in input);
      if (input.of !== "matching-unit") {
        if (extras.length) throw new TypeError(`unit-position.${extras[0]} only describes of: matching-unit.`);
        return previous(input);
      }
      if (input.kind !== "within" && input.kind !== "beyond") throw new TypeError("unit-position of matching-unit measures a within or beyond distance.");
      const { of_keywords: keywords, of_side: side, of_other: other, ...rest } = input;
      const normalized = standIn(rest, "of", "this-unit", previous);
      if (other !== undefined && other !== true) throw new TypeError("unit-position.of_other is true or absent.");
      return {
        ...normalized,
        of_keywords: keywordList(keywords, "unit-position.of_keywords", 1),
        of_side: enumValue(side, ["friendly", "enemy"], "unit-position.of_side"),
        ...(other === true ? { of_other: true } : {}),
      };
    },
  },
  {
    // "while this model is part of an attached unit", attached as Leader or in support.
    family: "leading-unit",
    description: "As the previous version, plus attachment any: attached to a unit in either role, as its Leader or in support.",
    schema: (previous) => withProperties(previous, { attachment: widenedEnum(previous, "attachment", ["any"]) }),
    normalize: (input, previous) => input.attachment === "any" ? standIn(input, "attachment", "leading", previous) : previous(input),
  },
  {
    // "each time that unit makes a Normal, Advance or Fall Back move": whose move it is.
    family: "event",
    description: "As the previous version, plus an optional subject for a moment a unit makes (move-ended, selected, targets-selected, attacks-resolved, set-up): this unit (the default), this model, the selected unit, the triggering unit, or an earlier leaf's unit (antecedent). A subject and an owner never go together.",
    schema: (previous) => withProperties(previous, {
      subject: optional({ enum: ["this-unit", "this-model", "selected-unit", EVENT_SUBJECT, ANTECEDENT], "x-only-when": { kind: ["move-ended", "selected", "targets-selected", "attacks-resolved", "set-up"] } }),
    }),
    normalize: (input, previous) => {
      if (!("subject" in input)) return previous(input);
      const { subject, ...rest } = input;
      const normalized = previous(rest);
      if (!["move-ended", "selected", "targets-selected", "attacks-resolved", "set-up"].includes(String(normalized.kind))) {
        throw new TypeError(`event.subject does not apply to kind ${String(normalized.kind)}.`);
      }
      if ("owner" in normalized) throw new TypeError("event names its unit by subject or by owner, not both.");
      return { ...normalized, subject: enumValue(subject, ["this-unit", "this-model", "selected-unit", EVENT_SUBJECT, ANTECEDENT], "event.subject") };
    },
  },
  {
    // "add 1 to Advance and Charge rolls": the same change to every listed roll.
    family: "roll-modifier",
    description: "As the previous version, or rolls: the same change to each of two or more named rolls (\"add 1 to Advance and Charge rolls\") in place of roll.",
    schema: (previous) => {
      const { required, ...rest } = previous;
      return withProperties({ ...rest, required: (required as string[]).filter((key) => key !== "roll") }, {
        roll: optional(properties(previous).roll!),
        rolls: optional({ type: "array", items: { enum: ROLL_KINDS }, minItems: 2, uniqueItems: true }),
      });
    },
    normalize: (input, previous) => {
      if (!("rolls" in input)) {
        if (!("roll" in input)) throw new TypeError("roll-modifier names a roll or rolls.");
        return previous(input);
      }
      if ("roll" in input) throw new TypeError("roll-modifier names a roll or rolls, not both.");
      const { rolls, ...rest } = input;
      if (!Array.isArray(rolls) || rolls.length < 2) throw new TypeError("roll-modifier.rolls lists at least two rolls.");
      const list = rolls.map((roll) => enumValue(roll, ROLL_KINDS, "roll-modifier.rolls"));
      if (new Set(list).size !== list.length) throw new TypeError("roll-modifier.rolls lists a roll twice.");
      // Each roll is checked as the previous version checks its one roll.
      for (const roll of list) previous({ ...rest, roll });
      const { roll: _roll, ...normalized } = previous({ ...rest, roll: list[0] });
      return { ...normalized, rolls: [...list].sort() };
    },
  },
  {
    // "that enemy unit cannot have the Benefit of Cover": a rule suppressed on another unit.
    family: "rule-state",
    description: "As the previous version, and the subject can be a selected unit, the triggering unit, the attack's target, or an earlier leaf's unit (antecedent): \"that enemy unit cannot have the Benefit of Cover\".",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", ["selected-unit", EVENT_SUBJECT, "target", ANTECEDENT]) }),
    normalize: (input, previous) => ["selected-unit", EVENT_SUBJECT, "target", ANTECEDENT].includes(String(input.subject))
      ? standIn(input, "subject", "this-unit", previous)
      : previous(input),
  },
  {
    // "add D3 to the Attacks characteristic", "add 6\" to the Range characteristic", "models in that unit" after a trigger.
    family: "characteristic-modifier",
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
    // "that unit can make a Normal move" after a trigger: the triggering unit moves.
    family: "make-move",
    description: "As the previous version, and the triggering unit (event-subject) can be the one that moves.",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EVENT_SUBJECT]) }),
    normalize: (input, previous) => input.subject === EVENT_SUBJECT ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
];

/** Every extension in order; a family listed twice gains two versions, the later on top of the earlier. */
export const FAMILY_EXTENSIONS: readonly FamilyExtension[] = [...FAMILY_EXTENSIONS_1, ...FAMILY_EXTENSIONS_2, ...FAMILY_EXTENSIONS_3];

const extensionVersions = new Map<string, { extension: FamilyExtension; version: number }>();

/** The registry with each extension's family one version on; the previous current version retires. */
export function withFamilyExtensions(registry: readonly SemanticFamilyDefinition[]): SemanticFamilyDefinition[] {
  const result = [...registry];
  for (const extension of FAMILY_EXTENSIONS) {
    const at = result.flatMap((family, index) => family.id === extension.family && !family.deprecated ? [index] : []);
    if (at.length !== 1) throw new Error(`Family ${extension.family} has ${at.length} current versions; an extension needs exactly one.`);
    const current = result[at[0]!]!;
    const { deprecated: _deprecated, ...rest } = current;
    result[at[0]!] = { ...current, deprecated: true };
    result.push({ ...rest, version: current.version + 1, description: extension.description, parameterSchema: extension.schema(current.parameterSchema) });
    extensionVersions.set(`${extension.family}@${current.version + 1}`, { extension, version: current.version + 1 });
  }
  return result;
}

/** The extension that defines one family version, if any. */
export function familyExtension(family: string, version: number): FamilyExtension | undefined {
  return extensionVersions.get(`${family}@${version}`)?.extension;
}

/** Each extension's previous → new version, for the identity migration. */
export function extensionVersionPairs(): Array<{ family: string; from: number; to: number }> {
  return [...extensionVersions.values()].map(({ extension, version }) => ({ family: extension.family, from: version - 1, to: version }));
}
