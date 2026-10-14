// Frozen copy of the round5c/stamp-matcher/v1 matcher as first shipped, before its
// per-scan hoisting. The optimized matcher must return byte-identical results; this is the oracle.
import type { StampFragmentPattern, StampGuard, StampSegment, StampSlotDefinition } from "../../src/round5c/contracts.js";
import type { MatchLeafEvidence, NormalizedProjection, PatternMatch, PatternSourceFragment, SegmentEvidence } from "../../src/round5c/matching.js";

const WORD = /[\p{L}\p{N}_]/u;
const GRAPHEME_SEGMENTER = new Intl.Segmenter("und", { granularity: "grapheme" });
function normalizedProjection(source: string): NormalizedProjection {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let byteOffset = 0;
  let whitespaceStart: number | null = null;
  let whitespaceEnd: number | null = null;
  const append = (character: string, start: number, end: number): void => {
    text += character;
    for (let index = 0; index < character.length; index += 1) {
      starts.push(start);
      ends.push(end);
    }
  };
  const flushWhitespace = (): void => {
    if (whitespaceStart === null || whitespaceEnd === null) return;
    if (text.length > 0) append(" ", whitespaceStart, whitespaceEnd);
    whitespaceStart = null;
    whitespaceEnd = null;
  };
  for (const { segment: sourceGrapheme } of GRAPHEME_SEGMENTER.segment(source)) {
    const start = byteOffset;
    byteOffset += Buffer.byteLength(sourceGrapheme, "utf8");
    const end = byteOffset;
    const normalized = sourceGrapheme.normalize("NFKC").toLowerCase().replace(/[‐‑‒–—]/gu, "-");
    for (const character of normalized) {
      if (/\s/u.test(character)) {
        whitespaceStart ??= start;
        whitespaceEnd = end;
      } else {
        flushWhitespace();
        append(character, start, end);
      }
    }
  }
  return { text, starts, ends };
}

/** Normalize a literal segment while retaining an explicitly authored edge space. */
function normalizedPatternLiteral(source: string): string {
  const normalized = source.normalize("NFKC").toLowerCase().replace(/[‐‑‒–—]/gu, "-");
  const core = normalizedProjection(source).text;
  if (!core) return /\s/u.test(normalized) ? " " : "";
  return `${/^\s/u.test(normalized) ? " " : ""}${core}${/\s$/u.test(normalized) ? " " : ""}`;
}

function normalizedSurface(source: string): string {
  return normalizedProjection(source).text;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validBoundary(projection: NormalizedProjection, start: number, end: number): boolean {
  return (start === 0 || projection.starts[start] !== projection.starts[start - 1]) && (end === projection.text.length || projection.ends[end - 1] !== projection.ends[end]);
}

function guardMatches(guards: StampGuard[], direction: "before" | "after", projection: NormalizedProjection, offset: number): boolean {
  return guards.some((candidate) => {
    if ("boundary" in candidate) {
      if (candidate.boundary === "fragment") return direction === "before" ? offset === 0 : offset === projection.text.length;
      const adjacent = direction === "before" ? projection.text[offset - 1] ?? "" : projection.text[offset] ?? "";
      return !WORD.test(adjacent);
    }
    const literal = normalizedPatternLiteral(candidate.literal);
    return direction === "before" ? projection.text.slice(Math.max(0, offset - literal.length), offset) === literal : projection.text.slice(offset, offset + literal.length) === literal;
  });
}

function segmentMatches(segment: StampSegment, projection: NormalizedProjection, position: number, bindings: Record<string, unknown>, leaves: readonly MatchLeafEvidence[], fragment: PatternSourceFragment): Array<{ end: number; value?: unknown; leaf?: MatchLeafEvidence }> {
  if ("literal" in segment) {
    const literal = normalizedPatternLiteral(segment.literal);
    return projection.text.startsWith(literal, position) ? [{ end: position + literal.length }] : [];
  }
  if ("slot" in segment) throw new Error("Slot matching requires its definition.");
  return leaves.filter((leaf) => leaf.fragment === fragment.fragment && leaf.start_byte >= fragment.start_byte && leaf.end_byte <= fragment.end_byte && leaf.family_id === segment.leaf.family_id && leaf.family_version === segment.leaf.family_version && (!segment.leaf.parameters || Object.entries(segment.leaf.parameters).every(([key, value]) => sameJson(leaf.parameters[key], value)))).map((leaf) => {
    const relativeStart = leaf.start_byte - fragment.start_byte;
    const relativeEnd = leaf.end_byte - fragment.start_byte;
    const startIndex = projection.starts.indexOf(relativeStart);
    let endIndex = -1;
    for (let index = startIndex; index < projection.ends.length; index += 1) if (projection.ends[index] === relativeEnd) endIndex = index + 1;
    return startIndex === position && endIndex > position ? { end: endIndex, leaf } : null;
  }).filter((entry): entry is { end: number; leaf: MatchLeafEvidence } => entry !== null);
}

function slotMatches(definition: StampSlotDefinition, projection: NormalizedProjection, position: number): Array<{ end: number; value: unknown }> {
  if (definition.kind === "enum") return definition.values.map((entry) => ({ end: position + normalizedSurface(entry.text).length, value: entry.value })).filter((entry, index) => projection.text.startsWith(normalizedSurface(definition.values[index]!.text), position));
  const matched = /^[+-]?\d+/u.exec(projection.text.slice(position))?.[0];
  if (!matched) return [];
  const remainder = projection.text.slice(position + matched.length);
  if (/^\.\d/u.test(remainder) || /^e[+-]?\d/u.test(remainder)) return [];
  const value = Number(matched);
  return Number.isSafeInteger(value) && value >= definition.min && value <= definition.max
    ? [{ end: position + matched.length, value }]
    : [];
}

export function referenceMatchFragmentPattern(pattern: StampFragmentPattern, slots: Record<string, StampSlotDefinition>, fragment: PatternSourceFragment, options: { complete: boolean; before?: StampGuard[]; after?: StampGuard[]; leaves?: readonly MatchLeafEvidence[] }): PatternMatch[] {
  if (pattern.fragment !== fragment.fragment) return [];
  const projection = normalizedProjection(fragment.text);
  const leaves = options.leaves ?? [];
  const results: PatternMatch[] = [];
  const starts = options.complete ? [0] : Array.from({ length: projection.text.length }, (_, index) => index);
  const visit = (segmentIndex: number, position: number, start: number, bindings: Record<string, unknown>, segments: Record<string, SegmentEvidence>, dependencies: number[]): void => {
    if (segmentIndex === pattern.segments.length) {
      if (options.complete && position !== projection.text.length) return;
      if (!validBoundary(projection, start, position)) return;
      if (options.before && !guardMatches(options.before, "before", projection, start)) return;
      if (options.after && !guardMatches(options.after, "after", projection, position)) return;
      const relativeStart = projection.starts[start];
      const relativeEnd = projection.ends[position - 1];
      if (relativeStart === undefined || relativeEnd === undefined) return;
      const startByte = fragment.start_byte + relativeStart;
      const endByte = fragment.start_byte + relativeEnd;
      const exactText = Buffer.from(fragment.text, "utf8").subarray(relativeStart, relativeEnd).toString("utf8");
      results.push({ fragment: fragment.fragment, start_byte: startByte, end_byte: endByte, exact_text: exactText, bindings: structuredClone(bindings), segments: structuredClone(segments), leaf_dependencies: [...new Set(dependencies)].sort((a, b) => a - b) });
      return;
    }
    const candidate = pattern.segments[segmentIndex]!;
    const matches = "slot" in candidate ? slotMatches(slots[candidate.slot]!, projection, position) : segmentMatches(candidate, projection, position, bindings, leaves, fragment);
    for (const match of matches) {
      if (match.end <= position || !validBoundary(projection, position, match.end)) continue;
      const relativeStart = projection.starts[position];
      const relativeEnd = projection.ends[match.end - 1];
      if (relativeStart === undefined || relativeEnd === undefined) continue;
      const evidence: SegmentEvidence = { id: candidate.id, fragment: fragment.fragment, start_byte: fragment.start_byte + relativeStart, end_byte: fragment.start_byte + relativeEnd, exact_text: Buffer.from(fragment.text, "utf8").subarray(relativeStart, relativeEnd).toString("utf8") };
      const nextBindings = { ...bindings };
      const nextDependencies = [...dependencies];
      if ("slot" in candidate) {
        if (Object.hasOwn(nextBindings, candidate.slot) && !sameJson(nextBindings[candidate.slot], match.value)) continue;
        nextBindings[candidate.slot] = match.value;
      } else if ("leaf" in candidate && "leaf" in match && match.leaf) {
        nextBindings[candidate.id] = { parameters: match.leaf.parameters };
        nextDependencies.push(match.leaf.id);
      }
      visit(segmentIndex + 1, match.end, start, nextBindings, { ...segments, [candidate.id]: evidence }, nextDependencies);
    }
  };
  for (const start of starts) visit(0, start, start, Object.create(null) as Record<string, unknown>, Object.create(null) as Record<string, SegmentEvidence>, []);
  const unique = new Map<string, PatternMatch>();
  for (const result of results) unique.set(JSON.stringify([result.start_byte, result.end_byte, result.bindings, result.leaf_dependencies]), result);
  return [...unique.values()];
}
