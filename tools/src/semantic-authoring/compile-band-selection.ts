import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { isRollMarker } from "./compile-dice.js";
import { selectUnit } from "./compile-wrappers.js";
import type { PlannedEffect } from "./compile-part-plan.js";

type Node = Record<string, unknown>;

/** The band an effect is gated by, as its marker's JSON (one band's markers are equal, not the same object), or undefined when it is in no band. */
const markerOf = (item: PlannedEffect): string | undefined => {
  const marker = item.gate.find(isRollMarker);
  return marker === undefined ? undefined : JSON.stringify(marker);
};

/** Whether an effect names the selected unit. */
const namesSelected = (item: PlannedEffect) => JSON.stringify(item.node).includes("\"selected-unit\"");

/** "each time an attack targets that enemy unit, …": an effect on attacks against the selected unit, as compile-part-plan.ts gates it. */
function onAttacksAgainstSelected(node: Node): Node | null {
  const condition = node.condition as Node | undefined;
  const parameters = condition?.parameters as Node | undefined;
  return node.type === "conditional" && condition?.type === "same-unit" && parameters?.subject === "defender" && parameters.as === "selected-unit"
    ? node.effect as Node : null;
}

/**
 * A selection whose unit only one result band uses is made on that outcome only:
 * - "2-3: Select one other enemy unit within 3\" of the target. That unit suffers D3 mortal wounds": a
 *   selection printed inside a band selects for that band's effects after it;
 * - "select one enemy unit … and roll one D6: on a 1, …; on a 2+, … each time an attack targets that
 *   enemy unit, …": a selection printed before the roll, whose unit only one band's effects name, moves
 *   into that band (on the other outcomes the selected unit takes no effect, so selecting it there is
 *   the same choice). When every effect of that band is on attacks against the selected unit, the band
 *   is the designation `designate` builds from them.
 * The band's effects fold into one effect that keeps the band's gate, so the roll resolves it as that
 * outcome. Returns the planned effects with the band folded, or null when the selection is not in one
 * band (it then wraps the part as usual). Refuses an effect on the selected unit outside that band.
 */
export function foldBandSelection(planned: readonly PlannedEffect[], selection: CompileLeaf, list: readonly CompileLeaf[], rolls: readonly CompileLeaf[],
  eligibility: Node | null, designate: (body: Node) => Node): PlannedEffect[] | null {
  if (rolls.length === 0) return null;
  const at = list.indexOf(selection);
  const beforeRoll = rolls.every((roll) => list.indexOf(roll) > at);
  let band: string | undefined;
  if (beforeRoll) {
    // A roll with one band ("for each 4+, that unit suffers …") resolves for the selected unit: the selection wraps it as usual.
    const bands = new Set(planned.flatMap((item) => markerOf(item) ?? []));
    if (bands.size < 2) return null;
    const naming = planned.filter(namesSelected);
    const named = new Set(naming.map(markerOf));
    if (naming.length === 0 || named.size !== 1) return null;
    band = [...named][0];
  } else {
    const first = planned.find((item) => item.index > at);
    band = first === undefined ? undefined : markerOf(first);
  }
  if (band === undefined) return null;
  const inBand = planned.filter((item) => (beforeRoll || item.index > at) && markerOf(item) === band);
  if (planned.some((item) => namesSelected(item) && !inBand.includes(item))) {
    throw new CompileError("A selection inside one result band is named by an effect outside that band.");
  }
  if (new Set(inBand.map((item) => JSON.stringify(item.gate))).size > 1) throw new CompileError("The effects of a selection inside one result band carry different gates.");
  const attacks = inBand.map((item) => onAttacksAgainstSelected(item.node));
  const steps = attacks.every((node) => node !== null) ? attacks as Node[] : inBand.map((item) => item.node);
  const body = steps.length === 1 ? steps[0]! : { type: "sequence", steps };
  const node = attacks.every((node) => node !== null) ? designate(body) : selectUnit(selection, body, { eligibility });
  const folded: PlannedEffect = { ...inBand[0]!, node };
  return planned.flatMap((item) => item === inBand[0] ? [folded] : inBand.includes(item) ? [] : [item]);
}
