import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Unit keywords as the core records spell them. TARGET wording bolds keyword groups ("ADEPTUS
 * ASTARTES INFANTRY" is two keywords), and core stores keywords as the units carry them
 * ("Adeptus Astartes", "Infantry"), so a leaf's uppercase phrase is split into known keywords,
 * longest first, before it reaches a core record.
 */

const indexes = new Map<string, Map<string, string>>();

/** Every unit keyword and faction keyword in core, keyed by its uppercase form. */
export function keywordIndex(dataRoot: string): Map<string, string> {
  const cached = indexes.get(dataRoot);
  if (cached) return cached;
  const index = new Map<string, string>();
  const core = join(dataRoot, "core");
  if (existsSync(core)) {
    for (const faction of readdirSync(core)) {
      const path = join(core, faction, "units.json");
      if (!existsSync(path)) continue;
      for (const unit of JSON.parse(readFileSync(path, "utf8")) as Array<Record<string, unknown>>) {
        for (const keyword of [...(unit.keywords as string[] ?? []), ...(unit.faction_keywords as string[] ?? [])]) {
          if (typeof keyword === "string" && !index.has(keyword.toUpperCase())) index.set(keyword.toUpperCase(), keyword);
        }
      }
    }
  }
  indexes.set(dataRoot, index);
  return index;
}

const MAX_WORDS = 6;

/** Split one uppercase phrase into known keywords, longest match first. */
export function splitKeywords(phrase: string, index: ReadonlyMap<string, string>): string[] {
  const words = phrase.toUpperCase().split(/\s+/u).filter(Boolean);
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
