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
import { namedEquipmentPhrase } from "./condition-equipment.js";
import { andList, countPhrase, dekebab, designationPhrase, idLabel, keywordList, keywordNoun, objectivePhrase, ord, orList, type P, placeRefPhrase, rangePhrase, rollWord, ruleRefPhrase, statePhrase, str, subjectOf, titleCase, unitFilterPhrase, unitRefPhrase, windowPhrase } from "./condition-refs.js";
import { bracketKeyword, weaponNoun } from "./effect-words.js";

export { dekebab, moveKinds, rangePhrase, titleCase, unitFilterPhrase, unitRefPhrase } from "./condition-refs.js";

// ── Predicates ──────────────────────────────────────────────────────────────


/** Predicates whose phrase negates by turning its verb (see `negatePhrase`). */
const VERB_NEGATED = new Set([
  "strength", "model-count", "wounds", "loadout", "equipped-weapon-count", "attachment", "controls", "resource", "attack-compare",
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

/** The Transport an embark-within names; the candidate being checked (this-unit) reads "that Transport". */
const transportPhrase = (ref: unknown): string => ref === "this-unit" ? "that Transport" : unitRefPhrase(ref, "that Transport");

/** The predicate phrase, optionally negated ("the unit is not below starting strength"). */
export function describePredicate(c: Condition, negated: boolean): string {
  if (negated && c.type === "controls" && ["count", "compare", "proportion"].filter((key) => c.parameters?.[key] != null).length > 1) return `not (${describePredicate(c, false)})`;
  if (negated && VERB_NEGATED.has(String(c.type))) return negatePhrase(describePredicate(c, false));
  if (negated && c.type === "happened" && !["move-ended", "selected", "disembarked"].includes(String(c.parameters?.event))) return negatePhrase(describePredicate(c, false));
  if (negated && c.type === "designated" && typeof c.parameters?.subject === "object" && (c.parameters.subject as P)?.objective) return negatePhrase(describePredicate(c, false));
  const neg = negated ? "not " : "";
  const p = c.parameters ?? {};
  switch (c.type) {
    case "phase-is":
      return str(p.phase) === "command" ? `${neg}during the Command phase` : `${neg}during the ${titleCase(str(p.phase))} phase`;
    case "deployment-window":
      return `${neg}during deployment`;
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
    case "matches":
      return describeMatches(p, negated);
    case "rule-active":
      return `the ${ruleRefPhrase(p.rule)} is ${negated ? "not " : ""}active`;
    case "has-keyword": {
      const who = p.subject === "defender" ? "the target" : subjectOf(p);
      return `${who} ${negated ? "does not have" : "has"} the keyword selected for ${titleCase(str(p.chosen_by))}`;
    }
    case "same-unit":
      return `${subjectOf(p)} is ${negated ? "not " : ""}the same unit as ${p.as === "this-unit" ? "this unit" : unitRefPhrase(p.as)}`;
    case "model-profile":
      return `${subjectOf(p, "the model")} is ${negated ? "not " : ""}the ${titleCase(str(p.profile))} model`;
    case "attachment": {
      const w = (p.with ?? {}) as P;
      if (Object.keys(w).some((key) => key !== "all_of")) {
        if (p.role === "leading") return `${neg}${p.subject === "this-model" || p.subject == null ? "the model" : subjectOf(p)} is leading ${unitFilterPhrase(w)}`;
        if (p.role === "led") return `${neg}${subjectOf(p, "this unit")} is being led by ${unitFilterPhrase({ ...w, level: "model" })}`;
        return `${neg}${subjectOf(p)} is attached to ${unitFilterPhrase(w)}`;
      }
      const kw = Array.isArray(w.all_of) ? `${(w.all_of as unknown[]).map(str).join(" ")} ` : "";
      if (p.role === "leading") return `${neg}${p.subject === "this-model" || p.subject == null ? "the model" : subjectOf(p)} is leading a ${kw}unit`;
      if (p.role === "led") return `${neg}${subjectOf(p, "this unit")} is being led by ${/^[aeiou]/i.test(kw) ? "an" : "a"} ${kw}model`;
      // Attached to a named unit: "this model is attached to a DOMINION SQUAD unit".
      if (kw) return `${neg}${subjectOf(p)} is attached to ${/^[aeiou]/i.test(kw) ? "an" : "a"} ${kw}unit`;
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
    case "equipped-weapon-count": {
      const count = (p.count ?? {}) as P;
      const weapons = weaponNoun({ weapons: p.weapons });
      const noun = count.min === 1 && count.max === 1 ? weapons.replace(/\bweapons\b/, "weapon") : weapons;
      return `${subjectOf(p, "the model")} is ${negated ? "not " : ""}equipped with ${countPhrase(count)} ${noun}`;
    }
    case "named-weapon":
    case "unit-wargear":
      return namedEquipmentPhrase(String(c.type), p, negated);
    case "loadout":
      return `${neg}all ${str(p.uniform)} weapons equipped by each ${p.model_keyword ? `${str(p.model_keyword)} ` : ""}model in the unit are the same`;
    case "unit-state": {
      const who = subjectOf(p);
      const withRef = p.with != null ? ` with ${unitRefPhrase(p.with)}` : "";
      if (p.at === "phase-start" || p.at === "turn-start")
        return `${who} ${negated ? "was not" : "was"} ${statePhrase(str(p.state))}${withRef} at the start of the ${p.at === "phase-start" ? "phase" : "turn"}`;
      return `${who} is ${statePhrase(str(p.state), negated)}${withRef}`;
    }
    case "eligible": {
      if (p.to === "embark-within") return `${subjectOf(p)} is ${negated ? "not " : ""}able to embark within ${transportPhrase(p.transport)}`;
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
      const ge = p.comparison === "gte";
      if (right.pool != null && ge) return `${neg}you destroyed at least as many ${destroyedCount(left)} as your ${dekebab(str(right.pool))}`;
      if (right.value != null) return `${neg}you destroyed ${comparisonPhrase(p.comparison)} ${str(right.value)} ${destroyedCount(left)}`;
      if (p.comparison === "gt" || ge) return `${neg}you destroyed ${ge ? "at least as many" : "more"} ${destroyedCount(left)} ${ge ? "as" : "than"} ${destroyedCount(right)}`;
      return `${neg}the number of ${destroyedCount(left)} you destroyed is ${comparisonPhrase(p.comparison)} ${right.pool != null ? `your ${dekebab(str(right.pool))}` : `the number of ${destroyedCount(right)} you destroyed`}`;
    }
    case "within": {
      const of = p.of;
      const range = p.range;
      const wholly = p.wholly === true ? "wholly " : "";
      const every = p.models === "every";
      const who = every ? `every model in ${subjectOf(p)}${p.count != null ? ` (${countPhrase(p.count)} models)` : ""}` : p.count != null ? `${countPhrase(p.count)} models in ${subjectOf(p)}` : subjectOf(p);
      const plural = !every && p.count != null;
      const target = range === "half-weapon" || range === "weapon" ? "" : ` of ${placeRefPhrase(of)}`;
      const at = p.at === "phase-start" ? " at the start of the phase" : "";
      return `${who} ${p.at === "phase-start" ? (plural ? "were" : "was") : (plural ? "are" : "is")} ${negated ? "not " : ""}${wholly}within ${rangePhrase(range)}${target}${at}`;
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
      const who = p.by === "enemy" ? "your opponent controls" : "you control";
      const objective = objectivePhrase((p.objective ?? {}) as P, true);
      const clauses: string[] = [];
      if (p.count != null || (p.compare == null && p.proportion == null)) clauses.push(`${who} ${countPhrase(p.count)} ${objective}`);
      if (p.compare != null) {
        const compare = p.compare as P;
        const other = compare.owner === "friendly" ? "you" : "the opponent";
        const holder = p.by === "enemy" ? "your opponent holds" : "you hold";
        if (compare.comparison === "gt") clauses.push(`${holder} more ${objective} than ${other}`);
        else clauses.push(`the number of ${objective} ${p.by === "enemy" ? "your opponent controls" : "you control"} is ${comparisonPhrase(compare.comparison)} the number ${compare.owner === "friendly" ? "you control" : "the opponent controls"}`);
      }
      if (p.proportion != null) {
        const proportion = p.proportion as P;
        const fraction = proportion.fraction === 0.5 ? "half" : `${Number(proportion.fraction) * 100}%`;
        clauses.push(`${who} ${comparisonPhrase(proportion.comparison)} ${fraction} of the ${objective}`);
      }
      return `${neg}${clauses.join(" and ")}`;
    }
    case "attack-is": {
      const parts: string[] = [];
      const kind = [p.shooting_type ? `${dekebab(str(p.shooting_type))} shooting` : "", p.fight_type ? `${dekebab(str(p.fight_type))} fight` : "", p.attack_type ? str(p.attack_type) : ""].filter(Boolean).join(" ");
      if (p.all_target_same_unit === true) return `${neg}all of the unit's ${kind ? `${kind} ` : ""}attacks${p.weapons != null ? ` made with ${weaponNoun({ weapons: p.weapons })}` : ""} target the same enemy unit`;
      parts.push(`for ${kind ? `${kind} ` : ""}attacks`);
      if (p.weapons != null) {
        const weapons = p.weapons as P;
        if (Object.keys(weapons).every((key) => key === "keyword" || key === "name") && !Array.isArray(weapons.keyword)) {
          if (weapons.keyword != null) parts.push(`made with ${bracketKeyword(weapons.keyword)} weapons`);
          if (weapons.name != null) parts.push(`made with ${str(weapons.name)}`);
        } else parts.push(`made with ${weaponNoun({ weapons })}`);
      }
      return `${neg}${parts.join(" ")}`;
    }
    case "attack-compare": {
      const side = (o: P): string => {
        if (o.value != null) return str(o.value);
        const whose = o.of === "defender" ? "the target's" : "the attack's";
        return `${whose} ${o.reduce === "max" ? "highest " : o.reduce === "min" ? "lowest " : ""}${str(o.stat)}`;
      };
      return `${neg}${side(p.left as P)} is ${comparisonPhrase(p.comparison)} ${side(p.right as P)}`;
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
        return `${neg}${countPhrase(p.count)} ${objectivePhrase((s as P).objective as P, true)} tagged ${dekebab(str(p.tag))}`;
      }
      if (p.count != null) return `${neg}${countPhrase(p.count)} ${unitRefPhrase(s).replace(/^an? /, "").replace(/\b(unit|model)\b/, "$1s")} ${designationPhrase(str(p.tag))}${p.by != null ? ` by ${unitRefPhrase(p.by)}` : ""}`;
      const by = p.by != null ? ` by ${unitRefPhrase(p.by, "this unit").replace(/^the unit$/, "this unit")}` : "";
      return `${subjectOf(p)} is ${negated ? "not " : ""}${designationPhrase(str(p.tag))}${by}`;
    }
    case "resource": {
      if (p.below_max === true) {
        const source = (p.source_ability as P | undefined)?.ability_id;
        return `${neg}the ${dekebab(str(source))} ability had unused selection capacity at the end of the opponent's previous turn`;
      }
      const amount = countPhrase(p.count);
      return `${neg}the unit has ${amount} ${dekebab(str(p.pool))}`;
    }
    // ── Mission-card predicates ───────────────────────────────────────────
    case "operation-markers": {
      const side = p.side != null ? `${str(p.side)} ` : "";
      const count = (p.count ?? {}) as P;
      const min = typeof count.min === "number" ? count.min : undefined;
      const max = typeof count.max === "number" ? count.max : undefined;
      let s: string;
      if (max === 0) s = `no ${side}operation markers on the battlefield`;
      else if (min != null && max != null && min === max) s = `exactly ${min} ${side}operation marker${min === 1 ? "" : "s"} on the battlefield`;
      else s = `${countPhrase(p.count)} ${side}operation markers on the battlefield`;
      if (p.within != null) {
        const within = p.within as P;
        s += ` within ${rangePhrase(within.range)} of ${placeRefPhrase(within.of)}`;
      }
      if (p.friendly_unit_in_same_terrain_area) s += " with a friendly unit in the same terrain area";
      if (p.no_enemy_in_terrain_area) s += " and no enemy units in that terrain area";
      return `${neg}${s}`;
    }
    case "engagement-fronts":
      return `${neg}you are engaged on ${countPhrase(p.count)} fronts`;
    case "destroyed-while-on-objective": {
      const obj = p.objective_role ? `a ${dekebab(str(p.objective_role))} objective` : "an objective";
      let s = `${neg}${countPhrase(p.count)} enemy units destroyed`;
      if (p.destroyer_on_objective) s += ` by a unit on ${obj}`;
      if (p.victim_on_objective) s += ` while on ${obj}`;
      if (p.victim_started_turn_on_objective) s += ` that started the turn on ${obj}`;
      return s;
    }
    case "destroyed-in-tagged-terrain": {
      const where = p.at_start_of_turn ? "that started the turn in" : "while in";
      const terrain = p.tag != null ? `${dekebab(str(p.tag))} terrain` : "a terrain area";
      return `${neg}${countPhrase(p.count)} enemy units destroyed ${where} ${terrain}`;
    }
    case "battle-size":
      return `the battle size is ${negated ? "not " : ""}${titleCase(str(p.size))}`;
    case "army-faction":
      return `your Army Faction is ${negated ? "not " : ""}${str(p.faction).replace(/-/g, " ").toUpperCase()}`;
    case "army-state":
      return `${p.owner === "enemy" ? "your opponent's army" : "your army"} is ${negated ? "not " : ""}${dekebab(str(p.state))}`;
    case "oath-state":
      return `the ${idLabel(str(p.ability))} oath is ${negated ? "not " : ""}${dekebab(str(p.state))}`;
    case "army-includes":
      return armyIncludes(p, negated);
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

function comparisonPhrase(comparison: unknown): string {
  return ({ gt: "more than", gte: "at least", eq: "equal to", neq: "not equal to", lt: "less than", lte: "at most" } as Record<string, string>)[str(comparison)] ?? dekebab(str(comparison));
}

/** Canonical ordinary predicates; compound negation applies to the whole filter. */
function describeMatches(p: P, negated: boolean): string {
  const f = (p.filter ?? {}) as P;
  const who = p.subject === "defender" ? "the target" : subjectOf(p);
  const keys = Object.keys(f).filter((key) => key !== "level");
  const no = negated ? "not " : "";
  if (keys.length === 1) {
    if (f.all_of != null || f.any_of != null) return `${who} ${negated ? "does not have" : "has"} ${negated && Array.isArray(f.all_of) && f.all_of.length > 1 ? "all of " : ""}${keywordList(f)}`;
    if (Array.isArray(f.none_of)) return `${who} ${negated ? "has" : "does not have"} ${keywordNoun(f.none_of, "or")}`;
    if (Array.isArray(f.not_all_of)) return `${who} ${negated ? "has" : "does not have"} all of ${keywordNoun(f.not_all_of, "and")}`;
    if (f.owner != null) return `${subjectOf(p)} is ${no}${f.owner === "enemy" ? "an enemy unit" : f.owner === "friendly" ? "friendly" : "a unit of either player"}`;
    if (f.state != null) return f.state === "fights-first" ? `${who} ${negated ? "does not have" : "has"} Fights First` : `${who} is ${statePhrase(str(f.state), negated)}`;
    if (Array.isArray(f.not_states)) return f.not_states.length === 1 ? `${who} is ${statePhrase(str(f.not_states[0]), !negated)}` : `${negated ? "not (" : ""}${andList(f.not_states.map((state) => `${who} is ${statePhrase(str(state), true)}`))}${negated ? ")" : ""}`;
    if (Array.isArray(f.has_ability)) return `${who} ${negated ? "does not have" : "has"} the ${andList(f.has_ability.map(idLabel))} ability`;
    if (Array.isArray(f.lacks_ability)) return `${who} ${negated ? "has" : "does not have"} the ${orList(f.lacks_ability.map(idLabel))} ability`;
    if (f.designated != null || f.not_designated != null) return `${who} is ${(f.not_designated != null) !== negated ? "not " : ""}${designationPhrase(str(f.designated ?? f.not_designated))}`;
    if (f.visible != null) {
      const to = (f.visible as P).to;
      return `${who} is ${no}visible to ${to === "attacker" ? "the attacking model" : unitRefPhrase(to)}`;
    }
    if (f.within != null) {
      const within = f.within as P;
      const to = within.range === "weapon" || within.range === "half-weapon" ? "" : ` of ${placeRefPhrase(within.of)}`;
      return `${who} is ${no}${within.wholly === true ? "wholly " : ""}within ${rangePhrase(within.range)}${to}`;
    }
  }
  return `${who} is ${no}${unitFilterPhrase(f)}`;
}

/**
 * "your army includes a CHARACTER unit", "your army includes 2 or more X units", "every model in
 * your army has the IMPERIUM keyword". The army is yours, so the filter's owner is not repeated.
 */
function armyIncludes(p: P, negated: boolean): string {
  const { owner: _owner, ...f } = (p.filter ?? {}) as P;
  const noun = f.level === "model" ? "model" : "unit";
  if (p.every === true) {
    if (Object.keys(f).some((key) => !["all_of", "any_of", "level"].includes(key)) || (f.all_of != null && f.any_of != null)) return `${negated ? "not " : ""}every ${noun} in your army is ${unitFilterPhrase(f)}`;
    const all = Array.isArray(f.all_of) ? (f.all_of as unknown[]).map(str) : [];
    const any = Array.isArray(f.any_of) ? (f.any_of as unknown[]).map(str) : [];
    const words = any.length ? orList(any) : andList(all);
    return `${negated ? "not " : ""}every ${noun} in your army has the ${words} keyword${all.length > 1 && !any.length ? "s" : ""}`;
  }
  const one = unitFilterPhrase(f);
  const min = Number(p.min ?? 1);
  const what = min > 1 ? `${min} or more ${one.replace(/^an? /, "").replace(/\b(unit|model)\b/, "$1s")}` : one;
  return `your army ${negated ? "does not include" : "includes"} ${what}`;
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
