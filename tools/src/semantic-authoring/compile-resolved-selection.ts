import { CompileError } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * "Each time a model in your unit makes a ranged attack that targets an enemy unit within 6", add 1
 * to the Wound roll. If one or more enemy models are destroyed as the result of those attacks,
 * select one of those destroyed models; …": "those attacks" are the gated attacks, but the
 * selection happens once, after they resolve, not per attack. The attacks-resolved part a per-attack
 * gate wraps moves out beside the gated effects; the gate's target conditions become conditions on
 * the selected unit (the destroyed model's unit was the attacks' target), its attacker conditions
 * conditions on this unit (which made them), and the attack type is the part's own trigger filter.
 */

const flatAnd = (condition: Node): Node[] =>
  condition.operator === "and" && Array.isArray(condition.operands) ? (condition.operands as Node[]).flatMap(flatAnd) : [condition];

const allOf = (nodes: Node[]): Node => (nodes.length === 1 ? nodes[0]! : { operator: "and", operands: nodes });

/** An attacks-resolved part whose selection takes only units that lost models to those attacks. */
function isResolvedSelection(node: unknown): node is Node {
  if (node === null || typeof node !== "object") return false;
  const part = node as Node;
  const trigger = part.trigger as Node | undefined;
  const effect = part.effect as Node | undefined;
  if (part.type !== "ability-part" || trigger?.event !== "attacks-resolved" || effect?.type !== "select-units") return false;
  const eligibility = (effect.selector as Node | undefined)?.eligibility as Node | undefined;
  return eligibility !== undefined && flatAnd(eligibility).some((item) => item.type === "happened"
    && (item.parameters as Node).event === "model-destroyed" && (item.parameters as Node).window === "event");
}

/** A gate's units renamed from the attack's sides to the part's: defender to the selected unit, attacker to this unit. */
function renamed(node: unknown): unknown {
  if (node === "defender") return "selected-unit";
  if (node === "attacker") return "this-unit";
  if (Array.isArray(node)) return node.map(renamed);
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(Object.entries(node as Node).map(([key, value]) => [key, renamed(value)]));
}

const mentions = (node: Node, unit: string) => JSON.stringify(node).includes(`"${unit}"`);

/** The part outside the gate: the attack type on its trigger, the target conditions on its selection. */
function hoisted(part: Node, gates: Node[], attackType: unknown): Node {
  const trigger = part.trigger as Node;
  const filter = (trigger.filter ?? {}) as Node;
  if (attackType !== "any" && filter.attack_type !== attackType) {
    throw new CompileError(`The attacks-resolved part after ${String(attackType)} attacks resolves ${String(filter.attack_type ?? "any")} attacks; "those attacks" name the gated ones.`);
  }
  const rest = gates.filter((gate) => gate.type !== "attack-is");
  // A gate on the weapon or the attack itself has no reading once the attacks have resolved.
  const unreadable = rest.find((gate) => /"(?:weapon|attack)[a-z_-]*"/u.test(JSON.stringify(gate)) && !mentions(gate, "defender") && !mentions(gate, "attacker"));
  if (unreadable) throw new CompileError("A per-attack gate on the weapon or the attack itself cannot carry to the selection after those attacks resolve.");
  const onTarget = rest.filter((gate) => mentions(gate, "defender")).map((gate) => renamed(gate) as Node);
  const onUnit = rest.filter((gate) => !mentions(gate, "defender")).map((gate) => renamed(gate) as Node);
  const effect = part.effect as Node;
  const selector = effect.selector as Node;
  const eligibility = onTarget.length ? allOf([...flatAnd(selector.eligibility as Node), ...onTarget]) : selector.eligibility;
  const selection: Node = { ...effect, selector: { ...selector, eligibility } };
  return { ...part, effect: onUnit.length ? { type: "conditional", condition: allOf(onUnit), effect: selection } : selection };
}

/** Moves every attacks-resolved selection out of the per-attack gate around it. */
export function hoistResolvedSelections(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(hoistResolvedSelections);
  if (node === null || typeof node !== "object") return node;
  const record = node as Node;
  if (record.type === "conditional" && record.condition && typeof record.condition === "object") {
    const gates = flatAnd(record.condition as Node);
    const attack = gates.find((gate) => gate.type === "attack-is");
    const body = record.effect as Node;
    const steps = body?.type === "sequence" ? (body.steps as Node[]) : [body];
    const parts = steps.filter(isResolvedSelection);
    if (attack && parts.length) {
      const kept = steps.filter((step) => !parts.includes(step)).map(hoistResolvedSelections) as Node[];
      const gated: Node[] = kept.length ? [{ ...record, effect: kept.length === 1 ? kept[0]! : { ...body, steps: kept } }] : [];
      const moved = parts.map((part) => hoisted(part, gates, (attack.parameters as Node).attack_type));
      return { type: "sequence", steps: [...gated, ...moved] };
    }
  }
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, hoistResolvedSelections(value)]));
}
