/**
 * Single effects on the board axes: protection, models, moves, placement, tests,
 * resources, designation and army construction. One lowercase-initial clause, no period.
 */

import { describeCondition, type Condition } from "./condition.js";
import { conditionLeadIn } from "./condition-leadin.js";
import { objectivePhrase, type P } from "./condition-refs.js";
import type { Inline, Leaf } from "./effect-leaf.js";
import {
  amountOf, andList, orList, dekebab, designationFor, movedPhrase, noneOf, diceCase, effectSubject, formatComparison, isLiteral, jstr, ofOrPossessive, pronoun,
  rangePhrase, regionPhrase, requirementPhrase, resourceNoun, rollName, signed, testName, titleCase, v, weaponNoun, type Ctx,
  isRatingRef,
  abilityLabel,
} from "./effect-words.js";
import { expiryTrail } from "./expiry.js";
import { forEachUnitSubject } from "./effect.js";
import { placePhrase, placementLimits, placementPhrase } from "./effect-placement.js";
import { placeRefPhrase } from "./condition-refs.js";

function wounds(n: string, noun = "mortal wound"): string {
  return n === "1" ? noun : `${noun}s`;
}

function mortalWounds(m: Record<string, unknown>, subj: string): string {
  const count = diceCase(m.count);
  const suffered = isLiteral(m.count) ? `${count} ${wounds(count)}` : amountOf(m.count, "mortal wound", "mortal wounds");
  const psychic = m.psychic === true ? " (Psychic Attack)" : "";
  // A range the target filter already states is not repeated ("enemy units within 9\" within 9\"").
  const range = m.range != null && !subj.includes(` within ${rangePhrase(m.range)}`) ? ` within ${rangePhrase(m.range)}` : "";
  const who = `${subj}${range}`;
  // "(to a maximum of 6 mortal wounds)": a cap on the total, however many are rolled or counted.
  const cap = m.max != null ? ` (to a maximum of ${jstr(m.max)} mortal ${m.max === 1 ? "wound" : "wounds"})` : "";
  const roll = m.roll as P | undefined;
  if (roll != null) {
    const each = roll.per_model != null ? ` for each model in ${effectSubject(roll.per_model)}`
      : roll.for_each != null ? ` for each ${forEachUnitSubject(roll.for_each as Record<string, unknown>)}` : "";
    // A plain number of dice is that many D6 ("roll 7 D6", "roll one D6 for each model").
    const many = /^\d+$/u.test(jstr(roll.dice)) ? Number(roll.dice) : null;
    const dice = many !== null ? (each && many === 1 ? "one D6" : `${many} D6`) : each ? `one ${diceCase(roll.dice)}` : diceCase(roll.dice);
    // "for each 1": a die at or under the threshold succeeds.
    const band = roll.comparison !== "lte" ? `${jstr(roll.threshold)}+` : Number(roll.threshold) === 1 ? "1" : `result of ${jstr(roll.threshold)} or less`;
    return `roll ${dice}${each}: for each ${band}, ${who} ${v(who, "suffers")} ${suffered}${psychic}${cap}`;
  }
  const per = m.per === "model" ? ` for each model in ${pronoun(who) === "their" ? "them" : "it"}` : "";
  return `${who} ${v(who, "suffers")} ${suffered}${per}${psychic}${cap}`;
}

const FNP_AGAINST: Record<string, string> = {
  mortal: " against mortal wounds", psychic: " against Psychic Attacks", "psychic-and-mortal": " against Psychic Attacks and mortal wounds",
};

/** "its full wounds", "half of its starting number of wounds", "3 wounds", "D3 wounds": what a set-up or returned model has left. */
function woundsLeft(value: unknown): string {
  if (value == null || value === "full") return "its full wounds";
  if (value === "half-starting") return "half of its starting number of wounds";
  return isLiteral(value) ? `${diceCase(value)} ${wounds(diceCase(value), "wound")}` : amountOf(value, "wound", "wounds");
}

/** ", as a separate unit with a Starting Strength of 1 (it is no longer part of its attached unit)". */
function detachPhrase(m: Record<string, unknown>): string {
  return m.detach === true ? `, as a separate unit${m.starting_strength != null ? ` with a Starting Strength of ${jstr(m.starting_strength)}` : ""} (it is no longer part of its attached unit)` : "";
}

function returnModels(e: Leaf, m: Record<string, unknown>, subj: string, ctx: Ctx): string {
  const w = woundsLeft(m.wounds_remaining);
  const where = `${placementPhrase(m)}${placementLimits(m, ctx)}`;
  const detach = detachPhrase(m);
  if (e.target === "this-model") return `${subj} is set up again${where} with ${w} remaining${detach}`;
  const filter = typeof e.target === "object" && e.target != null ? e.target as P : undefined;
  if (filter?.level === "model") {
    const { member_of, ...recipients } = filter;
    const models = effectSubject(recipients, ctx).replace(/^all /, "");
    const kind = `destroyed ${models.replace(/\bmodels\b/, "model")}`;
    const what = m.count === "all" ? `all destroyed ${models}` : amountOf(m.count, kind, `destroyed ${models}`);
    return `return ${what}${member_of != null ? ` to ${effectSubject(member_of, ctx)}` : ""}${where}, each with ${w} remaining${detach}`;
  }
  const what = m.count === "all" ? "all destroyed models" : amountOf(m.count, "destroyed model", "destroyed models");
  return `return ${what} to ${subj}${where}, each with ${w} remaining${detach}`;
}

function destroyModels(e: Leaf, m: Record<string, unknown>, subj: string): string {
  const modelTarget = e.target != null && typeof e.target === "object" && (e.target as P).level === "model";
  const what = modelTarget
    ? m.count === "all" ? subj : `${diceCase(m.count)} of the ${subj.replace(/^all /, "")}`
    : m.count === "all" ? `every model in ${subj}` : `${diceCase(m.count)} ${diceCase(m.count) === "1" ? "model" : "models"} in ${subj}`;
  const verb = m.remove_from_play === true ? "remove" : "destroy";
  const tail = m.remove_from_play === true ? " from play" : "";
  const triggers = m.ignore_death_triggers === true ? ", ignoring any rules triggered by their destruction" : "";
  return `${verb} ${what}${tail}${triggers}`;
}

function actOnDeath(e: Leaf, m: Record<string, unknown>, subj: string, ctx: Ctx): string {
  const act = m.act === "shoot" ? "shoot" : "fight";
  const model = e.target === "event-object" ? "a model in this unit" : subj === "this model" ? "this model" : typeof e.target === "object" && e.target != null && (e.target as P).level === "model" ? `a ${subj.replace(/^all /, "").replace(/\bmodels\b/, "model")}` : `a model in ${subj}`;
  const gate = m.gate as { dice?: unknown; threshold?: unknown; comparison?: unknown; modifiers?: { condition?: Condition; value?: unknown }[] } | undefined;
  const eligibility = m.eligibility != null ? conditionLeadIn(m.eligibility as Condition) : "";
  const resolution = m.resolution === "when-unit-fights" ? `when its unit is selected to fight, it can ${act}`
    : m.resolution === "after-attacking-unit-finishes" ? `after the attacking unit has finished making its attacks, it can ${act}`
    : `it can ${act}`;
  if (gate != null) {
    const before = eligibility ? ` ${eligibility}` : "";
    const adds = (gate.modifiers ?? []).map((g) => `, adding ${diceCase(g.value)} ${conditionLeadIn(g.condition ?? {})}`).join("");
    const removal = m.removal === "after-destroyed-model-fights" ? `. Remove it after it has ${act === "shoot" ? "shot" : "fought"}` : ". Remove it after this unit has fought or at the end of the phase, whichever comes first";
    // Under a destroyed trigger the ability's lead-in already names the death: one lead-in only.
    const lead = ctx.destroyedTrigger ? (before ? `${before.trim()}, ` : "") : `each time ${model} is destroyed${before ? `,${before}` : ""}, `;
    return `${lead}roll one ${diceCase(gate.dice)}${adds}. On ${formatComparison(jstr(gate.comparison), gate.threshold)}, leave that model on the battlefield; ${resolution}${removal}`;
  }
  const lead = eligibility ? `${eligibility}, ` : "";
  if (m.resolution === "when-unit-fights") return `${lead}do not remove ${subj} yet; ${resolution}; remove it after its unit has finished fighting or at the end of the phase, whichever happens first`;
  if (m.resolution === "after-attacking-unit-finishes") return `${lead}do not remove ${subj} yet; ${resolution}; then remove it`;
  if (ctx.destroyedTrigger) return `${lead}${model === "this model" ? "this model" : "that model"} can ${act} before being removed from play`;
  return `${lead}each time ${model} is destroyed, it can ${act} before being removed from play`;
}

function addUnit(m: Record<string, unknown>, ctx: Ctx): string {
  const where = `${placementPhrase(m)}${placementLimits(m, ctx)}`;
  const engage = m.allow_engagement_with != null ? `; it can be set up within Engagement Range of ${effectSubject(m.allow_engagement_with, ctx)}` : "";
  const models = m.model_count != null ? ` containing ${amountOf(m.model_count, "model", "models")}` : "";
  const strength = m.starting_strength != null ? ` with a Starting Strength of ${jstr(m.starting_strength)}` : "";
  // New models that join an existing unit rather than forming their own.
  if (m.join != null) return `add ${amountOf(m.model_count ?? m.count ?? 1, `${titleCase(jstr(m.datasheet))} model`, `${titleCase(jstr(m.datasheet))} models`)} to ${effectSubject(m.join, ctx)}${where}${engage}`;
  // A fixed count reads as a number; a dice expression or bound quantity reads through amountOf.
  const count = m.count ?? 1;
  const n = typeof count === "number" ? count : null;
  const excluded = Array.isArray(m.excluded_keywords) ? ` (excluding ${orList((m.excluded_keywords as unknown[]).map(jstr))} models)` : "";
  const what = m.copy_of != null
    ? `${n === 1 ? "a new unit" : n != null ? `${n} new units` : amountOf(count, "new unit", "new units")} identical to ${effectSubject(m.copy_of, ctx)}${excluded}`
    : n === 1 ? `a ${titleCase(jstr(m.datasheet))} unit` : n != null ? `${n} ${titleCase(jstr(m.datasheet))} units` : amountOf(count, `${titleCase(jstr(m.datasheet))} unit`, `${titleCase(jstr(m.datasheet))} units`);
  const full = m.at_starting_strength === true ? ", at its Starting Strength and with all of its wounds remaining" : "";
  const oneShot = m.reset_one_shot === true ? ", with its [ONE SHOT] weapons counted as not having been shot" : "";
  // Where the unit goes comes first, then what it comes back with.
  return `add ${what}${models}${strength} to your army${where}${full}${oneShot}${engage}`;
}

const MOVE_VERBS: Record<string, string> = {
  normal: "make a Normal move", advance: "Advance", "fall-back": "Fall Back", charge: "declare a charge", "pile-in": "Pile In",
  consolidation: "Consolidate", surge: "make a Surge move", scout: "make a Scout move", ingress: "make an Ingress move",
  disembark: "disembark", embark: "embark", "pulse-jet": "make a Pulse Jet move",
};
const MOVE_NOUNS: Record<string, string> = {
  normal: "Normal", advance: "Advance", "fall-back": "Fall Back", charge: "Charge", "pile-in": "Pile-in", consolidation: "Consolidation",
  surge: "Surge", scout: "Scout", ingress: "Ingress", disembark: "Disembark", embark: "Embark", "pulse-jet": "Pulse Jet",
};
const PASSTHROUGH: Record<string, string> = {
  "non-titanic-models": "non-Titanic models", "friendly-vehicles": "friendly Vehicle models", "friendly-monsters": "friendly Monster models",
  "terrain-le-4": 'terrain features 4" or lower', "tall-terrain": 'terrain features over 4"', "all-terrain": "terrain features",
  "enemy-models": "enemy models",
};
const passthrough = (p: unknown): string => andList((p as unknown[]).map((x) => (typeof x === "object" && x != null ? passItem(x as P) : PASSTHROUGH[jstr(x)] ?? dekebab(jstr(x)))));

/** A typed pass-through item: "models (excluding MONSTER and VEHICLE models)", "terrain features 4\" or lower". */
function passItem(x: P): string {
  if (x.kind === "terrain") return x.height === "up-to-4" ? 'terrain features 4" or lower' : x.height === "over-4" ? 'terrain features over 4"' : "terrain features";
  const owner = x.owner === "friendly" ? "friendly " : x.owner === "enemy" ? "enemy " : "";
  const all = Array.isArray(x.all_of) ? `${(x.all_of as unknown[]).map((k) => titleCase(jstr(k).toLowerCase())).join(" ")} ` : "";
  const excl = Array.isArray(x.excluding) ? ` (excluding ${andList((x.excluding as unknown[]).map(jstr))} models)` : "";
  return `${owner}${all}models${excl}`;
}

/**
 * A move-end nearest the closest unit: a waiver makes the closest-enemy-model
 * end an alternative, so either end is legal.
 */
function endsNearestPhrase(e: P, ctx: Ctx, who: string, moveRef: string): string {
  // The enemy unit the trigger names is "that enemy unit", not the closest of a group.
  // An objective names no unit: any marker, or the one a select-objective bound.
  const objective = (e.of as P).objective as P | undefined;
  const nearest = e.of === "event-subject" ? "as close as possible to that enemy unit" : `as close as possible to the closest ${objective !== undefined
    ? (objective.selection_var !== undefined ? "selected objective" : "objective marker")
    // A filter names a plural group ("all enemy units"); the closest one is singular.
    : effectSubject(e.of, ctx).replace(/^(an?|the|all) /, "").replace(" units", " unit").replace(/ units\)/g, ")")}`;
  const must = e.per === "model" ? `each model in ${who === "it" ? "the unit" : who} must end ${moveRef}` : `${who} must end ${moveRef}`;
  const instead = e.instead_of === "closest-enemy-unit" ? ", instead of as close as possible to the closest enemy unit" : "";
  return e.waives === "closest-enemy-model" ? `${must} either closer to the closest enemy model or ${nearest}` : `${must} ${nearest}${instead}`;
}

function move(m: Record<string, unknown>, subj: string, ctx: Ctx): string {
  const verb = MOVE_VERBS[jstr(m.move_type)] ?? `make a ${dekebab(jstr(m.move_type))} move`;
  const upTo = m.distance != null ? (verb.startsWith("make ") ? ` of up to ${diceCase(m.distance)}"` : ` up to ${diceCase(m.distance)}"`) : "";
  let s = `${subj} can ${verb}${upTo}${modeClause(m)}`;
  if (m.as_if === "movement-phase") s += " as if it were your Movement phase";
  if (Array.isArray(m.passthrough)) s += `, moving over ${passthrough(m.passthrough)} as though they were not there`;
  const ends = m.ends_within as P | undefined;
  if (ends != null) s += `, ending that move ${ends.wholly === true ? "wholly " : ""}within ${rangePhrase(ends.range)} of ${endsOf(ends.of, ctx)}`;
  if (m.ends_when != null) s += `; it must end that move where ${describeCondition(m.ends_when as Condition)}${m.ends_when_replaces === true ? " (instead of the usual threshold)" : ""}`;
  if (m.ends_nearest != null) s += `; ${endsNearestPhrase(m.ends_nearest as P, ctx, "it", "that move")}`;
  if (m.allow_engagement === true) s += m.engaged_with === "nearest-move-end" ? "; it can end that move within Engagement Range of that enemy unit" : "; it can end that move within Engagement Range of enemy units";
  if (m.counts_as_move != null) s += `; that move counts as ${movedPhrase(m.counts_as_move)}`;
  if (m.keeps_eligible === true) s += "; doing so does not change what it is eligible to do this turn";
  return s;
}

/** A unit-ref keeps its effect-subject phrase; markers, objectives and edges read as places. */
function endsOf(of: unknown, ctx: Ctx): string {
  if (of == null) return "this model";
  const place = typeof of === "string" ? of.startsWith("battlefield-") : typeof of === "object" && ((of as P).marker != null || (of as P).objective != null);
  return place ? placePhrase(of, ctx) : effectSubject(of, ctx);
}

/** " using the Rapid Disembarkation rules", " using the Desperate Escape rules". */
function modeClause(m: Record<string, unknown>): string {
  if (m.mode == null) return "";
  const mode = titleCase(jstr(m.mode));
  return ` using the ${m.move_type === "disembark" || m.from === "transport" ? `${mode} Disembarkation` : mode} rules`;
}

function moveModifier(m: Record<string, unknown>, subj: string, ctx: Ctx): string {
  const kinds = Array.isArray(m.applies_to_moves) ? andList((m.applies_to_moves as unknown[]).map((x) => MOVE_NOUNS[jstr(x)] ?? dekebab(jstr(x)))) : null;
  const clauses: string[] = [];
  if (m.maximum === "unlimited") clauses.push(`${subj} can move any distance`);
  else if (typeof m.maximum === "number") clauses.push(`${subj} can move up to ${m.maximum}"`);
  if (m.distance_bonus != null) {
    const n = Number(m.distance_bonus);
    const moves = kinds ? `${kinds} moves` : "Move characteristic";
    clauses.push(!Number.isNaN(n) && n < 0 ? `subtract ${Math.abs(n)}" from ${ofOrPossessive(subj, moves)}` : `add ${diceCase(m.distance_bonus)}" to ${ofOrPossessive(subj, moves)}`);
  }
  if (m.advance === "fixed-6" || m.advance === "fixed-8") clauses.push(`${subj} ${v(subj, "does")} not make an Advance roll; add ${m.advance.slice("fixed-".length)}" to ${pronoun(subj)} Move characteristic instead`);
  if (Array.isArray(m.passthrough)) clauses.push(`${subj} can move over ${passthrough(m.passthrough)} as though they were not there`);
  if (m.no_end_in_engagement === true) clauses.push(`${subj} cannot end a move within Engagement Range of any enemy unit`);
  if (m.ends_nearest != null) clauses.push(endsNearestPhrase(m.ends_nearest as P, ctx, subj, `${pronoun(subj)} move`));
  // With a distance bonus, ends_when is the bonus's proviso: it is available only where a move can end there.
  if (m.ends_when != null) {
    const where = describeCondition(m.ends_when as Condition);
    const replaces = m.ends_when_replaces === true ? " (instead of the usual threshold)" : "";
    clauses.push(m.distance_bonus != null
      ? `the extra distance applies only if ${subj} can end ${pronoun(subj)} move where ${where}, and must end it there`
      : `${subj} must end ${pronoun(subj)} move where ${where}${replaces}`);
  }
  if (m.end_on_terrain === true) clauses.push(`${subj} can end ${pronoun(subj)} moves on top of terrain features`);
  if (m.ignore_vertical === true) clauses.push(`${subj} ${v(subj, "ignores")} vertical distances when ${pronoun(subj) === "their" ? "they move" : "it moves"}`);
  const s = clauses.join("; ");
  // A mode choice names its own move; the other clauses keep the ", during …" scope.
  const scoped = kinds && m.distance_bonus == null && (s !== "" || m.mode_choice == null) ? `${s}, during ${pronoun(subj)} ${kinds} moves` : s;
  const choice = m.mode_choice != null ? modeChoice(m.mode_choice as P, subj, kinds ?? "move") : "";
  return [scoped, choice].filter((part) => part !== "").join("; ");
}

/** "can select any consolidation mode for that consolidation move, regardless of its Before Moving restrictions". */
function modeChoice(c: P, subj: string, kinds: string): string {
  const modes = c.modes === "any" ? "any" : `the ${orList((c.modes as unknown[]).map((x) => dekebab(jstr(x))))}`;
  const waiver = c.ignore_before_moving === true ? `, ignoring that ${kinds} move's Before Moving restrictions` : "";
  return `${subj} can select ${modes} ${kinds} mode for ${pronoun(subj)} ${kinds} moves${waiver}`;
}

const ORD = ["", "first", "second", "third", "fourth", "fifth"];
function setUp(m: Record<string, unknown>, subj: string, ctx: Ctx): string {
  const who = m.subject === "models-on-this-model" ? "the models on this model" : m.subject != null ? effectSubject(m.subject, ctx) : subj;
  // An ingress or other placement replaces the usual set-up limits; a Reserves set-up ignores the Reserves limits.
  const reserves = m.to === "strategic-reserves" || m.from === "strategic-reserves";
  const limits = m.ignore_limits === true ? (reserves ? ", ignoring any limits on units in Strategic Reserves" : ", ignoring the usual set-up limits") : "";
  const can = m.allow === false ? "cannot" : m.mandatory === true ? "must" : "can";
  if (m.to === "strategic-reserves") return `${m.allow === false ? noneOf(who) : who} ${can} be placed into Strategic Reserves${limits}`;
  const from = m.from === "strategic-reserves" ? " from Strategic Reserves" : m.from === "transport" ? " from its Transport" : "";
  const whoCan = m.allow === false ? noneOf(who) : who;
  let s = m.from === "battlefield" ? `${whoCan} ${can} be removed from the battlefield and set up again` : `${whoCan} ${can} be set up on the battlefield${from}`;
  if (m.via === "deep-strike") s += " using the Deep Strike rules";
  if (m.via === "cult-ambush") s += " using a Cult Ambush marker";
  const markerRange = m.marker_range as P | undefined;
  if (markerRange != null) s += `, ${markerRange.wholly === true ? "wholly " : ""}within ${rangePhrase(markerRange.range)} of that marker`;
  s += modeClause(m);
  if (Array.isArray(m.turns)) s += ` in the Reinforcements step of your ${(m.turns as number[]).map((t) => ORD[t] ?? `${t}th`).join(", ").replace(/, ([^,]*)$/, " or $1")} Movement phase`;
  if (m.arrives === "next-movement-phase") s += ` in the Reinforcements step of your next Movement phase${m.allow_first_round === true ? " (even in the first battle round)" : ""}`;
  if (m.sections != null) s += ` as ${jstr(m.sections)} separate sections`;
  s += placementPhrase(m) + placementLimits(m, ctx);
  if (m.within_edge != null) s += ` wholly within ${rangePhrase(m.within_edge)} of a battlefield edge`;
  if (m.min_enemy_distance != null) s += ` more than ${rangePhrase(m.min_enemy_distance)} away from all enemy models`;
  const md = m.min_distance_from as P | undefined;
  if (md != null) s += ` ${m.allow === false ? "within" : "more than"} ${rangePhrase(md.range)}${m.allow === false ? " of" : " away from"} ${md.of != null ? placePhrase(md.of, ctx) : "this model"}`;
  if (m.round_offset != null) s += `, treating the battle round as ${Math.abs(Number(m.round_offset))} ${Number(m.round_offset) < 0 ? "lower" : "higher"} than it is`;
  if (m.wounds_remaining != null) s += `, with ${woundsLeft(m.wounds_remaining)} remaining`;
  s += detachPhrase(m);
  if (m.starting_strength != null && m.detach !== true) s += `; its unit has a Starting Strength of ${jstr(m.starting_strength)}`;
  if (m.allow_engagement === true) s += "; it can be set up within Engagement Range of enemy units";
  if (m.counts_as_move != null) s += `; it counts as having made ${movedPhrase(m.counts_as_move)} this turn`;
  return s + limits;
}

function marker(m: Record<string, unknown>): string {
  // A label that already ends in "marker" ("cult-ambush-marker") must not read "marker marker".
  const label = dekebab(jstr(m.label)).replace(/ marker$/i, "");
  const consume = m.consume === "on-use" ? "; using the marker consumes it" : "";
  const unmoved = m.not_moved_this_turn === true ? " that has not been moved this turn" : "";
  if (m.operation === "relocate") return `move the ${label} marker${unmoved}${m.distance != null ? ` up to ${rangePhrase(m.distance)}` : ""}${consume}`;
  const where = m.placement != null ? ` ${dekebab(jstr(m.placement))}` : "";
  return `place ${/^[aeiou]/i.test(label) ? "an" : "a"} ${label} marker${where}${consume}`;
}

function test(m: Record<string, unknown>, subj: string): string {
  const n = Number(m.count ?? 1);
  const tests = n === 1 ? `a ${testName(m.test)} test` : `${n} ${testName(m.test)} tests`;
  const per = m.per != null ? ` for each ${dekebab(jstr(m.per))}` : "";
  const mod = m.modifier != null ? `, applying ${signed("add", m.modifier)} to ${n === 1 && per === "" ? "that test" : "those tests"}` : "";
  return `${subj} must take ${tests}${per}${mod}`;
}

function costModifier(m: Record<string, unknown>, subj: string): string {
  const noun = m.of === "manoeuvre" ? "manoeuvre" : m.of === "ability" ? "ability" : "Stratagem";
  if (m.applies_to === "the-triggering-use") {
    if (m.operation === "decrease") return `reduce the CP cost of that use of the ${noun} by ${jstr(m.amount)}CP (to a minimum of 0CP)`;
    if (m.operation === "increase") return `increase the CP cost of that use of the ${noun} by ${jstr(m.amount)}CP`;
    return m.operation === "waive" ? `that use of the ${noun} costs no CP` : `that use of the ${noun} costs ${jstr(m.amount)}CP`;
  }
  const which = m.id != null ? `the ${abilityLabel(m.id)} ${noun}` : `${noun === "ability" ? "abilities" : `${noun}s`}`;
  const whose = m.applies_to === "targeting-this-unit" ? ` that ${m.id != null ? "targets" : "target"} ${subj}` : m.applies_to === "used-by-this-unit" ? ` used by ${subj}` : "";
  const verb = m.id != null ? "costs" : "cost";
  if (m.operation === "waive") return `${which}${whose} can be used without paying ${m.id != null ? "its" : "their"} CP cost`;
  if (m.operation === "set") return `${which}${whose} ${verb} ${jstr(m.amount)}CP`;
  if (m.operation === "multiply") return `${which}${whose} ${verb} ${m.amount === 2 ? "twice" : m.amount === 3 ? "three times" : `${jstr(m.amount)} times`} ${m.id != null ? "its" : "their"} stated CP cost`;
  return `${which}${whose} ${verb} ${jstr(m.amount ?? 1)}CP ${m.operation === "decrease" ? "less" : "more"}`;
}

function resourceDie(m: Record<string, unknown>): string {
  const pool = resourceNoun(m.pool, null);
  if (m.operation === "substitute") {
    const rolls = Array.isArray(m.rolls) ? (m.rolls as unknown[]).map(rollName) : ["dice"];
    return `discard a die from your ${pool} and use its value in place of a ${rolls.join(" or ")} roll`;
  }
  const shown = m.value === "highest" ? "the highest result" : jstr(m.value);
  if (m.count_per_pool != null) {
    const per = resourceNoun(m.count_per_pool, null);
    const die = m.value === "rolled" ? "one rolled D6" : `one die showing ${shown}`;
    return `add ${die} to your ${pool} for each ${per} you have${m.consumes_pool === true ? `, after which all your ${per} are lost` : ""}`;
  }
  if (m.count != null && !isLiteral(m.count)) return `add ${amountOf(m.count, m.value === "rolled" ? "rolled D6" : "die", m.value === "rolled" ? "rolled D6" : "dice")} to your ${pool}`;
  const cnt = m.count != null ? diceCase(m.count) : "1";
  if (m.value === "rolled") return `add ${cnt === "1" ? "a rolled D6" : `${cnt} rolled D6`} to your ${pool}`;
  return `add ${cnt === "1" ? "a die" : `${cnt} dice`} showing ${shown} to your ${pool}`;
}

function designate(m: Record<string, unknown>, subj: string, ctx: Ctx): string {
  const s = m.subject as P | string | undefined;
  const what =
    s == null ? subj
      : typeof s === "object" && s.objective != null
        ? (s.objective as P).selection_var != null ? "that objective marker" : `the ${objectivePhrase(s.objective as P)}`
        : typeof s === "object" && s.terrain_area != null ? regionPhrase({ terrain_area: s.terrain_area })
          : effectSubject(s, ctx);
  const tag = designationFor(jstr(m.tag));
  const legacy = m.clears_on === "turn-rollover" ? " until the end of the turn" : m.clears_on === "phase-end" ? " until the end of the phase" : "";
  const trail = expiryTrail(m.clears_on);
  const until = legacy || (trail && m.clears_on !== "battle" ? ` ${trail}` : "");
  const by = m.by != null ? ` by ${effectSubject(m.by, ctx)}` : "";
  return m.clear === true ? `${what} ${v(what, "is")} no longer ${tag}` : `${what} ${v(what, "is")} ${tag}${by}${until}`;
}

/** A list-building group: its unit-filter, its datasheets ("Alpha Squad or Beta Squad units"), or both. */
function groupWhat(m: Record<string, unknown>, withF: string | null): string | null {
  const sheets = Array.isArray(m.datasheets) ? orList((m.datasheets as unknown[]).map((d) => titleCase(jstr(d)))) : null;
  if (sheets == null) return withF;
  return withF != null ? `${withF} (${sheets} only)` : `${sheets} units`;
}

/** "CHARACTER unit", "ADEPTUS CUSTODES model": the singular of a plural group. */
function singular(group: string): string {
  return group.replace(/ units\b/, " unit").replace(/ models\b/, " model");
}

/** "a CHARACTER unit", "an ADEPTUS CUSTODES model": one of a plural group. */
function oneOf(group: string): string {
  const one = singular(group);
  return `${/^[aeiou]/i.test(one) ? "an" : "a"} ${one}`;
}

function armyRule(m: Record<string, unknown>, subj: string, ctx: Ctx, target?: unknown): string {
  const withF = m.with != null ? effectSubject(m.with, ctx).replace(/^all /, "") : null;
  const group = groupWhat(m, withF);
  switch (m.rule) {
    case "warlord-required": return `${subj} must be your Warlord`;
    case "warlord-forbidden": return `${subj} cannot be your Warlord`;
    case "unique": return group != null ? `your army can include only one ${singular(group)}` : `your army can include only one of ${subj}`;
    case "enhancement-forbidden": return `${subj} cannot be given Enhancements`;
    case "enhancement-source": return `${subj} can only be given Enhancements from this Detachment`;
    case "limit-exemption": return limitExemption(m, subj, target);
    case "enhancement-slot":
      return `each ${withF?.replace(/ units\b/, " unit") ?? "such unit"} can be given ${m.max != null ? `up to ${jstr(m.max)} ` : ""}${m.enhancement_kind != null ? `${titleCase(jstr(m.enhancement_kind))} ` : ""}Enhancement${m.max === 1 ? "" : "s"}`;
    case "faction-forbidden": return `you cannot select ${titleCase(jstr(m.faction))} as your Army Faction`;
    case "single-chapter": return "your army can include units from only one Chapter";
    case "detachment-forbidden": return `you cannot select the ${titleCase(jstr(m.detachment))} Detachment`;
    case "detachment-tag-exclusive": return `you cannot select this Detachment together with another ${titleCase(jstr(m.tag))} Detachment`;
    case "attachment":
      if (m.mandatory === true) return `${subj} must be attached to a Leader, or it counts as destroyed`;
      if (m.can_lead != null) return `${subj} can also be attached to ${effectSubject(m.can_lead, ctx).replace(/^all /, "")}`;
      if (m.attach_as != null) return `${withF != null ? oneOf(withF) : "a Leader"} that can be attached to ${effectSubject(m.attach_as, ctx).replace(/^all /, "")} can also be attached to ${subj}`;
      return `at the start of the Declare Battle Formations step, ${subj} can join one friendly unit${m.led_by != null ? ` led by a ${titleCase(jstr(m.led_by))} model` : ""}, becoming part of that Bodyguard unit`;
    default: return composition(m, group, ctx);
  }
}

/** Limits the rule's units (or this Detachment's Enhancements) are left out of. */
function limitExemption(m: Record<string, unknown>, subj: string, target: unknown): string {
  const items = Array.isArray(m.exempt_from) ? (m.exempt_from as unknown[]) : [];
  return items.map((item) => {
    if (item === "enhancement-limit") {
      const whose = target == null || target === "this-unit" ? "Enhancements from this Detachment" : `Enhancements on ${subj}`;
      return `${whose} do not count toward your army's Enhancement limit`;
    }
    const limit = item === "strategic-reserves-points" ? "the points limit for Strategic Reserves" : "the Retinue limit";
    return `${subj} ${v(subj, "does")} not count toward ${limit}`;
  }).join("; ");
}

/** A composition limit: at most N units / models / points of X, per matching unit, outside the Retinue limit. */
function composition(m: Record<string, unknown>, withF: string | null, ctx: Ctx): string {
  // An allied faction a composition rule admits: "Chaos Daemons units" when no filter names them.
  const allied = m.faction != null ? titleCase(jstr(m.faction)) : null;
  const what = withF != null ? `${withF}${allied ? ` from the ${allied} faction` : ""}` : allied ? `${allied} units` : "such units";
  const exempt = Array.isArray(m.exempt_from) ? "; they do not count toward the Retinue limit" : "";
  // No limit is a permission; a limit of 0 forbids.
  if (m.max == null) return `your army can include ${what}${exempt}`;
  if (isLiteral(m.max) && Number(m.max) === 0) return `your army cannot include ${what}${exempt}`;
  const measure = m.measure === "points" ? "points of" : m.measure === "models" ? "models from" : "";
  const max = isLiteral(m.max) ? jstr(m.max) : diceCase(m.max);
  // "at most 1 INQUISITORIAL AGENTS unit", "at most 3 units".
  const one = isLiteral(m.max) && Number(m.max) === 1 && !measure;
  const counted = one ? what.replace(/ units\b/, " unit") : what;
  const per = m.per != null ? ` for each ${effectSubject(m.per, ctx).replace(/^all /, "").replace(/ units\b/, " unit")} in your army` : "";
  return `your army can include at most ${max} ${measure ? `${measure} ` : ""}${counted}${per}${exempt}`;
}

/** How models count against a Transport's capacity. */
function transportCapacity(m: Record<string, unknown>): string {
  if (m.capacity != null) {
    const who = m.eligible != null ? ` ${effectSubject(m.eligible).replace(/^all /, "").replace(/\bunits\b/, "models")}` : " models";
    const spaces = Array.isArray(m.space_per_model)
      ? (m.space_per_model as Array<Record<string, unknown>>).map((s) => `${effectSubject({ any_of: s.any_of, all_of: s.all_of }).replace(/^all /, "").replace(/\bunits\b/, "models")} take ${jstr(s.slots)} spaces each`)
      : [];
    return [`this model has a Transport capacity of ${jstr(m.capacity)}${who}`, ...spaces].join("; ");
  }
  const keyword = m.model_keyword != null ? titleCase(jstr(m.model_keyword)) : "";
  const singleModel = m.subject_kind === "single-model";
  const model = keyword ? `${singleModel ? "this " : ""}${keyword} model` : singleModel ? "this model" : "model in this unit";
  const eachModel = singleModel ? model : `each ${model}`;
  const eligibility = m.transport_eligibility as Record<string, unknown> | undefined;
  const qualification =
    eligibility?.requires_capacity_keyword != null
      ? ` in a Transport able to carry ${titleCase(jstr(eligibility.requires_capacity_keyword))} models`
      : eligibility?.embark_as_keyword != null
        ? ` when embarking as ${titleCase(jstr(eligibility.embark_as_keyword))}`
        : "";

  if (m.occupancy_kind === "fixed-model-spaces") {
    const spaces = Number(m.spaces_per_model);
    return `for Transport capacity${qualification}, ${eachModel} occupies ${spaces} model space${spaces === 1 ? "" : "s"}`;
  }
  if (m.occupancy_kind === "equivalent-model") {
    const equivalent =
      m.equivalent_model_keyword != null
        ? `${titleCase(jstr(m.equivalent_model_keyword))} model`
        : "model";
    const count = Number(m.equivalent_model_count ?? 1);
    return `for Transport capacity${qualification}, ${eachModel} counts as ${count} ${equivalent}${count === 1 ? "" : "s"}`;
  }

  const models = Number(m.models_per_group);
  const spaces = Number(m.spaces_per_group);
  const groupModel = keyword ? `${keyword} model` : "model in this unit";
  const groupModels = keyword ? `${keyword} models` : "models in this unit";
  const subject = singleModel
    ? model
    : models === 1
      ? `each ${groupModel}`
      : `each group of ${models} ${groupModels}`;
  const spaceNoun = spaces === 1 ? "model space" : "model spaces";
  return `for Transport capacity${qualification}, ${subject} occupies ${spaces} ${spaceNoun}, rounding ${jstr(m.rounding)}`;
}

/** The board-axis leaves; anything unknown degrades to `[type]`. */
export function describeBoardLeaf(e: Leaf, m: Record<string, unknown>, subj: string, ctx: Ctx, inline: Inline): string {
  switch (e.type) {
    case "mortal-wounds": return mortalWounds(m, subj);
    case "damage-reduction": {
      const r = jstr(m.reduction);
      const how = r === "half" ? "halve the Damage of that attack" : r === "to-zero" ? "change the Damage of that attack to 0" : `subtract ${r} from the Damage characteristic of that attack`;
      const attack = m.weapons != null ? `an attack with ${weaponNoun(m)}` : "an attack";
      return `each time ${attack} is allocated to ${subj}, ${how}`;
    }
    case "feel-no-pain": {
      const rated = isRatingRef(m.threshold);
      return `${subj} ${v(subj, "has")} the Feel No Pain ${rated ? "X" : jstr(m.threshold)}+ ability${FNP_AGAINST[jstr(m.against)] ?? ""}${rated ? ", X being its rating" : ""}`;
    }
    case "invulnerable-save": {
      const scope = m.weapons as P | undefined;
      const vs = scope?.type != null && Object.keys(scope).length === 1 ? ` against ${jstr(scope.type)} attacks` : scope != null ? ` against attacks with ${weaponNoun(m)}` : "";
      return `${subj} ${v(subj, "has")} a ${jstr(m.invuln_sv)}+ invulnerable save${vs}`;
    }
    case "heal": {
      const who = m.per === "model" ? `each model in ${subj}` : subj;
      if (m.amount === "full") return `${who} ${v(who, "regains")} all ${pronoun(who)} lost wounds`;
      if (!isLiteral(m.amount)) return `${who} ${v(who, "regains")} up to ${amountOf(m.amount, "lost wound", "lost wounds")}`;
      const amount = diceCase(m.amount);
      return `${who} ${v(who, "regains")} up to ${amount} lost ${amount === "1" ? "wound" : "wounds"}`;
    }
    case "return-models": return returnModels(e, m, subj, ctx);
    case "destroy-models": return destroyModels(e, m, subj);
    case "act-on-death": return actOnDeath(e, m, subj, ctx);
    case "split-unit": {
      const strength = m.starting_strength != null ? `, each with a Starting Strength of ${jstr(m.starting_strength)}` : "";
      if (m.by === "model") return `split ${subj} into units of one model each${strength}`;
      const by = m.by as { model_keyword?: unknown[] } | undefined;
      if (by?.model_keyword) return `split ${subj} into one unit of each of its ${andList(by.model_keyword.map(jstr))} models${strength}`;
      const counts = Array.isArray(m.model_counts) ? (m.model_counts as unknown[]).map(jstr) : [];
      return `split ${subj} into ${counts.length} units of ${andList(counts)} models${strength}`;
    }
    case "add-unit": return addUnit(m, ctx);
    case "destruction-rule": return `${subj} ${v(subj, "is")} not destroyed until ${effectSubject(m.also, ctx)} is also destroyed`;
    case "move": return move(m, subj, ctx);
    case "move-modifier": return moveModifier(m, subj, ctx);
    case "set-up": return setUp(m, subj, ctx);
    case "marker": return marker(m);
    case "transport-capacity": return transportCapacity(m);
    case "test": return test(m, subj);
    case "state-change": return m.set === false ? `${subj} ${v(subj, "is")} no longer Battle-shocked` : `${subj} ${v(subj, "is")} Battle-shocked`;
    case "cp-gain": {
      const n = Number(m.amount);
      return n < 0 ? `you lose ${Math.abs(n)}CP` : `you gain ${jstr(m.amount)}CP`;
    }
    case "cost-modifier": return costModifier(m, subj);
    case "resource-gain": {
      if (m.amount != null && typeof m.amount === "object") return `you gain ${amountOf(m.amount, resourceNoun(m.pool, m.label, 1), resourceNoun(m.pool, m.label, 2))}`;
      const amount = m.amount === "variable" ? "a number of" : m.amount === "any" ? "any number of" : diceCase(m.amount);
      return `you gain ${amount} ${resourceNoun(m.pool, m.label, m.amount)}`;
    }
    case "resource-spend": {
      const amount = m.amount === "all" ? "all your" : m.amount === "one-or-more" ? "one or more" : diceCase(m.amount);
      const showing = m.face != null ? ` showing a ${jstr(m.face)}` : m.requirement != null ? ` forming a ${requirementPhrase(m.requirement)}` : "";
      let noun = resourceNoun(m.pool, m.label, m.amount === "all" ? 2 : m.amount);
      // A face or a pair/triple is only said of dice: "3 Blessings of Khorne dice forming a triple of 6+".
      if (showing && !/\b(die|dice)$/.test(noun)) noun += Number(jstr(m.amount)) === 1 ? " die" : " dice";
      return `spend ${amount} ${noun}${showing}`;
    }
    case "resource-die": return resourceDie(m);
    case "objective-sticky":
      // "That objective is secured": one marker, the one a select-objective bound.
      if (m.objective != null) return `${placeRefPhrase({ objective: m.objective })} remains under your control until your opponent's Level of Control over it is greater than yours at the end of a phase`;
      return `objective markers ${subj} ${v(subj, "controls")} remain under your control until your opponent's Level of Control over them is greater than yours at the end of a phase`;
    case "designate": return designate(m, subj, ctx);
    case "army-rule": return armyRule(m, subj, ctx, e.target);
    default: {
      void inline;
      return `[${e.type ?? "unknown"}]`;
    }
  }
}
