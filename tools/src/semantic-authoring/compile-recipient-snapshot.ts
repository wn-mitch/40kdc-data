type Node = Record<string, unknown>;

/** Resolve all model recipients at a battle-start activation, rather than re-testing membership during the battle. */
export function battleStartSnapshot(effect: Node, trigger: unknown, lifetime: unknown): { effect: Node; trigger: unknown } {
  if (lifetime !== "battle" || !trigger || typeof trigger !== "object" || Array.isArray(trigger)
    || (trigger as Node).event !== "battle-started") return { effect, trigger };
  const body = effect.type === "conditional" ? effect.effect as Node : effect;
  const steps = body.type === "sequence" ? body.steps as Node[] : [body];
  const filter = steps[0]?.target;
  if (!filter || typeof filter !== "object" || Array.isArray(filter) || (filter as Node).level !== "model"
    || (filter as Node).member_of === undefined) return { effect, trigger };
  if (!steps.every((step) => JSON.stringify(step.target) === JSON.stringify(filter))) return { effect, trigger };
  const bound = steps.map((step) => ({ ...step, target: "recipient" }));
  const previous = (trigger as Node).condition;
  const condition = effect.type === "conditional"
    ? previous ? { operator: "and", operands: [previous, effect.condition] } : effect.condition
    : previous;
  return {
    trigger: { ...(trigger as Node), ...(condition ? { condition } : {}) },
    effect: {
      type: "for-each-unit", selector: { filter },
      effect: bound.length === 1 ? bound[0]! : { type: "sequence", steps: bound },
    },
  };
}
