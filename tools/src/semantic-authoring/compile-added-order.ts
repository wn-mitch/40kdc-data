import type { CompileLeaf } from "./compile-fragments.js";

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
