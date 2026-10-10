import { type FamilyExtension, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-10 attacker-side filter. A stat setter whose subject is the attack itself: "change the Damage
 * characteristic of that attack to 1". The attack is the incoming attack when the leaf sits in an
 * allocation or roll moment, else the attack the bearer's own unit makes. Lowering:
 * compile-fragments.ts (characteristic-set, subject attack) names the same owner as a
 * characteristic-modifier with subject attack. Only the new version takes the value; earlier
 * versions keep their subject enum.
 */
const ATTACK = "attack";

export const FAMILY_EXTENSIONS_16_ATTACKER_SIDE_FILTER: readonly FamilyExtension[] = [
  {
    family: "characteristic-set",
    description: "As the previous version, and the subject can be attack: the weapon making the attack, whoever makes it (the attacker of an incoming attack, else this unit's attacks).",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [ATTACK]) }),
    normalize: (input, previous) => input.subject === ATTACK ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
];
