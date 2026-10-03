import { UNIT_KEYWORD } from "./buff-families.js";

/** Building blocks shared by the family extension lists. */

export type Schema = Record<string, unknown>;
export type Normalize = (input: Record<string, unknown>) => Record<string, unknown>;

export type FamilyExtension = {
  family: string;
  description: string;
  /** The new version's schema, from the previous version's. */
  schema: (previous: Schema) => Schema;
  /** Check the new parameters; `previous` normalizes a leaf as the previous version does. */
  normalize: (input: Record<string, unknown>, previous: Normalize) => Record<string, unknown>;
};

export const properties = (schema: Schema) => schema.properties as Record<string, Schema>;

export function withProperties(schema: Schema, added: Record<string, Schema>): Schema {
  return { ...schema, properties: { ...properties(schema), ...added } };
}

/** The enum of one property with more values, directly or in its anyOf enum branch. */
export function widenedEnum(schema: Schema, key: string, values: readonly string[]): Schema {
  const property = properties(schema)[key]!;
  const widen = (list: string[]) => [...list, ...values.filter((value) => !list.includes(value))];
  return Array.isArray(property.enum)
    ? { ...property, enum: widen(property.enum as string[]) }
    : { ...property, anyOf: (property.anyOf as Schema[]).map((item) => Array.isArray(item.enum) ? { ...item, enum: widen(item.enum as string[]) } : item) };
}

export function keywordList(value: unknown, label: string, minimum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum) throw new TypeError(`${label} must list at least ${minimum} keyword${minimum === 1 ? "" : "s"}.`);
  const list = value.map((item) => {
    const keyword = String(item).replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();
    if (!UNIT_KEYWORD.test(keyword)) throw new TypeError(`${label} keyword ${JSON.stringify(item)} is not a unit keyword.`);
    return keyword;
  });
  if (new Set(list).size !== list.length) throw new TypeError(`${label} lists a keyword twice.`);
  return list.sort();
}

/** Run the previous version with `key` set to a value it accepts, then put the new value back. */
export function standIn(input: Record<string, unknown>, key: string, value: unknown, previous: Normalize): Record<string, unknown> {
  const original = input[key];
  const normalized = previous({ ...input, [key]: value });
  return { ...normalized, [key]: original };
}

export const DICE = /^\d*D(3|6)(\+\d+)?$/u;
/**
 * An optional parameter a leaf may leave out entirely. Parameter samplers (the leaf-coverage
 * sweep, the describer audit) try a leaf without it as well as with each of its values.
 */
export const optional = (schema: Schema): Schema => ({ ...schema, "x-optional": true });
export const KEYWORD_ITEMS = { type: "string", pattern: UNIT_KEYWORD.source };
/** Units an effect's own recipient can be, beyond the earlier versions: the unit a trigger names. */
export const EVENT_SUBJECT = "event-subject";
