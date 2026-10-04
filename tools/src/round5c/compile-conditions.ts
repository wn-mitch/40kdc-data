/**
 * Condition and trigger DSL fragments, split out of `compile-fragments.ts` (batch 6) so that
 * file and `compile.ts` stay under the line ceiling. `compile-fragments.ts` keeps the leaf type,
 * `CompileError`, and the EFFECT fragment (`effect()`), which still needs `closed()`; everything
 * here is CONDITION- and EVENT-role composition, used only from `compile.ts`.
 */

import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { dslUnitFilter } from "./compile-unit-filters.js";
import { abilityChecks, stateCheck } from "./compile-wrappers.js";
import { DESIGNATION_IDS } from "../translate/designations.js";

type Node = Record<string, unknown>;

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
  "declared-charge-this-phase": ["targets-selected", { kind: "charge" }, "phase"],
  "fell-back-this-turn": ["move-ended", { move_types: ["fall-back"] }, "turn"],
  "disembarked-this-turn": ["disembarked", {}, "turn"],
  "made-ingress-move-this-turn": ["move-ended", { move_types: ["ingress"] }, "turn"],
  "set-up-this-turn": ["set-up", {}, "turn"],
  // Version 12: "whose attacks have been resolved this phase".
  "resolved-attacks-this-phase": ["attacks-resolved", {}, "phase"],
};

/**
 * Version 8 history, whose subject is not the unit the event happens to: the unit that destroyed
 * enemy units (the DSL's filter.by), or the unit whose models the triggering attacks destroyed.
 */
const HISTORY: Record<string, (subject: string | undefined) => Node> = {
  "destroyed-enemy-unit-this-phase": (subject) => ({ event: "destroyed", object: { owner: "enemy" }, filter: { by: subject ?? "this-unit" }, window: "phase" }),
  "destroyed-enemy-unit-this-turn": (subject) => ({ event: "destroyed", object: { owner: "enemy" }, filter: { by: subject ?? "this-unit" }, window: "turn" }),
  "set-up-by-deep-strike-this-phase": (subject) => ({ ...(subject ? { subject } : {}), event: "set-up", filter: { from: "deep-strike" }, window: "phase" }),
  "set-up-by-deep-strike-this-turn": (subject) => ({ ...(subject ? { subject } : {}), event: "set-up", filter: { from: "deep-strike" }, window: "turn" }),
  // Version 9: "that disembarked from this TRANSPORT this turn"; the Transport is this unit.
  // Version 10: "that arrived from Reserves this turn"; Reserves are Strategic Reserves.
  "set-up-from-reserves-this-phase": (subject) => ({ ...(subject ? { subject } : {}), event: "set-up", filter: { from: "strategic-reserves" }, window: "phase" }),
  "set-up-from-reserves-this-turn": (subject) => ({ ...(subject ? { subject } : {}), event: "set-up", filter: { from: "strategic-reserves" }, window: "turn" }),
  "disembarked-from-this-transport-this-turn": (subject) => ({ ...(subject ? { subject } : {}), event: "disembarked", filter: { transport: "this-unit" }, window: "turn" }),
  "lost-models-to-triggering-attacks": (subject) => ({
    event: "model-destroyed", object: !subject || subject === "this-unit" ? "model-in-this-unit" : { level: "model", member_of: subject },
    filter: { by: "event-subject" }, window: "event",
  }),
};

/** A unit-state leaf's states that are not core-rules unit states. */
const STRENGTH_STATES: Record<string, string> = { "below-starting-strength": "starting", "below-half-strength": "half" };

/** Marks as the designations an effect applies, uppercase as the rules print them. */
const MARK_TAGS: Record<string, string> = {
  "oath-of-moment": "OATH OF MOMENT TARGET", afflicted: "AFFLICTED", spotted: "SPOTTED", hidden: "HIDDEN", marked: "MARKED",
  "riled-up": "riled-up",
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

/** The condition an attack leaf adds: only melee or only ranged attacks. */
export function attackTypeCondition(leaf: CompileLeaf): Node | null {
  const type = closed(leaf, "attack_type");
  return type === "melee" || type === "ranged" || type === "psychic" ? { type: "attack-is", parameters: { attack_type: type } } : null;
}

/**
 * "One or more (other) friendly **K** units" as the DSL's unit-filter: every keyword, the side,
 * and, for "other", not the subject itself.
 */
function matchingUnit(leaf: CompileLeaf, subject: string | undefined): Node {
  return {
    owner: closed(leaf, "of_side"), ...(leaf.parameters.of_keywords !== undefined ? { all_of: closed(leaf, "of_keywords") } : {}),
    ...(leaf.parameters.of_other === true ? { excluding: subject ?? "this-unit" } : {}),
  };
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

/** The unit-filter right after a distance or engagement (compile-unit-filters.ts), as its other unit. */
function followingFilter(leaf: CompileLeaf): Node {
  const filter = leaf.parameters.following_filter as Node | undefined;
  if (filter === undefined) throw new CompileError(`${leaf.family_id} measures to the unit-filter after it, but no unit-filter follows it in its clause.`);
  return structuredClone(filter);
}

/** Stands in for a folded filter's units while a condition lowers; replaced by the filter itself. */
const FILTER_STAND_IN = "__filtered-units__";

function withFilter(node: unknown, filter: Node): unknown {
  if (node === FILTER_STAND_IN) return structuredClone(filter);
  if (Array.isArray(node)) return node.map((item) => withFilter(item, filter));
  if (node !== null && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, withFilter(value, filter)]));
  return node;
}

export function condition(leaf: CompileLeaf): Node {
  // "While an enemy unit is within Engagement Range of this unit": the units of the folded filter
  // (compile-unit-filters.ts), as the DSL's "any unit that …" filter in place of a fixed role.
  if (Object.values(leaf.parameters).includes("filtered-units")) {
    const filter = leaf.parameters.subject_filter as Node | undefined;
    if (filter === undefined) throw new CompileError(`${leaf.family_id} names the units of a unit-filter, but none sits right before it.`);
    const { subject_filter: _filter, ...rest } = leaf.parameters;
    const parameters = Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, value === "filtered-units" ? FILTER_STAND_IN : value]));
    return withFilter(condition({ ...leaf, parameters }), filter) as Node;
  }
  // Alternatives folded by compile-alternative-conditions.ts: any one of them, each its own conditions together.
  if (leaf.family_id === "__any-of") {
    const alternatives = leaf.parameters.alternatives as CompileLeaf[][];
    return anyOf(alternatives.map((conditions) => {
      const nodes = conditions.map(condition);
      return nodes.length === 1 ? nodes[0]! : { operator: "and", operands: nodes };
    }));
  }
  const target = closed(leaf, "subject") === "target";
  const who = target ? "defender" : undefined;
  switch (leaf.family_id) {
    case "leading-unit": {
      // Version 5: "unless it is leading a unit" negates; a led unit is the bodyguard's view.
      if (leaf.parameters.negated === true) return negate(condition({ ...leaf, parameters: { ...leaf.parameters, negated: false } }));
      if (leaf.parameters.attachment === "led") {
        const leaders = leaf.parameters.leader_keywords === undefined ? {} : { with: { all_of: closed(leaf, "leader_keywords") } };
        const subject = String(closed(leaf, "subject"));
        return pred("attachment", { role: "led", ...leaders }, subject === "this-model" || subject === "bearers-unit" ? "this-unit" : widenedWho(subject));
      }
      // A Leader is a model, so this model, this unit and the bearer's unit leading all say the
      // Leader model is leading. Version 1 leaves only ever meant leading.
      const attachment = leaf.family_version >= 2 ? closed(leaf, "attachment") : "leading";
      // Version 4: the unit it is attached to has these keywords.
      const attachedTo = leaf.parameters.attached_to_keywords === undefined ? {} : { with: { all_of: closed(leaf, "attached_to_keywords") } };
      // Version 5: another model or unit ("that CHARACTER model is leading a unit").
      const named = String(closed(leaf, "subject"));
      if (!["this-model", "this-unit", "bearers-unit"].includes(named)) {
        if (attachment === "supporting") throw new CompileError("leading-unit supporting for another unit has no DSL condition yet.");
        return pred("attachment", { role: attachment === "leading" ? "leading" : "attached", ...attachedTo }, widenedWho(named));
      }
      if (attachment === "leading") return pred("attachment", { role: "leading", ...attachedTo }, "this-model");
      // Attached in either role: the model, or the unit (the bearer's unit is this unit), is part of an attached unit.
      if (attachment === "any") return pred("attachment", { role: "attached", ...attachedTo }, closed(leaf, "subject") === "this-model" ? "this-model" : "this-unit");
      if (leaf.parameters.attached_to_keywords !== undefined) throw new CompileError("leading-unit supporting a named unit has no DSL condition yet.");
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
        if (leaf.parameters.at !== undefined && (STRENGTH_STATES[state] || state === "carrying-units")) throw new CompileError(`unit-state ${state} has no DSL form for an earlier point (at).`);
        if (STRENGTH_STATES[state]) return pred("strength", { below: STRENGTH_STATES[state] }, subject);
        // Version 7: some unit is embarked within the subject (a Transport carries units).
        if (state === "carrying-units") return { type: "unit-state", parameters: { subject: { embarked_in: subject ?? "this-unit" }, state: "embarked" } };
        // Version 5: engaged with one named unit, the DSL's `with`.
        // Version 10: the state as it was at the start of the phase or turn.
        const at = leaf.parameters.at === undefined ? {} : { at: closed(leaf, "at") };
        if (leaf.parameters.with === "following-filter") return pred("unit-state", { state, with: followingFilter(leaf), ...at }, subject);
        // The DSL's `with` absent means engaged with any unit, so this unit is named, not defaulted.
        if (leaf.parameters.with !== undefined) return pred("unit-state", { state, with: widenedWho(closed(leaf, "with")) ?? "this-unit", ...at }, subject);
        // Version 8: "in Reserves" is Strategic Reserves in the rules; the DSL has only that state.
        return pred("unit-state", { state: state === "in-reserves" ? "in-strategic-reserves" : state, ...at }, subject);
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
      // Version 3 (batch 6) widens subject beyond this-unit/target.
      const subject = leaf.family_version >= 3 ? widenedWho(closed(leaf, "subject")) : who;
      // Version 4 names several activities: any of them, and negated none of them.
      const activities = leaf.family_version >= 4 ? closed(leaf, "activities") as string[] : [String(closed(leaf, "activity"))];
      return polarity(leaf, anyOf(activities.map((activity) => {
        const history = HISTORY[activity];
        if (history) return { type: "happened", parameters: history(subject) };
        const [event, filter, window] = ACTIVITIES[activity]!;
        return pred("happened", { event, ...(Object.keys(filter).length ? { filter: structuredClone(filter) } : {}), window }, subject);
      })));
    }
    case "hit-by-attacks":
      // "Hit by those attacks": a successful Hit roll against the subject by whoever made the
      // attacks of the ability's moment ("after this model has shot"), during that moment.
      return { type: "happened", parameters: { event: "after-roll", subject: "event-subject", object: widenedWho(closed(leaf, "subject")) ?? "this-unit", filter: { roll: "hit", result: "success" }, window: "event" } };
    case "unit-filter-target": {
      // A who folded onto an attack's target ("that targets a VEHICLE unit"): each of its fields, said of the defender.
      const filter = dslUnitFilter(leaf) as { owner: string; all_of?: string[]; any_of?: string[]; none_of?: string[]; state?: string; excluding?: string; visible?: true };
      if (filter.visible) throw new CompileError("An attack's target is already visible to the attacker; drop visible from its unit-filter.");
      const checks: Node[] = [
        ...(filter.all_of ? [pred("has-keyword", { all_of: filter.all_of }, "defender")] : []),
        ...(filter.any_of ? [pred("has-keyword", { any_of: filter.any_of }, "defender")] : []),
        ...(filter.none_of ?? []).map((keyword) => negate(pred("has-keyword", { all_of: [keyword] }, "defender"))),
        ...(filter.state ? [pred("unit-state", { state: filter.state }, "defender")] : []),
        ...(filter.excluding ? [negate(pred("same-unit", { as: filter.excluding }, "defender"))] : []),
      ];
      if (checks.length === 0) throw new CompileError("An attack's target unit-filter that names only a side says nothing the attack does not.");
      return checks.length === 1 ? checks[0]! : { operator: "and", operands: checks };
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
        // Version 4 names what the distance is measured from; earlier versions always meant the
        // distance from this unit to the attack's target, as the authored data measures it.
        const node = leaf.parameters.of === "marker"
          ? pred("within", { of: { marker: closed(leaf, "of_marker") }, range: { inches: closed(leaf, "inches") }, ...(leaf.parameters.wholly === true ? { wholly: true } : {}) }, subject)
          : leaf.parameters.of === "battlefield-edge"
          ? pred("within", { of: "battlefield-edge", range: { inches: closed(leaf, "inches") }, ...(leaf.parameters.wholly === true ? { wholly: true } : {}) }, subject)
          : leaf.parameters.of === "following-filter"
          ? pred("within", { of: followingFilter(leaf), range: { inches: closed(leaf, "inches") }, ...(leaf.parameters.wholly === true ? { wholly: true } : {}) }, subject)
          : leaf.parameters.of === "matching-unit"
          ? pred("within", { of: matchingUnit(leaf, subject), range: { inches: closed(leaf, "inches") }, ...(leaf.parameters.wholly === true ? { wholly: true } : {}) }, subject)
          : leaf.parameters.of !== undefined
          ? pred("within", { of: widenedWho(closed(leaf, "of")) ?? "this-unit", range: { inches: closed(leaf, "inches") }, ...(leaf.parameters.wholly === true ? { wholly: true } : {}) }, subject)
          : pred("within", { of: "defender", range: { inches: closed(leaf, "inches") } });
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
      // Version 2: any one of several listed rounds.
      if (Array.isArray(leaf.parameters.rounds)) return anyOf((leaf.parameters.rounds as number[]).map((round) => ({ type: "battle-round", parameters: { min: round, max: round } })));
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
      // Version 2: "in any phase" names no phase; compile.ts drops it when no turn is named either.
      if (leaf.parameters.phase !== undefined && leaf.parameters.phase !== "any") operands.push({ type: "phase-is", parameters: { phase: closed(leaf, "phase") } });
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
/**
 * A non-Stratagem ability's own phase window as a gate on the whole ability: any one listed
 * phase, in the turn it belongs to (a phase under `either_phases` holds in both players' turns).
 * The same nodes phase-window emits; a Stratagem's use-window is checked against core instead.
 */
export function activationWindowCondition(parameters: Record<string, unknown>): Node {
  const window = (phases: unknown, turn: "your-turn" | "opponent-turn" | null): Node[] => (phases as string[]).map((phase) => turn
    ? { operator: "and", operands: [{ type: "phase-is", parameters: { phase } }, { type: "player-turn-is", parameters: { turn } }] }
    : { type: "phase-is", parameters: { phase } });
  const nodes = [
    ...window(parameters.your_phases, "your-turn"),
    ...window(parameters.opponent_phases, "opponent-turn"),
    ...window(parameters.either_phases, null),
  ];
  if (nodes.length === 0) throw new CompileError("activation-window must name at least one phase.");
  return nodes.length === 1 ? nodes[0]! : { operator: "or", operands: nodes };
}

export function allOf(nodes: Node[]): Node | null {
  return nodes.length === 0 ? null : nodes.length === 1 ? nodes[0]! : { operator: "and", operands: nodes };
}

/** A stratagem's target_restrictions from its TARGET leaves; null when the ability has none. */
export function targetRestrictions(parts: readonly CompileLeaf[], eligibility: readonly Node[]): Node | null {
  if (parts.length === 0 && eligibility.length === 0) return null;
  const selectors = parts.filter((leaf) => leaf.family_id === "stratagem-target" || leaf.family_id === "triggering-target");
  const bindings = parts.filter((leaf) => leaf.family_id === "target-binding");
  // The DSL holds several named targets, but an effect leaf cannot yet say which one it applies
  // to ("your unit" after two targets), so a second target refuses until leaves can name it.
  if (selectors.length > 1) throw new CompileError(`A stratagem TARGET names ${selectors.length} targets; no effect leaf can yet say which target it applies to, so the second target has no binding.`);
  if (bindings.length > 1) throw new CompileError("A stratagem TARGET is bound to more than one unit.");
  // "That Frenzied Reavers Jakhals unit." with no selector of its own: the target is the one unit the
  // binding names (the triggering or the attacked unit); the WHEN's own filter says which units qualify.
  if (selectors.length === 0 && bindings.length === 1) {
    const restrictions: Node = { count: "one", selects: "unit", bound_to: bindings[0]!.parameters.bound_to };
    const eligibilityCondition = allOf([...eligibility]);
    if (eligibilityCondition) restrictions.eligibility = eligibilityCondition;
    return restrictions;
  }
  if (selectors.length !== 1) throw new CompileError(`A stratagem TARGET needs exactly one target leaf; found ${selectors.length}.`);
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
  // A folded unit-filter's checks beyond all-of keywords (compile-unit-filters.ts) go to eligibility.
  const filter = (selector.parameters.filter ?? {}) as { any_keywords?: string[]; excluded_all_keywords?: string[]; excluded_abilities?: string[]; states?: string[]; other?: boolean; visible?: boolean };
  if (filter.visible) throw new CompileError("A Stratagem TARGET has no visibility requirement field.");
  const filtered: Node[] = [
    ...(filter.any_keywords?.length ? [{ type: "has-keyword", parameters: { any_of: filter.any_keywords } }] : []),
    // Version 3: "That ADEPTUS ASTARTES INFANTRY/MOUNTED unit" also has one of these.
    ...(Array.isArray(selector.parameters.any_keywords) ? [{ type: "has-keyword", parameters: { any_of: selector.parameters.any_keywords } }] : []),
    ...(filter.states ?? []).map(stateCheck),
    ...(filter.excluded_all_keywords?.length ? [negate({ type: "has-keyword", parameters: { all_of: filter.excluded_all_keywords } })] : []),
    ...abilityChecks(filter.excluded_abilities),
    ...(filter.other === true ? [negate({ type: "same-unit", parameters: { as: "ability-unit" } })] : []),
  ];
  const eligibilityCondition = allOf([...filtered, ...eligibility]);
  if (eligibilityCondition) restrictions.eligibility = eligibilityCondition;
  return restrictions;
}
