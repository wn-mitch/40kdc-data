import type { CompileLeaf } from "./compile-fragments.js";
import { ANTECEDENT } from "./antecedent-families.js";

/** The selections whose attacks an attacks-resolved moment can close. */
const ATTACKING_SELECTIONS = new Set(["shoot", "fight"]);
/** A selected moment carrying anything else (an owner, a move) is not a plain "selected to shoot/fight". */
const SELECTED_KEYS = new Set(["kind", "to", "subject"]);
/** An attacks-resolved moment of the selected unit: nothing else may narrow it. */
const RESOLVED_KEYS = new Set(["kind", "subject", "attack_type"]);

function isSelection(leaf: CompileLeaf | undefined): leaf is CompileLeaf {
  return leaf?.family_id === "event" && leaf.parameters.kind === "selected" && ATTACKING_SELECTIONS.has(String(leaf.parameters.to))
    && Object.keys(leaf.parameters).every((key) => SELECTED_KEYS.has(key));
}

function gap(sourceText: string, from: number | undefined, to: number): string | null {
  if (from === undefined || to < from) return null;
  return Buffer.from(sourceText, "utf8").subarray(from, to).toString("utf8");
}

/**
 * "When this model is selected to fight, after resolving its attacks": the selection opens the
 * attacks and the attacks-resolved moment closes them, so the two are one moment, when that unit's
 * fight (or shooting) attacks have been resolved. A trigger list would fire on either one.
 * Selections joined by "or" ("selected to shoot or fight") are alternatives, each closing at its
 * own attacks. The run must be followed by a bare comma and an attacks-resolved moment of the
 * selected unit (subject antecedent) in the same fragment; anything else is left alone.
 */
export function foldSelectedAttacks(list: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  if (sourceText === undefined) return [...list];
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const run: CompileLeaf[] = [];
    while (isSelection(list[index + run.length])) {
      const next = list[index + run.length]!;
      if (run.length > 0) {
        const between = gap(sourceText, run.at(-1)!.end_byte, next.start_byte);
        if (between === null || !/^\s*(?:,\s*)?or\s*$/iu.test(between) || next.fragment !== run[0]!.fragment) break;
      }
      run.push(next);
    }
    const resolved = list[index + run.length];
    const closes = run.length > 0 && resolved?.family_id === "event" && resolved.parameters.kind === "attacks-resolved"
      && resolved.parameters.subject === ANTECEDENT && Object.keys(resolved.parameters).every((key) => RESOLVED_KEYS.has(key))
      && resolved.fragment === run[0]!.fragment && /^\s*,\s*$/u.test(gap(sourceText, run.at(-1)!.end_byte, resolved.start_byte) ?? "")
      // An antecedent binds per leaf: a later alternative would bind to the first one's unit, so such a run is left alone.
      && !(run.length > 1 && run[0]!.parameters.subject === ANTECEDENT)
      // "this model is selected to shoot or fight": a later alternative with no subject of its own shares the first one's.
      && run.every((selection, position) => position === 0 ? true : selection.parameters.subject === undefined || selection.parameters.subject === run[0]!.parameters.subject);
    if (!closes) {
      // A run that does not close is kept whole: a fold starting at its second selection would split it.
      out.push(...(run.length > 0 ? run : [list[index]!]));
      index += Math.max(run.length - 1, 0);
      continue;
    }
    const { subject: _subject, ...rest } = resolved!.parameters;
    run.forEach((selection, position) => {
      const subject = run[0]!.parameters.subject;
      const last = position === run.length - 1;
      const connectives = [...(selection.connectives ?? []), ...(last ? resolved!.connectives ?? [] : [])];
      const { connectives: _own, ...base } = resolved!;
      out.push({
        ...base,
        ...(connectives.length ? { connectives } : {}),
        start_byte: selection.start_byte,
        end_byte: last ? resolved!.end_byte : selection.end_byte,
        parameters: { ...rest, action_kind: selection.parameters.to, ...(subject !== undefined ? { subject } : {}) },
      });
    });
    index += run.length;
  }
  return out;
}
