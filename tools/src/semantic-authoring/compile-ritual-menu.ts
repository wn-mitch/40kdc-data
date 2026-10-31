import { closed, CompileError, effect, type CompileLeaf } from "./compile-fragments.js";
import { PSYCHIC_TEST_ROLL, RITUAL_MANIFEST, TEST_DOUBLES } from "./psychic-families.js";

type Node = Record<string, unknown>;

/** One Ritual as compile-containers.ts reads a named option: its id, name, compiled effect and marker leaf. */
export type RitualOption = { id: string; name: unknown; effect: Node; marker: CompileLeaf };

/** What a ritual menu's Psychic test is printed with, between the menu leaf and the first Ritual. */
const TEST_FAMILIES = new Set(["dice-roll", "optional-use", TEST_DOUBLES, "mortal-wounds", RITUAL_MANIFEST]);

/**
 * Whether a leaf printed before the first Ritual belongs to the Psychic test: its rolls, the doubles
 * check and what it costs, the manifest rule, and "select one Ritual no model from your army has
 * attempted … this turn" (a once-per-turn limit per army). Anything else ("select one model … that has
 * not yet attempted a Ritual this turn", once per turn per model) is the record's own and goes back to it.
 */
export function isRitualTestLeaf(leaf: CompileLeaf): boolean {
  return TEST_FAMILIES.has(leaf.family_id) || (leaf.family_id === "usage-limit" && leaf.parameters.per === "army");
}

/**
 * "… can attempt Rituals from those listed …. select one Ritual no model from your army has attempted
 * …, then take a Psychic test …: Roll 2D6. Optionally, you can roll one additional D6. Then, if one or
 * more doubles or triples were rolled …, that model's unit suffers D3 mortal wounds. If that model is not
 * destroyed, … If this equals or exceeds the Warp Charge value …, that model manifests that Ritual" and
 * the Rituals after it: the DSL's ritual-menu. The test is one roll, then optionally one more die; the
 * doubles check and the effects after it are its perils. Each Ritual names its Warp Charge.
 */
export function buildRitualMenu(test: readonly CompileLeaf[], rituals: readonly RitualOption[]): Node {
  const rolls = test.filter((leaf) => leaf.family_id === "dice-roll");
  if (rolls.length === 0 || rolls.length > 2) throw new CompileError(`A ritual menu's Psychic test is one roll, optionally with one more die; found ${rolls.length} dice rolls.`);
  const testNode: Node = { dice: closed(rolls[0]!, "dice"), kind: "psychic", roll_var: PSYCHIC_TEST_ROLL };
  const offer = test.find((leaf) => leaf.family_id === "optional-use");
  if (rolls.length === 2) {
    // "Optionally, you can roll one additional D6": the player's choice comes right before the extra die.
    if (offer === undefined || test.indexOf(offer) > test.indexOf(rolls[1]!)) throw new CompileError("A ritual menu's second die is the one more die the player can roll; it needs the optional-use before it.");
    if (!["D3", "D6"].includes(String(rolls[1]!.parameters.dice))) throw new CompileError("A ritual menu's extra die is one D3 or D6.");
    testNode.extra_die = { dice: closed(rolls[1]!, "dice"), optional: true };
  } else if (offer !== undefined) {
    throw new CompileError("A ritual menu's optional-use offers the test's extra die, but no second die follows.");
  }
  const doubles = test.filter((leaf) => leaf.family_id === TEST_DOUBLES);
  const costs = test.filter((leaf) => leaf.family_id === "mortal-wounds");
  if (doubles.length > 1) throw new CompileError("A ritual menu's Psychic test checks its doubles once.");
  if (doubles.length === 1) {
    // The perils are what the doubles check gates: every effect after it.
    const after = costs.filter((leaf) => test.indexOf(leaf) > test.indexOf(doubles[0]!));
    if (after.length !== costs.length) throw new CompileError("A ritual menu's test effect comes after its doubles check.");
    if (after.length === 0) throw new CompileError("A ritual menu's doubles check needs the effect it causes after it.");
    const nodes = after.map((leaf) => effect(leaf, { attached: false, attacker: null, incoming: false }));
    testNode.perils = { on: closed(doubles[0]!, "on"), effect: nodes.length === 1 ? nodes[0]! : { type: "sequence", steps: nodes } };
  } else if (costs.length > 0) {
    throw new CompileError("A ritual menu's test effect needs the doubles check that causes it.");
  }
  if (test.filter((leaf) => leaf.family_id === RITUAL_MANIFEST).length !== 1) throw new CompileError("A ritual menu needs exactly one ritual-manifest rule: when the test manifests the Ritual.");
  const limits = test.filter((leaf) => leaf.family_id === "usage-limit");
  if (limits.length !== 1 || limits[0]!.parameters.frequency !== "once-per-turn") {
    throw new CompileError("A ritual menu needs one once-per-turn limit per army on each Ritual (\"select one Ritual no model from your army has attempted … this turn\").");
  }
  return {
    type: "ritual-menu",
    test: testNode,
    ritual_limit: { frequency: "once-per-turn", per: "army" },
    rituals: rituals.map(({ id, name, effect: body, marker }) => {
      if (marker.parameters.warp_charge === undefined) throw new CompileError(`The Ritual ${String(name)} needs its warp_charge.`);
      return { id, name, warp_charge: closed(marker, "warp_charge"), effect: body };
    }),
  };
}
