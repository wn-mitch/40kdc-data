/**
 * One fixed DSL fragment per leaf family. The composition rules in `compile.ts` decide how the
 * fragments combine; nothing here depends on the other leaves of an ability.
 */

export type CompileLeaf = {
  role: string;
  family_id: string;
  family_version: number;
  parameters: Record<string, unknown>;
  start_byte: number;
  /** Where the leaf's wording ends; with the source text it locates clause breaks. */
  end_byte?: number;
  fragment?: string;
};

export class CompileError extends Error {}

type Node = Record<string, unknown>;

const TRIGGERS: Record<string, Node> = {
  "event:charge": { event: "charge-move", subject: "self" },
  "event:unit-destroyed": { event: "on-unit-destroyed" },
  "event:model-destroyed": { event: "on-model-destroyed" },
  "event:after-shooting": { event: "after-unit-resolves-attacks", subject: "self", condition: { type: "phase-is", parameters: { phase: "shooting" } } },
  "turn-start:battle-round": { event: "start-of-battle-round" },
  "turn-start:player-turn": { event: "start-of-player-turn" },
  "turn-start:opponent-turn": { event: "start-of-opponent-turn" },
};

export const DURATIONS: Record<string, string> = {
  "end-of-phase": "phase", "end-of-turn": "turn", "end-of-battle-round": "battle-round", "end-of-battle": "battle",
};

const RESOURCE_POOLS: Record<string, string> = {
  "miracle-dice": "miracle-dice-pool", "fate-dice": "fate-dice-pool", "bloodshed-point": "bloodshed-point",
};

const SUBJECT_TARGETS: Record<string, string> = { "this-unit": "unit", "this-model": "self", bearer: "bearer" };

/** Marks as the authored data spells them: pseudo-keywords the cruncher matches on the target. */
const MARK_KEYWORDS: Record<string, string> = {
  "oath-of-moment": "Oath of Moment target", afflicted: "AFFLICTED", spotted: "SPOTTED", hidden: "HIDDEN", marked: "Marked",
};

const STATE_CONDITIONS: Record<string, string> = {
  "below-starting-strength": "unit-below-starting-strength", "below-half-strength": "unit-below-half-strength", "battle-shocked": "is-battle-shocked",
};

/** Event kinds an attack-time effect already implies (event versions before 4); they add nothing. */
export const ATTACK_EVENTS = new Set(["attack-made", "hit-roll", "wound-roll"]);

const isSource = (value: unknown): boolean => value !== null && typeof value === "object" && "source" in value;

export function closed(leaf: CompileLeaf, name: string): unknown {
  const value = leaf.parameters[name];
  if (isSource(value)) throw new CompileError(`${leaf.family_id} ${name} is quoted source text; give it a listed value before it can compile.`);
  return value;
}

/** Several alternatives are any one of them. */
export function anyOf(nodes: Node[]): Node {
  return nodes.length === 1 ? nodes[0]! : { operator: "or", operands: nodes };
}

/** The opposite of a condition: a simple condition flips its flag, a compound one is wrapped. */
export function negate(node: Node): Node {
  if ("operator" in node) return { operator: "not", operands: [node] };
  const flipped = !node.negated;
  const { negated: _drop, ...rest } = node;
  return flipped ? { ...rest, negated: true } : rest;
}

/** A predicate's own polarity: "not below half strength", "does not have FLY". */
function polarity(leaf: CompileLeaf, node: Node): Node {
  return leaf.parameters.negated === true ? negate(node) : node;
}

/** A phase-boundary trigger, narrowed by phase and whose turn unless either is "any". */
function phaseTrigger(leaf: CompileLeaf): Node | null {
  const event = leaf.parameters.kind === "phase-start" ? "start-of-phase" : leaf.parameters.kind === "phase-end" ? "end-of-phase" : null;
  if (!event) return null;
  const operands: Node[] = [];
  if (leaf.parameters.phase && leaf.parameters.phase !== "any") operands.push({ type: "phase-is", parameters: { phase: leaf.parameters.phase } });
  if (leaf.parameters.turn && leaf.parameters.turn !== "either") operands.push({ type: "player-turn-is", parameters: { turn: leaf.parameters.turn } });
  if (operands.length === 0) return { event };
  return { event, condition: operands.length === 1 ? operands[0] : { operator: "and", operands } };
}

export function kindKey(leaf: CompileLeaf): string {
  return `${leaf.family_id}:${String(leaf.family_id === "turn-start" ? leaf.parameters.turn : leaf.parameters.kind)}`;
}

export function trigger(leaf: CompileLeaf): Node {
  const found = (leaf.family_id === "event" ? phaseTrigger(leaf) : null) ?? TRIGGERS[kindKey(leaf)];
  if (!found) throw new CompileError(`Event ${kindKey(leaf)} has no DSL trigger yet.`);
  return structuredClone(found);
}

/** The condition an attack leaf adds: only melee or only ranged attacks. */
export function attackTypeCondition(leaf: CompileLeaf): Node | null {
  const type = closed(leaf, "attack_type");
  return type === "melee" || type === "ranged" ? { type: "attack-is-type", parameters: { attack_type: type } } : null;
}

export function condition(leaf: CompileLeaf): Node {
  const target = closed(leaf, "subject") === "target";
  switch (leaf.family_id) {
    case "leading-unit":
      return { type: "is-attached" };
    case "below-starting-strength":
      return target || leaf.parameters.subject === "target-unit"
        ? { type: "unit-below-starting-strength", parameters: { subject: "target" } }
        : { type: "unit-below-starting-strength" };
    case "unit-state":
      return polarity(leaf, anyOf((leaf.parameters.states as string[]).map((state) => ({
        type: STATE_CONDITIONS[state], ...(target ? { parameters: { subject: "target" } } : {}),
      }))));
    case "unit-keyword": {
      const keywords = leaf.parameters.keywords as string[];
      const type = target ? "target-has-keyword" : "unit-has-keyword";
      // "not a MONSTER or VEHICLE" excludes both, so each keyword carries the negation.
      if (leaf.parameters.negated === true) {
        const each = keywords.map((keyword) => ({ type, parameters: { keyword }, negated: true }));
        return each.length === 1 ? each[0]! : { operator: "and", operands: each };
      }
      return anyOf(keywords.map((keyword) => ({ type, parameters: { keyword } })));
    }
    case "unit-mark":
      return polarity(leaf, { type: target ? "target-has-keyword" : "unit-has-keyword", parameters: { keyword: MARK_KEYWORDS[String(closed(leaf, "mark"))] } });
    case "unit-position": {
      const kind = closed(leaf, "kind");
      if (kind === "closest-eligible") return polarity(leaf, { type: "unit-within-range-of", parameters: { target_type: "closest-eligible" } });
      if (kind === "within" || kind === "beyond") {
        // Distance from the attacking model to its target, as the authored data measures it.
        const node = { type: "unit-within-range-of", parameters: { target_type: "current-ranged-attack-target", range: closed(leaf, "inches") } };
        return polarity(leaf, kind === "beyond" ? negate(node) : node);
      }
      const controlled = closed(leaf, "controlled_by");
      return polarity(leaf, {
        type: "within-range-of-objective",
        parameters: { subject: target ? "target" : "unit", ...(controlled === "you" ? { controlled_by: "your-army" } : controlled === "opponent" ? { controlled_by: "opponent" } : {}) },
      });
    }
    case "target-is-selected":
      throw new CompileError("target-is-selected only compiles with a select-unit leaf; the compiler resolves it there.");
    default:
      throw new CompileError(`Condition ${leaf.family_id} has no DSL fragment yet.`);
  }
}

/** Rolls the attacker makes; when an attack targets this unit, modifiers to them belong to the attacker. */
const ATTACKER_ROLLS = new Set(["hit", "wound", "damage"]);

/**
 * One effect. `subject` is who the ability's own subject resolves to: the unit when a leader
 * is attached, else the family's subject parameter. `incoming` marks an effect on attacks that
 * target this unit, where the attacker's rolls are modified.
 */
export function effect(leaf: CompileLeaf, context: { attached: boolean; attacker?: string | null; incoming: boolean }): Node {
  const target = (subject: unknown) => context.attached ? "unit" : SUBJECT_TARGETS[String(subject)] ?? "unit";
  const rollTarget = (roll: unknown) => context.incoming && ATTACKER_ROLLS.has(String(roll)) ? "attacker" : context.attacker ?? "unit";
  switch (leaf.family_id) {
    case "reroll": {
      const roll = closed(leaf, "roll");
      const subset = closed(leaf, "subset");
      const modifier = subset === "ones" ? { roll, subset: "ones" } : subset === "failed" ? { roll, subset: "all-failures" } : { roll, result_scope: "any-result" };
      return { type: "re-roll", target: rollTarget(roll), modifier };
    }
    case "roll-modifier": {
      const roll = closed(leaf, "roll");
      return { type: "roll-modifier", target: rollTarget(roll), modifier: { roll, operation: closed(leaf, "operation"), value: closed(leaf, "value") } };
    }
    case "critical-hit-threshold": {
      const value = closed(leaf, "value");
      if (typeof value !== "number") throw new CompileError("critical-hit-threshold needs a numeric threshold before it can compile.");
      const roll = leaf.parameters.roll === undefined ? "hit" : closed(leaf, "roll");
      return { type: "roll-modifier", target: rollTarget(roll), modifier: { roll, critical_on: value } };
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
    case "feel-no-pain": {
      const against = closed(leaf, "against");
      return { type: "feel-no-pain", target: target(leaf.parameters.subject), modifier: { threshold: closed(leaf, "threshold"), ...(against !== "all" ? { scope: against } : {}) } };
    }
    case "invulnerable-save":
      return { type: "invulnerable-save", target: target(leaf.parameters.subject), modifier: { invuln_sv: closed(leaf, "threshold") } };
    case "fights-first":
      return { type: "fight-first", target: target(leaf.parameters.subject), modifier: {} };
    case "characteristic-modifier":
      return { type: "stat-modifier", target: target(leaf.parameters.subject), modifier: { stat: closed(leaf, "characteristic"), operation: closed(leaf, "operation"), value: closed(leaf, "value") } };
    default:
      throw new CompileError(`Effect ${leaf.family_id} has no DSL fragment yet.`);
  }
}
