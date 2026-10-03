import { hasAntecedent } from "./compile-antecedent.js";
import { attackTypeCondition, ATTACK_EVENTS, condition, duration } from "./compile-conditions.js";
import { isContainerOpener } from "./compile-containers.js";
import { effect, type CompileLeaf } from "./compile-fragments.js";
import { trigger } from "./compile-triggers.js";
import { WEAPON_CHARACTERISTICS } from "./effect-families.js";
import { usageFor } from "./restriction-families.js";

type Node = Record<string, unknown>;

/** What one leaf contributes on its own, for the per-leaf preview. */
export type LeafFragment =
  | { kind: "effect" | "condition" | "trigger"; node: Node }
  | { kind: "duration"; duration: string }
  | { kind: "implicit"; note: string };

export function leafFragment(leaf: CompileLeaf): LeafFragment {
  if (hasAntecedent(leaf)) {
    return { kind: "implicit", note: "No separate text: points back to the unit an earlier leaf introduced (the selected unit, else the triggering unit), bound when the record compiles." };
  }
  if (isContainerOpener(leaf.family_id)) {
    return { kind: "implicit", note: "No separate text: opens a container; every sentence after it, up to the next opener, becomes one of its options." };
  }
  if (leaf.family_id === "named-option") return { kind: "implicit", note: "No separate text: its label names the option; the effects after it are that option's own." };
  if (leaf.family_id === "on-fail-open") return { kind: "implicit", note: "No separate text: the effects after it are risk-reward's on_fail." };
  if (leaf.family_id === "menu-action") return { kind: "implicit", note: "No separate text: its id, label and cost open one resource-action-menu action; the trigger and effect leaves after it are that action's own." };
  if (leaf.family_id === "weapon-property-scope") return { kind: "implicit", note: "No separate text: identifies the recipient and weapon scope of the following property; grants nothing by itself." };
  if (leaf.family_id === "returned-model-exclusion") return { kind: "implicit", note: `Exclude individual returned models with any of these keywords: ${(leaf.parameters.keywords as string[]).join(", ")}; do not exclude their whole unit.` };
  if (leaf.family_id === "weapon-ability-keyword") return { kind: "implicit", note: `No separate text: its reviewed weapon scope or ability-grant frame grants ${String(leaf.parameters.keyword)}.` };
  if (leaf.family_id === "weapon-ability-grant" && leaf.parameters.keyword === undefined) {
    return { kind: "implicit", note: "No separate text: grants the weapon-ability-keyword leaves of its sentence (or the nearest earlier ones)." };
  }
  if ((leaf.family_id === "characteristic-modifier" && leaf.family_version >= 5 && (leaf.parameters.subject === undefined
    || leaf.parameters.weapon_type === undefined && (leaf.parameters.characteristics as string[]).some((stat) => (WEAPON_CHARACTERISTICS as readonly string[]).includes(stat))))
    || (leaf.family_id === "characteristic-set" && leaf.family_version >= 3 && (leaf.parameters.subject === undefined
      || leaf.parameters.weapon_type === undefined && (WEAPON_CHARACTERISTICS as readonly string[]).includes(String(leaf.parameters.characteristic))))) {
    return { kind: "implicit", note: `Stat adjustment ${JSON.stringify(leaf.parameters)} needs a reviewed recipient and, for weapon stats, weapon scope.` };
  }
  if (leaf.role === "EFFECT") return { kind: "effect", node: effect(leaf, { attached: false, incoming: false }) };
  if (leaf.role === "COMBINATOR") {
    return { kind: "implicit", note: "No separate text: this effect replaces an earlier one of the same kind when its condition holds." };
  }
  if (leaf.role === "RESTRICTION") {
    if (leaf.family_id === "usage-limit") {
      return { kind: "implicit", note: leaf.parameters.per === undefined
        ? `No separate text: frequency ${String(leaf.parameters.frequency)} needs a reviewed allowance scope.`
        : `No separate text: sets the ability's usage to ${JSON.stringify(usageFor(leaf.parameters))}.` };
    }
    if (leaf.family_id === "usage-scope") {
      return { kind: "implicit", note: `No separate text: qualifies the usage allowance as per ${String(leaf.parameters.per)}.` };
    }
    return { kind: "implicit", note: leaf.family_id === "optional-use"
      ? "No separate text: the player chooses whether to use it (an optional trigger, or an activated ability)."
      : leaf.family_id === "rules-bundle-marker" ? "No separate text: the whole ability's body becomes a named rules bundle."
        : leaf.family_id === "activation-window" ? "No separate text: the whole ability applies only in the phases it names."
          : leaf.family_id === "move-must-end" ? "No separate text: the conditions after it become where the move before it must end."
            : "No separate text: checked against the core record, which already holds it." };
  }
  if (leaf.family_id === "target-is-selected") return { kind: "implicit", note: "No separate text: the effects it gates apply to attacks against the selected unit." };
  if (leaf.family_id === "dice-roll") return { kind: "implicit", note: `No separate text: roll one ${String(leaf.parameters.dice)}; the result bands after it say what each result does.` };
  if (leaf.family_id === "roll-result") return { kind: "implicit", note: leaf.parameters.to === undefined
    ? `No separate text: the effects in its clause happen on at least ${String(leaf.parameters.from)}; the dice roll supplies the upper bound.`
    : `No separate text: the effects in its clause happen on a ${String(leaf.parameters.from)}-${String(leaf.parameters.to)}.` };
  if (leaf.family_id === "unit-filter") return { kind: "implicit", note: "No separate text: says which units the selection before it may pick, or which units the aura after it reaches." };
  if (leaf.family_id === "aura-range" || leaf.family_id === "leader-target") {
    return { kind: "implicit", note: "No separate text: wraps the rest of the ability's effects, the same way select-unit does." };
  }
  if (leaf.role === "CONDITION") return { kind: "condition", node: condition(leaf) };
  if (leaf.role === "DURATION") return { kind: "duration", duration: duration(leaf) };
  if (leaf.family_id === "attack") {
    const gate = attackTypeCondition(leaf);
    return gate ? { kind: "condition", node: gate } : { kind: "implicit", note: "No separate text: an attack is part of the effect it goes with." };
  }
  if (leaf.family_id === "select-unit" || leaf.family_id === "for-each-unit-select") return { kind: "implicit", note: "No separate text: the selection is written with the effects that refer to the selected unit." };
  if (leaf.family_id === "event" && ATTACK_EVENTS.has(String(leaf.parameters.kind))) return { kind: "implicit", note: "No separate text: an attack-time event is part of the effect it goes with." };
  return { kind: "trigger", node: trigger(leaf) };
}
