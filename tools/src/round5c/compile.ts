import type { Mechanics } from "./entries.js";

/**
 * Deterministic composition: reviewed leaves in source order become one Ability DSL entry.
 * Each family maps to one fixed DSL fragment, and four rules combine them:
 * conditions wrap the effect in `conditional` (several are joined with `and`); several effects
 * form a `sequence` in source order; attack-time events are implicit in the effect while other
 * events become the trigger; a duration sets `scope.duration`. No model is involved, so one
 * approved shape produces the same kind of entry for every source that has it.
 */

export type CompileLeaf = {
  role: string;
  family_id: string;
  family_version: number;
  parameters: Record<string, unknown>;
  start_byte: number;
};

export type Compiled =
  | { ok: true; signature: string; mechanics: Mechanics }
  | { ok: false; signature: string; errors: string[] };

/** Event kinds an attack-time effect already implies; they add nothing to the entry. */
const ATTACK_EVENTS = new Set(["attack-made", "hit-roll", "wound-roll"]);

const TRIGGERS: Record<string, Record<string, unknown>> = {
  "event:charge": { event: "charge-move", subject: "self" },
  "event:unit-destroyed": { event: "on-unit-destroyed" },
  "event:model-destroyed": { event: "on-model-destroyed" },
  "event:phase-start": { event: "start-of-phase" },
  "event:phase-end": { event: "end-of-phase" },
  "event:after-shooting": { event: "after-unit-resolves-attacks", subject: "self", condition: { type: "phase-is", parameters: { phase: "shooting" } } },
  "turn-start:battle-round": { event: "start-of-battle-round" },
  "turn-start:player-turn": { event: "start-of-player-turn" },
  "turn-start:opponent-turn": { event: "start-of-opponent-turn" },
};

const DURATIONS: Record<string, string> = {
  "end-of-phase": "phase", "end-of-turn": "turn", "end-of-battle-round": "battle-round", "end-of-battle": "battle",
};

const RESOURCE_POOLS: Record<string, string> = {
  "miracle-dice": "miracle-dice-pool", "fate-dice": "fate-dice-pool", "bloodshed-point": "bloodshed-point",
};

const SUBJECT_TARGETS: Record<string, string> = { "this-unit": "unit", "this-model": "self", bearer: "bearer" };

class CompileError extends Error {}

const isSource = (value: unknown): boolean => value !== null && typeof value === "object" && "source" in value;

function closed(leaf: CompileLeaf, name: string): unknown {
  const value = leaf.parameters[name];
  if (isSource(value)) throw new CompileError(`${leaf.family_id} ${name} is quoted source text; give it a listed value before it can compile.`);
  return value;
}

function kindKey(leaf: CompileLeaf): string {
  return `${leaf.family_id}:${String(leaf.family_id === "turn-start" ? leaf.parameters.turn : leaf.parameters.kind)}`;
}

/**
 * The shape of an ability: its leaves' roles and families in source order, parameters left out.
 * Attack-time events are named only as `attack`; other events keep their kind, because a
 * trigger changes the entry's structure.
 */
export function shapeSignature(leaves: readonly CompileLeaf[]): string {
  return [...leaves].sort((left, right) => left.start_byte - right.start_byte).map((leaf) => {
    if (leaf.role !== "EVENT") return `${leaf.role}(${leaf.family_id})`;
    return ATTACK_EVENTS.has(String(leaf.parameters.kind)) ? "EVENT(attack)" : `EVENT(${kindKey(leaf)})`;
  }).join(" · ");
}

function condition(leaf: CompileLeaf): Record<string, unknown> {
  switch (leaf.family_id) {
    case "leading-unit":
      closed(leaf, "subject");
      return { type: "is-attached" };
    case "below-starting-strength":
      return closed(leaf, "subject") === "target-unit"
        ? { type: "unit-below-starting-strength", parameters: { subject: "target" } }
        : { type: "unit-below-starting-strength" };
    default:
      throw new CompileError(`Condition ${leaf.family_id} has no DSL fragment yet.`);
  }
}

function effect(leaf: CompileLeaf, attached: boolean): Record<string, unknown> {
  const target = (subject: unknown) => attached ? "unit" : SUBJECT_TARGETS[String(subject)] ?? "unit";
  switch (leaf.family_id) {
    case "reroll": {
      const roll = closed(leaf, "roll");
      const subset = closed(leaf, "subset");
      const modifier = subset === "ones" ? { roll, subset: "ones" } : subset === "failed" ? { roll, subset: "all-failures" } : { roll, result_scope: "any-result" };
      return { type: "re-roll", target: "unit", modifier };
    }
    case "roll-modifier":
      return { type: "roll-modifier", target: "unit", modifier: { roll: closed(leaf, "roll"), operation: closed(leaf, "operation"), value: closed(leaf, "value") } };
    case "critical-hit-threshold": {
      const value = closed(leaf, "value");
      if (typeof value !== "number") throw new CompileError("critical-hit-threshold needs a numeric threshold before it can compile.");
      return { type: "roll-modifier", target: "unit", modifier: { roll: leaf.parameters.roll === undefined ? "hit" : closed(leaf, "roll"), critical_on: value } };
    }
    case "resource-action": {
      const resource = closed(leaf, "resource");
      const amount = closed(leaf, "amount");
      if (closed(leaf, "operation") !== "gain") throw new CompileError(`Only resource gains compile; ${String(leaf.parameters.operation)} has no DSL fragment yet.`);
      if (resource === "command-point") return { type: "cp-gain", target: "self", modifier: { amount } };
      const pool = RESOURCE_POOLS[String(resource)];
      if (!pool) throw new CompileError(`Resource ${String(resource)} has no DSL pool yet.`);
      return { type: "resource-gain", target: "self", modifier: { pool_id: pool, amount } };
    }
    case "characteristic-set":
      return { type: "stat-modifier", target: target(leaf.parameters.subject), modifier: { stat: closed(leaf, "characteristic"), operation: "set", value: closed(leaf, "value") } };
    case "weapon-ability-grant": {
      const weaponType = closed(leaf, "weapon_type");
      return {
        type: "keyword-grant", target: target(leaf.parameters.subject),
        modifier: { keywords: [closed(leaf, "keyword")], ...(weaponType && weaponType !== "all" ? { weapon_type: weaponType } : {}) },
      };
    }
    default:
      throw new CompileError(`Effect ${leaf.family_id} has no DSL fragment yet.`);
  }
}

/** Compile one ability's reviewed leaves. Failures name what is missing; nothing is guessed. */
export function compileLeaves(leaves: readonly CompileLeaf[]): Compiled {
  const signature = shapeSignature(leaves);
  const ordered = [...leaves].sort((left, right) => left.start_byte - right.start_byte);
  const errors: string[] = [];
  const conditions: Record<string, unknown>[] = [];
  const effects: Record<string, unknown>[] = [];
  const triggers: Record<string, unknown>[] = [];
  const durations: string[] = [];
  const attached = ordered.some((leaf) => leaf.family_id === "leading-unit");
  for (const leaf of ordered) {
    try {
      if (leaf.role === "CONDITION") conditions.push(condition(leaf));
      else if (leaf.role === "EFFECT") effects.push(effect(leaf, attached));
      else if (leaf.role === "DURATION") {
        const duration = DURATIONS[String(closed(leaf, "endpoint"))];
        if (!duration) throw new CompileError(`Duration ${String(leaf.parameters.endpoint)} has no DSL scope yet.`);
        durations.push(duration);
      } else if (leaf.role === "EVENT") {
        if (leaf.family_id === "event" && ATTACK_EVENTS.has(String(leaf.parameters.kind))) continue;
        const trigger = TRIGGERS[kindKey(leaf)];
        if (!trigger) throw new CompileError(`Event ${kindKey(leaf)} has no DSL trigger yet.`);
        triggers.push(structuredClone(trigger));
      } else {
        throw new CompileError(`Role ${leaf.role} cannot compile.`);
      }
    } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      errors.push(error.message);
    }
  }
  if (effects.length === 0) errors.push("There is no effect leaf to compile.");
  if (triggers.length > 1) errors.push("More than one trigger event; the shape needs a combinator the compiler does not have.");
  if (new Set(durations).size > 1) errors.push("Conflicting durations.");
  if (errors.length > 0) return { ok: false, signature, errors };

  const body = effects.length === 1 ? effects[0]! : { type: "sequence", steps: effects };
  const conditionNode = conditions.length === 0 ? null : conditions.length === 1 ? conditions[0]! : { operator: "and", operands: conditions };
  return {
    ok: true,
    signature,
    mechanics: {
      effect: conditionNode ? { type: "conditional", condition: conditionNode, effect: body } : body,
      scope: { range: "unit", duration: durations[0] ?? "permanent" },
      behavior: triggers.length ? "reactive" : "passive",
      trigger: triggers[0] ?? null,
    },
  };
}
