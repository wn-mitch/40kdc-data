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
export function bindPrecedingRolls(input: readonly CompileLeaf[]): CompileLeaf[] {
  const leaves = bindTestTakers(foldTestModifiers(input));
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

/**
 * "Each enemy unit … must take a Battle-shock test, subtracting 1 from that test": a change to
 * the test right before it in its fragment (past any conditions on the change) is a change to
 * the roll of the unit taking that test, not this unit's. compile-fragments.ts lowers
 * `test_taker` as the modifier's target.
 */
function bindTestTakers(leaves: readonly CompileLeaf[]): readonly CompileLeaf[] {
  return leaves.map((leaf, index) => {
    // Past the conditions on the change ("if that enemy unit is Battle-shocked, subtract 1 …").
    let at = index - 1;
    while (leaves[at]?.role === "CONDITION" && leaves[at]!.fragment === leaf.fragment) at -= 1;
    const test = leaves[at];
    if (leaf.family_id !== "roll-modifier" || test?.family_id !== "test" || test.fragment !== leaf.fragment) return leaf;
    const roll = leaf.parameters.roll === "preceding" ? test.parameters.test : leaf.parameters.roll;
    const taker = test.parameters.target;
    // A Desperate Escape test is the hazard rolls of the Desperate Escape mode ("-1 to those hazard rolls").
    const same = roll === test.parameters.test || (roll === "hazard" && test.parameters.test === "desperate-escape");
    if (!same || typeof taker !== "string" || taker === "this-unit") return leaf;
    return { ...leaf, parameters: { ...leaf.parameters, roll, test_taker: taker } };
  });
}

/**
 * "Must take a Battle-shock test, subtracting 1 from that test": a plain change right after the
 * test, with no condition of its own, is that test's own modifier, not a standing change to every
 * later test.
 */
function foldTestModifiers(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  const out: CompileLeaf[] = [];
  for (const leaf of leaves) {
    const test = out.at(-1);
    const value = leaf.parameters.value;
    if (leaf.family_id === "roll-modifier" && test?.family_id === "test" && test.fragment === leaf.fragment
      && test.parameters.modifier === undefined && typeof value === "number" && leaf.parameters.weapon_type === undefined
      && (leaf.parameters.roll === "preceding" || leaf.parameters.roll === test.parameters.test
        || (leaf.parameters.roll === "hazard" && test.parameters.test === "desperate-escape"))) {
      out[out.length - 1] = { ...test, end_byte: leaf.end_byte, parameters: { ...test.parameters, modifier: leaf.parameters.operation === "subtract" ? -value : value } };
      continue;
    }
    out.push(leaf);
  }
  return out;
}

type Node = Record<string, unknown>;

/**
 * "Must take a Desperate Escape test. When doing so, if that enemy unit is Battle-shocked,
 * subtract 1 from each of those tests": a change to the test just taken that holds only under a
 * condition cannot ride on the test's own modifier, and as a later step it would change rolls
 * after the test was taken. The test splits in two, one per side of the condition, so exactly
 * one of them is taken: with the change while the condition holds, without it otherwise.
 */
export function foldConditionalTestModifiers(node: Node): Node {
  if (node.type === "sequence" && Array.isArray(node.steps)) {
    const steps: Node[] = [];
    for (const step of (node.steps as Node[]).map(foldConditionalTestModifiers)) {
      const test = steps.at(-1);
      const change = step.type === "conditional" ? step.effect as Node : undefined;
      const modifier = change?.modifier as Node | undefined;
      const testModifier = test?.modifier as Node | undefined;
      const roll = modifier?.roll;
      const same = test?.type === "test" && change?.type === "roll-modifier" && change.target === test.target && testModifier?.modifier === undefined
        && (roll === testModifier?.test || (roll === "hazard" && testModifier?.test === "desperate-escape"))
        && (modifier!.operation === "add" || modifier!.operation === "subtract") && typeof modifier!.value === "number"
        && Object.keys(modifier!).every((key) => ["roll", "operation", "value"].includes(key));
      if (!same) { steps.push(step); continue; }
      const value = (modifier!.operation === "subtract" ? -1 : 1) * (modifier!.value as number);
      steps[steps.length - 1] = { type: "conditional", condition: step.condition, effect: { ...test, modifier: { ...testModifier, modifier: value } } };
      steps.push({ type: "conditional", condition: { operator: "not", operands: [step.condition] }, effect: test });
    }
    return steps.length === 1 ? steps[0]! : { ...node, steps };
  }
  for (const key of ["effect", "then"]) {
    if (node[key] && typeof node[key] === "object" && !Array.isArray(node[key])) return { ...node, [key]: foldConditionalTestModifiers(node[key] as Node) };
  }
  return node;
}
