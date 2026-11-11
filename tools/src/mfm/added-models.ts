/**
 * The model types a datasheet holds only for rules that add models during the battle. GW's data
 * lists them as miniatures every unit composition caps at 0 (Split's Blue and Brimstone Horrors),
 * each with its own keywords and a base loadout: the gear a newly added model of that type has.
 */
import type { MfmDump } from "./loader.js";

export interface AddedModel {
  name: string;
  profile_name?: string;
  keywords: string[];
  default_weapon_ids: string[];
}

/**
 * The added model types of `datasheetId`, in display order. `resolve` maps a dump item name to a
 * repo id; `profileNames` are the unit's profile names. Returns the item names that do not resolve
 * instead when any does.
 */
export function addedModels(
  dump: MfmDump,
  datasheetId: string,
  resolve: (name: string) => string | null,
  profileNames: ReadonlySet<string>,
): { models: AddedModel[] } | { unresolvedItems: string[] } {
  const caps = new Map<string, number[]>();
  for (const composition of dump.groupBy("unit_composition", "datasheetId").get(datasheetId) ?? []) {
    for (const row of dump.groupBy("unit_composition_miniature", "unitCompositionId").get(composition.id) ?? []) {
      caps.set(row.miniatureId, [...(caps.get(row.miniatureId) ?? []), row.max]);
    }
  }
  const keywordById = dump.byId("keyword");
  const itemById = dump.byId("wargear_item");
  const optionById = dump.byId("wargear_option");
  const keywordsOf = dump.groupBy("miniature_keyword", "miniatureId");
  const basesOf = dump.groupBy("base_miniature_loadout", "miniatureId");
  const baseOptions = dump.groupBy("base_miniature_loadout_wargear_option", "baseMiniatureLoadoutId");
  const unresolved = new Set<string>();
  const models = [...dump.byId("miniature").values()]
    .filter((mini) => mini.datasheetId === datasheetId && (caps.get(mini.id)?.every((max) => max === 0) ?? false))
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id.localeCompare(b.id))
    .map((mini): AddedModel => {
      const name = dump.enName(mini) ?? mini.id;
      const keywords = (keywordsOf.get(mini.id) ?? [])
        .slice()
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        .flatMap((row) => dump.enName(keywordById.get(row.keywordId)) ?? []);
      const gear: string[] = [];
      for (const base of basesOf.get(mini.id) ?? []) {
        for (const row of baseOptions.get(base.id) ?? []) {
          const itemName = dump.enName(itemById.get(optionById.get(row.wargearOptionId)?.wargearItemId ?? ""));
          if (!itemName) continue;
          const id = resolve(itemName);
          if (!id) unresolved.add(itemName);
          else for (let k = 0; k < row.count; k++) gear.push(id);
        }
      }
      return {
        name,
        ...(profileNames.has(name) ? { profile_name: name } : {}),
        keywords,
        default_weapon_ids: gear.sort(),
      };
    });
  return unresolved.size > 0 ? { unresolvedItems: [...unresolved].sort() } : { models };
}
