import type { SemanticFamilyDefinition } from "./contracts.js";
import { type FamilyExtension, optional, properties, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";

/**
 * Wave-8 families for an ability a record prints as granted ("X units have the following ability:
 * Name: …"): the grant header says the bodies follow it, and each named body opens with a
 * granted-ability-name leaf. The compiler (`compile-granted.ts`) gives each body to the holder.
 */

/** How many abilities a printed header introduces: "the following ability", "abilities", or an unnamed "the following". */
export const PRINTED_GRANTS = ["one", "several", "unnamed"] as const;

/** A stand-in id the previous version checks the rest of a printed header with. */
const PRINTED_STAND_IN = "printed-ability";

const PRINTED_RECORD_GRANT: FamilyExtension = {
  family: "ability-record-grant",
  description: "As the previous version, or printed in place of ability: the granted abilities are printed right after this wording in the same record. one is \"has the following ability:\", several is \"the following abilities:\", unnamed is \"have the following:\". Each named body starts with a granted-ability-name leaf. subject is the holder: the ability is the holder's own, so it works only while a holder is on the battlefield, and a cadence in it counts per holder.",
  schema: (previous) => {
    const { required, ...rest } = previous;
    return withProperties({ ...rest, required: (required as string[]).filter((key) => key !== "ability") }, {
      ability: optional(properties(previous).ability!),
      printed: optional({ enum: [...PRINTED_GRANTS] }),
    });
  },
  normalize: (input, previous) => {
    if (!("printed" in input)) {
      if (!("ability" in input)) throw new TypeError("ability-record-grant names an ability, or printed for abilities printed after it.");
      return previous(input);
    }
    if ("ability" in input) throw new TypeError("ability-record-grant names an ability or printed, not both.");
    if ("value" in input || "rules_bundle" in input) throw new TypeError("ability-record-grant.value and rules_bundle describe a named ability record, not a printed one.");
    const { printed, ...rest } = input;
    const { ability: _ability, ...normalized } = previous({ ...rest, ability: PRINTED_STAND_IN });
    return { ...normalized, printed: enumValue(printed, PRINTED_GRANTS, "ability-record-grant.printed") };
  },
};

export const FAMILY_EXTENSIONS_W8_GRANTED: readonly FamilyExtension[] = [PRINTED_RECORD_GRANT];

export const GRANTED_ABILITY_NAME = "granted-ability-name";

/** The marker that opens one named body of a printed grant. */
export const GRANTED_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: GRANTED_ABILITY_NAME,
    version: 1,
    role: "EVENT",
    label: "Granted ability name",
    description: "Names one ability that a printed grant (ability-record-grant with printed) gives, and starts its body. The span is the printed label; a trailing \"(Aura\" stays in the span but not in label, and a parenthesised usage after the label (\"(Once per battle)\") is its own usage-limit leaf. The granted ability's id is the label's slug.",
    starter: { label: "" },
    parameterSchema: {
      type: "object",
      required: ["label"],
      properties: { label: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  },
];

export function normalizeGrantedParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== GRANTED_ABILITY_NAME) return null;
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "label") throw new TypeError("granted-ability-name parameters must be exactly: label.");
  if (typeof input.label !== "string") throw new TypeError("granted-ability-name.label must be a string.");
  const label = input.label.replaceAll("*", "").replace(/\s+/gu, " ").trim();
  if (!label) throw new TypeError("granted-ability-name.label must name the ability.");
  if (/\(|\)|:$/u.test(label)) throw new TypeError("granted-ability-name.label is the ability's name only: no \"(Aura)\", usage or trailing colon.");
  return { label };
}
