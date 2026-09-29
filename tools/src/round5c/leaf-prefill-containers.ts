/**
 * Prefill for batch 5's container families, split out of `leaf-prefill.ts` per the batch-5
 * follow-up (that file was already close to the line ceiling). Same rule as the rest of
 * `leaf-prefill.ts`: nothing is chosen by default, only read when the wording says it outright.
 *
 * `leader-target`, `rules-bundle-marker` and `named-region-state` have no reliable regex
 * signal — a leader's eligible keywords, a bundle's own name, and a named region's producer/
 * consumer shape are all open-ended or too structural to guess from prose — so they are left to
 * the empty starter, same as any family this file doesn't mention.
 */

function auraFromSource(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (/\benemy\b/iu.test(text)) result.side = "enemy";
  else if (/\bfriendly\b/iu.test(text)) result.side = "friendly";
  const inches = /within (\d+)(?:"|”|″| inches)/iu.exec(text)?.[1];
  if (inches) result.inches = Number(inches);
  return result;
}

function forEachUnitFromSource(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (/\benemy\b/iu.test(text)) result.scope = "enemy";
  else if (/\bfriendly\b/iu.test(text)) result.scope = "friendly";
  const inches = /within (\d+)(?:"|”|″| inches)/iu.exec(text)?.[1];
  if (inches) {
    result.distance = "within";
    result.inches = Number(inches);
  } else if (result.scope) result.distance = "any";
  return result;
}

/** A choice's own min/max, when the wording names a count ("up to two of the following"). */
function choiceCountFromSource(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const upTo = /\bup to (two|three|2|3)\b/iu.exec(text)?.[1]?.toLowerCase();
  if (upTo) {
    result.min_choices = 1;
    result.max_choices = ({ two: 2, three: 3 } as Record<string, number>)[upTo] ?? Number(upTo);
  }
  return result;
}

function stanceSelectFromSource(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (/\barmy\b/iu.test(text)) result.scope = "army";
  else if (/\bunit\b/iu.test(text)) result.scope = "unit";
  if (/\bonce per battle\b/iu.test(text)) result.mode = "consumable";
  else if (/\beach (?:battle round|turn|command phase)\b/iu.test(text)) result.mode = "re-selectable";
  return Object.assign(result, choiceCountFromSource(text));
}

function issueOrdersFromSource(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const count = /\b(one|two|three|1|2|3) orders?\b/iu.exec(text)?.[1]?.toLowerCase();
  if (count) result.count = ({ one: 1, two: 2, three: 3 } as Record<string, number>)[count] ?? Number(count);
  const range = /within (\d+)(?:"|”|″| inches)/iu.exec(text)?.[1];
  if (range) result.range = Number(range);
  return result;
}

function dicePoolFromSource(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const pool = /\broll (\d+)(d3|d6)\b/iu.exec(text);
  if (pool) {
    result.pool_count = Number(pool[1]);
    result.pool_die = pool[2]!.toUpperCase();
  }
  const activations = /\b(once|twice|(\d+) times?) per (?:turn|battle round|phase)\b/iu.exec(text);
  if (activations) result.max_activations = activations[1]!.toLowerCase() === "once" ? 1 : activations[1]!.toLowerCase() === "twice" ? 2 : Number(activations[2]);
  return result;
}

/** The option's own name: a short capitalised phrase at the start of its wording, ended by a colon or dash. */
function namedOptionFromSource(text: string): Record<string, unknown> {
  const label = /^([A-Z][A-Za-z' ]*?)(?:\s*[:–—]\s)/u.exec(text.trim())?.[1];
  return label ? { label } : {};
}

function stanceCapacityFromSource(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (/\bone additional time\b/iu.test(text)) result.additional_selections = 1;
  if (/\bany option\b/iu.test(text)) result.allocation = "choose-one-option";
  return result;
}

/** What one leaf of a batch-5 container family can read outright from its own source wording. */
export function containerPrefill(familyId: string, exactText: string): Record<string, unknown> {
  switch (familyId) {
    case "aura-range": return auraFromSource(exactText);
    case "for-each-unit-select": return forEachUnitFromSource(exactText);
    case "choice-open": return choiceCountFromSource(exactText);
    case "stance-select-open": return stanceSelectFromSource(exactText);
    case "issue-orders-open": return issueOrdersFromSource(exactText);
    case "dice-pool-allocation-open": return dicePoolFromSource(exactText);
    case "named-option": return namedOptionFromSource(exactText);
    case "stance-selection-capacity": return stanceCapacityFromSource(exactText);
    default: return {};
  }
}
