import { dslExpectation, type DslInput } from "./gen-conformance-cruncher-cases.js";

export const VISIBLE_TARGET_CASE_PREFIX = "canonical/visible-target/";

/**
 * Fabricated grants gated on the attack's target being visible to the attacking model ("ranged
 * attacks that target a visible enemy unit"): a unit-filter's `visible: {to: "attacker"}` on the
 * defender. The declared `targetVisible` decides it either way; undeclared it is unknown, as is a
 * view by another unit.
 */
export function canonicalVisibleTargetCases() {
  const source = { kind: "ability", abilityId: "fabricated-visible-target", abilityKind: "unit" } as const;
  const grant = { type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "ignores-cover" }], weapons: { type: "ranged" } } };
  const gated = (visible: unknown) => ({
    type: "conditional",
    condition: { type: "matches", parameters: { subject: "defender", filter: { owner: "enemy", visible } } },
    effect: grant,
  });
  const inputs: Array<{ id: string; effect: unknown; context: DslInput["context"] }> = [
    { id: "declared-visible", effect: gated({ to: "attacker" }), context: { phase: "shooting", targetVisible: true } },
    { id: "declared-hidden", effect: gated({ to: "attacker" }), context: { phase: "shooting", targetVisible: false } },
    { id: "undeclared", effect: gated({ to: "attacker" }), context: { phase: "shooting" } },
    { id: "other-observer-stays-unknown", effect: gated({ to: "this-model" }), context: { phase: "shooting", targetVisible: true } },
  ];
  return inputs.map((input) => dslExpectation({
    caseId: `${VISIBLE_TARGET_CASE_PREFIX}${input.id}`,
    abilityId: source.abilityId,
    source,
    effect: input.effect,
    context: input.context,
    perspective: "attacker",
  }));
}
