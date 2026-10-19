import type { CompileLeaf } from "./compile-fragments.js";
import type { Compiled } from "./compile.js";
import { joinSegments } from "./compile-segments.js";
import { usageFor } from "./restriction-families.js";
import { shapeSignature } from "./compile-placement.js";
import { compileRecipientReaction } from "./compile-recipient-reactions.js";

/** Independently labelled reactions share the header's allowance, not a fresh allowance per reaction. */
export function compileReactionParts(
  leaves: readonly CompileLeaf[], sourceText: string | undefined,
  compile: (leaves: readonly CompileLeaf[]) => Compiled,
): Compiled | null {
  if (sourceText === undefined || leaves.some((leaf) => leaf.family_id === "named-option")) return null;
  const headings = [...sourceText.matchAll(/(?:^|\n)\*\*[^*\n]+\*\*[ \t]*\r?\n/gu)]
    .map((match) => Buffer.byteLength(sourceText.slice(0, match.index! + match[0].length), "utf8"));
  if (headings.length < 2) return null;
  const header = leaves.filter((leaf) => leaf.start_byte < headings[0]!);
  if (!header.length || header.some((leaf) => !["usage-limit", "usage-scope", "optional-use"].includes(leaf.family_id))) return null;
  const usageLeaves = header.filter((leaf) => leaf.family_id === "usage-limit");
  if (usageLeaves.length !== 1) return null;
  const scope = usageLeaves[0]!.parameters.per ?? header.find((leaf) => leaf.family_id === "usage-scope")?.parameters.per;
  if (scope === undefined) return null;
  const groups = headings.map((start, index) => leaves.filter((leaf) => leaf.start_byte >= start && leaf.start_byte < (headings[index + 1] ?? Infinity)));
  if (groups.some((group) => !group.some((leaf) => leaf.role === "EFFECT") || !group.some((leaf) => leaf.family_id === "event"))) return null;
  const results = groups.map((group) => {
    const reaction = [...header.filter((leaf) => leaf.family_id === "optional-use"), ...group];
    return compileRecipientReaction(reaction, compile) ?? compile(reaction);
  });
  const signature = shapeSignature(leaves, sourceText);
  const errors = results.flatMap((result) => result.ok ? [] : result.errors);
  if (errors.length) return { ok: false, signature, errors };
  const joined = joinSegments(results.filter((result): result is Extract<Compiled, { ok: true }> => result.ok));
  if (joined.errors.length) return { ok: false, signature, errors: joined.errors };
  return { ok: true, signature, mechanics: { ...joined.mechanics, usage: usageFor({ ...usageLeaves[0]!.parameters, per: scope }) }, checks: joined.checks, ...(joined.core ? { core: joined.core } : {}) };
}
