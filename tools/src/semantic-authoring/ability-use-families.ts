import type { SemanticFamilyDefinition } from "./contracts.js";
import { booleanValue, enumValue, exactKeys } from "./family-validation.js";

const owner = { enum: ["friendly", "enemy", "any"] };
const level = { enum: ["model", "unit"] };
const binding = { type: "string", pattern: "^[a-z][a-z0-9-]*$" };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });

/** Separate leaves bind a use, compare its history, and replace its selection; no leaf contains a rule recipe. */
export const ABILITY_USE_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "ability-use-context", version: 1, role: "EVENT", label: "Bind an ability use",
    description: "Historical spelling of an ability-use event. Current authoring uses event plus a unit-filter; retained so trusted version-1 fingerprints keep their original meaning.",
    starter: { owner: "friendly", level: "model", keyword: "", bind_as: "ability-use" },
    parameterSchema: object({ owner, level, keyword: { type: "string", minLength: 1 }, bind_as: binding }),
    deprecated: true,
  },
  {
    id: "ability-use-history", version: 1, role: "CONDITION", label: "Compare an ability use with history",
    description: "Tests prior uses in a window against the bound use's exact ability and actor. Other excludes the bound actor; same selects only it. Any ability does not constrain rule identity.",
    starter: { event_var: "ability-use", owner: "friendly", level: "model", actor: "other", ability: "same", window: "turn", negated: true },
    parameterSchema: object({ event_var: binding, owner, level, actor: { enum: ["same", "other", "any"] }, ability: { enum: ["same", "any"] }, window: { enum: ["phase", "turn", "battle-round", "battle", "previous-turn"] }, negated: { type: "boolean" } }),
  },
  {
    id: "ability-selection-override", version: 1, role: "EFFECT", label: "Replace the triggering ability's selection",
    description: "The preceding selection supplies recipients of the exact bound ability use, replacing that use's selection rather than activating it again. Separate leaves supply count, recipient filter, distance, exclusions and recipient duration.",
    starter: { event_var: "ability-use" }, parameterSchema: object({ event_var: binding }),
  },
  {
    id: "army-state", version: 1, role: "CONDITION", label: "An army has a rules state",
    description: "Tests the named army's state, not a keyword of a unit in that army.",
    starter: { owner: "friendly", state: "honoured" },
    parameterSchema: object({ owner: { enum: ["friendly", "enemy"] }, state: { enum: ["honoured"] } }),
  },
];

function name(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]*$/u.test(value)) throw new TypeError(`${label} must be a binding name.`);
  return value;
}

export function normalizeAbilityUseParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family === "ability-use-context") {
    exactKeys(input, ["owner", "level", "keyword", "bind_as"], family);
    if (typeof input.keyword !== "string" || !input.keyword.trim()) throw new TypeError("ability-use-context.keyword must be nonempty.");
    return { owner: enumValue(input.owner, ["friendly", "enemy", "any"], `${family}.owner`), level: enumValue(input.level, ["model", "unit"], `${family}.level`), keyword: input.keyword, bind_as: name(input.bind_as, `${family}.bind_as`) };
  }
  if (family === "ability-use-history") {
    exactKeys(input, ["event_var", "owner", "level", "actor", "ability", "window", "negated"], family);
    return {
      event_var: name(input.event_var, `${family}.event_var`),
      owner: enumValue(input.owner, ["friendly", "enemy", "any"], `${family}.owner`), level: enumValue(input.level, ["model", "unit"], `${family}.level`),
      actor: enumValue(input.actor, ["same", "other", "any"], `${family}.actor`), ability: enumValue(input.ability, ["same", "any"], `${family}.ability`),
      window: enumValue(input.window, ["phase", "turn", "battle-round", "battle", "previous-turn"], `${family}.window`), negated: booleanValue(input.negated, `${family}.negated`),
    };
  }
  if (family === "ability-selection-override") {
    exactKeys(input, ["event_var"], family);
    return { event_var: name(input.event_var, `${family}.event_var`) };
  }
  if (family === "army-state") {
    exactKeys(input, ["owner", "state"], family);
    return { owner: enumValue(input.owner, ["friendly", "enemy"], `${family}.owner`), state: enumValue(input.state, ["honoured"], `${family}.state`) };
  }
  return null;
}
