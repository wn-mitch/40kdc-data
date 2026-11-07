import type { BuffSource, EngineContext } from "../cruncher/buffs.js";
import { sameSnapshotValue } from "../cruncher/recipient-snapshots.js";
import type { BuffInput, Dataset } from "./dataset.js";
import type { AbilityView } from "./entities.js";
import { canTakeEnhancement } from "./lever-providers.js";

/** Rediscover an attested persistent source after its former attachment is gone. */
export function historicalSnapshotAbilities(
  ds: Dataset,
  input: BuffInput,
  context: EngineContext,
  perspective: "attacker" | "target",
): { ability: AbilityView; source: BuffSource }[] {
  const faction = input.factionId ?? (input.unitId === undefined ? undefined : ds.units.getAny(input.unitId))?.factionId;
  if (!faction) return [];
  const result: { ability: AbilityView; source: BuffSource }[] = [];
  for (const snapshot of context.recipientSnapshots ?? []) {
    if (snapshot.perspective !== perspective || snapshot.recipientUnitId !== input.unitId) continue;
    const source = snapshot.source;
    if (!["unit", "attached", "support"].includes(source.abilityKind)) continue;
    if (source.abilityKind === "unit" ? snapshot.sourceUnitId !== input.unitId : source.sourceUnitId !== snapshot.sourceUnitId) continue;
    const owner = ds.units.getInFaction(snapshot.sourceUnitId, faction);
    const ability = ds.abilities.getInFaction(source.abilityId, faction) ?? ds.abilities.getInFaction(source.abilityId, "core");
    if (!owner || !ability) continue;
    const intrinsic = owner.abilities.some((held) => held.id === ability.id);
    // Every game mode: a lookup of the chosen detachment's enhancement, not a listing.
    const enhancement = [...ds.forGameMode("all").enhancements].some((item) => item.ability_id === ability.id && item.detachment_id === input.detachmentId && canTakeEnhancement(ds, item, owner));
    if (!intrinsic && !enhancement) continue;
    // The current record still owns the exact trigger/selector: describeBuffs checks
    // those fingerprints before any historical recipients are materialized.
    if (!result.some((entry) => entry.ability.id === ability.id && sameSnapshotValue(entry.source, source))) result.push({ ability, source });
  }
  return result;
}
