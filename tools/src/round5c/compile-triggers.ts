/**
 * EVENT-role leaves as DSL triggers, split out of `compile-conditions.ts`: the fixed kinds'
 * table, phase/turn/step boundaries, the general owned moments, and a folded unit-filter as the
 * acting unit. Used from `compile.ts` and the containers.
 */

import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { OWNED_EVENT_KINDS } from "./event-family.js";

type Node = Record<string, unknown>;

const TRIGGERS: Record<string, Node> = {
  "event:charge": { event: "move-ended", filter: { move_types: ["charge"] } },
  "event:unit-destroyed": { event: "destroyed" },
  "event:model-destroyed": { event: "model-destroyed", object: "model-in-this-unit" },
  "event:this-model-destroyed": { event: "model-destroyed", object: "this-model", filter: { timing: "before-removal" } },
  // Having shot is the unit's own shooting attacks resolved, in whichever phase it shot.
  "event:after-shooting": { event: "attacks-resolved", filter: { kind: "shoot" } },
  "event:selected-to-shoot": { event: "selected", filter: { to: "shoot" } },
  "event:selected-to-fight": { event: "selected", filter: { to: "fight" } },
  // Enemy moments name the enemy unit as the one acting, and this unit as what it acts on.
  "event:enemy-selected-targets": { event: "targets-selected", filter: { kind: "attack" }, subject: { owner: "enemy" }, object: "this-unit" },
  "event:enemy-ended-move": { event: "move-ended", subject: { owner: "enemy" } },
  "event:enemy-has-shot": { event: "attacks-resolved", filter: { kind: "shoot" }, subject: { owner: "enemy" } },
  "event:enemy-declared-charge": { event: "targets-selected", filter: { kind: "charge" }, subject: { owner: "enemy" } },
  "turn-start:battle-round": { event: "round-started" },
  "turn-start:player-turn": { event: "turn-started", condition: { type: "player-turn-is", parameters: { turn: "your-turn" } } },
  "turn-start:opponent-turn": { event: "turn-started", condition: { type: "player-turn-is", parameters: { turn: "opponent-turn" } } },
  // Version 7 (batch 6): bare game-clock and history moments with no narrowing of their own.
  "event:battle-started": { event: "battle-started" },
  "event:deployment-ended": { event: "deployment-ended" },
  "event:round-ended": { event: "round-ended" },
  "event:disembarked": { event: "disembarked" },
  "event:damage-allocated": { event: "damage-allocated" },
  // Version 8 (batch 7a): more bare moments.
  "event:battle-formations-declared": { event: "battle-formations-declared" },
  "event:objective-gained": { event: "objective-gained" },
};

/** A phase-boundary trigger, narrowed by phase and whose turn unless either is "any". */
function phaseTrigger(leaf: CompileLeaf): Node | null {
  const event = leaf.parameters.kind === "phase-start" ? "phase-started" : leaf.parameters.kind === "phase-end" ? "phase-ended" : null;
  if (!event) return null;
  const operands: Node[] = [];
  if (leaf.parameters.phase && leaf.parameters.phase !== "any") operands.push({ type: "phase-is", parameters: { phase: leaf.parameters.phase } });
  // The DSL spells whose turn as the schema's player-turn enum does.
  if (leaf.parameters.turn && leaf.parameters.turn !== "either") operands.push({ type: "player-turn-is", parameters: { turn: `${String(leaf.parameters.turn)}-turn` } });
  if (operands.length === 0) return { event };
  return { event, condition: operands.length === 1 ? operands[0] : { operator: "and", operands } };
}

/** A turn-boundary trigger (version 7's turn-ended), narrowed by whose turn unless "either". */
function turnEndedTrigger(leaf: CompileLeaf): Node {
  const turn = leaf.parameters.turn;
  if (!turn || turn === "either") return { event: "turn-ended" };
  return { event: "turn-ended", condition: { type: "player-turn-is", parameters: { turn: `${String(turn)}-turn` } } };
}

/** A trigger narrowed to one player's turn, unless the leaf says either or nothing. */
function withTurn(node: Node, leaf: CompileLeaf): Node {
  const turn = leaf.parameters.turn;
  if (turn === undefined || turn === "either") return node;
  return { ...node, condition: { type: "player-turn-is", parameters: { turn: `${String(closed(leaf, "turn"))}-turn` } } };
}

function triggerRoll(leaf: CompileLeaf): unknown {
  return closed(leaf, "roll");
}

/** Version 7 kinds that need one extra filter field the bare `TRIGGERS` table cannot carry. */
const V7_FILTERED_KINDS: Record<string, (leaf: CompileLeaf) => Node> = {
  "turn-ended": turnEndedTrigger,
  "step-started": (leaf) => withTurn({ event: "step-started", filter: { step: closed(leaf, "step") } }, leaf),
  used: (leaf) => ({ event: "used", filter: { kind: closed(leaf, "activity") }, ...(leaf.parameters.owner !== undefined ? { subject: { owner: closed(leaf, "owner") } } : {}) }),
  "state-changed": (leaf) => ({ event: "state-changed", filter: { state: closed(leaf, "state") } }),
  "designation-changed": (leaf) => ({ event: "designation-changed", filter: { tag: closed(leaf, "tag") } }),
  "designation-resolved": (leaf) => ({ event: "designation-resolved", filter: { tag: closed(leaf, "tag") } }),
  "before-roll": (leaf) => ({ event: "before-roll", filter: { roll: triggerRoll(leaf) } }),
  // Version 8 (batch 7a).
  "after-roll": (leaf) => ({
    event: "after-roll", filter: { roll: triggerRoll(leaf), ...(leaf.parameters.result !== undefined ? { result: closed(leaf, "result") } : {}) },
    ...(leaf.parameters.subject !== undefined && leaf.parameters.subject !== "this-unit" ? { subject: closed(leaf, "subject") } : {}),
  }),
  "marker-removed": (leaf) => ({ event: "marker-removed", filter: { marker: closed(leaf, "marker") } }),
  "resource-gained": (leaf) => ({ event: "resource-gained", filter: { pool: closed(leaf, "pool") } }),
  "resource-spent": (leaf) => ({ event: "resource-spent", filter: { pool: closed(leaf, "pool") } }),
};

export function kindKey(leaf: CompileLeaf): string {
  return `${leaf.family_id}:${String(leaf.family_id === "turn-start" ? leaf.parameters.turn : leaf.parameters.kind)}`;
}

/** Version 9's four general moments: any owner, and their own move_types/to/action_kind filter. */
function ownedEventTrigger(leaf: CompileLeaf): Node {
  const node: Node = { event: closed(leaf, "kind") };
  if (leaf.parameters.owner !== undefined) node.subject = { owner: closed(leaf, "owner") };
  // An explicit subject other than this unit (the default) names whose moment it is.
  if (leaf.parameters.subject !== undefined && leaf.parameters.subject !== "this-unit") node.subject = closed(leaf, "subject");
  const filter: Node = {};
  if (leaf.parameters.move_types !== undefined) filter.move_types = closed(leaf, "move_types");
  // Selected "to charge" is selected to declare a charge, which the DSL spells declare-charge.
  if (leaf.parameters.to !== undefined) filter.to = closed(leaf, "to") === "charge" ? "declare-charge" : closed(leaf, "to");
  if (leaf.parameters.action_kind !== undefined) filter.kind = closed(leaf, "action_kind");
  if (Object.keys(filter).length) node.filter = filter;
  // "Each time you target the bearer with a Stratagem": what the moment was done to.
  if (leaf.parameters.object !== undefined) node.object = closed(leaf, "object");
  return node;
}

export function trigger(leaf: CompileLeaf): Node {
  const node = eventTrigger(leaf);
  // A folded unit-filter (compile-unit-filters.ts) names the unit whose action fires it.
  if (leaf.parameters.subject_filter !== undefined) node.subject = structuredClone(leaf.parameters.subject_filter as Node);
  // A folded unit-filter after it ("allocated to an ADEPTA SORORITAS unit") names what it happens to.
  if (leaf.parameters.object_filter !== undefined) node.object = structuredClone(leaf.parameters.object_filter as Node);
  return node;
}

function eventTrigger(leaf: CompileLeaf): Node {
  if (leaf.family_id === "event") {
    const kind = String(leaf.parameters.kind);
    // Version 13's move-started takes the same owner, subject and move_types as move-ended.
    if ((OWNED_EVENT_KINDS as readonly string[]).includes(kind) || kind === "move-started") return ownedEventTrigger(leaf);
    if (V7_FILTERED_KINDS[kind]) return V7_FILTERED_KINDS[kind]!(leaf);
    const boundary = phaseTrigger(leaf);
    if (boundary) return boundary;
  }
  const found = TRIGGERS[kindKey(leaf)];
  if (!found) throw new CompileError(`Event ${kindKey(leaf)} has no DSL trigger yet.`);
  const node = structuredClone(found);
  // "each time this unit destroys an enemy unit": who destroyed it, and whose unit it was.
  if (leaf.parameters.by !== undefined) node.subject = closed(leaf, "by");
  if (leaf.parameters.object_owner !== undefined) node.object = { owner: closed(leaf, "object_owner") };
  // "Each time an attack is allocated to this model".
  if (leaf.parameters.object !== undefined) node.object = closed(leaf, "object");
  return node;
}
