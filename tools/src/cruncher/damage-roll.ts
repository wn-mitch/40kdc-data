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

export type DamageReroll = "ones" | "ones-and-twos" | "all-failures";

export interface DamageRollInput {
  /** The profile's printed D: a number or a dice expression. */
  stat: unknown;
  /** Flat bonus added after the roll (Melta at half range). */
  bonus: number;
  /** Summed damage modifier. */
  modifier: number;
  /** Defender damage reduction; 0 when inactive. */
  reduction: number;
  /** The defender halves the rolled Damage, rounding up, before the bonus, modifier and reduction. */
  halve?: boolean;
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
    const base = input.halve ? Math.ceil(rolled / 2) : rolled;
    const beforeReduction = Math.max(0, base + input.bonus + input.modifier);
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
    const eligible = input.reroll === "all-failures" || (input.reroll === "ones" && total === 1) || (input.reroll === "ones-and-twos" && total <= 2);
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
 * Expected damage a "re-roll one Damage roll" adds over a pool of Damage rolls of `distribution`
 * (a fresh roll's final damage, ascending by value): the player re-rolls the lowest roll when it is
 * below a fresh roll's mean. Over N rolls the lowest is `v` with probability
 * E[S(v)^N - S(next)^N], S(v) being the chance a roll is at least `v`; `rolls` is the pool's
 * generating function, E[z^N] as a function of z.
 */
export function oneDamageRerollGain(distribution: ReadonlyArray<{ value: number; probability: number }>, rolls: (z: number) => number): number {
  const mean = distribution.reduce((sum, { value, probability }) => sum + value * probability, 0);
  let gain = 0;
  let atLeast = 1;
  for (const { value, probability } of distribution) {
    const above = Math.max(0, atLeast - probability);
    if (value < mean) gain += (rolls(atLeast) - rolls(above)) * (mean - value);
    atLeast = above;
  }
  return gain;
}

/**
 * {@link oneDamageRerollGain} over rolls of several kinds, each with its own Damage distribution
 * (normal and critical wounds). A roll gains its kind's mean less its value, so a kind with a fixed
 * Damage never gains; the player re-rolls the roll that gains most. The largest gain is at most `g`
 * with probability E[Π F_k(g)^(N_k)], F_k being the chance one roll of kind k gains at most `g`;
 * `rolls` is the pool's generating function over the kinds, E[Π z_k^(N_k)] as a function of z.
 */
export function oneRerollGainAcross(
  kinds: ReadonlyArray<ReadonlyArray<{ value: number; probability: number }>>,
  rolls: (z: number[]) => number,
): number {
  const gainsOf = kinds.map((distribution) => {
    const mean = distribution.reduce((sum, { value, probability }) => sum + value * probability, 0);
    return distribution.map(({ value, probability }) => ({ gain: Math.max(0, mean - value), probability }));
  });
  const atMost = (g: number) => gainsOf.map((gains) => gains.reduce((sum, item) => sum + (item.gain <= g ? item.probability : 0), 0));
  const gains = [...new Set(gainsOf.flat().map((item) => item.gain))].sort((left, right) => left - right);
  let expected = 0;
  let below = rolls(atMost(-1));
  for (const gain of gains) {
    const upTo = rolls(atMost(gain));
    if (gain > 0) expected += gain * (upTo - below);
    below = upTo;
  }
  return expected;
}
