import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * A characteristic change written without its amount, then its recipient filter, then the amount
 * ("Raise the Zorn characteristic of K models from your army by 2"). The amount
 * leaf names the change before it, through only the recipient leaves of the same fragment. The
 * binder sets that amount on the change and drops the amount leaf. Any other arrangement refuses,
 * and so does an additive change that no amount claims.
 */

const AMOUNT = "characteristic-amount";
const CHANGE = "characteristic-modifier";
const RECIPIENT_LEAVES = new Set(["unit-filter", "unit-owner"]);
const ADDITIVE = new Set(["add", "subtract", "improve", "worsen"]);

/** A change with no amount, which an amount leaf after its recipient must give one. */
const awaitsAmount = (leaf: CompileLeaf) => leaf.family_id === CHANGE && leaf.parameters.value === undefined && ADDITIVE.has(String(leaf.parameters.operation));

export function bindCharacteristicAmounts(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  if (!leaves.some((leaf) => leaf.family_id === AMOUNT || awaitsAmount(leaf))) return [...leaves];
  const valueFor = new Map<number, unknown>();
  const dropped = new Set<number>();
  leaves.forEach((amount, at) => {
    if (amount.family_id !== AMOUNT) return;
    let frame = at - 1;
    while (frame >= 0 && leaves[frame]!.family_id !== CHANGE) frame -= 1;
    if (frame < 0) throw new CompileError(`A characteristic amount at byte ${amount.start_byte} has no characteristic change before it to give an amount to.`);
    const change = leaves[frame]!;
    if (valueFor.has(frame)) throw new CompileError(`A characteristic change at byte ${change.start_byte} has two amounts; give it one.`);
    if (change.parameters.value !== undefined) throw new CompileError(`A characteristic amount at byte ${amount.start_byte} follows a characteristic change that already has an amount.`);
    if (!awaitsAmount(change)) throw new CompileError(`A characteristic amount at byte ${amount.start_byte} follows a characteristic change that takes no amount.`);
    if (change.fragment !== amount.fragment) throw new CompileError(`A characteristic amount at byte ${amount.start_byte} sits in another clause from its characteristic change.`);
    for (const between of leaves.slice(frame + 1, at)) {
      if (between.fragment !== amount.fragment || !RECIPIENT_LEAVES.has(between.family_id)) {
        throw new CompileError(`A characteristic amount at byte ${amount.start_byte} is separated from its characteristic change by ${between.family_id}; only the recipient may come between them.`);
      }
    }
    valueFor.set(frame, amount.parameters.value);
    dropped.add(at);
  });
  leaves.forEach((change) => {
    if (awaitsAmount(change) && !valueFor.has(leaves.indexOf(change))) throw new CompileError(`A characteristic change at byte ${change.start_byte} has no amount; give it one (a characteristic amount after its recipient).`);
  });
  return leaves.flatMap((leaf, at) => {
    if (dropped.has(at)) return [];
    if (!valueFor.has(at)) return [leaf];
    return [{ ...leaf, parameters: { ...leaf.parameters, value: valueFor.get(at) } }];
  });
}

const FLOOR = "characteristic-floor";
const LOWERING = new Set(["subtract", "worsen"]);
/** Characteristics read as a roll target ("3+"): improving one lowers its number, so a cap on the improvement is a floor. */
const ROLL_TARGET = new Set(["Sv", "WS", "BS", "Ld"]);

/**
 * "Worsen the Move, Leadership and Objective Control characteristics … by 1 (this rule can only
 * worsen a model's Objective Control characteristic to a minimum of 1)": a floor right after its
 * characteristic change, in the same fragment with nothing between. A floor over every
 * characteristic the change lowers is its `minimum`; one over some of them is
 * `characteristic_minimums`, which lowering applies to those characteristics' steps only. A floor
 * with no lowering change right before it, on a characteristic the change does not lower, or
 * against a different floor the change already has, refuses.
 */
export function bindCharacteristicFloors(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  if (!leaves.some((leaf) => leaf.family_id === FLOOR)) return [...leaves];
  const out: CompileLeaf[] = [];
  for (const floor of leaves) {
    if (floor.family_id !== FLOOR) { out.push(floor); continue; }
    const change = out.at(-1);
    if (change?.family_id !== CHANGE || change.fragment !== floor.fragment) throw new CompileError(`A characteristic floor at byte ${floor.start_byte} needs its characteristic change right before it.`);
    const lowered = change.parameters.characteristics as string[];
    const floored = floor.parameters.characteristics as string[];
    // Version 2: "(this cannot improve a model's Save to better than 3+)" floors an improved roll-target characteristic.
    const capsImprovement = floor.family_version >= 2 && change.parameters.operation === "improve" && floored.every((stat) => ROLL_TARGET.has(stat));
    if (!LOWERING.has(String(change.parameters.operation)) && !capsImprovement) throw new CompileError(`A characteristic floor at byte ${floor.start_byte} follows a change that does not lower a characteristic.`);
    const minimum = floor.parameters.minimum as number;
    const missing = floored.filter((stat) => !lowered.includes(stat));
    if (missing.length) throw new CompileError(`A characteristic floor at byte ${floor.start_byte} names ${missing.join(", ")}, which the change before it does not lower.`);
    if (change.parameters.minimum !== undefined && change.parameters.minimum !== minimum) throw new CompileError(`A characteristic floor at byte ${floor.start_byte} disagrees with the change's own minimum.`);
    const every = lowered.every((stat) => floored.includes(stat));
    const existing = (change.parameters.characteristic_minimums ?? {}) as Record<string, number>;
    out[out.length - 1] = every
      ? { ...change, parameters: { ...change.parameters, minimum } }
      : { ...change, parameters: { ...change.parameters, characteristic_minimums: { ...existing, ...Object.fromEntries(floored.map((stat) => [stat, minimum])) } } };
  }
  return out;
}
