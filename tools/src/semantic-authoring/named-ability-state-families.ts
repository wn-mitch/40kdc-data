import type { SemanticFamilyDefinition } from "./contracts.js";
import { ENTITY_ID, entityId } from "./buff-families.js";

/** Named definitions are not stance options: their bodies are independently reviewed leaves. */
export const NAMED_ABILITY_DEFINITION = "named-ability-definition";
export const NAMED_ABILITY_DEFINITION_END = "named-ability-definition-end";
export const RESOURCE_BEFORE_ABILITIES = "resource-before-ability-determination";
const SUBJECTS = ["this-unit", "this-model", "antecedent", "selected-unit", "recipient", "filtered-units"] as const;
const id = { type: "string", pattern: ENTITY_ID.source };
const reference = { ability_id: id, definition_id: id };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });

export const NAMED_ABILITY_STATE_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: NAMED_ABILITY_DEFINITION, version: 1, role: "EVENT", label: "Named ability definition",
    description: "A printed heading opens a named ability body. Its stable definition_id belongs to this record; subsequent independently reviewed leaves define its mechanics, up to the next definition heading or definition-end marker. This declares a definition, never grants it.",
    starter: { definition_id: "", label: "" },
    parameterSchema: object({ definition_id: id, label: { type: "string", minLength: 1 } }),
  },
  {
    id: NAMED_ABILITY_DEFINITION_END, version: 1, role: "EVENT", label: "End named ability definitions",
    description: "A section boundary ends the last named ability body and returns subsequent leaves to the containing rule.",
    starter: {}, parameterSchema: object({}),
  },
  ...(["grant", "suppression", "exchange"] as const).map((operation): SemanticFamilyDefinition => ({
    id: `named-ability-${operation}`, version: 1, role: "EFFECT", label: `Named ability ${operation}`,
    ...(operation === "suppression" ? { deprecated: true as const } : {}),
    description: operation === "grant" ? "Grant one named inline definition to the separately specified recipient. Timing, conditions and duration are separate leaves."
      : operation === "suppression" ? "Suppress one named ability except when granted by this rule. The exception is source provenance, not an activation choice."
        : "Atomically exchange the currently held one of two named abilities for the other. Exactly one must be held; no player chooses a stance. Payment and timing are separate leaves.",
    starter: { subject: "this-unit", ability_id: "", definition_id: "", ...(operation === "exchange" ? { exchange_with: "" } : {}), ...(operation === "suppression" ? { except_from: "this-ability" } : {}) },
    parameterSchema: object({ subject: { enum: SUBJECTS }, ...reference,
      ...(operation === "exchange" ? { exchange_with: id } : {}),
      ...(operation === "suppression" ? { except_from: { const: "this-ability" } } : {}),
    }),
  })),
  {
    id: "named-ability-suppression", version: 2, role: "EFFECT", label: "Named ability suppression",
    description: "As version 1, with additional_definitions for other explicitly named abilities suppressed by the same operator and provenance exception. Recipient, timing and other operations remain separate leaves.",
    starter: { subject: "this-unit", ability_id: "", definition_id: "", except_from: "this-ability" },
    parameterSchema: object({
      subject: { enum: SUBJECTS }, ...reference, except_from: { const: "this-ability" },
      additional_definitions: { type: "array", items: id, minItems: 1, uniqueItems: true, "x-optional": true },
    }, ["subject", "ability_id", "definition_id", "except_from"]),
  },
  {
    id: RESOURCE_BEFORE_ABILITIES, version: 1, role: "COMBINATOR", label: "Resource income before ability determination",
    description: "At a shared phase-end event, resolve this pool's income before checking which named abilities are granted. The income, grants, resource thresholds, phase and player are separate reviewed leaves. This only specifies resolution order.",
    starter: { pool: "" }, parameterSchema: object({ pool: id }),
  },
];

export function normalizeNamedAbilityStateParameters(family: string, input: Record<string, unknown>, version = family === "named-ability-suppression" ? 2 : 1): Record<string, unknown> | null {
  const definition = NAMED_ABILITY_STATE_FAMILIES.find((item) => item.id === family && item.version === version);
  if (!definition) return null;
  const keys = [...definition.parameterSchema.required as string[]];
  if (family === "named-ability-suppression" && version >= 2 && Object.hasOwn(input, "additional_definitions")) keys.push("additional_definitions");
  if (Object.keys(input).length !== keys.length || !keys.every((key) => Object.hasOwn(input, key))) {
    throw new TypeError(`${family} parameters must be exactly: ${keys.join(", ") || "none"}.`);
  }
  if (family === NAMED_ABILITY_DEFINITION_END) return {};
  if (family === RESOURCE_BEFORE_ABILITIES) return { pool: entityId(input.pool, `${family}.pool`) };
  if (family === NAMED_ABILITY_DEFINITION) {
    if (typeof input.label !== "string" || !input.label.trim()) throw new TypeError(`${family}.label must name the definition.`);
    return { definition_id: entityId(input.definition_id, `${family}.definition_id`), label: input.label.trim() };
  }
  if (!SUBJECTS.includes(input.subject as typeof SUBJECTS[number])) throw new TypeError(`${family}.subject must be a supported recipient.`);
  const result: Record<string, unknown> = { subject: input.subject, ability_id: entityId(input.ability_id, `${family}.ability_id`), definition_id: entityId(input.definition_id, `${family}.definition_id`) };
  if (family === "named-ability-exchange") {
    result.exchange_with = entityId(input.exchange_with, `${family}.exchange_with`);
    if (result.exchange_with === result.definition_id) throw new TypeError("A named ability exchange requires two distinct definitions.");
  }
  if (family === "named-ability-suppression") {
    if (input.except_from !== "this-ability") throw new TypeError(`${family}.except_from must be this-ability.`);
    result.except_from = input.except_from;
    if (input.additional_definitions !== undefined) {
      if (!Array.isArray(input.additional_definitions) || !input.additional_definitions.length) throw new TypeError(`${family}.additional_definitions must list named abilities.`);
      const additional = input.additional_definitions.map((value) => entityId(value, `${family}.additional_definitions`));
      if (new Set([result.definition_id, ...additional]).size !== additional.length + 1) throw new TypeError(`${family} cannot suppress the same definition twice.`);
      result.additional_definitions = additional;
    }
  }
  return result;
}
