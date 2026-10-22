import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The Ability DSL schemas name shared vocabularies (stats, moves, tests, comparisons,
 * owners, snapshots) by `$ref` to common.schema.json, never by an inline enum copy: a copy
 * drifts the next time the shared list gains or renames a value.
 */

const schemas = resolve(dirname(fileURLToPath(import.meta.url)), "../../schemas");
const read = (path: string): unknown => JSON.parse(readFileSync(resolve(schemas, path), "utf8"));
const common = (read("$defs/common.schema.json") as { $defs: Record<string, { enum?: string[] }> }).$defs;
const SHARED = ["stat", "movement-kind", "test-kind", "comparison", "owner", "snapshot"] as const;
const DSL = [
  "enrichment/ability-dsl/effect.schema.json",
  "enrichment/ability-dsl/condition.schema.json",
  "enrichment/ability-dsl/ability.schema.json",
  "enrichment/ability-dsl/scope.schema.json",
];
// Branches that narrow an already-typed property, rather than define one.
const CONSTRAINT = new Set(["anyOf", "allOf", "if", "then", "else", "not"]);

function inlineCopies(node: unknown, path: string[], out: string[]): void {
  if (Array.isArray(node)) node.forEach((item, index) => inlineCopies(item, [...path, String(index)], out));
  if (node === null || typeof node !== "object" || Array.isArray(node)) return;
  const record = node as Record<string, unknown>;
  if (Array.isArray(record.enum) && record.enum.length >= 2 && !path.some((key) => CONSTRAINT.has(key))) {
    for (const name of SHARED) {
      const shared = common[name].enum ?? [];
      if (record.enum.every((value) => shared.includes(value as string))) out.push(`${path.join("/")} copies ${name}`);
    }
  }
  for (const [key, value] of Object.entries(record)) inlineCopies(value, [...path, key], out);
}

describe("DSL shared vocabularies", () => {
  it("has no inline enum that copies a common.schema.json vocabulary", () => {
    const copies: string[] = [];
    for (const file of DSL) inlineCopies(read(file), [file], copies);
    expect(copies).toEqual([]);
  });

  it("spells the Normal-move roll as its movement kind", () => {
    const rollKinds = (common["roll-kind"] as { oneOf: Array<{ enum?: string[] }> }).oneOf[0].enum ?? [];
    expect(rollKinds).toContain("normal");
    expect(rollKinds).not.toContain("normal-move");
  });
});
