/**
 * Effect fragments for movement, placement, the army economy and unit state (models returned,
 * destroyed, split or added; Battle-shock). `effect()` in `compile-fragments.ts` delegates here
 * for any family it does not handle itself.
 */

import { closed, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/** The effect for a board or economy family, or undefined when the family is not one of them. */
export function boardEffect(leaf: CompileLeaf, target: (subject: unknown) => string): Node | undefined {
  switch (leaf.family_id) {
    case "make-move": {
      const modifier: Node = { move_type: closed(leaf, "move_type") };
      if (leaf.parameters.distance !== undefined) modifier.distance = closed(leaf, "distance");
      if (leaf.parameters.ends_within_inches !== undefined) modifier.ends_within = { range: { inches: closed(leaf, "ends_within_inches") } };
      // Version 2 (batch 7a): the move counts as a different kind of move for later checks.
      if (leaf.parameters.counts_as_move !== undefined) modifier.counts_as_move = closed(leaf, "counts_as_move");
      return { type: "move", target: closed(leaf, "subject"), modifier };
    }
    case "move-distance":
      return { type: "move-modifier", target: closed(leaf, "subject"), modifier: { applies_to_moves: closed(leaf, "move_types"), distance_bonus: closed(leaf, "bonus") } };
    case "move-through": {
      const modifier: Node = { passthrough: [closed(leaf, "passthrough")] };
      if (leaf.parameters.applies_to_moves !== undefined) modifier.applies_to_moves = closed(leaf, "applies_to_moves");
      if (leaf.parameters.ignore_vertical !== undefined) modifier.ignore_vertical = closed(leaf, "ignore_vertical");
      return { type: "move-modifier", target: closed(leaf, "subject"), modifier };
    }
    case "set-up": {
      const modifier: Node = { to: closed(leaf, "to") };
      if (leaf.parameters.from !== undefined) modifier.from = closed(leaf, "from");
      if (leaf.parameters.min_enemy_distance !== undefined) modifier.min_enemy_distance = closed(leaf, "min_enemy_distance");
      if (leaf.parameters.within_edge !== undefined) modifier.within_edge = closed(leaf, "within_edge");
      if (leaf.parameters.round_offset !== undefined) modifier.round_offset = closed(leaf, "round_offset");
      return { type: "set-up", target: closed(leaf, "subject"), modifier };
    }
    case "battlefield-marker": {
      const modifier: Node = { label: closed(leaf, "label") };
      if (leaf.parameters.operation !== undefined) modifier.operation = closed(leaf, "operation");
      if (leaf.parameters.distance !== undefined) modifier.distance = closed(leaf, "distance");
      return { type: "marker", target: closed(leaf, "subject"), modifier };
    }
    case "transport-capacity": {
      const shape = closed(leaf, "shape");
      if (shape === "capacity") {
        const modifier: Node = { capacity: closed(leaf, "capacity") };
        const keywords = leaf.parameters.capacity_keywords as string[] | undefined;
        if (keywords) modifier.eligible = { all_of: keywords };
        return { type: "transport-capacity", target: "this-unit", modifier };
      }
      const modifier: Node = { occupancy_kind: shape, subject_kind: closed(leaf, "subject_kind") };
      if (leaf.parameters.model_keyword !== undefined) modifier.model_keyword = closed(leaf, "model_keyword");
      if (leaf.parameters.transport_eligibility_kind !== undefined) {
        const field = closed(leaf, "transport_eligibility_kind") === "embark-as-keyword" ? "embark_as_keyword" : "requires_capacity_keyword";
        modifier.transport_eligibility = { [field]: closed(leaf, "transport_eligibility_keyword") };
      }
      if (shape === "grouped-models") {
        modifier.models_per_group = closed(leaf, "models_per_group");
        modifier.spaces_per_group = closed(leaf, "spaces_per_group");
        modifier.rounding = closed(leaf, "rounding");
      } else if (shape === "fixed-model-spaces") {
        modifier.spaces_per_model = closed(leaf, "spaces_per_model");
      } else {
        if (leaf.parameters.equivalent_model_keyword !== undefined) modifier.equivalent_model_keyword = closed(leaf, "equivalent_model_keyword");
        if (leaf.parameters.equivalent_model_count !== undefined) modifier.equivalent_model_count = closed(leaf, "equivalent_model_count");
      }
      return { type: "transport-capacity", target: "this-unit", modifier };
    }
    case "resource-gain": {
      const pool = closed(leaf, "pool");
      const amount = closed(leaf, "amount");
      if (pool === "command-point") return { type: "cp-gain", target: "this-model", modifier: { amount } };
      const modifier: Node = { pool, amount };
      if (leaf.parameters.label !== undefined) modifier.label = closed(leaf, "label");
      return { type: "resource-gain", target: "this-model", modifier };
    }
    case "resource-spend": {
      const modifier: Node = { pool: closed(leaf, "pool"), amount: closed(leaf, "amount") };
      if (leaf.parameters.label !== undefined) modifier.label = closed(leaf, "label");
      if (leaf.parameters.face !== undefined) modifier.face = closed(leaf, "face");
      if (leaf.parameters.requirement_type !== undefined) modifier.requirement = { type: closed(leaf, "requirement_type"), min_value: closed(leaf, "requirement_min") };
      return { type: "resource-spend", target: "this-model", modifier };
    }
    case "resource-die": {
      const modifier: Node = { pool: closed(leaf, "pool"), operation: closed(leaf, "operation") };
      if (leaf.parameters.value !== undefined) modifier.value = closed(leaf, "value");
      if (leaf.parameters.rolls !== undefined) modifier.rolls = closed(leaf, "rolls");
      return { type: "resource-die", target: "this-model", modifier };
    }
    case "stratagem-cost": {
      const modifier: Node = { of: closed(leaf, "of"), operation: closed(leaf, "operation") };
      if (leaf.parameters.amount !== undefined) modifier.amount = closed(leaf, "amount");
      if (leaf.parameters.applies_to !== undefined) modifier.applies_to = closed(leaf, "applies_to");
      if (leaf.parameters.id !== undefined) modifier.id = closed(leaf, "id");
      return { type: "cost-modifier", target: "this-unit", modifier };
    }
    case "apply-mark": {
      const modifier: Node = { tag: closed(leaf, "tag") };
      if (leaf.parameters.clear !== undefined) modifier.clear = closed(leaf, "clear");
      return { type: "designate", target: closed(leaf, "subject"), modifier };
    }
    case "army-construction": {
      const modifier: Node = { rule: closed(leaf, "rule") };
      const withKeywords = leaf.parameters.with_keywords as string[] | undefined;
      if (withKeywords) modifier.with = { all_of: withKeywords };
      if (leaf.parameters.max !== undefined) modifier.max = closed(leaf, "max");
      if (leaf.parameters.led_by !== undefined) modifier.led_by = closed(leaf, "led_by");
      return { type: "army-rule", target: "this-unit", modifier };
    }
    case "return-models": {
      const modifier: Node = { count: countValue(closed(leaf, "count")) };
      if (leaf.parameters.wounds_remaining !== undefined) {
        const wr = closed(leaf, "wounds_remaining");
        if (wr !== "full") modifier.wounds_remaining = countValue(wr);
      }
      if (leaf.parameters.model_keyword !== undefined) modifier.model_keyword = closed(leaf, "model_keyword");
      if (leaf.parameters.bodyguard_only === true) modifier.bodyguard_only = true;
      return { type: "return-models", target: target(leaf.parameters.subject), modifier };
    }
    case "destroy-models": {
      const recipient = String(closed(leaf, "recipient"));
      const modifier: Node = { count: countValue(closed(leaf, "count")) };
      if (leaf.parameters.model_keyword !== undefined) modifier.model_keyword = closed(leaf, "model_keyword");
      if (leaf.parameters.remove_from_play === true) modifier.remove_from_play = true;
      if (leaf.parameters.ignore_death_triggers === true) modifier.ignore_death_triggers = true;
      const target_ = recipient === "this-unit" || recipient === "this-model" ? target(recipient) : recipient;
      return { type: "destroy-models", target: target_, modifier };
    }
    case "split-unit": {
      const mode = closed(leaf, "mode");
      const modifier: Node =
        mode === "model" ? { by: "model" }
          : mode === "counts" ? { model_counts: closed(leaf, "model_counts") }
            : { by: { model_keyword: closed(leaf, "model_keywords") } };
      return { type: "split-unit", target: "this-unit", modifier };
    }
    case "add-unit": {
      const source = closed(leaf, "source");
      const count = countValue(closed(leaf, "count"));
      const base: Node = source === "datasheet" ? { datasheet: closed(leaf, "datasheet") } : { copy_of: "event-object" };
      const join = leaf.parameters.join === true;
      return { type: "add-unit", target: "this-unit", modifier: { ...base, ...(join ? { model_count: count, join: "this-unit" } : { count }) } };
    }
    case "battle-shock-state": {
      const recipient = String(closed(leaf, "recipient"));
      const target_ = recipient === "this-unit" ? target(recipient) : recipient;
      return { type: "state-change", target: target_, modifier: { state: "battle-shocked", set: closed(leaf, "set") } };
    }
    default:
      return undefined;
  }
}

/** A count/amount family value ("1", "D3", "all") as the DSL prefers it: a number when it is one. */
function countValue(value: unknown): unknown {
  const text = String(value);
  return /^\d+$/u.test(text) ? Number(text) : text;
}
