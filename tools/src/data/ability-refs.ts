/**
 * A unit's `ability_ids` entry: an ability id, or an object for a rated rule (`{id, value}`:
 * Deadly Demise D3, Feel No Pain 5+) or for the ability a wargear item prints (`{id, wargear}`).
 */
/** The object form (the schema's anyOf leaves json2ts an open record, so it is spelled here). */
export interface UnitAbilityRefObject {
  id: string;
  value?: string | number;
  wargear?: string;
}

export type UnitAbilityRef = string | UnitAbilityRefObject;

/** The ability id an entry names. */
export const abilityRefId = (ref: UnitAbilityRef | Record<string, unknown>): string => (typeof ref === "string" ? ref : String((ref as UnitAbilityRefObject).id));

/** The rating an entry prints, if it is a rated rule. */
export const abilityRefValue = (ref: UnitAbilityRef | Record<string, unknown>): string | number | undefined => (typeof ref === "string" ? undefined : (ref as UnitAbilityRefObject).value);

/** The wargear item an entry's ability is printed by, if any. */
export const abilityRefWargear = (ref: UnitAbilityRef | Record<string, unknown>): string | undefined => (typeof ref === "string" ? undefined : (ref as UnitAbilityRefObject).wargear);

/** The ability ids of a unit's `ability_ids`, in order. */
export const unitAbilityIds = (refs: readonly unknown[] | undefined): string[] => abilityIdsOf(refs);

/** The wargear ids whose printed ability the unit lists (its datasheet prints that wargear's rule). */
export const printedWargearIds = (refs: readonly unknown[] | undefined): string[] =>
  (refs ?? []).flatMap((r) => {
    const w = r && typeof r === "object" ? abilityRefWargear(r as UnitAbilityRefObject) : undefined;
    return w ? [w] : [];
  });

/** The ability ids of an untyped `ability_ids` value (raw JSON): strings and `{id}` objects, anything else skipped. */
export function abilityIdsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => (typeof v === "string" ? [v] : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? [(v as { id: string }).id] : []));
}

const isRatingRef = (v: unknown): boolean =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && (v as { rating?: unknown }).rating === true;

/**
 * An effect with every `{rating: true}` replaced by the unit's printed rating. Without a rating
 * (no unit in context) the effect is returned as is. Unchanged subtrees keep their identity.
 */
export function withRating<T>(effect: T, rating: string | number | undefined): T {
  if (rating === undefined) return effect;
  const walk = (v: unknown): unknown => {
    if (isRatingRef(v)) return rating;
    if (Array.isArray(v)) {
      let copy: unknown[] | undefined;
      v.forEach((x, i) => {
        const r = walk(x);
        if (r !== x) (copy ??= [...v])[i] = r;
      });
      return copy ?? v;
    }
    if (v === null || typeof v !== "object") return v;
    let copy: Record<string, unknown> | undefined;
    for (const [k, x] of Object.entries(v)) {
      const r = walk(x);
      if (r !== x) (copy ??= { ...(v as Record<string, unknown>) })[k] = r;
    }
    return copy ?? v;
  };
  return walk(effect) as T;
}
