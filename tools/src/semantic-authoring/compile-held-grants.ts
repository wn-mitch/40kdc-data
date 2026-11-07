import type { Compiled } from "./compile.js";

/**
 * "While a Warboss model is embarked within this unit, this unit has that Warboss model's **X/Y**
 * ability": the unit gains whichever of X and Y the embarked model has. An ability-record-grant with
 * held_by_model lowers to an ability-grant carrying {@link HELD_BY_MODEL}; this pass finds the
 * conditional around those grants, whose condition matches the model ("matches" with a unit-filter
 * subject), and gives each grant its own copy of that condition with the ability added to the
 * subject's `has_ability`. A held grant outside such a conditional, or beside other effects in it,
 * is refused.
 */

type Node = Record<string, unknown>;

/** The lowering-time mark on a grant held by the model its enclosing condition names. */
export const HELD_BY_MODEL = "__held_by_model";

const isObject = (value: unknown): value is Node => value !== null && typeof value === "object" && !Array.isArray(value);
const isHeld = (node: unknown): node is Node => isObject(node) && node[HELD_BY_MODEL] === true;

/** The grants a conditional's effect holds, when every effect in it is a held grant. */
function heldGrants(effect: unknown): Node[] | null {
  if (isHeld(effect)) return [effect];
  if (isObject(effect) && effect.type === "sequence" && Array.isArray(effect.steps) && effect.steps.length > 0 && effect.steps.every(isHeld)) return effect.steps as Node[];
  return null;
}

function split(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(split);
  if (!isObject(node)) return node;
  if (node.type === "conditional") {
    const grants = heldGrants(node.effect);
    const condition = node.condition as Node | undefined;
    const subject = isObject(condition) && condition.type === "matches" && isObject(condition.parameters) ? condition.parameters.subject : undefined;
    if (grants && isObject(subject)) {
      const steps = grants.map((grant) => {
        const { [HELD_BY_MODEL]: _held, ...plain } = grant;
        const ability = (plain.modifier as Node).ability as string;
        const owned = [...new Set([...((subject.has_ability as string[] | undefined) ?? []), ability])].sort();
        const parameters = { ...(condition!.parameters as Node), subject: { ...subject, has_ability: owned } };
        return { ...node, condition: { ...condition, parameters }, effect: plain };
      });
      return steps.length === 1 ? steps[0] : { type: "sequence", steps };
    }
  }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, split(value)]));
}

/** Whether a held mark survived the split anywhere in the mechanics. */
const anyHeld = (node: unknown): boolean => Array.isArray(node) ? node.some(anyHeld) : isObject(node) && (node[HELD_BY_MODEL] === true || Object.values(node).some(anyHeld));

/** Split every conditional around held grants; refuse a held grant no condition names the model of. */
export function splitHeldGrants(result: Compiled & { ok: true }): Compiled {
  if (!anyHeld(result.mechanics)) return result;
  const mechanics = split(result.mechanics) as typeof result.mechanics;
  if (anyHeld(mechanics)) {
    return { ok: false, signature: result.signature, errors: ["\"that model's ability\" (held_by_model) needs a while-condition about that model around grants only."] };
  }
  return { ...result, mechanics };
}
