import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/** The families a Stratagem's target leaves use (compile-antecedent.ts STRATAGEM_TARGETS). */
const STRATAGEM_TARGET_FAMILIES = new Set(["stratagem-target", "triggering-target", "target-binding"]);

/**
 * A record that names a Transport the subject is able to embark within (`eligible` with
 * to: embark-within) and also embarks a unit (an eligibility-permission or make-move for embark)
 * would lower the embark with no destination: "can embark" without saying into which Transport.
 * The DSL has no destination for the embark yet, so the record refuses instead.
 */
export function refuseEmbarkDestination(list: readonly CompileLeaf[]): void {
  if (!list.some((leaf) => leaf.family_id === "eligible" && leaf.parameters.to === "embark-within")) return;
  const embark = list.find((leaf) => (leaf.family_id === "eligibility-permission" && leaf.parameters.activity === "embark")
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
