import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * "Each time you select an Order for the bearer to issue, you can select the Order below: ■ Name
 * (Order): …": a choice of one named option under the moment an Order is selected is one more Order
 * on the bearer's menu, not a choice made at that moment. The moment (with its faction's menu,
 * compile-rule-refs.ts) and the "you can" between it and the opener are what adding an Order means,
 * so the container consumes them. Returns null unless only "you can" stands between the two.
 */
export function addedOrderMoment(list: readonly CompileLeaf[], opener: number): { menu: string; consumed: number[] } | null {
  let at = opener - 1;
  const consumed: number[] = [];
  while (at >= 0 && list[at]!.family_id === "optional-use") consumed.push(at--);
  const moment = list[at];
  if (moment?.family_id !== "event" || moment.parameters.kind !== "used" || moment.parameters.activity !== "order") return null;
  if (typeof moment.parameters.__menu !== "string") return null;
  return { menu: moment.parameters.__menu, consumed: [...consumed, at] };
}

/** The bearer's Orders menu with one more Order, defined here with its own id ("this unit" in it is the ordered unit). */
export function addedOrder(menu: string, option: { id: unknown; name: unknown; effect: unknown }): Node {
  return {
    type: "ability-modifier", target: "this-model",
    modifier: { ability: menu, aspect: "options", operation: "add", add_option: { id: option.id, name: option.name, effect: option.effect } },
  };
}

/**
 * A record that defines one Order ("On My Signal: This Order can only be issued to K units. …"): that
 * Order on the army's Orders menu, with its own recipients. Another rule that makes it available names
 * it by the same option id; the friendly units with the menu are the ones that gain it.
 */
export function definedOrder(menu: string, option: { id: unknown; name: unknown; effect: unknown }, eligible: Node): Node {
  return {
    type: "ability-modifier", target: { owner: "friendly" },
    modifier: { ability: menu, aspect: "options", operation: "add", add_option: { id: option.id, name: option.name, eligible, effect: option.effect } },
  };
}

/**
 * The plan for a record that defines one Order: it opens with that Order's named-option, holds one
 * recipient-keywords order-rule (which carries the faction's menu), and opens no container. The node
 * stands at the Order's first effect leaf; every other leaf is consumed, and all but the rule compile as
 * the Order's effect.
 */
export function definedOrderPlan(
  list: readonly CompileLeaf[],
  option: (group: readonly CompileLeaf[]) => { id: unknown; name: unknown; effect: Node },
): { at: number; node: Node; consumed: Set<number> } {
  const recipients = list.filter((leaf) => leaf.family_id === "order-rule" && leaf.parameters.rule === "recipient-keywords");
  if (recipients.length !== 1) throw new CompileError("A record that defines one Order prints its recipient keywords once.");
  const rule = recipients[0]!;
  if (list[0]?.family_id !== "named-option") throw new CompileError("A record that defines one Order opens with that Order's named-option; an Order's recipient keywords belong to one Order.");
  if (list.some((leaf, at) => at > 0 && leaf.family_id === "named-option")) throw new CompileError("A record that defines one Order names only that Order.");
  const other = list.find((leaf) => leaf.family_id === "order-rule" && leaf !== rule);
  if (other) throw new CompileError(`order-rule ${String(other.parameters.rule)} belongs to an issue-orders; a record that defines one Order has none.`);
  if (typeof rule.parameters.__menu !== "string") throw new CompileError("A record that defines one Order needs its faction's one army rule that lists Orders.");
  const defined = option(list.filter((leaf) => leaf !== rule));
  const eligible = { all_of: [...(closed(rule, "keywords") as string[])] };
  const at = list.findIndex((leaf) => leaf.role === "EFFECT");
  if (at < 0) throw new CompileError("A record that defines one Order says what that Order does.");
  return { at, node: definedOrder(rule.parameters.__menu, defined, eligible), consumed: new Set(list.map((_leaf, index) => index).filter((index) => index !== at)) };
}
