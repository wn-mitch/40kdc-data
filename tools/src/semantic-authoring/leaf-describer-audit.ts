import { normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY, type SemanticFamilyDefinition } from "./contracts.js";
import { hashJson } from "../round4/hash.js";
import { previewLeaf } from "./leaf-preview.js";
import {
  boundedCombinations, familySampling, STRUCTURED_FILTER_ALTERNATIVE_SAMPLES, type FamilySampling,
} from "./leaf-coverage-samples.js";

/**
 * How well the describer tells leaves apart. Small families are rendered for each closed
 * combination of their parameters (open values use a few samples). High-dimensional families use
 * the pairwise samples documented in leaf-coverage-samples.ts, and their reports say so rather
 * than presenting sampled observations as exhaustive.
 *
 * The report names:
 * - unrendered: a parameter whose sampled values never change the text;
 * - collisions: two values of one parameter that read the same in a representative shared context;
 * - problems: sampled valid parameters the describer or compiler cannot render at all.
 *
 * Leaves with no text of their own (attacks without a melee/ranged limit, combinators, the
 * selected unit) are listed as silent rather than audited, since their words live elsewhere.
 */

type Schema = {
  enum?: readonly unknown[]; anyOf?: Schema[]; type?: string; minimum?: number; maximum?: number;
  items?: Schema; properties?: Record<string, Schema>; pattern?: string; const?: unknown; "x-only-when"?: Record<string, readonly string[]>; "x-optional"?: true;
};

export type FamilyAudit = {
  family_id: string;
  version: number;
  sampling: FamilySampling;
  combinations: number;
  silent: number;
  unrendered: string[];
  collisions: Array<{ parameter: string; values: [unknown, unknown]; text: string }>;
  problems: Array<{ parameters: Record<string, unknown>; problem: string }>;
};

/** Values to try for one parameter: every listed value, or samples of an open one. */
function domain(name: string, schema: Schema): unknown[] {
  // A fixed-value marker (an optional flag whose only legal value is true) has one value to try.
  if (schema.const !== undefined) return [schema.const];
  if (schema.enum) return [...schema.enum];
  if (schema.type === "boolean") return [false, true];
  if (schema.type === "array") {
    if (schema.items?.enum) return [...schema.items.enum.map((value) => [value]), schema.items.enum.slice(0, 2)];
    // Keep Cartesian sampling aligned with the pairwise sampler's valid OR-of-conjunction arrays.
    if (schema.items?.properties?.keywords && schema.items.properties.states) {
      return STRUCTURED_FILTER_ALTERNATIVE_SAMPLES.map((alternatives) => alternatives.map((alternative) => ({ ...alternative })));
    }
    return [["CHARACTER"], ["MONSTER", "VEHICLE"]];
  }
  if (schema.anyOf) {
    const listed = schema.anyOf.flatMap((item) => item.enum ?? []);
    if (listed.length) return listed.filter((value) => value !== "source");
    const numbers = schema.anyOf.some((item) => item.type === "integer") ? (name === "threshold" ? [4, 5] : [1, 2]) : [];
    // A number-or-dice amount (characteristic-modifier's value) samples both; the family keeps what it accepts.
    if (schema.anyOf.some((item) => item.pattern)) return [...numbers, ...(numbers.length ? ["D3"] : ["Lethal Hits", "Sustained Hits 1"])];
    if (numbers.length) return numbers;
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

/** Every sampled parameter set in a family's Cartesian sweep. */
function combinations(family: SemanticFamilyDefinition): Record<string, unknown>[] {
  const properties = Object.entries((family.parameterSchema.properties ?? {}) as Record<string, Schema>);
  // Parameters that others depend on come first, so x-only-when sees their value.
  properties.sort(([, left], [, right]) => Number(Boolean(left["x-only-when"])) - Number(Boolean(right["x-only-when"])));
  let sets: Record<string, unknown>[] = [{}];
  for (const [name, schema] of properties) {
    // An optional parameter (`x-optional`) is also tried absent.
    sets = sets.flatMap((set) => applies(schema, set)
      ? [...domain(name, schema).map((value) => ({ ...set, [name]: value })), ...(schema["x-optional"] ? [set] : [])]
      : [set]);
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
  const sampling = familySampling(family);
  const report: FamilyAudit = {
    family_id: family.id,
    version: family.version,
    sampling,
    combinations: 0,
    silent: 0,
    unrendered: [],
    collisions: [],
    problems: [],
  };
  const rendered: Array<{ parameters: Record<string, unknown>; text: string }> = [];
  const parameterSets = sampling === "pairwise" ? boundedCombinations(family) : combinations(family);
  for (const parameters of parameterSets) {
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
      const bucket = buckets.get(key);
      if (bucket) bucket.push({ value, text: item.text });
      else buckets.set(key, [{ value, text: item.text }]);
    }
    let varied = false;
    let changed = false;
    const seen = new Set<string>();
    const collisions: FamilyAudit["collisions"] = [];
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;
      varied = true;
      const byText = new Map<string, Array<{ value: unknown; text: string }>>();
      for (const item of bucket) {
        const sameText = byText.get(item.text);
        if (sameText) sameText.push(item);
        else byText.set(item.text, [item]);
      }
      if (byText.size > 1) changed = true;
      for (const sameText of byText.values()) {
        if (sameText.length < 2) continue;
        const anchor = sameText[0]!;
        for (let index = 1; index < sameText.length; index += 1) {
          const pair = [anchor.value, sameText[index]!.value] as [unknown, unknown];
          const key = hashJson(pair);
          if (seen.has(key)) continue;
          seen.add(key);
          collisions.push({ parameter: name, values: pair, text: anchor.text });
        }
      }
    }
    if (varied && !changed) report.unrendered.push(name);
    else report.collisions.push(...collisions);
  }
  return report;
}

const audits = new Map<SemanticFamilyDefinition, FamilyAudit>();

/**
 * One family's audit, computed once per process, since it depends only on code. Wide parameter
 * domains use bounded pairwise sampling; caching also prevents repeated Leaves/API calls from
 * re-rendering the same observations.
 */
function cachedAudit(family: SemanticFamilyDefinition): FamilyAudit {
  let audit = audits.get(family);
  if (!audit) {
    audit = auditFamily(family);
    audits.set(family, audit);
  }
  return audit;
}

/** The audit of every current family. */
export function leafDescriberAudit(): FamilyAudit[] {
  return REVIEWED_FAMILY_REGISTRY.filter((family) => !family.deprecated).map(cachedAudit);
}

/** What a reviewer should know about one leaf's English: which of its values the text hides. */
export function describerGaps(familyId: string, parameters: Record<string, unknown>): string[] {
  const family = REVIEWED_FAMILY_REGISTRY.find((item) => !item.deprecated && item.id === familyId);
  if (!family) return [];
  const audit = cachedAudit(family);
  const hiddenPrefix = audit.sampling === "pairwise" ? "The sampled English never shows" : "The English never shows";
  const gaps = new Set(audit.unrendered.filter((name) => name in parameters).map((name) => `${hiddenPrefix} ${name.replaceAll("_", " ")}.`));
  for (const collision of audit.collisions) {
    if (!(collision.parameter in parameters)) continue;
    if (collision.values.some((value) => hashJson(value) === hashJson(parameters[collision.parameter]))) {
      gaps.add(`The English reads the same for ${collision.parameter.replaceAll("_", " ")} ${collision.values.map((value) => JSON.stringify(value)).join(" and ")}.`);
    }
  }
  return [...gaps];
}
