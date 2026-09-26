import { normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY, type SemanticFamilyDefinition } from "./contracts.js";
import { hashJson } from "../round4/hash.js";
import { previewLeaf } from "./leaf-preview.js";

/**
 * How well the describer tells leaves apart. Every current family is rendered for each closed
 * combination of its parameters (open values use a few samples), and the report names:
 *
 * - unrendered: a parameter whose value never changes the text, so the reader cannot see it;
 * - collisions: two values of one parameter that read the same with everything else equal;
 * - problems: valid parameters the describer or compiler cannot render at all.
 *
 * Leaves with no text of their own (attacks without a melee/ranged limit, combinators, the
 * selected unit) are listed as silent rather than audited, since their words live elsewhere.
 */

type Schema = {
  enum?: readonly unknown[]; anyOf?: Schema[]; type?: string; minimum?: number; maximum?: number;
  items?: Schema; pattern?: string; "x-only-when"?: Record<string, readonly string[]>;
};

export type FamilyAudit = {
  family_id: string;
  version: number;
  combinations: number;
  silent: number;
  unrendered: string[];
  collisions: Array<{ parameter: string; values: [unknown, unknown]; text: string }>;
  problems: Array<{ parameters: Record<string, unknown>; problem: string }>;
};

/** Values to try for one parameter: every listed value, or samples of an open one. */
function domain(name: string, schema: Schema): unknown[] {
  if (schema.enum) return [...schema.enum];
  if (schema.type === "boolean") return [false, true];
  if (schema.type === "array") {
    if (schema.items?.enum) return [...schema.items.enum.map((value) => [value]), schema.items.enum.slice(0, 2)];
    return [["CHARACTER"], ["MONSTER", "VEHICLE"]];
  }
  if (schema.anyOf) {
    const listed = schema.anyOf.flatMap((item) => item.enum ?? []);
    if (listed.length) return listed.filter((value) => value !== "source");
    if (schema.anyOf.some((item) => item.pattern)) return ["Lethal Hits", "Sustained Hits 1"];
    if (schema.anyOf.some((item) => item.type === "integer")) return name === "threshold" ? [4, 5] : [1, 2];
  }
  if (schema.type === "integer") {
    const low = schema.minimum ?? 1;
    return name === "threshold" ? [4, 5] : name === "inches" ? [6, 12] : [low, low + 1];
  }
  return [];
}

function applies(schema: Schema, parameters: Record<string, unknown>): boolean {
  return !schema["x-only-when"] || Object.entries(schema["x-only-when"]).every(([key, values]) => values.includes(String(parameters[key])));
}

/** Every valid parameter set: a product over the parameters that apply, given earlier choices. */
function combinations(family: SemanticFamilyDefinition): Record<string, unknown>[] {
  const properties = Object.entries((family.parameterSchema.properties ?? {}) as Record<string, Schema>);
  // Parameters that others depend on come first, so x-only-when sees their value.
  properties.sort(([, left], [, right]) => Number(Boolean(left["x-only-when"])) - Number(Boolean(right["x-only-when"])));
  let sets: Record<string, unknown>[] = [{}];
  for (const [name, schema] of properties) {
    sets = sets.flatMap((set) => applies(schema, set) ? domain(name, schema).map((value) => ({ ...set, [name]: value })) : [set]);
  }
  const valid = new Map<string, Record<string, unknown>>();
  for (const set of sets) {
    try {
      const normalized = normalizeFingerprintParameters(family.id, set, family.version);
      valid.set(hashJson(normalized), normalized);
    } catch {
      // Combinations the family refuses (a target-only position on this unit) are not leaves.
    }
  }
  return [...valid.values()];
}

const SILENT = /^No separate text:/u;

export function auditFamily(family: SemanticFamilyDefinition): FamilyAudit {
  const report: FamilyAudit = { family_id: family.id, version: family.version, combinations: 0, silent: 0, unrendered: [], collisions: [], problems: [] };
  const rendered: Array<{ parameters: Record<string, unknown>; text: string }> = [];
  for (const parameters of combinations(family)) {
    report.combinations += 1;
    const preview = previewLeaf({ family_id: family.id, family_version: family.version, parameters });
    if (preview.problem !== null || preview.text === null) report.problems.push({ parameters, problem: preview.problem ?? "No text." });
    else if (SILENT.test(preview.text)) report.silent += 1;
    else rendered.push({ parameters, text: preview.text });
  }
  const names = [...new Set(rendered.flatMap((item) => Object.keys(item.parameters)))];
  for (const name of names) {
    // Leaves that differ only in this parameter share a key made of all the others.
    const buckets = new Map<string, Array<{ value: unknown; text: string }>>();
    for (const item of rendered) {
      if (!(name in item.parameters)) continue;
      const { [name]: value, ...others } = item.parameters;
      const key = hashJson(others);
      buckets.set(key, [...(buckets.get(key) ?? []), { value, text: item.text }]);
    }
    let varied = false;
    let changed = false;
    const seen = new Set<string>();
    const collisions: FamilyAudit["collisions"] = [];
    for (const bucket of buckets.values()) {
      for (const [index, left] of bucket.entries()) {
        for (const right of bucket.slice(index + 1)) {
          varied = true;
          if (left.text !== right.text) {
            changed = true;
            continue;
          }
          const pair = [left.value, right.value] as [unknown, unknown];
          const key = JSON.stringify([pair, left.text]);
          if (!seen.has(key)) {
            seen.add(key);
            collisions.push({ parameter: name, values: pair, text: left.text });
          }
        }
      }
    }
    if (varied && !changed) report.unrendered.push(name);
    else report.collisions.push(...collisions);
  }
  return report;
}

let cached: FamilyAudit[] | null = null;

/** The audit of every current family; computed once per process, since it depends only on code. */
export function leafDescriberAudit(): FamilyAudit[] {
  cached ??= REVIEWED_FAMILY_REGISTRY.filter((family) => !family.deprecated).map(auditFamily);
  return cached;
}

/** What a reviewer should know about one leaf's English: which of its values the text hides. */
export function describerGaps(familyId: string, parameters: Record<string, unknown>): string[] {
  const audit = leafDescriberAudit().find((item) => item.family_id === familyId);
  if (!audit) return [];
  const gaps = new Set(audit.unrendered.filter((name) => name in parameters).map((name) => `The English never shows ${name.replaceAll("_", " ")}.`));
  for (const collision of audit.collisions) {
    if (!(collision.parameter in parameters)) continue;
    if (collision.values.some((value) => hashJson(value) === hashJson(parameters[collision.parameter]))) {
      gaps.add(`The English reads the same for ${collision.parameter.replaceAll("_", " ")} ${collision.values.map((value) => JSON.stringify(value)).join(" and ")}.`);
    }
  }
  return [...gaps];
}
