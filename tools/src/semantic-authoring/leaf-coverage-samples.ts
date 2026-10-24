/**
 * Parameter combinations used by the leaf-coverage sweep and the describer audit.
 *
 * Small families use their full sampled product. High-dimensional families use pairwise samples:
 * every declared value is retained, first by itself and then against every value of each other
 * parameter. Pairwise sampling catches value-specific and one-context interactions without
 * materializing products that now reach tens or hundreds of millions of objects. It is not
 * exhaustive for behavior that needs three or more optional parameters together; those authored
 * shapes remain the responsibility of their focused compiler tests.
 */

import { normalizeFingerprintParameters, type SemanticFamilyDefinition } from "./contracts.js";

type Schema = {
  enum?: readonly unknown[]; anyOf?: Schema[]; oneOf?: Schema[]; type?: string; minimum?: number; maximum?: number;
  items?: Schema; pattern?: string; examples?: unknown[]; const?: unknown; required?: string[]; properties?: Record<string, Schema>;
  "x-only-when"?: Record<string, readonly string[]>; "x-optional"?: true;
};

export type FamilySampling = "cartesian" | "pairwise";

/**
 * Families whose full sampled products are unsafe or disproportionate. In particular,
 * unit-filter@17 expands to hundreds of millions of describer candidates and unit-position@25 to
 * millions; their independent recipient/origin fields are the newly explosive domains. Event's
 * catalog-sized designation list and the expanded characteristic, roll, setup and activity
 * families also cross the practical boundary.
 */
const BOUNDED_SAMPLE_FAMILIES: Record<string, true> = {
  "characteristic-modifier": true,
  "event": true,
  "menu-action": true,
  "roll-modifier": true,
  "set-up": true,
  "test": true,
  "test-exemption": true,
  "unit-activity": true,
  "unit-filter": true,
  "unit-position": true,
};

export function familySampling(family: SemanticFamilyDefinition): FamilySampling {
  return Object.hasOwn(BOUNDED_SAMPLE_FAMILIES, family.id) ? "pairwise" : "cartesian";
}

/** A handful of representative strings, tried against a `pattern` until one matches it. */
const PATTERN_CANDIDATES = ["test-id", "test-unit", "test-rule", "TEST KEYWORD", "Test Ability", "Lethal Hits", "Sustained Hits 1", "test"];

function sampleForPattern(pattern: string | undefined): string | undefined {
  if (!pattern) return undefined;
  const re = new RegExp(pattern.startsWith("^") ? pattern : `^(?:${pattern})$`, "u");
  return PATTERN_CANDIDATES.find((candidate) => re.test(candidate));
}

/** Representative OR-of-conjunction arrays shared with the describer audit's bounded samples. */
export const STRUCTURED_FILTER_ALTERNATIVE_SAMPLES = [
  [{ keywords: ["CHARACTER"] }, { keywords: ["MONSTER", "VEHICLE"] }],
  [{ keywords: ["CHARACTER"] }, { states: ["battle-shocked"] }],
] as const;

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
    if (schema.items?.properties?.keywords && schema.items.properties.states) {
      return STRUCTURED_FILTER_ALTERNATIVE_SAMPLES.map((alternatives) => alternatives.map((alternative) => ({ ...alternative })));
    }
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
    // A pattern a family narrows by hand (apply-mark's tag must also be a registered designation)
    // names a valid value in the branch's own `examples`.
    values.push(...branches.flatMap((item) => item.examples ?? []));
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
    // An optional parameter (`x-optional`) is also tried absent.
    sets = sets.flatMap((set) => appliesGiven(schema, set)
      ? [...domain(name, schema, family.starter).map((value) => ({ ...set, [name]: value })), ...(schema["x-optional"] ? [set] : [])]
      : [set]);
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

/**
 * A bounded, pairwise sample for a high-dimensional family.
 *
 * The baseline uses only schema-required properties. Each single parameter value and each pair of
 * parameter values is then normalized with required fields and x-only-when prerequisites filled
 * in. A second legacy completion also tries applicable fields that predate x-optional, because
 * older family schemas use those fields as conditionally required. Invalid candidates are
 * discarded by the same canonical normalizer as authored leaves.
 */
export function boundedCombinations(family: SemanticFamilyDefinition): Record<string, unknown>[] {
  const properties = Object.entries((family.parameterSchema.properties ?? {}) as Record<string, Schema>);
  properties.sort(([, left], [, right]) => Number(Boolean(left["x-only-when"])) - Number(Boolean(right["x-only-when"])));
  const schemas = new Map(properties);
  const domains = new Map(properties.map(([name, schema]) => [name, domain(name, schema, family.starter)]));
  const required = new Set((family.parameterSchema.required ?? []) as string[]);
  const valid = new Map<string, Record<string, unknown>>();

  const complete = (selected: Record<string, unknown>, legacy: boolean): Record<string, unknown> | null => {
    const parameters = { ...selected };
    let changed = true;
    while (changed) {
      changed = false;
      for (const name of Object.keys(parameters)) {
        const schema = schemas.get(name);
        if (!schema) continue;
        for (const [dependency, allowed] of Object.entries(schema["x-only-when"] ?? {})) {
          if (dependency in parameters) {
            if (!allowed.includes(String(parameters[dependency]))) return null;
            continue;
          }
          const prerequisite = domains.get(dependency)?.find((candidate) => allowed.includes(String(candidate)));
          if (prerequisite === undefined) return null;
          parameters[dependency] = prerequisite;
          changed = true;
        }
      }
      for (const [name, schema] of properties) {
        if (name in parameters || !appliesGiven(schema, parameters)) continue;
        if (!required.has(name) && (!legacy || schema["x-optional"])) continue;
        const value = domains.get(name)?.[0];
        if (value === undefined) return null;
        parameters[name] = value;
        changed = true;
      }
    }
    return Object.entries(parameters).every(([name]) => {
      const schema = schemas.get(name);
      return schema !== undefined && appliesGiven(schema, parameters);
    }) ? parameters : null;
  };

  const add = (selected: Record<string, unknown>): void => {
    for (const legacy of [false, true]) {
      const candidate = complete(selected, legacy);
      if (!candidate) continue;
      try {
        const normalized = normalizeFingerprintParameters(family.id, candidate, family.version);
        valid.set(JSON.stringify(normalized), normalized);
      } catch {
        // Invalid pairings are not leaves. Other pairings retain each value in valid contexts.
      }
    }
  };

  add({});
  add(Object.fromEntries(Object.entries(family.starter).filter(([, value]) => isConcrete(value))));
  for (const [name] of properties) {
    for (const value of domains.get(name) ?? []) add({ [name]: value });
  }
  for (let leftIndex = 0; leftIndex < properties.length; leftIndex += 1) {
    const [leftName] = properties[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < properties.length; rightIndex += 1) {
      const [rightName] = properties[rightIndex]!;
      for (const left of domains.get(leftName) ?? []) {
        for (const right of domains.get(rightName) ?? []) add({ [leftName]: left, [rightName]: right });
      }
    }
  }
  return [...valid.values()];
}
