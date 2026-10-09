import type { Compiled, CompileOptions } from "./compile.js";
import type { CompileLeaf } from "./compile-fragments.js";
import { joinSegments } from "./compile-segments.js";

/**
 * Leaves over the record's name. A workbench span with fragment `NAME` indexes the name column,
 * not `source_text`: unit records print their psyker level in the name ("Chief Librarian (psyker
 * level 3)"). Such a leaf compiles against the name alone, as its own part; the body leaves compile
 * against `source_text` as they would without it. A name leaf never resolves against source_text.
 */

export const NAME_FRAGMENT = "NAME";

type Compile = (leaves: CompileLeaf[], sourceText?: string, options?: CompileOptions) => Compiled;

const isName = (leaf: CompileLeaf) => leaf.fragment === NAME_FRAGMENT;

/**
 * Compile a record that has NAME leaves: the name part and the body (every other leaf) join as
 * parts of one ability. `compile` is compileLeaves; `signatureOf` is the record's shape signature.
 * Refused: a NAME leaf without the record's name, and a NAME span outside the name's bytes.
 */
export function compileWithName(
  leaves: readonly CompileLeaf[],
  sourceText: string | undefined,
  options: CompileOptions,
  compile: Compile,
  signatureOf: (leaves: readonly CompileLeaf[]) => string,
): Compiled {
  const signature = signatureOf(leaves);
  const fail = (message: string): Compiled => ({ ok: false, signature, errors: [message] });
  const named = leaves.filter(isName);
  const body = leaves.filter((leaf) => !isName(leaf));
  if (options.name === undefined) return fail("A span over the record's name needs the record's name.");
  const nameBytes = Buffer.byteLength(options.name, "utf8");
  for (const leaf of named) {
    const end = leaf.end_byte ?? leaf.start_byte;
    if (leaf.start_byte < 0 || end <= leaf.start_byte || end > nameBytes) return fail("A name span lies outside the record's name.");
  }
  // The name leaves compile as ordinary leaves over the name text; the fragment tag is only a locator.
  const nameLeaves = named.map(({ fragment: _fragment, ...rest }) => rest as CompileLeaf);
  const nameResult = compile(nameLeaves, options.name, options);
  if (!nameResult.ok) return { ok: false, signature, errors: nameResult.errors };
  if (body.length === 0) return nameResult;
  const bodyResult = compile(body, sourceText, options);
  if (!bodyResult.ok) return { ok: false, signature, errors: bodyResult.errors };
  const joined = joinSegments([nameResult, bodyResult]);
  if (joined.errors.length) return fail(joined.errors.join(" "));
  return { ok: true, signature, mechanics: joined.mechanics, checks: joined.checks, ...(joined.core ? { core: joined.core } : {}) };
}
