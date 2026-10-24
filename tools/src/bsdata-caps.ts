/**
 * Size-dependent selection caps read from BSData's structured modifiers and
 * conditions, and their projection onto the flat and ratio forms that
 * `loadout_variant_budgets` can state (`count`, `floor(models * count /
 * per_models)`, or the stepped `count * floor(models / per_models)`).
 *
 * A cap is evaluated at every legal unit size. Only conditions on the unit's
 * own model count are evaluable; anything else makes the cap unknown, and the
 * caller keeps the static value.
 */

type JsonNode = Record<string, unknown>;

const arr = (value: unknown): JsonNode[] => Array.isArray(value) ? value.filter((v): v is JsonNode => !!v && typeof v === "object" && !Array.isArray(v)) : [];
const str = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;

/** A cap by unit size; `Infinity` where the source states no bound at that size. */
export type SizeCap = ReadonlyMap<number, number>;

/** One projected allowance: `per_models` 0 is the flat `count`; `stepped` grants `count` per full block of `per_models`. */
export interface CapForm { count: number; per_models: number; stepped?: boolean }

/** Scopes whose model count is not the whole unit's. */
const NON_UNIT_SCOPES = new Set(["parent", "self", "roster", "force", "primary-catalogue", "root-entry"]);

const isModelCount = (condition: JsonNode): boolean =>
  condition.childId === "model" && condition.field === "selections" && !NON_UNIT_SCOPES.has(str(condition.scope) ?? "");

function compare(type: unknown, actual: number, value: number): boolean | undefined {
  switch (type) {
    case "atLeast": return actual >= value;
    case "atMost": return actual <= value;
    case "greaterThan": return actual > value;
    case "lessThan": return actual < value;
    case "equalTo": return actual === value;
    case "notEqualTo": return actual !== value;
    default: return undefined;
  }
}

/** The conjunctive clauses of a node's `conditions` and nested `conditionGroups`. */
function clauses(node: JsonNode): JsonNode[][] {
  let result: JsonNode[][] = [arr(node.conditions)];
  for (const group of arr(node.conditionGroups)) {
    const inner = arr(group.conditions).map((c) => [[c]] as JsonNode[][]);
    const nested = arr(group.conditionGroups).map((g) => clauses(g));
    const parts = [...inner, ...nested];
    const combined = group.type === "or"
      ? parts.flat()
      : parts.reduce((acc, part) => acc.flatMap((a) => part.map((b) => [...a, ...b])), [[]] as JsonNode[][]);
    result = result.flatMap((a) => combined.map((b) => [...a, ...b]));
  }
  return result;
}

/** Whether a modifier applies at unit size `n`; undefined when a condition is not a model count. */
function applies(modifier: JsonNode, n: number): boolean | undefined {
  let any = false;
  for (const clause of clauses(modifier)) {
    let holds = true;
    for (const condition of clause) {
      if (!isModelCount(condition) || typeof condition.value !== "number") return undefined;
      const result = compare(condition.type, n, condition.value);
      if (result === undefined) return undefined;
      holds &&= result;
    }
    any ||= holds;
  }
  return any;
}

export interface EvaluatedCap {
  cap: SizeCap;
  /** Source entry ids whose selections each lower this cap by one (a shared pool). */
  pooledWith: string[];
}

/**
 * A node's `max` selection constraint evaluated at each size, applying its
 * `set`, `increment` and `decrement` modifiers in source order. Undefined when
 * the node has no `max` or a modifier depends on anything but the model count.
 */
export function evaluateMaxCap(node: JsonNode, sizes: readonly number[], accept: (constraint: JsonNode) => boolean = () => true): EvaluatedCap | undefined {
  const max = arr(node.constraints).find((c) => c.type === "max" && c.field === "selections" && typeof c.value === "number" && accept(c));
  if (!max) return undefined;
  const id = str(max.id);
  const modifiers = arr(node.modifiers).filter((m) => m.field === "selections" || (id !== undefined && m.field === id));
  const pooledWith = new Set<string>();
  const cap = new Map<number, number>();
  for (const n of sizes) {
    let value = max.value as number;
    for (const modifier of modifiers) {
      if (typeof modifier.value !== "number") return undefined;
      const repeats = arr(modifier.repeats);
      if (repeats.length) {
        if (modifier.type === "decrement" && repeats.every((r) => str(r.childId) && r.childId !== "model")) {
          for (const repeat of repeats) pooledWith.add(str(repeat.childId)!);
          continue;
        }
        if (repeats.length !== 1 || !isModelCount(repeats[0]) || typeof repeats[0].value !== "number" || repeats[0].value <= 0) return undefined;
        const times = (repeats[0].roundUp ? Math.ceil : Math.floor)(n / repeats[0].value) * (typeof repeats[0].repeats === "number" ? repeats[0].repeats : 1);
        if (modifier.type === "increment") value += modifier.value * times;
        else if (modifier.type === "decrement") value -= modifier.value * times;
        else return undefined;
        continue;
      }
      const on = applies(modifier, n);
      if (on === undefined) return undefined;
      if (!on) continue;
      if (modifier.type === "set") value = modifier.value;
      else if (modifier.type === "increment") value += modifier.value;
      else if (modifier.type === "decrement") value -= modifier.value;
      else return undefined;
    }
    cap.set(n, Math.max(0, value));
  }
  return { cap, pooledWith: [...pooledWith] };
}

/** One structured "error when count exceeds k" rule: at sizes where `when` holds, selections of `target` stay at or below `limit`. */
export interface CountRule { target: string; limit: number; when: (n: number) => boolean }

/**
 * Count limits a node states through `error` modifiers whose conditions are
 * structured (model-count conditions plus one selection-count threshold on an
 * entry), whatever the error's display text says. A clause with any other
 * condition is not a count limit and is skipped.
 */
export function errorCountRules(node: JsonNode): CountRule[] {
  const rules: CountRule[] = [];
  for (const modifier of arr(node.modifiers)) {
    if (modifier.field !== "error" || modifier.type !== "add") continue;
    for (const clause of clauses(modifier)) {
      const counts = clause.filter((c) => !isModelCount(c));
      const sizes = clause.filter(isModelCount);
      if (counts.length !== 1 || sizes.some((c) => typeof c.value !== "number")) continue;
      const [count] = counts;
      const target = str(count.childId);
      if (!target || count.field !== "selections" || typeof count.value !== "number" || count.percentValue === true) continue;
      const limit = count.type === "greaterThan" ? count.value : count.type === "atLeast" ? count.value - 1 : undefined;
      if (limit === undefined || limit < 0) continue;
      rules.push({ target, limit, when: (n) => sizes.every((c) => compare(c.type, n, c.value as number) === true) });
    }
  }
  return rules;
}

/** The pointwise minimum of caps. */
export function minCap(sizes: readonly number[], ...caps: (SizeCap | undefined)[]): SizeCap {
  return new Map(sizes.map((n) => [n, Math.min(...caps.map((cap) => cap?.get(n) ?? Infinity))]));
}

/** A cap from count rules on one target; `Infinity` where no rule applies. */
export function ruleCap(rules: readonly CountRule[], target: string, sizes: readonly number[]): SizeCap | undefined {
  const own = rules.filter((rule) => rule.target === target);
  if (!own.length) return undefined;
  return new Map(sizes.map((n) => [n, Math.min(Infinity, ...own.filter((rule) => rule.when(n)).map((rule) => rule.limit))]));
}

const formValue = (form: CapForm, n: number): number =>
  form.per_models === 0 ? form.count
    : form.stepped ? form.count * Math.floor(n / form.per_models)
    : Math.floor((n * form.count) / form.per_models);
const value = (forms: readonly CapForm[], n: number): number => Math.min(Infinity, ...forms.map((form) => formValue(form, n)));

/**
 * The simplest budget forms whose intersection reproduces `cap` exactly at
 * every size with a finite cap: one flat count, one ratio, a ratio under a flat
 * ceiling, then the same two shapes with a stepped ratio. At sizes the source leaves unbounded the projection must keep
 * growing (at least its last bounded value), so only a ratio fits there.
 * Undefined when no such form exists or the cap is unbounded everywhere.
 */
export function fitCap(cap: SizeCap): CapForm[] | undefined {
  const sizes = [...cap.keys()].sort((a, b) => a - b);
  const finite = sizes.filter((n) => Number.isFinite(cap.get(n)));
  if (!finite.length) return undefined;
  const top = Math.max(...finite.map((n) => cap.get(n)!));
  const matches = (forms: CapForm[]): boolean => {
    let floor = 0;
    for (const n of sizes) {
      const want = cap.get(n)!;
      const got = value(forms, n);
      if (Number.isFinite(want)) {
        if (got !== want) return false;
        floor = want;
      } else if (got < floor) return false;
    }
    return true;
  };
  // Where the source leaves larger sizes unbounded its limit keeps scaling, so
  // a flat count there would freeze it.
  const open = sizes.some((n) => !Number.isFinite(cap.get(n)));
  const values = new Set(finite.map((n) => cap.get(n)!));
  if (!open && values.size === 1 && top > 0) return [{ count: top, per_models: 0 }];
  const largest = sizes[sizes.length - 1];
  // A stepped ratio of count 1 is the proportional one, so it is tried only above 1.
  for (const stepped of [false, true]) {
    for (let count = stepped ? 2 : 1; count <= Math.max(1, top); count++) {
      for (let perModels = count; perModels <= largest; perModels++) {
        const ratio: CapForm = stepped ? { count, per_models: perModels, stepped } : { count, per_models: perModels };
        if (matches([ratio])) return [ratio];
        if (!open && top > 0 && matches([{ count: top, per_models: 0 }, ratio])) return [{ count: top, per_models: 0 }, ratio];
      }
    }
  }
  return undefined;
}

/** Every buildable unit size of a composition: each tier's (else the rows') min-sum to max-sum. */
export function compositionSizes(composition: JsonNode): number[] {
  const span = (rows: JsonNode[]): number[] => {
    const lo = rows.reduce((sum, row) => sum + (typeof row.min === "number" ? row.min : 0), 0);
    const hi = rows.reduce((sum, row) => sum + (typeof row.max === "number" ? row.max : typeof row.min === "number" ? row.min : 0), 0);
    return Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);
  };
  const tiers = arr(composition.tiers);
  const sizes = tiers.length ? tiers.flatMap((tier) => span(arr(tier.models))) : span(arr(composition.models));
  return [...new Set(sizes)].filter((n) => n > 0).sort((a, b) => a - b);
}
