import { CompileError } from "./compile-error.js";
import type { CompileLeaf, TargetOf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * Placeholders for a Stratagem's first and second targets in an order-share, which the leaf names
 * as "the Stratagem's targets"; resolveOrderShareTargets puts each target's name in once the entry
 * knows them.
 */
export const FIRST_TARGET = "__order-share-first-target";
export const SECOND_TARGET = "__order-share-second-target";

/**
 * An orders-modifier leaf as the DSL's orders-modifier: the issuer (a role, or friendly units with
 * the issuer keywords), and the change to how it issues Orders. `orders` resolved to the faction's
 * menu options by compile-rule-refs.ts (`__options`); a name that does not resolve refuses.
 */
export function ordersModifier(leaf: CompileLeaf, target: TargetOf): Node {
  const p = leaf.parameters;
  const issuer = p.subject === "friendly-units" ? { owner: "friendly", all_of: [...(p.issuer_keywords as string[])] } : target(p.subject);
  const modifier: Node = {};
  if (p.orders !== undefined) {
    if (!Array.isArray(p.__options)) throw new CompileError(`The Orders ${JSON.stringify(p.orders)} are not all Orders of the faction's army rule.`);
    modifier.only_options = (p.__options as Node[]).map((option) => ({ ability_id: option.ability_id, option_id: option.option_id }));
  }
  if (p.recipient_keywords !== undefined) {
    modifier.recipients = { all_of: [...(p.recipient_keywords as string[])], ...(p.recipient_excluded !== undefined ? { none_of: [...(p.recipient_excluded as string[])] } : {}) };
  }
  if (p.adds_recipients === true) modifier.adds_recipients = true;
  if (p.count !== undefined) modifier.count = p.count;
  if (p.range !== undefined) modifier.range = p.range;
  if (p.range_proxy !== undefined) modifier.range_proxy = { ...(p.range_proxy as Node) };
  if (p.off_battlefield === true) modifier.off_battlefield = true;
  return { type: "orders-modifier", target: issuer, modifier };
}

/**
 * An order-share's placeholders as the Stratagem's two targets, in TARGET order. A record without
 * exactly two named targets has no pair to share Orders between, and refuses.
 */
export function resolveOrderShareTargets<T>(node: T, targets: readonly Node[] | null): T {
  const text = JSON.stringify(node);
  if (!text.includes(FIRST_TARGET) && !text.includes(SECOND_TARGET)) return node;
  const names = (targets ?? []).map((item) => item.name);
  if (names.length !== 2 || names.some((name) => typeof name !== "string")) {
    throw new CompileError(`An order-share shares Orders between a Stratagem's two targets; this record names ${names.length}.`);
  }
  const swap = (value: unknown): unknown => {
    if (value === FIRST_TARGET) return { stratagem_target: names[0] };
    if (value === SECOND_TARGET) return { stratagem_target: names[1] };
    if (Array.isArray(value)) return value.map(swap);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swap(item)]));
    return value;
  };
  return swap(node) as T;
}
