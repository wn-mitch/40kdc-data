import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * An issue-orders container (Astra Militarum Voice of Command): its Orders, each a named option
 * with its own effect and, optionally, the only units it can be issued to; or, for a "same Order"
 * repeat, the Order a moment just issued sent to another unit. Its order-rule leaves, wherever the
 * record prints them, set how the Orders work.
 */

type Node = Record<string, unknown>;

/** compile-containers.ts's option builder: an option group's id, name and effect. */
export type NamedOption = (group: readonly CompileLeaf[], forRequirement: boolean, sourceIndex?: number) => { id: string; name: unknown; effect: Node };

export function buildIssueOrders(head: CompileLeaf, groups: CompileLeaf[][], rules: readonly CompileLeaf[], namedOption: NamedOption): Node {
  const options = groups.map((group, index) => {
    // "This Order can only be issued to K units": the Order's own recipients, not part of what it does.
    const eligible = group.filter(isRecipientRule);
    if (eligible.length > 1) throw new CompileError("One Order prints its recipient keywords once.");
    const { id, name, effect: optionEffect } = namedOption(group.filter((leaf) => !isRecipientRule(leaf)), false, index);
    return { id, name, ...(eligible[0] ? { eligible: { all_of: closed(eligible[0], "keywords") } } : {}), effect: optionEffect };
  });
  const node: Node = { type: "issue-orders" };
  if (head.parameters.same_order === true) {
    // "it can issue the same Order to another X unit": the Order the moment before it just issued, again.
    if (options.length > 0) throw new CompileError("An issue-orders that repeats the Order just issued lists no Orders of its own.");
    node.same_order = true;
    node.exclude = "event-object";
  } else if (options.length > 0) node.options = options;
  else if (typeof head.parameters.__menu === "string") node.menu_from = head.parameters.__menu;
  else throw new CompileError("An issue-orders with no Orders of its own needs its faction's one army rule that lists them.");
  if (head.parameters.count !== undefined) node.count = closed(head, "count");
  if (head.parameters.range !== undefined) node.range = { inches: closed(head, "range") };
  if (head.parameters.eligible_keyword !== undefined) node.eligible = { all_of: [closed(head, "eligible_keyword")] };
  if (head.parameters.__eligible !== undefined) node.eligible = head.parameters.__eligible;
  // "issue 1 Order to that unit, regardless of how many Orders it has already issued": the moment's unit, outside the limit.
  if (head.parameters.recipient === "antecedent") node.recipient = "event-subject";
  if (head.parameters.counts_toward_limit === false) node.counts_toward_limit = false;
  if (head.parameters.as_if_phase !== undefined) node.as_if_phase = closed(head, "as_if_phase");
  // "Your unit's OFFICER model can issue": the model of the unit that issues them.
  if (head.parameters.issuer_keywords !== undefined) node.issuer = { all_of: [...(closed(head, "issuer_keywords") as string[])] };
  const ruled = orderRules(rules);
  if (ruled.issuer !== undefined && node.issuer !== undefined) throw new CompileError("An issue-orders names its issuer once: in its opener or in an order-rule, not both.");
  if (ruled.only_options !== undefined && node.menu_from === undefined) throw new CompileError("Only some Orders of a menu: the issue-orders must take its Orders from its army rule.");
  return { ...node, ...ruled };
}

/** "This Order can only be issued to K units": an order-rule that narrows one Order's recipients. */
export const isRecipientRule = (leaf: CompileLeaf) => leaf.family_id === "order-rule" && leaf.parameters.rule === "recipient-keywords";

/** The issue-orders fields its order-rule leaves set, wherever the record prints them; a repeated rule must agree. */
function orderRules(rules: readonly CompileLeaf[]): Node {
  const out: Node = {};
  const keywords = (key: string, leaf: CompileLeaf) => {
    const all_of = closed(leaf, "keywords") as string[];
    const existing = out[key] as { all_of: string[] } | undefined;
    if (existing && JSON.stringify(existing.all_of) !== JSON.stringify(all_of)) throw new CompileError(`Two order-rule leaves name different ${key} keywords.`);
    out[key] = { all_of };
  };
  const states = (key: string, leaf: CompileLeaf) => {
    out[key] = [...new Set([...((out[key] as string[] | undefined) ?? []), closed(leaf, "state") as string])];
  };
  for (const leaf of rules) {
    switch (leaf.parameters.rule) {
      case "issuer": keywords("issuer", leaf); break;
      case "benefit": keywords("benefit", leaf); break;
      case "one-at-a-time": out.one_at_a_time = true; break;
      case "ineligible-state": states("ineligible_states", leaf); break;
      case "ends-on-state": states("ends_on", leaf); break;
      case "only-orders": {
        if (!Array.isArray(leaf.parameters.__options)) throw new CompileError(`The Orders ${JSON.stringify(leaf.parameters.orders)} are not all Orders of the faction's army rule.`);
        if (out.only_options !== undefined) throw new CompileError("An officer's Orders are narrowed by one only-orders rule.");
        out.only_options = leaf.parameters.__options;
        break;
      }
      default: throw new CompileError(`order-rule ${String(leaf.parameters.rule)} has no issue-orders field.`);
    }
  }
  return out;
}

