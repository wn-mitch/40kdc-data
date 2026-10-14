/**
 * The shared words of the effect describer: the rendering context, subject phrases for effect
 * targets, verb agreement, and the name tables for characteristics, rolls, tests and pools.
 * ASCII-only; pinned byte-for-byte across the ports by `conformance/effect-translation`.
 */

import { alternativeFilters, andList, designationPhrase, dekebab, idLabel, keywordAlternatives, orList, placeRefPhrase, rangePhrase, statePhrase, titleCase, type P } from "./condition-refs.js";
import { designationLabel } from "./designations.js";

export { andList, dekebab, orList, rangePhrase, titleCase };

/** Rendering context threaded down from the containers to the leaves. */
export interface Ctx {
  /** Inside a `select-units` / `for-each-unit`: the selected unit reads "that unit". */
  selectedUnit?: boolean;
  /** Inside a model-level selection: the selected model reads "that model". */
  selectedModel?: boolean;
  /** Explicit beneficiary binding inside a designated attack. */
  unitSubject?: string;
  /** Inside an aura: the recipient reads "that unit". */
  auraRecipient?: boolean;
  /** The ability's trigger already says a unit or model is destroyed; leaves must not repeat it. */
  destroyedTrigger?: boolean;
}

/** `{rating: true}`: the rating the unit's datasheet prints for this rule (substituted when a unit is known). */
export function isRatingRef(v: unknown): boolean {
  return v != null && typeof v === "object" && !Array.isArray(v) && (v as P).rating === true;
}

/** JS-template stringification (numbers print without trailing `.0`). */
export function jstr(v: unknown): string {
  if (v == null) return "?";
  if (Array.isArray(v)) return v.map(jstr).join(", ");
  return String(v);
}

/** Uppercase the first character (idempotent; leaves the rest untouched). */
export function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** Dice tokens print with a capital `D` (`d3` → `D3`, `2d6` → `2D6`); a bound or counted quantity prints its phrase. */
export function diceCase(v: unknown): string {
  if (v != null && typeof v === "object" && !Array.isArray(v)) return quantityPhrase(v as P);
  return jstr(v).replace(/d/gi, "D");
}

const BATTLE_SIZES = ["incursion", "strike-force", "onslaught"] as const;

/** What a count-of / scaling source counts, as a noun phrase. */
export const SCALE_OF: Record<string, string> = {
  "enemy-models-in-range": "enemy models",
  "friendly-models-in-range": "friendly models",
  "models-in-bearer-unit": "models in this unit",
  "models-in-or-embarked-in-bearer": "models in or embarked within this model",
  "models-embarked-in-bearer": "models embarked within this model",
  "embarked-models-oc": "Objective Control of the models embarked within this model",
  "models-equipped-with": "models in this unit equipped with",
  "enemy-units-in-range": "enemy units",
  "wounds-lost": "wounds lost",
  "battle-round": "battle round",
};

/** A count source with its keyword / wargear qualifier: "models in this unit with the SPYDER keyword". */
export function scaleSource(q: P): string {
  const of = jstr(q.count_of ?? q.of);
  let s = SCALE_OF[of] ?? dekebab(of);
  if (of === "models-equipped-with") s += ` ${titleCase(jstr(q.wargear))}`;
  if (q.keyword != null) s = s.replace(/^models\b/, `${jstr(q.keyword)} models`);
  if (q.within != null) s += ` within ${rangePhrase(q.within)}`;
  return s;
}

/**
 * A non-literal quantity as a noun phrase: one value per battle size, a bound roll's result, or a count.
 * Literal numbers and dice go through {@link diceCase}.
 */
export function quantityPhrase(q: P): string {
  if (isRatingRef(q)) return "its rating";
  if (BATTLE_SIZES.every((k) => q[k] != null)) return `${BATTLE_SIZES.map((k) => jstr(q[k])).join("/")} (Incursion/Strike Force/Onslaught)`;
  if (typeof q.roll_var === "string") return q.successes_on != null ? `the number of those dice that rolled a ${jstr(q.successes_on)}+` : "the result of that roll";
  if (q.count_of === "battle-round") return "the battle round number";
  if (q.count_of === "embarked-models-oc") return `the total ${scaleSource(q)}`;
  if (q.count_of != null) return `the number of ${scaleSource(q)}`;
  return "?";
}

/** Whether a quantity is a literal number or dice expression (it reads "D3 mortal wounds", not "a number of"). */
export function isLiteral(q: unknown): boolean {
  return q == null || typeof q !== "object";
}

/** "D3 mortal wounds", or "a number of mortal wounds equal to the result of that roll". */
export function amountOf(q: unknown, one: string, many: string): string {
  if (isLiteral(q)) {
    const n = diceCase(q);
    return `${n} ${n === "1" ? one : many}`;
  }
  const p = q as P;
  if (BATTLE_SIZES.every((k) => p[k] != null)) return `${BATTLE_SIZES.map((k) => jstr(p[k])).join("/")} ${many} (Incursion/Strike Force/Onslaught)`;
  return `a number of ${many} equal to ${quantityPhrase(p)}`;
}

/** A structured catalog weapon keyword reference as a bracketed rules label. */
export function bracketKeyword(k: unknown): string {
  if (k == null || typeof k !== "object" || Array.isArray(k)) return "[?]";
  const ref = k as P;
  const p = (ref.parameters ?? {}) as P;
  const name = dekebab(jstr(ref.keyword_id)).toUpperCase();
  const against = Array.isArray(p.required_target_keywords_any) && p.required_target_keywords_any.length ? ` (against ${orList(p.required_target_keywords_any.map(jstr))} units)` : "";
  const excluding = Array.isArray(p.excluded_target_keywords) && p.excluded_target_keywords.length ? ` (excluding ${orList(p.excluded_target_keywords.map(jstr))} units)` : "";
  if (ref.keyword_id === "anti") {
    const target = p.target_keyword != null ? `-${jstr(p.target_keyword).toUpperCase()}` : "";
    return `[ANTI${target}${p.threshold != null ? ` ${jstr(p.threshold)}+` : ""}]${against}${excluding}`;
  }
  return `[${name}${p.value != null ? ` ${diceCase(p.value)}` : ""}]${against}${excluding}`;
}

const TEST_NAMES: Record<string, string> = { "battle-shock": "Battle-shock", "desperate-escape": "Desperate Escape" };
export function testName(test: unknown): string {
  const t = jstr(test);
  return TEST_NAMES[t] ?? titleCase(t);
}

/** Does a subject noun phrase take a plural verb? (`enemy units within 6"`, `all friendly units`). */
export function isPlural(subj: string): boolean {
  return / (units|models)\b/.test(subj) || /^all /.test(subj) || /^targets /.test(subj);
}

const PLURAL_VERBS: Record<string, string> = {
  has: "have", is: "are", gets: "get", gains: "gain", suffers: "suffer", retains: "retain", makes: "make",
  passes: "pass", fails: "fail", treats: "treat", regains: "regain", counts: "count", ignores: "ignore", loses: "lose",
  scores: "score", takes: "take", resolves: "resolve", does: "do", controls: "control", receives: "receive", keeps: "keep",
};
/** Subject-verb agreement: the plural form of a present-tense verb when the subject is plural. */
export function v(subj: string, singular: string): string {
  if (!isPlural(subj)) return singular;
  return PLURAL_VERBS[singular] ?? singular.replace(/s$/, "");
}

const STAT_NAMES: Record<string, string> = {
  M: "Move", T: "Toughness", Sv: "Save", W: "Wounds", A: "Attacks", Ld: "Leadership", OC: "Objective Control",
  S: "Strength", WS: "Weapon Skill", BS: "Ballistic Skill", AP: "Armour Penetration", D: "Damage", Range: "Range",
  "detection-range": "detection range",
};
export function statName(stat: unknown): string {
  const s = jstr(stat);
  return STAT_NAMES[s] ?? titleCase(s);
}

/** Resource-pool token → display name (`cp` → `CP`, otherwise Title Case). */
export function poolName(pool: unknown): string {
  const p = jstr(pool);
  return p.toLowerCase() === "cp" ? "CP" : titleCase(p);
}

/** The unit of resource a pool holds, singular, for pools whose id does not name it. */
const POOL_UNITS: Record<string, string> = { "blood-tithe": "Blood Tithe point", "battle-focus": "Battle Focus token", yp: "YP" };
/** Countable nouns a pool id can end in: singular → plural. */
const POOL_NOUNS: Record<string, [string, string]> = {
  dice: ["die", "dice"], die: ["die", "dice"], token: ["token", "tokens"], tokens: ["token", "tokens"],
  point: ["point", "points"], points: ["point", "points"], marker: ["marker", "markers"],
};

/**
 * A pool's noun: its author label (pluralized by count), else the resource the pool holds —
 * "1 Miracle die", "2 Pain tokens" — never the pool itself ("1 Miracle Dice Pool").
 */
export function resourceNoun(pool: unknown, label: unknown, count?: unknown): string {
  const one = Number(jstr(count)) === 1;
  if (typeof label === "string" && label.length > 0) return one ? label : `${label}s`;
  const id = jstr(pool).toLowerCase();
  if (id === "cp") return "CP";
  const base = id.replace(/-pool$/, "");
  const unit = POOL_UNITS[base];
  if (unit) return unit === "YP" || one ? unit : `${unit}s`;
  const words = base.split("-");
  const noun = POOL_NOUNS[words[words.length - 1]!];
  if (!noun) return titleCase(base);
  const head = titleCase(words.slice(0, -1).join("-"));
  return `${head ? `${head} ` : ""}${one ? noun[0] : noun[1]}`;
}

const ROLL_NAMES: Record<string, string> = {
  hit: "Hit", wound: "Wound", charge: "Charge", damage: "Damage", advance: "Advance", save: "saving throw",
  leadership: "Leadership", "battle-shock": "Battle-shock", "desperate-escape": "Desperate Escape", "normal-move": "Normal move",
  "deadly-demise": "Deadly Demise", "dark-pact": "Dark Pact", "blessings-of-khorne": "Blessings of Khorne", "resource-die": "pool die",
  manoeuvre: "Agile Manoeuvre", channelling: "Channel the Warp",
};
export function rollName(roll: unknown): string {
  // The dice a named ability rolls: "Reanimation Protocols".
  if (roll != null && typeof roll === "object" && (roll as P).of_ability != null) return abilityLabel((roll as P).of_ability);
  const r = jstr(roll);
  return ROLL_NAMES[r] ?? titleCase(r);
}

/** `+1` / `-1` from an operation + value (a negative value flips the sign, so never `+-1`). */
export function signed(operation: unknown, value: unknown): string {
  let sign = operation === "add" || operation === "improve" ? 1 : -1;
  const n = Number(value);
  if (!Number.isNaN(n) && n < 0) {
    sign = -sign;
    value = Math.abs(n);
  }
  return `${sign > 0 ? "+" : "-"}${diceCase(value)}`;
}

/** Dice comparison → "a 4+", "a 3 or less", etc. (for dice-gated thresholds). */
export function formatComparison(comp: string, threshold: unknown): string {
  const th = jstr(threshold);
  switch (comp) {
    case "lte": return `a ${th} or less`;
    case "gt": return `greater than ${th}`;
    case "lt": return `less than ${th}`;
    case "eq": return `exactly ${th}`;
    default: return `a ${th}+`;
  }
}

/** Possessive form of a subject noun phrase (`the unit` → `the unit's`). */
export function possessive(s: string): string {
  return s.endsWith("s") ? `${s}'` : `${s}'s`;
}

/** `<subj>'s <rest>`, or `the <rest> of <subj>` when the subject is a clause ending in a range. */
export function ofOrPossessive(subj: string, rest: string): string {
  return / (within|other than|that|with) /.test(subj) || subj.endsWith('"') ? `the ${rest} of ${subj}` : `${possessive(subj)} ${rest}`;
}

/** The subject of a "cannot" clause: "all enemy units cannot …" reads "enemy units cannot …". */
export function noneOf(subj: string): string {
  return subj.replace(/^all /, "");
}

/** Possessive pronoun agreeing with the subject (`its` / `their`). */
export function pronoun(subj: string): string {
  return isPlural(subj) ? "their" : "its";
}

const ABILITY_LABELS: Record<string, string> = {
  "nurgles-gift-death-guard": "Nurgle's Gift (Aura)",
  "fights-first": "Fights First",
};
/** The display label for an ability id: a curated override, else Title Case. */
/** The display name for an ability or Stratagem id: a curated override, else its name part in Title Case. */
export function abilityLabel(id: unknown): string {
  if (id !== null && typeof id === "object" && "ability_id" in id && "definition_id" in id) {
    return `${idLabel(jstr(id.definition_id))} (${abilityLabel(id.ability_id)})`;
  }
  return ABILITY_LABELS[jstr(id)] ?? idLabel(jstr(id));
}

const WEAPON_LABELS: Record<string, string> = {
  "imperiums-sword": "Imperium's Sword",
  "imperiums-sword-assault-brethren": "Imperium's Sword",
  "tl-4-9-lords-of-the-forge": "TL-4ø9",
  "eadbanger-wurrband": "'Eadbanger",
};
/**
 * The display name for a granted weapon id: a curated override, else Title Case of the id. A
 * trailing "-drone" is the disambiguator for a drone's weapon entity and is not printed.
 */
export function weaponLabel(id: unknown): string {
  const key = jstr(id);
  return WEAPON_LABELS[key] ?? titleCase(key.replace(/-drone$/, ""));
}

/** "melee weapons", "ranged Bolt Rifle weapons with [PISTOL]" — a weapon filter as a noun. */
export function weaponNoun(m: Record<string, unknown>): string {
  const scope = (m.weapons ?? {}) as P;
  const kind = scope.type ? `${jstr(scope.type)} ` : "";
  const keywords = (value: unknown): string => orList((Array.isArray(value) ? value : [value]).map(bracketKeyword));
  const keyword = scope.keyword != null ? ` with ${keywords(scope.keyword)}` : "";
  const exclusion = `${scope.exclude_name != null ? ` other than "${jstr(scope.exclude_name)}"` : ""}${scope.exclude_keyword != null ? ` (excluding weapons with ${keywords(scope.exclude_keyword)})` : ""}`;
  // A name that already carries the noun must not read "weapons weapons".
  const raw = scope.name ? jstr(scope.name).replace(/\s+weapons?$/i, "") : "";
  const named = /^[a-z0-9]+(-[a-z0-9]+)+$/.test(raw) ? titleCase(raw) : raw;
  const ref = scope.ref as P | undefined;
  if (ref != null) {
    const sel = ref.selected_by as P | undefined;
    if (sel != null) return `the ${kind}weapons selected for ${abilityLabel(sel.ability)}${keyword}${exclusion}`;
    return `the selected ${kind}weapon${keyword}${exclusion}`;
  }
  return `${kind}${named ? `${named} ` : ""}weapons${keyword}${exclusion}`;
}

/** Whether a modifier carries a weapon filter. */
export function hasWeapon(m: Record<string, unknown>): boolean {
  return m.weapons != null;
}

/** " with melee weapons" for a roll scoped to a weapon filter, else "". */
export function weaponRollScope(m: Record<string, unknown>): string {
  return hasWeapon(m) ? ` with ${weaponNoun(m)}` : "";
}

const ROLE_SUBJECTS: Record<string, string> = {
  "this-model": "this model",
  "model-in-this-unit": "a model in this unit",
  defender: "the target",
  "event-subject": "the triggering unit",
  "event-object": "that unit",
  "stratagem-target": "that unit",
  "bearer-transport": "the Transport this unit is embarked within",
  "ability-unit": "this unit",
};

/** A unit filter as the plural subject of an effect: `friendly INFANTRY units within 6"`. */
export function filterSubject(f: P, ctx: Ctx = {}): string {
  const owner = f.owner === "friendly" ? "friendly " : f.owner === "enemy" ? "enemy " : "";
  const all = Array.isArray(f.all_of) ? `${(f.all_of as unknown[]).map(jstr).join(" ")} ` : "";
  const noun = f.level === "model" ? `${f.attachment_role === "bodyguard" ? "Bodyguard " : f.attachment_role === "leader" ? "Leader " : ""}models` : "units";
  // "friendly LEGIO CYBERNETICA or ADEPTUS MECHANICUS VEHICLE units": keyword-only alternatives.
  const compact = keywordAlternatives(f);
  let s = compact ? `${owner}${orList(compact)} ${noun}` : `${owner}${all}${noun}`;
  // Any other alternatives: "units that are PSYKER units or units that are Battle-shocked".
  if (Array.isArray(f.any_of_filters) && !compact) s += ` that are ${orList(alternativeFilters(f).map((a) => filterSubject(a, ctx).replace(/^all /, "")))}`;
  if (Array.isArray(f.any_of)) s += ` with the ${orList((f.any_of as unknown[]).map(jstr))} keyword`;
  if (Array.isArray(f.none_of)) s += ` (excluding ${orList((f.none_of as unknown[]).map(jstr))} ${noun})`;
  if (Array.isArray(f.not_all_of)) s += ` (excluding ${(f.not_all_of as unknown[]).map(jstr).join(" ")} ${noun})`;
  if (Array.isArray(f.model_names)) s += ` named ${orList(f.model_names.map(jstr))}`;
  if (Array.isArray(f.unit_ids)) s += ` with unit ID ${orList(f.unit_ids.map(jstr))}`;
  const within = f.within as P | undefined;
  if (within != null) s += ` ${within.wholly === true ? "wholly " : ""}within ${rangePhrase(within.range)}${within.of != null ? ` of ${placeRefPhrase(within.of)}` : ""}`;
  s += filterRelations(f, ctx);
  if (f.visible != null) s += ` visible to ${effectSubject((f.visible as P).to, ctx)}`;
  if (f.designated != null) s += ` that are ${designationPhrase(jstr(f.designated), true)}${f.designated_by != null ? ` by ${effectSubject(f.designated_by, ctx)}` : ""}`;
  if (f.not_designated != null) s += ` that are not ${designationPhrase(jstr(f.not_designated), true)}`;
  if (f.state != null) s += ` that are ${statePhrase(jstr(f.state))}`;
  if (Array.isArray(f.not_states)) s += ` that are ${andList((f.not_states as unknown[]).map((x) => statePhrase(jstr(x), true)))}`;
  if (f.excluding != null) s += ` other than ${effectSubject(f.excluding, ctx)}`;
  const bounded = within != null || f.visible != null || f.designated != null || f.not_designated != null || f.state != null || f.not_states != null ||
    f.embarked_in != null || f.member_of != null || f.engaged_with != null || f.not_engaged_with != null;
  return bounded ? s : `all ${s}`;
}

/** A unit filter's relations to other units and abilities: " embarked within this model", " with the Deep Strike ability". */
function filterRelations(f: P, ctx: Ctx): string {
  let s = "";
  if (Array.isArray(f.has_ability)) s += ` with the ${andList((f.has_ability as unknown[]).map(abilityLabel))} ability`;
  if (Array.isArray(f.lacks_ability)) s += ` without the ${orList((f.lacks_ability as unknown[]).map(abilityLabel))} ability`;
  if (f.embarked_in != null) s += ` embarked within ${effectSubject(f.embarked_in, ctx)}`;
  if (f.member_of != null) s += ` in ${f.member_of === "this-unit" ? "the unit" : effectSubject(f.member_of, ctx)}`;
  // "any other friendly unit": a filter excluding the unit with the ability reads "other".
  const exactReference = (ref: unknown): boolean => typeof ref === "string" || (ref != null && typeof ref === "object" && ("selection_var" in ref || "event_var" in ref || "stratagem_target" in ref));
  const engagedWith = (g: unknown): string => {
    if (exactReference(g)) return effectSubject(g, ctx);
    const x = { ...(g as P) };
    const other = x.excluding === "this-unit" || x.excluding === "this-model";
    if (other) delete x.excluding;
    const phrase = filterSubject(x, ctx).replace(/^all /, "").replace(/ units\b/, " unit").replace(/ models\b/, " model");
    return other ? `other ${phrase}` : phrase;
  };
  if (f.engaged_with != null) s += ` within Engagement Range of ${exactReference(f.engaged_with) ? engagedWith(f.engaged_with) : articled(engagedWith(f.engaged_with)).replace(/^an? other /, "another ")}`;
  if (f.not_engaged_with != null) s += ` that are not within Engagement Range of ${exactReference(f.not_engaged_with) ? "" : "any "}${engagedWith(f.not_engaged_with)}`;
  return s;
}

function articled(s: string): string {
  return `${/^[aeiou]/i.test(s) ? "an" : "a"} ${s}`;
}

/** An effect target (a unit-ref) as the effect's subject. */
export function effectSubject(target: unknown, ctx: Ctx = {}): string {
  if (target == null || target === "this-unit") return ctx.unitSubject ?? (ctx.selectedUnit || ctx.selectedModel ? "this unit" : "the unit");
  if (target === "selected-unit") return ctx.selectedModel ? "that model" : ctx.selectedUnit ? "that unit" : "the selected unit";
  if (target === "recipient") return ctx.auraRecipient ? "that unit" : "the unit";
  if (target === "attacker") return ctx.unitSubject ?? "the attacking unit";
  if (typeof target === "string") return ROLE_SUBJECTS[target] ?? dekebab(target);
  const r = target as P;
  if (typeof r.event_var === "string") return "that unit";
  if (typeof r.selection_var === "string") return `the bound ${jstr(r.selection_var).replace(/_/g, " ")}`;
  if (typeof r.stratagem_target === "string") return `the ${dekebab(r.stratagem_target.replace(/^the-/, ""))} target`;
  return filterSubject(r, ctx);
}

/** Who carries a weapon filter's weapons: "this model", "models in this unit", …. */
export function weaponHolder(target: unknown, ctx: Ctx): string {
  if (target === "this-model") return "this model";
  if (ctx.unitSubject && (target == null || target === "this-unit" || target === "attacker")) return `models in ${ctx.unitSubject}`;
  if (target === "selected-unit" && ctx.selectedModel) return "that model";
  if (target == null || target === "this-unit") return "models in this unit";
  if (target === "selected-unit") return ctx.selectedUnit ? "models in that unit" : "models in the selected unit";
  return effectSubject(target, ctx);
}

/** A region-ref as a place: "enemy territory", "the Ruins terrain area", "Plague Zone". */
export function regionPhrase(r: P): string {
  if (r.rule_region) return titleCase(jstr((r.rule_region as P).region_id));
  if (r.territory) return dekebab(jstr(r.territory));
  const area = (r.terrain_area ?? {}) as P;
  let where = area.footprint != null ? `the ${dekebab(jstr(area.footprint))} terrain area` : "a terrain area";
  if (area.designated != null) where += ` tagged ${dekebab(jstr(area.designated))}`;
  return where;
}

/** A tag an effect applies: a registered id prints the rules' term, a legacy upper-case tag stays as printed, others read "marked as …". */
export function designationFor(tag: string): string {
  const label = designationLabel(tag);
  if (label != null) return label;
  return tag === tag.toUpperCase() ? tag : `marked as ${dekebab(tag)}`;
}

const MOVED: Record<string, string> = {
  normal: "a Normal move", advance: "an Advance move", "fall-back": "a Fall Back move", charge: "a Charge move", "remain-stationary": "no move (it Remained Stationary)",
};
/** "a Normal move" — the move a counts_as_move names. */
export function movedPhrase(move: unknown): string {
  return MOVED[jstr(move)] ?? `${/^[aeiou]/i.test(jstr(move)) ? "an" : "a"} ${titleCase(jstr(move))} move`;
}

/** A dice requirement: "pair of 4+", or alternatives "pair of 6+ or triple of 3+". */
export function requirementPhrase(req: unknown): string {
  const one = (r: { type?: unknown; min_value?: unknown } | undefined) => `${jstr(r?.type)} of ${jstr(r?.min_value)}+`;
  const anyOf = (req as { any_of?: unknown } | undefined)?.any_of;
  if (Array.isArray(anyOf)) return anyOf.map(one).join(" or ");
  return one(req as { type?: unknown; min_value?: unknown } | undefined);
}

const TEST_KINDS = new Set(["psychic", "battle-shock", "leadership", "desperate-escape", "hazard"]);
/** "a Psychic test", "a Blessings of Khorne roll" — what kind of roll a gate or a roll step is. */
export function rollKindNoun(kind: unknown): string {
  const name = rollName(kind);
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name} ${typeof kind === "string" && TEST_KINDS.has(kind) ? "test" : "roll"}`;
}
