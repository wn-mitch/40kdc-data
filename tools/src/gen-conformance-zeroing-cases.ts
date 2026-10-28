import { dslExpectation, type DslInput } from "./gen-conformance-cruncher-cases.js";

export const DAMAGE_ZEROING_CASE_PREFIX = "canonical/damage-zeroing/";

/**
 * Fabricated damage-reduction rows: a `to-zero` reduction becomes a damage-zeroing defence counted
 * from its usage limit (none, an n-per-battle count, per-model, the tightest of several), a halving
 * one stays unsupported, and the attacker's own walk drops the defender stat.
 */
export function canonicalDamageZeroingCases() {
  const source = { kind: "ability", abilityId: "fabricated-plating", abilityKind: "unit" } as const;
  const toZero = { type: "damage-reduction", target: "this-unit", modifier: { reduction: "to-zero" } };
  const limited = (usage: unknown) => ({ type: "ability-part", usage, effect: toZero });
  const inputs: Array<{ id: string; effect: unknown; perspective: DslInput["perspective"] }> = [
    { id: "unlimited", effect: toZero, perspective: "target" },
    { id: "n-per-battle", effect: limited({ frequency: "n-per-battle", count: 2, per: "unit" }), perspective: "target" },
    { id: "per-model", effect: limited({ frequency: "once-per-battle-round", per: "model" }), perspective: "target" },
    { id: "tightest-limit", effect: limited([{ frequency: "n-per-battle", count: 3, per: "model" }, { frequency: "once-per-turn", per: "unit" }]), perspective: "target" },
    { id: "half", effect: { ...toZero, modifier: { reduction: "half" } }, perspective: "target" },
    { id: "attacker-walk", effect: toZero, perspective: "attacker" },
  ];
  return inputs.map((input) => dslExpectation({
    caseId: `${DAMAGE_ZEROING_CASE_PREFIX}${input.id}`,
    abilityId: source.abilityId,
    source,
    effect: input.effect,
    context: { phase: "shooting" },
    perspective: input.perspective,
  }));
}
