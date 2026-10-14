import { familyRole, normalizeFingerprintParameters, currentFamilyVersion, REVIEWED_FAMILY_REGISTRY } from "./contracts.js";
import { prefillFromSource, type PrefillFamily } from "./leaf-prefill.js";

/**
 * Predicates the wording spells out completely: "that targets a MONSTER or VEHICLE unit", "if
 * this model is on the battlefield", "that is not Below Half-strength". When no decided example
 * is near, the predicate families are tried on the wording itself; a proposal is made only when
 * exactly one family is fully filled in by the words, and every keyword it names is a unit
 * keyword core actually has.
 */

const PREDICATES = ["unit-keyword", "unit-state", "unit-mark", "unit-position"] as const;
/** Wording that reads as a predicate: it qualifies something rather than doing something. */
const PREDICATE_LEAD = /^(?:that|which|who|if|while|unless)\b/iu;
/** The attack's target as the subject: "that targets", "attacks target", "that target is". */
const TARGET_SUBJECT = /\b(?:that|attacks?|weapons?)\s+targets?\b|\bthat target is\b/iu;

/**
 * Words a predicate may use besides what it states. A proposal needs every word of the wording
 * to be one of these or part of what the family filled in, so "a CHAOS unit containing 5 or more
 * models" (a model count) or "a WARBOSS model is leading this unit" (attachment) is not a keyword leaf.
 */
const COMMON = new Set(["that", "which", "who", "if", "while", "unless", "such", "targets", "target", "targeted", "a", "an", "the", "one", "or", "and", "more",
  "unit", "units", "model", "models", "is", "are", "this", "it", "its", "attack", "attacks", "weapon", "weapons", "enemy", "your", "not", "cannot", "can", "can't", "isn't"]);
const VOCABULARY: Record<string, Set<string>> = {
  "unit-keyword": new Set(["fly"]),
  "unit-state": new Set(["below", "half-strength", "half", "strength", "starting", "battle-shocked", "battle", "shocked", "within", "engagement", "range", "of", "on", "battlefield"]),
  "unit-mark": new Set(["oath", "of", "moment", "afflicted", "spotted", "hidden", "marked"]),
  "unit-position": new Set(["within", "range", "of", "objective", "marker", "markers", "than", "closest", "eligible", "you", "control", "controls", "opponent", "away", "from"]),
};

const tokens = (text: string) => text.toLowerCase().replace(/[‑–]/gu, "-").split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);

/** Whether every word is common predicate wording, the family's own vocabulary, a named keyword, or the leaf's distance. */
function explained(text: string, familyId: string, parameters: Record<string, unknown>): boolean {
  const keywordWords = new Set((Array.isArray(parameters.keywords) ? parameters.keywords as string[] : []).flatMap((keyword) => tokens(keyword)));
  // A number is only explained as the leaf's own distance: "closest eligible target within 18" is more than closest eligible.
  return tokens(text).every((word) => COMMON.has(word) || VOCABULARY[familyId]!.has(word) || keywordWords.has(word) || (/^\d+$/u.test(word) && String(parameters.inches) === word));
}
const MAX_WORDS = 14;
const MAX_KEYWORD_WORDS = 4;

export type PredicateProposal = { family_id: string; family_version: number; role: string; parameters: Record<string, unknown> };

/** Unit keywords named in the wording, matched against core's keywords whatever their case, longest first. */
export function keywordsIn(text: string, index: ReadonlyMap<string, string>): string[] {
  const words = text.replace(/\*\*/gu, "").split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
  const found: string[] = [];
  for (let start = 0; start < words.length;) {
    let matched = 0;
    for (let length = Math.min(MAX_KEYWORD_WORDS, words.length - start); length > 0; length -= 1) {
      const phrase = words.slice(start, start + length).join(" ").toUpperCase();
      if (index.has(phrase)) {
        found.push(phrase);
        matched = length;
        break;
      }
    }
    start += Math.max(1, matched);
  }
  return [...new Set(found)];
}

function family(id: string): PrefillFamily {
  return REVIEWED_FAMILY_REGISTRY.find((item) => item.id === id && item.version === currentFamilyVersion(id)) as unknown as PrefillFamily;
}

/** The one predicate this wording fully states, or null when none (or more than one) does. */
export function predicateProposal(text: string, index: ReadonlyMap<string, string>): PredicateProposal | null {
  const plain = text.replace(/\*\*/gu, "");
  if (plain.split(/\s+/u).filter(Boolean).length > MAX_WORDS || !PREDICATE_LEAD.test(plain)) return null;
  const candidates: PredicateProposal[] = [];
  for (const id of PREDICATES) {
    const version = currentFamilyVersion(id);
    const parameters: Record<string, unknown> = { negated: false, ...prefillFromSource(family(id), plain) };
    if (id === "unit-keyword") {
      // Only keywords core has: a capitalised word that is not a unit keyword is not this leaf.
      const listed = keywordsIn(plain, index);
      const stated = Array.isArray(parameters.keywords) ? parameters.keywords as string[] : [];
      if (!listed.length || stated.some((keyword) => !index.has(keyword.toUpperCase()))) continue;
      parameters.keywords = [...new Set([...stated.map((keyword) => keyword.toUpperCase()), ...listed])];
    }
    if (parameters.subject === "target" && !TARGET_SUBJECT.test(plain)) continue;
    if (!explained(plain, id, parameters)) continue;
    try {
      candidates.push({ family_id: id, family_version: version, role: familyRole(id, version), parameters: normalizeFingerprintParameters(id, parameters, version) });
    } catch {
      // Not every parameter is stated: this family is not what the words say.
    }
  }
  return candidates.length === 1 ? candidates[0]! : null;
}
