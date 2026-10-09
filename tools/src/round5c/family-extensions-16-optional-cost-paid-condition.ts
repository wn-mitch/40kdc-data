import { type FamilyExtension, optional, type Schema, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { SUBJECT_REF } from "./predicate-families.js";
import { booleanValue, enumValue } from "./family-validation.js";

/**
 * Wave-10 optional-cost-paid version 2. Version 1 reads a use-time spend only from the same use
 * (window use, subject that spent). Version 2 adds:
 *
 * - window trigger: "if you spent YP/Pain tokens" read at a later moment of the ability, which
 *   is the spend the ability's own event offers (compile-optional-cost.ts).
 * - pool pain-token-pool (window trigger and turn only; a use spends YP).
 * - tag: the designation this ability's spend sets and its read tests. Each ability names its own,
 *   so two abilities never read each other's designation.
 * - holder: the unit the designation is set on (trigger only; this-unit by default).
 *
 * Version 1 leaves keep their meaning: a use leaf with no tag reads the legacy yp-spent-this-use tag.
 */

export const OPTIONAL_COST_POOLS_V2 = ["yp-pool", "pain-token-pool"] as const;
export const OPTIONAL_COST_WINDOWS_V2 = ["use", "trigger", "turn"] as const;
export const OPTIONAL_COST_HOLDERS = ["this-unit", "selected-unit"] as const;

const TAG = { type: "string", pattern: "^[a-z][a-z0-9-]*$", minLength: 1, maxLength: 60 };

export const OPTIONAL_COST_PAID_V2: FamilyExtension = {
  family: "optional-cost-paid",
  description: "As version 1, plus window trigger (a spend the ability's own moment offers, read later), pool pain-token-pool (not with window use), tag (the designation the spend sets and the read tests), and holder (the unit the designation is set on; trigger only).",
  schema: (previous: Schema) => {
    return withProperties(previous, {
      pool: widenedEnum(previous, "pool", OPTIONAL_COST_POOLS_V2),
      window: widenedEnum(previous, "window", OPTIONAL_COST_WINDOWS_V2),
      tag: optional(TAG),
      holder: optional({ enum: [...OPTIONAL_COST_HOLDERS] }),
    });
  },
  normalize: (input) => normalizeOptionalCostV2(input),
};

/**
 * Checks one version-2 leaf. Each window takes only its own keys: use and trigger name the
 * subject that spent and the designation tag; turn names neither, and takes negation instead.
 */
export function normalizeOptionalCostV2(input: Record<string, unknown>): Record<string, unknown> {
  const family = "optional-cost-paid";
  const window = enumValue(input.window, OPTIONAL_COST_WINDOWS_V2, `${family}.window`);
  const pool = enumValue(input.pool, OPTIONAL_COST_POOLS_V2, `${family}.pool`);
  const allowed = window === "turn"
    ? ["pool", "window", "negated"]
    : window === "use"
      ? ["pool", "window", "subject", "tag"]
      : ["pool", "window", "subject", "tag", "holder"];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new TypeError(`${family} window ${window} does not take ${key}.`);
  }
  if (window === "use" && pool === "pain-token-pool") throw new TypeError(`${family} window use reads a YP spend; a Pain token spend is read as window trigger.`);
  if (window === "turn") {
    const negated = "negated" in input ? booleanValue(input.negated, `${family}.negated`) : false;
    return { pool, window, ...(negated ? { negated: true } : {}) };
  }
  if ("negated" in input) throw new TypeError(`${family} negated is only for window turn ("spent no YP in that turn").`);
  if (input.subject === undefined) throw new TypeError(`${family} window ${window} needs the subject that spent the pool.`);
  // A version-1 use leaf names no tag: it reads the legacy designation the same use's spend sets.
  if (input.tag === undefined && window !== "use") throw new TypeError(`${family} window ${window} needs the designation tag its spend sets.`);
  const tag = input.tag === undefined ? "yp-spent-this-use" : input.tag;
  if (typeof tag !== "string" || !/^[a-z][a-z0-9-]*$/u.test(tag) || tag.length > 60) throw new TypeError(`${family}.tag is a kebab-case designation id.`);
  const subject = enumValue(input.subject, SUBJECT_REF, `${family}.subject`);
  if (window === "use") return { pool, window, subject, tag };
  const holder = input.holder === undefined ? "this-unit" : enumValue(input.holder, OPTIONAL_COST_HOLDERS, `${family}.holder`);
  return { pool, window, subject, tag, holder };
}

export const FAMILY_EXTENSIONS_16_OPTIONAL_COST_PAID_CONDITION: readonly FamilyExtension[] = [OPTIONAL_COST_PAID_V2];
