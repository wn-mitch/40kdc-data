import { familyRole, normalizeFingerprintParameters, reviewedFamily, type CompositionStampVariant, type JsonScalar, type LeafStampVariant, type StampDefinition, type StampFragmentPattern, type StampGuard, type StampSegment, type StampSlotDefinition, type StampTemplate } from "./contracts.js";

export type NormalizedProjection = { text: string; starts: number[]; ends: number[] };
export type MatchLeafEvidence = {
  id: number;
  fragment: string;
  start_byte: number;
  end_byte: number;
  family_id: string;
  family_version: number;
  parameters: Record<string, unknown>;
};
export type PatternSourceFragment = { fragment: string; start_byte: number; end_byte: number; text: string };
export type SegmentEvidence = { id: string; fragment: string; start_byte: number; end_byte: number; exact_text: string };
export type PatternMatch = {
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  bindings: Record<string, unknown>;
  segments: Record<string, SegmentEvidence>;
  leaf_dependencies: number[];
};

const BINDING_ID = /^[a-z][a-z0-9_]*$/u;
const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const WORD = /[\p{L}\p{N}_]/u;
const GRAPHEME_SEGMENTER = new Intl.Segmenter("und", { granularity: "grapheme" });

export function normalizedProjection(source: string): NormalizedProjection {
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

/**
 * Pattern literals, guard literals, and enum spellings come from a small, fixed stamp vocabulary
 * but are consulted at every candidate position. Strings are immutable, so a bounded string cache
 * cannot alias caller state; it is cleared wholesale when it fills.
 */
const PATTERN_TEXT_CACHE_LIMIT = 4096;
const patternLiteralCache = new Map<string, string>();
const patternSurfaceCache = new Map<string, string>();

function cached(cache: Map<string, string>, source: string, compute: (source: string) => string): string {
  const hit = cache.get(source);
  if (hit !== undefined) return hit;
  const value = compute(source);
  if (cache.size >= PATTERN_TEXT_CACHE_LIMIT) cache.clear();
  cache.set(source, value);
  return value;
}

/** Normalize a literal segment while retaining an explicitly authored edge space. */
function normalizedPatternLiteral(source: string): string {
  return cached(patternLiteralCache, source, computePatternLiteral);
}

function patternSurface(source: string): string {
  return cached(patternSurfaceCache, source, normalizedSurface);
}

function computePatternLiteral(source: string): string {
  const normalized = source.normalize("NFKC").toLowerCase().replace(/[‐‑‒–—]/gu, "-");
  const core = normalizedProjection(source).text;
  if (!core) return /\s/u.test(normalized) ? " " : "";
  return `${/^\s/u.test(normalized) ? " " : ""}${core}${/\s$/u.test(normalized) ? " " : ""}`;
}

export function normalizedSurface(source: string): string {
  return normalizedProjection(source).text;
}

const SURFACE_EDGE_PUNCTUATION = /^[\s\p{P}]+|[\s\p{P}]+$/gu;

/** The leaf-surface key of source wording: normalized, without edge punctuation. */
export function leafSurfaceKey(text: string): string {
  return normalizedSurface(text.replace(SURFACE_EDGE_PUNCTUATION, ""));
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, label: string, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required.`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) || PROTOTYPE_KEYS.has(key)) throw new TypeError(`${label}.${key} is not allowed.`);
  }
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !BINDING_ID.test(value)) throw new TypeError(`${label} must match ${BINDING_ID}.`);
  return value;
}

function nonblank(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be nonblank.`);
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer.`);
  return value;
}

function jsonScalar(value: unknown, label: string): JsonScalar {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
  throw new TypeError(`${label} must be a JSON scalar.`);
}

function sourceTypes(value: unknown, label: string): "any" | Array<string | null> {
  if (value === "any") return "any";
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be 'any' or a nonempty array.`);
  const result = value.map((entry, index) => {
    if (entry === null || typeof entry === "string" && entry.trim()) return entry;
    throw new TypeError(`${label}[${index}] must be null or a nonblank string.`);
  });
  if (new Set(result.map((entry) => JSON.stringify(entry))).size !== result.length) throw new TypeError(`${label} contains duplicates.`);
  return result;
}

function slotDefinition(value: unknown, label: string): StampSlotDefinition {
  const input = record(value, label);
  if (input.kind === "enum") {
    exactKeys(input, label, ["kind", "values"]);
    if (!Array.isArray(input.values) || input.values.length === 0) throw new TypeError(`${label}.values must be nonempty.`);
    const seen = new Set<string>();
    const values = input.values.map((entry, index) => {
      const item = record(entry, `${label}.values[${index}]`);
      exactKeys(item, `${label}.values[${index}]`, ["text", "value"]);
      const text = nonblank(item.text, `${label}.values[${index}].text`);
      const normalized = normalizedSurface(text);
      if (!normalized || seen.has(normalized)) throw new TypeError(`${label} enum spellings must be unique after normalization.`);
      seen.add(normalized);
      return { text, value: jsonScalar(item.value, `${label}.values[${index}].value`) };
    });
    return { kind: "enum", values };
  }
  if (input.kind === "integer") {
    exactKeys(input, label, ["kind", "min", "max"]);
    const min = safeInteger(input.min, `${label}.min`);
    const max = safeInteger(input.max, `${label}.max`);
    if (min > max) throw new TypeError(`${label}.min must not exceed max.`);
    return { kind: "integer", min, max };
  }
  throw new TypeError(`${label}.kind must be enum or integer.`);
}

function segment(value: unknown, label: string, slots: Record<string, StampSlotDefinition>, kind: StampDefinition["kind"]): StampSegment {
  const input = record(value, label);
  const id = identifier(input.id, `${label}.id`);
  if (Object.hasOwn(input, "literal")) {
    exactKeys(input, label, ["id", "literal"]);
    if (typeof input.literal !== "string" || input.literal.length === 0) throw new TypeError(`${label}.literal must be nonempty.`);
    const literal = input.literal;
    if (!normalizedPatternLiteral(literal)) throw new TypeError(`${label}.literal has no matchable characters.`);
    return { id, literal };
  }
  if (Object.hasOwn(input, "slot")) {
    exactKeys(input, label, ["id", "slot"]);
    const slot = identifier(input.slot, `${label}.slot`);
    if (!slots[slot]) throw new TypeError(`${label}.slot references undeclared slot ${slot}.`);
    return { id, slot };
  }
  if (Object.hasOwn(input, "leaf")) {
    if (kind !== "composition") throw new TypeError(`${label}.leaf is composition-only.`);
    exactKeys(input, label, ["id", "leaf"]);
    const leaf = record(input.leaf, `${label}.leaf`);
    exactKeys(leaf, `${label}.leaf`, ["family_id", "family_version"], ["parameters"]);
    const familyId = nonblank(leaf.family_id, `${label}.leaf.family_id`);
    const familyVersion = safeInteger(leaf.family_version, `${label}.leaf.family_version`);
    reviewedFamily(familyId, familyVersion);
    const parameters = leaf.parameters === undefined ? undefined : record(leaf.parameters, `${label}.leaf.parameters`);
    if (parameters) normalizeFingerprintParameters(familyId, parameters, familyVersion);
    return { id, leaf: { family_id: familyId, family_version: familyVersion, ...(parameters ? { parameters } : {}) } };
  }
  throw new TypeError(`${label} must contain exactly one of literal, slot, or leaf.`);
}

function fragmentPattern(value: unknown, label: string, slots: Record<string, StampSlotDefinition>, kind: StampDefinition["kind"]): StampFragmentPattern {
  const input = record(value, label);
  exactKeys(input, label, ["fragment", "segments"]);
  const fragment = nonblank(input.fragment, `${label}.fragment`);
  if (!Array.isArray(input.segments) || input.segments.length === 0) throw new TypeError(`${label}.segments must be nonempty.`);
  const segments = input.segments.map((entry, index) => segment(entry, `${label}.segments[${index}]`, slots, kind));
  if (new Set(segments.map((entry) => entry.id)).size !== segments.length) throw new TypeError(`${label} segment ids must be unique.`);
  return { fragment, segments };
}

function guard(value: unknown, label: string): StampGuard {
  const input = record(value, label);
  if (Object.hasOwn(input, "boundary")) {
    exactKeys(input, label, ["boundary"]);
    if (input.boundary !== "fragment" && input.boundary !== "word") throw new TypeError(`${label}.boundary is invalid.`);
    return { boundary: input.boundary };
  }
  exactKeys(input, label, ["literal"]);
  return { literal: nonblank(input.literal, `${label}.literal`) };
}

type TemplateRoots = {
  slots: Record<string, StampSlotDefinition>;
  leaves: ReadonlySet<string>;
};

function templatePath(pathValue: unknown, label: string, roots: TemplateRoots, caseSelector: boolean): { path: string; slot?: StampSlotDefinition } {
  const path = nonblank(pathValue, label);
  const parts = path.split(".");
  if (parts.some((part) => !BINDING_ID.test(part) || PROTOTYPE_KEYS.has(part))) throw new TypeError(`${label} is not a valid binding path.`);
  const root = parts[0]!;
  const slot = roots.slots[root];
  if (slot) {
    if (parts.length !== 1) throw new TypeError(`${label} cannot traverse scalar slot ${root}.`);
    return { path, slot };
  }
  if (!roots.leaves.has(root) || parts[1] !== "parameters" || parts.length < 3) {
    throw new TypeError(`${label} references undefined binding ${path}.`);
  }
  return { path };
}

function assertCasesCoverSlot(definition: StampSlotDefinition, seen: ReadonlySet<string>, label: string): void {
  const expected = definition.kind === "enum"
    ? new Set(definition.values.map((entry) => JSON.stringify([typeof entry.value, entry.value])))
    : (() => {
        const width = definition.max - definition.min + 1;
        if (!Number.isSafeInteger(width) || width > seen.size) throw new TypeError(`${label} is missing integer slot cases.`);
        return new Set(Array.from({ length: width }, (_, index) => JSON.stringify(["number", definition.min + index])));
      })();
  if (expected.size !== seen.size || [...expected].some((key) => !seen.has(key))) throw new TypeError(`${label} must cover every typed slot value exactly once.`);
}

function template(value: unknown, label: string, roots: TemplateRoots, active = new WeakSet<object>()): StampTemplate {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object") throw new TypeError(`${label} must be JSON.`);
  if (active.has(value as object)) throw new TypeError(`${label} contains a cycle.`);
  active.add(value as object);
  try {
    if (Array.isArray(value)) return value.map((entry, index) => template(entry, `${label}[${index}]`, roots, active));
    const input = record(value, label);
    for (const key of Object.keys(input)) if (PROTOTYPE_KEYS.has(key)) throw new TypeError(`${label}.${key} is forbidden.`);
    if (Object.hasOwn(input, "$bind")) {
      exactKeys(input, label, ["$bind"]);
      const { path } = templatePath(input.$bind, `${label}.$bind`, roots, false);
      return { $bind: path };
    }
    if (Object.hasOwn(input, "$case")) {
      exactKeys(input, label, ["$case", "cases"]);
      const { path, slot } = templatePath(input.$case, `${label}.$case`, roots, true);
      if (!Array.isArray(input.cases) || input.cases.length === 0) throw new TypeError(`${label}.cases must be nonempty.`);
      const seen = new Set<string>();
      const cases = input.cases.map((entry, index) => {
        const item = record(entry, `${label}.cases[${index}]`);
        exactKeys(item, `${label}.cases[${index}]`, ["value", "then"]);
        const value = jsonScalar(item.value, `${label}.cases[${index}].value`);
        const key = JSON.stringify([typeof value, value]);
        if (seen.has(key)) throw new TypeError(`${label}.cases contains a duplicate typed value.`);
        seen.add(key);
        return { value, then: template(item.then, `${label}.cases[${index}].then`, roots, active) };
      });
      if (slot) assertCasesCoverSlot(slot, seen, label);
      return { $case: path, cases };
    }
    return Object.fromEntries(Object.entries(input).map(([key, entry]) => [key, template(entry, `${label}.${key}`, roots, active)]));
  } finally {
    active.delete(value as object);
  }
}

function slots(value: unknown, label: string): Record<string, StampSlotDefinition> {
  const input = record(value, label);
  const output: Record<string, StampSlotDefinition> = Object.create(null) as Record<string, StampSlotDefinition>;
  for (const [key, entry] of Object.entries(input)) {
    identifier(key, `${label} key`);
    if (PROTOTYPE_KEYS.has(key)) throw new TypeError(`${label}.${key} is forbidden.`);
    output[key] = slotDefinition(entry, `${label}.${key}`);
  }
  return output;
}

export function validateStampDefinition(value: unknown): StampDefinition {
  const input = record(value, "stamp definition");
  exactKeys(input, "stamp definition", ["schema_version", "kind", "label", "variants"]);
  if (input.schema_version !== 1) throw new TypeError("stamp definition schema_version must be 1.");
  if (input.kind !== "leaf" && input.kind !== "composition") throw new TypeError("stamp definition kind is invalid.");
  const label = nonblank(input.label, "stamp definition.label");
  if (!Array.isArray(input.variants) || input.variants.length === 0) throw new TypeError("stamp definition.variants must be nonempty.");
  const variantIds = new Set<string>();
  const variants = input.variants.map((entry, index) => {
    const value = record(entry, `stamp definition.variants[${index}]`);
    const variantLabel = `stamp definition.variants[${index}]`;
    const id = identifier(value.id, `${variantLabel}.id`);
    if (variantIds.has(id)) throw new TypeError("stamp variant ids must be unique.");
    variantIds.add(id);
    const parsedSlots = slots(value.slots, `${variantLabel}.slots`);
    const parsedSourceTypes = sourceTypes(value.source_types, `${variantLabel}.source_types`);
    if (!Array.isArray(value.fragments) || value.fragments.length === 0) throw new TypeError(`${variantLabel}.fragments must be nonempty.`);
    const fragments = value.fragments.map((fragmentValue, fragmentIndex) => fragmentPattern(fragmentValue, `${variantLabel}.fragments[${fragmentIndex}]`, parsedSlots, input.kind as StampDefinition["kind"]));
    if (new Set(fragments.map((fragment) => fragment.fragment)).size !== fragments.length) throw new TypeError(`${variantLabel} fragment names must be unique.`);
    const segmentIds = fragments.flatMap((fragment) => fragment.segments.map((candidate) => candidate.id));
    if (new Set(segmentIds).size !== segmentIds.length) throw new TypeError(`${variantLabel} segment ids must be unique across fragments.`);
    const usedSlots = new Set(fragments.flatMap((fragment) => fragment.segments.filter((candidate): candidate is Extract<StampSegment, { slot: string }> => "slot" in candidate).map((candidate) => candidate.slot)));
    for (const slotId of Object.keys(parsedSlots)) if (!usedSlots.has(slotId)) throw new TypeError(`${variantLabel}.slots.${slotId} is never matched by a segment.`);
    const leafIds = fragments.flatMap((fragment) => fragment.segments.filter((candidate): candidate is Extract<StampSegment, { leaf: unknown }> => "leaf" in candidate).map((candidate) => candidate.id));
    const roots: TemplateRoots = { slots: parsedSlots, leaves: new Set(leafIds) };
    if (input.kind === "leaf") {
      exactKeys(value, variantLabel, ["id", "source_types", "fragments", "slots", "before", "after", "output", "allow_containment"]);
      if (fragments.length !== 1) throw new TypeError("Leaf variants require exactly one fragment pattern.");
      if (!Array.isArray(value.before) || !Array.isArray(value.after) || value.before.length === 0 || value.after.length === 0) throw new TypeError("Leaf variants require nonempty before and after guard lists.");
      const before = value.before.map((item, guardIndex) => guard(item, `${variantLabel}.before[${guardIndex}]`));
      const after = value.after.map((item, guardIndex) => guard(item, `${variantLabel}.after[${guardIndex}]`));
      if (!after.some((item) => "literal" in item || item.boundary === "fragment")) throw new TypeError("Leaf variants require a terminal guard stronger than a word boundary.");
      const output = record(value.output, `${variantLabel}.output`);
      exactKeys(output, `${variantLabel}.output`, ["family_id", "family_version", "parameters"]);
      const familyId = nonblank(output.family_id, `${variantLabel}.output.family_id`);
      const familyVersion = safeInteger(output.family_version, `${variantLabel}.output.family_version`);
      familyRole(familyId, familyVersion);
      const parameters = template(output.parameters, `${variantLabel}.output.parameters`, roots);
      if (!Array.isArray(value.allow_containment)) throw new TypeError(`${variantLabel}.allow_containment must be an array.`);
      const allowContainment = value.allow_containment.map((item, containmentIndex) => {
        const containment = record(item, `${variantLabel}.allow_containment[${containmentIndex}]`);
        exactKeys(containment, `${variantLabel}.allow_containment[${containmentIndex}]`, ["other_family_id", "other_family_version", "direction"]);
        const otherFamilyId = nonblank(containment.other_family_id, "other_family_id");
        const otherFamilyVersion = safeInteger(containment.other_family_version, "other_family_version");
        reviewedFamily(otherFamilyId, otherFamilyVersion);
        if (containment.direction !== "contains" && containment.direction !== "contained-by") throw new TypeError("containment direction is invalid.");
        return { other_family_id: otherFamilyId, other_family_version: otherFamilyVersion, direction: containment.direction as LeafStampVariant["allow_containment"][number]["direction"] };
      });
      return { id, source_types: parsedSourceTypes, fragments: [fragments[0]!], slots: parsedSlots, before, after, output: { family_id: familyId, family_version: familyVersion, parameters }, allow_containment: allowContainment } satisfies LeafStampVariant;
    }
    exactKeys(value, variantLabel, ["id", "source_types", "fragments", "slots", "graph_template", "mechanics_template"]);
    return { id, source_types: parsedSourceTypes, fragments, slots: parsedSlots, graph_template: template(value.graph_template, `${variantLabel}.graph_template`, roots), mechanics_template: value.mechanics_template === null ? null : template(value.mechanics_template, `${variantLabel}.mechanics_template`, roots) } satisfies CompositionStampVariant;
  });
  return input.kind === "leaf" ? { schema_version: 1, kind: "leaf", label, variants: variants as LeafStampVariant[] } : { schema_version: 1, kind: "composition", label, variants: variants as CompositionStampVariant[] };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function bindingValue(bindings: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let value: unknown = bindings;
  for (const part of parts) {
    if (!BINDING_ID.test(part) || value === null || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, part)) throw new TypeError(`Template binding ${path} is unavailable.`);
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function instantiateTemplate(value: StampTemplate, bindings: Record<string, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => instantiateTemplate(entry, bindings));
  if (Object.hasOwn(value, "$bind")) return structuredClone(bindingValue(bindings, (value as { $bind: string }).$bind));
  if (Object.hasOwn(value, "$case")) {
    const branch = value as { $case: string; cases: Array<{ value: JsonScalar; then: StampTemplate }> };
    const selected = bindingValue(bindings, branch.$case);
    const found = branch.cases.find((entry) => typeof entry.value === typeof selected && sameJson(entry.value, selected));
    if (!found) throw new TypeError(`Template case ${branch.$case} has no branch for ${JSON.stringify(selected)}.`);
    return instantiateTemplate(found.then, bindings);
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, instantiateTemplate(entry, bindings)]));
}

type ProjectedFragment = { projection: NormalizedProjection; bytes: Buffer };

/**
 * Scan-local memo of fragment projections. One scan (a corpus preview or application pass) matches
 * many stamp variants against the same fragments; projecting each fragment once per scan instead
 * of once per variant is the dominant saving. The memo is private to the matcher and discarded
 * with the scan, so no projection is shared across scans or handed to callers.
 */
export type FragmentScan = { readonly projected: Map<string, ProjectedFragment> };

export function createFragmentScan(): FragmentScan {
  return { projected: new Map() };
}

function projectFragment(text: string, scan: FragmentScan | undefined): ProjectedFragment {
  const hit = scan?.projected.get(text);
  if (hit) return hit;
  const value = { projection: normalizedProjection(text), bytes: Buffer.from(text, "utf8") };
  scan?.projected.set(text, value);
  return value;
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

// Sticky scanners read the projection in place; slicing the remainder per position is quadratic.
const INTEGER_TOKEN = /[+-]?\d+/uy;
const DECIMAL_TAIL = /\.\d/uy;
const EXPONENT_TAIL = /e[+-]?\d/uy;

function slotMatches(definition: StampSlotDefinition, projection: NormalizedProjection, position: number): Array<{ end: number; value: unknown }> {
  if (definition.kind === "enum") {
    const matches: Array<{ end: number; value: unknown }> = [];
    for (const entry of definition.values) {
      const surface = patternSurface(entry.text);
      if (projection.text.startsWith(surface, position)) matches.push({ end: position + surface.length, value: entry.value });
    }
    return matches;
  }
  INTEGER_TOKEN.lastIndex = position;
  const matched = INTEGER_TOKEN.exec(projection.text)?.[0];
  if (!matched) return [];
  const remainderAt = position + matched.length;
  DECIMAL_TAIL.lastIndex = remainderAt;
  EXPONENT_TAIL.lastIndex = remainderAt;
  if (DECIMAL_TAIL.test(projection.text) || EXPONENT_TAIL.test(projection.text)) return [];
  const value = Number(matched);
  return Number.isSafeInteger(value) && value >= definition.min && value <= definition.max
    ? [{ end: position + matched.length, value }]
    : [];
}

/** Candidate start positions. A leading literal can only match where it occurs, so skip to those. */
function startPositions(pattern: StampFragmentPattern, projection: NormalizedProjection, complete: boolean): number[] {
  if (complete) return [0];
  const first = pattern.segments[0];
  if (!first || !("literal" in first)) return Array.from({ length: projection.text.length }, (_, index) => index);
  const literal = normalizedPatternLiteral(first.literal);
  const positions: number[] = [];
  for (let index = projection.text.indexOf(literal); index !== -1; index = projection.text.indexOf(literal, index + 1)) positions.push(index);
  return positions;
}

export function matchFragmentPattern(pattern: StampFragmentPattern, slots: Record<string, StampSlotDefinition>, fragment: PatternSourceFragment, options: { complete: boolean; before?: StampGuard[]; after?: StampGuard[]; leaves?: readonly MatchLeafEvidence[]; scan?: FragmentScan }): PatternMatch[] {
  if (pattern.fragment !== fragment.fragment) return [];
  const { projection, bytes } = projectFragment(fragment.text, options.scan);
  const leaves = options.leaves ?? [];
  const results: PatternMatch[] = [];
  const starts = startPositions(pattern, projection, options.complete);
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
      const exactText = bytes.subarray(relativeStart, relativeEnd).toString("utf8");
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
      const evidence: SegmentEvidence = { id: candidate.id, fragment: fragment.fragment, start_byte: fragment.start_byte + relativeStart, end_byte: fragment.start_byte + relativeEnd, exact_text: bytes.subarray(relativeStart, relativeEnd).toString("utf8") };
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

export function sourceTypeAllowed(sourceTypes: "any" | Array<string | null>, sourceType: string | null): boolean {
  return sourceTypes === "any" || sourceTypes.includes(sourceType);
}
