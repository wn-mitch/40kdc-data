/**
 * A datasheet's Damaged block read as the core rule it restates.
 *
 * The core rules define Damaged X: while a model has X or fewer wounds remaining it is damaged, and a
 * damaged model's attacks subtract 1 from their Hit rolls. A 963 codex datasheet just names the
 * rule (`damagedAt`, no text); older datasheets print the bracket out ("1-X wounds remaining")
 * with that same penalty, and many add an Objective Control penalty on top. So a block is:
 *
 *   - `core`: exactly core Damaged X;
 *   - `core+oc`: core Damaged X, plus subtracting `oc` from the model's Objective Control while it
 *     is damaged;
 *   - `other`: anything else (a halved Attacks characteristic, a weapon limit): a rule of its own.
 *
 * The block is recognised by its clauses, not by quoting it: the bracket, a Hit-roll penalty of 1,
 * an optional Objective Control penalty, and nothing left over once those clauses are removed.
 */

export type DamagedReading =
  | { kind: "core"; threshold: number }
  | { kind: "core+oc"; threshold: number; oc: number }
  | { kind: "other" };

/** Lower-case, tags stripped, dashes and apostrophes unified, whitespace collapsed. */
function plain(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const BRACKET = /\b1-(\d+) wounds remaining/;
const HIT = /subtract (\d+) from the hit roll/;
const OC = /subtract (\d+) from (?:this model'?s|its) objective control characteristic/;
// Clauses a core-shaped block is made of; whatever is left over makes the block its own rule.
const CLAUSES = [
  /while this model has 1-\d+ wounds remaining,?/g,
  /each time (?:this model|it) makes an attack,?/g,
  /subtract \d+ from the hit roll\.?/g,
  /subtract \d+ from (?:this model'?s|its) objective control characteristic\.?/g,
  /\band\b/g,
];

export function readDamaged(name: string | null | undefined, rules: string | null | undefined, damagedAt: number | null | undefined): DamagedReading {
  const text = plain(rules);
  if (damagedAt != null && !text) return { kind: "core", threshold: damagedAt };
  const bracket = BRACKET.exec(text) ?? BRACKET.exec(plain(name));
  const hit = HIT.exec(text);
  if (!bracket || !hit || hit[1] !== "1") return { kind: "other" };
  let rest = text;
  for (const clause of CLAUSES) rest = rest.replace(clause, " ");
  if (rest.replace(/[\s,.]+/g, "")) return { kind: "other" };
  const threshold = Number(bracket[1]);
  const oc = OC.exec(text);
  return oc ? { kind: "core+oc", threshold, oc: Number(oc[1]) } : { kind: "core", threshold };
}
