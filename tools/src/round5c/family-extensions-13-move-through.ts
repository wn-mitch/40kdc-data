import { type FamilyExtension, KEYWORD_ITEMS, keywordList, properties, type Schema, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";

/**
 * Wave-9 move-through passthrough: a typed models item in place of a free token. The item names
 * whose models a move may pass (friendly, enemy or any owner), which keywords they must have, and
 * which keywords exclude a model from the set. Version 1's string tokens keep their meaning.
 */

const OWNERS = ["friendly", "enemy", "any"] as const;
const TYPED_KEYS = ["kind", "owner", "all_of", "excluding"] as const;

/** The typed models item: `kind` is always models, and the keyword lists are unit keywords. */
const TYPED_MODELS_SCHEMA: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: {
    kind: { const: "models" },
    owner: { enum: [...OWNERS] },
    all_of: { type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true },
    excluding: { type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true },
  },
};

function isTypedItem(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !("source" in value);
}

/**
 * Checks a typed models item and returns it with its keyword lists in canonical form. A typed item
 * of any other kind is refused here, since the typed item does not cover terrain.
 */
function normalizeTypedModels(item: Record<string, unknown>): Record<string, unknown> {
  if (item.kind !== "models") throw new TypeError("move-through.passthrough typed item must have kind models.");
  for (const key of Object.keys(item)) {
    if (!(TYPED_KEYS as readonly string[]).includes(key)) throw new TypeError(`move-through.passthrough item has an unknown key: ${key}.`);
  }
  const result: Record<string, unknown> = { kind: "models" };
  if (item.owner !== undefined) result.owner = enumValue(item.owner, OWNERS, "move-through.passthrough.owner");
  if (item.all_of !== undefined) result.all_of = keywordList(item.all_of, "move-through.passthrough.all_of", 1);
  if (item.excluding !== undefined) result.excluding = keywordList(item.excluding, "move-through.passthrough.excluding", 1);
  return result;
}

export const FAMILY_EXTENSIONS_13_MOVE_THROUGH: readonly FamilyExtension[] = [
  {
    family: "move-through",
    description: "As the previous version, and passthrough can be a typed models item: models of an owner (friendly, enemy or any) with every all_of keyword, excluding models with any excluding keyword.",
    schema: (previous) => withProperties(previous, {
      passthrough: { anyOf: [properties(previous).passthrough!, TYPED_MODELS_SCHEMA] },
    }),
    normalize: (input, previous) => {
      if (!isTypedItem(input.passthrough)) return previous(input);
      const typed = normalizeTypedModels(input.passthrough);
      // The previous version checks every other key with a token it accepts standing in for the item.
      return { ...previous({ ...input, passthrough: "models" }), passthrough: typed };
    },
  },
];
