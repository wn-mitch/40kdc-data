/**
 * The mortal wounds a unit's abilities inflict on an enemy unit outside its attacks, as
 * {@link Dataset.mortalWoundSourcesFor} answers them.
 *
 * @packageDocumentation
 */
import type { EngineContext } from "../cruncher/buffs.js";
import { mortalWoundSources, type MortalWoundSource } from "../cruncher/mortal-sources.js";
import type { UnsupportedFragment } from "../cruncher/from-dsl.js";
import type { Phase } from "../generated.js";
import type { Dataset } from "./dataset.js";
import { buffContext, inputEligibleAbilities, type BuffInput } from "./dataset-buffs.js";

const PHASES: readonly Phase[] = ["command", "movement", "shooting", "charge", "fight"];

/** One {@link MortalWoundSource} with the ability that inflicts it. */
export type AbilityMortalWounds = MortalWoundSource & {
  abilityId: string;
  /** The ability's name. */
  label: string;
  /** The Stratagem's CP cost, for a Stratagem. */
  cp?: number;
};

/** {@link Dataset.mortalWoundSourcesFor} for `ds`. */
export function mortalWoundSourcesFor(
  ds: Dataset,
  input: BuffInput,
  context: EngineContext,
): { sources: AbilityMortalWounds[]; unsupported: (UnsupportedFragment & { abilityId: string })[] } {
  const ctx = buffContext(ds, input, context, "attacker");
  const sources: AbilityMortalWounds[] = [];
  const unsupported: (UnsupportedFragment & { abilityId: string })[] = [];
  const seen = new Set<string>();
  // A source happens at its own moment, whatever phase the attack is made in: walk every phase.
  const eligible = PHASES.flatMap((phase) => inputEligibleAbilities(ds, input, phase));
  for (const entry of eligible) {
    const ability = entry.ability;
    if (seen.has(ability.id)) continue;
    seen.add(ability.id);
    const translation = mortalWoundSources(ability.id, ability.raw.effect, ability.raw.trigger, ctx, entry.rating);
    const cp = entry.source.kind === "detachment-stratagem" ? entry.source.cpCost : undefined;
    for (const source of translation.sources) {
      sources.push({ ...source, abilityId: ability.id, label: ability.name, ...(cp === undefined ? {} : { cp }) });
    }
    for (const fragment of translation.unsupported) unsupported.push({ ...fragment, abilityId: ability.id });
  }
  return { sources, unsupported };
}
