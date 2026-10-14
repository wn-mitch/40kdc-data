import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Unit keywords as the core records spell them. TARGET wording bolds keyword groups ("ADEPTUS
 * ASTARTES INFANTRY" is two keywords), and core stores keywords as the units carry them
 * ("Adeptus Astartes", "Infantry"), so a leaf's uppercase phrase is split into known keywords,
 * longest first, before it reaches a core record.
 */

const indexes = new Map<string, Map<string, string>>();

/** A keyword's index key: uppercase, with a typographic apostrophe read as the ASCII one leaves use. */
export function keywordKey(keyword: string): string {
  return keyword.replaceAll("’", "'").toUpperCase();
}

/**
 * Every keyword a unit can carry, keyed by {@link keywordKey}: core datasheet/faction keywords,
 * detachment `granted_keywords`, and canonical keyword-grant effects in the same data projection.
 * Runtime grants contribute their complete identities, never names or recipient predicates.
 */
export function keywordIndex(dataRoot: string): Map<string, string> {
  const cached = indexes.get(dataRoot);
  if (cached) return cached;
  const index = new Map<string, string>();
  const add = (keyword: unknown) => {
    if (typeof keyword === "string" && !index.has(keywordKey(keyword))) index.set(keywordKey(keyword), keyword);
  };
  const core = join(dataRoot, "core");
  if (existsSync(core)) {
    for (const faction of readdirSync(core)) {
      const path = join(core, faction, "units.json");
      if (existsSync(path)) {
        for (const unit of JSON.parse(readFileSync(path, "utf8")) as Array<Record<string, unknown>>) {
          for (const keyword of [...(unit.keywords as string[] ?? []), ...(unit.faction_keywords as string[] ?? [])]) add(keyword);
        }
      }
      const detachments = join(core, faction, "detachments.json");
      if (existsSync(detachments)) {
        for (const detachment of JSON.parse(readFileSync(detachments, "utf8")) as Array<Record<string, unknown>>) {
          for (const grant of (detachment.granted_keywords as Array<{ keyword?: unknown }> | undefined) ?? []) add(grant.keyword);
        }
      }
      const abilities = join(dataRoot, "enrichment", faction, "abilities.json");
      if (existsSync(abilities)) {
        for (const ability of JSON.parse(readFileSync(abilities, "utf8")) as Array<Record<string, unknown>>) {
          addGrantedKeywords(ability.effect, add);
        }
      }
    }
  }
  indexes.set(dataRoot, index);
  return index;
}

/** Runtime keyword grants are identities too; recipient predicates and labels are not grants. */
function addGrantedKeywords(value: unknown, add: (keyword: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) addGrantedKeywords(item, add);
  } else if (value !== null && typeof value === "object") {
    const node = value as Record<string, unknown>;
    if (node.type === "keyword-grant" && node.modifier !== null && typeof node.modifier === "object") {
      const keywords = (node.modifier as Record<string, unknown>).keywords;
      if (Array.isArray(keywords)) for (const keyword of keywords) add(keyword);
    }
    for (const child of Object.values(node)) addGrantedKeywords(child, add);
  }
}

const MAX_WORDS = 6;

/** Split one uppercase phrase into known keywords, longest match first. */
export function splitKeywords(phrase: string, index: ReadonlyMap<string, string>): string[] {
  const words = keywordKey(phrase).split(/\s+/u).filter(Boolean);
  const found: string[] = [];
  for (let start = 0; start < words.length;) {
    let matched = 0;
    for (let length = Math.min(MAX_WORDS, words.length - start); length > 0; length -= 1) {
      const candidate = index.get(words.slice(start, start + length).join(" "));
      if (candidate) {
        found.push(candidate);
        matched = length;
        break;
      }
    }
    if (matched === 0) throw new Error(`"${words[start]}" in "${phrase}" is not a unit keyword in core.`);
    start += matched;
  }
  return found;
}

/**
 * A target's keywords in core form. All-of phrases flatten into required_keywords. Any-of
 * phrases share their common keywords as required_keywords and differ by exactly one keyword
 * each, which becomes required_keywords_any; anything else has no flat core form and is refused.
 */
export function coreTargetKeywords(
  phrases: readonly string[], match: string, excluded: readonly string[], index: ReadonlyMap<string, string>,
): { required_keywords?: string[]; required_keywords_any?: string[]; excluded_keywords?: string[] } {
  const groups = phrases.map((phrase) => splitKeywords(phrase, index));
  const out: { required_keywords?: string[]; required_keywords_any?: string[]; excluded_keywords?: string[] } = {};
  if (match === "any" && groups.length > 1) {
    const common = groups[0]!.filter((keyword) => groups.every((group) => group.includes(keyword)));
    const rest = groups.map((group) => group.filter((keyword) => !common.includes(keyword)));
    if (rest.some((group) => group.length !== 1)) {
      throw new Error(`Target keywords ${phrases.join(" or ")} are alternatives of several keywords each; core can only store one alternative keyword per option.`);
    }
    if (common.length) out.required_keywords = common;
    out.required_keywords_any = [...new Set(rest.map((group) => group[0]!))];
  } else {
    const all = [...new Set(groups.flat())];
    if (all.length) out.required_keywords = all;
  }
  const exclusions = [...new Set(excluded.flatMap((phrase) => splitKeywords(phrase, index)))];
  if (exclusions.length) out.excluded_keywords = exclusions;
  return out;
}

/** Keyword-list parameters, by family, whose every phrase must split into keywords units carry. */
const KEYWORD_PARAMETERS: Record<string, readonly string[]> = {
  "stratagem-target": ["keywords", "excluded_keywords"],
  "triggering-target": ["keywords"],
  "bearer-eligibility": ["keywords", "excluded_keywords", "any_keywords"],
  "unit-position": ["of_keywords"],
  "unit-keyword": ["keywords"],
};

/**
 * Refuse a labelled keyword no unit in core carries: every keyword phrase a keyword-list
 * parameter holds must split into core keywords ("ADEPTUS ASTARTES INFANTRY" is Adeptus Astartes
 * and Infantry). Throws with the first phrase that does not.
 */
export function assertKnownKeywords(familyId: string, parameters: Record<string, unknown>, index: ReadonlyMap<string, string>): void {
  for (const key of KEYWORD_PARAMETERS[familyId] ?? []) {
    const phrases = parameters[key];
    if (!Array.isArray(phrases)) continue;
    for (const phrase of phrases) {
      if (typeof phrase === "string") splitKeywords(phrase, index);
    }
  }
}
