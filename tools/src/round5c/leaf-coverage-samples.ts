/**
 * Parameter combinations the leaf-coverage sweep compiles for each family: the full product over
 * each parameter's domain, or a bounded sample (required fields plus one optional property at a
 * time) for families whose full product is too large.
 */

import { normalizeFingerprintParameters, type SemanticFamilyDefinition } from "./contracts.js";

type Schema = {
  enum?: readonly unknown[]; anyOf?: Schema[]; oneOf?: Schema[]; type?: string; minimum?: number; maximum?: number;
  items?: Schema; pattern?: string; const?: unknown; required?: string[]; "x-only-when"?: Record<string, readonly string[]>;
};

/** A handful of representative strings, tried against a `pattern` until one matches it. */
const PATTERN_CANDIDATES = ["test-id", "test-unit", "test-rule", "TEST KEYWORD", "Test Ability", "Lethal Hits", "Sustained Hits 1", "test"];

function sampleForPattern(pattern: string | undefined): string | undefined {
  if (!pattern) return undefined;
  const re = new RegExp(pattern.startsWith("^") ? pattern : `^(?:${pattern})$`, "u");
  return PATTERN_CANDIDATES.find((candidate) => re.test(candidate));
}

const isConcrete = (value: unknown): boolean => value !== "" && value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0);

/**
 * Values to try for one parameter: every listed value, a couple of samples of an open one, or (for
 * a shape none of that structurally covers) the family's own `starter` example for this property,
 * when it is concrete rather than a placeholder.
 */
function domain(name: string, schema: Schema, starter: Record<string, unknown> | undefined): unknown[] {
  if (schema.const !== undefined) return [schema.const];
  if (schema.enum) return [...schema.enum];
  if (schema.type === "boolean") return [false, true];
  if (schema.type === "array") {
    if (schema.items?.enum) return [...schema.items.enum.map((value) => [value]), schema.items.enum.slice(0, 2)];
    const sample = sampleForPattern(schema.items?.pattern);
    if (sample) return [[sample]];
    if (starter && name in starter && isConcrete(starter[name])) return [starter[name]];
    return [["CHARACTER"]];
  }
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches) {
    const values: unknown[] = [];
    const listed = branches.flatMap((item) => item.enum ?? []);
    values.push(...listed.filter((value) => value !== "source"));
    const patterned = branches.map((item) => sampleForPattern(item.pattern)).find((value) => value !== undefined);
    if (patterned) values.push(patterned);
    if (branches.some((item) => item.type === "integer")) values.push(...(name === "threshold" ? [4, 5] : [1, 2]));
    // An object branch closed to one const-valued shape (buff-families.ts's abilityRatingSchema:
    // `{rating: true}`, the "or rated instead of numbered" alternative on a cap/value field).
    for (const branch of branches) {
      if (branch.type !== "object" || !branch.required) continue;
      const properties = ((branch as { properties?: Record<string, { const?: unknown }> }).properties) ?? {};
      if (branch.required.every((key) => "const" in (properties[key] ?? {}))) {
        values.push(Object.fromEntries(branch.required.map((key) => [key, properties[key]!.const])));
      }
    }
    if (values.length) return values;
    if (starter && name in starter && isConcrete(starter[name])) return [starter[name]];
    return [];
  }
  if (schema.type === "integer") {
    const low = schema.minimum ?? 1;
    // A few hand-validated fields (stratagem-cost's amount, a "multiply" needs at least 2) impose a
    // tighter minimum than the schema states; a wider sample catches those without naming each one.
    return name === "threshold" ? [4, 5] : name === "inches" ? [6, 12] : [low, low + 1, low + 2, low + 3];
  }
  if (schema.type === "string") {
    const sample = sampleForPattern(schema.pattern);
    if (sample) return [sample];
    if (starter && name in starter && isConcrete(starter[name])) return [starter[name]];
    // No pattern is visible at the schema level (some families validate a string's shape by hand,
    // e.g. rule-state's rule_kind-dependent slug/keyword check), so try several plain shapes and
    // let normalizeFingerprintParameters keep whichever the family actually accepts.
    return [...PATTERN_CANDIDATES, "Test Value"];
  }
  if (schema.type === "object") {
    if (!schema.required || schema.required.length === 0) return [{}];
    if (starter && name in starter && isConcrete(starter[name])) return [starter[name]];
    return [];
  }
  if (starter && name in starter && isConcrete(starter[name])) return [starter[name]];
  return [];
}

function appliesGiven(schema: Schema, parameters: Record<string, unknown>): boolean {
  return !schema["x-only-when"] || Object.entries(schema["x-only-when"]).every(([key, values]) => values.includes(String(parameters[key])));
}

/**
 * Every valid parameter set for one family: a product over the parameters that apply, given
 * earlier choices, with invalid combinations dropped by `normalizeFingerprintParameters`. In the
 * same spirit as `leaf-describer-audit.ts`'s own `combinations()`, widened (see `domain` above)
 * so a family with a `oneOf`-, pattern-, or nested-object-shaped property still yields at least
 * one combination rather than zero.
 */
export function familyCombinations(family: SemanticFamilyDefinition): Record<string, unknown>[] {
  const properties = Object.entries((family.parameterSchema.properties ?? {}) as Record<string, Schema>);
  properties.sort(([, left], [, right]) => Number(Boolean(left["x-only-when"])) - Number(Boolean(right["x-only-when"])));
  let sets: Record<string, unknown>[] = [{}];
  for (const [name, schema] of properties) {
    sets = sets.flatMap((set) => appliesGiven(schema, set) ? domain(name, schema, family.starter).map((value) => ({ ...set, [name]: value })) : [set]);
  }
  const valid = new Map<string, Record<string, unknown>>();
  for (const set of sets) {
    try {
      const normalized = normalizeFingerprintParameters(family.id, set, family.version);
      valid.set(JSON.stringify(normalized), normalized);
    } catch {
      // Combinations the family refuses are not leaves; skip them the same way the audit does.
    }
  }
  return [...valid.values()];
}

/** See `BOUNDED_SAMPLE_FAMILIES`: a baseline plus one property-at-a-time variant, instead of the full product. */
export function boundedCombinations(family: SemanticFamilyDefinition): Record<string, unknown>[] {
  const properties = Object.entries((family.parameterSchema.properties ?? {}) as Record<string, Schema>);
  properties.sort(([, left], [, right]) => Number(Boolean(left["x-only-when"])) - Number(Boolean(right["x-only-when"])));
  const baseline: Record<string, unknown> = {};
  for (const [name, schema] of properties) {
    if (!appliesGiven(schema, baseline)) continue;
    const values = domain(name, schema, family.starter);
    if (values.length) baseline[name] = values[0];
  }
  const sets: Record<string, unknown>[] = [baseline];
  for (const [name, schema] of properties) {
    if (!appliesGiven(schema, baseline)) continue;
    for (const value of domain(name, schema, family.starter).slice(0, 3)) sets.push({ ...baseline, [name]: value });
  }
  const valid = new Map<string, Record<string, unknown>>();
  for (const set of sets) {
    try {
      const normalized = normalizeFingerprintParameters(family.id, set, family.version);
      valid.set(JSON.stringify(normalized), normalized);
    } catch {
      // Combinations the family refuses are not leaves; skip them the same way the audit does.
    }
  }
  return [...valid.values()];
}
