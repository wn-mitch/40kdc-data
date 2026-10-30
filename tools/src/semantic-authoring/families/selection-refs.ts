import { type FamilyExtension, optional, withProperties } from "../family-extension-helpers.js";
import { SELECTION_NAME, selectionName } from "./selections.js";

/**
 * `selection`: which bound selection (a select-unit's bind_as) an anaphor names, in a record that
 * selects several units ("that **X** unit", "the selected **Y** unit"). It
 * goes only with the leaf's own back-reference, so a leaf names its unit once; the compiler refuses
 * a name the record does not bind.
 */
function selectionRef(family: string, version: number, field: string, references: readonly string[], example: string): FamilyExtension {
  return {
    family,
    version,
    description: `As the previous version, plus selection: the bind_as of the select-unit the ${field} names when the record selects several units (${example}). It goes only with ${field} ${references.join(" or ")}.`,
    schema: (previous) => withProperties(previous, { selection: optional({ ...SELECTION_NAME, "x-only-when": { [field]: [...references] } }) }),
    normalize: (input, previous) => {
      if (input.selection === undefined) return previous(input);
      const { selection, ...rest } = input;
      if (!references.includes(String(rest[field]))) throw new TypeError(`${family}.selection names which selected unit ${field} ${references.join(" or ")} is; it takes no other ${field}.`);
      return { ...previous(rest), selection: selectionName(selection, `${family}.selection`) };
    },
  };
}

export const SELECTION_REF_EXTENSIONS: readonly FamilyExtension[] = [
  selectionRef("mortal-wounds", 6, "recipient", ["that-unit", "antecedent"], "\"that X unit suffers D3 mortal wounds\""),
  selectionRef("regain-wounds", 6, "subject", ["antecedent"], "\"one model in the selected Y unit regains\""),
  selectionRef("attack", 9, "unit", ["that-unit"], "\"each time a model in the selected Y unit makes an attack\""),
];
