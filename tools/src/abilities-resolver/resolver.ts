/**
 * Walks the dataset for every ability that could apply to a chosen unit in a
 * chosen phase. The SPA passes the result through to the buff layer (each
 * {@link EligibleAbility} carries `.getBuffs()`, the source is pre-tagged).
 *
 * Resolution order — stable for snapshot tests:
 *
 * 1. **army** — faction-scoped abilities whose `ability_type` is `"faction"`
 *    and whose `faction_id` matches the input.
 * 2. **detachment** — abilities authored against the detachment
 *    (`ability_type` is `"detachment"`, `detachment_id` matches).
 * 3. **detachment-stratagem** — stratagems on the detachment, each yielding
 *    the ability referenced by `stratagem.ability_id` (if any).
 * 4. **unit** — abilities listed in `unit.ability_ids`.
 * 5. **leader** — abilities listed in the attached leader's `ability_ids`.
 * 6. **support** — abilities on supporting units whose scope range is an
 *    aura (not `self` / `unit`).
 *
 * Each step phase-filters via the existing `Dataset.phasesFor` index. The
 * resolver collects abilities first, *then* filters by phase, so the SPA can
 * also ask "what abilities are eligible across all phases?" by passing every
 * phase (today the API requires a single phase; if the SPA wants the wide
 * view it can call the resolver once per phase).
 */
import type { Phase, Stratagem } from "../generated.js";
import type { Dataset } from "../data/dataset.js";
import type { AbilityView } from "../data/entities.js";

export type EligibleAbilitySource =
  | { kind: "army" }
  | { kind: "detachment"; detachmentId: string }
  | { kind: "detachment-stratagem"; stratagemId: string; cpCost: number }
  | { kind: "unit"; unitId: string }
  | { kind: "leader"; leaderId: string }
  | { kind: "support"; sourceUnitId: string };

export type EligibilityInput = {
  unitId: string;
  /** Overrides the unit's own `faction_id` when given (for inheritance cases). */
  factionId?: string;
  detachmentId?: string;
  attachedLeaderId?: string;
  /** Friendly units whose auras could apply (M2 walks only their aura-ranged abilities). */
  supportingUnitIds?: string[];
};

export type EligibleAbility = {
  ability: AbilityView;
  source: EligibleAbilitySource;
  /** The subset of `ability.phases` that intersect the requested phase. */
  phases: Phase[];
};

/** Compute the sorted-by-source eligible-ability list for one (unit, phase). */
export function resolveEligibleAbilities(
  dataset: Dataset,
  input: EligibilityInput,
  phase: Phase,
): EligibleAbility[] {
  const unit = dataset.units.get(input.unitId);
  if (!unit) return [];
  const factionId = input.factionId ?? unit.raw.faction_id;
  const seen = new Set<string>();
  const out: EligibleAbility[] = [];

  // 1. Army — faction-scoped abilities (faction rule + any other faction-typed).
  for (const ability of dataset.abilities.byFaction(factionId)) {
    if (ability.raw.ability_type !== "faction") continue;
    if (!phaseMatches(ability, phase)) continue;
    pushUnique(out, seen, { ability, source: { kind: "army" }, phases: intersect(ability.phases, phase) });
  }

  // 2. Detachment abilities — abilities whose detachment_id matches.
  if (input.detachmentId) {
    for (const ability of dataset.abilities) {
      if (ability.raw.ability_type !== "detachment") continue;
      if (ability.raw.detachment_id !== input.detachmentId) continue;
      if (!phaseMatches(ability, phase)) continue;
      pushUnique(out, seen, {
        ability,
        source: { kind: "detachment", detachmentId: input.detachmentId },
        phases: intersect(ability.phases, phase),
      });
    }

    // 3. Detachment stratagems.
    const detachment = dataset.detachments.get(input.detachmentId);
    if (detachment) {
      for (const stratId of detachment.stratagem_ids ?? []) {
        const stratagem = dataset.stratagems.get(stratId);
        if (!stratagem) continue;
        if (!stratagemPhaseMatches(stratagem, phase)) continue;
        const ability =
          stratagem.ability_id !== null && stratagem.ability_id !== undefined
            ? dataset.abilities.get(stratagem.ability_id)
            : undefined;
        if (!ability) continue;
        pushUnique(out, seen, {
          ability,
          source: {
            kind: "detachment-stratagem",
            stratagemId: stratagem.id,
            cpCost: stratagem.cp_cost,
          },
          phases: [phase], // the stratagem's printed phase governs eligibility.
        });
      }
    }
  }

  // 4. Unit's own abilities.
  for (const ability of unit.abilities) {
    if (!phaseMatches(ability, phase)) continue;
    pushUnique(out, seen, {
      ability,
      source: { kind: "unit", unitId: input.unitId },
      phases: intersect(ability.phases, phase),
    });
  }

  // 5. Attached leader.
  if (input.attachedLeaderId) {
    const leader = dataset.units.get(input.attachedLeaderId);
    if (leader) {
      for (const ability of leader.abilities) {
        if (!phaseMatches(ability, phase)) continue;
        pushUnique(out, seen, {
          ability,
          source: { kind: "leader", leaderId: input.attachedLeaderId },
          phases: intersect(ability.phases, phase),
        });
      }
    }
  }

  // 6. Supporting units — only aura-scoped abilities (otherwise the buff
  // would describe a self-target effect that doesn't reach the input unit).
  for (const supportId of input.supportingUnitIds ?? []) {
    const supporter = dataset.units.get(supportId);
    if (!supporter) continue;
    for (const ability of supporter.abilities) {
      if (!phaseMatches(ability, phase)) continue;
      if (!isAuraScope(ability.raw.scope?.range)) continue;
      pushUnique(out, seen, {
        ability,
        source: { kind: "support", sourceUnitId: supportId },
        phases: intersect(ability.phases, phase),
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function phaseMatches(ability: AbilityView, phase: Phase): boolean {
  const phases = ability.phases;
  // An ability with no phase-mapping is permissive — surface it everywhere so
  // the SPA can decide. M2's translator already gates conditional-on-phase
  // effects internally, so this stays generous on purpose.
  if (phases.length === 0) return true;
  return phases.includes(phase);
}

function stratagemPhaseMatches(stratagem: Stratagem, phase: Phase): boolean {
  if (!stratagem.phases || stratagem.phases.length === 0) return false;
  return (stratagem.phases as Phase[]).includes(phase);
}

function intersect(phases: Phase[], phase: Phase): Phase[] {
  return phases.includes(phase) ? [phase] : phases;
}

function isAuraScope(range: unknown): boolean {
  if (typeof range !== "string") return false;
  return range.startsWith("aura-") || range === "any-on-battlefield" || range === "any-visible";
}

function pushUnique(
  out: EligibleAbility[],
  seen: Set<string>,
  entry: EligibleAbility,
): void {
  const key = `${entry.source.kind}::${entry.ability.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(entry);
}
