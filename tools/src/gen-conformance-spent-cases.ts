import { dslExpectation } from "./gen-conformance-cruncher-cases.js";

export const SPENT_AMOUNT_CASE_PREFIX = "canonical/spent-amount/";

/**
 * Fabricated changes whose amount is what a resource spend of the same ability spent ("spend up to
 * 3 points and add the number you spent to the Damage characteristic"). A spend of up to N binds
 * its amount, and a change reading it is a lever at N (one per `per`, rounded down); a spend of any
 * amount has no most, so the change stays unresolved. The spend's own {up_to} amount sizes nothing.
 */
export function canonicalSpentAmountCases() {
  const source = { kind: "ability", abilityId: "fabricated-spent-amount", abilityKind: "unit" } as const;
  const spend = (amount: unknown) => ({ type: "resource-spend", target: "this-model", modifier: { pool: "fabricated-pool", amount, bind_as: "spent" } });
  const damage = (value: unknown) => ({ type: "stat-modifier", target: "this-unit", modifier: { stat: "D", operation: "add", value, weapons: { type: "melee" } } });
  const inputs: Array<{ id: string; effect: unknown }> = [
    { id: "up-to-lever", effect: { type: "sequence", steps: [spend({ up_to: 3 }), damage({ spent: "spent" })] } },
    { id: "per-rounds-down", effect: { type: "sequence", steps: [spend({ up_to: 3 }), damage({ spent: "spent", per: 2 })] } },
    { id: "any-amount-unresolved", effect: { type: "sequence", steps: [spend("any"), damage({ spent: "spent" })] } },
  ];
  return inputs.map((input) => dslExpectation({
    caseId: `${SPENT_AMOUNT_CASE_PREFIX}${input.id}`,
    abilityId: source.abilityId,
    source,
    effect: input.effect,
    context: { phase: "fight" },
    perspective: "attacker",
  }));
}
