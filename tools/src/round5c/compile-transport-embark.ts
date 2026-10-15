import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { targetGroupOf, targetHeads } from "./compile-target-groups.js";
import { isOneTargetRef } from "./compile-target-refs.js";

/** The families a Stratagem's target leaves use (compile-antecedent.ts STRATAGEM_TARGETS). */
const STRATAGEM_TARGET_FAMILIES = new Set(["stratagem-target", "triggering-target", "target-binding"]);

/**
 * A record that names a Transport the subject is able to embark within (`eligible` with
 * to: embark-within) and also embarks a unit (an eligibility-permission for embark without `into`, or
 * a make-move for embark) would lower the embark with no destination: "can embark" without saying
 * into which Transport. An eligibility-permission with `into` names its destination, so it passes
 * (refuseDestinationMismatch checks that the destination is the one the eligibility names).
 */
export function refuseEmbarkDestination(list: readonly CompileLeaf[]): void {
  if (!list.some((leaf) => leaf.family_id === "eligible" && leaf.parameters.to === "embark-within")) return;
  const embark = list.find((leaf) => (leaf.family_id === "eligibility-permission" && leaf.parameters.activity === "embark" && leaf.parameters.into === undefined)
    || (leaf.family_id === "make-move" && leaf.parameters.move_type === "embark"));
  if (embark) {
    throw new CompileError(`The embark at byte ${embark.start_byte} follows a Transport the subject is able to embark within, but the DSL has no destination for an embark yet.`);
  }
}

/**
 * An `eligible` embark-within whose subject binds to the Transport itself, and a proximity that
 * measures to the unit it constrains. A Stratagem with one
 * target binds an antecedent to that target (`this-unit`), and a unit-filter right before the leaf
 * binds it to the filter's units (`filtered-units`); both are the Transport the record names, not
 * the unit that embarks. A subject that is the Transport's own unit cannot be "able to embark
 * within" that Transport, so the record refuses.
 */
export function refuseTransportAsSubject(list: readonly CompileLeaf[]): void {
  const severalTargets = list.filter((leaf) => STRATAGEM_TARGET_FAMILIES.has(leaf.family_id)).length >= 2;
  for (const leaf of list) {
    // With several Stratagem targets, a proximity whose anchor binds to the unit it measures (a
    // "within 6\" of" a later target binds to the first one, which is not that target) cannot say
    // which unit it means.
    if (severalTargets && leaf.family_id === "unit-position" && leaf.parameters.kind === "within" && leaf.parameters.of === leaf.parameters.subject) {
      throw new CompileError(`The proximity at byte ${leaf.start_byte} measures a unit to itself; its anchor has no other unit to mean.`);
    }
    if (leaf.family_id !== "eligible" || leaf.parameters.to !== "embark-within") continue;
    const subject = leaf.parameters.subject;
    if (subject === leaf.parameters.transport || subject === "filtered-units") {
      throw new CompileError(`The eligibility at byte ${leaf.start_byte} names the Transport as the unit able to embark within itself; the subject has no earlier unit to mean.`);
    }
  }
}

/**
 * An embark permission's destination (`into`) must be the Transport its embark-within eligibility
 * names, once both are bound. Checked on the bound leaves (compile.ts, after the antecedents):
 * - a subject and a destination that are the same unit refuse: the unit would embark within itself;
 * - `into: this-unit` pairs with `transport: ability-unit`;
 * - `into` a Stratagem target pairs with a `transport: this-unit` eligibility in that target's group.
 * The pairing is checked only when the record has an embark-within eligibility; a permission with no
 * eligibility names its destination alone.
 */
export function refuseDestinationMismatch(list: readonly CompileLeaf[], sourceText?: string): void {
  const eligible = list.flatMap((leaf, index) => leaf.family_id === "eligible" && leaf.parameters.to === "embark-within" ? [{ leaf, index }] : []);
  for (const permission of list) {
    const into = permission.parameters.into;
    if (permission.family_id !== "eligibility-permission" || permission.parameters.activity !== "embark" || into === undefined) continue;
    if (typeof into === "string" && into === permission.parameters.subject) {
      throw new CompileError(`The embark destination is the embarking unit itself, at byte ${permission.start_byte}.`);
    }
    if (eligible.length === 0) continue;
    if (into === "this-unit") {
      if (!eligible.some(({ leaf }) => leaf.parameters.transport === "ability-unit")) {
        throw new CompileError(`The embark at byte ${permission.start_byte} lets a unit embark within this unit, but no eligibility names this unit as its Transport.`);
      }
      continue;
    }
    if (isOneTargetRef(into)) {
      const name = into.slice("stratagem-target:".length);
      const group = targetGroupIndex(list, name);
      const named = eligible.some(({ leaf, index }) => leaf.parameters.transport === "this-unit" && targetGroupOf(list, index, sourceText).group === group);
      if (group === -1 || !named) {
        throw new CompileError(`The embark at byte ${permission.start_byte} lets a unit embark within target ${name}, but the eligibility names a different Transport.`);
      }
    }
  }
}

/** The index of the Stratagem target group whose first name is `name`, or -1. */
function targetGroupIndex(list: readonly CompileLeaf[], name: string): number {
  return targetHeads(list).findIndex((head) => head.names.includes(name));
}
