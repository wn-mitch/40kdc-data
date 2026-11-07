import { conditionLeadIn, isDefensiveEffect } from "./condition-leadin.js";
import { unitFilterPhrase } from "./condition-refs.js";
import type { Condition } from "./condition.js";
import type { Effect } from "./effect.js";
import type { Ctx } from "./effect-words.js";

type P = Record<string, unknown>;

/** The condition with every `recipient` subject read as "that unit" (`event-object`). */
function asThatUnit(c: Condition): Condition {
  const parameters = c.parameters?.subject === "recipient" ? { ...c.parameters, subject: "event-object" } : c.parameters;
  return { ...c, ...(parameters ? { parameters } : {}), ...(c.operands ? { operands: c.operands.map(asThatUnit) } : {}) };
}

function namesRecipient(c: Condition): boolean {
  return c.parameters?.subject === "recipient" || (c.operands ?? []).some(namesRecipient);
}

/**
 * "While an enemy unit is within 3\" of this unit, that unit has -1 OC": a condition on each unit the effect reaches
 * (subject `recipient`) gating a leaf effect aimed at a unit filter. The condition names the unit with the filter's
 * phrase, its later mentions and the effect say "that unit" (or "that model"). Null when the shape is not that one.
 */
export function recipientGate(e: Effect, ctx: Ctx): { lead: string; inner: Effect; ctx: Ctx } | null {
  const inner = e.effect;
  const target = inner?.target as unknown;
  if (e.condition == null || inner == null || target == null || typeof target !== "object" || Array.isArray(target)) return null;
  if (inner.effect != null || inner.steps != null || inner.options != null || !namesRecipient(e.condition)) return null;
  const filter = target as P;
  const model = filter.level === "model";
  const that = model ? "that model" : "that unit";
  const lead = conditionLeadIn(asThatUnit(e.condition), isDefensiveEffect(inner)).replaceAll("that unit", that);
  const at = lead.indexOf(that);
  if (at < 0) return null;
  return {
    lead: `${lead.slice(0, at)}${unitFilterPhrase(filter)}${lead.slice(at + that.length)}`,
    inner: { ...inner, target: "recipient" },
    ctx: model ? { ...ctx, eachModel: true } : { ...ctx, auraRecipient: true },
  };
}
