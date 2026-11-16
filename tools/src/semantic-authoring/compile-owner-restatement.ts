/**
 * "One unit from your army with this ability can use it", "select one X unit from your army",
 * "each time a X model from your army makes an attack": the "from your army" restates a side the
 * record already fixes (the ability's holder, a selection's or attacker's friendly filter). When no
 * fold claims that leaf, it lowers to a `matches {owner: friendly}` with no subject, which names
 * the ability's own unit and always holds. This pass drops that operand from conditionals.
 *
 * A subjectless `matches` inside a for-each-unit body, or in a selector's eligibility, names the
 * loop's or candidate's unit instead, which may be an enemy unit, so those are left alone.
 */

type Node = Record<string, unknown>;

const isObject = (value: unknown): value is Node => value !== null && typeof value === "object" && !Array.isArray(value);

/** Whether a condition is the holder-side restatement: a subjectless `matches` whose only filter key is owner friendly. */
function isOwnSideRestatement(node: unknown): boolean {
  if (!isObject(node) || node.type !== "matches" || !isObject(node.parameters)) return false;
  const { parameters } = node;
  if (Object.keys(parameters).some((key) => key !== "filter")) return false;
  const filter = parameters.filter;
  return isObject(filter) && Object.keys(filter).length === 1 && filter.owner === "friendly";
}

/** The condition without restatement operands; null when nothing is left. */
function withoutRestatement(condition: unknown): unknown {
  if (isOwnSideRestatement(condition)) return null;
  if (!isObject(condition) || condition.operator !== "and" || !Array.isArray(condition.operands)) return condition;
  const operands = condition.operands.filter((operand) => !isOwnSideRestatement(operand));
  if (operands.length === condition.operands.length) return condition;
  if (operands.length === 0) return null;
  return operands.length === 1 ? operands[0] : { ...condition, operands };
}

/** The effect tree with holder-side restatements dropped from its conditionals, outside for-each-unit bodies. */
export function dropOwnSideRestatements(node: unknown, inLoop = false): unknown {
  if (Array.isArray(node)) return node.map((item) => dropOwnSideRestatements(item, inLoop));
  if (!isObject(node)) return node;
  const loop = inLoop || node.type === "for-each-unit";
  const out: Node = {};
  for (const [key, value] of Object.entries(node)) {
    // A selector's eligibility reads its candidate, not the holder.
    out[key] = key === "selector" ? value : dropOwnSideRestatements(value, loop);
  }
  if (inLoop || node.type !== "conditional" || !("condition" in out)) return out;
  const condition = withoutRestatement(out.condition);
  if (condition === out.condition) return out;
  // Nothing else gated the effect: the conditional is the effect alone.
  return condition === null ? out.effect : { ...out, condition };
}
