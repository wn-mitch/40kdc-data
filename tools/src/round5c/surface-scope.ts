/**
 * Where a decided surface applies: the occurrence-level context under which Will's decision that
 * a wording means one leaf holds. Stored with the surface (`leaf_surfaces.scope_json`) and checked
 * for every occurrence each time the surface is applied; a surface without a scope (NULL) is an
 * unscoped decision and applies wherever its wording occurs.
 *
 * Each field narrows independently; an absent field does not narrow. Only context dimensions a
 * reviewed surface has needed exist here:
 * - `fragments`: the occurrence's source fragment (e.g. a Stratagem's WHEN line);
 * - `source_types`: the kind of ability (stratagem, unit, enhancement, ...);
 * - `clause_prefix`: the words between the start of the occurrence's clause (the fragment start,
 *   or the last "." or ":" before it) and the occurrence; "" means the occurrence opens the clause;
 * - `not_followed_by`: phrases that, when they are the next words after the occurrence, put it
 *   out of scope ("roll one D6 for each model" is not a single roll).
 *
 * A scope never changes once stored: a different scope is a different decision.
 */

export const SCOPE_VERSION = 1;

export type SurfaceScope = {
  version: typeof SCOPE_VERSION;
  fragments?: string[];
  source_types?: string[];
  clause_prefix?: string[];
  not_followed_by?: string[];
};

export type OccurrenceContext = {
  fragment: string;
  source_type: string | null;
  /** Fragment text before the occurrence. */
  before: string;
  /** Fragment text after the occurrence. */
  after: string;
};

const FIELDS = ["fragments", "source_types", "clause_prefix", "not_followed_by"] as const;

export class ScopeError extends Error {}

/** Comparable words: markdown emphasis dropped, curly quotes straightened, case and spacing folded. */
function words(text: string): string {
  return text.replace(/\*+/gu, "").replace(/[‘’]/gu, "'").replace(/\s+/gu, " ").trim().toLowerCase();
}

function stringList(value: unknown, field: string, allowEmptyItem: boolean): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new ScopeError(`scope.${field} must be a non-empty list.`);
  const items = value.map((item) => {
    if (typeof item !== "string") throw new ScopeError(`scope.${field} holds strings only.`);
    const folded = field === "fragments" || field === "source_types" ? item.trim() : words(item);
    if (!folded && !allowEmptyItem) throw new ScopeError(`scope.${field} cannot hold an empty entry.`);
    return folded;
  });
  return [...new Set(items)].sort();
}

/** Validate a scope from a decision (or from storage) into its canonical stored form. */
export function parseScope(value: unknown): SurfaceScope | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new ScopeError("scope must be an object.");
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => key !== "version" && !(FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) throw new ScopeError(`scope has no field ${unknown.join(", ")}; it knows ${FIELDS.join(", ")}.`);
  if (input.version !== undefined && input.version !== SCOPE_VERSION) throw new ScopeError(`scope.version ${String(input.version)} is not supported.`);
  const scope: SurfaceScope = { version: SCOPE_VERSION };
  if (input.fragments !== undefined) scope.fragments = stringList(input.fragments, "fragments", false);
  if (input.source_types !== undefined) scope.source_types = stringList(input.source_types, "source_types", false);
  if (input.clause_prefix !== undefined) scope.clause_prefix = stringList(input.clause_prefix, "clause_prefix", true);
  if (input.not_followed_by !== undefined) scope.not_followed_by = stringList(input.not_followed_by, "not_followed_by", false);
  if (FIELDS.every((field) => scope[field] === undefined)) throw new ScopeError("A scope must narrow at least one field.");
  return scope;
}

/** The canonical JSON stored in `leaf_surfaces.scope_json` (NULL for an unscoped surface). */
export function scopeJson(scope: SurfaceScope | null): string | null {
  return scope === null ? null : JSON.stringify(scope);
}

/** Whether one occurrence is inside a stored scope. */
export function inScope(scope: SurfaceScope | null, context: OccurrenceContext): boolean {
  if (scope === null) return true;
  if (scope.fragments && !scope.fragments.includes(context.fragment)) return false;
  if (scope.source_types && !scope.source_types.includes(context.source_type ?? "")) return false;
  if (scope.clause_prefix) {
    const clause = context.before.split(/[.:]/u).at(-1) ?? "";
    if (!scope.clause_prefix.includes(words(clause))) return false;
  }
  if (scope.not_followed_by) {
    const next = words(context.after);
    // Whole words only: "for" excludes "for each model" but not "fortress".
    if (scope.not_followed_by.some((phrase) => next === phrase || (next.startsWith(phrase) && !/[\p{L}\p{N}]/u.test(next[phrase.length]!)))) return false;
  }
  return true;
}
