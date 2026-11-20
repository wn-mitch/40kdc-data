/**
 * Orders (Astra Militarum Voice of Command) beyond the issue-orders menu itself: a change to how a
 * unit issues Orders (`orders-modifier`), Orders shared between two units (`order-share`), and the
 * phrases an issue-orders adds for the phase it acts as, an Order's own recipients and a repeat of
 * the Order just issued.
 */

import { andList, titleCase } from "./condition-refs.js";
import { capitalize, effectSubject, filterSubject, jstr, type Ctx } from "./effect-words.js";

type P = Record<string, unknown>;

/** "friendly ASTRA MILITARUM TRANSPORT units (excluding TITANIC units)": friendly units by keyword. */
function friendlyUnits(keywords: unknown, ctx: Ctx): string {
  return filterSubject({ owner: "friendly", ...(keywords as P) }, ctx).replace(/^all /, "");
}

/** The Orders an orders-modifier changes: "the Move Move Move Order", or every Order. */
function ordersPhrase(only: unknown): string {
  if (!Array.isArray(only) || only.length === 0) return "Orders";
  const names = only.map((option) => titleCase(jstr((option as P).option_id)));
  return `the ${andList(names)} ${names.length === 1 ? "Order" : "Orders"}`;
}

/** orders-modifier: how its target issues Orders, to whom, how many and from how far. */
export function ordersModifier(m: P, subj: string, ctx: Ctx): string {
  const adds = m.adds_recipients === true;
  const any = m.count === "any" ? "any number of " : "";
  let to = "";
  if (m.recipients != null) to = ` to ${any}${adds ? "" : "eligible "}${friendlyUnits(m.recipients, ctx)}`;
  else if (m.count === "any") to = " to any number of eligible units";
  const proxy = m.range_proxy as P | undefined;
  if (proxy != null) {
    const inches = `${jstr(proxy.inches)}"`;
    to += ` within ${inches} of the ${titleCase(jstr(proxy.marker))} token, as if within ${inches} of them`;
  }
  const off = m.off_battlefield === true ? " even while not on the battlefield" : "";
  const range = m.range === "unlimited" ? ", regardless of range" : "";
  return `${subj} can ${adds ? "also " : ""}issue ${ordersPhrase(m.only_options)}${to}${off}${range}`;
}

/** order-share: Orders affecting its target also affect the other unit. */
export function orderShare(m: P, subj: string, ctx: Ctx): string {
  return `Orders affecting ${subj} also affect ${effectSubject(m.with, ctx)}${m.mutual === true ? ", and vice versa" : ""}`;
}

/** " as if it were your Command phase": the phase an issue-orders issues its Orders as. */
export function asIfPhase(e: { as_if_phase?: unknown }): string {
  return e.as_if_phase != null ? ` as if it were your ${capitalize(jstr(e.as_if_phase))} phase` : "";
}

/** " (only to friendly ARMOURED SKIRMISHER units)": the units one Order of a menu can be issued to. */
export function optionRecipients(option: P, ctx: Ctx): string {
  return option.eligible != null ? ` (only to ${friendlyUnits(option.eligible, ctx)})` : "";
}

/** "the same Order to one other of the eligible …": a repeat of the Order the triggering use issued. */
export function sameOrderTarget(count: unknown, units: string): string {
  const n = count == null || count === 1 ? "one other of the" : `up to ${jstr(count)} other`;
  return `the same Order to ${n} eligible ${units}`;
}

/** "only to friendly ARMOURED SKIRMISHER units: ": the units an Order added to a menu can be issued to. */
export function addedOptionRecipients(option: { eligible?: unknown }, ctx: Ctx): string {
  return option.eligible != null ? `only to ${friendlyUnits(option.eligible, ctx)}: ` : "";
}
