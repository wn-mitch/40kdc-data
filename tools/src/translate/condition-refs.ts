/**
 * The shared noun phrases of the condition describer: units, ranges, objectives, states,
 * designations, history windows and move kinds. ASCII-only; pinned across the ports.
 */

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
};

/** A unit filter as a noun phrase: "a friendly ADEPTUS MECHANICUS BATTLELINE unit". */
export function unitFilterPhrase(f: P): string {
  const owner = f.owner === "friendly" ? "friendly " : f.owner === "enemy" ? "enemy " : "";
  const all = Array.isArray(f.all_of) ? `${(f.all_of as unknown[]).map(str).join(" ")} ` : "";
  const noun = f.level === "model" ? "model" : "unit";
  let s = `${owner}${all}${noun}`;
  s = `${/^[aeiou]/i.test(s) ? "an" : "a"} ${s}`;
  if (Array.isArray(f.any_of)) s += ` with the ${orList((f.any_of as unknown[]).map(str))} keyword`;
  if (Array.isArray(f.none_of)) s += ` (excluding ${orList((f.none_of as unknown[]).map(str))} ${noun}s)`;
  if (f.designated != null) s += ` that is ${designationPhrase(str(f.designated))}`;
  if (f.state != null) s += ` that is ${statePhrase(str(f.state))}`;
  if (f.visible === true) s += " that is visible to it";
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
    return unitFilterPhrase(r);
  }
  return fallback;
}

/** The subject of a predicate; `defender` reads "the target" in the keyword forms. */
export function subjectOf(p: P, fallback = "the unit"): string {
  return unitRefPhrase(p.subject, fallback);
}

const AURA_RANGES: Record<string, string> = { "nurgle-s-gift-aura": "Contagion Range" };

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
  if (o.aura_of != null) return AURA_RANGES[str(o.aura_of)] ?? `the ${titleCase(str(o.aura_of))} range`;
  return '?"';
}

export function objectivePhrase(f: P, plural = false, noun = "objective"): string {
  const role = f.role === "non-home" ? "" : f.role != null ? `${dekebab(str(f.role))} ` : "";
  let s = `${role}${noun}${plural ? "s" : ""}`;
  if (f.home_of === "enemy") s += " (opponent home)";
  if (f.home_of === "friendly") s += " (your home)";
  if (f.name != null) s += ` (${dekebab(str(f.name))})`;
  if (f.territory != null) s += ` in ${dekebab(str(f.territory))}`;
  if (f.role === "non-home") s += " (excluding home)";
  if (f.controlled_by === "friendly") s += " you control";
  if (f.controlled_by === "enemy") s += " your opponent controls";
  if (f.designated != null) s += ` tagged ${dekebab(str(f.designated))}`;
  return s;
}

const STATE_PHRASES: Record<string, string> = {
  engaged: "engaged", "battle-shocked": "Battle-shocked", embarked: "embarked",
  "in-strategic-reserves": "in Strategic Reserves", "in-reserves": "in Reserves", "on-battlefield": "on the battlefield",
  hidden: "hidden", "fights-first": "a Fights First unit", "benefit-of-cover": "receiving the benefit of cover",
};
const NEGATED_STATE: Record<string, string> = { engaged: "unengaged" };
export function statePhrase(state: string, negated = false): string {
  if (negated) return NEGATED_STATE[state] ?? `not ${STATE_PHRASES[state] ?? dekebab(state)}`;
  return STATE_PHRASES[state] ?? dekebab(state);
}

/** A designation: GW-printed tags stay as printed, internal state names are spelled out. */
export function designationPhrase(tag: string): string {
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
