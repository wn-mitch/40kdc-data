import { exactSpan, type LeafRole } from "./contracts.js";
import type { StructuralKind } from "./schema-ext.js";

/**
 * Strict JSON-shape and source-byte validators shared by every Luna response version. Each
 * throws on the first violation so an import is all-or-nothing.
 */

export type JsonRecord = Record<string, unknown>;

export type Fragment = {
  fragment: string;
  start_byte: number;
  end_byte: number;
  text: string;
};

export type CurrentAbility = {
  id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  source_text: string;
  fragments_json: string;
  /** `abilities.source_type` (stratagem/unit/enhancement/detachment/faction/core), for kind-scoping. */
  source_type: string;
};

export type ParsedQualifier = { start_byte: number; end_byte: number };

export type ParsedSemanticSpan = {
  kind: "semantic";
  ability: CurrentAbility;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  reported_role: LeafRole | "UNRESOLVED";
  role: LeafRole | "UNRESOLVED";
  status: "EXISTING" | "NOVEL" | "UNRESOLVED";
  fingerprint_id: string | null;
  qualifier_spans: ParsedQualifier[];
  description: string | null;
  /** Required on v2 NOVEL spans; metadata only, never a competing coverage interval. */
  hypothesis: ParsedHypothesis | null;
  /** This span's index in its ability's response `spans`, for structural parent links. */
  index: number;
  /** True when a v2 offset was re-anchored to its exact text; recorded for review. */
  offset_repaired: boolean;
};

export type ParsedHypothesis = {
  label: string;
  distinction: string;
  parameters: Array<{ name: string; start_byte: number; end_byte: number }>;
};

export type ParsedStructural = {
  kind: "structural";
  ability: CurrentAbility;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  structural_kind: StructuralKind;
  description: string;
  /** The parent semantic span when this constituent is a reviewed qualifier inside it. */
  parent: ParsedSemanticSpan | null;
  offset_repaired: boolean;
};

export type ParsedConnective = {
  kind: "connective";
  ability: CurrentAbility;
  fragment: string;
  start_byte: number;
  end_byte: number;
  connective_kind: string;
  offset_repaired: boolean;
};

export type ParsedUnresolved = {
  kind: "unresolved";
  ability: CurrentAbility;
  fragment: string;
  start_byte: number;
  end_byte: number;
  description: string;
  implicit: boolean;
};

export type ParsedResponse = {
  model: string;
  model_version: string;
  prompt_version: string;
  latency_ms: number | null;
  cost_usd: number | null;
  version: 1 | 2;
  semantic_spans: ParsedSemanticSpan[];
  structural: ParsedStructural[];
  connectives: ParsedConnective[];
  unresolved: ParsedUnresolved[];
  /**
   * A span whose offsets/status/role parsed but whose classification (family, parameters,
   * hypothesis) failed validation. It still lands in `semantic_spans` as a synthetic UNRESOLVED
   * entry (so review and vocabulary tooling see it), but is counted here separately so an import
   * summary can report how many of a response's own labels the model got wrong versus how many
   * were genuinely novel or ambiguous.
   */
  rejected_spans: number;
  /**
   * A span that parsed and validated but landed on bytes the request's uncovered_regions no
   * longer claims (already covered by something else, or outside them entirely) by the time the
   * response was checked. Silently dropped, not an error and not an unresolved gap — the bytes
   * are already accounted for.
   */
  dropped_covered_spans: number;
};

export function asRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as JsonRecord;
}

export function assertExactKeys(value: JsonRecord, label: string, required: readonly string[], optional: readonly string[] = []): void {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required.`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label}.${key} is not allowed by the response schema.`);
  }
}

export function nonblank(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value !== value.trim()) throw new TypeError(`${label} must be a nonblank, trimmed string.`);
  return value;
}

export function safeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer.`);
  return value;
}

export function nonnegativeInteger(value: unknown, label: string): number {
  const result = safeInteger(value, label);
  if (result < 0) throw new RangeError(`${label} must be non-negative.`);
  return result;
}

export function positiveFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a non-negative finite number.`);
  return value;
}

export function parseFragments(value: unknown, source: string, label: string): Fragment[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const fragments = value.map((item, index) => {
    const fragment = asRecord(item, `${label}[${index}]`);
    assertExactKeys(fragment, `${label}[${index}]`, ["fragment", "start_byte", "end_byte", "text"]);
    const parsed: Fragment = {
      fragment: nonblank(fragment.fragment, `${label}[${index}].fragment`),
      start_byte: nonnegativeInteger(fragment.start_byte, `${label}[${index}].start_byte`),
      end_byte: nonnegativeInteger(fragment.end_byte, `${label}[${index}].end_byte`),
      text: nonblank(fragment.text, `${label}[${index}].text`),
    };
    if (parsed.end_byte <= parsed.start_byte || exactSpan(source, parsed.start_byte, parsed.end_byte) !== parsed.text) {
      throw new Error(`${label}[${index}] does not match the persisted source bytes.`);
    }
    return parsed;
  });
  return fragments.sort((left, right) => left.start_byte - right.start_byte || left.end_byte - right.end_byte);
}

export function fragmentFor(fragments: readonly Fragment[], start: number, end: number): string {
  const match = fragments.find((fragment) => start >= fragment.start_byte && end <= fragment.end_byte);
  if (!match) throw new RangeError("A Luna region must be wholly contained in one declared source fragment.");
  return match.fragment;
}


export function parseQualifiers(value: unknown, ability: CurrentAbility, fragments: readonly Fragment[], start: number, end: number, label: string): ParsedQualifier[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const qualifiers = value.map((value, index) => {
    const item = asRecord(value, `${label}[${index}]`);
    assertExactKeys(item, `${label}[${index}]`, ["start_byte", "end_byte"]);
    const startByte = nonnegativeInteger(item.start_byte, `${label}[${index}].start_byte`);
    const endByte = nonnegativeInteger(item.end_byte, `${label}[${index}].end_byte`);
    if (endByte <= startByte || startByte < start || endByte > end) {
      throw new RangeError(`${label}[${index}] must be a non-empty containment within its semantic span.`);
    }
    exactSpan(ability.source_text, startByte, endByte);
    fragmentFor(fragments, startByte, endByte);
    return { start_byte: startByte, end_byte: endByte };
  }).sort((left, right) => left.start_byte - right.start_byte || left.end_byte - right.end_byte);
  for (let index = 1; index < qualifiers.length; index += 1) {
    if (qualifiers[index]!.start_byte < qualifiers[index - 1]!.end_byte) {
      throw new Error(`${label} contains duplicate or overlapping qualifier boundaries.`);
    }
  }
  return qualifiers;
}
