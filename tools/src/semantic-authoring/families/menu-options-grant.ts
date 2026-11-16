import type { SemanticFamilyDefinition } from "../contracts.js";
import { ANTECEDENT } from "../antecedent-families.js";

const HOLDERS = ["this-model", "this-unit", ANTECEDENT] as const;

/**
 * "It has both of the following abilities": every option of the menu opened before it applies to
 * the holder, with no choice made. The menu's own grant ("has that ability") still applies the
 * chosen option elsewhere in the record; this leaf is a separate effect (compile-part-plan.ts).
 */
export const MENU_OPTIONS_GRANT_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "menu-options-grant",
    version: 1,
    role: "EFFECT",
    label: "Every option of a menu",
    description: "\"It has both of the following abilities\" / \"has all of those abilities\" after a menu: every option of the last menu opened before it applies to the holder at once, without a choice. holder this-model or this-unit, or antecedent for the unit an earlier leaf introduced (\"such a unit\"). A record with no menu opener before it cannot compile.",
    starter: { holder: "" },
    parameterSchema: {
      type: "object",
      required: ["holder"],
      properties: { holder: { enum: HOLDERS } },
      additionalProperties: false,
    },
  },
];

/** menu-options-grant takes only its holder. */
export function normalizeMenuOptionsGrantParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "menu-options-grant") return null;
  const stray = Object.keys(input).filter((key) => key !== "holder");
  if (stray.length) throw new TypeError(`menu-options-grant has no parameter ${stray[0]}.`);
  if (!(HOLDERS as readonly unknown[]).includes(input.holder)) throw new TypeError(`menu-options-grant.holder must be one of ${HOLDERS.join(", ")}.`);
  return { holder: input.holder };
}
