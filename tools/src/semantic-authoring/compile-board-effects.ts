/**
 * Effect fragments for movement, placement, the army economy and unit state (models returned,
 * destroyed, split or added; Battle-shock). `effect()` in `compile-fragments.ts` delegates here
 * for any family it does not handle itself.
 */

import { LIST_BUILDING_DESIGNATIONS } from "../translate/designations.js";
import { armyRuleEffect } from "./compile-army.js";
import { closed, CompileError, type CompileLeaf, unitOf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/** The effect for a board or economy family, or undefined when the family is not one of them. */
export function boardEffect(leaf: CompileLeaf, target: (subject: unknown) => Node | string): Node | undefined {
  switch (leaf.family_id) {
    case "make-move": {
      const modifier: Node = { move_type: closed(leaf, "move_type") };
      if (leaf.parameters.distance !== undefined) modifier.distance = closed(leaf, "distance");
      if (leaf.parameters.ends_within_inches !== undefined) modifier.ends_within = { range: { inches: closed(leaf, "ends_within_inches") } };
      // Version 2 (batch 7a): the move counts as a different kind of move for later checks.
      if (leaf.parameters.counts_as_move !== undefined) modifier.counts_as_move = closed(leaf, "counts_as_move");
      // Folded from "as if it were your Movement phase" after the move (compile-as-if.ts).
      if (leaf.parameters.as_if !== undefined) modifier.as_if = closed(leaf, "as_if");
      // Version 6: the disembark mode ("an assault disembark move").
      if (leaf.parameters.mode !== undefined) modifier.mode = closed(leaf, "mode");
      return { type: "move", target: unitOf(leaf, "subject"), modifier };
    }
    case "move-distance": {
      const modifier: Node = { applies_to_moves: closed(leaf, "move_types") };
      if (leaf.parameters.maximum !== undefined) modifier.maximum = closed(leaf, "maximum");
      else modifier.distance_bonus = closed(leaf, "bonus");
      return { type: "move-modifier", target: unitOf(leaf, "subject"), modifier };
    }
    case "move-mode-choice": {
      const modes = leaf.parameters.modes === "any" ? "any" : closed(leaf, "modes");
      const modeChoice: Node = { modes, ...(leaf.parameters.ignore_before_moving === true ? { ignore_before_moving: true } : {}) };
      return { type: "move-modifier", target: unitOf(leaf, "subject"), modifier: { applies_to_moves: closed(leaf, "move_types"), mode_choice: modeChoice } };
    }
    case "move-through": {
      // A pair of listed tokens (move-through@4, families/moves.ts) is one list.
      const modifier: Node = { passthrough: Array.isArray(leaf.parameters.passthrough) ? [...leaf.parameters.passthrough] : [closed(leaf, "passthrough")] };
      if (leaf.parameters.applies_to_moves !== undefined) modifier.applies_to_moves = closed(leaf, "applies_to_moves");
      if (leaf.parameters.ignore_vertical !== undefined) modifier.ignore_vertical = closed(leaf, "ignore_vertical");
      return { type: "move-modifier", target: unitOf(leaf, "subject"), modifier };
    }
    case "set-up": {
      const modifier: Node = { to: closed(leaf, "to") };
      if (leaf.parameters.from !== undefined) modifier.from = closed(leaf, "from");
      if (leaf.parameters.min_enemy_distance !== undefined) modifier.min_enemy_distance = { inches: closed(leaf, "min_enemy_distance") };
      if (leaf.parameters.within_edge !== undefined) modifier.within_edge = { inches: closed(leaf, "within_edge") };
      if (leaf.parameters.round_offset !== undefined) modifier.round_offset = closed(leaf, "round_offset");
      if (leaf.parameters.placement !== undefined) modifier.placement = closed(leaf, "placement");
      if (leaf.parameters.ignore_limits === true) modifier.ignore_limits = true;
      // Version 4: set up using a Cult Ambush marker, touching it unless a range is given.
      if (leaf.parameters.via !== undefined) modifier.via = leaf.parameters.via === "cult-ambush-marker" ? "cult-ambush" : closed(leaf, "via");
      if (leaf.parameters.marker_inches !== undefined) modifier.marker_range = { range: { inches: closed(leaf, "marker_inches") }, ...(leaf.parameters.marker_wholly === true ? { wholly: true } : {}) };
      // Folded from wounds-remaining, starting-strength and leaves-attached-unit (compile-model-state.ts).
      if (leaf.parameters.wounds_remaining !== undefined) modifier.wounds_remaining = countValue(closed(leaf, "wounds_remaining"));
      if (leaf.parameters.detach === true) modifier.detach = true;
      if (leaf.parameters.starting_strength !== undefined) modifier.starting_strength = closed(leaf, "starting_strength");
      // Version 5: a forbidden ("cannot be set up") or required ("must be set up") set-up.
      if (leaf.parameters.allow === false) modifier.allow = false;
      if (leaf.parameters.mandatory === true) modifier.mandatory = true;
      Object.assign(modifier, foldedPlacement(leaf, modifier.placement));
      // A set-up restriction (compile-set-up-placement.ts): the side whose set-ups are forbidden.
      const target_ = leaf.parameters.restricted_owner !== undefined ? { owner: closed(leaf, "restricted_owner") } : unitOf(leaf, "subject");
      return { type: "set-up", target: target_, modifier };
    }
    case "battlefield-marker": {
      const modifier: Node = { label: closed(leaf, "label") };
      if (leaf.parameters.operation !== undefined) modifier.operation = closed(leaf, "operation");
      if (leaf.parameters.distance !== undefined) modifier.distance = { inches: closed(leaf, "distance") };
      // Version 2: only a marker not yet moved this turn.
      if (leaf.parameters.not_moved_this_turn === true) modifier.not_moved_this_turn = true;
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
      // The leaf names the Normal-move roll `normal-move`; the DSL roll-kind spells it as its movement-kind, `normal`.
      if (leaf.parameters.rolls !== undefined) modifier.rolls = (closed(leaf, "rolls") as string[]).map((roll) => roll === "normal-move" ? "normal" : roll);
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
      if (LIST_BUILDING_DESIGNATIONS.has(String(modifier.tag))) throw new CompileError("A list-building designation (the Warlord) cannot be applied by a rule.");
      if (leaf.parameters.clear !== undefined) modifier.clear = closed(leaf, "clear");
      // apply-mark@4: who applied it, and when it ends (compile-designation-expiry.ts sets clears_on).
      if (leaf.parameters.by !== undefined) modifier.by = closed(leaf, "by");
      if (leaf.parameters.clears_on !== undefined) modifier.clears_on = leaf.parameters.clears_on;
      // apply-mark@5: the selected objective marker carries the tag (designate's objective subject).
      // The stratagem's effect has no unit to tag, so the target is this unit, as optional costs do.
      if (leaf.parameters.subject === "selected-objective") {
        if (typeof leaf.parameters.selection_var !== "string") throw new CompileError("apply-mark names the selected objective marker, but this record selects no objective marker.");
        if (leaf.parameters.by !== undefined) throw new CompileError("A designation on an objective marker has no applier; drop by.");
        modifier.subject = { objective: { selection_var: leaf.parameters.selection_var } };
        return { type: "designate", target: "this-unit", modifier };
      }
      return { type: "designate", target: unitOf(leaf, "subject"), modifier };
    }
    case "army-construction":
      return armyRuleEffect(leaf);
    case "return-models": {
      const modifier: Node = { count: countValue(closed(leaf, "count")) };
      if (leaf.parameters.wounds_remaining !== undefined) {
        const wr = closed(leaf, "wounds_remaining");
        if (wr !== "full") modifier.wounds_remaining = countValue(wr);
      }
      return { type: "return-models", target: affectedModels(leaf, target(leaf.parameters.subject)), modifier };
    }
    case "destroy-models": {
      const recipient = String(closed(leaf, "recipient"));
      const modifier: Node = { count: countValue(closed(leaf, "count")) };
      if (leaf.parameters.remove_from_play === true) modifier.remove_from_play = true;
      if (leaf.parameters.ignore_death_triggers === true) modifier.ignore_death_triggers = true;
      const target_ = recipient === "this-unit" || recipient === "this-model" ? target(recipient) : recipient;
      return { type: "destroy-models", target: affectedModels(leaf, target_), modifier };
    }
    case "split-unit": {
      const mode = closed(leaf, "mode");
      const modifier: Node =
        mode === "model" ? { by: "model" }
          : mode === "counts" ? { model_counts: closed(leaf, "model_counts") }
            : { by: { model_keyword: closed(leaf, "model_keywords") } };
      // Folded from a starting-strength qualifier (compile-model-state.ts): each resulting unit's.
      if (leaf.parameters.starting_strength !== undefined) modifier.starting_strength = closed(leaf, "starting_strength");
      return { type: "split-unit", target: "this-unit", modifier };
    }
    case "add-unit": {
      const source = closed(leaf, "source");
      const count = countValue(closed(leaf, "count"));
      const base: Node = source === "datasheet" ? { datasheet: closed(leaf, "datasheet") } : { copy_of: "event-object" };
      const join = leaf.parameters.join === true;
      // A copy that leaves models out, comes back whole, resets [One Shot] weapons or waits in Reserves.
      const copy: Node = {
        ...(leaf.parameters.copy_excluded_keywords !== undefined ? { excluded_keywords: closed(leaf, "copy_excluded_keywords") } : {}),
        ...(leaf.parameters.at_starting_strength === true ? { at_starting_strength: true } : {}),
        ...(leaf.parameters.reset_one_shot === true ? { reset_one_shot: true } : {}),
      };
      if (Object.keys(copy).length && source === "datasheet") throw new CompileError("Only a copy of a destroyed unit can leave models out, return at Starting Strength or reset [One Shot] weapons.");
      if (Object.keys(copy).length && join) throw new CompileError("Models joining an existing unit are not a copy: excluded keywords, Starting Strength and [One Shot] resets apply only to a new unit.");
      const held = leaf.parameters.held_in === undefined ? {} : { placement: closed(leaf, "held_in") };
      // "… and set it up anywhere on the battlefield": the set-up folded in (compile-set-up-placement.ts).
      const placed = foldedPlacement(leaf, leaf.parameters.set_up_placement);
      // Folded from a unit-size qualifier (compile-model-state.ts): how many models the new unit contains.
      const size = leaf.parameters.model_count ?? leaf.parameters.models;
      if (size !== undefined && (join || source !== "datasheet")) throw new CompileError("Only a new unit of a named datasheet takes a size; a copy or models joining a unit already say how many.");
      // "If you do, that unit can be set up within Engagement Range of the destroyed unit" (compile-set-up-placement.ts permissionLimit).
      const permitted = leaf.parameters.folded_allow_engagement_with !== undefined ? { allow_engagement_with: leaf.parameters.folded_allow_engagement_with } : {};
      return { type: "add-unit", target: "this-unit", modifier: { ...base, ...(join ? { model_count: count, join: "this-unit" } : { count }), ...(size !== undefined ? { model_count: structuredClone(size) } : {}), ...copy, ...held, ...placed, ...permitted } };
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

/** Returned/destroyed model restrictions apply to members, not their containing unit. */
function affectedModels(leaf: CompileLeaf, recipient: Node | string): Node | string {
  const p = leaf.parameters;
  if (p.model_keyword === undefined && p.exclude_model_keyword === undefined && p.bodyguard_only !== true && p.exclude_leader !== true) return recipient;
  const keywords = (value: unknown): unknown[] => Array.isArray(value) ? value : [value];
  return {
    level: "model", member_of: recipient,
    ...(p.model_keyword === undefined ? {} : { all_of: keywords(closed(leaf, "model_keyword")) }),
    ...(p.exclude_model_keyword === undefined ? {} : { none_of: keywords(closed(leaf, "exclude_model_keyword")) }),
    ...(p.bodyguard_only === true || p.exclude_leader === true ? { attachment_role: "bodyguard" } : {}),
  };
}

/**
 * The placement limits folded onto a set-up or add-unit (compile-set-up-placement.ts) as DSL
 * fields, with "not within Engagement Range of any enemy units" added to its placement keywords.
 */
function foldedPlacement(leaf: CompileLeaf, placement: unknown): Node {
  const result: Node = {};
  if (leaf.parameters.folded_near !== undefined) result.near = structuredClone(leaf.parameters.folded_near);
  if (leaf.parameters.folded_away_from !== undefined) result.away_from = structuredClone(leaf.parameters.folded_away_from);
  if (leaf.parameters.folded_in_region !== undefined) result.in_region = structuredClone(leaf.parameters.folded_in_region);
  const keywords = placement === undefined ? [] : Array.isArray(placement) ? [...placement] : [placement];
  if (leaf.parameters.folded_unengaged === true && !keywords.includes("unengaged")) keywords.push("unengaged");
  if (keywords.length) result.placement = keywords.length === 1 ? keywords[0] : keywords;
  return result;
}

/** A count/amount family value ("1", "D3", "all") as the DSL prefers it: a number when it is one. */
function countValue(value: unknown): unknown {
  const text = String(value);
  return /^\d+$/u.test(text) ? Number(text) : text;
}
