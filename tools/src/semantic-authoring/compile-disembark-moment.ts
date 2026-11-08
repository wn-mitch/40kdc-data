import { CompileError } from "./compile-error.js";
import type { CompileLeaf } from "./compile-fragments.js";
import { DISEMBARKED_FROM } from "./families/positions.js";

const isDisembarked = (leaf: CompileLeaf | undefined): leaf is CompileLeaf => leaf?.family_id === "event" && leaf.parameters.kind === "disembarked";

/** Only a comma or spaces between two leaves of one fragment. */
function adjacent(before: CompileLeaf, after: CompileLeaf, bytes: Buffer): boolean {
  return before.fragment === after.fragment && before.end_byte !== undefined
    && /^[\s,*]*$/u.test(bytes.subarray(before.end_byte, after.start_byte).toString("utf8"));
}

/** "after that unit has been set up": the disembarking unit's own set-up, and nothing else named. */
function isOwnSetUp(leaf: CompileLeaf): boolean {
  return leaf.family_id === "event" && leaf.parameters.kind === "set-up" && leaf.parameters.subject === "antecedent"
    && Object.keys(leaf.parameters).every((key) => key === "kind" || key === "subject");
}

/**
 * "Each time a friendly unit disembarks from a TRANSPORT that is within 6" of this model, after that
 * unit has been set up, …": both clauses say which disembarkation, not further moments. A
 * unit-position of subject disembarked-from right after a disembarked moment is the Transport's
 * position, folded onto the moment as `transport_filter` (the trigger's filter.transport); the
 * disembarking unit's own set-up moment right after it is when the moment resolves, `timing:
 * after-set-up`. Each must follow the moment with only a comma or spaces between.
 */
export function foldDisembarkMoment(leaves: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (sourceText === undefined) return [...leaves];
  const bytes = Buffer.from(sourceText, "utf8");
  const out: CompileLeaf[] = [];
  for (const leaf of leaves) {
    const before = out.at(-1);
    if (leaf.family_id === "unit-position" && leaf.parameters.subject === DISEMBARKED_FROM) {
      if (!isDisembarked(before) || !adjacent(before, leaf, bytes) || before.parameters.transport_filter !== undefined) {
        throw new CompileError("A disembarked-from position must follow its disembarked moment directly.");
      }
      if (leaf.parameters.kind !== "within") throw new CompileError("A disembarked-from position is a within distance; a Transport beyond a distance has no filter yet.");
      const filter = { within: { of: leaf.parameters.of, range: { inches: leaf.parameters.inches } } };
      out[out.length - 1] = { ...before, end_byte: leaf.end_byte ?? before.end_byte, parameters: { ...before.parameters, transport_filter: filter } };
      continue;
    }
    if (isDisembarked(before) && isOwnSetUp(leaf) && before.parameters.timing === undefined && adjacent(before, leaf, bytes)) {
      out[out.length - 1] = { ...before, end_byte: leaf.end_byte ?? before.end_byte, parameters: { ...before.parameters, timing: "after-set-up" } };
      continue;
    }
    out.push(leaf);
  }
  return out;
}
