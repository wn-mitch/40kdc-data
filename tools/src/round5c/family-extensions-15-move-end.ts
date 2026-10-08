import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

/**
 * Permission binding: a permission to end within Engagement Range of the enemy unit that the same
 * ability's move ends nearest. The leaf says so with engaged_with_move_end, which needs despite
 * engaged. The compiler binds it to that move's allow_engagement (compile-move-end-nearest.ts).
 */
export const FAMILY_EXTENSIONS_15_MOVE_END: readonly FamilyExtension[] = [
  {
    family: "eligibility-permission",
    description: "As the previous version, plus engaged_with_move_end: the permission applies within Engagement Range of the enemy unit the same ability's move ends nearest, not any engaged unit (despite includes engaged).",
    schema: (previous) => withProperties(previous, {
      engaged_with_move_end: optional({ const: true, "x-only-when": { despite: ["engaged"] } }),
    }),
    normalize: (input, previous) => {
      if (input.engaged_with_move_end === undefined) return previous(input);
      const { engaged_with_move_end: flag, ...rest } = input;
      if (flag !== true) throw new TypeError("eligibility-permission.engaged_with_move_end must be true.");
      const normalized = previous(rest);
      const despite = (normalized.despite as string[] | undefined) ?? [];
      if (!despite.includes("engaged")) throw new TypeError("eligibility-permission.engaged_with_move_end needs despite to include engaged.");
      return { ...normalized, engaged_with_move_end: true };
    },
  },
];
