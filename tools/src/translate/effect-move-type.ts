/**
 * The move-type container: a move type an army rule defines (Special Move Types), as a named mode of a
 * core move or a move of its own, with what applies before, while and after a unit makes it.
 */

import { type Condition, describeCondition } from "./condition.js";
import { rangePhrase } from "./condition-refs.js";
import { capitalize, diceCase, jstr } from "./effect-words.js";

type P = Record<string, unknown>;
type Render = (effect: unknown) => string;

const MOVES: Record<string, string> = {
  normal: "Normal", advance: "Advance", "fall-back": "Fall Back", charge: "Charge", "pile-in": "Pile-in", consolidation: "Consolidation",
  surge: "Surge", scout: "Scout", ingress: "Ingress", disembark: "Disembark", embark: "Embark", "pulse-jet": "Pulse Jet",
};

const titled = (slug: string): string => slug.split("-").map((word) => capitalize(word)).join(" ");

/** "Shock Disembark Move (the shock mode of a Disembark move)". */
function head(e: P): string {
  const move = MOVES[jstr(e.move_type)] ?? titled(jstr(e.move_type));
  return e.mode == null ? jstr(e.name) : `${jstr(e.name)} (the ${titled(jstr(e.mode))} mode of a ${move} move)`;
}

/** Each statement the move type makes, as a clause, in the order the app prints them. */
function clauses(e: P, inline: Render): string[] {
  const out: string[] = [];
  if (e.distance != null) out.push(`the unit can move up to ${diceCase(e.distance)}"`);
  if (e.setup_distance != null) out.push(`each model is set up wholly within ${rangePhrase(e.setup_distance)} of that Transport`);
  if (e.eligible_if != null) out.push(`a unit can make this move only if ${describeCondition(e.eligible_if as Condition)}`);
  if (e.before != null) out.push(`before it moves, ${inline(e.before)}`);
  if (e.while != null) out.push(`while it moves, ${inline(e.while)}`);
  if (e.after != null) out.push(`after it moves, ${inline(e.after)}`);
  return out;
}

export function moveTypeInline(e: P, inline: Render): string {
  const parts = clauses(e, inline);
  return parts.length ? `${head(e)}: ${parts.join("; ")}` : head(e);
}

export function moveTypeBlock(e: P, indent: string, arrow: string, inline: Render): string {
  const parts = clauses(e, inline);
  if (!parts.length) return `${indent}${arrow}${head(e)}.`;
  return [`${indent}${arrow}${head(e)}:`, ...parts.map((part) => `${indent}  - ${capitalize(part)}.`)].join("\n");
}
