import type { SemanticFamilyDefinition } from "./contracts.js";
import { NAMED_ID, namedId } from "./families/shared.js";
import { enumSet, enumValue, exactKeys } from "./family-validation.js";

const DOMAINS = ["deed", "quality"] as const;
const SUBJECTS = ["this-model", "this-unit"] as const;
const DURATIONS = ["phase", "turn", "battle-round", "battle", "permanent"] as const;
const ability = { type: "string", pattern: NAMED_ID.source };
const subject = { enum: SUBJECTS };
const domains = { type: "array", items: { enum: DOMAINS }, minItems: 1, uniqueItems: true };

function family(id: string, role: SemanticFamilyDefinition["role"], description: string,
  properties: Record<string, unknown>, required = Object.keys(properties)): SemanticFamilyDefinition {
  return {
    id, version: 1, role, label: id.replaceAll("-", " "), description,
    starter: {}, parameterSchema: { type: "object", properties, required, additionalProperties: false },
  };
}

/** Each family records one clause, never the surrounding Oath rule or its choices. */
export const OATH_FAMILIES: readonly SemanticFamilyDefinition[] = [
  family("oath-determine", "EFFECT", "Repeat the referenced rule's Oath determination procedure, without selecting an invented stance option.", { ability, subject }),
  family("oath-fulfilled", "CONDITION", "The current Oath of the referenced rule is fulfilled.", { ability }),
  family("oath-selection-history", "RESTRICTION", "Previously selected entries in the named Oath domains are ineligible for selection.", { ability, subject, domains }),
  family("oath-duplicate-result", "RESTRICTION", "A random result already selected in the named domains is replaced by choosing an unselected entry, not by rerolling.", { ability, subject, domains }),
  family("oath-exhaustion", "RESTRICTION", "Do not determine another Oath when all entries in every named domain have been selected.", { ability, subject, domains }),
  family("oath-quality-persistence", "EFFECT", "Fulfilled Oath Qualities continue on army models with the named recipient ability. An omitted duration retains the parent rule's lifetime.", {
    ability, recipient_ability: ability, owner: { enum: ["friendly", "enemy", "any"] }, duration: { enum: DURATIONS },
  }, ["ability", "recipient_ability", "owner"]),
  family("oath-deed-reward", "EVENT", "The following reward belongs to completion of an additional Oath's Deed, not to its initial determination or the initial Oath.", {
    ability, subject, applies_to: { const: "additional" },
  }),
  family("oath-reward-selection", "RESTRICTION", "Which selection methods the additional Deed reward covers; any includes both chosen and random outcomes.", {
    method: { enum: ["any", "chosen", "random"] },
  }),
];

export function normalizeOathParameters(familyId: string, input: Record<string, unknown>): Record<string, unknown> | null {
  const definition = OATH_FAMILIES.find((entry) => entry.id === familyId);
  if (!definition) return null;
  const schema = definition.parameterSchema as { required: string[] };
  exactKeys(input, [...schema.required, ...(familyId === "oath-quality-persistence" && "duration" in input ? ["duration"] : [])], familyId);
  if (familyId === "oath-reward-selection") return { method: enumValue(input.method, ["any", "chosen", "random"], `${familyId}.method`) };
  const result: Record<string, unknown> = { ability: namedId(input.ability, `${familyId}.ability`) };
  if ("subject" in input) result.subject = enumValue(input.subject, SUBJECTS, `${familyId}.subject`);
  if ("domains" in input) result.domains = enumSet(input.domains, DOMAINS, `${familyId}.domains`);
  if (familyId === "oath-quality-persistence") {
    result.recipient_ability = namedId(input.recipient_ability, `${familyId}.recipient_ability`);
    result.owner = enumValue(input.owner, ["friendly", "enemy", "any"], `${familyId}.owner`);
    if ("duration" in input) result.duration = enumValue(input.duration, DURATIONS, `${familyId}.duration`);
  }
  if (familyId === "oath-deed-reward") result.applies_to = enumValue(input.applies_to, ["additional"], `${familyId}.applies_to`);
  return result;
}
