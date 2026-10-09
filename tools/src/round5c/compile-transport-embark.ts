import { CompileError, type CompileLeaf } from "./compile-fragments.js";

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
