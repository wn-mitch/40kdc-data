/**
 * A decoded {@link ShareList} as a resolved {@link Roster}. Every name the
 * resolver sees is a dataset id, which collection lookup matches exactly before
 * any name lookup, so the roster names the same records the token does.
 */
import { Dataset } from "../data/dataset.js";
import { resolve } from "../import/resolve.js";
import type { ParsedRoster, ParsedUnit, Roster } from "../import/types.js";
import type { ShareList } from "./codec.js";

const BATTLE_SIZE_LABEL = { incursion: "Incursion", "strike-force": "Strike Force" } as const;

/** The share list as a roster resolved against `dataset` (the embedded matched-play view by default). */
export function shareListToRoster(list: ShareList, dataset: Dataset = Dataset.embedded()): Roster {
  const units: ParsedUnit[] = list.units.map((u) => {
    const bodyguard = u.attachedToOrdinal === null ? undefined : list.units[u.attachedToOrdinal];
    const datasheet = dataset.units.getAny(u.datasheetId);
    return {
      raw_name: u.datasheetId,
      is_character: datasheet?.keywords.includes("Character") ?? false,
      keyword_overrides: u.grants.length > 0 ? [...u.grants] : undefined,
      model_count: u.modelCount,
      points: null,
      is_warlord: u.isWarlord,
      enhancement_raw_name: u.enhancementId,
      enhancement_points: null,
      wargear: u.loadout.map(([id, count]) => ({ raw_name: id, count })),
      leader_attachment: bodyguard ? { bodyguard_raw_name: bodyguard.datasheetId, role: "leader", provisional: false } : null,
    };
  });
  const parsed: ParsedRoster = {
    name: list.name,
    generated_by: "40kdc share token",
    faction_raw_name: list.factionId,
    detachment_raw_names: [...list.detachmentIds],
    battle_size_raw: BATTLE_SIZE_LABEL[list.battleSize],
    force_disposition: list.disposition,
    declared_limit: null,
    total_reported: null,
    total_computed: 0,
    units,
    multi_force: false,
  };
  return resolve(parsed, dataset, "roster-json");
}
