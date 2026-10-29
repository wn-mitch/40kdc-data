import type { BuffSource, EngineContext } from "../cruncher/index.js";
import type { EligibilityInput, EligibleAbility } from "../abilities-resolver/index.js";
import type { Dataset } from "../data/dataset.js";
import type { MatrixConfig } from "./config.js";
import type { StackBuffPool } from "./model.js";
import { WEAPON_GRANT_REASON } from "./weapon-grants.js";

/** The buff source of an eligible rule. */
export function sourceFor(entry: EligibleAbility): BuffSource {
  switch (entry.source.kind) {
    case "army":
      return { kind: "ability", abilityId: entry.ability.id, abilityKind: "army" };
    case "detachment":
      return { kind: "ability", abilityId: entry.ability.id, abilityKind: "detachment" };
    case "detachment-stratagem":
      return { kind: "ability", abilityId: entry.ability.id, abilityKind: "detachment-stratagem", ...(entry.source.selectsModel ? { selectsModel: true } : {}) };
    case "unit":
      return { kind: "ability", abilityId: entry.ability.id, abilityKind: "unit" };
    case "attached":
      return { kind: "ability", abilityId: entry.ability.id, abilityKind: "attached", sourceUnitId: entry.source.unitId };
    case "support":
      return { kind: "ability", abilityId: entry.ability.id, abilityKind: "support", sourceUnitId: entry.source.sourceUnitId };
  }
}

/**
 * The fragments of every rule `input` is eligible for that do not translate under `context`, from
 * `perspective`. Weapon grants in `scoredGrants` (`<abilityId>|<weaponId>`) were scored, and army
 * rules in `replaced` do not apply; a defender's activatable choice is reported as unselected.
 */
export function translationWarnings(
  dataset: Dataset,
  config: MatrixConfig,
  input: EligibilityInput,
  context: EngineContext,
  perspective: "attacker" | "target",
  scoredGrants: ReadonlySet<string>,
  replaced: ReadonlySet<string>,
): StackBuffPool["warnings"] {
  const warnings: StackBuffPool["warnings"] = [];
  for (const entry of dataset.eligibleAbilities(input, context.phase)) {
    if (config.droppedArmyRules.includes(entry.ability.id)) continue;
    if (entry.source.kind === "army" && replaced.has(entry.ability.id)) continue;
    const translated = entry.ability.describeBuffs(sourceFor(entry), context, perspective, entry.rating);
    for (const fragment of translated.unsupported) {
      const weaponId = (fragment.effectFragment as { modifier?: { weapon_id?: unknown } } | null)?.modifier?.weapon_id;
      if (fragment.reason === WEAPON_GRANT_REASON && scoredGrants.has(`${entry.ability.id}|${String(weaponId)}`)) continue;
      warnings.push({
        sourceAbilityId: entry.ability.id,
        ...(entry.source.kind === "support" ? { sourceUnitId: entry.source.sourceUnitId } : {}),
        perspective,
        sourceKind: entry.source.kind,
        reason: fragment.reason ?? "unsupported DSL fragment",
      });
    }
    if (perspective === "target" && translated.activatable.length > 0) {
      warnings.push({
        sourceAbilityId: entry.ability.id,
        perspective,
        sourceKind: entry.source.kind,
        reason: "defensive activatable choice is not selected by the attacker benchmark",
      });
    }
  }
  return warnings;
}
