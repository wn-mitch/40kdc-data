import { ANTECEDENT } from "./antecedent-families.js";
import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

/**
 * Wave 8, hidden retention: "those attacks", the attacks of an earlier shooting moment of the
 * same record. Compilation binds them to that moment (`compile-bound-attacks.ts`); the leaf only
 * records that it points back.
 */

/**
 * The attack-filter fields "those attacks" can carry beside `of`. A shooting moment's attacks
 * are ranged by definition, so only attack_type ranged may restate it; any other field would
 * narrow the bound attacks in a way the DSL's event reference cannot say.
 */
export function boundAttacksProblem(parameters: Record<string, unknown>): string | null {
  const extra = Object.keys(parameters).filter((key) => key !== "of" && key !== "attack_type");
  if (extra.length) return `attack-filter of antecedent names the attacks of an earlier shooting moment; ${extra.join(", ")} cannot narrow them.`;
  if (parameters.attack_type !== undefined && parameters.attack_type !== "ranged") {
    return `attack-filter of antecedent names the attacks of an earlier shooting moment, which are ranged, not ${String(parameters.attack_type)}.`;
  }
  return null;
}

export const FAMILY_EXTENSIONS_W8_HIDDEN: readonly FamilyExtension[] = [
  {
    // "Those attacks do not prevent your unit from being hidden", "those ranged attacks …".
    family: "attack-filter",
    description: "As the previous version, plus of antecedent: the attacks an earlier moment of the record introduced (\"those attacks\", \"those ranged attacks\"): the attacks a shooting selection goes on to make, or the attacks of a shooting that has just resolved.",
    schema: (previous) => withProperties(previous, { of: optional({ enum: [ANTECEDENT] }) }),
    normalize: (input, previous) => {
      if (!("of" in input)) return previous(input);
      if (input.of !== ANTECEDENT) throw new TypeError(`attack-filter.of is ${ANTECEDENT} or absent.`);
      const problem = boundAttacksProblem(input);
      if (problem) throw new TypeError(problem);
      const { of: _of, ...rest } = input;
      return { ...(Object.keys(rest).length ? previous(rest) : {}), of: ANTECEDENT };
    },
  },
];
