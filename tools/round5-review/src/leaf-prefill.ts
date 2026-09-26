import type { Family, Property } from "./LeafForm";

/**
 * What the source wording states outright about a leaf's parameters. Nothing is chosen by
 * default: a parameter is filled in only when the words say it (a bracketed weapon ability,
 * melee or ranged, an "N+" threshold, an event's phase, a unit keyword in capitals, "not").
 */

export function choices(property: Property): string[] {
  return property.enum ?? property.anyOf?.flatMap((item) => item.enum ?? []) ?? [];
}
export const numeric = (property: Property) => property.type === "integer" || (property.anyOf?.some((item) => item.type === "integer") ?? false);
export const freeText = (property: Property) => property.anyOf?.some((item) => item.type === "string") ?? property.type === "string";

const titleCase = (text: string) => text.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toUpperCase());

/** The weapon ability named in brackets in the source, spelled the way the DSL spells it. */
function keywordFromSource(exactText: string, options: readonly string[]): string | null {
  const bracketed = /\[([^\]]+)\]/u.exec(exactText)?.[1];
  if (!bracketed) return null;
  const named = options.find((option) => option.toLowerCase() === bracketed.trim().toLowerCase());
  if (named) return named;
  const valued = /^(sustained hits|rapid fire|melta) (\d|d3|d6)$/iu.exec(bracketed.trim());
  return valued ? `${titleCase(valued[1]!)} ${valued[2]!.toUpperCase()}` : null;
}

/** An event's kind, phase, and whose turn. */
function eventFromSource(exactText: string): Record<string, unknown> {
  const boundary = /\b(start|end) of (your opponent's|your|the|each|either player's) (command|movement|shooting|charge|fight) phase\b/iu.exec(exactText);
  if (boundary) {
    const owner = boundary[2]!.toLowerCase();
    return {
      kind: boundary[1]!.toLowerCase() === "start" ? "phase-start" : "phase-end",
      phase: boundary[3]!.toLowerCase(),
      turn: owner === "your" ? "your" : owner === "your opponent's" ? "opponent" : "either",
    };
  }
  if (/\bafter this unit has shot\b/iu.test(exactText)) return { kind: "after-shooting" };
  const moments: Array<[RegExp, string]> = [
    [/enemy unit has selected its targets/iu, "enemy-selected-targets"], [/enemy unit ends an? (?:normal|advance|fall back|[a-z, ]+) move/iu, "enemy-ended-move"],
    [/enemy unit has shot/iu, "enemy-has-shot"], [/enemy unit declares a charge/iu, "enemy-declared-charge"],
    [/is selected to shoot/iu, "selected-to-shoot"], [/is selected to fight/iu, "selected-to-fight"],
  ];
  const moment = moments.find(([pattern]) => pattern.test(exactText))?.[1];
  if (moment) return { kind: moment };
  return {};
}

/** Who attacks, which way, and with what, when the words say so. */
function attackFromSource(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lower = text.toLowerCase();
  if (/\battacks? (?:targets?|is allocated to)\b/u.test(lower)) result.direction = "targeted";
  else if (/\bmakes? an? (?:melee |ranged )?attack/u.test(lower)) result.direction = "makes";
  const type = /\b(melee|ranged)\b/u.exec(lower)?.[1];
  if (type) result.attack_type = type;
  else if (/\battack/u.test(lower)) result.attack_type = "any";
  const units: Array<[RegExp, string]> = [
    [/\ba model in the bearer's unit\b|\bthe bearer's unit\b/u, "bearers-unit"],
    [/\bthe bearer\b/u, "bearer"],
    [/\ba model in this unit\b|\bthis unit\b/u, "this-unit"],
    [/\bthis model\b/u, "this-model"],
    [/\ba model in (?:that|your) unit\b|\b(?:that|your) unit\b/u, "that-unit"],
  ];
  const unit = units.find(([pattern]) => pattern.test(lower))?.[1];
  if (unit) result.unit = unit;
  return result;
}

/** Unit keywords written in capitals or bold, and "can fly" as FLY. */
function unitKeywords(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\*\*([^*]+)\*\*|\b([A-Z][A-Z-]{2,}(?: [A-Z][A-Z-]{2,})*)\b/gu)) {
    const keyword = (match[1] ?? match[2] ?? "").trim().toUpperCase();
    if (keyword) found.add(keyword);
  }
  if (/\b(?:can|cannot|can't) fly\b/iu.test(text)) found.add("FLY");
  return [...found];
}

const STATE_WORDS: Array<[RegExp, string]> = [
  [/starting strength/iu, "below-starting-strength"], [/half[- ‑]?strength/iu, "below-half-strength"], [/battle[- ]?shocked/iu, "battle-shocked"],
];
const MARK_WORDS: Array<[RegExp, string]> = [
  [/oath of moment/iu, "oath-of-moment"], [/afflicted/iu, "afflicted"], [/spotted/iu, "spotted"], [/hidden/iu, "hidden"], [/marked/iu, "marked"],
];

function predicateFromSource(familyId: string, text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (/\btargets?\b|\bthe target\b/iu.test(text)) result.subject = "target";
  else if (/\bthis unit\b/iu.test(text)) result.subject = "this-unit";
  if (/\bnot\b|\bcannot\b|\bcan't\b/iu.test(text)) result.negated = true;
  const inches = /(\d+)(?:"|”|″| inches)/u.exec(text)?.[1];
  if (familyId === "unit-state") {
    const states = STATE_WORDS.filter(([pattern]) => pattern.test(text)).map(([, state]) => state);
    if (states.length) result.states = states;
  } else if (familyId === "unit-keyword") {
    const keywords = unitKeywords(text);
    if (keywords.length) result.keywords = keywords;
  } else if (familyId === "unit-mark") {
    const mark = MARK_WORDS.find(([pattern]) => pattern.test(text))?.[1];
    if (mark) result.mark = mark;
  } else if (familyId === "unit-position") {
    if (/closest eligible/iu.test(text)) result.kind = "closest-eligible";
    else if (/objective/iu.test(text)) result.kind = "objective-range";
    else if (/more than \d/iu.test(text)) result.kind = "beyond";
    else if (/within \d/iu.test(text)) result.kind = "within";
    if (inches && (result.kind === "within" || result.kind === "beyond")) result.inches = Number(inches);
    if (result.kind === "objective-range") result.controlled_by = /you control/iu.test(text) ? "you" : /opponent controls/iu.test(text) ? "opponent" : "any";
  }
  return result;
}

function selectionFromSource(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (/\benemy\b/iu.test(text)) result.scope = "enemy";
  else if (/\bfriendly\b/iu.test(text)) result.scope = "friendly";
  const inches = /within (\d+)(?:"|”|″| inches)/iu.exec(text)?.[1];
  if (inches) {
    result.distance = "within";
    result.inches = Number(inches);
  }
  if (/\bvisible\b/iu.test(text)) result.visible = true;
  return result;
}

/** Characteristic names as GW writes them, longest first so "weapon skill" wins over "skill". */
const CHARACTERISTIC_WORDS: Array<[RegExp, string]> = [
  [/armou?r penetration/iu, "AP"], [/ballistic skill/iu, "BS"], [/weapon skill/iu, "WS"], [/objective control/iu, "OC"],
  [/\battacks\b/iu, "A"], [/\bstrength\b/iu, "S"], [/\bdamage\b/iu, "D"], [/\bmove\b/iu, "M"], [/\btoughness\b/iu, "T"],
  [/\bsave\b/iu, "Sv"], [/\bwounds\b/iu, "W"], [/\bleadership\b/iu, "Ld"],
];
const CHARACTERISTIC_ORDER = ["M", "T", "Sv", "W", "Ld", "OC", "A", "WS", "BS", "S", "AP", "D"];

function characteristicFromSource(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const found = CHARACTERISTIC_WORDS.filter(([pattern]) => pattern.test(text)).map(([, stat]) => stat);
  if (found.length) result.characteristics = CHARACTERISTIC_ORDER.filter((stat) => found.includes(stat));
  const verb = /\b(add|subtract|improve|worsen)\b/iu.exec(text)?.[1]?.toLowerCase();
  if (verb) result.operation = verb;
  const amount = /\bby (\d+)\b|\b(?:add|subtract) (\d+)\b/iu.exec(text);
  if (amount) result.value = Number(amount[1] ?? amount[2]);
  const weapons = /\b(melee|ranged) weapons\b/iu.exec(text)?.[1]?.toLowerCase();
  if (weapons) result.weapon_type = weapons;
  else if (/\bweapons\b/iu.test(text)) result.weapon_type = "all";
  if (/\b(?:that|this|the) attack\b/iu.test(text)) {
    result.subject = "attack";
    result.weapon_type = "all";
  } else if (/\bthis model\b/iu.test(text)) result.subject = "this-model";
  else if (/\bthe bearer\b/iu.test(text)) result.subject = "bearer";
  else if (/\b(?:that|this|your) unit\b/iu.test(text)) result.subject = "this-unit";
  return result;
}

const WINDOW_PHASES = ["command", "movement", "shooting", "charge", "fight"];

/** "Your opponent's Shooting phase or the Fight phase": each phase with its own owner. */
function windowFromSource(text: string): Record<string, unknown> {
  const window: Record<string, string[]> = { your_phases: [], opponent_phases: [], either_phases: [] };
  const lower = text.toLowerCase().replaceAll("’", "'");
  if (/\bany phase\b/u.test(lower)) return { ...window, either_phases: [...WINDOW_PHASES] };
  let previous = "either_phases";
  for (const part of lower.split(/\bor\b|,/u)) {
    const phase = WINDOW_PHASES.find((item) => part.includes(item));
    if (!phase) continue;
    // "Your Movement or Charge phase": a phase without its own owner shares the one before it;
    // "the Fight phase" and a bare "Fight phase" belong to either player's turn.
    const owner = /your opponent's/u.test(part) ? "opponent_phases" : /\byour\b/u.test(part) ? "your_phases"
      : /\bthe\b/u.test(part) || part.trim().startsWith(phase) && previous === "either_phases" ? "either_phases" : previous;
    if (!window[owner]!.includes(phase)) window[owner]!.push(phase);
    previous = owner;
  }
  return window;
}

const PREDICATES = new Set(["unit-state", "unit-keyword", "unit-mark", "unit-position"]);

export function prefillFromSource(family: Family | undefined, exactText: string): Record<string, unknown> {
  if (!family) return {};
  const prefill: Record<string, unknown> = family.id === "event" ? eventFromSource(exactText)
    : family.id === "attack" ? attackFromSource(exactText)
      : family.id === "select-unit" ? selectionFromSource(exactText)
        : PREDICATES.has(family.id) ? predicateFromSource(family.id, exactText) : {};
  if (family.id === "characteristic-modifier") Object.assign(prefill, characteristicFromSource(exactText));
  if (family.id === "no-advance-roll") {
    if (/\bthis model\b/iu.test(exactText)) prefill.subject = "this-model";
    else if (/\bthe bearer\b/iu.test(exactText)) prefill.subject = "bearer";
    else if (/\b(?:it|your unit|this unit|that unit)\b/iu.test(exactText)) prefill.subject = "this-unit";
  }
  if (family.id === "dice-roll") {
    const dice = /\broll (?:one |a )?(d3|d6|2d6)\b/iu.exec(exactText)?.[1]?.toUpperCase();
    if (dice) prefill.dice = dice;
  }
  if (family.id === "roll-result") {
    // A D6 is assumed for "N+"; change "to" for a D3 or 2D6.
    const band = /\bon an? (\d+)(?:\+|-(\d+))?/iu.exec(exactText);
    if (band) {
      prefill.from = Number(band[1]);
      prefill.to = band[2] ? Number(band[2]) : /\d\+/u.test(band[0]) ? 6 : Number(band[1]);
    }
  }
  if (family.id === "mortal-wounds") {
    const count = /\b(\d+|d3\+3|d3|d6|2d6) mortal wounds?\b/iu.exec(exactText)?.[1]?.toUpperCase();
    if (count) prefill.count = count;
    if (/\bthat (?:enemy )?unit\b/iu.test(exactText)) prefill.recipient = "that-unit";
    else if (/\bthis unit\b/iu.test(exactText)) prefill.recipient = "this-unit";
    else if (/\bthis model\b/iu.test(exactText)) prefill.recipient = "this-model";
  }
  if (family.id === "fight-on-death") {
    if (/after the attacking unit has finished/iu.test(exactText)) prefill.timing = "after-the-attacking-unit-finishes";
    else if (/when (?:its|that) unit (?:is selected to )?fights?/iu.test(exactText)) prefill.timing = "when-its-unit-fights";
  }
  if (family.id === "unit-activity") {
    const activities: Array<[RegExp, string]> = [[/charge/iu, "charged-this-turn"], [/advance/iu, "advanced-this-turn"], [/remained stationary/iu, "remained-stationary"], [/fought/iu, "fought-this-phase"], [/selected to shoot/iu, "selected-to-shoot-this-phase"]];
    const activity = activities.find(([pattern]) => pattern.test(exactText))?.[1];
    if (activity) prefill.activity = activity;
    if (/\bnot\b|\bhas not\b|\bhasn't\b/iu.test(exactText)) prefill.negated = true;
    if (/\b(?:this|your|that) (?:unit|model)\b/iu.test(exactText)) prefill.subject = "this-unit";
  }
  if (family.id === "usage-limit") {
    const frequency = /once per (battle round|battle|turn|phase)/iu.exec(exactText)?.[1]?.toLowerCase();
    if (frequency) prefill.frequency = `once-per-${frequency.replace(" ", "-")}`;
    if (/your opponent's turn|opponent’s turn/iu.test(exactText)) prefill.frequency = "once-per-opponent-turn";
    const per = /\bper (army|unit|model)\b|\bfor each (unit|model)\b/iu.exec(exactText);
    prefill.per = per ? (per[1] ?? per[2])!.toLowerCase() : "any";
  }
  if (family.id === "use-window") Object.assign(prefill, windowFromSource(exactText));
  if (family.id === "bearer-eligibility") {
    const words = exactText.replace(/\bmodel only\b.*$/iu, "").split(/,|\bor\b/u).map((item) => item.replaceAll("*", "").trim().toUpperCase()).filter((item) => /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u.test(item));
    if (words.length) {
      prefill.keywords = words;
      prefill.match = words.length > 1 ? "any" : "all";
    }
  }
  if (family.id === "optional-use") {
    if (/\bthe bearer\b/iu.test(exactText)) prefill.who = "bearer";
    else if (/\byou can\b/iu.test(exactText)) prefill.who = "you";
    else if (/\bthis model\b/iu.test(exactText)) prefill.who = "this-model";
    else if (/\bthis unit\b/iu.test(exactText)) prefill.who = "this-unit";
  }
  if (family.id === "act-after-move") {
    const moves = [/\badvanc/iu.test(exactText) ? "advance" : null, /\bf(?:a|e)ll(?:s|ing)? back\b/iu.test(exactText) ? "fall-back" : null].filter(Boolean);
    const acts = [/\bshoot|\bshot\b/iu.test(exactText) ? "shoot" : null, /\bcharge\b/iu.test(exactText) ? "charge" : null].filter(Boolean);
    if (moves.length) prefill.moves = moves;
    if (acts.length) prefill.acts = acts;
    if (/\bthis model\b/iu.test(exactText)) prefill.subject = "this-model";
    else if (/\bthe bearer\b/iu.test(exactText)) prefill.subject = "bearer";
    else if (/\b(?:that|this|your) unit\b/iu.test(exactText)) prefill.subject = "this-unit";
  }
  if (family.id === "regain-wounds") {
    const amount = /regains? (\d+|d3\+3|d3|d6) lost wounds?/iu.exec(exactText)?.[1];
    if (amount) prefill.amount = amount.toUpperCase();
    if (/\bthis model\b/iu.test(exactText)) prefill.subject = "this-model";
    else if (/\bthe bearer\b/iu.test(exactText)) prefill.subject = "bearer";
  }
  for (const [name, property] of Object.entries(family.parameterSchema.properties ?? {})) {
    if (name in prefill) continue;
    if (name === "weapon_type") {
      const limited = /\b(melee|ranged) weapons?\b/iu.exec(exactText)?.[1]?.toLowerCase();
      if (limited) prefill[name] = limited;
    } else if (freeText(property)) {
      const keyword = keywordFromSource(exactText, choices(property));
      if (keyword) prefill[name] = keyword;
    } else if (numeric(property) && name === "threshold") {
      const threshold = /\b([2-6])\+/u.exec(exactText)?.[1];
      if (threshold) prefill[name] = Number(threshold);
    }
  }
  // Keep only what the family accepts, so a stray match never becomes an invalid parameter.
  const properties = family.parameterSchema.properties ?? {};
  return Object.fromEntries(Object.entries(prefill).filter(([name, value]) => {
    const property = properties[name];
    if (!property) return false;
    const options = property.type === "array" ? property.items?.enum ?? [] : choices(property);
    if (Array.isArray(value)) return options.length === 0 || value.every((item) => options.includes(String(item)));
    return typeof value !== "string" || options.length === 0 || options.includes(value) || freeText(property);
  }));
}
