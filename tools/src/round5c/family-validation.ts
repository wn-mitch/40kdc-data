/** Parameter checks shared by every reviewed family's normalizer. */

export function exactKeys(parameters: Record<string, unknown>, keys: readonly string[], family: string): void {
  const received = Object.keys(parameters).sort();
  const expected = [...keys].sort();
  if (received.length !== expected.length || received.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${family} parameters must be exactly: ${expected.join(", ")}.`);
  }
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
