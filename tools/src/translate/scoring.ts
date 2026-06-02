/**
 * Humanize a `secondary-card` scoring `award` into plain English.
 *
 * Output is **ASCII-only** with a fixed clause order, pinned byte-for-byte
 * across the TS and Rust ports by the `conformance/scoring-translation` corpus.
 * The community `text` summary and the `actions` list are verbatim data, not
 * translation, so they are not produced here — only the structured `awards`.
 */

import type { SecondaryCard } from "../generated.js";
import { describeCondition, dekebab, type Condition } from "./condition.js";

/** When a VP award is evaluated (the `trigger` block on an award). */
export interface ScoringTrigger {
  timing?: "start-of-turn" | "end-of-turn" | "start-of-phase" | "end-of-phase" | "end-of-battle";
  phase?: "command" | "movement" | "shooting" | "charge" | "fight";
  player_turn?: "your-turn" | "opponent-turn" | "either";
  battle_round?: { min?: number; max?: number };
}

/** The scoring approach a card is played under (cards that print both). */
export type ScoringMode = "fixed" | "tactical";

/** One VP-award block on a scoring card. */
export interface ScoringAward {
  trigger?: ScoringTrigger;
  when?: Condition;
  vp?: number;
  vp_per?: number;
  per?: string;
  per_max?: number;
  /** Per-game VP ceiling for this award (the card's "UP TO N VP"). */
  vp_max?: number;
  cumulative?: boolean;
  exclusive_group?: string;
  /** Which scoring track this award belongs to, on cards that print both. */
  mode?: ScoringMode;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** "End of your Command phase (round 2+)" and friends. */
export function describeTrigger(t: ScoringTrigger): string {
  const turn =
    t.player_turn === "opponent-turn"
      ? "the opponent's"
      : t.player_turn === "either"
        ? "any"
        : "your";

  let base: string;
  switch (t.timing) {
    case "start-of-turn":
      base = `Start of ${turn} turn`;
      break;
    case "end-of-turn":
      base = `End of ${turn} turn`;
      break;
    case "start-of-phase":
      base = `Start of ${turn} ${capitalize(t.phase ?? "")} phase`;
      break;
    case "end-of-phase":
      base = `End of ${turn} ${capitalize(t.phase ?? "")} phase`;
      break;
    case "end-of-battle":
      base = "End of the battle";
      break;
    default:
      base = t.phase ? `During ${turn} ${capitalize(t.phase)} phase` : "Any time";
  }

  const br = t.battle_round;
  if (br) {
    const { min, max } = br;
    if (min != null && max != null) {
      base += min === max ? ` (round ${min})` : ` (rounds ${min}-${max})`;
    } else if (min != null) {
      base += ` (round ${min}+)`;
    } else if (max != null) {
      base += ` (rounds 1-${max})`;
    }
  }
  return base;
}

/** "End of your Command phase (round 2+): 3 VP per controlled objective when ..." */
export function describeAward(a: ScoringAward): string {
  const trigger = a.trigger ? describeTrigger(a.trigger) : "Any time";

  let amount: string;
  if (a.vp != null) {
    amount = `${a.vp} VP`;
  } else if (a.vp_per != null) {
    amount = `${a.vp_per} VP per ${a.per ? dekebab(a.per) : "instance"}`;
    if (a.per_max != null) amount += ` (max ${a.per_max})`;
  } else {
    amount = "no VP";
  }

  const prefix = a.cumulative ? "+ " : "";
  const when = a.when ? ` when ${describeCondition(a.when)}` : "";
  const tier = a.exclusive_group ? " [highest tier]" : "";
  return `${prefix}${trigger}: ${amount}${when}${tier}`;
}

/** Humanize every award on a card, in array order (the order is load-bearing). */
export function describeScoringCard(card: SecondaryCard): string[] {
  const awards = (card.awards ?? []) as unknown as ScoringAward[];
  return awards.map(describeAward);
}
