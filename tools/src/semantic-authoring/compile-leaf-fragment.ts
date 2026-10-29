import { hasAntecedent } from "./compile-antecedent.js";
import { attackTypeCondition, ATTACK_EVENTS, condition, duration } from "./compile-conditions.js";
import { isContainerOpener } from "./compile-containers.js";
import { effect, type CompileLeaf } from "./compile-fragments.js";
import { trigger, triggerLeaves } from "./compile-triggers.js";
import { WEAPON_CHARACTERISTICS } from "./effect-families.js";
import { usageFor } from "./restriction-families.js";
import { awaitsFollowingFilter } from "./families/shared.js";
import { namesSelection } from "./compile-targeting-history.js";
import { prohibitedRollName } from "./compile-roll-prohibition.js";

type Node = Record<string, unknown>;

/** What one leaf contributes on its own, for the per-leaf preview. */
export type LeafFragment =
  | { kind: "effect" | "condition"; node: Node }
  // One trigger, or one per roll kind for a list moment (compile-triggers.ts triggerLeaves).
  | { kind: "trigger"; node: Node | Node[] }
  | { kind: "duration"; duration: string }
  | { kind: "implicit"; note: string };

export function leafFragment(leaf: CompileLeaf): LeafFragment {
  if (hasAntecedent(leaf)) {
    return { kind: "implicit", note: "No separate text: points back to the unit an earlier leaf introduced (the selected unit, else the triggering unit), bound when the record compiles." };
  }
  if (leaf.family_id === "attack-filter" && leaf.parameters.of === "antecedent") {
    return { kind: "implicit", note: "No separate text: the attacks of the shooting moment before it, which the hidden suppression right after it names; bound when the record compiles." };
  }
  if (isContainerOpener(leaf.family_id)) {
    return { kind: "implicit", note: "No separate text: opens a container; every sentence after it, up to the next opener, becomes one of its options." };
  }
  if (leaf.family_id === "granted-ability-name") return { kind: "implicit", note: "No separate text: its label names one ability a printed grant gives; the leaves after it, to the end of its paragraph, are that ability's own." };
  if (leaf.family_id === "named-ability-definition") return { kind: "implicit", note: `Declares named ability ${String(leaf.parameters.definition_id)}; subsequent reviewed leaves define its body without granting it.` };
  if (leaf.family_id === "named-ability-definition-end") return { kind: "implicit", note: "Ends the named ability body; subsequent leaves belong to the containing rule." };
  if (leaf.family_id === "resource-before-ability-determination") return { kind: "implicit", note: `Resolve ${String(leaf.parameters.pool)} income before determining named abilities at the same phase-end event.` };
  if (leaf.family_id === "ability-record-grant" && leaf.parameters.printed !== undefined) {
    return { kind: "implicit", note: "No separate text: gives its holder the abilities printed after it; each compiles alone, as the holder's own ability." };
  }
  if (leaf.family_id === "named-option") return { kind: "implicit", note: "No separate text: its label names the option; the effects after it are that option's own." };
  if (leaf.family_id === "on-fail-open") return { kind: "implicit", note: "No separate text: the effects after it are risk-reward's on_fail." };
  if (leaf.family_id === "menu-action") return { kind: "implicit", note: "No separate text: its id, label and cost open one resource-action-menu action; the trigger and effect leaves after it are that action's own." };
  if (leaf.family_id === "weapon-property-scope") return { kind: "implicit", note: "No separate text: identifies the recipient and weapon scope of the following property; grants nothing by itself." };
  if (leaf.family_id === "weapon-has-ability") return { kind: "implicit", note: "Reads: the weapon already has the ability the grant before it gave; the sentence after it then changes only those weapons." };
  if (leaf.family_id === "returned-model-exclusion") return { kind: "implicit", note: `Exclude individual returned models with any of these keywords: ${(leaf.parameters.keywords as string[]).join(", ")}; do not exclude their whole unit.` };
  if (leaf.family_id === "wounds-remaining") {
    const value = leaf.parameters.value;
    const wounds = value === "full" ? "its full wounds" : value === "half-starting" ? "half of its starting number of wounds" : `${String(value)} ${value === 1 ? "wound" : "wounds"}`;
    return { kind: "implicit", note: `No separate text: the set-up or returned model before it has ${wounds} remaining.` };
  }
  if (leaf.family_id === "counts-as-moved") {
    const period = leaf.parameters.window === "phase" ? " that phase" : " this turn";
    const who = leaf.parameters.units === "permission-subject" ? "the subject of the permission before it, in its sentence, counts" : "the permission before it, in its sentence, counts";
    return { kind: "implicit", note: `No separate text: ${who} as having made a ${String(leaf.parameters.move_type)} move${period}.` };
  }
  if (leaf.family_id === "starting-strength") return { kind: "implicit", note: `No separate text: the unit the set-up or split before it produces has a Starting Strength of ${String(leaf.parameters.value)}.` };
  if (leaf.family_id === "count-scale") {
    const per = leaf.parameters.per === 1 ? "once for each" : `once for every ${String(leaf.parameters.per)}`;
    return { kind: "implicit", note: leaf.parameters.counts === "following-items"
      ? "No separate text: the effect in its sentence applies once for each bulleted item after it whose conditions hold."
      : `No separate text: the amount of the effect in its sentence applies ${per} of the units or models the unit-filter after it counts.` };
  }
  if (leaf.family_id === "characteristic-amount") return { kind: "implicit", note: "No separate text: the characteristic change before it, past its recipient, takes this amount." };
  if (leaf.family_id === "additive-option") return { kind: "implicit", note: "No separate text: the activation before it, past its duration, takes this addition." };
  if (leaf.family_id === "ignore-modifier-list") return { kind: "implicit", note: "No separate text: the kinds the ignore-modifiers lead-in before it names." };
  // An additive change with no amount reads as its recipient and characteristic; the amount leaf after the recipient gives the rest.
  if (leaf.family_id === "characteristic-modifier" && leaf.parameters.value === undefined && leaf.parameters.operation !== "halve") {
    return { kind: "implicit", note: "No separate text: the amount is the characteristic-amount leaf after its recipient, bound when the record compiles." };
  }
  if (leaf.family_id === "scale-cap") return { kind: "implicit", note: `No separate text: the amount the count-scale in its sentence multiplies is at most ${String(leaf.parameters.max)}.` };
  if (leaf.family_id === "membership") return { kind: "implicit", note: `No separate text: the counted models are ${String(leaf.parameters.relation).replaceAll("-", " ")} ${leaf.parameters.of === "this-model" ? "this model" : "this unit"}.` };
  if (leaf.family_id === "unit-size") return { kind: "implicit", note: `No separate text: the unit the add-unit before it adds contains ${String(leaf.parameters.models)} ${leaf.parameters.models === 1 ? "model" : "models"}.` };
  if (leaf.family_id === "leaves-attached-unit") return { kind: "implicit", note: "No separate text: the model the set-up before it places is no longer part of an attached unit; it is set up as a unit of its own." };
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
  if (leaf.family_id === "roll-prohibition") {
    return { kind: "implicit", note: `No separate text: the roll named here (${prohibitedRollName(leaf.parameters.roll)}) is not made; the Instead after it says what happens in its place.` };
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
  if (awaitsFollowingFilter(leaf.parameters) && leaf.parameters.following_filter === undefined) {
    if (leaf.family_id === "hit-by-attacks" && leaf.parameters.object === "following-filter") return { kind: "implicit", note: "No separate text: scored a hit against any unit the unit-filter right after it names." };
    const relation = leaf.family_id === "unit-state" ? "engaged with" : leaf.family_id === "hit-by-attacks" ? "hit by attacks made by" : leaf.family_id === "unit-position" ? "measured to" : "targeting";
    return { kind: "implicit", note: `No separate text: ${relation} any unit the unit-filter right after it names.` };
  }
  if (leaf.family_id === "unit-position" && leaf.parameters.objective === "selected" && leaf.parameters.selection_var === undefined) {
    return { kind: "implicit", note: "No separate text: within range of the objective marker this record's select-objective chose." };
  }
  if (leaf.family_id === "phase-window" && leaf.parameters.phase === "any" && (leaf.parameters.turn === undefined || leaf.parameters.turn === "either")) {
    return { kind: "implicit", note: "No separate text: in any phase, so the ability is not limited to a phase." };
  }
  if (leaf.family_id === "target-is-selected" && !namesSelection(leaf)) return { kind: "implicit", note: "No separate text: the effects it gates apply to attacks against the selected unit." };
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
  const triggers = triggerLeaves(leaf).map((each) => trigger(each));
  return { kind: "trigger", node: triggers.length === 1 ? triggers[0]! : triggers };
}
