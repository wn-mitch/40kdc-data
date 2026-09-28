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
};

export const DURATIONS: Record<string, string> = {
  "end-of-phase": "phase", "end-of-turn": "turn", "end-of-battle-round": "battle-round", "end-of-battle": "battle",
  "start-of-next-turn": "until-start-next-turn", "start-of-next-command-phase": "until-next-command-phase",
  "start-of-next-movement-phase": "until-next-movement-phase", "start-of-next-battle-round": "until-next-battle-round",
};

const RESOURCE_POOLS: Record<string, string> = {
  "miracle-dice": "miracle-dice-pool", "fate-dice": "fate-dice-pool", "bloodshed-point": "bloodshed-point",
};

/** Whose models an effect changes. "The bearer" is this-model; leaves still spelling it bearer are on a retired version. */
const SUBJECT_TARGETS: Record<string, string> = { "this-unit": "this-unit", "this-model": "this-model" };

/** Marks as the designations an effect applies, uppercase as the rules print them. */
const MARK_TAGS: Record<string, string> = {
  "oath-of-moment": "OATH OF MOMENT TARGET", afflicted: "AFFLICTED", spotted: "SPOTTED", hidden: "HIDDEN", marked: "MARKED",
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

const MORTAL_TARGETS: Record<string, string> = { target: "defender", "that-unit": "selected-unit", "this-unit": "this-unit", "this-model": "this-model" };

/** A unit-state leaf's states that are not core-rules unit states. */
const STRENGTH_STATES: Record<string, string> = { "below-starting-strength": "starting", "below-half-strength": "half" };

/** A predicate with its subject: the target of the attack, or (by default) the ability's unit. */
const pred = (type: string, parameters: Node, subject?: string): Node => ({ type, parameters: subject ? { subject, ...parameters } : parameters });

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
  return type === "melee" || type === "ranged" ? { type: "attack-is", parameters: { attack_type: type } } : null;
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
    case "unit-state":
      return polarity(leaf, anyOf((leaf.parameters.states as string[]).map((state) => {
        if (STRENGTH_STATES[state]) return pred("strength", { below: STRENGTH_STATES[state] }, who);
        const subject = state === "on-battlefield" && !target && leaf.parameters.subject === "this-model" ? "this-model" : who;
        return pred("unit-state", { state }, subject);
      })));
    case "unit-keyword": {
      const keywords = leaf.parameters.keywords as string[];
      // "not a MONSTER or VEHICLE" excludes both, so each keyword carries the negation.
      if (leaf.parameters.negated === true) {
        const each = keywords.map((keyword) => negate(pred("has-keyword", { all_of: [keyword] }, who)));
        return each.length === 1 ? each[0]! : { operator: "and", operands: each };
      }
      return pred("has-keyword", keywords.length === 1 ? { all_of: keywords } : { any_of: keywords }, who);
    }
    case "unit-activity": {
      const [event, filter, window] = ACTIVITIES[String(closed(leaf, "activity"))]!;
      return polarity(leaf, pred("happened", { event, filter: structuredClone(filter), window }, who));
    }
    case "unit-mark":
      return polarity(leaf, pred("designated", { tag: MARK_TAGS[String(closed(leaf, "mark"))] }, who));
    case "unit-position": {
      const kind = closed(leaf, "kind");
      if (kind === "closest-eligible") return polarity(leaf, pred("closest", { among: "eligible-targets" }, "defender"));
      if (kind === "within" || kind === "beyond") {
        // Distance from the attacking model to its target, as the authored data measures it.
        const node = pred("within", { of: "defender", range: { inches: closed(leaf, "inches") } });
        return polarity(leaf, kind === "beyond" ? negate(node) : node);
      }
      const controlled = closed(leaf, "controlled_by");
      const objective = controlled === "you" ? { controlled_by: "friendly" } : controlled === "opponent" ? { controlled_by: "enemy" } : {};
      return polarity(leaf, pred("within", { of: { objective }, range: "objective-control" }, who));
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
  const target = (subject: unknown) => {
    const found = SUBJECT_TARGETS[String(subject)];
    if (!found) throw new CompileError(`${leaf.family_id}@${leaf.family_version} subject ${JSON.stringify(subject)} has no DSL target; move the leaf to its current version.`);
    return context.attached ? "this-unit" : found;
  };
  const rollTarget = (roll: unknown) => context.incoming && ATTACKER_ROLLS.has(String(roll)) ? "attacker" : context.attacker ?? "this-unit";
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
      return { type: "roll-result", target: rollTarget(roll), modifier: { roll, critical_on: value } };
    }
    case "resource-action": {
      const resource = closed(leaf, "resource");
      const amount = closed(leaf, "amount");
      if (closed(leaf, "operation") !== "gain") throw new CompileError(`Only resource gains compile; ${String(leaf.parameters.operation)} has no DSL fragment yet.`);
      if (resource === "command-point") return { type: "cp-gain", target: "this-model", modifier: { amount } };
      const pool = RESOURCE_POOLS[String(resource)];
      if (!pool) throw new CompileError(`Resource ${String(resource)} has no DSL pool yet.`);
      return { type: "resource-gain", target: "this-model", modifier: { pool, amount } };
    }
    case "characteristic-set":
      return { type: "stat-modifier", target: target(leaf.parameters.subject), modifier: { stat: closed(leaf, "characteristic"), operation: "set", value: closed(leaf, "value") } };
    case "weapon-ability-grant": {
      const weaponType = closed(leaf, "weapon_type");
      return {
        type: "weapon-ability-grant", target: target(leaf.parameters.subject),
        modifier: { abilities: [closed(leaf, "keyword")], ...(weaponType && weaponType !== "all" ? { weapon_type: weaponType } : {}) },
      };
    }
    case "feel-no-pain": {
      const against = closed(leaf, "against");
      return { type: "feel-no-pain", target: target(leaf.parameters.subject), modifier: { threshold: closed(leaf, "threshold"), ...(against !== "all" ? { against } : {}) } };
    }
    case "invulnerable-save":
      return { type: "invulnerable-save", target: target(leaf.parameters.subject), modifier: { invuln_sv: closed(leaf, "threshold") } };
    case "fights-first":
      return { type: "ability-grant", target: target(leaf.parameters.subject), modifier: { ability: "fights-first" } };
    case "sticky-objective":
      return { type: "objective-sticky", target: "this-unit" };
    case "no-advance-roll":
      return { type: "move-modifier", target: target(leaf.parameters.subject), modifier: { advance: "fixed-6" } };
    case "mortal-wounds": {
      const count = String(closed(leaf, "count"));
      return { type: "mortal-wounds", target: MORTAL_TARGETS[String(closed(leaf, "recipient"))], modifier: { count: /^\d+$/u.test(count) ? Number(count) : count } };
    }
    case "fight-on-death":
      // The schema pairs each resolution with its removal; a roll or eligibility is folded in by compile-dice.
      return closed(leaf, "timing") === "when-its-unit-fights"
        ? { type: "act-on-death", target: "event-object", modifier: { act: "fight", resolution: "when-unit-fights", removal: "after-unit-fights-or-phase-end" } }
        : { type: "act-on-death", target: "event-object", modifier: { act: "fight", resolution: "after-attacking-unit-finishes", removal: "after-destroyed-model-fights" } };
    case "act-after-move": {
      // Shooting after Advancing is [ASSAULT] on every ranged weapon (as Devastator Doctrine is
      // written); every other act is a permission after that move.
      const owner = target(leaf.parameters.subject);
      const acts = leaf.parameters.acts as string[];
      const steps: Record<string, unknown>[] = [];
      for (const move of leaf.parameters.moves as string[]) {
        for (const act of acts) {
          steps.push(move === "advance" && act === "shoot"
            ? { type: "weapon-ability-grant", target: owner, modifier: { abilities: ["Assault"], weapon_type: "ranged" } }
            : { type: "permission", target: owner, modifier: { activity: act === "charge" ? "declare-charge" : act, allow: true, after: [move] } });
        }
      }
      return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
    }
    case "regain-wounds": {
      const amount = String(closed(leaf, "amount"));
      return { type: "heal", target: target(leaf.parameters.subject), modifier: { amount: /^\d+$/u.test(amount) ? Number(amount) : amount } };
    }
    case "characteristic-modifier": {
      if (leaf.family_version < 2) {
        return { type: "stat-modifier", target: target(leaf.parameters.subject), modifier: { stat: closed(leaf, "characteristic"), operation: closed(leaf, "operation"), value: closed(leaf, "value") } };
      }
      // The attack being made belongs to whoever attacks: the attacker when it targets this unit.
      const owner = leaf.parameters.subject === "attack" ? (context.incoming ? "attacker" : context.attacker ?? "this-unit") : target(leaf.parameters.subject);
      const weaponType = closed(leaf, "weapon_type");
      const steps = (leaf.parameters.characteristics as string[]).map((stat) => ({
        type: "stat-modifier", target: owner,
        modifier: { stat, operation: closed(leaf, "operation"), value: closed(leaf, "value"), ...(weaponType !== "all" ? { weapon_type: weaponType } : {}) },
      }));
      return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
    }
    default:
      throw new CompileError(`Effect ${leaf.family_id} has no DSL fragment yet.`);
  }
}
