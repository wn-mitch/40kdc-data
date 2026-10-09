import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * A unit a selection picked, and an effect that names it, with a moment between them.
 *
 * "When a friendly model is destroyed, select one of those models. When that selected model
 * attempts a Ritual, it has +1 to the test": the selection happens at the destruction, and the
 * effect at the later Ritual. The compiler attaches an effect to the moment the selection sits
 * under, so such a leaf set would apply the effect at the destruction. Refuse it rather than
 * place the effect on the wrong moment.
 *
 * A moment is an `event` leaf after the selection, or an `attack` by some other unit. An attack by
 * the selected unit ("each time a model in that unit makes an attack") or one a target-is-selected
 * condition follows is the designation's own duration, not a new moment, so it does not refuse.
 * Other EVENT-role leaves (a roll, a selection) are not moments.
 */
const isMoment = (leaf: CompileLeaf) => leaf.family_id === "event" || (leaf.family_id === "attack" && leaf.parameters.unit !== "that-unit");

export function refuseSelectionAcrossMoment(list: readonly CompileLeaf[]): void {
  const sorted = [...list].sort((a, b) => a.start_byte - b.start_byte);
  sorted.forEach((selection, at) => {
    if (selection.family_id !== "select-unit") return;
    const moment = sorted.slice(at + 1).find(isMoment);
    if (moment === undefined) return;
    const later = sorted.find((leaf) => leaf.start_byte > moment.start_byte && leaf.role !== "EVENT" && leaf.role !== "DURATION"
      && leaf.parameters.subject === "selected-unit" && leaf.start_byte >= moment.end_byte);
    if (later === undefined) return;
    const scoped = sorted.some((leaf) => leaf.family_id === "target-is-selected" && leaf.start_byte > selection.start_byte && leaf.start_byte < later.start_byte);
    if (scoped) return;
    throw new CompileError(`A ${later.family_id} at byte ${later.start_byte} acts on the unit an earlier selection (byte ${selection.start_byte}) picked, but a later moment (byte ${moment.start_byte}) sits between them; the selection cannot carry its effect to that moment.`);
  });
}
