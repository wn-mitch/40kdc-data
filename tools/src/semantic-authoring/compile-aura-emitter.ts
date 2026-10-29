import { CompileError, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;
type EmitterFilter = {
  owner: "friendly";
  all_of?: string[];
  any_of?: string[];
  none_of?: string[];
  not_all_of?: string[];
};

function emitterFilter(parameters: Record<string, unknown>): EmitterFilter {
  const keywords = parameters.keywords as string[];
  const anyKeywords = parameters.any_keywords as string[];
  return { owner: "friendly", all_of: [...keywords], any_of: [...anyKeywords] };
}

/**
 * Removes the aura-emitter preamble and carries its typed emitter filter onto each following aura.
 * The source preamble lives before an option container, so every option's aura receives the same
 * emitter predicate before the container compiler lowers the option bodies.
 */
export function foldAuraEmitter(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  let active: { fragment: string | undefined; filter: EmitterFilter; used: boolean } | undefined;
  const out: CompileLeaf[] = [];
  let rangeQualifier: { fragment: string | undefined; keywords: readonly string[] } | undefined;
  for (const leaf of leaves) {
    const qualifier = rangeQualifier;
    rangeQualifier = undefined;
    if (qualifier && leaf.fragment === qualifier.fragment && leaf.family_id === "unit-keyword"
      && leaf.parameters.subject === "this-model" && leaf.parameters.negated !== true) {
      const keywords = leaf.parameters.keywords as string[] | undefined;
      // This atom is already the conditional radius's predicate, not an option-wide gate.
      if (keywords?.length === qualifier.keywords.length && keywords.every((keyword) => qualifier.keywords.includes(keyword))) continue;
    }
    if (active !== undefined && leaf.fragment !== active.fragment) {
      if (!active.used) throw new CompileError("An aura-emitter preamble must precede an aura-range in the same fragment.");
      active = undefined;
    }
    if (leaf.family_id === "aura-emitter") {
      if (active !== undefined) throw new CompileError("An aura-emitter preamble may appear only once per fragment.");
      active = { fragment: leaf.fragment, filter: emitterFilter(leaf.parameters), used: false };
      continue;
    }
    if (leaf.family_id === "aura-range" && active !== undefined) {
      active.used = true;
      out.push({ ...leaf, parameters: { ...leaf.parameters, emitter_filter: active.filter } });
      const conditional = leaf.parameters.conditional_range as { keywords: string[] } | undefined;
      if (conditional) rangeQualifier = { fragment: leaf.fragment, keywords: conditional.keywords };
      continue;
    }
    out.push(leaf);
  }
  if (active !== undefined && !active.used) throw new CompileError("An aura-emitter preamble must precede an aura-range.");
  return out;
}

function asFilter(value: unknown): EmitterFilter | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const filter = value as Record<string, unknown>;
  if (filter.owner !== "friendly") return undefined;
  return {
    owner: "friendly",
    ...(Array.isArray(filter.all_of) ? { all_of: [...filter.all_of] as string[] } : {}),
    ...(Array.isArray(filter.any_of) ? { any_of: [...filter.any_of] as string[] } : {}),
    ...(Array.isArray(filter.none_of) ? { none_of: [...filter.none_of] as string[] } : {}),
    ...(Array.isArray(filter.not_all_of) ? { not_all_of: [...filter.not_all_of] as string[] } : {}),
  };
}

function disjointFilters(filter: EmitterFilter, conditionalKeywords: readonly string[]): [EmitterFilter, EmitterFilter] {
  const conditional: EmitterFilter = { ...filter, all_of: [...(filter.all_of ?? []), ...conditionalKeywords] };
  const base: EmitterFilter = {
    ...filter,
    ...(conditionalKeywords.length === 1
      ? { none_of: [...(filter.none_of ?? []), conditionalKeywords[0]] }
      : { not_all_of: [...(filter.not_all_of ?? []), ...conditionalKeywords] }),
  };
  return [base, conditional];
}

function lowerAura(node: Node): Node {
  if (node.type !== "aura") return node;
  const modifier = node.modifier;
  if (modifier === null || typeof modifier !== "object" || Array.isArray(modifier)) return node;
  const current = modifier as Node;
  const conditional = current.conditional_range;
  if (conditional === undefined) return node;
  if (conditional === null || typeof conditional !== "object" || Array.isArray(conditional)) {
    throw new CompileError("aura-range conditional_range must be an object.");
  }
  const filter = asFilter(current.emitter_filter);
  if (filter === undefined) throw new CompileError("aura-range conditional_range needs an aura-emitter filter.");
  const range = conditional as Node;
  const inches = range.inches;
  const keywords = range.keywords;
  if (typeof inches !== "number" || !Array.isArray(keywords) || keywords.length === 0 || keywords.some((item) => typeof item !== "string")) {
    throw new CompileError("aura-range conditional_range needs inches and one or more keyword strings.");
  }
  const [baseFilter, conditionalFilter] = disjointFilters(filter, keywords as string[]);
  const { conditional_range: _conditionalRange, ...ordinaryModifier } = current;
  const baseModifier = { ...ordinaryModifier, emitter_filter: baseFilter };
  const conditionalModifier = { ...ordinaryModifier, range: { inches }, emitter_filter: conditionalFilter };
  const base = { ...node, modifier: baseModifier };
  const extended = { ...node, modifier: conditionalModifier };
  return { type: "sequence", steps: [base, extended] };
}

/** Lowers conditional aura ranges after ordinary container/aura wrapping has produced aura nodes. */
export function lowerConditionalAuras(node: Node): Node {
  const nested = Object.fromEntries(Object.entries(node).map(([key, value]) => [
    key,
    Array.isArray(value)
      ? value.map((item) => item !== null && typeof item === "object" ? lowerConditionalAuras(item as Node) : item)
      : value !== null && typeof value === "object" ? lowerConditionalAuras(value as Node) : value,
  ]));
  return lowerAura(nested);
}
