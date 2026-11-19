/**
 * chapter-reprints.ts — route a Space Marine chapter's reprint of a generic datasheet to its own
 * repo unit.
 *
 * A chapter supplement can print its own copy of a Codex: Space Marines datasheet under the same
 * name (the Black Templars Gladiators, Impulsor and Repulsors). The dump bars that chapter from the
 * generic datasheet and gives it the reprint, which carries the chapter keyword, its own ability rows
 * and its own points. The repo files both in the shared `adeptus-astartes` pool, so the reprint is
 * a separate unit with id `<slug>-<chapter-dir>`; the bare slug always names the generic unit.
 *
 * Every ingest pass that maps a dump datasheet to a repo unit id goes through
 * {@link unitIdForDatasheet}, so no pass joins a reprint onto the generic unit by name.
 */
import { nameToId } from "../converters/id-generator.js";
import { repoDirForFactionName, SHARED_ROSTERS } from "./faction-map.js";
import type { DatasheetRow, MfmDump } from "./loader.js";

/** The repo dir holding the shared Space Marine pool. */
export const ASTARTES_DIR = "adeptus-astartes";

/** A chapter's same-name reprint of a generic Space Marine datasheet. */
export interface ChapterReprint {
  /** The reprint's dump datasheet id. */
  datasheetId: string;
  /** The generic datasheet's name slug (the generic unit's id). */
  slug: string;
  /** The chapter's repo dir (`black-templars`). */
  chapterDir: string;
  /** The chapter's faction keyword name (`Black Templars`). */
  chapterKeyword: string;
  /** The reprint's repo unit id (`<slug>-<chapterDir>`). */
  unitId: string;
}

/** True for a dir whose units live in the shared Space Marine pool. */
export function isAstartesChapterDir(dir: string): boolean {
  return (SHARED_ROSTERS[dir] ?? [])[0] === ASTARTES_DIR;
}

function slugOf(name: string | undefined): string | null {
  if (!name) return null;
  try {
    return nameToId(name);
  } catch {
    return null;
  }
}

const cache = new WeakMap<MfmDump, Map<string, ChapterReprint>>();

/** Every live chapter reprint in the dump, keyed by its datasheet id. */
export function chapterReprints(dump: MfmDump): Map<string, ChapterReprint> {
  const hit = cache.get(dump);
  if (hit) return hit;
  const out = new Map<string, ChapterReprint>();
  cache.set(dump, out);
  // A partial dump (a focused fixture) without the routing tables has no reprints.
  if (!dump.tables.datasheet || !dump.tables.faction_keyword || !dump.tables.publication) return out;
  const fkById = dump.byId("faction_keyword");
  const live = dump.table("datasheet").filter((ds) => ds.id && !ds.isLegends);
  const keywordOf = (ds: DatasheetRow): string | undefined => {
    const fk = dump.factionKeywordOfDatasheet(ds.id!);
    return fk ? dump.enName(fkById.get(fk)) : undefined;
  };
  const genericSlugs = new Set<string>();
  for (const ds of live) {
    if (repoDirForFactionName(keywordOf(ds)) !== ASTARTES_DIR) continue;
    const slug = slugOf(dump.enName(ds));
    if (slug) genericSlugs.add(slug);
  }
  for (const ds of live) {
    const chapterKeyword = keywordOf(ds);
    const chapterDir = repoDirForFactionName(chapterKeyword);
    if (!chapterKeyword || !chapterDir || !isAstartesChapterDir(chapterDir)) continue;
    const slug = slugOf(dump.enName(ds));
    if (!slug || !genericSlugs.has(slug)) continue;
    out.set(ds.id!, { datasheetId: ds.id!, slug, chapterDir, chapterKeyword, unitId: `${slug}-${chapterDir}` });
  }
  return out;
}

/** The reprint record for a reprint unit id, if `unitId` names one. */
export function reprintForUnit(dump: MfmDump, unitId: string): ChapterReprint | undefined {
  for (const r of chapterReprints(dump).values()) if (r.unitId === unitId) return r;
  return undefined;
}

/**
 * The repo unit id a dump datasheet maps to: a chapter reprint's own id, else the slug of its
 * name (null when the name does not slug).
 */
export function unitIdForDatasheet(dump: MfmDump, ds: DatasheetRow | undefined): string | null {
  if (!ds) return null;
  return (ds.id ? chapterReprints(dump).get(ds.id)?.unitId : undefined) ?? slugOf(dump.enName(ds));
}

/**
 * The unit id whose per-unit weapon variants (`<weapon>-<unit>`) a unit uses: a chapter reprint
 * shares its generic unit's weapon records, so it resolves variants under the generic slug.
 */
export function weaponOwnerId(dump: MfmDump, unitId: string): string {
  return reprintForUnit(dump, unitId)?.slug ?? unitId;
}
