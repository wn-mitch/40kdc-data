/** Parameter schemas and checks shared by every reviewed family. */

export const sourceQualifiedSchema = {
  type: "object",
  required: ["source"],
  properties: { source: { type: "string", minLength: 1 } },
  additionalProperties: false,
};

export const enumOrSourceSchema = (values: readonly string[]): Record<string, unknown> => ({
  anyOf: [{ enum: values }, sourceQualifiedSchema],
});

export const integerOrSourceSchema = {
  anyOf: [{ type: "integer" }, sourceQualifiedSchema],
};

export function exactKeys(parameters: Record<string, unknown>, keys: readonly string[], family: string): void {
  const received = Object.keys(parameters).sort();
  const expected = [...keys].sort();
  if (received.length !== expected.length || received.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${family} parameters must be exactly: ${expected.join(", ")}.`);
  }
}

/** The parameters hold every required key and no key outside the required and optional ones. */
export function keySet(input: Record<string, unknown>, required: readonly string[], optional: readonly string[], family: string): void {
  const keys = Object.keys(input);
  const allowed = new Set([...required, ...optional]);
  for (const key of keys) if (!allowed.has(key)) throw new TypeError(`${family} parameters must be one of: ${[...allowed].join(", ")}.`);
  for (const key of required) if (!(key in input)) throw new TypeError(`${family} parameters must include ${key}.`);
}

export function enumValue(value: unknown, values: readonly string[], label: string): string {
  if (typeof value === "string" && values.includes(value)) return value;
  throw new TypeError(`${label} must be one of ${values.join(", ")}.`);
}

export function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max) return value;
  throw new TypeError(`${label} must be an integer from ${min} to ${max}.`);
}

export function booleanValue(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value;
  throw new TypeError(`${label} must be true or false.`);
}

/** A non-empty set of listed values, returned in the listed order so equal sets fingerprint alike. */
export function enumSet(value: unknown, values: readonly string[], label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must list at least one of ${values.join(", ")}.`);
  for (const item of value) enumValue(item, values, label);
  if (new Set(value).size !== value.length) throw new TypeError(`${label} lists a value twice.`);
  return values.filter((item) => value.includes(item));
}

export type SourceQualifiedValue = { source: string };

/** An exact source snippet `{source}`, or null when the value is not one. */
export function sourceQualified(value: unknown, label: string): SourceQualifiedValue | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length !== 1 || entries[0]?.[0] !== "source" || typeof entries[0][1] !== "string") return null;
  const source = entries[0][1];
  if (!source || source !== source.trim()) {
    throw new TypeError(`${label} source snippet must be nonblank and preserve its exact boundaries.`);
  }
  return { source };
}

export function enumOrSource(value: unknown, values: readonly string[], label: string): string | SourceQualifiedValue {
  if (typeof value === "string" && values.includes(value)) return value;
  const source = sourceQualified(value, label);
  if (source) return source;
  throw new TypeError(`${label} must be one of ${values.join(", ")} or an exact source snippet.`);
}

export function integerOrSource(value: unknown, label: string): number | SourceQualifiedValue {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  const source = sourceQualified(value, label);
  if (source) return source;
  throw new TypeError(`${label} must be an integer or an exact source snippet.`);
}

/** A kebab-case name a resource-spend binds its spent amount to (bind_as) and a reader names (spent). */
const SPENT_NAME = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

/** The parameter schema of a spent-amount reference: `{spent, per?}`. */
export const spentReferenceSchema = {
  type: "object",
  required: ["spent"],
  properties: { spent: { type: "string", pattern: SPENT_NAME.source }, per: { type: "integer", minimum: 2, maximum: 10, "x-optional": true } },
  additionalProperties: false,
};

/** Whether a value is written as a spent-amount reference (an object naming `spent`). */
export function isSpentReference(value: unknown): value is { spent: string; per?: number } {
  return value !== null && typeof value === "object" && !Array.isArray(value) && "spent" in value;
}

/** The bind_as name of a resource-spend. */
export function spentName(value: unknown, label: string): string {
  if (typeof value !== "string" || !SPENT_NAME.test(value)) throw new TypeError(`${label} must be a kebab-case name.`);
  return value;
}

/**
 * The amount a resource-spend of this ability bound with bind_as ("the number of YP you spent"):
 * `{spent}`, or with per N one for every N of it (`{spent, per}`, "for every 2YP you just spent").
 */
export function spentReference(value: unknown, label: string): { spent: string; per?: number } {
  if (!isSpentReference(value)) throw new TypeError(`${label} must be {spent, per?}.`);
  keySet(value, ["spent"], ["per"], label);
  const result: { spent: string; per?: number } = { spent: spentName(value.spent, `${label}.spent`) };
  if (value.per !== undefined) result.per = boundedInteger(value.per, 2, 10, `${label}.per`);
  return result;
}

/** A Stratagem target group named by its bind_as: {bound: name}. */
export function boundGroup(value: unknown, field: string): Record<string, unknown> {
  const group = value as Record<string, unknown> | undefined;
  if (typeof group !== "object" || group === null || Array.isArray(group) || Object.keys(group).join(",") !== "bound"
    || typeof group.bound !== "string" || !/^[a-z][a-z0-9-]*[a-z0-9]$/u.test(group.bound)) {
    throw new TypeError(`${field} is {bound: name}: a Stratagem target group's bind_as.`);
  }
  return { bound: group.bound };
}
