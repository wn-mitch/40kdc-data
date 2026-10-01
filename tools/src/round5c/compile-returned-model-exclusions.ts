import { CompileError, type CompileLeaf } from "./compile-fragments.js";

const qualifier = (leaf: CompileLeaf) => leaf.role === "CONDITION" && leaf.family_id === "returned-model-exclusion";
const clauseBoundary = /[.;:■▪•]|\b(?:and|or)\b/iu;

/** Only the nearest effect in the same source clause can own a model exclusion. */
function candidate(leaves: readonly CompileLeaf[], at: number, direction: -1 | 1, source: Buffer): number | null {
  const exclusion = leaves[at]!;
  let previous = exclusion;
  for (let index = at + direction; index >= 0 && index < leaves.length; index += direction) {
    const leaf = leaves[index]!;
    if (leaf.fragment !== exclusion.fragment || leaf.role === "EVENT" || leaf.role === "COMBINATOR") return null;
    const left = direction === -1 ? leaf : previous;
    const right = direction === -1 ? previous : leaf;
    if (left.end_byte === undefined) throw new CompileError("A returned-model exclusion needs source span ends to verify its clause.");
    if (clauseBoundary.test(source.subarray(left.end_byte, right.start_byte).toString("utf8"))) return null;
    previous = leaf;
    if (leaf.role === "EFFECT") return leaf.family_id === "return-models" ? index : null;
  }
  return null;
}

/** Fold model eligibility into restoration, never into a whole-unit keyword condition. */
export function foldReturnedModelExclusions(leaves: readonly CompileLeaf[], sourceText?: string): readonly CompileLeaf[] {
  if (!leaves.some(qualifier)) return leaves;
  if (sourceText === undefined) throw new CompileError("A returned-model exclusion needs source text to identify its restoration clause.");
  const source = Buffer.from(sourceText, "utf8");
  const exclusions = new Map<number, string[]>();
  for (let at = 0; at < leaves.length; at++) {
    const leaf = leaves[at]!;
    if (!qualifier(leaf)) continue;
    const before = candidate(leaves, at, -1, source);
    const after = candidate(leaves, at, 1, source);
    if (before !== null && after !== null) throw new CompileError("A returned-model exclusion has two possible restoration effects; its clause must identify one.");
    const owner = before ?? after;
    if (owner === null) throw new CompileError("A returned-model exclusion needs a restoration effect in its own clause.");
    const keywords = leaf.parameters.keywords;
    if (!Array.isArray(keywords) || keywords.length === 0 || keywords.some((keyword) => typeof keyword !== "string")) {
      throw new CompileError("A returned-model exclusion needs reviewed model keywords.");
    }
    exclusions.set(owner, [...(exclusions.get(owner) ?? []), ...keywords]);
  }
  const result: CompileLeaf[] = [];
  for (let at = 0; at < leaves.length; at++) {
    const leaf = leaves[at]!;
    if (qualifier(leaf)) continue;
    const keywords = exclusions.get(at);
    if (!keywords) { result.push(leaf); continue; }
    const existing = leaf.parameters.exclude_model_keyword as string[] | undefined;
    result.push({ ...leaf, parameters: { ...leaf.parameters, exclude_model_keyword: [...new Set([...(existing ?? []), ...keywords])].sort() } });
  }
  return result;
}
