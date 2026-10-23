/**
 * Per-attack damage as an exact distribution over the Damage roll.
 *
 * A Damage characteristic is either fixed (`3`) or a dice expression (`D6`,
 * `2D3`, `D6+1`). Each rolled total passes through the same transform the
 * engine applies to every attack: add Melta and the damage modifier, floor at
 * 0, then subtract damage reduction to a minimum of 1 when reduction is
 * active. The expectation is taken over that transformed value, so a floor or
 * a reduction acts on each roll rather than on the mean.
 */

export type DamageReroll = "ones" | "all-failures";

export interface DamageRollInput {
  /** The profile's printed D: a number or a dice expression. */
  stat: unknown;
  /** Flat bonus added after the roll (Melta at half range). */
  bonus: number;
  /** Summed damage modifier. */
  modifier: number;
  /** Defender damage reduction; 0 when inactive. */
  reduction: number;
  /** Damage-roll reroll permission, if any. */
  reroll?: DamageReroll;
}

export interface DamageRoll {
  /** Probability of each final per-attack damage value, ascending by value. */
  distribution: Array<{ value: number; probability: number }>;
  expected: number;
  /** Whether the reroll permission changed any outcome. */
  rerollUsed: boolean;
}

interface DiceExpression {
  count: number;
  die: number;
  offset: number;
}

function parseDamage(stat: unknown): number | DiceExpression {
  if (typeof stat === "number" && Number.isFinite(stat)) return stat;
  if (typeof stat !== "string") throw new Error(`damageRoll: unresolved quantity ${JSON.stringify(stat)}`);
  const trimmed = stat.trim();
  if (trimmed === "") throw new Error("damageRoll: empty quantity");
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return asNumber;
  const match = /^(\d*)D(\d+)([+-]\d+)?$/i.exec(trimmed);
  if (!match) throw new Error(`damageRoll: cannot parse "${stat}"`);
  return {
    count: match[1] === "" ? 1 : Number(match[1]),
    die: Number(match[2]),
    offset: match[3] ? Number(match[3]) : 0,
  };
}

/**
 * Exact distribution of a quantity characteristic (a number or a dice expression such as `D6+1`),
 * as (value, probability) ascending by value.
 */
export function quantityDistribution(stat: unknown): Array<[number, number]> {
  const parsed = parseDamage(stat);
  if (typeof parsed === "number") return [[parsed, 1]];
  return diceTotals(parsed.count, parsed.die).map(([total, probability]) => [total + parsed.offset, probability]);
}

/** Distribution of the summed dice, as (total, probability) ascending by total. */
function diceTotals(count: number, die: number): Array<[number, number]> {
  let totals = new Map<number, number>([[0, 1]]);
  for (let index = 0; index < count; index += 1) {
    const next = new Map<number, number>();
    for (const [total, probability] of totals) {
      for (let face = 1; face <= die; face += 1) {
        next.set(total + face, (next.get(total + face) ?? 0) + probability / die);
      }
    }
    totals = next;
  }
  return [...totals].sort(([left], [right]) => left - right);
}

/**
 * Exact per-attack damage. A reroll replaces a roll only when the replacement's
 * expected final damage exceeds the kept roll's, which is the optimal one-shot
 * policy. `ones` permits rerolling a dice total of 1, so it can only act on a
 * single die; `all-failures` permits rerolling any total.
 */
export function damageRoll(input: DamageRollInput): DamageRoll {
  const final = (rolled: number) => {
    const beforeReduction = Math.max(0, rolled + input.bonus + input.modifier);
    return input.reduction > 0 ? Math.max(1, beforeReduction - input.reduction) : beforeReduction;
  };
  const parsed = parseDamage(input.stat);
  if (typeof parsed === "number") {
    const value = final(parsed);
    return { distribution: [{ value, probability: 1 }], expected: value, rerollUsed: false };
  }
  const totals = diceTotals(parsed.count, parsed.die);
  const fresh = totals.reduce((sum, [total, probability]) => sum + probability * final(total + parsed.offset), 0);
  const outcomes = new Map<number, number>();
  const add = (value: number, probability: number) => outcomes.set(value, (outcomes.get(value) ?? 0) + probability);
  let rerollUsed = false;
  for (const [total, probability] of totals) {
    const kept = final(total + parsed.offset);
    const eligible = input.reroll === "all-failures" || (input.reroll === "ones" && total === 1);
    if (eligible && kept < fresh) {
      rerollUsed = true;
      for (const [again, againProbability] of totals) add(final(again + parsed.offset), probability * againProbability);
    } else {
      add(kept, probability);
    }
  }
  const distribution = [...outcomes]
    .sort(([left], [right]) => left - right)
    .map(([value, probability]) => ({ value, probability }));
  const expected = distribution.reduce((sum, { value, probability }) => sum + value * probability, 0);
  return { distribution, expected, rerollUsed };
}

/**
 * Expected damage a "re-roll one Damage roll" adds over `rolls` Damage rolls of `distribution`
 * (a fresh roll's final damage, ascending by value): the player re-rolls the lowest roll when it is
 * below a fresh roll's mean. Over a whole number of rolls the lowest is `v` with probability
 * S(v)^rolls - S(next)^rolls, where S(v) is the chance a roll is at least `v`; a count the engine
 * carries as an expectation is read between the whole counts either side (engine.ts betweenWholePools).
 */
export function oneDamageRerollGain(distribution: ReadonlyArray<{ value: number; probability: number }>, rolls: number): number {
  if (rolls <= 0) return 0;
  const mean = distribution.reduce((sum, { value, probability }) => sum + value * probability, 0);
  const atWhole = (count: number): number => {
    let gain = 0;
    let atLeast = 1;
    for (const { value, probability } of distribution) {
      const above = Math.max(0, atLeast - probability);
      if (value < mean) gain += (Math.pow(atLeast, count) - Math.pow(above, count)) * (mean - value);
      atLeast = above;
    }
    return gain;
  };
  const low = Math.floor(rolls);
  const below = atWhole(low);
  return rolls === low ? below : below + (rolls - low) * (atWhole(low + 1) - below);
}
