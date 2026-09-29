import type { SemanticFamilyDefinition } from "./contracts.js";
import {
  boundedInteger, enumOrSource, enumOrSourceSchema, enumValue, exactKeys, integerOrSource, integerOrSourceSchema, sourceQualified,
  sourceQualifiedSchema,
} from "./family-validation.js";
import { ROLL_KINDS, WEAPON_TYPES } from "./dice-families.js";
import { EVENT_FAMILY, normalizeEventParameters } from "./event-family.js";

export { PHASE_EVENT_KINDS, PHASES, TURNS } from "./event-family.js";

/** A kebab-case entity id, shared with buff-families.ts's ENTITY_ID. */
export const ENTITY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

/**
 * The original reviewed families: rolls, resources, durations, turn starts, army faction, and
 * attachment. `event` (batch 6, versions 1-7) lives in `event-family.ts`, split out once version
 * 7 pushed this file past the line ceiling. Later families live beside their domain (buff-,
 * targeting-, restriction- and dice-families) and are joined into the registry by contracts.ts.
 */

const DURATION_ENDPOINTS = [
  "end-of-phase", "end-of-turn", "end-of-battle-round", "end-of-battle",
  "start-of-next-turn", "start-of-next-command-phase", "start-of-next-movement-phase", "start-of-next-battle-round",
] as const;

export const CORE_FAMILIES: readonly SemanticFamilyDefinition[] = [
  ...EVENT_FAMILY,
  {
    id: "reroll",
    version: 1,
    label: "Re-roll a roll",
    description: "Repeats Hit, Wound, or another named roll; specify which results may be re-rolled.",
    starter: { roll: "", subset: "" },
    role: "EFFECT",
    parameterSchema: {
      type: "object",
      required: ["roll", "subset"],
      properties: {
        roll: enumOrSourceSchema(["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage"]),
        subset: enumOrSourceSchema(["ones", "failed", "all"]),
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "reroll",
    version: 2,
    label: "Re-roll a roll",
    description: "Repeats Hit, Wound, or another named roll; specify which results may be re-rolled, how many rolls (\"re-roll one Hit roll\"), and whether only melee or ranged weapons' rolls count.",
    starter: { roll: "", subset: "", weapon_type: "all" },
    role: "EFFECT",
    parameterSchema: {
      type: "object",
      required: ["roll", "subset", "weapon_type"],
      properties: {
        roll: { enum: ROLL_KINDS },
        subset: { enum: ["ones", "failed", "all"] },
        count: { type: "integer", minimum: 1, maximum: 3 },
        weapon_type: { enum: WEAPON_TYPES },
      },
      additionalProperties: false,
    },
  },
  {
    id: "roll-modifier",
    version: 1,
    role: "EFFECT",
    label: "Change a roll",
    description: "Adds to or subtracts from a named roll.",
    starter: { roll: "", operation: "", value: null },
    parameterSchema: {
      type: "object",
      required: ["roll", "operation", "value"],
      properties: {
        roll: enumOrSourceSchema(["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage"]),
        operation: { enum: ["add", "subtract"] },
        value: integerOrSourceSchema,
      },
      additionalProperties: false,
    },
  },
  {
    id: "critical-hit-threshold",
    version: 1,
    role: "EFFECT",
    label: "Change critical-hit threshold",
    description: "Changes the unmodified result needed for a Critical Hit, not the Hit roll needed to score a hit.",
    starter: { value: null },
    parameterSchema: {
      type: "object",
      required: ["value"],
      properties: {
        roll: enumOrSourceSchema(["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage"]),
        value: { anyOf: [{ type: "integer" }, sourceQualifiedSchema, { const: "source" }] },
      },
      additionalProperties: false,
    },
  },
  {
    id: "resource-action",
    version: 1,
    role: "EFFECT",
    label: "Change a resource",
    description: "Gains, loses, spends, or sets a named resource.",
    starter: { resource: "", operation: "", amount: null },
    parameterSchema: {
      type: "object",
      required: ["resource", "operation", "amount"],
      properties: {
        resource: enumOrSourceSchema(["command-point", "bloodshed-point", "miracle-dice", "fate-dice", "cabal-point"]),
        operation: { enum: ["gain", "lose", "spend", "set"] },
        amount: integerOrSourceSchema,
      },
      additionalProperties: false,
    },
  },
  {
    id: "duration",
    version: 1,
    role: "DURATION",
    label: "Set a duration",
    description: "Marks when an effect ends.",
    starter: { endpoint: "" },
    parameterSchema: {
      type: "object",
      required: ["endpoint"],
      properties: {
        endpoint: enumOrSourceSchema(["end-of-phase", "end-of-turn", "end-of-battle-round", "end-of-battle"]),
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "duration",
    version: 2,
    role: "DURATION",
    label: "Set a duration",
    description: "Marks when an effect ends: the end of this phase, turn, battle round or battle, or the start of your next turn, Command phase, Movement phase or battle round.",
    starter: { endpoint: "" },
    parameterSchema: {
      type: "object",
      required: ["endpoint"],
      properties: { endpoint: { enum: DURATION_ENDPOINTS } },
      additionalProperties: false,
    },
  },
  {
    id: "turn-start",
    version: 1,
    role: "EVENT",
    label: "At the start of a turn or round",
    description: "Marks the start of a battle round, your turn, or your opponent's turn.",
    starter: { turn: "" },
    parameterSchema: {
      type: "object",
      required: ["turn"],
      properties: { turn: { enum: ["battle-round", "player-turn", "opponent-turn"] } },
      additionalProperties: false,
    },
  },
  {
    id: "army-faction",
    version: 1,
    role: "CONDITION",
    label: "Army faction is",
    description: "Requires the army to have a specified faction; copy its exact name from the source.",
    starter: { faction: { source: "" } },
    parameterSchema: {
      type: "object",
      required: ["faction"],
      properties: { faction: sourceQualifiedSchema },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "army-faction",
    version: 2,
    role: "CONDITION",
    label: "Army faction is",
    description: "Requires the army to have a specified faction. Quote the exact name from the source until a reviewer resolves it to the faction's kebab-case id (the DSL condition names the id, not free text).",
    starter: { faction: { source: "" } },
    parameterSchema: {
      type: "object",
      required: ["faction"],
      properties: { faction: { oneOf: [sourceQualifiedSchema, { type: "string", pattern: ENTITY_ID_PATTERN.source }] } },
      additionalProperties: false,
    },
  },
  {
    id: "leading-unit",
    version: 1,
    role: "CONDITION",
    label: "While leading a unit",
    description: "Requires the specified model or unit to be leading another unit.",
    starter: { subject: "" },
    parameterSchema: {
      type: "object",
      required: ["subject"],
      properties: { subject: enumOrSourceSchema(["this-model", "this-unit", "bearers-unit"]) },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "leading-unit",
    version: 2,
    role: "CONDITION",
    label: "While leading or supporting a unit",
    description: "Requires the specified model or unit to be attached to another unit, as its leader or in support.",
    starter: { subject: "this-model", attachment: "leading" },
    parameterSchema: {
      type: "object",
      required: ["subject", "attachment"],
      properties: {
        subject: enumOrSourceSchema(["this-model", "this-unit", "bearers-unit"]),
        attachment: { enum: ["leading", "supporting"] },
      },
      additionalProperties: false,
    },
  },
  {
    id: "below-starting-strength",
    version: 1,
    role: "CONDITION",
    parameterSchema: {
      type: "object",
      required: ["subject"],
      properties: { subject: enumOrSourceSchema(["this-unit", "target-unit"]) },
      additionalProperties: false,
    },
    label: "Below starting strength",
    description: "Requires a named unit to be below starting strength.",
    starter: { subject: "" },
    deprecated: true,
  },
];

/** Validate and canonicalise parameters for a core family, or null when the family is not core. */
export function normalizeCoreParameters(
  family: string,
  input: Record<string, unknown>,
  version: number,
): Record<string, unknown> | null {
  switch (family) {
    case "reroll":
      if (version === 1) {
        exactKeys(input, ["roll", "subset"], family);
        return {
          roll: enumOrSource(input.roll, ["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage"], "reroll.roll"),
          subset: enumOrSource(input.subset, ["ones", "failed", "all"], "reroll.subset"),
        };
      }
      {
        const allowed = new Set(["roll", "subset", "weapon_type", "count"]);
        for (const key of Object.keys(input)) {
          if (!allowed.has(key)) throw new TypeError("reroll parameters must be roll, subset, weapon_type, and optional count only.");
        }
        const result: Record<string, unknown> = {
          roll: enumValue(input.roll, ROLL_KINDS, "reroll.roll"),
          subset: enumValue(input.subset, ["ones", "failed", "all"], "reroll.subset"),
          weapon_type: enumValue(input.weapon_type, WEAPON_TYPES, "reroll.weapon_type"),
        };
        if (input.count !== undefined) result.count = boundedInteger(input.count, 1, 3, "reroll.count");
        return result;
      }
    case "roll-modifier":
      exactKeys(input, ["roll", "operation", "value"], family);
      return {
        roll: enumOrSource(input.roll, ["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage"], "roll-modifier.roll"),
        operation: enumValue(input.operation, ["add", "subtract"], "roll-modifier.operation"),
        value: integerOrSource(input.value, "roll-modifier.value"),
      };
    case "critical-hit-threshold": {
      const keys = Object.keys(input);
      if (!keys.every((key) => key === "roll" || key === "value") || !Object.hasOwn(input, "value")) {
        throw new TypeError("critical-hit-threshold parameters must contain value and optional roll only.");
      }
      const value = input.value === "source"
        ? "source"
        : integerOrSource(input.value, "critical-hit-threshold.value");
      return input.roll === undefined
        ? { value }
        : {
            roll: enumOrSource(input.roll, ["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage"], "critical-hit-threshold.roll"),
            value,
          };
    }
    case "resource-action":
      exactKeys(input, ["resource", "operation", "amount"], family);
      return {
        resource: enumOrSource(input.resource, ["command-point", "bloodshed-point", "miracle-dice", "fate-dice", "cabal-point"], "resource-action.resource"),
        operation: enumValue(input.operation, ["gain", "lose", "spend", "set"], "resource-action.operation"),
        amount: integerOrSource(input.amount, "resource-action.amount"),
      };
    case "duration":
      exactKeys(input, ["endpoint"], family);
      if (version >= 2) return { endpoint: enumValue(input.endpoint, DURATION_ENDPOINTS, "duration.endpoint") };
      return {
        endpoint: enumOrSource(input.endpoint, ["end-of-phase", "end-of-turn", "end-of-battle-round", "end-of-battle"], "duration.endpoint"),
      };
    case "event":
      return normalizeEventParameters(family, input, version);
    case "turn-start":
      exactKeys(input, ["turn"], family);
      return { turn: enumValue(input.turn, ["battle-round", "player-turn", "opponent-turn"], "turn-start.turn") };
    case "army-faction": {
      exactKeys(input, ["faction"], family);
      if (version < 2) {
        const faction = sourceQualified(input.faction, "army-faction.faction");
        if (!faction) throw new TypeError("army-faction.faction must be source-qualified.");
        return { faction };
      }
      const quoted = sourceQualified(input.faction, "army-faction.faction");
      if (quoted) return { faction: quoted };
      if (typeof input.faction === "string" && ENTITY_ID_PATTERN.test(input.faction)) return { faction: input.faction };
      throw new TypeError("army-faction.faction must be source-qualified or a kebab-case faction id.");
    }
    case "leading-unit":
      if (version === 1) {
        exactKeys(input, ["subject"], family);
        return { subject: enumOrSource(input.subject, ["this-model", "this-unit", "bearers-unit"], "leading-unit.subject") };
      }
      exactKeys(input, ["subject", "attachment"], family);
      return {
        subject: enumOrSource(input.subject, ["this-model", "this-unit", "bearers-unit"], "leading-unit.subject"),
        attachment: enumValue(input.attachment, ["leading", "supporting"], "leading-unit.attachment"),
      };
    case "below-starting-strength":
      exactKeys(input, ["subject"], family);
      return { subject: enumOrSource(input.subject, ["this-unit", "target-unit"], "below-starting-strength.subject") };
    default:
      return null;
  }
}
