import { exactSpan } from "./contracts.js";
import { CompileError } from "./compile-error.js";
import type { CompileLeaf } from "./compile-fragments.js";

/**
 * "That unit suffers D3+1 mortal wounds and one model in it regains up to that many lost wounds":
 * the wounds regained (regain-wounds amount that-many), or a roll's bonus (roll-modifier value
 * that-many: "add 1 to that roll for each of those mortal wounds"), are the mortal wounds printed
 * before them in their sentence. A rolled count is rolled once: both effects read one bound roll,
 * which wraps them (wrapThatMany). A fixed count is that number.
 */

type Node = Record<string, unknown>;

const DICE = /^\d*D\d+(\+\d+)?$/u;

/** The marker a mortal-wounds count carries until wrapThatMany puts its roll around it. */
const PENDING = "__that_many_dice";

/** The parameter of each family that can read "that many", and the one it takes the bound roll in. */
const READERS: Record<string, { field: string; bound: string; fixed: (count: string) => unknown }> = {
  "regain-wounds": { field: "amount", bound: "amount_var", fixed: (count) => count },
  "roll-modifier": { field: "value", bound: "value_var", fixed: (count) => Number(count) },
};

const readsThatMany = (leaf: CompileLeaf) => { const reader = READERS[leaf.family_id]; return reader !== undefined && leaf.parameters[reader.field] === "that-many"; };

/**
 * Pairs each that-many reader with the mortal wounds before it in its sentence (no "." between
 * them, in its fragment). Refuses a that-many with no such mortal wounds.
 */
export function bindThatMany(list: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  if (!list.some(readsThatMany)) return [...list];
  const out = [...list];
  let pairs = 0;
  out.forEach((leaf, index) => {
    if (!readsThatMany(leaf)) return;
    const reader = READERS[leaf.family_id]!;
    const at = out.slice(0, index).map((other) => other.family_id === "mortal-wounds" && other.fragment === leaf.fragment).lastIndexOf(true);
    const wounds = out[at];
    const sameSentence = wounds !== undefined && sourceText !== undefined && wounds.end_byte !== undefined && wounds.end_byte <= leaf.start_byte
      && !/[.!?]\s/u.test(exactSpan(sourceText, wounds.end_byte, leaf.start_byte));
    if (!sameSentence) throw new CompileError(`A ${leaf.family_id} of "that many" needs the mortal wounds it counts before it in its sentence.`);
    const count = String(wounds.parameters.count);
    if (!DICE.test(count)) {
      out[index] = { ...leaf, parameters: { ...leaf.parameters, [reader.field]: reader.fixed(count) } };
      return;
    }
    pairs += 1;
    const name = pairs === 1 ? "that-many" : `that-many-${pairs}`;
    out[at] = { ...wounds, parameters: { ...wounds.parameters, count_var: name } };
    out[index] = { ...leaf, parameters: { ...leaf.parameters, [reader.bound]: name } };
  });
  return out;
}

/** A mortal-wounds count that reads the pair's roll, with the dice the roll makes (lowered by compile-fragments.ts). */
export function thatManyCount(name: string, dice: string): Node {
  return { roll_var: name, [PENDING]: dice };
}

/** Whether a node reads the bound roll `name` anywhere inside it ("that many", possibly under a condition). */
function reads(node: unknown, name: string): boolean {
  if (Array.isArray(node)) return node.some((inner) => reads(inner, name));
  if (node === null || typeof node !== "object") return false;
  const value = node as Node;
  return value.roll_var === name || Object.values(value).some((inner) => reads(inner, name));
}

/**
 * Each pair's roll around the steps from its mortal wounds through the step that reads it, in the
 * sequence that holds both. Refuses a pair whose two effects are not steps of one sequence.
 */
export function wrapThatMany(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(wrapThatMany);
  if (node === null || typeof node !== "object") return node;
  const value = Object.fromEntries(Object.entries(node as Node).map(([key, inner]) => [key, wrapThatMany(inner)])) as Node;
  if (value.type !== "sequence" || !Array.isArray(value.steps)) return value;
  let steps = value.steps as Node[];
  for (let from = 0; from < steps.length; from += 1) {
    const count = ((steps[from]!.modifier as Node | undefined)?.count as Node | undefined);
    if (steps[from]!.type !== "mortal-wounds" || typeof count?.[PENDING] !== "string") continue;
    const name = String(count.roll_var);
    const to = steps.findIndex((step, at) => at > from && reads(step, name));
    if (to === -1) continue;
    const { [PENDING]: dice, ...reference } = count;
    const wounds = { ...steps[from]!, modifier: { ...(steps[from]!.modifier as Node), count: reference } };
    const run = [wounds, ...steps.slice(from + 1, to + 1)];
    steps = [...steps.slice(0, from), { type: "roll", dice, roll_var: name, effect: { type: "sequence", steps: run } }, ...steps.slice(to + 1)];
  }
  return { ...value, steps };
}

/** Throws when a pair was left unwrapped: its mortal wounds still carry the pending marker. */
export function refuseUnwrappedThatMany(node: unknown): void {
  if (JSON.stringify(node ?? null).includes(`"${PENDING}"`)) {
    throw new CompileError("The mortal wounds and the \"that many\" that counts them are not steps of one sequence, so they cannot share one roll.");
  }
}
