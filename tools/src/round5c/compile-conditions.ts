/**
 * Condition and trigger DSL fragments, split out of `compile-fragments.ts` (batch 6) so that
 * file and `compile.ts` stay under the line ceiling. `compile-fragments.ts` keeps the leaf type,
 * `CompileError`, and the EFFECT fragment (`effect()`), which still needs `closed()`; everything
 * here is CONDITION- and EVENT-role composition, used only from `compile.ts`.
 */

import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { DESIGNATION_IDS } from "../translate/designations.js";
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

export const DURATIONS: Record<string, string> = {
  "end-of-phase": "phase", "end-of-turn": "turn", "end-of-battle-round": "battle-round", "end-of-battle": "battle",
  "start-of-next-turn": "until-start-next-turn", "start-of-next-command-phase": "until-next-command-phase",
  "start-of-next-movement-phase": "until-next-movement-phase", "start-of-next-battle-round": "until-next-battle-round",
  // Version 3 (batch 7a).
  "end-of-attack-sequence": "attack-sequence", "end-of-this-use": "resolution", "start-of-next-shooting-phase": "until-next-shooting-phase",
  "end-of-your-next-turn": "until-end-of-your-next-turn", "end-of-opponents-next-turn": "until-end-of-opponent-next-turn",
  "this-unit-has-shot": "until-this-unit-has-shot", "control-lost": "control-lost",
};

/** A unit's own activity, as the history it leaves: [event, filter, window]. */
const ACTIVITIES: Record<string, [string, Node, string]> = {
  "charged-this-turn": ["move-ended", { move_types: ["charge"] }, "turn"],
  "advanced-this-turn": ["move-ended", { move_types: ["advance"] }, "turn"],
  "remained-stationary": ["move-ended", { move_types: ["remain-stationary"] }, "turn"],
  "fought-this-phase": ["selected", { to: "fight" }, "phase"],
  "selected-to-shoot-this-phase": ["selected", { to: "shoot" }, "phase"],
  "selected-to-move-this-phase": ["selected", { to: "move" }, "phase"],
};

/** A unit-state leaf's states that are not core-rules unit states. */
const STRENGTH_STATES: Record<string, string> = { "below-starting-strength": "starting", "below-half-strength": "half" };

/** Marks as the designations an effect applies, uppercase as the rules print them. */
const MARK_TAGS: Record<string, string> = {
  "oath-of-moment": "OATH OF MOMENT TARGET", afflicted: "AFFLICTED", spotted: "SPOTTED", hidden: "HIDDEN", marked: "MARKED",
};

/** A predicate with its subject: the target of the attack, or (by default) the ability's unit. */
const pred = (type: string, parameters: Node, subject?: string): Node => ({ type, parameters: subject ? { subject, ...parameters } : parameters });

/** Event kinds an attack-time effect already implies (event versions before 4); they add nothing. */
export const ATTACK_EVENTS = new Set(["attack-made", "hit-roll", "wound-roll"]);

/** Several alternatives are any one of them. */
export function anyOf(nodes: Node[]): Node {
  return nodes.length === 1 ? nodes[0]! : { operator: "or", operands: nodes };
}

/** The opposite of a condition: `not` it, or unwrap a `not`. */
export function negate(node: Node): Node {
  if (node.operator === "not" && Array.isArray(node.operands) && node.operands.length === 1) return node.operands[0] as Node;
  return { operator: "not", operands: [node] };
}

/** A predicate's own polarity: "not below half strength", "does not have FLY". */
function polarity(leaf: CompileLeaf, node: Node): Node {
  return leaf.parameters.negated === true ? negate(node) : node;
}

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

/** Version 7 kinds that need one extra filter field the bare `TRIGGERS` table cannot carry. */
const V7_FILTERED_KINDS: Record<string, (leaf: CompileLeaf) => Node> = {
  "turn-ended": turnEndedTrigger,
  "step-started": (leaf) => ({ event: "step-started", filter: { step: closed(leaf, "step") } }),
  used: (leaf) => ({ event: "used", filter: { kind: closed(leaf, "activity") } }),
  "state-changed": (leaf) => ({ event: "state-changed", filter: { state: closed(leaf, "state") } }),
  "designation-changed": (leaf) => ({ event: "designation-changed", filter: { tag: closed(leaf, "tag") } }),
  "designation-resolved": (leaf) => ({ event: "designation-resolved", filter: { tag: closed(leaf, "tag") } }),
  "before-roll": (leaf) => ({ event: "before-roll", filter: { roll: closed(leaf, "roll") } }),
  // Version 8 (batch 7a).
  "after-roll": (leaf) => ({ event: "after-roll", filter: { roll: closed(leaf, "roll") } }),
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
  const filter: Node = {};
  if (leaf.parameters.move_types !== undefined) filter.move_types = closed(leaf, "move_types");
  if (leaf.parameters.to !== undefined) filter.to = closed(leaf, "to");
  if (leaf.parameters.action_kind !== undefined) filter.kind = closed(leaf, "action_kind");
  if (Object.keys(filter).length) node.filter = filter;
  return node;
}

export function trigger(leaf: CompileLeaf): Node {
  if (leaf.family_id === "event") {
    const kind = String(leaf.parameters.kind);
    if ((OWNED_EVENT_KINDS as readonly string[]).includes(kind)) return ownedEventTrigger(leaf);
    if (V7_FILTERED_KINDS[kind]) return V7_FILTERED_KINDS[kind]!(leaf);
    const boundary = phaseTrigger(leaf);
    if (boundary) return boundary;
  }
  const found = TRIGGERS[kindKey(leaf)];
  if (!found) throw new CompileError(`Event ${kindKey(leaf)} has no DSL trigger yet.`);
  return structuredClone(found);
}

/** The condition an attack leaf adds: only melee or only ranged attacks. */
export function attackTypeCondition(leaf: CompileLeaf): Node | null {
  const type = closed(leaf, "attack_type");
  return type === "melee" || type === "ranged" ? { type: "attack-is", parameters: { attack_type: type } } : null;
}

/**
 * A batch-6-widened predicate's subject value, turned into the DSL's "who": omitted for the
 * implicit default (this-unit), `defender` for the attack's target (the pre-widening
 * convention), everything else (this-model, attacker, event-subject, recipient, selected-unit)
 * passed straight through, since those already spell the unit-ref role the describer expects.
 */
function widenedWho(value: unknown): string | undefined {
  const subject = String(value);
  if (subject === "this-unit") return undefined;
  if (subject === "target") return "defender";
  return subject;
}

export function condition(leaf: CompileLeaf): Node {
  const target = closed(leaf, "subject") === "target";
  const who = target ? "defender" : undefined;
  switch (leaf.family_id) {
    case "leading-unit": {
      // A Leader is a model, so this model, this unit and the bearer's unit leading all say the
      // Leader model is leading. Version 1 leaves only ever meant leading.
      const attachment = leaf.family_version >= 2 ? closed(leaf, "attachment") : "leading";
      if (attachment === "leading") return pred("attachment", { role: "leading" }, "this-model");
      // The DSL has no supporting role. A model attached in support is part of an attached unit,
      // and a Support model is attached only in support, so "this model is supporting a unit"
      // is "this model is part of an attached unit". A unit is attached whether it is led or
      // supported, so a supporting unit has no DSL condition yet.
      if (attachment === "supporting" && closed(leaf, "subject") === "this-model") return pred("attachment", { role: "attached" }, "this-model");
      throw new CompileError(`leading-unit ${String(attachment)} with subject ${JSON.stringify(leaf.parameters.subject)} has no DSL condition yet.`);
    }
    case "below-starting-strength":
      return pred("strength", { below: "starting" }, target || leaf.parameters.subject === "target-unit" ? "defender" : undefined);
    case "unit-state": {
      // Version 4 (batch 6) widens subject beyond this-unit/this-model/target; below that,
      // only being on the battlefield could ever be said of this model.
      const wide = leaf.family_version >= 4;
      return polarity(leaf, anyOf((leaf.parameters.states as string[]).map((state) => {
        const subject = wide ? widenedWho(closed(leaf, "subject"))
          : STRENGTH_STATES[state] ? who
            : state === "on-battlefield" && !target && leaf.parameters.subject === "this-model" ? "this-model" : who;
        if (STRENGTH_STATES[state]) return pred("strength", { below: STRENGTH_STATES[state] }, subject);
        return pred("unit-state", { state }, subject);
      })));
    }
    case "unit-keyword": {
      const keywords = leaf.parameters.keywords as string[];
      // Version 2 (batch 6) widens subject beyond this-unit/target.
      const subject = leaf.family_version >= 2 ? widenedWho(closed(leaf, "subject")) : who;
      // "not a MONSTER or VEHICLE" excludes both, so each keyword carries the negation.
      if (leaf.parameters.negated === true) {
        const each = keywords.map((keyword) => negate(pred("has-keyword", { all_of: [keyword] }, subject)));
        return each.length === 1 ? each[0]! : { operator: "and", operands: each };
      }
      return pred("has-keyword", keywords.length === 1 ? { all_of: keywords } : { any_of: keywords }, subject);
    }
    case "unit-activity": {
      const [event, filter, window] = ACTIVITIES[String(closed(leaf, "activity"))]!;
      // Version 3 (batch 6) widens subject beyond this-unit/target.
      const subject = leaf.family_version >= 3 ? widenedWho(closed(leaf, "subject")) : who;
      return polarity(leaf, pred("happened", { event, filter: structuredClone(filter), window }, subject));
    }
    case "unit-mark":
      return polarity(leaf, pred("designated", { tag: MARK_TAGS[String(closed(leaf, "mark"))] }, who));
    case "unit-position": {
      const kind = closed(leaf, "kind");
      // Widened for every version: v1 always authored subject as "target", so widenedWho gives
      // the same "defender" it always compiled to; only v2 (batch 6) can author anything else.
      const subject = widenedWho(closed(leaf, "subject"));
      if (kind === "closest-eligible") {
        const parameters: Node = { among: "eligible-targets" };
        if (leaf.parameters.to !== undefined) {
          const to = closed(leaf, "to");
          parameters.to = to === "target" ? "defender" : to;
        }
        if (leaf.parameters.range !== undefined) parameters.range = { inches: closed(leaf, "range") };
        return polarity(leaf, pred("closest", parameters, subject));
      }
      if (kind === "within" || kind === "beyond") {
        // Distance from the attacking model to its target, as the authored data measures it.
        const node = pred("within", { of: "defender", range: { inches: closed(leaf, "inches") } });
        return polarity(leaf, kind === "beyond" ? negate(node) : node);
      }
      const controlled = closed(leaf, "controlled_by");
      const objective = controlled === "you" ? { controlled_by: "friendly" } : controlled === "opponent" ? { controlled_by: "enemy" } : {};
      return polarity(leaf, pred("within", { of: { objective }, range: "objective-control" }, subject));
    }
    case "target-is-selected":
      throw new CompileError("target-is-selected only compiles with a select-unit leaf; the compiler resolves it there.");
    case "army-faction":
      return polarity(leaf, { type: "army-faction", parameters: { faction: closed(leaf, "faction") } });
    case "battle-size":
      return polarity(leaf, { type: "battle-size", parameters: { size: closed(leaf, "size") } });
    case "guided":
      return polarity(leaf, pred("guided", {}, leaf.parameters.subject === undefined ? undefined : closed(leaf, "subject") as string));
    case "moved-over": {
      const window = leaf.parameters.window === undefined ? undefined : closed(leaf, "window");
      return polarity(leaf, pred("moved-over", { by: closed(leaf, "by"), ...(window && window !== "event" ? { window } : {}) }, leaf.parameters.subject === undefined ? undefined : closed(leaf, "subject") as string));
    }
    // ── New predicate families (batch 6, predicate-families.ts) ─────────────────────────────
    case "rule-active":
      return polarity(leaf, { type: "rule-active", parameters: { rule: closed(leaf, "rule") } });
    case "unit-owner":
      return polarity(leaf, pred("owned-by", { owner: closed(leaf, "owner") }, subjectOf(leaf)));
    case "unit-has-ability":
      return polarity(leaf, pred("has-ability", { ability: closed(leaf, "ability") }, subjectOf(leaf)));
    case "same-unit":
      return polarity(leaf, pred("same-unit", { as: closed(leaf, "as") }, subjectOf(leaf)));
    case "model-count": {
      const parameters: Node = {};
      if (leaf.parameters.keyword !== undefined) parameters.keyword = closed(leaf, "keyword");
      if (leaf.parameters.min !== undefined) parameters.min = closed(leaf, "min");
      if (leaf.parameters.max !== undefined) parameters.max = closed(leaf, "max");
      return polarity(leaf, pred("model-count", parameters, subjectOf(leaf)));
    }
    case "wounds-state": {
      const kind = closed(leaf, "kind");
      const parameters: Node = kind === "lost" ? { lost: true } : kind === "damaged" ? { damaged: true } : { remaining_max: closed(leaf, "value") };
      return polarity(leaf, pred("wounds", parameters, subjectOf(leaf)));
    }
    case "history-compare": {
      // Both sides always tally enemy units destroyed this battle; the only variable is whether
      // one side narrows to CHARACTER units (mission-card kill-count comparisons).
      const destroyedSide = (kind: unknown): Node => ({ event: "destroyed", object: { owner: "enemy", ...(kind === "character" ? { all_of: ["CHARACTER"] } : {}) }, window: "battle" });
      const left = destroyedSide(leaf.parameters.left_kind);
      const rightKind = closed(leaf, "right_kind");
      const right: Node = rightKind === "tally" ? destroyedSide(leaf.parameters.right_tally_kind)
        : rightKind === "pool" ? { pool: closed(leaf, "right_pool") } : { value: closed(leaf, "right_value") };
      return polarity(leaf, { type: "happened-compare", parameters: { left, comparison: closed(leaf, "comparison"), right } });
    }
    case "in-region": {
      const kind = closed(leaf, "region_kind");
      const region: Node = kind === "territory" ? { territory: closed(leaf, "territory") } : { terrain_area: { footprint: closed(leaf, "terrain_tag") } };
      const parameters: Node = { region };
      if (leaf.parameters.wholly === true) parameters.wholly = true;
      if (leaf.parameters.models !== undefined) parameters.models = closed(leaf, "models");
      return polarity(leaf, pred("in-region", parameters, subjectOf(leaf)));
    }
    case "controls-objective": {
      if (closed(leaf, "mode") === "more-than-opponent") return polarity(leaf, { type: "controls", parameters: { compare: "more-than-opponent" } });
      const parameters: Node = {};
      if (leaf.parameters.by !== undefined) parameters.by = closed(leaf, "by");
      const objective: Node = {};
      if (leaf.parameters.objective_role !== undefined) objective.role = closed(leaf, "objective_role");
      if (leaf.parameters.home_of !== undefined) objective.home_of = closed(leaf, "home_of");
      if (leaf.parameters.objective_territory !== undefined) objective.territory = closed(leaf, "objective_territory");
      if (Object.keys(objective).length) parameters.objective = objective;
      if (leaf.parameters.count_min !== undefined) parameters.count_min = closed(leaf, "count_min");
      if (leaf.parameters.count_max !== undefined) parameters.count_max = closed(leaf, "count_max");
      return polarity(leaf, { type: "controls", parameters });
    }
    case "attack-filter": {
      const parameters: Node = {};
      for (const key of ["attack_type", "shooting_type", "fight_type", "weapon_keyword", "weapon_name"]) {
        if (leaf.parameters[key] !== undefined) parameters[key] = closed(leaf, key);
      }
      if (leaf.parameters.all_target_same_unit === true) parameters.all_target_same_unit = true;
      return polarity(leaf, { type: "attack-is", parameters });
    }
    case "attack-compare": {
      const left: Node = { of: closed(leaf, "left_of"), stat: closed(leaf, "left_stat") };
      if (leaf.parameters.left_reduce !== undefined) left.reduce = closed(leaf, "left_reduce");
      const rightKind = closed(leaf, "right_kind");
      let right: Node;
      if (rightKind === "stat") {
        right = { of: closed(leaf, "right_of"), stat: closed(leaf, "right_stat") };
        if (leaf.parameters.right_reduce !== undefined) right.reduce = closed(leaf, "right_reduce");
      } else right = { value: closed(leaf, "right_value") };
      return polarity(leaf, { type: "attack-compare", parameters: { left, comparison: closed(leaf, "comparison"), right } });
    }
    case "visible": {
      const parameters: Node = {};
      if (leaf.parameters.to !== undefined) parameters.to = closed(leaf, "to");
      if (leaf.parameters.fully === true) parameters.fully = true;
      if (leaf.parameters.blocked_by !== undefined) parameters.blocked_by = closed(leaf, "blocked_by");
      return polarity(leaf, pred("visible", parameters, subjectOf(leaf)));
    }
    case "designated-filter": {
      const parameters: Node = { tag: closed(leaf, "tag") };
      if (leaf.parameters.by !== undefined) parameters.by = closed(leaf, "by");
      if (leaf.parameters.count_min !== undefined) parameters.count_min = closed(leaf, "count_min");
      if (leaf.parameters.count_max !== undefined) parameters.count_max = closed(leaf, "count_max");
      return polarity(leaf, pred("designated", parameters, subjectOf(leaf)));
    }
    case "battle-round": {
      const parameters: Node = {};
      if (leaf.parameters.min !== undefined) parameters.min = closed(leaf, "min");
      if (leaf.parameters.max !== undefined) parameters.max = closed(leaf, "max");
      return { type: "battle-round", parameters };
    }
    case "roll-outcome": {
      const parameters: Node = { roll: closed(leaf, "roll"), result: closed(leaf, "result") };
      if (leaf.parameters.source !== undefined) parameters.source = { event_var: closed(leaf, "source") };
      return polarity(leaf, { type: "roll-result", parameters });
    }
    case "phase-window": {
      const operands: Node[] = [];
      if (leaf.parameters.phase !== undefined) operands.push({ type: "phase-is", parameters: { phase: closed(leaf, "phase") } });
      const turn = leaf.parameters.turn === undefined ? undefined : closed(leaf, "turn");
      if (turn !== undefined && turn !== "either") operands.push({ type: "player-turn-is", parameters: { turn: `${String(turn)}-turn` } });
      if (operands.length === 0) throw new CompileError("phase-window needs a phase, a turn other than either, or both.");
      return operands.length === 1 ? operands[0]! : { operator: "and", operands };
    }
    // ── Mission/composition predicate families (batch 7a, mission-predicate-families.ts) ────
    case "model-profile":
      return polarity(leaf, pred("model-profile", { profile: closed(leaf, "profile") }, subjectOf(leaf)));
    case "loadout": {
      const parameters: Node = { uniform: closed(leaf, "uniform") };
      if (leaf.parameters.model_keyword !== undefined) parameters.model_keyword = closed(leaf, "model_keyword");
      return polarity(leaf, pred("loadout", parameters, subjectOf(leaf)));
    }
    case "eligible": {
      const parameters: Node = { to: closed(leaf, "to") };
      if (leaf.parameters.source_ability_id !== undefined) {
        const sourceAbility: Node = { ability_id: closed(leaf, "source_ability_id") };
        if (leaf.parameters.source_ability_owner !== undefined) sourceAbility.owner = closed(leaf, "source_ability_owner");
        parameters.source_ability = sourceAbility;
      }
      if (leaf.parameters.at !== undefined) parameters.at = closed(leaf, "at");
      return polarity(leaf, pred("eligible", parameters, subjectOf(leaf)));
    }
    case "resource": {
      const parameters: Node = { pool: closed(leaf, "pool") };
      if (leaf.parameters.at_least !== undefined) parameters.at_least = closed(leaf, "at_least");
      if (leaf.parameters.at_most !== undefined) parameters.at_most = closed(leaf, "at_most");
      if (leaf.parameters.below_max === true) parameters.below_max = true;
      if (leaf.parameters.source_ability_id !== undefined) {
        const sourceAbility: Node = { ability_id: closed(leaf, "source_ability_id") };
        if (leaf.parameters.source_ability_owner !== undefined) sourceAbility.owner = closed(leaf, "source_ability_owner");
        parameters.source_ability = sourceAbility;
      }
      if (leaf.parameters.at !== undefined) parameters.at = closed(leaf, "at");
      return polarity(leaf, { type: "resource", parameters });
    }
    case "operation-markers": {
      const parameters: Node = {};
      for (const key of ["side", "count_min", "count_max"]) {
        if (leaf.parameters[key] !== undefined) parameters[key] = closed(leaf, key);
      }
      for (const flag of ["friendly_unit_in_same_terrain_area", "no_enemy_in_terrain_area"]) {
        if (leaf.parameters[flag] === true) parameters[flag] = true;
      }
      if (leaf.parameters.within_range_of !== undefined) parameters.within_range_of = closed(leaf, "within_range_of");
      return polarity(leaf, { type: "operation-markers", parameters });
    }
    case "engagement-fronts":
      return polarity(leaf, { type: "engagement-fronts", parameters: { count_min: closed(leaf, "count_min") } });
    case "destroyed-while-on-objective": {
      const parameters: Node = {};
      if (leaf.parameters.count_min !== undefined) parameters.count_min = closed(leaf, "count_min");
      if (leaf.parameters.objective_role !== undefined) parameters.objective_role = closed(leaf, "objective_role");
      for (const flag of ["destroyer_on_objective", "victim_on_objective", "victim_started_turn_on_objective"]) {
        if (leaf.parameters[flag] === true) parameters[flag] = true;
      }
      return polarity(leaf, { type: "destroyed-while-on-objective", parameters });
    }
    case "destroyed-in-tagged-terrain": {
      const parameters: Node = {};
      if (leaf.parameters.count_min !== undefined) parameters.count_min = closed(leaf, "count_min");
      if (leaf.parameters.tag !== undefined) parameters.tag = closed(leaf, "tag");
      if (leaf.parameters.at_start_of_turn === true) parameters.at_start_of_turn = true;
      return polarity(leaf, { type: "destroyed-in-tagged-terrain", parameters });
    }
    default:
      throw new CompileError(`Condition ${leaf.family_id} has no DSL fragment yet.`);
  }
}

/** `subjectOf`'s own subject value, when the leaf names one other than the implicit default. */
function subjectOf(leaf: CompileLeaf): string | undefined {
  return leaf.parameters.subject === undefined ? undefined : (closed(leaf, "subject") as string);
}

/** A DURATION leaf's DSL scope. */
export function duration(leaf: CompileLeaf): string {
  const found = DURATIONS[String(closed(leaf, "endpoint"))];
  if (!found) throw new CompileError(`Duration ${String(leaf.parameters.endpoint)} has no DSL scope yet.`);
  return found;
}

/** Several conditions all holding, or null when there are none; shared with `compile.ts`'s own gating. */
export function allOf(nodes: Node[]): Node | null {
  return nodes.length === 0 ? null : nodes.length === 1 ? nodes[0]! : { operator: "and", operands: nodes };
}

/** A stratagem's target_restrictions from its TARGET leaves; null when the ability has none. */
export function targetRestrictions(parts: readonly CompileLeaf[], eligibility: readonly Node[]): Node | null {
  if (parts.length === 0 && eligibility.length === 0) return null;
  const selectors = parts.filter((leaf) => leaf.family_id === "stratagem-target" || leaf.family_id === "triggering-target");
  const bindings = parts.filter((leaf) => leaf.family_id === "target-binding");
  if (selectors.length !== 1) throw new CompileError(`A stratagem TARGET needs exactly one target leaf; found ${selectors.length}.`);
  if (bindings.length > 1) throw new CompileError("A stratagem TARGET is bound to more than one unit.");
  const selector = selectors[0]!;
  const keywords = selector.parameters.keywords as string[];
  const excluded = (selector.parameters.excluded_keywords as string[] | undefined) ?? [];
  const triggering = selector.family_id === "triggering-target";
  const restrictions: Node = {
    count: triggering ? "one" : selector.parameters.count,
    ...(selector.parameters.count_max !== undefined ? { count_max: selector.parameters.count_max } : {}),
    ...(triggering ? {} : { side: selector.parameters.side }),
    selects: selector.parameters.selects,
    ...(keywords.length ? { [selector.parameters.match === "any" ? "required_keywords_any" : "required_keywords"]: keywords } : {}),
    ...(excluded.length ? { excluded_keywords: excluded } : {}),
  };
  const bound = triggering ? "triggering-unit" : bindings[0]?.parameters.bound_to;
  if (bound) restrictions.bound_to = bound;
  const eligibilityCondition = allOf([...eligibility]);
  if (eligibilityCondition) restrictions.eligibility = eligibilityCondition;
  return restrictions;
}
