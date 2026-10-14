import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * Attacks named again or aimed at an earlier unit (attack@6):
 *
 * - `refers: earlier-attack` ("If that attack targets …", "each time such an attack …") is the
 *   nearest earlier attack leaf of the record. It takes that leaf's direction, unit and type, so
 *   the conditions after it bind to the same attack: a unit-filter after it is the attack's
 *   target (compile-unit-filters.ts), never its attacker.
 * - `target: that-unit` ("an X unit … targets that unit") is an attack on the unit a designation
 *   before it names, else on the selected unit.
 */

type Node = Record<string, unknown>;

/** Whether a leaf is an attack that points back to an earlier one, resolved or not. */
export function isBackref(leaf: CompileLeaf): boolean {
  return leaf.family_id === "attack" && (leaf.parameters.backref === true || leaf.parameters.refers !== undefined);
}

const TYPED = new Set(["melee", "ranged", "psychic"]);

/**
 * Each back-referring attack, with the direction, unit and type of the attack it points back to.
 * It carries `backref: true`, and `repeat_gate: true` when its own melee/ranged/psychic gate must
 * still be applied: it printed a narrower type than its antecedent ("those ranged attacks" after
 * "an attack"), or its antecedent comes after the ability's first effect, where that antecedent's
 * own gate holds only for its own sentence or clause.
 */
export function resolveAttackBackrefs(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === "attack" && leaf.parameters.refers !== undefined)) return [...list];
  const firstEffect = list.findIndex((leaf) => leaf.role === "EFFECT");
  return list.map((leaf, index) => {
    if (leaf.family_id !== "attack" || leaf.parameters.refers === undefined) return leaf;
    if (leaf.parameters.refers === "earlier-permission") {
      const earlier = list.slice(0, index);
      const boundary = earlier.map((other) => other.fragment !== leaf.fragment
        || (other.role === "EVENT" && other.family_id !== "select-unit" && other.family_id !== "attack")).lastIndexOf(true);
      const candidates = earlier.slice(boundary + 1).filter((other) => other.family_id === "eligibility-permission");
      if (candidates.length !== 1) throw new CompileError("'Those attacks' requires one preceding attack permission in its event context.");
      const permission = candidates[0]!;
      const { activity, allow, subject } = permission.parameters;
      if (allow !== true || (activity !== "shoot" && activity !== "fight")) {
        throw new CompileError("'Those attacks' requires an allowed shoot or fight permission.");
      }
      const attackType = activity === "shoot" ? "ranged" : "melee";
      if (leaf.parameters.attack_type !== undefined && leaf.parameters.attack_type !== attackType) {
        throw new CompileError("'Those attacks' names a different attack type from its permission.");
      }
      return { ...leaf, parameters: {
        direction: "makes", unit: subject === "this-model" ? "this-model" : subject === "this-unit" ? "this-unit" : "that-unit",
        attack_type: attackType, permission_start: permission.start_byte,
      } };
    }
    const at = list.slice(0, index).map((other) => other.family_id === "attack" && other.parameters.refers === undefined).lastIndexOf(true);
    if (at === -1) throw new CompileError("'That attack' points back to an attack, but no attack leaf comes before it.");
    const antecedent = list[at]!.parameters;
    const printed = leaf.parameters.attack_type;
    const own = String(antecedent.attack_type);
    if (printed !== undefined && TYPED.has(own) && printed !== own) {
      throw new CompileError(`'Those ${String(printed)} attacks' names a different attack type from the attack it points back to.`);
    }
    const narrowed = printed !== undefined && !TYPED.has(own);
    const parameters: Node = {
      direction: antecedent.direction, unit: antecedent.unit, attack_type: narrowed ? printed : antecedent.attack_type, backref: true,
      ...(narrowed || firstEffect === -1 || at > firstEffect ? { repeat_gate: true } : {}),
    };
    return { ...leaf, parameters };
  });
}

/** Whether an attack leaf adds its own melee/ranged/psychic gate: a back-reference only when it must repeat one. */
export function addsAttackGate(leaf: CompileLeaf): boolean {
  return leaf.parameters.framed !== true && (leaf.parameters.backref !== true || leaf.parameters.repeat_gate === true);
}

/**
 * How an attack's `target: that-unit` binds, in order of precedence: to the unit of a designation
 * before it in its fragment ("While a unit is assailed, when an X unit targets that unit"), whose
 * check bindDesignationSubjects already puts on the defender, so nothing more is emitted; else to
 * the unit a select-unit earlier in the record chose, which scopes the attack's effects to that
 * unit as "the target is the selected unit" does. Anything else is refused.
 */
export function attackTargetBinding(list: readonly CompileLeaf[], index: number): "designation" | "selected" {
  const attack = list[index]!;
  const earlier = list.slice(0, index);
  if (earlier.some((leaf) => leaf.family_id === "designated-filter" && leaf.fragment === attack.fragment && leaf.parameters.subject === "defender"
    && leaf.parameters.count_min === undefined && leaf.parameters.count_max === undefined)) return "designation";
  if (earlier.some((leaf) => leaf.family_id === "select-unit")) return "selected";
  throw new CompileError("An attack targets 'that unit', but no designation or selection before it names the unit.");
}
