import { ANTECEDENT } from "./antecedent-families.js";
import { type FamilyExtension, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Wave 8 family extensions for model-level recipients: the families whose leaves name a model a
 * unit-filter introduced earlier in the record. Each entry bumps its family by one version.
 */
export const FAMILY_EXTENSIONS_W8_MODEL: readonly FamilyExtension[] = [
  {
    // "when a saving throw is failed for a friendly X model …, change the Damage of that attack to
    // 0": the model whose save it was, which compile-antecedent.ts binds to the roll's subject.
    family: "damage-reduction",
    description: "As the previous version, plus subject antecedent: the unit or model an earlier leaf introduced (\"… for a friendly X model within 6\", change the Damage of that attack to 0\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [ANTECEDENT]) }),
    normalize: (input, previous) => input.subject === ANTECEDENT ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
];
