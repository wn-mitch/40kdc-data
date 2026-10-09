import { type FamilyExtension, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Attack-target recipients: a grant or stat change whose subject is the attack's target ("the
 * target has the benefit of cover", "the target unit has 4+ invulnerable save", "the target unit
 * has Fly"). The subject is a reviewed binding: it names `defender` in the DSL (compile-fragments.ts
 * SUBJECT_TARGETS), and no other leaf reaches the attack's target (core-ability-grant's antecedent
 * reaches the allocated model, not the target).
 */
const TARGET = "target";

/** Subject `target` stands in for this-unit with the previous version, which then checks the rest. */
const targetSubject = (family: string, description: string): FamilyExtension => ({
  family,
  description: `As the previous version, and subject can be the attack's target (${description}), which the DSL names as the defender.`,
  schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [TARGET]) }),
  normalize: (input, previous) => input.subject === TARGET ? standIn(input, "subject", "this-unit", previous) : previous(input),
});

export const FAMILY_EXTENSIONS_16_GRANT_TO_ATTACK_TARGET: readonly FamilyExtension[] = [
  targetSubject("invulnerable-save", "the target unit's models get the invulnerable save"),
  targetSubject("keyword-grant", "the target unit gains keywords"),
  targetSubject("characteristic-modifier", "a reviewed recipient: the target unit's characteristic changes"),
];
