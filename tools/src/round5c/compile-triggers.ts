/**
 * EVENT-role leaves as DSL triggers, split out of `compile-conditions.ts`: the fixed kinds'
 * table, phase/turn/step boundaries, the general owned moments, and a folded unit-filter as the
 * acting unit. Used from `compile.ts` and the containers.
 */

import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { OWNED_EVENT_KINDS } from "./event-family.js";
import { TRIGGER_ROLL_KINDS } from "./dice-families.js";

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

/** A before-roll or after-roll filter's roll: a kind the DSL trigger can name, never any, all or attacks. */
function triggerRoll(leaf: CompileLeaf): unknown {
  const roll = closed(leaf, "roll");
  if (!(TRIGGER_ROLL_KINDS as readonly unknown[]).includes(roll)) throw new CompileError(`A ${String(leaf.parameters.kind)} moment names roll ${JSON.stringify(roll)}, which a DSL trigger cannot name; name the roll kinds it covers.`);
  return roll;
}

/**
 * The triggers one EVENT leaf lowers to: a list of roll kinds (`rolls`, version 19) is one trigger
 * per kind, in the listed order, each with that kind as its roll. Every other leaf is one trigger.
 */
export function triggerLeaves(leaf: CompileLeaf): CompileLeaf[] {
  if (leaf.family_id !== "event" || !Array.isArray(leaf.parameters.rolls)) return [leaf];
  const { rolls, ...rest } = leaf.parameters as { rolls: unknown[] } & Record<string, unknown>;
  return rolls.map((roll) => ({ ...leaf, parameters: { ...rest, roll } }));
}

/**
 * "When this model uses its Foo ability", "each time a friendly unit performs the Bar Agile
 * Manoeuvre": which rule was used (filter.id) and who used it. This unit is the DSL's default.
 */
function usedTrigger(leaf: CompileLeaf): Node {
  const subject = leaf.parameters.subject;
  if (subject !== undefined && leaf.parameters.subject_filter !== undefined) throw new CompileError("A used moment names who used the rule twice: by its subject and by the unit-filter before it.");
  // An aura's recipient is no unit outside the aura: compile-named-ability.ts folds that moment into the trigger's proximity.
  if (subject === "recipient") throw new CompileError("A used moment of an aura's recipient must follow its aura-range directly, in the same sentence, to become the trigger's subject and proximity.");
  // "When a unit chosen by a Gadget is used": the chosen unit is not who used the rule (compile-named-ability.ts).
  if (leaf.parameters.object === "antecedent") throw new CompileError("A used moment's unit is the one that used the rule; an earlier leaf's unit as the object of a use is not who used it.");
  return {
    event: "used",
    filter: { kind: closed(leaf, "activity"), ...(leaf.parameters.id !== undefined ? { id: closed(leaf, "id") } : {}) },
    ...(leaf.parameters.owner !== undefined ? { subject: { owner: closed(leaf, "owner") } } : {}),
    ...(subject !== undefined && subject !== "this-unit" ? { subject: closed(leaf, "subject") } : {}),
  };
}

/** Version 7 kinds that need one extra filter field the bare `TRIGGERS` table cannot carry. */
const V7_FILTERED_KINDS: Record<string, (leaf: CompileLeaf) => Node> = {
  "turn-ended": turnEndedTrigger,
  "step-started": (leaf) => withTurn({ event: "step-started", filter: { step: closed(leaf, "step") } }, leaf),
  used: usedTrigger,
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
  // Version 17: where a set-up moment brings the unit from ("set up … from Reserves").
  if (leaf.parameters.from !== undefined) filter.from = closed(leaf, "from");
  // "Each time you target this unit with the Foo Stratagem": which Stratagem.
  if (leaf.parameters.id !== undefined) {
    if (filter.kind !== "stratagem") throw new CompileError("A targeting names its ability through a by-ability leaf, with the unit whose ability it is.");
    filter.id = closed(leaf, "id");
  }
  if (Object.keys(filter).length) node.filter = filter;
  // "Selected by a friendly X unit's Foo ability" (compile-named-ability.ts): the selecting ability
  // and its user; the trigger's subject is the selected unit, any unit unless the moment names one.
  if (filter.kind === "ability") {
    if (leaf.parameters.source_ability === undefined) throw new CompileError("A unit selected by an ability needs a by-ability leaf naming that ability and the unit whose ability it is.");
    node.source_ability = structuredClone(leaf.parameters.source_ability);
    node.subject ??= { owner: "any" };
  }
  // "Each time you target the bearer with a Stratagem": what the moment was done to.
  if (leaf.parameters.object === "antecedent") throw new CompileError("A moment that names an earlier leaf's unit as its object needs that unit's aura, which names the unit and its range.");
  if (leaf.parameters.object !== undefined) node.object = closed(leaf, "object");
  return node;
}

export function trigger(leaf: CompileLeaf): Node {
  // A list of roll kinds is several triggers; a caller that takes one trigger must use triggerLeaves().
  if (Array.isArray(leaf.parameters.rolls)) throw new CompileError("A moment that names several rolls lowers to one trigger per roll; it cannot be one trigger.");
  const node = eventTrigger(leaf);
  // "Those attacks": the moment's attacks, which a later effect names (compile-bound-attacks.ts).
  if (leaf.parameters.binds_event_variable !== undefined && leaf.family_id === "event") node.binds_event_variable = closed(leaf, "binds_event_variable");
  // A folded unit-filter (compile-unit-filters.ts) names the unit whose action fires it.
  if (leaf.parameters.subject_filter !== undefined) node.subject = structuredClone(leaf.parameters.subject_filter as Node);
  // An aura's recipient's moment (compile-named-ability.ts): within the aura's range of its holder.
  if (leaf.parameters.proximity !== undefined) {
    const { of, inches } = leaf.parameters.proximity as { of: string; inches: number };
    node.proximity = { of, range: { inches } };
  }
  // "Using its Foo ability" (compile-named-ability.ts): the moment's unit used that ability in it.
  if (leaf.parameters.by_ability !== undefined) {
    const subject = typeof node.subject === "string" ? node.subject : node.subject === undefined ? undefined : "event-subject";
    const used: Node = { type: "happened", parameters: { event: "used", ...(subject !== undefined && subject !== "this-unit" ? { subject } : {}), filter: { kind: "ability", id: leaf.parameters.by_ability }, window: "event" } };
    node.condition = node.condition === undefined ? used : { operator: "and", operands: [node.condition, used] };
  }
  // "an Agile Manoeuvre that involves rolling a D6" (compile-manoeuvre-own-roll.ts): one of the named manoeuvres was used.
  if (leaf.parameters.manoeuvre_ids !== undefined) {
    const subject = typeof node.subject === "string" ? node.subject : node.subject === undefined ? undefined : "event-subject";
    const ids = closed(leaf, "manoeuvre_ids") as string[];
    const used = ids.map((id): Node => ({ type: "happened", parameters: { event: "used", ...(subject !== undefined && subject !== "this-unit" ? { subject } : {}), filter: { kind: "manoeuvre", id }, window: "event" } }));
    const either: Node = used.length === 1 ? used[0]! : { operator: "or", operands: used };
    node.condition = node.condition === undefined ? either : { operator: "and", operands: [node.condition, either] };
  }
  // A folded unit-filter after it ("allocated to an ADEPTA SORORITAS unit") names what it happens to.
  if (leaf.parameters.object_filter !== undefined) {
    node.object = structuredClone(leaf.parameters.object_filter as Node);
    // "Destroys an enemy CHARACTER model": the filter names the destroyed model.
    if (node.event === "model-destroyed") (node.object as Node).level = "model";
  }
  return node;
}

/**
 * "Each time a unit disembarks from this model": any unit's disembarkation from this Transport.
 * The bare moment has no subject, so the DSL default (this unit, the Transport) would name the
 * Transport; a folded unit-filter replaces the `owner: any` subject in `trigger()`.
 */
function disembarkedFromTransport(leaf: CompileLeaf): Node {
  return { event: "disembarked", subject: { owner: "any" }, filter: { transport: closed(leaf, "transport") } };
}

function eventTrigger(leaf: CompileLeaf): Node {
  if (leaf.family_id === "event") {
    const kind = String(leaf.parameters.kind);
    if (kind === "disembarked" && leaf.parameters.transport !== undefined) return disembarkedFromTransport(leaf);
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
  // A destroyer bound to a folded filter's units ("each time a friendly X unit destroys …") is that filter.
  if (leaf.parameters.by === "filtered-units" && leaf.parameters.subject_filter === undefined) throw new CompileError("event by names the units of a unit-filter, but none sits right before it.");
  if (leaf.parameters.by !== undefined) node.subject = leaf.parameters.by === "enemy" ? { owner: "enemy" } : closed(leaf, "by");
  // A destroyed model's owner names a model, not a unit ("destroys an enemy model").
  if (leaf.parameters.object_owner !== undefined) node.object = { owner: closed(leaf, "object_owner"), ...(node.event === "model-destroyed" ? { level: "model" } : {}) };
  // "An attack made with this model's quake cannon destroys": the attacks that destroy (compile-weapon-qualified.ts).
  if (leaf.parameters.destroy_filter !== undefined) {
    if (node.filter !== undefined) throw new CompileError("A destruction already has a filter; it cannot also name its attacks.");
    node.filter = structuredClone(leaf.parameters.destroy_filter as Node);
  }
  // "Each time an attack is allocated to this model".
  if (leaf.parameters.object === "antecedent") throw new CompileError("A moment that names an earlier leaf's unit as its object needs that unit's aura, which names the unit and its range.");
  if (leaf.parameters.object !== undefined) node.object = closed(leaf, "object");
  return node;
}

/**
 * A unit-destroyed moment names the destroyed unit as its object when a later leaf places units
 * "of event-object" (wave 10, set-up placement after a destruction). Other destroyed moments keep
 * their trigger as it was.
 */
export function withDestroyedObject(node: Node, placedFromObject: boolean): Node {
  return node.event === "destroyed" && node.object === undefined && placedFromObject ? { ...node, object: "event-object" } : node;
}
