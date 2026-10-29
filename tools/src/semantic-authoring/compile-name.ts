import type { Compiled, CompileOptions } from "./compile.js";
import type { CompileLeaf } from "./compile-fragments.js";
import { joinSegments } from "./compile-segments.js";
import { exactSpan, NAME_FRAGMENT } from "./contracts.js";
import { usageFor } from "./restriction-families.js";
import { hashJson } from "../round4/hash.js";

/**
 * Leaves over the record's name. A workbench span with fragment `NAME` indexes the name column,
 * not `source_text`: unit records print their psyker level in the name ("Chief Librarian (psyker
 * level 3)"). Such a leaf compiles against the name alone, as its own part; the body leaves compile
 * against `source_text` as they would without it. A name leaf never resolves against source_text.
 * A use limit printed in the name ("Master of Ka'tahs (Once per battle round, per unit)") limits
 * the whole rule, so it becomes the record's own use limit rather than a part.
 */

export { NAME_FRAGMENT };

type Compile = (leaves: CompileLeaf[], sourceText?: string, options?: CompileOptions) => Compiled;

const isName = (leaf: CompileLeaf) => leaf.fragment === NAME_FRAGMENT;

/**
 * Compile a record that has NAME leaves: the name part and the body (every other leaf) join as
 * parts of one ability. `compile` is compileLeaves; `signatureOf` is the record's shape signature.
 * Refused: a NAME leaf without the record's name, a NAME span outside the name's bytes, and a NAME
 * leaf whose stored wording no longer sits at its offsets in the current name. A record's source hash
 * covers source_text only, so a name edit leaves NAME rows in place; this check is what catches them.
 */
export function compileWithName(
  leaves: readonly CompileLeaf[],
  sourceText: string | undefined,
  options: CompileOptions,
  compile: Compile,
  signatureOf: (leaves: readonly CompileLeaf[]) => string,
): Compiled {
  const named = leaves.filter(isName);
  const body = leaves.filter((leaf) => !isName(leaf));
  // Placement reads source_text, so only body leaves are placed against it; a NAME leaf's offsets index the name.
  const signature = signatureOf(body);
  const fail = (message: string): Compiled => ({ ok: false, signature, errors: [message] });
  if (options.name === undefined) return fail("A span over the record's name needs the record's name.");
  const nameBytes = Buffer.byteLength(options.name, "utf8");
  for (const leaf of named) {
    const end = leaf.end_byte ?? leaf.start_byte;
    if (leaf.start_byte < 0 || end <= leaf.start_byte || end > nameBytes) return fail("A name span lies outside the record's name.");
    if (leaf.exact_text !== undefined && exactSpan(options.name, leaf.start_byte, end) !== leaf.exact_text) {
      return fail("A name span no longer matches the record's name; re-review the name's wording.");
    }
  }
  if (named.every((leaf) => leaf.family_id === "usage-limit")) {
    if (named.length > 1) return fail("A record's name prints more than one use limit.");
    if (body.length === 0) return fail("A use limit in the record's name needs the rule it limits.");
    const bodyResult = compile(body, sourceText, options);
    if (!bodyResult.ok) return { ok: false, signature, errors: bodyResult.errors };
    const usage = usageFor(named[0]!.parameters);
    const printed = bodyResult.mechanics.usage;
    // The rule's own text may repeat the limit; a different one would be two limits for one use.
    if (printed != null && hashJson(printed) !== hashJson(usage)) return fail("The record's name and its rule print different use limits.");
    return { ...bodyResult, signature: `${signature} NAME RESTRICTION(usage-limit)`, mechanics: { ...bodyResult.mechanics, usage } };
  }
  // The name leaves compile as ordinary leaves over the name text; the fragment tag and the stored
  // wording are only locators for the check above.
  const nameLeaves = named.map(({ fragment: _fragment, exact_text: _exact, ...rest }) => rest as CompileLeaf);
  const nameResult = compile(nameLeaves, options.name, options);
  if (!nameResult.ok) return { ok: false, signature, errors: nameResult.errors };
  if (body.length === 0) return nameResult;
  const bodyResult = compile(body, sourceText, options);
  if (!bodyResult.ok) return { ok: false, signature, errors: bodyResult.errors };
  const joined = joinSegments([nameResult, bodyResult]);
  if (joined.errors.length) return fail(joined.errors.join(" "));
  return { ok: true, signature: `${signature} NAME ${nameResult.signature}`, mechanics: joined.mechanics, checks: joined.checks, ...(joined.core ? { core: joined.core } : {}) };
}
