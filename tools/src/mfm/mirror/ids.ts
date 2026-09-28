/**
 * The mirrored id of a dump row, for ingest tools that mint or match ability, stratagem and
 * enhancement ids. Ids are a function of the dump (`mfm:mirror`); a tool that derives its own
 * (`nameToId`, `detachmentScopedId`) disagrees with the repo after the mirror.
 */
import { enumerateAbilityRows } from "../dump-prose-rows.js";
import type { MfmDump } from "../loader.js";
import { buildIdentities } from "./identity.js";

export interface MirrorIds {
  /**
   * The id the mirror gives a dump row (`table` as the enumeration names it: `stratagem`,
   * `enhancement`, `detachment_rule`, `army_rule`, `datasheet_ability`, …). A row printed by
   * several factions has one id per faction: pass the faction to pick, else the row must have one.
   */
  idOf(table: string, rowId: string, faction?: string): string | undefined;
}

const cache = new WeakMap<MfmDump, MirrorIds>();

export function mirrorIds(dump: MfmDump): MirrorIds {
  const hit = cache.get(dump);
  if (hit) return hit;
  const ids = buildIdentities(enumerateAbilityRows(dump));
  const out: MirrorIds = {
    idOf(table, rowId, faction) {
      const all = ids.byDumpRow.get(`${table}#${rowId}`) ?? [];
      const pick = faction ? all.filter((id) => ids.byId.get(id)?.faction === faction) : all;
      return pick.length === 1 ? pick[0] : undefined;
    },
  };
  cache.set(dump, out);
  return out;
}
