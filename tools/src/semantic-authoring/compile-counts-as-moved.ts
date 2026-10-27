import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * A counts-as-moved leaf (a status that makes units count as having made a move) folds into the
 * nearest disembark permission before it in its fragment, as the DSL permission's `counts_as_move`
 * (and `counts_as_until: end-of-phase` for "that phase"). Every other shape refuses. A DSL gap is
 * reported before the structural check, so a row with a known gap names the gap.
 *
 * Whose status it is decides the rest. With `units: permission-subject` the permission's own
 * subject disembarks ("the bearer's unit can disembark … if it does, it counts as having made a
 * Normal move"), so the status and a charge refusal in its sentence bind to that subject: the
 * refusal folds in as `then_cannot` (with any end-of-turn duration after it in that sentence, which
 * names the same turn), and at most one `move-ended` event may lie between the permission and the
 * counts-as leaf. Without it, the units a Transport carries count as moved; the
 * DSL has no target for them (the permission's subject is the Transport), so a this-unit or
 * this-model permission and a charge refusal in the sentence refuse with a DSL_GAP, and exactly one
 * `move-ended` event must lie between.
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

/** The identity compile-connective-plan.ts keys a leaf by. */
const keyOf = (leaf: CompileLeaf) => ({ fragment: leaf.fragment ?? "RAW_TEXT", start_byte: leaf.start_byte, end_byte: leaf.end_byte ?? leaf.start_byte, family_id: leaf.family_id });

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
    const own = leaf.parameters.units === "permission-subject";
    const sentence = sentenceBounds(sourceText, leaf.start_byte, leaf.end_byte ?? leaf.start_byte);
    const refusals = list.map((other, position) => ({ other, position })).filter(({ other }) => other.family_id === "eligibility-permission"
      && (other.fragment ?? null) === fragment && other.parameters.activity === "declare-charge" && other.parameters.allow === false
      && other.start_byte >= sentence.from && other.start_byte < sentence.to);
    // 6-7. Gaps: each one is collected so a record reports every reason it cannot compile. They
    // are checked before the structural check in step 5, so a row with a known gap reports the gap.
    const gaps: string[] = [];
    if (!own && PERMISSION_SELF_SUBJECTS.has(String(permission.parameters.subject))) gaps.push("the disembarking units are not the permission's target; the DSL cannot name them, and the permission names this-unit");
    if (!own && refusals.length > 0) gaps.push("the charge refusal in this sentence binds the disembarking units, not the permission's target");
    if (gaps.length > 0) throw new CompileError(`DSL_GAP: "${wording}": ${gaps.join("; ")}.`);
    // 8. A refusal folded into the permission must refuse the permission's own subject.
    for (const { other } of refusals) {
      if (other.parameters.subject !== permission.parameters.subject) {
        throw new CompileError(`"${wordingOf(other, bytes)}" refuses ${String(other.parameters.subject)}, but the units that count as having moved are the permission's subject, ${String(permission.parameters.subject)}.`);
      }
      if (other.parameters.counts_as_move !== undefined || Object.keys(other.parameters).some((key) => !["subject", "activity", "allow"].includes(key))) {
        throw new CompileError(`"${wordingOf(other, bytes)}" carries more than a plain refusal; only a plain charge refusal folds into the permission it follows.`);
      }
    }
    // 5. Between the permission and the counts-as leaf: one move-ended event, or (for the
    // permission's own subject) nothing.
    const between = list.slice(at + 1, index);
    const structural = own ? between.length === 0 || (between.length === 1 && isMoveEnded(between[0])) : between.length === 1 && isMoveEnded(between[0]);
    if (!structural) {
      throw new CompileError(`"${wording}" counts as a move, but leaves other than ${own ? "at most " : ""}one move-ended event lie between it and its permission.`);
    }
    list[at] = {
      ...permission,
      ...(refusals.length > 0 ? { absorbs: [...(permission.absorbs ?? []), ...refusals.map(({ other }) => keyOf(other))] } : {}),
      parameters: {
        ...permission.parameters,
        counts_as_move: leaf.parameters.move_type,
        ...(leaf.parameters.window === "phase" ? { counts_as_until: "end-of-phase" } : {}),
        ...(refusals.length > 0 ? { then_cannot: ["declare-charge"] } : {}),
      },
    };
    drop.add(index);
    for (const { position } of refusals) drop.add(position);
    // "cannot declare a charge in the same turn, but can otherwise act normally in the remainder of
    // the turn": with a folded refusal, an end-of-turn duration after it in its sentence names the
    // turn then_cannot already holds for, not a duration of the whole rule.
    if (refusals.length > 0) {
      const last = Math.max(...refusals.map(({ other }) => other.start_byte));
      list.forEach((other, position) => {
        if (other.family_id === "duration" && other.parameters.endpoint === "end-of-turn" && (other.fragment ?? null) === fragment
          && other.start_byte > last && other.start_byte < sentence.to) drop.add(position);
      });
    }
  });
  return list.filter((_, index) => !drop.has(index));
}
