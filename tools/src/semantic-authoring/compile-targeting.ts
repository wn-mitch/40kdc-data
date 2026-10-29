import { anyOf } from "./compile-conditions.js";
import { CompileError } from "./compile-error.js";
import { closed, type CompileLeaf, weaponScope } from "./compile-fragments.js";
import { matchedPoolOf } from "./compile-matched-set.js";

type Node = Record<string, unknown>;

/** The unit that targets, as a condition inside the restriction names it: the unit with the ability. */
const BY_IN_CONDITION: Record<string, string> = { "this-unit": "ability-unit", "this-model": "ability-unit" };

/**
 * One history of the unit being targeted (families/targeting-history.ts), as a condition on the
 * candidate: `this-unit` is the unit being checked as a target, `ability-unit` the unit that targets.
 */
const HISTORY: Record<string, (by: string) => Node> = {
  "engaged-with-by-at-turn-start": (by) => ({ type: "unit-state", parameters: { subject: "this-unit", state: "engaged", with: by, at: "turn-start" } }),
  "attacked-by-another-unit-this-phase": (by) => ({ type: "happened", parameters: { event: "targets-selected", subject: { owner: "any", excluding: by }, object: "this-unit", filter: { kind: "attack" }, window: "phase" } }),
  "charged-by-another-unit-this-phase": (by) => ({ type: "happened", parameters: { event: "targets-selected", subject: { owner: "any", excluding: by }, object: "this-unit", filter: { kind: "charge" }, window: "phase" } }),
};

/** The unit that targets, as a history condition names it; only the ability's own unit or model has one. */
function byInCondition(leaf: CompileLeaf): string {
  const by = BY_IN_CONDITION[String(closed(leaf, "by"))];
  if (by === undefined) throw new CompileError(`targeting-restriction target_history and after_moves are relative to this unit or model, not ${JSON.stringify(leaf.parameters.by)}.`);
  return by;
}

/**
 * A targeting-restriction leaf as targeting effects. enemy-units / friendly-units are every unit of
 * that side; "those X units" is the set an earlier unit-position of matching-unit introduced
 * (compile-matched-set.ts). Version 3 names both sides: the effect sits on the unit that targets
 * when the leaf says which, else on the unit being targeted. Version 6 adds the target's history
 * (`target_condition`), several kinds (one effect each) and a gate on the moves of the unit that targets.
 */
export function targetingEffect(leaf: CompileLeaf, target: (value: unknown) => Node | string): Node {
  const unit = (value: unknown) => value === "matched-units" ? matchedPoolOf(leaf) : value === "enemy-units" ? { owner: "enemy" } : value === "friendly-units" ? { owner: "friendly" } : target(value);
  const range = leaf.parameters.range;
  const kinds = leaf.parameters.kinds === undefined ? [closed(leaf, "kind")] : closed(leaf, "kinds") as unknown[];
  const history = leaf.parameters.target_history as string[] | undefined;
  const condition = history === undefined ? undefined : anyOf(history.map((item) => HISTORY[item]!(byInCondition(leaf))));
  const effects = kinds.map((kind): Node => {
    const modifier: Node = {
      may: closed(leaf, "may"), kind,
      ...weaponScope(leaf),
      ...(range != null ? { range: { inches: range } } : {}),
    };
    if (leaf.parameters.target === undefined) return { type: "targeting", target: unit(closed(leaf, "subject")), modifier };
    const targeted = unit(closed(leaf, "target"));
    const by = leaf.parameters.by === undefined ? undefined : unit(closed(leaf, "by"));
    const named: Node = {
      ...(leaf.parameters.stratagem !== undefined ? { stratagem: closed(leaf, "stratagem") } : {}),
      // kind ability: the one ability whose selection this limits (families/targeting-ability.ts).
      ...(leaf.parameters.ability !== undefined ? { ability: closed(leaf, "ability") } : {}),
      ...(leaf.parameters.except !== undefined ? { except: closed(leaf, "except") } : {}),
      ...(condition !== undefined ? { target_condition: structuredClone(condition) } : {}),
    };
    return { type: "targeting", target: structuredClone(by ?? targeted), modifier: { ...(by !== undefined ? { by } : {}), ...modifier, target: targeted, ...named } };
  });
  const lowered = effects.length === 1 ? effects[0]! : { type: "sequence", steps: effects };
  const afterMoves = leaf.parameters.after_moves as string[] | undefined;
  if (afterMoves === undefined) return lowered;
  // "In a turn in which it Advanced or Fell Back … when doing so": only in a turn the unit that targets made one of these moves.
  // Outside the modifier the unit with the ability is this-unit again.
  byInCondition(leaf);
  const moved = anyOf(afterMoves.map((move) => ({ type: "happened", parameters: { event: "move-ended", subject: "this-unit", filter: { move_types: [move] }, window: "turn" } })));
  return { type: "conditional", condition: moved, effect: lowered };
}
