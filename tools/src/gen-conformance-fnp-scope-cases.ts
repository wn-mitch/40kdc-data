import { dslExpectation } from "./gen-conformance-cruncher-cases.js";

export const FNP_SCOPE_CASE_PREFIX = "canonical/feel-no-pain-scope/";

/**
 * Fabricated Feel No Pain rows by what each covers: a list naming mortal wounds joins the mortal
 * stream, a list without them and a Damage-1-only one stay unsupported.
 */
export function canonicalFnpScopeCases() {
  const source = { kind: "ability", abilityId: "fabricated-warding", abilityKind: "unit" } as const;
  const fnp = (against: unknown) => ({ type: "feel-no-pain", target: "this-unit", modifier: { threshold: 5, against } });
  const inputs: Array<{ id: string; against: unknown }> = [
    { id: "list-with-mortal", against: ["mortal", "devastating-wounds"] },
    { id: "list-without-mortal", against: ["psychic", "devastating-wounds"] },
    { id: "damage-1-unmodified", against: "damage-1-unmodified" },
  ];
  return inputs.map((input) => dslExpectation({
    caseId: `${FNP_SCOPE_CASE_PREFIX}${input.id}`,
    abilityId: source.abilityId,
    source,
    effect: fnp(input.against),
    context: { phase: "shooting" },
    perspective: "target",
  }));
}
