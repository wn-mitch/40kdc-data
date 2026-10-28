/**
 * The shared noun phrases of the condition describer: units, ranges, objectives, states,
 * designations, history windows and move kinds. ASCII-only; pinned across the ports.
 */

import { designationLabel } from "./designations.js";
import { diceCase } from "./effect-words.js";
import type { AbilityUsage } from "./effect.js";

/** A condition node's parameters. */
export type P = Record<string, unknown>;

/** kebab-case → space-separated words (`enemy-territory` → `enemy territory`). */
export function dekebab(s: string): string {
  return s.replace(/-/g, " ");
}

const TITLE_SMALL: Record<string, true> = {
  of: true, or: true, and: true, the: true, a: true, an: true,
  to: true, in: true, on: true, for: true, with: true,
};

/** Kebab-case identifier to a display name with lowercase linking words. */
export function titleCase(s: string): string {
  return dekebab(s)
    .split(" ")
    .map((word, index) =>
      index > 0 && TITLE_SMALL[word.toLowerCase()]
        ? word.toLowerCase()
        : word ? word[0]!.toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

/**
 * Faction dir slugs an ability or Stratagem id ends with (`<name>-<faction>`), longest first. The
 * suffix is identity, not name, so it never reaches the English.
 */
const FACTION_SUFFIXES: readonly string[] = ["agents-of-the-imperium", "chaos-space-marines", "adeptus-mechanicus", "leagues-of-votann", "emperors-children", "genestealer-cults", "adepta-sororitas", "imperial-knights", "adeptus-custodes", "adeptus-astartes", "astra-militarum", "black-templars", "imperial-fists", "chaos-knights", "thousand-sons", "chaos-daemons", "blood-angels", "ultramarines", "space-wolves", "grey-knights", "world-eaters", "white-scars", "raven-guard", "dark-angels", "salamanders", "death-guard", "iron-hands", "tau-empire", "deathwatch", "drukhari", "tyranids", "aeldari", "necrons", "orks"];

/** An ability or Stratagem id without its faction suffix ("acts-of-faith-adepta-sororitas" → "acts-of-faith"). */
export function withoutFactionSuffix(id: string): string {
  for (const f of FACTION_SUFFIXES) if (id.endsWith(`-${f}`) && id.length > f.length + 1) return id.slice(0, -f.length - 1);
  return id;
}

/** Ids whose name itself ends with the faction (the suffix was never added). */
const WHOLE_NAMES: Readonly<Record<string, string>> = { "lord-of-the-death-guard": "Lord of the Death Guard" };

/** An ability or Stratagem id as a name: its name part in Title Case. */
export function idLabel(id: unknown): string {
  const s = str(id);
  return WHOLE_NAMES[s] ?? titleCase(withoutFactionSuffix(s));
}

export function str(v: unknown): string {
  if (v == null) return "?";
  return typeof v === "string" ? v : String(v);
}

export function orList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

export function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Causal links name an exact bound event; sharing its actor is not enough. */
export function eventRelationPhrase(filter: P): string {
  let phrase = "";
  if (filter.caused_by != null) phrase += " as a result of the exact bound event";
  if (filter.causes != null) phrase += " and causing the exact bound event";
  return phrase;
}

/** Inclusive count bounds, shared by selectors and counted predicates. */
export function countPhrase(value: unknown, defaultMin = 1): string {
  const c = (value ?? {}) as P;
  if (c.min != null && c.max != null) {
    if (c.min === c.max) return `exactly ${diceCase(c.min)}`;
    return typeof c.min === "number" && typeof c.max === "number" ? `${c.min}-${c.max}` : `between ${diceCase(c.min)} and ${diceCase(c.max)}`;
  }
  if (c.max != null) return `at most ${diceCase(c.max)}`;
  const min = c.min ?? defaultMin;
  return typeof min === "number" ? `${min}+` : `at least ${diceCase(min)}`;
}

/** A named rule or one immutable option of a named ability. */
export function ruleRefPhrase(value: unknown): string {
  if (value != null && typeof value === "object") {
    const ref = value as P;
    if (ref.definition_id != null) return `${idLabel(ref.definition_id)} ability of ${idLabel(ref.ability_id)}`;
    return `${idLabel(ref.option_id)} option of ${idLabel(ref.ability_id)}`;
  }
  return idLabel(value);
}

export function keywordList(p: P): string {
  if (p.chosen_by != null) return `the keyword selected for ${titleCase(str(p.chosen_by))}`;
  if (Array.isArray(p.any_of)) return orList(p.any_of.map((k) => `"${str(k)}"`));
  return andList(((p.all_of as unknown[]) ?? []).map((k) => `"${str(k)}"`));
}

export const ORDINAL = ["zeroth", "first", "second", "third", "fourth", "fifth"];
export const ord = (n: number): string => ORDINAL[n] ?? `${n}th`;

// ── Shared references ───────────────────────────────────────────────────────

const ROLE_PHRASES: Record<string, string> = {
  "this-unit": "the unit",
  "this-model": "this model",
  "model-in-this-unit": "a model in this unit",
  attacker: "the attacking unit",
  defender: "the target unit",
  "event-subject": "the triggering unit",
  "event-object": "that unit",
  "stratagem-target": "the Stratagem's target",
  "selected-unit": "the selected unit",
  recipient: "the unit",
  "bearer-transport": "the Transport this unit is embarked within",
  "ability-unit": "this unit",
};

/**
 * A filter's `any_of_filters` as keyword spellings ("LEGIO CYBERNETICA", "ADEPTUS MECHANICUS
 * VEHICLE") when each alternative is only its keywords and the filter requires none of its own,
 * so "an A or B C unit" says it; else null.
 */
export function keywordAlternatives(f: P): string[] | null {
  if (!Array.isArray(f.any_of_filters) || Array.isArray(f.all_of)) return null;
  const alts = f.any_of_filters as P[];
  const plain = alts.every((a) => a != null && typeof a === "object" && Array.isArray(a.all_of) && (a.all_of as unknown[]).length > 0 && Object.keys(a).every((k) => k === "all_of"));
  return plain ? alts.map((a) => (a.all_of as unknown[]).map(str).join(" ")) : null;
}

/** Each alternative of `any_of_filters` as a filter of the outer filter's level (models or units). */
export function alternativeFilters(f: P): P[] {
  return (f.any_of_filters as P[]).map((a) => (f.level != null ? { ...a, level: f.level } : a));
}

/** A unit filter as a noun phrase: "a friendly ADEPTUS MECHANICUS BATTLELINE unit". */
export function unitFilterPhrase(f: P): string {
  const owner = f.owner === "friendly" ? "friendly " : f.owner === "enemy" ? "enemy " : "";
  const all = Array.isArray(f.all_of) ? `${(f.all_of as unknown[]).map(str).join(" ")} ` : "";
  const noun = f.level === "model" ? `${f.attachment_role != null ? `${str(f.attachment_role)} ` : ""}model` : "unit";
  // "a friendly LEGIO CYBERNETICA or ADEPTUS MECHANICUS VEHICLE unit": keyword-only alternatives.
  const compact = keywordAlternatives(f);
  let s = compact ? `${owner}${orList(compact)} ${noun}` : `${owner}${all}${noun}`;
  s = `${/^(?:[aeio]|u(?!ni))/i.test(s) ? "an" : "a"} ${s}`;
  // Any other alternatives: "a unit that is a PSYKER unit or a unit that is Battle-shocked".
  if (Array.isArray(f.any_of_filters) && !compact) s += ` that is ${orList(alternativeFilters(f).map(unitFilterPhrase))}`;
  if (Array.isArray(f.any_of)) s += ` with the ${orList((f.any_of as unknown[]).map(str))} keyword`;
  if (Array.isArray(f.none_of)) s += ` (excluding ${orList((f.none_of as unknown[]).map(str))} ${noun}s)`;
  if (Array.isArray(f.not_all_of)) s += ` (excluding ${(f.not_all_of as unknown[]).map(str).join(" ")} ${noun}s)`;
  if (Array.isArray(f.has_ability)) s += ` with the ${andList((f.has_ability as unknown[]).map((a) => idLabel(a)))} ability`;
  if (Array.isArray(f.lacks_ability)) s += ` without the ${orList((f.lacks_ability as unknown[]).map((a) => idLabel(a)))} ability`;
  if (Array.isArray(f.model_names)) s += ` named ${orList(f.model_names.map(str))}`;
  if (Array.isArray(f.unit_ids)) s += ` with unit ID ${orList(f.unit_ids.map(str))}`;
  if (f.embarked_in != null) s += ` embarked within ${unitRefPhrase(f.embarked_in)}`;
  if (f.member_of != null) s += ` in ${unitRefPhrase(f.member_of)}`;
  if (f.engaged_with != null) s += ` within Engagement Range of ${unitRefPhrase(f.engaged_with)}`;
  if (f.not_engaged_with != null) s += ` not within Engagement Range of ${typeof f.not_engaged_with === "object" && f.not_engaged_with !== null && !("selection_var" in f.not_engaged_with) && !("event_var" in f.not_engaged_with) && !("stratagem_target" in f.not_engaged_with) ? `any ${unitRefPhrase(f.not_engaged_with).replace(/^an? /, "")}` : unitRefPhrase(f.not_engaged_with)}`;
  if (f.designated != null) s += ` that is ${designationPhrase(str(f.designated))}${f.designated_by != null ? ` by ${unitRefPhrase(f.designated_by)}` : ""}`;
  if (f.not_designated != null) s += ` that is not ${designationPhrase(str(f.not_designated))}`;
  if (f.state != null) s += ` that is ${statePhrase(str(f.state))}`;
  if (Array.isArray(f.not_states)) s += ` that is ${andList((f.not_states as unknown[]).map((x) => statePhrase(str(x), true)))}`;
  if (f.visible != null) s += ` that is visible to ${unitRefPhrase((f.visible as P).to)}`;
  const within = f.within as P | undefined;
  if (within != null) s += ` ${within.wholly === true ? "wholly " : ""}within ${rangePhrase(within.range)}${within.of != null ? ` of ${placeRefPhrase(within.of)}` : ""}`;
  if (f.excluding != null) s += ` other than ${f.excluding === "this-unit" ? "this unit" : unitRefPhrase(f.excluding)}`;
  return s;
}

/** A unit-ref as a noun phrase; `fallback` names the default subject. */
export function unitRefPhrase(ref: unknown, fallback = "the unit"): string {
  if (ref == null) return fallback;
  if (typeof ref === "string") return ROLE_PHRASES[ref] ?? dekebab(ref);
  if (typeof ref === "object") {
    const r = ref as P;
    if (typeof r.event_var === "string") return "that unit";
    if (typeof r.selection_var === "string") return `the bound ${str(r.selection_var).replace(/_/g, " ")}`;
    if (typeof r.stratagem_target === "string") return `the ${dekebab(r.stratagem_target.replace(/^the-/, ""))} target`;
    return unitFilterPhrase(r);
  }
  return fallback;
}

/** The subject of a predicate; `defender` reads "the target" in the keyword forms. */
export function subjectOf(p: P, fallback = "the unit"): string {
  return unitRefPhrase(p.subject, fallback);
}

const AURA_RANGES: Record<string, string> = { "nurgles-gift-death-guard": "Contagion Range", "synapse-tyranids": "Synapse Range" };

/** A range-ref as a distance phrase ("6\"", "Engagement Range", "Contagion Range"). */
export function rangePhrase(r: unknown): string {
  if (r == null) return '?"';
  if (typeof r === "string") {
    return ({
      engagement: "Engagement Range", aura: "its aura range", weapon: "the attacking weapon's range",
      "half-weapon": "half the attacking weapon's range", detection: "detection range", "objective-control": "range",
    } as Record<string, string>)[r] ?? dekebab(r);
  }
  const o = r as P;
  if (o.inches != null) return `${str(o.inches)}"`;
  if (o.aura_of != null) return AURA_RANGES[str(o.aura_of)] ?? `the ${idLabel(o.aura_of)} range`;
  if (Array.isArray(o.per_battle_round)) return `${o.per_battle_round.map(rangePhrase).join(", ")} in battle rounds ${o.per_battle_round.map((_, i) => i + 1).join(", ")} respectively (using the final range in later battle rounds)`;
  return '?"';
}

/** A spatial anchor, retaining objective and marker identities. */
export function placeRefPhrase(ref: unknown): string {
  if (ref === "battlefield-edge") return "a battlefield edge";
  if (ref === "battlefield-centre") return "the centre of the battlefield";
  if (ref != null && typeof ref === "object") {
    const p = ref as P;
    if (p.objective != null) {
      const objective = p.objective as P;
      if (objective.selection_var != null) return "that objective marker";
      const phrase = objectivePhrase(objective, false, "objective marker");
      return `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;
    }
    if (p.marker != null) return `${/^[aeiou]/i.test(str(p.marker)) ? "an" : "a"} ${dekebab(str(p.marker))} marker`;
  }
  return unitRefPhrase(ref);
}

export function objectivePhrase(f: P, plural = false, noun = "objective"): string {
  const role = f.role === "non-home" ? "" : f.role != null ? `${dekebab(str(f.role))} ` : "";
  let s = `${role}${noun}${plural ? "s" : ""}`;
  if (f.home_of === "enemy") s += " (opponent home)";
  if (f.home_of === "friendly") s += " (your home)";
  if (f.name != null) s += ` (${dekebab(str(f.name))})`;
  if (f.territory != null) s += ` in ${territoryPhrase(str(f.territory))}`;
  if (f.role === "non-home") s += " (excluding home)";
  const within = f.within as P | undefined;
  // Your control, within this unit's own range of it: the unit itself is controlling it.
  const unitControls = f.controlled_by === "friendly" && within?.range === "objective-control" && within.of === "this-unit";
  if (unitControls) s += " your unit controls";
  else if (f.controlled_by === "friendly") s += " you control";
  if (f.controlled_by === "enemy") s += " your opponent controls";
  if (f.designated != null) s += ` tagged ${dekebab(str(f.designated))}`;
  if (f.within != null && !unitControls) {
    const within = f.within as P;
    s += ` within ${rangePhrase(within.range)} of ${placeRefPhrase(within.of)}`;
  }
  // "that your unit was controlling when it was destroyed": the unit's control when the rule was triggered.
  if (f.controlled_by_unit != null) s += ` that ${unitRefPhrase(f.controlled_by_unit)} was controlling when the rule was triggered`;
  if (f.clear_of != null) s += `, with no ${unitFilterPhrase(f.clear_of as P).replace(/^an? /, "").replace(/\bunit\b/, "units")} within range of it`;
  return s;
}

const STATE_PHRASES: Record<string, string> = {
  engaged: "engaged", "battle-shocked": "Battle-shocked", embarked: "embarked",
  "in-strategic-reserves": "in Strategic Reserves", "in-cult-ambush": "in Cult Ambush", "on-battlefield": "on the battlefield",
  hidden: "hidden", "fights-first": "a Fights First unit", "benefit-of-cover": "receiving the benefit of cover",
};
const NEGATED_STATE: Record<string, string> = { engaged: "unengaged" };
export function statePhrase(state: string, negated = false): string {
  if (negated) return NEGATED_STATE[state] ?? `not ${STATE_PHRASES[state] ?? dekebab(state)}`;
  return STATE_PHRASES[state] ?? dekebab(state);
}

/** A designation: a registered id prints the rules' term, legacy upper-case tags stay as printed, internal ones are spelled out. */
export function designationPhrase(tag: string, plural = false): string {
  const label = designationLabel(tag, plural);
  if (label != null) return label;
  return tag === tag.toUpperCase() ? tag : `tagged ${dekebab(tag)}`;
}

const WINDOW_PHRASES: Record<string, string> = {
  phase: "this phase", turn: "this turn", round: "this battle round", battle: "this battle",
  "previous-turn": "in the previous turn", event: "",
};
export const windowPhrase = (w: unknown): string => WINDOW_PHRASES[str(w)] ?? dekebab(str(w));
export const withWindow = (s: string, w: unknown): string => (windowPhrase(w) ? `${s} ${windowPhrase(w)}` : s);

/** Past tense of the verbs history predicates use. */
const PAST: Record<string, string> = {
  charge: "charged", advance: "advanced", "fall back": "fell back", "remain stationary": "remained stationary",
  "make an ingress move": "made an ingress move", move: "moved", disembark: "disembarked",
};
export const pastOf = (verb: string): string => PAST[verb] ?? (verb.startsWith("make ") ? `made ${verb.slice(5)}` : verb);

const MOVE_NAMES: Record<string, string> = {
  normal: "Normal", advance: "Advance", "remain-stationary": "Remain Stationary", "fall-back": "Fall Back", charge: "Charge",
  "pile-in": "Pile-in", consolidation: "Consolidation", ingress: "ingress", surge: "Surge", scout: "Scout", disembark: "Disembark",
};
export function moveKinds(types: unknown): string {
  return orList((Array.isArray(types) ? types : []).map((t) => MOVE_NAMES[str(t)] ?? dekebab(str(t))));
}

/** A roll kind as words: "hit", or the dice a named ability rolls ("Reanimation Protocols"). */
export function rollWord(roll: unknown): string {
  if (roll != null && typeof roll === "object" && (roll as P).of_ability != null) return idLabel((roll as P).of_ability);
  return dekebab(str(roll));
}

/** Kinds of rule a `used` filter can name one member of, as "the X <noun>" (an ability is its name alone). */
const NAMED_USE_NOUNS: Record<string, string> = { manoeuvre: "Agile Manoeuvre", stratagem: "Stratagem", action: "action" };

/** One named rule a `used` filter names by id ("Reanimation Protocols", "the Swift as the Wind Agile Manoeuvre"), or undefined. */
export function namedUsePhrase(f: P): string | undefined {
  if (f.id == null) return undefined;
  if (f.kind === "ability") return idLabel(f.id);
  const noun = NAMED_USE_NOUNS[str(f.kind)];
  return noun == null ? undefined : `the ${idLabel(f.id)} ${noun}`;
}
/** Usage limit as a shared phrase for activation limits and used-ability predicates. */
export function usageClause(u: AbilityUsage | AbilityUsage[]): string {
  if (Array.isArray(u)) return u.map((x) => usageClause(x)).join(" and ");
  const n = Number(u.count ?? 1);
  let base: string;
  switch (u.frequency) {
    case "once-per-turn": base = "once per turn"; break;
    case "once-per-phase": base = "once per phase"; break;
    case "once-per-battle-round": base = "once per battle round"; break;
    case "once-per-command-phase": base = "once per Command phase"; break;
    case "once-per-opponent-turn": base = "once per opponent's turn"; break;
    case "first-this-battle": base = "the first time this battle"; break;
    case "first-time-this-phase": base = "the first time this phase"; break;
    case "n-per-battle": base = n === 1 ? "once per battle" : n === 2 ? "twice per battle" : `${str(n)} times per battle`; break;
    default: base = dekebab(str(u.frequency));
  }
  return u.per != null ? `${base} per ${str(u.per)}` : base;
}


/** Which ability a `used` filter names: one id, every ability with a bracketed keyword, or the same one as a bound use. */
export function usedAbilityPhrase(f: P): string | undefined {
  let phrase = f.ability_keyword != null ? `a ${titleCase(str(f.ability_keyword).toLowerCase())} ability`
    : f.same_rule_as != null ? `that same ${f.kind === "stratagem" ? "Stratagem" : "ability"}`
    : f.source != null || f.usage != null ? namedUsePhrase(f) ?? "an ability" : undefined;
  if (phrase === undefined) return undefined;
  if (Array.isArray(f.source)) phrase += ` from ${orList(f.source.map((source) => source === "unit" ? "its datasheet" : source === "enhancement" ? "an Enhancement" : dekebab(str(source))))}`;
  if (f.usage != null && typeof f.usage === "object") phrase += ` that can be used ${usageClause(f.usage as AbilityUsage)}`;
  return phrase;
}

/** "your opponent's deployment zone": a deployment zone is named by whose it is; other territories by their words. */
const TERRITORY_PHRASES: Record<string, string> = { "your-deployment-zone": "your deployment zone", "enemy-deployment-zone": "your opponent's deployment zone" };
function territoryPhrase(territory: string): string {
  return TERRITORY_PHRASES[territory] ?? dekebab(territory);
}
