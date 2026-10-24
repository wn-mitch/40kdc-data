import type { FamilyExtension, Schema } from "../family-extension-helpers.js";

/**
 * Keywords the rules print after an apostrophe ('ARDMOB). Every keyword pattern the families
 * embed starts with a capital, so each family that names keywords takes one version that also
 * accepts one leading apostrophe. The version checks the keyword without it through the previous
 * version, then puts it back, as the accented-keyword versions do.
 */

/** The keyword patterns earlier versions embed: ASCII, printed (accented) and the unit-filter's Unicode one. */
const KEYWORD_PATTERNS = new Set([
  "^[A-Z][A-Z0-9' -]*[A-Z0-9]$",
  "^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$",
  "^\\p{Lu}[\\p{Lu}\\p{N}' -]*[\\p{Lu}\\p{N}]$",
]);

/** A keyword printed after one apostrophe: the apostrophe, then a keyword starting with a capital. */
const LEADING_APOSTROPHE = /^'(?=\p{Lu})[\p{Lu}\p{N}' -]*[\p{Lu}\p{N}]$/u;

function withLeadingApostrophe(schema: unknown): unknown {
  if (typeof schema === "string" && KEYWORD_PATTERNS.has(schema)) return `^'?${schema.slice(1)}`;
  if (Array.isArray(schema)) return schema.map(withLeadingApostrophe);
  if (schema !== null && typeof schema === "object") return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, withLeadingApostrophe(value)]));
  return schema;
}

export function leadingApostropheExtension(family: string, version: number): FamilyExtension {
  return {
    family,
    version,
    description: "As the previous version, and a keyword can start with an apostrophe as the rules print it ('ARDMOB).",
    schema: (previous) => withLeadingApostrophe(previous) as Schema,
    normalize: (input, previous) => {
      const printed = new Map<string, string>();
      const strings: string[] = [];
      const strip = (value: unknown): unknown => {
        if (typeof value === "string") {
          strings.push(value);
          if (!LEADING_APOSTROPHE.test(value)) return value;
          printed.set(value.slice(1), value);
          return value.slice(1);
        }
        if (Array.isArray(value)) return value.map(strip);
        if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, strip(item)]));
        return value;
      };
      const staged = strip(input) as Record<string, unknown>;
      if (printed.size === 0) return previous(input);
      for (const plain of printed.keys()) if (strings.includes(plain)) throw new TypeError(`${family} names ${plain} both with and without a leading apostrophe.`);
      const restored = new Set<string>();
      const restore = (value: unknown): unknown => {
        if (typeof value === "string") {
          const original = printed.get(value);
          if (original === undefined) return value;
          restored.add(original);
          return original;
        }
        if (Array.isArray(value)) return value.map(restore);
        if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restore(item)]));
        return value;
      };
      const result = restore(previous(staged)) as Record<string, unknown>;
      // The previous version may rewrite a keyword; one it no longer returns would lose its apostrophe.
      const lost = [...printed.values()].filter((original) => !restored.has(original));
      if (lost.length) throw new TypeError(`${family} could not keep the leading apostrophe of ${lost.join(", ")}.`);
      return result;
    },
  };
}

/** One version for each family whose leaves name keywords. */
export const APOSTROPHE_KEYWORD_EXTENSIONS: readonly FamilyExtension[] = [
  ["ability-modifier", 6], ["add-unit", 4], ["aura-emitter", 2], ["aura-range", 6], ["bearer-eligibility", 5],
  ["characteristic-modifier", 19], ["destroy-models", 4], ["event", 34], ["feel-no-pain", 5], ["keyword-grant", 5],
  ["leading-unit", 7], ["loadout", 3], ["model-count", 3], ["move-through", 5], ["return-models", 5],
  ["returned-model-exclusion", 2], ["rule-state", 3], ["split-unit", 3], ["stratagem-target", 5],
  ["triggering-target", 5], ["unit-activity", 23], ["unit-filter", 18], ["unit-keyword", 7], ["unit-position", 26],
].map(([family, version]) => leadingApostropheExtension(family as string, version as number));
