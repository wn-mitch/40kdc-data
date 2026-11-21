import { exactKeys } from "../family-validation.js";

/** Helpers shared by the container, resource-menu, ability, named-ability and Oath family files. */

export type Params = Record<string, unknown>;

/** A kebab-case entity id: an ability record, option, definition or pool. */
export const KEBAB_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

export const isObject = (value: unknown): value is Params => typeof value === "object" && value !== null && !Array.isArray(value);

export function kebabId(value: unknown, label: string): string {
  if (typeof value === "string" && KEBAB_ID.test(value)) return value;
  throw new TypeError(`${label} must be a kebab-case entity id.`);
}

export function namedId(value: unknown, label: string): string {
  if (typeof value !== "string" || !KEBAB_ID.test(value)) throw new TypeError(`${label} is a kebab-case ability, Stratagem, manoeuvre or action id.`);
  return value;
}

export function nonEmptyString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new TypeError(`${label} must be a nonempty string.`);
}

export function constTrue(value: unknown, label: string): true {
  if (value === true) return true;
  throw new TypeError(`${label} must be true.`);
}

/** The keys of `input`, among `keys`, that it holds. */
export const present = (input: Params, keys: readonly string[]) => keys.filter((key) => key in input);

export const noParameters = (family: string) => (input: Params): Params => {
  exactKeys(input, [], family);
  return {};
};
