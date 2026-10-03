import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/** Rolls an event can name that a roll-modifier can change too. */
const MODIFIABLE_ROLLS = new Set(["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage", "hazard", "psychic", "desperate-escape"]);

/** The roll a leaf makes or names, when a later "that roll" can mean it. */
function rollOf(leaf: CompileLeaf): { kind: "dice" } | { kind: "named"; roll: string } | null {
  if (leaf.family_id === "dice-roll") return { kind: "dice" };
  if (leaf.family_id === "test") return { kind: "named", roll: String(leaf.parameters.test) };
  if (leaf.family_id === "event" && (leaf.parameters.kind === "before-roll" || leaf.parameters.kind === "after-roll")) return { kind: "named", roll: String(leaf.parameters.roll) };
  return null;
}

/**
 * Bind each roll-modifier whose roll is `preceding` ("adding 1 to the result", "with +1 to that
 * roll") to the nearest roll before it in the record. A test or a roll event names the roll it
 * changes. The ability's own dice roll takes the change into its dice ("D6" + "+1" → "D6+1"),
 * so the result bands after it read the changed result; that leaf then says nothing more. A
 * change the dice cannot carry (a subtraction, a several-dice roll) refuses, as does a
 * modifier with no roll before it.
 */
export function bindPrecedingRolls(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  if (!leaves.some((leaf) => leaf.family_id === "roll-modifier" && leaf.parameters.roll === "preceding")) return [...leaves];
  const out = [...leaves];
  const dropped = new Set<number>();
  out.forEach((leaf, index) => {
    if (leaf.family_id !== "roll-modifier" || leaf.parameters.roll !== "preceding") return;
    let at = index - 1;
    while (at >= 0 && rollOf(out[at]!) === null) at -= 1;
    const source = at >= 0 ? rollOf(out[at]!) : null;
    if (source === null) throw new CompileError(`roll-modifier at byte ${leaf.start_byte} changes "that roll", but no roll or test comes before it.`);
    if (source.kind === "named") {
      if (!MODIFIABLE_ROLLS.has(source.roll)) throw new CompileError(`roll-modifier at byte ${leaf.start_byte} changes a ${source.roll} roll, which a roll modifier cannot name.`);
      out[index] = { ...leaf, parameters: { ...leaf.parameters, roll: source.roll } };
      return;
    }
    const dice = out[at]!;
    const value = leaf.parameters.value;
    if (leaf.parameters.operation !== "add" || typeof value !== "number" || value < 1) throw new CompileError("Only adding a number to this ability's own roll folds into its dice.");
    if (dice.parameters.count !== undefined || dice.parameters.per_model !== undefined) throw new CompileError("A change to a roll of several dice has no DSL shape.");
    out[at] = { ...dice, parameters: { ...dice.parameters, bonus: Number(dice.parameters.bonus ?? 0) + value } };
    dropped.add(index);
  });
  return out.filter((_, index) => !dropped.has(index));
}
