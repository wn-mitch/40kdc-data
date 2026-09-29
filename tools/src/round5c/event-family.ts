import type { SemanticFamilyDefinition } from "./contracts.js";
import { enumValue, enumOrSource, enumOrSourceSchema, exactKeys } from "./family-validation.js";
import { ROLL_KINDS } from "./dice-families.js";
import { DESIGNATION_IDS } from "../translate/designations.js";

/**
 * The `event` EVENT family (versions 1-7), split out of `core-families.ts` (batch 6) once
 * version 7's twelve new kinds pushed that file past the line ceiling. `turn-start` and the
 * rest of `core-families.ts`'s original families stay there; this file owns only `event`.
 */

const EVENT_KINDS_V3 = [
  "attack-made", "hit-roll", "wound-roll", "charge", "unit-destroyed", "model-destroyed", "phase-start", "phase-end", "after-shooting",
] as const;
/** Attacks are the `attack` family from version 4 on, which says who attacks and with what. */
const EVENT_KINDS_V4 = ["charge", "unit-destroyed", "model-destroyed", "phase-start", "phase-end", "after-shooting"] as const;
/** Version 5 adds the moments stratagems are used at, each a DSL trigger event. */
const EVENT_KINDS_V5 = [
  ...EVENT_KINDS_V4, "selected-to-shoot", "selected-to-fight",
  "enemy-selected-targets", "enemy-ended-move", "enemy-has-shot", "enemy-declared-charge",
] as const;
/**
 * Version 6 tells "this model is destroyed" (the model itself, before it is removed) from
 * "a model in this unit is destroyed" (model-destroyed).
 */
const EVENT_KINDS = [...EVENT_KINDS_V5, "this-model-destroyed"] as const;
/**
 * Version 7 (batch 6) adds twelve moments that no family emitted as a top-level trigger before:
 * they existed only as `happened` condition data, if at all. `turn-ended` takes the same
 * `turn` field as a phase boundary; `step-started`, `used`, `state-changed`,
 * `designation-changed` and `designation-resolved` each need one more filter field of their own.
 */
const EVENT_KINDS_V7 = [
  ...EVENT_KINDS, "battle-started", "deployment-ended", "round-ended", "turn-ended", "step-started",
  "disembarked", "before-roll", "damage-allocated", "used", "state-changed", "designation-changed", "designation-resolved",
] as const;
/** Kinds whose own extra filter field is present only for that kind. */
const STEP_STARTED_KINDS = ["step-started"] as const;
const USED_KINDS = ["used"] as const;
const STATE_CHANGED_KINDS = ["state-changed"] as const;
const DESIGNATION_EVENT_KINDS = ["designation-changed", "designation-resolved"] as const;
const BEFORE_ROLL_KINDS = ["before-roll"] as const;
const TURN_ENDED_KINDS = ["turn-ended"] as const;
const STEPS = ["battle-shock", "reinforcements"] as const;
const USED_ACTIVITIES = ["stratagem", "ability", "action", "manoeuvre", "order", "ritual", "dark-pact", "act-of-faith", "doctrine", "contract"] as const;
const CHANGED_STATES = ["engaged", "battle-shocked", "embarked", "in-strategic-reserves", "on-battlefield", "hidden", "fights-first", "benefit-of-cover"] as const;
/**
 * Version 8 (batch 7a) adds six more moments: after a named roll (mirrors before-roll), Battle
 * Formations declared, a placed marker removed, an objective newly gained, and a resource pool
 * gained or spent.
 */
const EVENT_KINDS_V8 = [
  ...EVENT_KINDS_V7, "after-roll", "battle-formations-declared", "marker-removed", "objective-gained", "resource-gained", "resource-spent",
] as const;
const AFTER_ROLL_KINDS = ["after-roll"] as const;
const MARKER_REMOVED_KINDS = ["marker-removed"] as const;
const RESOURCE_EVENT_KINDS = ["resource-gained", "resource-spent"] as const;
/** Event kinds that need to say which phase, and whose turn, they belong to. */
export const PHASE_EVENT_KINDS = ["phase-start", "phase-end"] as const;
export const PHASES = ["command", "movement", "shooting", "charge", "fight", "any"] as const;
export const TURNS = ["your", "opponent", "either"] as const;

export const EVENT_FAMILY: readonly SemanticFamilyDefinition[] = [
  {
    id: "event",
    version: 1,
    role: "EVENT",
    label: "At an event",
    description: "Marks when the mechanic triggers.",
    starter: { kind: "" },
    parameterSchema: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: enumOrSourceSchema(["attack-made", "hit-roll", "wound-roll", "charge", "unit-destroyed", "model-destroyed", "phase-start", "phase-end"]),
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "event",
    version: 2,
    role: "EVENT",
    label: "At an event",
    description: "Marks when the mechanic triggers. Attack events are part of the effect; the others become the ability's trigger.",
    starter: { kind: "" },
    parameterSchema: {
      type: "object",
      required: ["kind"],
      properties: { kind: { enum: EVENT_KINDS_V3 } },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "event",
    version: 3,
    role: "EVENT",
    label: "At an event",
    description: "Marks when the mechanic triggers. Attack events are part of the effect; the others become the ability's trigger. The start or end of a phase also names the phase and whose turn it is.",
    starter: { kind: "" },
    parameterSchema: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: { enum: EVENT_KINDS_V3 },
        phase: { enum: PHASES, "x-only-when": { kind: PHASE_EVENT_KINDS } },
        turn: { enum: TURNS, "x-only-when": { kind: PHASE_EVENT_KINDS } },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "event",
    version: 4,
    role: "EVENT",
    label: "At an event",
    description: "Marks when the mechanic triggers: a charge, a unit or model destroyed, after shooting, or the start or end of a phase (naming the phase and whose turn). Attacks are the separate attack leaf.",
    starter: { kind: "" },
    parameterSchema: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: { enum: EVENT_KINDS_V4 },
        phase: { enum: PHASES, "x-only-when": { kind: PHASE_EVENT_KINDS } },
        turn: { enum: TURNS, "x-only-when": { kind: PHASE_EVENT_KINDS } },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "event",
    version: 5,
    role: "EVENT",
    label: "At an event",
    description: "Marks when the mechanic triggers: a charge, a unit or model destroyed, after shooting, when this unit is selected to shoot or fight, a stratagem moment (just after an enemy unit selects its targets, ends a move, has shot, or declares a charge), or the start or end of a phase. Attacks are the separate attack leaf.",
    starter: { kind: "" },
    parameterSchema: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: { enum: EVENT_KINDS_V5 },
        phase: { enum: PHASES, "x-only-when": { kind: PHASE_EVENT_KINDS } },
        turn: { enum: TURNS, "x-only-when": { kind: PHASE_EVENT_KINDS } },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "event",
    version: 6,
    role: "EVENT",
    label: "At an event",
    description: "Marks when the mechanic triggers: a charge, a unit destroyed, a model in this unit destroyed, this model destroyed (before it is removed), after shooting, when this unit is selected to shoot or fight, a stratagem moment (just after an enemy unit selects its targets, ends a move, has shot, or declares a charge), or the start or end of a phase. Attacks are the separate attack leaf.",
    starter: { kind: "" },
    parameterSchema: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: { enum: EVENT_KINDS },
        phase: { enum: PHASES, "x-only-when": { kind: PHASE_EVENT_KINDS } },
        turn: { enum: TURNS, "x-only-when": { kind: PHASE_EVENT_KINDS } },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "event",
    version: 7,
    role: "EVENT",
    label: "At an event",
    description: "Adds twelve more moments: the start of the battle, the end of deployment, the end of the battle round or turn, the start of a named step, a disembarkation, before a named roll, damage allocated, an ability/Stratagem/order/ritual/manoeuvre/doctrine/contract used, a core-rules state changing, and a designation applied or resolved.",
    starter: { kind: "" },
    parameterSchema: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: { enum: EVENT_KINDS_V7 },
        phase: { enum: PHASES, "x-only-when": { kind: PHASE_EVENT_KINDS } },
        turn: { enum: TURNS, "x-only-when": { kind: [...PHASE_EVENT_KINDS, ...TURN_ENDED_KINDS] } },
        step: { enum: STEPS, "x-only-when": { kind: STEP_STARTED_KINDS } },
        activity: { enum: USED_ACTIVITIES, "x-only-when": { kind: USED_KINDS } },
        state: { enum: CHANGED_STATES, "x-only-when": { kind: STATE_CHANGED_KINDS } },
        tag: { type: "string", minLength: 1, "x-only-when": { kind: DESIGNATION_EVENT_KINDS } },
        roll: { enum: ROLL_KINDS, "x-only-when": { kind: BEFORE_ROLL_KINDS } },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "event",
    version: 8,
    role: "EVENT",
    label: "At an event",
    description: "Adds six more moments: after a named roll, declaring Battle Formations, one of your markers being removed, newly gaining control of an objective, and a resource pool gained or spent.",
    starter: { kind: "" },
    parameterSchema: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: { enum: EVENT_KINDS_V8 },
        phase: { enum: PHASES, "x-only-when": { kind: PHASE_EVENT_KINDS } },
        turn: { enum: TURNS, "x-only-when": { kind: [...PHASE_EVENT_KINDS, ...TURN_ENDED_KINDS] } },
        step: { enum: STEPS, "x-only-when": { kind: STEP_STARTED_KINDS } },
        activity: { enum: USED_ACTIVITIES, "x-only-when": { kind: USED_KINDS } },
        state: { enum: CHANGED_STATES, "x-only-when": { kind: STATE_CHANGED_KINDS } },
        tag: { type: "string", minLength: 1, "x-only-when": { kind: DESIGNATION_EVENT_KINDS } },
        roll: { enum: ROLL_KINDS, "x-only-when": { kind: [...BEFORE_ROLL_KINDS, ...AFTER_ROLL_KINDS] } },
        marker: { type: "string", minLength: 1, "x-only-when": { kind: MARKER_REMOVED_KINDS } },
        pool: { type: "string", minLength: 1, "x-only-when": { kind: RESOURCE_EVENT_KINDS } },
      },
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise `event` parameters, or null for any other family. */
export function normalizeEventParameters(family: string, input: Record<string, unknown>, version: number): Record<string, unknown> | null {
  if (family !== "event") return null;
  if (version < 3) exactKeys(input, ["kind"], family);
  if (version === 1) return { kind: enumOrSource(input.kind, ["attack-made", "hit-roll", "wound-roll", "charge", "unit-destroyed", "model-destroyed", "phase-start", "phase-end"], "event.kind") };
  if (version === 2) return { kind: enumValue(input.kind, EVENT_KINDS_V3, "event.kind") };
  if (version < 7) {
    const kind = enumValue(input.kind, version === 3 ? EVENT_KINDS_V3 : version === 4 ? EVENT_KINDS_V4 : version === 5 ? EVENT_KINDS_V5 : EVENT_KINDS, "event.kind");
    if (!(PHASE_EVENT_KINDS as readonly string[]).includes(kind)) {
      exactKeys(input, ["kind"], family);
      return { kind };
    }
    exactKeys(input, ["kind", "phase", "turn"], family);
    return { kind, phase: enumValue(input.phase, PHASES, "event.phase"), turn: enumValue(input.turn, TURNS, "event.turn") };
  }
  const kind = enumValue(input.kind, version >= 8 ? EVENT_KINDS_V8 : EVENT_KINDS_V7, "event.kind");
  if ((PHASE_EVENT_KINDS as readonly string[]).includes(kind)) {
    exactKeys(input, ["kind", "phase", "turn"], family);
    return { kind, phase: enumValue(input.phase, PHASES, "event.phase"), turn: enumValue(input.turn, TURNS, "event.turn") };
  }
  if ((TURN_ENDED_KINDS as readonly string[]).includes(kind)) {
    const keys = "turn" in input ? ["kind", "turn"] : ["kind"];
    exactKeys(input, keys, family);
    return "turn" in input ? { kind, turn: enumValue(input.turn, TURNS, "event.turn") } : { kind };
  }
  if ((STEP_STARTED_KINDS as readonly string[]).includes(kind)) {
    exactKeys(input, ["kind", "step"], family);
    return { kind, step: enumValue(input.step, STEPS, "event.step") };
  }
  if ((USED_KINDS as readonly string[]).includes(kind)) {
    exactKeys(input, ["kind", "activity"], family);
    return { kind, activity: enumValue(input.activity, USED_ACTIVITIES, "event.activity") };
  }
  if ((STATE_CHANGED_KINDS as readonly string[]).includes(kind)) {
    exactKeys(input, ["kind", "state"], family);
    return { kind, state: enumValue(input.state, CHANGED_STATES, "event.state") };
  }
  if ((DESIGNATION_EVENT_KINDS as readonly string[]).includes(kind)) {
    exactKeys(input, ["kind", "tag"], family);
    const tag = String(input.tag ?? "");
    if (!DESIGNATION_IDS.has(tag) && !/^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u.test(tag)) throw new TypeError("event.tag must be a registered designation id.");
    return { kind, tag };
  }
  if ((BEFORE_ROLL_KINDS as readonly string[]).includes(kind) || (AFTER_ROLL_KINDS as readonly string[]).includes(kind)) {
    exactKeys(input, ["kind", "roll"], family);
    return { kind, roll: enumValue(input.roll, ROLL_KINDS, "event.roll") };
  }
  if ((MARKER_REMOVED_KINDS as readonly string[]).includes(kind)) {
    exactKeys(input, ["kind", "marker"], family);
    return { kind, marker: nonEmpty(input.marker, "event.marker") };
  }
  if ((RESOURCE_EVENT_KINDS as readonly string[]).includes(kind)) {
    exactKeys(input, ["kind", "pool"], family);
    return { kind, pool: nonEmpty(input.pool, "event.pool") };
  }
  exactKeys(input, ["kind"], family);
  return { kind };
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new TypeError(`${label} must be a nonempty string.`);
}
