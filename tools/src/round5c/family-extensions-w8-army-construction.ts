import { ANTECEDENT } from "./antecedent-families.js";
import { type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { FOLLOWING_FILTER } from "./family-extensions-11.js";
import { enumValue } from "./family-validation.js";

/**
 * Wave-8 family extensions for list-building rules (army construction). As in the earlier rounds,
 * a version checks only its own additions and hands the rest to the previous one.
 */

/** Rules about the units a group names: the group is the rule's subject (its DSL target). */
export const ARMY_SUBJECT_RULES = ["warlord-required", "warlord-forbidden", "enhancement-forbidden", "enhancement-source", "limit-exemption"] as const;
/** Rules that count the units a group names: the group is what is counted (the DSL's `with`). */
export const ARMY_COUNTING_RULES = ["unique", "composition"] as const;
/** Rules about the list as a whole, which no group of units qualifies. */
export const ARMY_LIST_RULES = ["single-chapter", "detachment-forbidden", "detachment-tag-exclusive", "faction-forbidden"] as const;

const NEW_RULES = ["enhancement-source", "limit-exemption"] as const;
const SUBJECTS = ["this-unit", "this-model", ANTECEDENT] as const;
const OBJECTS = ["this-unit", FOLLOWING_FILTER] as const;
/** Limits a unit or Enhancement can be left out of: the Retinue cap, the Enhancement cap, the Strategic Reserves points cap. */
export const ARMY_EXEMPTIONS = ["retinue-limit", "enhancement-limit", "strategic-reserves-points"] as const;
const ENHANCEMENT_KIND = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

export const FAMILY_EXTENSIONS_W8_ARMY: readonly FamilyExtension[] = [
  {
    // "You cannot include more than one" + "PATRIARCH model"; "None of these models can be your
    // WARLORD"; "Enhancements from this Detachment do not count towards …"; "it can be attached to
    // this unit".
    family: "army-construction",
    description: "As the previous version, plus: rule enhancement-source (the subject can only be given Enhancements from this Detachment) and limit-exemption (the subject does not count toward a limit, named by exempt_from); with following-filter (the group is the unit-filter right after the leaf); subject this-unit, this-model or antecedent (the units an earlier leaf named: the group of the nearest earlier composition rule, else the unit-filter right before the leaf); object this-unit or following-filter (attachment only: the unit the subject can be attached to); exempt_from (retinue-limit with composition; enhancement-limit or strategic-reserves-points with limit-exemption); enhancement_kind (a kind of Enhancement, with enhancement-slot or unique). One group source at most: with_keywords, with or an antecedent subject.",
    schema: (previous) => withProperties(previous, {
      rule: widenedEnum(previous, "rule", NEW_RULES),
      with: optional({ enum: [FOLLOWING_FILTER] }),
      subject: optional({ enum: SUBJECTS }),
      object: optional({ enum: OBJECTS, "x-only-when": { rule: ["attachment"] } }),
      exempt_from: optional({ type: "array", items: { enum: ARMY_EXEMPTIONS }, minItems: 1, uniqueItems: true }),
      enhancement_kind: optional({ type: "string", pattern: ENHANCEMENT_KIND.source, "x-only-when": { rule: ["enhancement-slot", "unique"] } }),
    }),
    normalize: (input, previous) => {
      const { with: withValue, subject, object, exempt_from: exempt, enhancement_kind: kind, ...rest } = input;
      const isNew = NEW_RULES.includes(rest.rule as typeof NEW_RULES[number]);
      if (!isNew && [withValue, subject, object, exempt, kind].every((value) => value === undefined)) return previous(input);
      // A new rule is checked as the previous version checks a subject rule.
      const normalized = isNew ? { ...standIn(rest, "rule", "warlord-forbidden", previous) } : previous(rest);
      const rule = String(normalized.rule);
      const result: Record<string, unknown> = { ...normalized };
      if (withValue !== undefined) result.with = enumValue(withValue, [FOLLOWING_FILTER], "army-construction.with");
      if (subject !== undefined) result.subject = enumValue(subject, SUBJECTS, "army-construction.subject");
      const sources = [result.with_keywords !== undefined, result.with !== undefined, result.subject === ANTECEDENT].filter(Boolean).length;
      if (sources > 1) throw new TypeError("army-construction names its group once: with_keywords, with following-filter, or subject antecedent.");
      if (sources > 0 && (ARMY_LIST_RULES as readonly string[]).includes(rule) && (result.with !== undefined || result.subject === ANTECEDENT)) {
        throw new TypeError(`army-construction rule ${rule} is about the list as a whole; no group of units qualifies it.`);
      }
      if (result.subject !== undefined && result.subject !== ANTECEDENT && (result.with_keywords !== undefined || result.with !== undefined)) {
        throw new TypeError("army-construction.subject this-unit/this-model names the subject itself; it takes no group (with_keywords or with).");
      }
      if (result.subject !== undefined && result.subject !== ANTECEDENT && ![...ARMY_SUBJECT_RULES, "attachment"].includes(rule)) {
        throw new TypeError(`army-construction.subject this-unit/this-model has no meaning for rule ${rule}.`);
      }
      if (object !== undefined) {
        if (rule !== "attachment") throw new TypeError("army-construction.object goes with rule: attachment.");
        result.object = enumValue(object, OBJECTS, "army-construction.object");
        if (result.object === FOLLOWING_FILTER && result.with !== undefined) throw new TypeError("army-construction takes one following filter: with or object, not both.");
      }
      if (exempt !== undefined) {
        if (!Array.isArray(exempt) || exempt.length === 0) throw new TypeError("army-construction.exempt_from lists at least one limit.");
        const list = exempt.map((item) => enumValue(item, ARMY_EXEMPTIONS, "army-construction.exempt_from"));
        if (new Set(list).size !== list.length) throw new TypeError("army-construction.exempt_from lists a limit twice.");
        for (const item of list) {
          if (item === "retinue-limit" && rule !== "composition") throw new TypeError("army-construction.exempt_from retinue-limit goes with rule: composition.");
          if (item !== "retinue-limit" && rule !== "limit-exemption") throw new TypeError(`army-construction.exempt_from ${item} goes with rule: limit-exemption.`);
        }
        result.exempt_from = [...list].sort();
      }
      if (rule === "limit-exemption" && result.exempt_from === undefined) throw new TypeError("army-construction rule limit-exemption names the limit in exempt_from.");
      if (kind !== undefined) {
        if (rule !== "enhancement-slot" && rule !== "unique") throw new TypeError("army-construction.enhancement_kind goes with rule: enhancement-slot or unique.");
        if (typeof kind !== "string" || !ENHANCEMENT_KIND.test(kind)) throw new TypeError("army-construction.enhancement_kind is a kebab-case kind of Enhancement.");
        result.enhancement_kind = kind;
      }
      return result;
    },
  },
];
