import { exactSpan } from "./contracts.js";
import {
  asRecord, assertExactKeys, fragmentFor, nonblank, nonnegativeInteger,
  type CurrentAbility, type Fragment, type ParsedHypothesis, type ParsedSemanticSpan, type ParsedStructural,
} from "./luna-parse.js";
import { STRUCTURAL_KINDS, type StructuralKind } from "./schema-ext.js";

/**
 * Version-2 additions to the Luna response: NOVEL hypotheses and structural constituents.
 * Everything here validates exact source bytes and throws on the first violation.
 */

const PARAMETER_NAME = /^[a-z][a-z0-9_]*$/u;
/** A model offset may be re-anchored to its exact text at most this many bytes away. */
export const MAX_OFFSET_REPAIR_BYTES = 64;

/** An interval whose bytes equal its exact text, and whether the model's offsets were re-anchored. */
export type AnchoredInterval = { start_byte: number; end_byte: number; repaired: boolean };

/**
 * Resolve a v2 interval from its exact text. Models copy exact_text reliably but miscount
 * offsets, so when the reported bytes do not equal exact_text, the interval snaps to the
 * occurrence of exact_text (inside `[windowStart, windowEnd)`) nearest the reported start.
 * A tie, no occurrence, or a jump beyond MAX_OFFSET_REPAIR_BYTES rejects the response.
 */
export function anchorExactText(
  source: string,
  start: number,
  end: number,
  exactText: string,
  label: string,
  window: { start: number; end: number } = { start: 0, end: Buffer.byteLength(source, "utf8") },
): AnchoredInterval {
  try {
    if (end > start && exactSpan(source, start, end) === exactText) return { start_byte: start, end_byte: end, repaired: false };
  } catch {
    // A split UTF-8 boundary is repaired the same way as a miscounted one.
  }
  const haystack = Buffer.from(source, "utf8");
  const needle = Buffer.from(exactText, "utf8");
  const candidates: number[] = [];
  for (let index = haystack.indexOf(needle, window.start); index >= 0 && index + needle.length <= window.end; index = haystack.indexOf(needle, index + 1)) {
    candidates.push(index);
  }
  const ranked = candidates.map((position) => ({ position, distance: Math.abs(position - start) })).sort((left, right) => left.distance - right.distance);
  const best = ranked[0];
  if (!best || best.distance > MAX_OFFSET_REPAIR_BYTES || (ranked[1] && ranked[1].distance === best.distance)) {
    throw new Error(`${label}.exact_text does not match source bytes${best ? " and cannot be re-anchored unambiguously" : ""}.`);
  }
  return { start_byte: best.position, end_byte: best.position + needle.length, repaired: true };
}

/** Parse v2 qualifier spans; each carries exact text and must lie inside its span. */
export function parseQualifiersV2(value: unknown, ability: CurrentAbility, start: number, end: number, label: string): { qualifiers: Array<{ start_byte: number; end_byte: number }>; repaired: boolean } {
  if (value === undefined) return { qualifiers: [], repaired: false };
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  let repaired = false;
  const qualifiers = value.map((item, index) => {
    const qualifier = asRecord(item, `${label}[${index}]`);
    assertExactKeys(qualifier, `${label}[${index}]`, ["start_byte", "end_byte", "exact_text"]);
    const anchored = anchorExactText(
      ability.source_text,
      nonnegativeInteger(qualifier.start_byte, `${label}[${index}].start_byte`),
      nonnegativeInteger(qualifier.end_byte, `${label}[${index}].end_byte`),
      nonblank(qualifier.exact_text, `${label}[${index}].exact_text`),
      `${label}[${index}]`,
      { start, end },
    );
    repaired ||= anchored.repaired;
    return { start_byte: anchored.start_byte, end_byte: anchored.end_byte };
  }).sort((left, right) => left.start_byte - right.start_byte || left.end_byte - right.end_byte);
  for (let index = 1; index < qualifiers.length; index += 1) {
    if (qualifiers[index]!.start_byte < qualifiers[index - 1]!.end_byte) throw new Error(`${label} contains duplicate or overlapping qualifier boundaries.`);
  }
  return { qualifiers, repaired };
}

/** Parse the required hypothesis of a v2 NOVEL span; parameter hints must lie inside the span. */
export function parseHypothesis(value: unknown, ability: CurrentAbility, start: number, end: number, label: string): ParsedHypothesis {
  const hypothesis = asRecord(value, label);
  assertExactKeys(hypothesis, label, ["label", "distinction", "parameters"]);
  if (!Array.isArray(hypothesis.parameters)) throw new TypeError(`${label}.parameters must be an array.`);
  const names = new Set<string>();
  const parameters = hypothesis.parameters.map((item, index) => {
    const parameter = asRecord(item, `${label}.parameters[${index}]`);
    assertExactKeys(parameter, `${label}.parameters[${index}]`, ["name", "start_byte", "end_byte", "exact_text"]);
    const name = nonblank(parameter.name, `${label}.parameters[${index}].name`);
    if (!PARAMETER_NAME.test(name)) throw new TypeError(`${label}.parameters[${index}].name must match ${PARAMETER_NAME}.`);
    if (names.has(name)) throw new Error(`${label}.parameters repeats ${name}.`);
    names.add(name);
    const anchored = anchorExactText(
      ability.source_text,
      nonnegativeInteger(parameter.start_byte, `${label}.parameters[${index}].start_byte`),
      nonnegativeInteger(parameter.end_byte, `${label}.parameters[${index}].end_byte`),
      nonblank(parameter.exact_text, `${label}.parameters[${index}].exact_text`),
      `${label}.parameters[${index}]`,
      { start, end },
    );
    return { name, start_byte: anchored.start_byte, end_byte: anchored.end_byte };
  });
  return {
    label: nonblank(hypothesis.label, `${label}.label`),
    distinction: nonblank(hypothesis.distinction, `${label}.distinction`),
    parameters,
  };
}

/**
 * Parse one ability's `structural_spans`. A span with `parent_span_index` must lie wholly
 * inside one qualifier span of that (non-UNRESOLVED) semantic span; such a span is the only
 * permitted semantic/structural overlap.
 */
export function parseStructuralSpans(
  value: unknown,
  ability: CurrentAbility,
  fragments: readonly Fragment[],
  spans: readonly ParsedSemanticSpan[],
  label: string,
): ParsedStructural[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const parsed = value.map((item, index): ParsedStructural => {
    const itemLabel = `${label}[${index}]`;
    const structural = asRecord(item, itemLabel);
    assertExactKeys(structural, itemLabel, ["start_byte", "end_byte", "exact_text", "kind", "description"], ["parent_span_index"]);
    const exactText = nonblank(structural.exact_text, `${itemLabel}.exact_text`);
    const anchored = anchorExactText(
      ability.source_text,
      nonnegativeInteger(structural.start_byte, `${itemLabel}.start_byte`),
      nonnegativeInteger(structural.end_byte, `${itemLabel}.end_byte`),
      exactText,
      itemLabel,
    );
    const startByte = anchored.start_byte;
    const endByte = anchored.end_byte;
    const kind = nonblank(structural.kind, `${itemLabel}.kind`);
    if (!(STRUCTURAL_KINDS as readonly string[]).includes(kind)) throw new TypeError(`${itemLabel}.kind is not a structural kind.`);
    let parent: ParsedSemanticSpan | null = null;
    if (structural.parent_span_index !== undefined) {
      const parentIndex = nonnegativeInteger(structural.parent_span_index, `${itemLabel}.parent_span_index`);
      parent = spans.find((span) => span.index === parentIndex) ?? null;
      if (!parent) throw new RangeError(`${itemLabel}.parent_span_index does not name a span of this ability.`);
      if (parent.status === "UNRESOLVED") throw new Error(`${itemLabel} cannot be contained by an UNRESOLVED span.`);
      if (!parent.qualifier_spans.some((qualifier) => startByte >= qualifier.start_byte && endByte <= qualifier.end_byte)) {
        throw new RangeError(`${itemLabel} must lie wholly inside one qualifier_span of its parent span.`);
      }
    }
    return {
      kind: "structural",
      ability,
      fragment: fragmentFor(fragments, startByte, endByte),
      start_byte: startByte,
      end_byte: endByte,
      exact_text: exactText,
      structural_kind: kind as StructuralKind,
      description: nonblank(structural.description, `${itemLabel}.description`),
      parent,
      offset_repaired: anchored.repaired,
    };
  });
  const ordered = parsed.slice().sort((left, right) => left.start_byte - right.start_byte || left.end_byte - right.end_byte);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.start_byte < ordered[index - 1]!.end_byte) {
      throw new Error(`${label} contains duplicate or overlapping structural spans for ${ability.faction_id}/${ability.ability_id}.`);
    }
  }
  return parsed;
}
