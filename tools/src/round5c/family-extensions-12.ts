import { ANTECEDENT } from "./antecedent-families.js";
import { type FamilyExtension, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Twelfth round of family extensions: the clusters of the round after wave 6 that the compiler
 * work (antecedent slots, attackers named by an earlier unit, target conditions on an attack)
 * needed on families. Each entry bumps its family by one version.
 */
export const FAMILY_EXTENSIONS_12: readonly FamilyExtension[] = [
  {
    // "if a friendly X unit is within a terrain area, that unit …": the units an earlier filter matches.
    family: "in-region",
    description: "As the previous version, plus subject antecedent: the unit an earlier leaf introduced (\"if a friendly X unit is wholly within a terrain area, that unit …\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [ANTECEDENT]) }),
    normalize: (input, previous) => input.subject === ANTECEDENT ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
  {
    // "each time an enemy model makes an attack": any enemy unit attacks, or the enemy units the
    // unit-filter right before the attack matches.
    family: "attack",
    description: "As the previous version, plus unit enemy-unit: an enemy unit makes the attack (\"each time an enemy model makes a ranged attack\"); a unit-filter right before it says which enemy units.",
    schema: (previous) => withProperties(previous, { unit: widenedEnum(previous, "unit", ["enemy-unit"]) }),
    normalize: (input, previous) => input.unit === "enemy-unit" ? standIn(input, "unit", "friendly-unit", previous) : previous(input),
  },
];
