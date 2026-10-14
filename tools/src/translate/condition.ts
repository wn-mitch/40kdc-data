/**
 * Humanize an Ability-DSL / scoring `condition` into plain English.
 *
 * Shared by the ability-text CLI, the effect describer (which frames conditions as lead-ins,
 * `conditionLeadIn`) and the scoring-card translator. Output is **ASCII-only** with a fixed
 * clause and parameter order: it is pinned byte-for-byte across the ports by the conformance
 * corpus, so any phrasing change here is a semantic corpus change (bump SPEC_VERSION).
 */

/**
 * Structural view of a condition node: a predicate (`type` + `parameters`) or an
 * and/or/not over predicates.
 */
export interface Condition {
  type?: string;
  operator?: "and" | "or" | "not";
  operands?: Condition[];
  parameters?: Record<string, unknown>;
}

import { describeHappened, destroyedCount } from "./condition-history.js";
import { andList, dekebab, designationPhrase, idLabel, objectivePhrase, ord, orList, type P, rangePhrase, rollWord, statePhrase, str, subjectOf, titleCase, unitFilterPhrase, unitRefPhrase, windowPhrase } from "./condition-refs.js";

export { dekebab, moveKinds, rangePhrase, titleCase, unitFilterPhrase, unitRefPhrase } from "./condition-refs.js";

// ── Predicates ──────────────────────────────────────────────────────────────

function keywordList(p: P): string {
  if (p.chosen_by != null) return `the keyword selected for ${titleCase(str(p.chosen_by))}`;
  if (Array.isArray(p.any_of)) return orList((p.any_of as unknown[]).map((k) => `"${str(k)}"`));
  return andList(((p.all_of as unknown[]) ?? []).map((k) => `"${str(k)}"`));
}

/** Predicates whose phrase negates by turning its verb (see `negatePhrase`). */
const VERB_NEGATED = new Set([
  "strength", "model-count", "wounds", "loadout", "attachment", "has-ability", "controls", "resource", "attack-compare",
  "happened-compare", "operation-markers", "engagement-fronts", "destroyed-while-on-objective", "destroyed-in-tagged-terrain", "army-faction", "battle-size",
]);

/** "X is Y" → "X is not Y", "X has Y" → "X does not have Y", "you control" → "you do not control"; else a leading "not". */
export function negatePhrase(phrase: string): string {
  for (const [from, to] of [
    [/^you control /, "you do not control "], [/^you hold /, "you do not hold "], [/^you destroyed /, "you did not destroy "],
    [/^you newly control /, "you do not newly control "], [/^you are /, "you are not "], [/^your opponent controls /, "your opponent does not control "],
  ] as const) {
    if (from.test(phrase)) return phrase.replace(from, to);
  }
  if (/^1\+ /.test(phrase)) return `no ${phrase.slice(3)}`;
  const m = /^(.*?) (is|was|contains|has) (.*)$/.exec(phrase);
  if (m) {
    const [, who, verb, rest] = m;
    if (verb === "is" || verb === "was") return `${who} ${verb} not ${rest}`;
    if (verb === "contains") return `${who} does not contain ${rest}`;
    return /^(\w+ed|lost|been|fought) /.test(rest!) ? `${who} has not ${rest}` : `${who} does not have ${rest}`;
  }
  return `not ${phrase}`;
}

/** The predicate phrase, optionally negated ("the unit is not below starting strength"). */
export function describePredicate(c: Condition, negated: boolean): string {
  if (negated && VERB_NEGATED.has(String(c.type))) return negatePhrase(describePredicate(c, false));
  if (negated && c.type === "happened" && !["move-ended", "selected", "disembarked"].includes(String(c.parameters?.event))) return negatePhrase(describePredicate(c, false));
  if (negated && c.type === "designated" && typeof c.parameters?.subject === "object" && (c.parameters.subject as P)?.objective) return negatePhrase(describePredicate(c, false));
  const neg = negated ? "not " : "";
  const p = c.parameters ?? {};
  switch (c.type) {
    case "phase-is":
      return str(p.phase) === "command" ? `${neg}during the Command phase` : `${neg}during the ${titleCase(str(p.phase))} phase`;
    case "player-turn-is":
      return `${neg}in ${p.turn === "your-turn" ? "your" : p.turn === "opponent-turn" ? "the opponent's" : "either player's"} turn`;
    case "battle-round": {
      const min = p.min != null ? Number(p.min) : undefined;
      const max = p.max != null ? Number(p.max) : undefined;
      let where: string;
      if (min != null && max != null) where = min === max ? `the ${ord(min)} battle round` : `battle rounds ${min}-${max}`;
      else if (min != null) where = `the ${ord(min)} battle round onward`;
      else if (max != null) where = `the first ${max} battle rounds`;
      else where = "the battle round";
      return `${neg}during ${where}`;
    }
    case "rule-active":
      return `the ${idLabel(p.rule)} is ${negated ? "not " : ""}active`;
    case "has-keyword": {
      const who = p.subject === "defender" ? "the target" : subjectOf(p);
      return `${who} ${negated ? "does not have" : "has"} ${keywordList(p)}`;
    }
    case "owned-by":
      return `${subjectOf(p)} is ${negated ? "not " : ""}${p.owner === "enemy" ? "an enemy unit" : "friendly"}`;
    case "same-unit":
      return `${subjectOf(p)} is ${negated ? "not " : ""}the same unit as ${p.as === "this-unit" ? "this unit" : unitRefPhrase(p.as)}`;
    case "model-profile":
      return `${subjectOf(p, "the model")} is ${negated ? "not " : ""}the ${titleCase(str(p.profile))} model`;
    case "has-ability":
      return `${neg}${subjectOf(p)} has the ${idLabel(p.ability)} ability`;
    case "attachment": {
      const w = (p.with ?? {}) as P;
      const kw = Array.isArray(w.all_of) ? `${(w.all_of as unknown[]).map(str).join(" ")} ` : "";
      if (p.role === "leading") return `${neg}${p.subject === "this-model" || p.subject == null ? "the model" : subjectOf(p)} is leading a ${kw}unit`;
      if (p.role === "led") return `${neg}${subjectOf(p, "this unit")} is being led by ${/^[aeiou]/i.test(kw) ? "an" : "a"} ${kw}model`;
      return `${neg}${subjectOf(p)} is an attached unit`;
    }
    case "strength": {
      const who = subjectOf(p);
      return `${neg}${who} is below ${p.below === "half" ? "half strength" : "starting strength"}`;
    }
    case "model-count": {
      const kw = p.keyword != null ? `${str(p.keyword)} ` : "";
      const range = p.min != null && p.max != null ? `${str(p.min)}-${str(p.max)}` : p.min != null ? `${str(p.min)}+` : `at most ${str(p.max)}`;
      return `${neg}${subjectOf(p)} contains ${range} ${kw}models`;
    }
    case "wounds": {
      const who = p.subject === "this-model" || p.subject == null ? "the model" : subjectOf(p);
      const parts: string[] = [];
      if (p.lost === true) parts.push("has lost wounds");
      const rated = typeof p.remaining_max === "object" && p.remaining_max !== null;
      if (p.remaining_max != null) parts.push(`has ${rated ? "X" : Number(p.remaining_max)} or fewer wounds remaining${rated ? ", X being its rating" : ""}`);
      if (p.damaged === true) parts.push("is Damaged");
      return `${neg}${who} ${andList(parts)}`;
    }
    case "loadout":
      return `${neg}all ${str(p.uniform)} weapons equipped by each ${p.model_keyword ? `${str(p.model_keyword)} ` : ""}model in the unit are the same`;
    case "unit-state": {
      const who = subjectOf(p);
      const withRef = p.with != null ? ` with ${unitRefPhrase(p.with)}` : "";
      if (p.at === "phase-start" || p.at === "turn-start")
        return `${who} ${negated ? "was not" : "was"} ${statePhrase(str(p.state))}${withRef} at the start of the ${p.at === "phase-start" ? "phase" : "turn"}`;
      if (p.state === "fights-first") return `${neg}${who} has Fights First`;
      return `${who} is ${statePhrase(str(p.state), negated)}${withRef}`;
    }
    case "eligible": {
      if (p.to === "be-selected") {
        const source = (p.source_ability as P | undefined)?.ability_id;
        return `${neg}the candidate was eligible for the ${dekebab(str(source))} ability at the end of the opponent's previous turn`;
      }
      const to: Record<string, string> = { shoot: "shoot", "declare-charge": "declare a charge", fight: "fight", "start-action": "start an action" };
      return `${subjectOf(p)} is ${negated ? "not " : ""}eligible to ${to[str(p.to)] ?? dekebab(str(p.to))}`;
    }
    case "happened":
      return describeHappened(p, negated);
    case "happened-compare": {
      const left = p.left as P;
      const right = p.right as P;
      const ge = p.comparison === "greater-or-equal";
      if (right.pool != null) return `${neg}you destroyed at least as many ${destroyedCount(left)} as your ${dekebab(str(right.pool))}`;
      if (right.value != null) return `${neg}you destroyed ${ge ? "at least" : "more than"} ${str(right.value)} ${destroyedCount(left)}`;
      return `${neg}you destroyed ${ge ? "at least as many" : "more"} ${destroyedCount(left)} ${ge ? "as" : "than"} ${destroyedCount(right)}`;
    }
    case "within": {
      const of = p.of;
      const range = p.range;
      const wholly = p.wholly === true ? "wholly " : "";
      if (range === "half-weapon" || range === "weapon")
        return `${p.subject === "defender" ? "the target" : subjectOf(p)} is ${negated ? "not " : ""}within ${rangePhrase(range)}`;
      if (of && typeof of === "object" && (of as P).objective) {
        if (((of as P).objective as P).selection_var != null) return `${subjectOf(p)} is ${negated ? "not " : ""}${wholly}within range of that objective marker`;
        const obj = objectivePhrase((of as P).objective as P, false, "objective marker");
        return `${subjectOf(p)} is ${negated ? "not " : ""}${wholly}within range of ${/^[aeiou]/i.test(obj) ? "an" : "a"} ${obj}`;
      }
      if (of && typeof of === "object" && (of as P).owner === "enemy" && p.subject == null)
        return negated ? `no ${unitFilterPhrase(of as P).replace(/^an? /, "")} is within ${rangePhrase(range)}` : `${unitFilterPhrase(of as P)} is within ${rangePhrase(range)}`;
      const target = of === "battlefield-edge" ? "a battlefield edge" : of === "battlefield-centre" ? "the centre of the battlefield" : of && typeof of === "object" && (of as P).marker ? `${/^[aeiou]/i.test(str((of as P).marker)) ? "an" : "a"} ${dekebab(str((of as P).marker))} marker` : unitRefPhrase(of);
      const who = p.models === "every" ? `every model in ${subjectOf(p)}` : subjectOf(p);
      const at = p.at === "phase-start" ? " at the start of the phase" : "";
      return `${who} ${p.at === "phase-start" ? "was" : "is"} ${negated ? "not " : ""}${wholly}within ${rangePhrase(range)} of ${target}${at}`;
    }
    case "in-region": {
      const r = (p.region ?? {}) as P;
      const wholly = p.wholly === true ? "wholly " : "";
      const who = p.models === "every" ? `every model in ${subjectOf(p)}` : subjectOf(p);
      let where: string;
      if (r.rule_region) where = titleCase(str((r.rule_region as P).region_id));
      else if (r.territory) where = dekebab(str(r.territory));
      else {
        const area = (r.terrain_area ?? {}) as P;
        where = area.footprint != null ? `the ${dekebab(str(area.footprint))} terrain area` : "a terrain area";
        if (area.designated != null) where += ` tagged ${dekebab(str(area.designated))}`;
      }
      return `${who} is ${negated ? "not " : ""}${wholly}within ${where}`;
    }
    case "closest": {
      const who = p.subject === "defender" ? "the target" : subjectOf(p);
      const within = p.range != null ? ` within ${rangePhrase(p.range)}` : "";
      const among = p.among === "eligible-targets" ? "eligible target" : p.among && typeof p.among === "object" ? unitFilterPhrase(p.among as P).replace(/^an? /, "") : "unit";
      // Default (omitted) is the attacker; anything else names who it is closest to.
      const to = p.to != null && p.to !== "attacker" ? ` to ${p.to === "defender" ? "the target" : unitRefPhrase(p.to)}` : "";
      return `${neg}${who} is the closest ${among}${to}${within}`;
    }
    case "controls": {
      if (p.compare === "more-than-opponent") return `${neg}you hold more objectives than the opponent`;
      const who = p.by === "enemy" ? "your opponent controls" : "you control";
      const n = p.count_min ?? 1;
      let s = `${neg}${who} ${str(n)}+ ${objectivePhrase((p.objective ?? {}) as P, true)}`;
      if (p.count_max != null) s += ` (at most ${str(p.count_max)})`;
      return s;
    }
    case "attack-is": {
      const parts: string[] = [];
      if (p.all_target_same_unit === true) return `${neg}all of the unit's ${p.attack_type ? `${str(p.attack_type)} ` : ""}attacks target the same enemy unit`;
      const kind = [p.shooting_type ? `${dekebab(str(p.shooting_type))} shooting` : "", p.fight_type ? `${dekebab(str(p.fight_type))} fight` : "", p.attack_type ? str(p.attack_type) : ""].filter(Boolean).join(" ");
      parts.push(`for ${kind ? `${kind} ` : ""}attacks`);
      if (p.weapon_keyword) parts.push(`made with [${str(p.weapon_keyword).toUpperCase()}] weapons`);
      if (p.weapon_name) parts.push(`made with ${str(p.weapon_name)}`);
      return `${neg}${parts.join(" ")}`;
    }
    case "attack-compare": {
      const side = (o: P): string => {
        if (o.value != null) return str(o.value);
        const whose = o.of === "defender" ? "the target's" : "the attack's";
        return `${whose} ${o.reduce === "max" ? "highest " : o.reduce === "min" ? "lowest " : ""}${str(o.stat)}`;
      };
      return `${neg}${side(p.left as P)} is ${dekebab(str(p.comparison))} ${side(p.right as P)}`;
    }
    case "roll-result":
      return `${neg}the triggering ${rollWord(p.roll)} roll ${p.result === "success" ? "succeeded" : `was a ${str(p.result)}`}`;
    case "visible": {
      const who = p.subject === "defender" ? "the target" : subjectOf(p);
      const to = p.to == null || p.to === "attacker" ? "the attacking model" : unitRefPhrase(p.to);
      if (p.blocked_by != null)
        return `${who} is ${negated ? "" : "not "}${p.fully === true ? "fully " : ""}visible to ${to} because of ${unitRefPhrase(p.blocked_by, "this unit").replace(/^the unit$/, "this unit")}`;
      return `${who} is ${negated ? "not " : ""}${p.fully === true ? "fully " : ""}visible to ${to}`;
    }
    case "designated": {
      const s = p.subject;
      if (s && typeof s === "object" && (s as P).objective) {
        let out = `${neg}${str(p.count_min ?? 1)}+ ${objectivePhrase((s as P).objective as P, true)} tagged ${dekebab(str(p.tag))}`;
        if (p.count_max != null) out += ` (at most ${str(p.count_max)})`;
        return out;
      }
      const by = p.by != null ? ` by ${unitRefPhrase(p.by, "this unit").replace(/^the unit$/, "this unit")}` : "";
      return `${subjectOf(p)} is ${negated ? "not " : ""}${designationPhrase(str(p.tag))}${by}`;
    }
    case "resource": {
      if (p.below_max === true) {
        const source = (p.source_ability as P | undefined)?.ability_id;
        return `${neg}the ${dekebab(str(source))} ability had unused selection capacity at the end of the opponent's previous turn`;
      }
      const amount = p.at_least != null ? `${str(p.at_least)}+` : `at most ${str(p.at_most)}`;
      return `${neg}the unit has ${amount} ${dekebab(str(p.pool))}`;
    }
    // ── Mission-card predicates ───────────────────────────────────────────
    case "operation-markers": {
      const side = p.side != null ? `${str(p.side)} ` : "";
      const min = typeof p.count_min === "number" ? p.count_min : undefined;
      const max = typeof p.count_max === "number" ? p.count_max : undefined;
      let s: string;
      if (max === 0) s = `no ${side}operation markers on the battlefield`;
      else if (min != null && max != null && min === max) s = `exactly ${min} ${side}operation marker${min === 1 ? "" : "s"} on the battlefield`;
      else s = `${str(min ?? 1)}+ ${side}operation markers on the battlefield`;
      if (p.within_range_of != null) s += ` within range of ${dekebab(str(p.within_range_of))}`;
      if (p.friendly_unit_in_same_terrain_area) s += " with a friendly unit in the same terrain area";
      if (p.no_enemy_in_terrain_area) s += " and no enemy units in that terrain area";
      return `${neg}${s}`;
    }
    case "engagement-fronts":
      return `${neg}you are engaged on ${str(p.count_min ?? 1)}+ fronts`;
    case "destroyed-while-on-objective": {
      const obj = p.objective_role ? `a ${dekebab(str(p.objective_role))} objective` : "an objective";
      let s = `${neg}${str(p.count_min ?? 1)}+ enemy units destroyed`;
      if (p.destroyer_on_objective) s += ` by a unit on ${obj}`;
      if (p.victim_on_objective) s += ` while on ${obj}`;
      if (p.victim_started_turn_on_objective) s += ` that started the turn on ${obj}`;
      return s;
    }
    case "destroyed-in-tagged-terrain": {
      const where = p.at_start_of_turn ? "that started the turn in" : "while in";
      const terrain = p.tag != null ? `${dekebab(str(p.tag))} terrain` : "a terrain area";
      return `${neg}${str(p.count_min ?? 1)}+ enemy units destroyed ${where} ${terrain}`;
    }
    case "battle-size":
      return `the battle size is ${negated ? "not " : ""}${titleCase(str(p.size))}`;
    case "army-faction":
      return `your Army Faction is ${negated ? "not " : ""}${str(p.faction).replace(/-/g, " ").toUpperCase()}`;
    case "moved-over": {
      const who = subjectOf(p, "the unit");
      const window = p.window == null || p.window === "event" ? "during that move" : windowPhrase(p.window);
      return `${who} ${negated ? "was not" : "was"} moved over by ${unitRefPhrase(p.by, "this model")} ${window}`;
    }
    case "guided":
      return `${subjectOf(p, "the unit")} is ${negated ? "not " : ""}${designationPhrase("guided")}`;
    default:
      return `${neg}${dekebab(c.type ?? "unknown")}`;
  }
}

/** A condition as a predicate phrase ("the unit is below starting strength and during your turn"). */
export function describeCondition(c: Condition): string {
  if (c.operator === "and" && c.operands) {
    return c.operands.map((o) => (o.operator === "or" ? `(${describeCondition(o)})` : describeCondition(o))).join(" and ");
  }
  if (c.operator === "or" && c.operands) {
    return c.operands.map((o) => (o.operator === "and" ? `(${describeCondition(o)})` : describeCondition(o))).join(" or ");
  }
  if (c.operator === "not" && c.operands) {
    const only = c.operands[0];
    if (c.operands.length === 1 && only && !only.operator) return describePredicate(only, true);
    // not(not(X)) reads as X, never "not (… is not …)".
    if (c.operands.length === 1 && only?.operator === "not" && only.operands?.length === 1) return describeCondition(only.operands[0]!);
    return `not (${c.operands.map(describeCondition).join(", ")})`;
  }
  return describePredicate(c, false);
}
