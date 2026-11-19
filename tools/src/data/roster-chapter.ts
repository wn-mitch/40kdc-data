/**
 * Chapter cohesion for the roster checker ({@link validateRosterCore}): which chapter-locked units
 * an army under a `faction-keyword-cohesion` rule may not take. Mirrored by Rust
 * `data/roster_chapter.rs`, Python `data/roster_chapter.py` and Go `roster_chapter.go`; pinned by
 * the `roster_validation` conformance corpus.
 *
 * @packageDocumentation
 */
import type { Faction } from "../generated.js";

/** A roster unit locked to a chapter its army may not take. */
export interface ChapterMismatch {
  /** Index into the roster's units. */
  index: number;
  /** The unit's chapter keywords (its faction keywords other than the rule's base keyword). */
  keywords: string[];
}

type FactionFields = Pick<Faction, "keywords" | "army_construction_rules" | "parent_faction_id">;

/** A child faction's own keywords: its keywords minus its parent's (`Black Templars`). */
function ownKeywords(child: Pick<Faction, "keywords">, parent: Pick<Faction, "keywords">): string[] {
  const inherited = new Set(parent.keywords ?? []);
  return (child.keywords ?? []).filter((k) => !inherited.has(k));
}

/**
 * The units an army under a `faction-keyword-cohesion` rule may not take. A unit carrying the rule's
 * base keyword (`Adeptus Astartes`) plus other faction keywords is locked to a chapter. Allies (no
 * base keyword) and generic units (the base keyword alone) are never judged here.
 *
 * - A chapter army (a child of `parent`) takes only units of its own chapter: a chapter-locked unit
 *   must carry one of the army's own keywords.
 * - A parent army takes no chapter's units: each child faction (every chapter, Ultramarines as
 *   much as Black Templars) is an army of its own. `children` are the factions whose
 *   `parent_faction_id` is the army's faction.
 */
export function chapterMismatches(
  faction: FactionFields | undefined,
  parent: Pick<Faction, "keywords"> | undefined,
  children: readonly FactionFields[],
  unitFactionKeywords: readonly (readonly string[] | undefined)[],
): ChapterMismatch[] {
  const rule = (faction?.army_construction_rules ?? []).find((r) => r.type === "faction-keyword-cohesion");
  if (!faction || !rule) return [];
  let barred: (own: readonly string[]) => boolean;
  if (faction.parent_faction_id) {
    if (!parent) return [];
    const chapter = new Set(ownKeywords(faction, parent));
    if (chapter.size === 0) return [];
    barred = (own) => !own.some((k) => chapter.has(k));
  } else {
    const chapters = new Set(children.flatMap((child) => ownKeywords(child, faction)));
    if (chapters.size === 0) return [];
    barred = (own) => own.some((k) => chapters.has(k));
  }
  const out: ChapterMismatch[] = [];
  unitFactionKeywords.forEach((keywords, index) => {
    if (!keywords?.includes(rule.base_faction_keyword)) return;
    const own = keywords.filter((k) => k !== rule.base_faction_keyword);
    if (own.length > 0 && barred(own)) out.push({ index, keywords: own });
  });
  return out;
}

