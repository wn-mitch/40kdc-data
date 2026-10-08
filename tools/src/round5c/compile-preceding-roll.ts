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
 * modifier with no roll before it, and one a condition in its clause makes conditional (the
 * condition would otherwise gate the whole roll).
 */
export function bindPrecedingRolls(input: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
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
    const adjacent = adjacentCondition(out, index, sourceText);
    const attaches = adjacent === "attach";
    // Two changes to one roll, at least one conditional, have no DSL shape. Checked before the
    // condition between them, which is the first change's condition and still in the list here.
    if (dice.parameters.conditional_bonus !== undefined && attaches) throw new CompileError("Two changes to one roll, at least one conditional, have no DSL shape (6891: nested deployment-zone bonuses).");
    if (dice.parameters.conditional_bonus !== undefined || (attaches && dice.parameters.bonus !== undefined)) throw new CompileError("An unconditional and a conditional change to one roll have no DSL shape yet.");
    // A condition between the roll and the change ("roll one D6 if X, adding 1") gates the roll itself.
    if (conditionBetween(out, at, index)) throw new CompileError("A conditional change to this ability's own roll has no DSL shape yet.");
    if (adjacent === "refuse") throw new CompileError("A conditional change to this ability's own roll has no DSL shape yet.");
    if (dice.parameters.count !== undefined || dice.parameters.per_model !== undefined) throw new CompileError("A change to a roll of several dice has no DSL shape.");
    if (attaches) {
      if (typeof value !== "number" || value < 1 || (leaf.parameters.operation !== "add" && leaf.parameters.operation !== "subtract")) {
        throw new CompileError("Only adding or subtracting a number folds into this ability's own roll as a conditional bonus.");
      }
      // The condition right after the change joins the dice leaf; compile.ts turns it into the
      // bonus's condition node, and compile-dice.ts places the rolls it makes.
      const signed = leaf.parameters.operation === "subtract" ? -value : value;
      out[at] = { ...dice, parameters: { ...dice.parameters, conditional_bonus: { value: signed, leaf: out[index + 1]! } } };
      dropped.add(index);
      dropped.add(index + 1);
      return;
    }
    if (leaf.parameters.operation !== "add" || typeof value !== "number" || value < 1) throw new CompileError("Only adding a number to this ability's own roll folds into its dice.");
    out[at] = { ...dice, parameters: { ...dice.parameters, bonus: Number(dice.parameters.bonus ?? 0) + value } };
    dropped.add(index);
  });
  return out.filter((_, index) => !dropped.has(index));
}

/** A condition leaf of the change's fragment that is not a result band. */
const isClauseCondition = (leaf: CompileLeaf | undefined, change: CompileLeaf): boolean =>
  leaf !== undefined && leaf.role === "CONDITION" && leaf.family_id !== "roll-result" && leaf.fragment === change.fragment;

/** A condition between the roll and the change: it gates the whole roll. */
function conditionBetween(leaves: readonly CompileLeaf[], dice: number, change: number): boolean {
  return leaves.slice(dice + 1, change).some((leaf) => isClauseCondition(leaf, leaves[change]!));
}

/**
 * The condition right after a change, with no sentence break before it. "with +1 to the result if
 * a friendly X model is within 6\"" attaches to the change ("attach"), as one condition leaf. A
 * comma before it ("adding 1 to the result, and if X"), or a second condition leaf with no break
 * after the first (a condition of two leaves cannot be attached as one), is refused ("refuse").
 * A sentence, colon, or semicolon break leaves the condition gating the ability as a whole (null),
 * as does a missing source text.
 */
function adjacentCondition(leaves: readonly CompileLeaf[], change: number, sourceText: string | undefined): "attach" | "refuse" | null {
  if (sourceText === undefined || !isClauseCondition(leaves[change + 1], leaves[change]!)) return null;
  const bytes = Buffer.from(sourceText, "utf8");
  const text = (from: number, to: number) => bytes.subarray(from, to).toString("utf8");
  const first = leaves[change + 1]!;
  const between = text(leaves[change]!.end_byte ?? leaves[change]!.start_byte, first.start_byte);
  if (/[.:;]/u.test(between)) return null;
  if (/,/u.test(between)) return "refuse";
  const second = leaves[change + 2];
  if (isClauseCondition(second, leaves[change]!) && !/[.:;]/u.test(text(first.end_byte ?? first.start_byte, second!.start_byte))) return "refuse";
  return "attach";
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
