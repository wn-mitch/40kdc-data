import { exactSpan } from "./contracts.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { wrapForEachUnit } from "./compile-wrappers.js";

type Node = Record<string, unknown>;

/**
 * "Roll one D6. On a 6, …; each unit within 6\" of that model suffers …": a loop printed after a
 * roll's band runs inside that band's outcome, once the one roll has come up, not around the roll
 * (which would roll once per unit, as "roll one D6 for each unit" does).
 *
 * Whether `loop` is such a loop: a result band comes before it in its fragment, with no full stop
 * between them. wrapBandLoop refuses such a loop when the roll has more than that one band.
 */
export function loopUnderBand(list: readonly CompileLeaf[], loop: CompileLeaf, sourceText: string | undefined): boolean {
  if (sourceText === undefined || loop.start_byte === undefined) return false;
  const at = list.indexOf(loop);
  const bandAt = list.slice(0, at).map((leaf) => leaf.family_id === "roll-result" && leaf.fragment === loop.fragment).lastIndexOf(true);
  const band = list[bandAt];
  if (band?.end_byte === undefined || band.end_byte > loop.start_byte) return false;
  return !/[.!?](?:\s|$)/u.test(exactSpan(sourceText, band.end_byte, loop.start_byte));
}

/** Whether a condition reads the loop's unit (the pass's recipient). */
const readsPass = (node: unknown): boolean => JSON.stringify(node ?? null).includes("\"recipient\"");

/**
 * The loop around the band's outcome, with the gates on the loop's unit ("within 6\" of that model")
 * moved in with it: they test each pass's unit, not the roll. Refuses a roll that compiled to
 * anything but one band with no other outcome, or a gate on anything but the loop's unit.
 */
export function wrapBandLoop(loop: CompileLeaf, body: Node): Node {
  const gates: Node[] = [];
  let roll = body;
  while (roll.type === "conditional" && readsPass(roll.condition)) {
    gates.push(roll.condition as Node);
    roll = roll.effect as Node;
  }
  if (roll.type !== "dice-gated" || roll.on_fail != null || roll.on_success == null) {
    throw new CompileError("A loop printed after a roll's band runs inside that band's outcome; this roll has no single band to hold it.");
  }
  const pass = gates.reduceRight((inner: Node, gate) => ({ type: "conditional", condition: gate, effect: inner }), roll.on_success as Node);
  return { ...roll, on_success: wrapForEachUnit(loop, pass) };
}
