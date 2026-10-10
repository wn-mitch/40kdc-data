import { matchingUnit } from "./compile-conditions.js";
import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { MATCHED_UNITS } from "./family-extensions-16-those-enemy-units-role.js";

/**
 * "those X units": the units an earlier unit-position of matching-unit introduced. The pass below
 * copies that unit-position's pool into each consumer as `matched_pool`, so every later fold reads
 * the set from the consumer alone. A consumer in any shape not listed here refuses.
 */

type Node = Record<string, unknown>;

/** The pool a matched-units consumer carries (attached by bindMatchedPools), as a fresh DSL unit-filter. */
export function matchedPoolOf(leaf: CompileLeaf): Node {
  const pool = leaf.parameters.matched_pool;
  if (pool === undefined || pool === null || typeof pool !== "object") {
    throw new CompileError("matched-units names the units an earlier unit-position of matching-unit introduced, and no such unit-position stands before it.");
  }
  return structuredClone(pool as Node);
}

const isMatchedConsumer = (leaf: CompileLeaf): boolean => leaf.parameters.among === MATCHED_UNITS || leaf.parameters.target === MATCHED_UNITS;
const isFilter = (leaf: CompileLeaf | undefined): boolean => leaf?.family_id === "unit-filter";

/** Parameters a matched-units unit-filter may carry beside its among; any other set value refuses. */
const FILTER_KEYS = new Set(["side", "keywords", "excluded_keywords", "among", "matched_pool"]);

/** Whether `a` comes before `b` in the record: by byte position, else by list order. */
function before(leaves: readonly CompileLeaf[], a: CompileLeaf, b: CompileLeaf): boolean {
  if (a.start_byte !== undefined && b.start_byte !== undefined) return a.start_byte < b.start_byte;
  return leaves.indexOf(a) < leaves.indexOf(b);
}

/**
 * The pool an earlier unit-position of matching-unit names. Only a plain "within N of this unit or
 * model" reads as the set; a negated, named-range, weapon or alternative distance refuses.
 */
function poolOf(source: CompileLeaf): Node {
  const p = source.parameters;
  if (p.kind !== "within") throw new CompileError("matched-units needs an earlier unit-position of matching-unit that is within a distance.");
  if (p.negated === true) throw new CompileError("matched-units cannot take a negated unit-position as its set.");
  if (p.range_ref !== undefined || p.at !== undefined || p.weapon_range !== undefined || p.distance !== undefined) {
    throw new CompileError("matched-units cannot take a unit-position measured by a named range, a point or a weapon distance.");
  }
  if (p.of_alternatives !== undefined || p.of_designated !== undefined || p.of_not_designated !== undefined) {
    throw new CompileError("matched-units cannot take a unit-position with alternatives or a designation as its set.");
  }
  if (p.subject !== "this-model" && p.subject !== "this-unit") throw new CompileError("matched-units needs an earlier unit-position measured from this model or this unit.");
  const subject = String(p.subject);
  const inches = closed(source, "inches");
  if (typeof inches !== "number") throw new CompileError("matched-units needs an earlier unit-position with a whole-number distance.");
  return { ...matchingUnit(source, subject), within: { range: { inches }, of: subject, ...(p.wholly === true ? { wholly: true } : {}) } };
}

/** The filter keywords, exclusions and side a matched-units unit-filter adds to its pool, checked against the pool. */
function narrowed(filter: CompileLeaf, pool: Node): Node {
  const p = filter.parameters;
  for (const [key, value] of Object.entries(p)) {
    if (FILTER_KEYS.has(key) || value === undefined || value === false || value === "unit") continue;
    throw new CompileError(`matched-units takes a unit-filter with side, keywords and exclusions only; ${key} has no shape with it.`);
  }
  if (p.side !== pool.owner) throw new CompileError("matched-units names units on the side its unit-position names.");
  const all = (pool.all_of as string[] | undefined) ?? [];
  const keywords = (p.keywords as string[] | undefined) ?? [];
  if (keywords.some((keyword) => !all.includes(keyword))) throw new CompileError("matched-units names a keyword the unit-position's set does not have.");
  const excluded = [...new Set([...((pool.none_of as string[] | undefined) ?? []), ...((p.excluded_keywords as string[] | undefined) ?? [])])];
  if (excluded.some((keyword) => all.includes(keyword))) throw new CompileError("matched-units excludes a keyword its unit-position's set requires.");
  return { ...pool, ...(excluded.length ? { none_of: excluded } : {}) };
}

/** The select-unit that takes a matched-units filter after it: its scope and distance must allow the pool's range. */
function selectWith(select: CompileLeaf, pool: Node): CompileLeaf {
  if (select.parameters.scope !== undefined && select.parameters.scope !== pool.owner) throw new CompileError("matched-units selects from the side its unit-position names.");
  if (select.parameters.distance !== undefined && select.parameters.distance !== "any") throw new CompileError("A selection of matched units cannot already be measured by a distance.");
  if (pool.excluding !== undefined) throw new CompileError("A selection of units other than the subject, from a matched set, has no DSL shape yet.");
  const within = pool.within as { range: { inches: number }; wholly?: boolean };
  if (within.wholly === true) throw new CompileError("A selection of units wholly within a range has no DSL shape yet.");
  return { ...select, parameters: { ...select.parameters, distance: "within", inches: within.range.inches } };
}

/**
 * Attaches the matched pool to every matched-units consumer. A consumer is a unit-filter right
 * after a select-unit (one of those X units), a unit-filter right before a friendly attack
 * (each time one of those X units makes an attack), or a targeting-restriction's target.
 */
export function bindMatchedPools(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  if (!leaves.some(isMatchedConsumer)) return [...leaves];
  const out = [...leaves];
  for (let at = 0; at < out.length; at += 1) {
    const leaf = out[at]!;
    if (!isMatchedConsumer(leaf)) continue;
    const sources = leaves.filter((other) => other.family_id === "unit-position" && other.parameters.of === "matching-unit" && before(leaves, other, leaf));
    if (sources.length === 0) throw new CompileError("matched-units names the units an earlier unit-position of matching-unit introduces, and this record has none before it.");
    if (sources.length > 1) throw new CompileError("matched-units is ambiguous: two or more earlier unit-positions of matching-unit could be the set.");
    const pool = poolOf(sources[0]!);
    if (leaf.family_id === "targeting-restriction") {
      out[at] = { ...leaf, parameters: { ...leaf.parameters, matched_pool: pool } };
      continue;
    }
    if (!isFilter(leaf)) throw new CompileError("matched-units is only a unit-filter or a targeting-restriction target.");
    const neighbours = [out[at - 1], out[at + 1]];
    if (neighbours.some((other) => isFilter(other) && other!.fragment === leaf.fragment)) {
      throw new CompileError("matched-units stacked with another unit-filter has no DSL shape yet.");
    }
    const select = out[at - 1];
    const attack = out[at + 1];
    const filterPool = narrowed(leaf, pool);
    if (select?.family_id === "select-unit" && select.fragment === leaf.fragment) {
      out[at - 1] = selectWith(select, filterPool);
      out[at] = { ...leaf, parameters: { ...leaf.parameters, matched_pool: filterPool } };
      continue;
    }
    if (attack?.family_id === "attack" && attack.fragment === leaf.fragment && attack.parameters.direction === "makes" && attack.parameters.unit === "friendly-unit"
      && attack.parameters.attacker_filter === undefined && attack.parameters.backref !== true && attack.parameters.refers === undefined) {
      if (leaf.parameters.side !== "friendly") throw new CompileError("matched-units names the attacker of a friendly attack, so its side is friendly.");
      out[at] = { ...leaf, parameters: { ...leaf.parameters, matched_pool: filterPool } };
      continue;
    }
    throw new CompileError("matched-units on a unit-filter has no DSL shape here: it must follow a select-unit or come before a friendly attack.");
  }
  return out;
}
