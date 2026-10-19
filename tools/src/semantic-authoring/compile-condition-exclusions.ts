import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/** The byte of the ")" that closes the parenthesis a marker sits in, else of the sentence end. */
function groupEnd(bytes: Buffer, from: number): number {
  let depth = 0;
  for (let at = from; at < bytes.length; at += 1) {
    const ch = bytes[at]!;
    if (ch === 0x28) depth += 1;
    else if (ch === 0x29) {
      if (depth === 0) return at;
      depth -= 1;
    } else if (depth === 0 && (ch === 0x2e || ch === 0x3b || ch === 0x3a)) return at;
  }
  return bytes.length;
}

/**
 * "(excluding units with X that are not Y and are not within Z)": the conditions after the
 * `condition-exclusion` marker, up to where its group ends, are together what is excluded. The
 * marker and its group become one `__none-of` leaf (lowered by `condition()` as not(and(...))),
 * which carries the group's shared subject so a selection's eligibility pass still sees it.
 */
export function foldConditionExclusions(list: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === "condition-exclusion")) return [...list];
  if (sourceText === undefined) throw new CompileError("A condition-exclusion needs the source text to find where its group ends.");
  const bytes = Buffer.from(sourceText, "utf8");
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const marker = list[index]!;
    if (marker.family_id !== "condition-exclusion") {
      out.push(marker);
      continue;
    }
    const end = groupEnd(bytes, marker.end_byte ?? marker.start_byte);
    const group: CompileLeaf[] = [];
    let at = index + 1;
    while (at < list.length && list[at]!.fragment === marker.fragment && list[at]!.start_byte < end) {
      const leaf = list[at]!;
      if (leaf.role !== "CONDITION" || leaf.family_id === "condition-exclusion" || leaf.family_id === "unit-filter") {
        throw new CompileError(`A condition-exclusion holds condition leaves only; ${leaf.family_id} at byte ${leaf.start_byte} is not one.`);
      }
      group.push(leaf);
      at += 1;
    }
    if (group.length === 0) throw new CompileError("A condition-exclusion has no condition after it before its group ends.");
    const subjects = new Set(group.map((leaf) => JSON.stringify(leaf.parameters.subject)));
    const subject = subjects.size === 1 ? group[0]!.parameters.subject : undefined;
    out.push({ ...group[0]!, family_id: "__none-of", family_version: 1, end_byte: group.at(-1)!.end_byte, parameters: { conditions: group, ...(subject !== undefined ? { subject } : {}) } });
    index = at - 1;
  }
  return out;
}
