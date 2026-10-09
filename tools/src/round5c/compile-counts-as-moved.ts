import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * A counts-as-moved leaf ("Units that do so count as having made a Normal move this turn") folds
 * into the nearest disembark permission before it in its fragment, as the DSL permission's
 * `counts_as_move`. Between the two, only one `move-ended` event may lie (the "after it has
 * disembarked" moment). Every other shape refuses.
 *
 * The permission's target must name the units that disembark. The DSL has no such target for a
 * permission: the eligibility-permission subjects are this-unit and this-model, and a disembark
 * permission's subject is the Transport. Those shapes refuse with a DSL_GAP; the fold runs only
 * for a permission whose subject is some other named target.
 */

const ENDS_SENTENCE = /[.!?](?=\s|$)/gu;
const PERMISSION_SELF_SUBJECTS = new Set(["this-unit", "this-model"]);

const wordingOf = (leaf: CompileLeaf, bytes: Buffer) => bytes.subarray(leaf.start_byte, leaf.end_byte).toString("utf8");

/** Byte offsets of the sentence that holds [start, end): from the boundary before it to the one after. */
function sentenceBounds(sourceText: string, start: number, end: number): { from: number; to: number } {
  let from = 0;
  let to = Buffer.byteLength(sourceText, "utf8");
  for (const match of sourceText.matchAll(ENDS_SENTENCE)) {
    const at = Buffer.byteLength(sourceText.slice(0, match.index! + 1), "utf8");
    if (at <= start) from = at;
    else if (at >= end) { to = at; break; }
  }
  return { from, to };
}

const isMoveEnded = (leaf: CompileLeaf | undefined) => leaf?.family_id === "event" && leaf.parameters.kind === "move-ended";

/** Folds each counts-as-moved leaf into its disembark permission; throws on any refused shape. */
export function foldCountsAsMoved(leaves: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  if (!leaves.some((leaf) => leaf.family_id === "counts-as-moved")) return [...leaves];
  if (sourceText === undefined) throw new CompileError("counts-as-moved needs the source text to find the sentence its permission is in.");
  const bytes = Buffer.from(sourceText, "utf8");
  const list = [...leaves];
  const drop = new Set<number>();
  list.forEach((leaf, index) => {
    if (leaf.family_id !== "counts-as-moved") return;
    const wording = wordingOf(leaf, bytes);
    const fragment = leaf.fragment ?? null;
    // 1. The nearest permission before it in the same fragment.
    let at = -1;
    for (let position = index - 1; position >= 0; position--) {
      const other = list[position]!;
      if (other.family_id === "eligibility-permission" && (other.fragment ?? null) === fragment) { at = position; break; }
    }
    if (at < 0) throw new CompileError(`"${wording}" counts as a move, but no permission before it in its fragment allows the activity.`);
    const permission = list[at]!;
    const activity = permission.parameters.activity;
    // 2. Only a disembark permission is evidenced as counting as a move.
    if (activity !== "disembark") throw new CompileError(`DSL_GAP: counts-as-moved folds only into a disembark permission; the permission allows ${String(activity)}.`);
    // 3. A forbidding permission has nothing to count as moved.
    if (permission.parameters.allow === false) throw new CompileError(`"${wording}" counts as a move, but its permission forbids the activity.`);
    // 4. One counts_as_move per permission.
    if (permission.parameters.counts_as_move !== undefined) throw new CompileError(`Conflicting counts-as: the permission already counts as ${String(permission.parameters.counts_as_move)}; "${wording}" says otherwise.`);
    // 5. Only one move-ended event may lie between the permission and the counts-as leaf.
    const between = list.slice(at + 1, index);
    if (between.length !== 1 || !isMoveEnded(between[0])) {
      throw new CompileError(`"${wording}" counts as a move, but leaves other than one move-ended event lie between it and its permission.`);
    }
    // 6-8. Gaps: each one is collected so a record reports every reason it cannot compile.
    const gaps: string[] = [];
    if (leaf.parameters.window === "phase") gaps.push("counts_as_until: the status lapses at the end of that phase; the DSL has no counts_as_until");
    if (PERMISSION_SELF_SUBJECTS.has(String(permission.parameters.subject))) gaps.push("the disembarking units are not the permission's target; the DSL cannot name them, and the permission names this-unit");
    const sentence = sentenceBounds(sourceText, leaf.start_byte, leaf.end_byte ?? leaf.start_byte);
    const chargeRefusal = list.some((other) => other.family_id === "eligibility-permission" && (other.fragment ?? null) === fragment
      && other.parameters.activity === "declare-charge" && other.parameters.allow === false
      && other.start_byte >= sentence.from && other.start_byte < sentence.to);
    if (chargeRefusal) gaps.push("the charge refusal in this sentence binds the disembarking units, not the permission's target");
    if (gaps.length > 0) throw new CompileError(`DSL_GAP: "${wording}": ${gaps.join("; ")}.`);
    list[at] = { ...permission, parameters: { ...permission.parameters, counts_as_move: leaf.parameters.move_type } };
    drop.add(index);
  });
  return list.filter((_, index) => !drop.has(index));
}
