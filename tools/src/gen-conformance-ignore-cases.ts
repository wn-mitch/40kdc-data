import { dslExpectation, type DslInput } from "./gen-conformance-cruncher-cases.js";

export const IGNORE_MODIFIERS_CASE_PREFIX = "canonical/ignore-modifiers/";

/**
 * Fabricated ignore-modifiers rows for every roll but some: excluding saves leaves the hit and
 * wound levers less any roll also excluded, excluding every attack roll leaves nothing, and
 * every roll with saves included (or a non-save exclusion) stays unsupported.
 */
export function canonicalIgnoreModifiersCases() {
  const source = { kind: "ability", abilityId: "fabricated-resolve", abilityKind: "unit" } as const;
  const ignore = (modifier: Record<string, unknown>) => ({ type: "ignore-modifiers", target: "this-unit", modifier: { what: "rolls", ...modifier } });
  const inputs: Array<{ id: string; effect: unknown; perspective: DslInput["perspective"] }> = [
    { id: "all-except-save", effect: ignore({ rolls: ["all"], except_rolls: ["save"] }), perspective: "attacker" },
    { id: "any-except-save-and-hit", effect: ignore({ rolls: ["any"], except_rolls: ["save", "hit"] }), perspective: "attacker" },
    { id: "all-except-attack-rolls", effect: ignore({ rolls: ["all"], except_rolls: ["hit", "wound", "save"] }), perspective: "attacker" },
    { id: "all-except-hit", effect: ignore({ rolls: ["all"], except_rolls: ["hit"] }), perspective: "attacker" },
    { id: "all", effect: ignore({ rolls: ["all"] }), perspective: "attacker" },
    { id: "all-except-save-target-walk", effect: ignore({ rolls: ["all"], except_rolls: ["save"] }), perspective: "target" },
  ];
  return inputs.map((input) => dslExpectation({
    caseId: `${IGNORE_MODIFIERS_CASE_PREFIX}${input.id}`,
    abilityId: source.abilityId,
    source,
    effect: input.effect,
    context: { phase: "shooting" },
    perspective: input.perspective,
  }));
}
