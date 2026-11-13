/**
 * The BSData JSON format as a per-node-kind descriptor: which keys each node
 * kind carries, which it always carries, and the JSON type of each. The
 * committed descriptor (`format.json`) is derived from a BSData checkout by
 * `deriveFormat`; `formatViolations` checks an exported document against it.
 */
import { CONTAINER_KIND, isNode, type BsNode } from "./source.js";

export interface KindFormat {
  /** Nodes of this kind in the source corpus; `required` is enforced only when more than one was seen. */
  readonly count: number;
  /** Keys present on every node of this kind. */
  readonly required: readonly string[];
  /** Keys present on some nodes of this kind. */
  readonly optional: readonly string[];
  /** Observed JSON type per key: `string`, `number`, `boolean`, `array<kind>`, or a `|` union. */
  readonly types: Readonly<Record<string, string>>;
}

export type FormatDescriptor = Readonly<Record<string, KindFormat>>;

function jsonType(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    const kind = CONTAINER_KIND[key];
    return kind ? `array<${kind}>` : `array<${typeof value[0]}>`;
  }
  return value === null ? "null" : typeof value;
}

function* nodesWithKind(node: BsNode, kind: string): Generator<[BsNode, string]> {
  yield [node, kind];
  for (const [key, value] of Object.entries(node)) {
    const childKind = CONTAINER_KIND[key];
    if (!childKind || !Array.isArray(value)) continue;
    for (const item of value) if (isNode(item)) yield* nodesWithKind(item, childKind);
  }
}

/** Derives the descriptor from documents given as `[rootKind, rootNode]` pairs. */
export function deriveFormat(roots: readonly (readonly [string, BsNode])[]): FormatDescriptor {
  const counts = new Map<string, number>();
  const keyCounts = new Map<string, Map<string, number>>();
  const keyTypes = new Map<string, Map<string, Set<string>>>();
  for (const [rootKind, root] of roots) {
    for (const [node, kind] of nodesWithKind(root, rootKind)) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      const kc = keyCounts.get(kind) ?? new Map<string, number>();
      const kt = keyTypes.get(kind) ?? new Map<string, Set<string>>();
      keyCounts.set(kind, kc);
      keyTypes.set(kind, kt);
      for (const [key, value] of Object.entries(node)) {
        kc.set(key, (kc.get(key) ?? 0) + 1);
        const types = kt.get(key) ?? new Set<string>();
        types.add(jsonType(key, value));
        kt.set(key, types);
      }
    }
  }
  const out: Record<string, KindFormat> = {};
  for (const kind of [...counts.keys()].sort()) {
    const total = counts.get(kind)!;
    const kc = keyCounts.get(kind)!;
    const keys = [...kc.keys()].sort();
    out[kind] = {
      count: total,
      required: keys.filter((key) => kc.get(key) === total),
      optional: keys.filter((key) => kc.get(key) !== total),
      types: Object.fromEntries(
        keys.map((key) => [key, [...keyTypes.get(kind)!.get(key)!].sort().join("|")]),
      ),
    };
  }
  return out;
}

/** The key order every BSData JSON object follows: name, id, scalars, then arrays, each sorted. */
export function canonicalKeyOrder(node: BsNode): string[] {
  const keys = Object.keys(node);
  const head = ["name", "id"].filter((key) => keys.includes(key));
  const rest = keys.filter((key) => key !== "name" && key !== "id");
  const scalars = rest.filter((key) => !Array.isArray(node[key])).sort();
  const arrays = rest.filter((key) => Array.isArray(node[key])).sort();
  return [...head, ...scalars, ...arrays];
}

/**
 * Lists every way a document departs from the descriptor: an unknown node kind,
 * a key the kind never carries, a missing always-present key, a value of an
 * unobserved type, a `null` or empty array, or keys out of canonical order.
 * Each violation names the JSON path of the node.
 */
export function formatViolations(rootKind: string, root: BsNode, format: FormatDescriptor): string[] {
  const violations: string[] = [];
  const visit = (node: BsNode, kind: string, at: string): void => {
    const spec = format[kind];
    if (!spec) {
      violations.push(`${at}: unknown node kind ${kind}`);
      return;
    }
    const keys = Object.keys(node);
    for (const key of spec.count > 1 ? spec.required : []) {
      if (!keys.includes(key)) violations.push(`${at}: ${kind} lacks required "${key}"`);
    }
    for (const key of keys) {
      const value = node[key];
      const allowed = spec.types[key];
      if (allowed === undefined) {
        violations.push(`${at}: ${kind} never carries "${key}"`);
        continue;
      }
      if (value === null) violations.push(`${at}.${key}: null`);
      else if (Array.isArray(value) && value.length === 0) violations.push(`${at}.${key}: empty array`);
      else if (!allowed.split("|").includes(jsonType(key, value))) {
        violations.push(`${at}.${key}: ${jsonType(key, value)} where BSData has ${allowed}`);
      }
    }
    const order = canonicalKeyOrder(node);
    if (order.join(",") !== keys.join(",")) violations.push(`${at}: key order ${keys.join(",")}`);
    for (const [key, value] of Object.entries(node)) {
      const childKind = CONTAINER_KIND[key];
      if (!childKind || !Array.isArray(value)) continue;
      value.forEach((item, index) => {
        if (isNode(item)) visit(item, childKind, `${at}.${key}[${index}]`);
      });
    }
  };
  visit(root, rootKind, rootKind);
  return violations;
}
