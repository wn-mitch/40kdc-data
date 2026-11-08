import type { CompileLeaf } from "./compile-fragments.js";
import { AURA_RECIPIENT } from "./compile-antecedent.js";
import { wrapModelAura } from "./compile-model-level.js";
import { wrapAura } from "./compile-wrappers.js";

type Node = Record<string, unknown>;

/** Nodes that bind a recipient of their own: an aura's units, a for-each pass's unit. */
const RECIPIENT_BINDERS = new Set(["aura", "for-each-unit"]);

/**
 * Whether a compiled node names the aura's recipient outside any node that binds its own (an aura,
 * a for-each pass) and outside a granted ability's definition, whose recipient is that ability's.
 */
export function namesUnboundRecipient(node: unknown): boolean {
  if (node === AURA_RECIPIENT) return true;
  if (Array.isArray(node)) return node.some(namesUnboundRecipient);
  if (node === null || typeof node !== "object") return false;
  const record = node as Node;
  if (RECIPIENT_BINDERS.has(String(record.type))) return false;
  return Object.entries(record).some(([key, value]) => key !== "definition" && namesUnboundRecipient(value));
}

/**
 * The effect of a part after the record's first: "While an enemy unit is within 6\" of this model, …. In
 * addition, in the Battle-shock step …, if such an enemy unit is …, it must …". A part whose effect names the
 * aura's recipient is about each unit the aura reaches, so it takes the aura too; any other part is left as it
 * is. `moments` are the part's own triggers, which a model-level aura's recipient cannot be.
 */
export function auraPart(aura: CompileLeaf | null, effect: Node, moments: readonly Node[]): Node {
  if (aura === null || !namesUnboundRecipient(effect)) return effect;
  return aura.parameters.model_recipient !== undefined ? wrapModelAura(aura, effect, moments) : wrapAura(aura, effect);
}
