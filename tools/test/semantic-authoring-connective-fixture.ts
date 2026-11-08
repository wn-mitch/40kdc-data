import type { CompileLeaf, Compiled } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { attachConnectives } from "../src/semantic-authoring/leaf-view.js";

/** One leaf: its wording in the text, family, parameters and (optionally) fragment. */
export type Item = readonly [string, string, Record<string, unknown>, string?];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). The fourth item is the fragment. */
export function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: fragment ?? "RAW_TEXT",
    };
  });
}

/** The leaves with a reviewed connective on each listed wording (its first occurrence at or after `after`). */
export function annotated(text: string, leaves: CompileLeaf[], connectives: Array<{ surface: string; after?: string; relation?: string; fragment?: string }>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  return attachConnectives(leaves, connectives.map(({ surface, after, relation, fragment }) => {
    const from = after === undefined ? 0 : bytes.indexOf(Buffer.from(after, "utf8"));
    const start = bytes.indexOf(Buffer.from(surface, "utf8"), Math.max(0, from));
    if (start < 0) throw new Error(`"${surface}" is not in the text`);
    return { fragment: fragment ?? "RAW_TEXT", start_byte: start, end_byte: start + Buffer.byteLength(surface, "utf8"), surface, relation: relation ?? "condition-of" };
  }));
}

/** Asserts the compile succeeded (failing with its errors otherwise) and narrows to the compiled record. */
export function expectCompiled(result: Compiled): asserts result is Extract<Compiled, { ok: true }> {
  if (!result.ok) throw new Error(`expected a compiled record, got errors: ${result.errors.join("; ")}`);
}

/** Asserts the compile was refused and narrows to its errors. */
export function expectRefused(result: Compiled): asserts result is Extract<Compiled, { ok: false }> {
  if (result.ok) throw new Error("expected the compile to be refused, but it compiled");
}
