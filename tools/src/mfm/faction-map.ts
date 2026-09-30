/**
 * faction-map.ts — resolve a MFM faction-keyword to a repo data/core/<dir>.
 *
 * Most keyword names map to their repo dir directly via `nameToId`
 * ("Adepta Sororitas" → "adepta-sororitas"). The exceptions are aggregate or
 * sub-faction keywords whose datasheets the repo files under a parent army:
 *   - Aeldari splits (Asuryani / Harlequins / Ynnari) live under `aeldari`.
 *   - The Chaos Space Marines parent keyword is "Heretic Astartes".
 *   - The Chaos Daemons faction is "Legiones Daemonica"; its four mono-god
 *     allegiances ("Blood/Plague/Scintillating Legions", "Legions of Excess")
 *     are daemon rosters filed under `chaos-daemons`.
 * Titan factions ("Adeptus Titanicus" / "Titanicus Traitoris") have no repo dir
 * yet and resolve to null (deferred — repo/MFM intentionally skip titans).
 *
 * SHARED_ROSTERS captures supplement dirs whose units live in a parent dir: a
 * supplement republishes a parent's roster, so a datasheet that misses its own
 * dir but resolves in a shared dir is an expected duplicate, not a real miss.
 */
import { readdirSync } from "node:fs";
import { nameToId } from "../converters/id-generator.js";
import { CORE_DIR } from "./repo-files.js";



/** Faction-keyword English name → repo dir, for names `nameToId` can't resolve. */
export const FACTION_ALIASES: Record<string, string> = {
  Asuryani: "aeldari",
  Harlequins: "aeldari",
  Ynnari: "aeldari",
  "Heretic Astartes": "chaos-space-marines",
  "Legiones Daemonica": "chaos-daemons",
  "Blood Legions": "chaos-daemons",
  "Plague Legions": "chaos-daemons",
  "Scintillating Legions": "chaos-daemons",
  "Legions of Excess": "chaos-daemons",
};

/**
 * A supplement dir whose units actually live in a parent dir: SM chapters
 * republish the generic Astartes roster; mono-god Chaos legions republish
 * patron daemons + shared engines.
 */
export const SHARED_ROSTERS: Record<string, string[]> = {
  "black-templars": ["adeptus-astartes"],
  "blood-angels": ["adeptus-astartes"],
  "dark-angels": ["adeptus-astartes"],
  deathwatch: ["adeptus-astartes"],
  "space-wolves": ["adeptus-astartes"],
  "imperial-fists": ["adeptus-astartes"],
  "iron-hands": ["adeptus-astartes"],
  "raven-guard": ["adeptus-astartes"],
  salamanders: ["adeptus-astartes"],
  ultramarines: ["adeptus-astartes"],
  "white-scars": ["adeptus-astartes"],
  "death-guard": ["chaos-daemons", "chaos-space-marines"],
  "thousand-sons": ["chaos-daemons", "chaos-space-marines"],
  "world-eaters": ["chaos-daemons", "chaos-space-marines"],
  "emperors-children": ["chaos-daemons", "chaos-space-marines"],
};

/**
 * Codex chapters: Space Marine chapters that take the generic Adeptus Astartes roster plus a
 * supplement, as opposed to the chapters with their own codex (Blood Angels, Dark Angels, Space
 * Wolves, Black Templars, Deathwatch). A detachment a codex chapter owns is locked to it.
 */
export const CODEX_CHAPTERS: ReadonlySet<string> = new Set([
  "imperial-fists",
  "iron-hands",
  "raven-guard",
  "salamanders",
  "ultramarines",
  "white-scars",
]);

let repoDirsCache: Set<string> | null = null;
/** The set of faction dirs that actually exist under data/core/ (excludes _meta dirs). */
export function repoDirs(): Set<string> {
  if (!repoDirsCache) {
    repoDirsCache = new Set(
      readdirSync(CORE_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
        .map((d) => d.name)
    );
  }
  return repoDirsCache;
}

/**
 * Resolve a faction-keyword English name to a repo dir, or null when the dir
 * doesn't exist (titans) or the name is unmappable. Aliases win; otherwise the
 * `nameToId` slug is used iff a dir by that name exists on disk.
 */
export function repoDirForFactionName(name: string | undefined): string | null {
  if (!name) return null;
  const alias = FACTION_ALIASES[name];
  if (alias) return repoDirs().has(alias) ? alias : null;
  let slug: string;
  try {
    slug = nameToId(name);
  } catch {
    return null;
  }
  return repoDirs().has(slug) ? slug : null;
}
