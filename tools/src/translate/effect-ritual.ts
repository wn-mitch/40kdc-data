/**
 * The ritual-menu container: Rituals attempted with a Psychic test, each with its Warp Charge.
 */

import { capitalize, diceCase, jstr, rollKindNoun } from "./effect-words.js";

type P = Record<string, unknown>;
type Render = (effect: unknown) => string;

/** "(each Ritual can be attempted once per turn across your army)": the menu's limit on each Ritual. */
const RITUAL_LIMIT = "each Ritual can be attempted once per turn across your army";

/**
 * "take a Psychic test: roll 2D6, and you can roll one additional D6; if any two of its dice show the same
 * result, …; if this model is not destroyed and the total of all its dice equals or exceeds the Ritual's
 * Warp Charge, this model manifests that Ritual".
 */
function testPhrase(e: P, inline: Render): string {
  const test = (e.test ?? {}) as P;
  const extra = test.extra_die as P | undefined;
  const more = extra == null ? "" : `, and ${extra.optional === true ? "you can roll" : "roll"} one additional ${diceCase(extra.dice)}`;
  const perils = test.perils as P | undefined;
  const cost = perils == null ? "" : `; if any two of its dice show the same result, ${inline(perils.effect)}`;
  const kind = test.kind == null ? "a test" : rollKindNoun(test.kind);
  return `take ${kind}: roll ${diceCase(test.dice)}${more}${cost}; if this model is not destroyed and the total of all its dice equals or exceeds the Ritual's Warp Charge, this model manifests that Ritual`;
}

/** "Destiny's Ruin (Warp Charge 5)". */
const ritualHead = (ritual: P) => `${jstr(ritual.name)} (Warp Charge ${jstr(ritual.warp_charge)})`;

export function ritualMenuInline(e: P, inline: Render): string {
  const rituals = ((e.rituals ?? []) as P[]).map((ritual) => `${ritualHead(ritual)}: ${inline(ritual.effect)}`).join(" / ");
  return `attempt one Ritual (${RITUAL_LIMIT}); to do so, ${testPhrase(e, inline)}: ${rituals}`;
}

export function ritualMenuBlock(e: P, indent: string, arrow: string, inline: Render): string {
  const lines = [`${indent}${arrow}Attempt one of the Rituals below (${RITUAL_LIMIT}). To do so, ${testPhrase(e, inline)}:`];
  for (const ritual of (e.rituals ?? []) as P[]) lines.push(`${indent}  - ${ritualHead(ritual)}: ${capitalize(inline(ritual.effect))}.`);
  return lines.join("\n");
}
