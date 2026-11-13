/** JSON writers for the exporter's committed maps and its BSData documents. */
import { canonicalKeyOrder } from "./format.js";
import { isNode, type BsNode } from "./source.js";

/** Two-space JSON with a trailing newline, keys in insertion order. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder);
  if (!isNode(value)) return value;
  const node = value as BsNode;
  const out: BsNode = {};
  for (const key of canonicalKeyOrder(node)) out[key] = reorder(node[key]);
  return out;
}

/**
 * A BSData document as the NewRecruit editor writes it: every object's keys in
 * `name`, `id`, sorted scalars, sorted arrays order; two-space indent; raw
 * UTF-8; trailing newline.
 */
export function bsdataJson(document: BsNode): string {
  return `${JSON.stringify(reorder(document), null, 2)}\n`;
}
