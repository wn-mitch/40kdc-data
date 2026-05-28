/**
 * The eligible-abilities resolver: given a unit (plus optional detachment,
 * leader, supporting units), enumerate every ability that could apply to it
 * in a chosen phase, tagged by source so the SPA can group them in the UI.
 *
 * @packageDocumentation
 */
export {
  resolveEligibleAbilities,
  type EligibilityInput,
  type EligibleAbility,
  type EligibleAbilitySource,
} from "./resolver.js";
