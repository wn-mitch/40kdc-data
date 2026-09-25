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

const PREDICATES = new Set(["unit-state", "unit-keyword", "unit-mark", "unit-position"]);

export function prefillFromSource(family: Family | undefined, exactText: string): Record<string, unknown> {
  if (!family) return {};
  const prefill: Record<string, unknown> = family.id === "event" ? eventFromSource(exactText)
    : family.id === "attack" ? attackFromSource(exactText)
      : family.id === "select-unit" ? selectionFromSource(exactText)
        : PREDICATES.has(family.id) ? predicateFromSource(family.id, exactText) : {};
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
