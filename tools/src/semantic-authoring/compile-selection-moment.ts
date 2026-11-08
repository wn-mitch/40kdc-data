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
  const own = selectedUnitMoments(sorted);
  sorted.forEach((selection, at) => {
    if (selection.family_id !== "select-unit") return;
    // Every moment after the selection, not only the first: "when that unit is selected to make an Advance move or when an
    // enemy unit ends a Normal move" holds the selected unit's own moment and another one beside it.
    for (const moment of sorted.slice(at + 1).filter(isMoment)) {
      if (own.has(sorted.indexOf(moment))) continue;
      const later = sorted.find((leaf) => leaf.start_byte > moment.start_byte && leaf.role !== "EVENT" && leaf.role !== "DURATION"
        && leaf.parameters.subject === "selected-unit" && leaf.start_byte >= (moment.end_byte ?? moment.start_byte));
      if (later === undefined) continue;
      const scoped = sorted.some((leaf) => leaf.family_id === "target-is-selected" && leaf.start_byte > selection.start_byte && leaf.start_byte < later.start_byte);
      if (scoped) continue;
      // A later selection before that leaf is the unit it names ("One eligible unit … that was hit"), not this one.
      if (sorted.some((leaf) => leaf.family_id === "select-unit" && leaf.start_byte > selection.start_byte && leaf.start_byte < later.start_byte)) continue;
      throw new CompileError(`A ${later.family_id} at byte ${later.start_byte} acts on the unit an earlier selection (byte ${selection.start_byte}) picked, but a later moment (byte ${moment.start_byte}) sits between them; the selection cannot carry its effect to that moment.`);
    }
  });
}

/**
 * "At the start of your Movement phase, select one friendly unit. If you do, when that unit is selected to make an
 * Advance move this turn, …": the selection is made at an earlier moment, and a later moment whose subject is the
 * unit it picked, with no effect between them, is that unit's own. "… select one enemy unit hit by those attacks.
 * Until the end of the turn, when this unit declares a charge, …": a later moment of any subject that a duration
 * printed after the selection opens is the selection's too; it exists only once the unit is picked. Their effects
 * wait for them inside the selection (compile-part-classify.ts nests each as a part), never beside the opening
 * moment as an alternative trigger. With no moment before the selection, the event is the ability's own trigger and
 * is not nested. Positions are in `list`'s order.
 */
export function selectedUnitMoments(list: readonly CompileLeaf[]): Set<number> {
  const nested = new Set<number>();
  let opened = false;
  let selected = false;
  let held = false;
  list.forEach((leaf, at) => {
    if (selected && leaf.family_id === "event" && (held || leaf.parameters.subject === "selected-unit")) nested.add(at);
    if (leaf.family_id === "select-unit") {
      selected = opened;
      held = false;
    } else if (leaf.role === "EFFECT") selected = false;
    else if (leaf.role === "DURATION") held = true;
    if (isMoment(leaf) || leaf.family_id === "phase-window") opened = true;
  });
  return nested;
}
