import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { namedRange } from "./named-ranges.js";

/**
 * Named ranges and keyword-anchored auras (aura-range@5), bound before any role-based pass.
 *
 * - The record that defines a named range prints how far it reaches: each named-range-value,
 *   with the battle-round leaf right before it, is one span of battle rounds. Together they form
 *   one table from the first battle round whose last entry holds for the rest of the battle
 *   (common.schema.json range-ref `per_battle_round`); a value with no battle-round is the range
 *   throughout. A named-range-cap becomes the aura's range_cap. Every aura-range of that name in
 *   the record takes the table, and the definition leaves are dropped.
 * - An aura-range with range_ref in a record that does not define the range reaches the named
 *   range's own aura (`aura_of`); the defining record cannot point at itself.
 * - An aura measured from matching models ("of one or more DEATH GUARD models") carries them as its
 *   emitter filter. They are friendly by the leaf's of_side or by the "from your army" right after
 *   it, which is the emitter's own wording and is dropped.
 *
 * Each folded aura-range carries `range_table` (a DSL range-ref), which wrapAura lowers in place of
 * inches. `requireNamedRangeAuras` then refuses a compiled record that lowered such a leaf through
 * any path that dropped its range or emitter.
 */

type Node = Record<string, unknown>;
type Span = { min: number; max: number | null; inches: number; at: number };

/** The last battle round a battle-round leaf can name: "from the third battle round" is min 3, max 5. */
const LAST_BATTLE_ROUND = 5;

const isDefinition = (leaf: CompileLeaf) => leaf.family_id === "named-range-value" || leaf.family_id === "named-range-cap";
const isNamedAura = (leaf: CompileLeaf) => leaf.family_id === "aura-range" && (leaf.parameters.range_ref !== undefined || leaf.parameters.of === "matching-models");

/** The rounds a battle-round leaf covers, as one contiguous span; a listed set of rounds has no table entry. */
function roundSpan(leaf: CompileLeaf, value: CompileLeaf): { min: number; max: number | null } {
  if (Array.isArray(leaf.parameters.rounds)) throw new CompileError(`A named range value at byte ${value.start_byte} follows a list of battle rounds; a per-battle-round range takes one span of rounds.`);
  const min = typeof leaf.parameters.min === "number" ? leaf.parameters.min : 1;
  const max = typeof leaf.parameters.max === "number" ? leaf.parameters.max : null;
  return { min, max: max === LAST_BATTLE_ROUND ? null : max };
}

/** One named range's table: contiguous from round 1, the open-ended span last. */
function rangeTable(name: string, spans: readonly Span[]): Node {
  const sorted = [...spans].sort((left, right) => left.min - right.min);
  if (sorted.length === 1 && sorted[0]!.min === 1 && sorted[0]!.max === null) return { inches: sorted[0]!.inches };
  const table: Node[] = [];
  let next = 1;
  for (const [index, span] of sorted.entries()) {
    if (span.min !== next) throw new CompileError(`${namedRange(name).label} has no value for battle round ${next}; its values must cover every battle round from the first.`);
    const last = index === sorted.length - 1;
    if (span.max === null && !last) throw new CompileError(`${namedRange(name).label} has a value for every battle round from round ${span.min} and another value after it.`);
    if (span.max !== null && last) throw new CompileError(`${namedRange(name).label} has no value after battle round ${span.max}; the last value must hold for the rest of the battle.`);
    const through = span.max ?? span.min;
    if (through < span.min) throw new CompileError(`A battle round span for ${namedRange(name).label} ends before it starts.`);
    for (let round = span.min; round <= through; round += 1) table.push({ inches: span.inches });
    next = through + 1;
  }
  return table.every((entry) => entry.inches === table[0]!.inches) ? { inches: table[0]!.inches } : { per_battle_round: table };
}

/** The defining spans and cap of each named range a record defines, with the indexes they consume. */
function definitions(leaves: readonly CompileLeaf[]): { spans: Map<string, Span[]>; caps: Map<string, number>; consumed: Set<number> } {
  const spans = new Map<string, Span[]>();
  const caps = new Map<string, number>();
  const consumed = new Set<number>();
  leaves.forEach((leaf, at) => {
    if (!isDefinition(leaf)) return;
    const name = String(leaf.parameters.range);
    const inches = leaf.parameters.inches as number;
    consumed.add(at);
    if (leaf.family_id === "named-range-cap") {
      if (caps.has(name)) throw new CompileError(`${namedRange(name).label} has two caps; give it one.`);
      caps.set(name, inches);
      return;
    }
    const before = leaves[at - 1];
    const rounds = before?.family_id === "battle-round" && before.fragment === leaf.fragment ? roundSpan(before, leaf) : { min: 1, max: null };
    if (before?.family_id === "battle-round" && before.fragment === leaf.fragment) consumed.add(at - 1);
    const list = spans.get(name) ?? [];
    if (list.some((span) => span.min === rounds.min)) throw new CompileError(`${namedRange(name).label} has two values for battle round ${rounds.min}.`);
    list.push({ ...rounds, inches, at: leaf.start_byte });
    spans.set(name, list);
  });
  return { spans, caps, consumed };
}

/** The emitter filter of an aura measured from matching models, and the index of the "from your army" it consumes, if any. */
function matchingEmitter(leaves: readonly CompileLeaf[], at: number): { filter: Node; owner: number | null } {
  const leaf = leaves[at]!;
  const next = leaves[at + 1];
  const owner = next?.family_id === "unit-owner" && next.fragment === leaf.fragment ? at + 1 : null;
  if (owner !== null && leaves[owner]!.parameters.owner !== "friendly") throw new CompileError("An aura measured from matching models names enemy models; only friendly models emit an aura.");
  if (owner === null && leaf.parameters.of_side !== "friendly") throw new CompileError("An aura measured from matching models needs them friendly: of_side friendly or a \"from your army\" right after it.");
  if (leaf.parameters.emitter_filter !== undefined) throw new CompileError("An aura measured from matching models also has an aura-emitter preamble; name its emitters once.");
  return { filter: { owner: "friendly", all_of: [...(leaf.parameters.of_keywords as string[])] }, owner };
}

export function foldNamedRanges(leaves: readonly CompileLeaf[], abilityId?: string): CompileLeaf[] {
  if (!leaves.some((leaf) => isDefinition(leaf) || isNamedAura(leaf))) return [...leaves];
  const { spans, caps, consumed } = definitions(leaves);
  for (const name of caps.keys()) {
    if (!spans.has(name)) throw new CompileError(`${namedRange(name).label} has a cap but no value in this record.`);
  }
  const used = new Set<string>();
  const replaced = new Map<number, CompileLeaf>();
  leaves.forEach((leaf, at) => {
    if (!isNamedAura(leaf)) return;
    const parameters: Node = { ...leaf.parameters };
    const name = leaf.parameters.range_ref as string | undefined;
    if (name !== undefined) {
      const defined = spans.get(name);
      if (defined) {
        used.add(name);
        parameters.range_table = rangeTable(name, defined);
        const cap = caps.get(name);
        if (cap !== undefined) {
          if (parameters.range_cap_inches !== undefined && parameters.range_cap_inches !== cap) throw new CompileError(`${namedRange(name).label} is capped at ${cap}" and its aura at ${String(parameters.range_cap_inches)}".`);
          const widest = Math.max(...defined.map((span) => span.inches));
          if (widest > cap) throw new CompileError(`${namedRange(name).label} reaches ${widest}" in some battle round, beyond its own cap of ${cap}".`);
          parameters.range_cap_inches = cap;
        }
      } else {
        const own = namedRange(name).aura_of;
        if (own === abilityId) throw new CompileError(`This record is ${namedRange(name).label}'s own aura, but it gives the range no value.`);
        parameters.range_table = { aura_of: own };
      }
    }
    if (leaf.parameters.of === "matching-models") {
      const emitter = matchingEmitter(leaves, at);
      parameters.emitter_filter = emitter.filter;
      if (emitter.owner !== null) consumed.add(emitter.owner);
    }
    replaced.set(at, { ...leaf, parameters });
  });
  for (const name of spans.keys()) {
    if (!used.has(name)) throw new CompileError(`This record gives ${namedRange(name).label} a value but no aura of it reaches that range.`);
  }
  return leaves.flatMap((leaf, at) => consumed.has(at) ? [] : [replaced.get(at) ?? leaf]);
}

/** Every aura range and emitter folded above, as its compiled aura must carry them. */
function expectedAuras(leaves: readonly CompileLeaf[]): string[] {
  return leaves.filter((leaf) => leaf.family_id === "aura-range" && (leaf.parameters.range_table !== undefined || leaf.parameters.of === "matching-models"))
    .flatMap((leaf) => [
      ...(leaf.parameters.range_table !== undefined ? [`"range":${JSON.stringify(leaf.parameters.range_table)}`] : []),
      ...(leaf.parameters.of === "matching-models" ? [`"emitter_filter":${JSON.stringify(leaf.parameters.emitter_filter)}`] : []),
    ]);
}

/**
 * A folded named-range or matching-models aura-range lowers only through the aura wrap. Any other
 * path reads it as a number of inches and drops what it names, so the record is refused instead.
 */
export function requireNamedRangeAuras(leaves: readonly CompileLeaf[], effect: unknown): void {
  const text = JSON.stringify(effect);
  for (const expected of expectedAuras(leaves)) {
    if (!text.includes(expected)) throw new CompileError("A named-range or matching-models aura has no DSL form in this position yet; only an aura over the units it reaches does.");
  }
}
