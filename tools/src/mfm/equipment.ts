/**
 * Equipment GW draws as a miniature: a statline-less miniature a priced unit composition adds
 * (the Tidewall Shieldline's Tidewall defence platform, its 105-point build over the 85-point
 * one). It is wargear of the datasheet's one statlined model, so the wargear pass offers it as an
 * option and the wargear-costs pass charges the two compositions' price difference for it.
 */
import type { MfmDump } from "./loader.js";

export interface DatasheetEquipment {
  /** The equipment miniature's display name, which names its wargear record. */
  name: string;
  /** How many the model may take: the most any composition adds. */
  max: number;
  /** Points the composition adding it costs over the same composition without it. */
  cost: number;
}

/** The equipment miniatures of `datasheetId`, in display order. */
export function datasheetEquipment(dump: MfmDump, datasheetId: string): DatasheetEquipment[] {
  const equipment = dump.equipmentMiniatureIds();
  const minis = (dump.groupBy("miniature", "datasheetId").get(datasheetId) ?? [])
    .filter((row) => equipment.has(row.id))
    .sort((a, b) => a.displayOrder - b.displayOrder);
  if (minis.length === 0) return [];
  const comps = (dump.groupBy("unit_composition", "datasheetId").get(datasheetId) ?? [])
    .filter((c) => c.points != null && !c.referenceGroupingKeywordId);
  const rawRows = dump.groupBy("unit_composition_miniature", "unitCompositionId");
  // A composition's models, without its equipment: two compositions with the same key differ only in equipment.
  const modelsKey = (compId: string) => dump.compositionMiniatures(compId)
    .map((row) => `${row.miniatureId}:${row.min}:${row.max}`).sort().join("|");
  return minis.map((mini) => {
    const name = dump.enName(mini) ?? mini.id;
    let max = 0;
    const costs = new Set<number>();
    for (const comp of comps) {
      const count = (rawRows.get(comp.id) ?? []).find((row) => row.miniatureId === mini.id)?.max ?? 0;
      if (count <= 0) continue;
      if ((rawRows.get(comp.id) ?? []).some((row) => row.max > 0 && equipment.has(row.miniatureId) && row.miniatureId !== mini.id)) {
        throw new Error(`${name}: composition ${comp.id} adds more than one equipment miniature; its price split is unverified`);
      }
      const base = comps.find((other) => other.id !== comp.id && modelsKey(other.id) === modelsKey(comp.id)
        && (rawRows.get(other.id) ?? []).every((row) => row.max === 0 || !equipment.has(row.miniatureId)));
      if (!base) throw new Error(`${name}: composition ${comp.id} has no same-model composition without it to price it against`);
      max = Math.max(max, count);
      costs.add((comp.points! - base.points!) / count);
    }
    if (costs.size !== 1) throw new Error(`${name}: compositions price it ${costs.size === 0 ? "nowhere" : "differently"}`);
    const [cost] = costs;
    if (!Number.isInteger(cost) || cost < 0) throw new Error(`${name}: price ${cost} is not a whole number of points`);
    return { name, max, cost };
  });
}
