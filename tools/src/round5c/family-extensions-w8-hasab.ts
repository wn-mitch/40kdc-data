import { type FamilyExtension, optional, properties, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-8 extensions for units filtered by an ability ("units with this ability"). Each entry
 * bumps its family by one version, checking only its own additions.
 */

/** A stand-in ability id the previous version checks the rest of a leaf with, while `own` names the ability. */
const OWN_STAND_IN = "this-ability";

const UNIT_HAS_OWN_ABILITY: FamilyExtension = {
  // "one or more units with this ability": the record's own ability, whatever its id.
  family: "unit-has-ability",
  description: "As the previous version, or own: true in place of ability: \"this ability\", the ability of the record the leaf is on, bound to its id when the record compiles (a duplicate record names the record datasheets carry). A leaf names ability or own, never both.",
  schema: (previous) => {
    const { required, ...rest } = previous;
    return withProperties({ ...rest, required: (required as string[]).filter((key) => key !== "ability") }, {
      ability: optional(properties(previous).ability!),
      own: optional({ const: true }),
    });
  },
  normalize: (input, previous) => {
    if (!("own" in input)) {
      if (!("ability" in input)) throw new TypeError("unit-has-ability names an ability, or own: true for this ability.");
      return previous(input);
    }
    if ("ability" in input) throw new TypeError("unit-has-ability names an ability or own: true, not both.");
    if (input.own !== true) throw new TypeError("unit-has-ability.own is true or absent.");
    const { own: _own, ...rest } = input;
    const { ability: _ability, ...normalized } = previous({ ...rest, ability: OWN_STAND_IN });
    return { ...normalized, own: true };
  },
};

export const FAMILY_EXTENSIONS_W8_HASAB: readonly FamilyExtension[] = [UNIT_HAS_OWN_ABILITY];
