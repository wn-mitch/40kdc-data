/**
 * Single effects on the characteristic, roll, ability and permission axes, as one
 * lowercase-initial clause with no period. The board axes (protection, models, moves,
 * placement, tests, resources, designation, army) are in `effect-leaf-board.ts`.
 */

import { describeBoardLeaf } from "./effect-leaf-board.js";
import { describeShapeLeaf } from "./effect-leaf-shapes.js";
import {
  abilityLabel, andList, bracketKeyword, dekebab, diceCase, effectSubject, hasWeapon, isPlural, jstr, ofOrPossessive, orList, pronoun,
  movedPhrase, noneOf, rangePhrase, regionPhrase, rollName, signed, statName, titleCase, v, weaponHolder, weaponLabel, weaponNoun,
  weaponRollScope, type Ctx,
} from "./effect-words.js";
import type { P } from "./condition-refs.js";

/** A leaf effect node: `{type, target, modifier, scaling?}`. */
export interface Leaf {
  type?: string;
  target?: unknown;
  modifier?: Record<string, unknown>;
}

/** Renders a nested effect inline (supplied by the container describer). */
export type Inline = (e: unknown, ctx: Ctx) => string;

/** Every single-effect type; anything else is a container. */
export const LEAF_TYPES = new Set([
  "stat-modifier", "ignore-modifiers", "roll-modifier", "re-roll", "roll-result", "end-attack-sequence", "ability-grant",
  "keyword-grant", "weapon-ability-grant", "weapon-grant", "ability-modifier", "ability-activate", "permission", "targeting",
  "counts-as", "rule-state", "mortal-wounds", "damage-reduction", "feel-no-pain", "invulnerable-save", "heal", "return-models",
  "destroy-models", "act-on-death", "split-unit", "add-unit", "destruction-rule", "move", "move-modifier", "set-up", "marker",
  "transport-capacity", "test", "state-change", "cp-gain", "cost-modifier", "resource-gain", "resource-spend", "resource-die",
  "objective-sticky", "designate", "army-rule", "test-exemption", "datasheet-swap", "characteristic-resolution", "borrow-weapons", "select-weapon",
]);

/** "each time an attack targets the unit, " — the lead of an `incoming` change. */
function incomingLead(m: Record<string, unknown>, subj: string): string {
  const attack = m.weapon_type != null ? `a ${jstr(m.weapon_type)} attack` : "an attack";
  return `each time ${attack} targets ${subj}, `;
}

/** A stat change as a verb phrase over `what` ("add 1 to the unit's Toughness characteristic"). */
function statChange(m: Record<string, unknown>, what: string): string {
  const op = jstr(m.operation);
  if (op === "set") return `set ${what} to ${diceCase(m.value)}`;
  if (op === "halve") return `halve ${what}`;
  if (op === "multiply") return `multiply ${what} by ${diceCase(m.value)}`;
  if (op === "improve" || op === "worsen") return `${op} ${what} by ${diceCase(m.value)}`;
  let verb = op === "subtract" ? "subtract" : "add";
  let val: unknown = m.value;
  const n = Number(val);
  if (!Number.isNaN(n) && n < 0) {
    verb = verb === "add" ? "subtract" : "add";
    val = Math.abs(n);
  }
  return `${verb} ${diceCase(val)} ${verb === "add" ? "to" : "from"} ${what}`;
}

function bounds(m: Record<string, unknown>): string {
  const min = m.minimum != null ? ` (to a minimum of ${jstr(m.minimum)})` : "";
  const max = m.maximum != null ? ` (to a maximum of ${jstr(m.maximum)})` : "";
  return min + max;
}

function statModifier(e: Leaf, m: Record<string, unknown>, subj: string, ctx: Ctx): string {
  // AP is printed negative; the DSL stores its magnitude.
  if (m.stat === "AP" && m.operation === "set" && typeof m.value === "number" && m.value > 0) m = { ...m, value: `-${m.value}` };
  const stat = `${statName(m.stat)} characteristic`;
  if (m.incoming === true) return `${incomingLead(m, subj)}${statChange(m, `the ${stat} of that attack`)}${bounds(m)}`;
  if (hasWeapon(m)) return `${statChange(m, `the ${stat} of ${weaponNoun(m)} equipped by ${weaponHolder(e.target, ctx)}`)}${bounds(m)}`;
  return `${statChange(m, ofOrPossessive(subj, stat))}${bounds(m)}`;
}

function ignoreModifiers(m: Record<string, unknown>, subj: string): string {
  const kind = m.only === "worsening" ? "negative " : m.only === "improving" ? "positive " : "";
  const things =
    m.what === "rolls"
      ? Array.isArray(m.rolls) && !m.rolls.some((r) => r === "all" || r === "any") ? `${andList((m.rolls as unknown[]).map(rollName))} rolls` : "rolls"
      : Array.isArray(m.stats) ? `${andList((m.stats as unknown[]).map(statName))} characteristics` : "characteristics";
  if (m.incoming === true) return `${incomingLead(m, subj)}ignore any ${kind}modifiers to that attack's ${things}`;
  return `${subj} ${v(subj, "ignores")} any ${kind}modifiers to ${pronoun(subj)} ${things}${weaponRollScope(m)}`;
}

function rollModifier(m: Record<string, unknown>, subj: string): string {
  const value = m.value_from === "previous-roll" ? "the result of that roll" : null;
  const cap = m.cap != null ? ` (to a maximum of ${signed(m.operation, m.cap)})` : "";
  const rolls = `${rollName(m.roll)} rolls`;
  if (m.incoming === true) {
    const change = value ? `${m.operation === "subtract" ? "subtract" : "add"} ${value} ${m.operation === "subtract" ? "from" : "to"}` : `apply ${signed(m.operation, m.value)} to`;
    return `${incomingLead(m, subj)}${change} the ${rollName(m.roll)} roll${cap}`;
  }
  if (value) return `${m.operation === "subtract" ? "subtract" : "add"} ${value} ${m.operation === "subtract" ? "from" : "to"} ${ofOrPossessive(subj, rolls)}${weaponRollScope(m)}${cap}`;
  return `${subj} ${v(subj, "gets")} ${signed(m.operation, m.value)} to ${rolls}${weaponRollScope(m)}${cap}`;
}

function reRoll(e: Leaf, m: Record<string, unknown>, subj: string, ctx: Ctx): string {
  const rn = jstr(m.roll);
  const noun = rn === "any" ? "roll" : `${rollName(m.roll)} roll`;
  const cnt = typeof m.count === "number" ? m.count : undefined;
  // A counted allowance ("one for each model equipped with …") reads as a number of rolls.
  const counted = m.count != null && typeof m.count === "object" ? `a number of ${failedNoun(m, noun)}s equal to ${diceCase(m.count)}` : undefined;
  const failed = m.subset === "all-failures" ? "failed " : "";
  const which =
    counted != null
      ? counted
      : cnt != null
      ? `${cnt === 1 ? "one" : `up to ${cnt}`} ${failed}${noun}${cnt === 1 ? "" : "s"}${m.subset === "ones" ? " of 1" : ""}`
      : m.subset === "ones"
        ? `${rn === "any" ? "any" : "a"} ${noun} of 1`
        : m.subset === "all-failures"
          ? `a failed ${noun}`
          : rn === "any" ? "any roll" : `the ${noun}`;
  const pool = m.pool != null ? ` by spending a die from your ${titleCase(jstr(m.pool))}` : "";
  const can = m.mandatory === true ? "must" : "can";
  if (m.incoming === true) return `${incomingLead(m, subj)}the attacking player ${can} re-roll ${which}${pool}`;
  // "you can re-roll …" names whose roll it is unless that is the ability's own unit.
  const own = e.target == null || e.target === "this-unit" || e.target === "attacker" || (e.target === "recipient" && !ctx.auraRecipient);
  const model = e.target === "this-model" || (e.target === "selected-unit" && ctx.selectedModel);
  const holder = model ? weaponHolder(e.target, ctx) : subj;
  const owner = own ? "" : ` for ${["hit", "wound", "damage"].includes(rn) ? "attacks made by " : ""}${holder}`;
  return `you ${can} re-roll ${which}${owner}${weaponRollScope(m)}${pool}`;
}

function failedNoun(m: Record<string, unknown>, noun: string): string {
  return m.subset === "all-failures" ? `failed ${noun}` : m.subset === "ones" ? `${noun} of 1` : noun;
}

function rollResult(m: Record<string, unknown>, subj: string): string {
  const roll = rollName(m.roll);
  const lead = m.incoming === true ? incomingLead(m, subj) : "";
  if (m.critical_on != null) {
    const crit = m.roll === "wound" ? "Critical Wound" : "Critical Hit";
    if (m.critical_on === "success") return `${lead}each successful ${roll} roll${lead ? "" : ` made by ${subj}`}${weaponRollScope(m)} is a ${crit}`;
    return `${lead}${lead ? "a" : `${subj} ${v(subj, "scores")}`} ${crit}${lead ? "" : "s"} on ${roll} rolls of ${jstr(m.critical_on)}+${weaponRollScope(m)}${lead ? " for that attack" : ""}`;
  }
  if (m.fails_on != null) {
    const n = Number(m.fails_on);
    const range = n === 1 ? "1" : `1-${n}`;
    if (lead) return `${lead}an unmodified ${roll} roll of ${range} for that attack always fails`;
    return `${ofOrPossessive(subj, `${roll} rolls`)}${weaponRollScope(m)} always fail on an unmodified ${range}`;
  }
  if (m.succeeds_on != null) {
    const rolls = lead ? `the ${roll} roll for that attack` : ofOrPossessive(subj, `${roll} rolls`);
    return `${lead}${rolls}${lead ? "" : weaponRollScope(m)} ${lead ? "succeeds" : "succeed"} only on an unmodified ${jstr(m.succeeds_on)}+`;
  }
  const tests = ["battle-shock", "leadership", "desperate-escape"].includes(jstr(m.roll));
  if (tests && !lead) {
    if (m.result === "pass") return `${subj} automatically ${v(subj, "passes")} ${roll} tests`;
    if (m.result === "fail") return `${subj} automatically ${v(subj, "fails")} ${roll} tests`;
  }
  const whose = lead ? `the ${roll} roll for that attack` : ofOrPossessive(subj, `${roll} rolls`);
  const verb = lead ? { pass: "automatically succeeds", fail: "automatically fails" } : { pass: "automatically succeed", fail: "automatically fail" };
  if (m.result === "pass" || m.result === "fail") return `${lead}${whose}${lead ? "" : weaponRollScope(m)} ${verb[m.result]}`;
  const unmod = m.unmodified === true ? "an unmodified " : "";
  return `${lead}${whose}${lead ? " counts" : `${weaponRollScope(m)} count`} as ${unmod}${jstr(m.result)}`;
}

function abilityGrant(m: Record<string, unknown>, subj: string): string {
  // Cover is a state a unit has, not an ability it gains.
  if (m.ability === "benefit-of-cover") return `${subj} ${v(subj, "has")} the Benefit of Cover`;
  const inch = m.ability === "scouts" || m.ability === "deep-strike" ? '"' : "";
  const value = m.value != null ? ` ${jstr(m.value)}${inch}` : "";
  const noun = m.rules_bundle === true ? "rules" : "ability";
  return `${subj} ${v(subj, "gains")} the ${abilityLabel(m.ability)}${value} ${noun}`;
}

function keywordGrant(m: Record<string, unknown>, subj: string): string {
  const kws = Array.isArray(m.keywords) ? (m.keywords as unknown[]).map(jstr) : [];
  const noun = kws.length === 1 ? "keyword" : "keywords";
  const replaces = Array.isArray(m.replaces) ? `, replacing ${pronoun(subj)} ${andList((m.replaces as unknown[]).map(jstr))} ${m.replaces.length === 1 ? "keyword" : "keywords"}` : "";
  return `${subj} ${v(subj, "gains")} the ${andList(kws)} ${noun}${replaces}`;
}

function weaponAbilityGrant(e: Leaf, m: Record<string, unknown>, subj: string, ctx: Ctx): string {
  const kws = Array.isArray(m.abilities) ? (m.abilities as unknown[]).map(bracketKeyword).join(" and ") : "[?]";
  const increment = m.if_present === "increment" ? " (a weapon that already has that ability adds the ratings together)" : "";
  if (m.incoming === true) return `${incomingLead(m, subj)}the attacking weapon has ${kws}${increment}`;
  if (hasWeapon(m)) return `${weaponNoun(m)} equipped by ${weaponHolder(e.target, ctx)} gain ${kws}${increment}`;
  return `${ofOrPossessive(subj, "weapons")} gain ${kws}${increment}`;
}

const ASPECTS: Record<string, string> = {
  uses: "number of uses", range: "range", targets: "number of targets", recipients: "recipients", selections: "number of selections",
  concurrent: "number that can apply at once", duration: "duration", "start-round": "first battle round", "end-round": "last battle round",
  threshold: "threshold", options: "options",
};

/** The ability an ability-modifier changes: a named one, the one a trigger used, or those reaching an audience. */
function modifiedAbility(ref: unknown, subj: string, ctx: Ctx): string {
  if (ref != null && typeof ref === "object") {
    const r = ref as Record<string, unknown>;
    if (r.event === "used") return "that ability";
    if (typeof r.keyword === "string") return `each ${r.keyword} ability of ${subj}`;
    return `each ability of ${subj} that affects ${effectSubject(r.affecting, ctx).replace(/^all /, "")}`;
  }
  return ofOrPossessive(subj, `${abilityLabel(ref)} ability`);
}

function abilityModifier(m: Record<string, unknown>, subj: string, ctx: Ctx, inline: Inline): string {
  const whose = modifiedAbility(m.ability, subj, ctx);
  const aspect = ASPECTS[jstr(m.aspect)] ?? jstr(m.aspect);
  const value = m.aspect === "range" && typeof m.value === "number" ? `${jstr(m.value)}"` : typeof m.value === "string" ? dekebab(m.value) : jstr(m.value);
  const cap = m.cap != null ? ` (to a maximum of ${jstr(m.cap)})` : "";
  const opt = m.add_option as { name?: unknown; effect?: unknown } | undefined;
  const recipients = m.recipients != null ? effectSubject(m.recipients, ctx) : undefined;
  const option = opt != null ? `the option ${titleCase(jstr(opt.name))} (${inline(opt.effect, ctx)})` : undefined;
  // An add with no value only widens the ability: it names the new recipients or option instead of a count.
  if (m.value == null && m.operation !== "set" && m.operation !== "lift-limit" && (recipients || option)) {
    const parts = [recipients && `${whose} can also affect ${recipients}`, option && `${whose} gains ${option}`].filter(Boolean);
    return parts.join("; ") + cap;
  }
  let s: string;
  switch (m.operation) {
    case "lift-limit": s = `${whose} has no limit on its ${aspect}`; break;
    case "set": s = `the ${aspect} of ${whose} ${m.aspect === "options" || m.aspect === "recipients" ? "are" : "is"} ${value}`; break;
    case "subtract": s = `decrease the ${aspect} of ${whose} by ${value}`; break;
    default: s = `increase the ${aspect} of ${whose} by ${value}`;
  }
  if (recipients) s += `; it can also affect ${recipients}`;
  if (option) s += `; add ${option}`;
  return s + cap + abilityLimits(m);
}

/** The limits on a changed allowance: once per battle round, never in the same phase, outside the shared limit. */
function abilityLimits(m: Record<string, unknown>): string {
  const parts: string[] = [];
  const per = m.cap_per as { count?: unknown; period?: unknown } | undefined;
  if (per != null) parts.push(`but it can be used at most ${Number(per.count) === 1 ? "once" : `${jstr(per.count)} times`} per ${dekebab(jstr(per.period))}`);
  if (m.not_same != null) parts.push(`but not in the same ${jstr(m.not_same)} as the use that triggered this`);
  if (m.consumes_shared_use === false) parts.push("and this use does not count toward that ability's limit for other units");
  return parts.length ? `, ${parts.join(", ")}` : "";
}

const ACTIVITIES: Record<string, string> = {
  shoot: "shoot", "declare-charge": "declare a charge", fight: "fight", "start-action": "start an Action", embark: "embark",
  disembark: "disembark", "fall-back": "Fall Back", advance: "Advance", "use-stratagem": "be targeted with Stratagems",
  "issue-order": "issue Orders", "attempt-ritual": "attempt Rituals", "use-enhancement": "use Enhancements", move: "move", observe: "act as an Observer",
};
const AFTER: Record<string, string> = {
  advance: "Advanced", "fall-back": "Fell Back", disembark: "disembarked", "normal-move": "made a Normal move",
  charge: "made a Charge move", "remain-stationary": "Remained Stationary", "set-up": "was set up",
};
const DESPITE: Record<string, string> = {
  engaged: "within Engagement Range of enemy units", "battle-shocked": "Battle-shocked", "shot-this-phase": "has already shot this phase",
  "fought-this-phase": "has already fought this phase", "disembarked-this-turn": "disembarked this turn",
  "stratagem-used-this-phase": "has already been targeted with that Stratagem this phase", "performing-action": "performing an Action",
  advanced: "Advanced this turn", "fell-back": "Fell Back this turn",
};
const IS_STATE = new Set(["engaged", "battle-shocked", "performing-action"]);
const AS_IF: Record<string, string> = {
  "shooting-phase": " as if it were your Shooting phase", "fight-phase": " as if it were the Fight phase", "snap-shooting": " using the Snap Shooting rules",
};

function permission(m: Record<string, unknown>, subj: string, ctx: Ctx): string {
  const it = subj.startsWith("all ") || / units\b/.test(subj) ? "they" : "it";
  const act =
    m.activity === "use-stratagem" && m.stratagem != null
      ? `be targeted with the ${titleCase(jstr(m.stratagem))} Stratagem`
      : ACTIVITIES[jstr(m.activity)] ?? jstr(m.activity);
  const into = m.into != null ? ` ${m.activity === "shoot" ? "at" : m.activity === "declare-charge" ? "against" : "into"} ${noneOf(effectSubject(m.into, ctx))}` : "";
  const reach = m.reach != null ? ` from up to ${jstr(m.reach)}" away` : "";
  let s = m.allow === false ? `${noneOf(subj)} cannot ${act}${into}` : `${subj} ${v(subj, "is")} eligible to ${act}${into}${reach}`;
  if (Array.isArray(m.after)) s += ` in a turn in which ${it} ${orList((m.after as unknown[]).map((a) => AFTER[jstr(a)] ?? jstr(a)))}`;
  if (Array.isArray(m.despite)) {
    const clauses = (m.despite as unknown[]).map((d) => {
      const phrase = DESPITE[jstr(d)] ?? jstr(d);
      if (IS_STATE.has(jstr(d))) return `${it === "they" ? "they are" : "it is"} ${phrase}`;
      // "they has already shot" → "they have already shot".
      return `${it} ${it === "they" ? phrase.replace(/^has /, "have ") : phrase}`;
    });
    s += ` even if ${orList(clauses)}`;
  }
  if (m.as_if != null) s += AS_IF[jstr(m.as_if)] ?? ` as if ${jstr(m.as_if)}`;
  if (m.next === true) s += `, and must be the next unit selected to ${act}`;
  if (m.counts_as_move != null) s += `; if ${it} ${it === "they" ? "do" : "does"}, ${it} ${it === "they" ? "count" : "counts"} as having made ${movedPhrase(m.counts_as_move)} this turn`;
  if (m.consumes_shared_use === false) s += "; this use does not count toward that Stratagem's once-per-phase limit for other units";
  return s;
}

const TARGET_KINDS: Record<string, string> = {
  attack: " with attacks", shoot: " with ranged attacks", fight: " with melee attacks", charge: " with a charge",
  stratagem: " with Stratagems", ability: " with abilities",
};

function targeting(m: Record<string, unknown>, subj: string, ctx: Ctx): string {
  const who = (m.by != null ? effectSubject(m.by, ctx) : m.target != null ? subj : "units").replace(/^all /, "");
  const attacking = typeof m.by === "object" || who === "units" || isPlural(who) ? (/\bmodels\b/.test(who) ? "the attacking model" : "the attacking unit") : who;
  const whom = m.target === "every-eligible" ? "every eligible target" : m.target != null ? effectSubject(m.target, ctx) : subj;
  const verb = m.may === "cannot-target" ? "cannot target" : m.may === "must-target" ? "must target" : "can target";
  const kind =
    m.kind === "stratagem" && m.stratagem != null
      ? ` with the ${titleCase(jstr(m.stratagem))} Stratagem`
      : hasWeapon(m) ? ` with ${weaponNoun(m)}` : TARGET_KINDS[jstr(m.kind)] ?? "";
  const range = m.range == null ? "" : m.may === "cannot-target" ? ` unless ${attacking} is within ${rangePhrase(m.range)}` : ` within ${rangePhrase(m.range)}`;
  const unless = m.only_if_none != null ? `, unless there is no other eligible ${effectSubject(m.only_if_none, ctx).replace(/^all /, "").replace(/ units\b/, " unit")}` : "";
  if (m.may === "redirect") {
    const to = effectSubject(m.to, ctx);
    const what = m.kind === "stratagem" ? "Stratagems" : m.kind === "shoot" ? "ranged attacks" : m.kind === "fight" ? "melee attacks" : "attacks";
    // One unit is targeted at a time: "that target a friendly ANATHEMA PSYKANA unit".
    const one = whom.startsWith("all ") || isPlural(whom) ? `a ${whom.replace(/^all /, "").replace(/ units\b/, " unit").replace(/ models\b/, " model")}`.replace(/^a ([aeiou])/i, "an $1") : whom;
    return `${what}${m.by != null ? ` made by ${who}` : ""} that target ${one} must target ${to} instead${m.if_eligible === true ? `, if ${to} is an eligible target` : ""}`;
  }
  const except = m.except === "core-stratagems" ? " (Core Stratagems can still target it)" : "";
  return `${who} ${verb} ${whom}${kind}${range}${unless}${except}`;
}

function countsAs(m: Record<string, unknown>, subj: string, ctx: Ctx): string {
  if (m.in_region != null) return `${subj} ${v(subj, "counts")} as being within ${regionPhrase(m.in_region as P)}`;
  return `${subj} ${v(subj, "counts")} as being within ${rangePhrase(m.within)} of ${m.of != null ? effectSubject(m.of, ctx) : "this model"}`;
}

const CORE_RULES: Record<string, [string, string]> = {
  "benefit-of-cover": ["has the Benefit of Cover", "cannot benefit from Cover"],
  charge: ["can charge", "cannot charge"],
  advance: ["can Advance", "cannot Advance"],
  "fall-back": ["can Fall Back", "cannot Fall Back"],
  "ordered-retreat": ["is not affected by Desperate Escape tests", "must take Desperate Escape tests"],
  "fire-overwatch": ["can fire Overwatch", "cannot fire Overwatch"],
  "desperate-escape": ["must take Desperate Escape tests", "is not affected by Desperate Escape tests"],
  "attacking-ends-hidden": ["stops being hidden when it attacks", "does not stop being hidden when it attacks"],
  "engaged-shooting-hit-penalty": ["suffers the -1 to Hit for shooting while within Engagement Range", "does not suffer the -1 to Hit for shooting while within Engagement Range"],
  "charge-bonus": ["receives the Charge bonus", "does not receive the Charge bonus"],
  hidden: ["can become hidden", "cannot become hidden"],
  "orders-end-on-battle-shock": ["loses its Orders when it becomes Battle-shocked", "keeps its Orders when it becomes Battle-shocked"],
};

function ruleState(m: Record<string, unknown>, subj: string): string {
  const granted = m.direction === "granted";
  const rule = jstr(m.rule);
  if (m.rule_kind === "faction-rule") return granted ? `${subj} ${v(subj, "gains")} ${titleCase(rule)}` : `${subj} cannot use ${titleCase(rule)}`;
  if (rule === "overwatch-against-bearer") return `your opponent ${granted ? "can" : "cannot"} target ${subj} with Overwatch`;
  const core = CORE_RULES[rule];
  if (m.rule_kind === "core-rule" && core) {
    const phrase = granted ? core[0] : core[1];
    if (phrase.startsWith("cannot ")) return `${noneOf(subj)} ${phrase}`;
    return `${subj} ${phrase.replace(/^(has|is|stops|does|suffers|receives|loses|keeps) /, (w) => `${v(subj, w.trim())} `)}`;
  }
  const noun = m.rule_kind === "keyword" ? "keyword" : m.rule_kind === "core-rule" ? "rule" : "ability";
  return granted ? `${subj} ${v(subj, "gains")} the ${titleCase(rule)} ${noun}` : `${subj} ${v(subj, "loses")} the ${titleCase(rule)} ${noun}`;
}

function abilityActivate(m: Record<string, unknown>, subj: string): string {
  const label = abilityLabel(m.ability);
  const consumed = m.ignore_consumed === true ? ", even if it has already been selected this battle" : "";
  const sel = m.select as { by?: unknown } | undefined;
  if (sel != null) {
    const how = sel.by === "roll" ? `make a new ${label} roll and activate one result it allows` : `select one option of ${label}`;
    return `${how} for ${subj}, in addition to any already active${consumed}`;
  }
  const override = m.override as { amount?: unknown } | undefined;
  const instead = override != null ? `, using ${diceCase(override.amount)} in place of its usual amount` : "";
  if (m.option == null) return `${subj} ${v(subj, "resolves")} the ${label} ability now${instead}`;
  return `the ${titleCase(jstr(m.option))} option of ${label} is active for ${subj}${m.exclusive === true ? " (and no other option is)" : ""}${consumed}`;
}

/** One single effect as a lowercase-initial clause. */
export function describeLeaf(e: Leaf, ctx: Ctx, inline: Inline): string {
  const m = e.modifier ?? {};
  const subj = effectSubject(e.target, ctx);
  switch (e.type) {
    case "stat-modifier": return statModifier(e, m, subj, ctx);
    case "ignore-modifiers": return ignoreModifiers(m, subj);
    case "roll-modifier": return rollModifier(m, subj);
    case "re-roll": return reRoll(e, m, subj, ctx);
    case "roll-result": return rollResult(m, subj);
    case "end-attack-sequence": return "the attack sequence ends";
    case "ability-grant": return abilityGrant(m, subj);
    case "keyword-grant": return keywordGrant(m, subj);
    case "weapon-ability-grant": return weaponAbilityGrant(e, m, subj, ctx);
    case "weapon-grant": {
      const count = Number(m.count ?? 1) || 1;
      return `${subj} ${v(subj, "gains")} ${count} ${weaponLabel(m.weapon_id)} weapon${count === 1 ? "" : "s"}`;
    }
    case "ability-modifier": return abilityModifier(m, subj, ctx, inline);
    case "ability-activate": return abilityActivate(m, subj);
    case "permission": return permission(m, subj, ctx);
    case "targeting": return targeting(m, subj, ctx);
    case "counts-as": return countsAs(m, subj, ctx);
    case "rule-state": return ruleState(m, subj);
    default: return describeShapeLeaf(e, m, subj, ctx) ?? describeBoardLeaf(e, m, subj, ctx, inline);
  }
}
