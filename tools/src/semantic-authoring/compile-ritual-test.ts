import { exactSpan } from "./contracts.js";
import type { CompileLeaf } from "./compile-fragments.js";

/** The event variable a folded Ritual test binds, which its same-Ritual condition reads (compile-triggers.ts). */
const RITUAL_TEST = "ritual-test";

/**
 * "Each time the bearer attempts a Ritual, just before determining the Psychic test result": the
 * attempt and the test are one moment, the Psychic test of that Ritual. Two moments in a row would
 * be a trigger list, which fires on either. The attempt (event used, activity ritual) folds into the
 * Psychic-test moment after it as `before_resolving_activity` ritual, with the test bound
 * (`bind_as`) so the trigger's condition can name the same Ritual.
 *
 * Folds only an attempt with no other qualifier, followed in its fragment by a before-roll or
 * after-roll psychic moment with only a comma between, that is not already bound or qualified.
 */
export function foldRitualTest(list: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  if (sourceText === undefined) return [...list];
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const attempt = list[index]!;
    const test = list[index + 1];
    const folds = isRitualAttempt(attempt) && test !== undefined && isPsychicTest(test) && attempt.fragment === test.fragment
      && attempt.end_byte !== undefined && attempt.end_byte <= test.start_byte && /^\s*,\s*$/u.test(exactSpan(sourceText, attempt.end_byte, test.start_byte));
    if (!folds) {
      out.push(attempt);
      continue;
    }
    out.push({ ...test, start_byte: attempt.start_byte, parameters: { ...test.parameters, before_resolving_activity: "ritual", bind_as: RITUAL_TEST } });
    index += 1;
  }
  return out;
}

function isRitualAttempt(leaf: CompileLeaf): boolean {
  const p = leaf.parameters;
  return leaf.family_id === "event" && p.kind === "used" && p.activity === "ritual" && Object.keys(p).every((key) => key === "kind" || key === "activity");
}

function isPsychicTest(leaf: CompileLeaf): boolean {
  const p = leaf.parameters;
  return leaf.family_id === "event" && (p.kind === "before-roll" || p.kind === "after-roll") && p.roll === "psychic"
    && p.before_resolving_activity === undefined && p.bind_as === undefined && p.binds_event_variable === undefined;
}
