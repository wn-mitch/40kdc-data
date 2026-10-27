import { allOf } from "./compile-conditions.js";
import { isRollMarker } from "./compile-dice.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { matchesKey, type ConditionOfPlan, type LeafKey } from "./compile-connective-plan.js";

/**
 * Lowering a planned condition-of (compile-connective-plan.ts) onto the planned effects of one
 * compiled part, after durations wrap each effect and before the part's pieces are built.
 *
 * A permission and its consequents that are the whole of a part with its own moment, and nothing
 * else in the part is optional, lower as that part's choice: the moments of part 0 become optional
 * (as "you can …. If you do, …" does), a later part node takes `optional`. Otherwise the permission
 * and its consequents become one optional ability-part in place of the permission, under the
 * permission's own gate. A shape neither form says exactly is refused; nothing is flattened.
 */

type Node = Record<string, unknown>;

/** The planned-effect fields compile.ts keeps for each effect leaf. */
export type PlannedItem = { index: number; leaf: CompileLeaf; node: Node; gate: Node[]; selected: boolean; replaces: boolean };

export type ConnectiveContext = {
  list: readonly CompileLeaf[];
  /** The part's planned effects, rewritten in place by the nested form. */
  planned: PlannedItem[];
  /** Which part a non-moment leaf belongs to (0 before the first later moment). */
  partOf: (index: number) => number;
  /** The leaf indexes of each part's own moments: part 0's leading moments, then each later part's. */
  partMoments: readonly number[][];
  /** Each leaf's source sentence before effect-less sentences merge. */
  rawOf: readonly number[];
  stratagem: boolean;
  /** An optional-use already makes the ability (or its leading moments) the player's choice. */
  optional: boolean;
  /** The last source sentence holding that optional-use, or -1. */
  optionalSentence: number;
  /** An optional spend is offered by its own part. */
  optionalSpend: boolean;
  aura: boolean;
  /** Several durations under a window part (compile.ts windowInside). */
  splitWindow: boolean;
  /** Leaves a container option consumed. */
  consumed: ReadonlySet<number>;
  /** optional-use leaves that are a designation's own choice. */
  designationOptional: ReadonlySet<number>;
  /** Whether an optional-use offers a later Stratagem target ("you can also target …"). */
  optionalTarget: (index: number) => boolean;
  /** Planned effects lifted out of the parts (designated spends, a loop's tail). */
  held: ReadonlySet<PlannedItem>;
};

export type ConnectiveLowering = {
  /** Part 0 is the permission's choice: its leading moments up to this sentence become optional. */
  optionalSentence: number | null;
  /** Later parts (1-based, as compile.ts numbers them) whose node is optional. */
  optionalParts: Set<number>;
};

const describe = (key: LeafKey) => key.family_id;
const same = (left: Node, right: Node) => JSON.stringify(left) === JSON.stringify(right);

/** Lower every plan; throws a CompileError for a shape with no exact reading (R5, R7, R8). */
export function lowerConditionOf(plans: readonly ConditionOfPlan[], context: ConnectiveContext): ConnectiveLowering {
  const result: ConnectiveLowering = { optionalSentence: null, optionalParts: new Set() };
  const indexOf = (key: LeafKey) => context.list.findIndex((leaf) => matchesKey(leaf, key));
  const partHolding = (index: number) => {
    const moment = context.partMoments.findIndex((moments) => moments.includes(index));
    return moment === -1 ? context.partOf(index) : moment;
  };
  for (const plan of plans) {
    // A history condition (compile-connective-history.ts) was lowered onto its leaf before the parts were planned.
    if (plan.kind === "history") continue;
    if (plan.kind === "use") {
      checkUseCovers(plan, indexOf(plan.use), indexOf(plan.antecedent), context, partHolding);
      continue;
    }
    const antecedent = indexOf(plan.antecedent);
    if (antecedent === -1) throw new CompileError(`The ${describe(plan.antecedent)} that "if it does" refers back to was folded into another leaf; the permission has no planned effect of its own to make optional.`);
    // A consequent folded into the permission itself (its then_cannot) is already that permission's "if it does".
    const own = context.list[antecedent]!.absorbs ?? [];
    const remaining = plan.consequents.filter((key) => !own.some((item) => item.fragment === key.fragment && item.family_id === key.family_id
      && item.start_byte === key.start_byte && item.end_byte === key.end_byte));
    if (remaining.length === 0) continue;
    const consequents = remaining.map(indexOf);
    const absorbed = remaining.filter((_, at) => consequents[at] === -1);
    if (absorbed.length > 0) throw new CompileError(`The consequents ${absorbed.map(describe).join(", ")} of "if it does" after ${describe(plan.antecedent)} were folded into other leaves, so the gate cannot hold them.`);
    const members = [antecedent, ...consequents];
    const insideContainer = members.filter((index) => context.consumed.has(index));
    // A container option compiles alone (compile.ts nestedPart) and plans its own connective there.
    if (insideContainer.length === members.length) continue;
    if (insideContainer.length > 0) throw new CompileError(`"If it does" after ${describe(plan.antecedent)} crosses into a container option; the option and the effects outside it have no common optional reading.`);
    const items = members.map((index) => context.planned.find((item) => item.index === index));
    if (items.some((item) => item === undefined)) throw new CompileError(`"If it does" after ${describe(plan.antecedent)} names an effect with no planned effect after folding.`);
    const [first, ...rest] = items as PlannedItem[];
    if ([first, ...rest].some((item) => context.held.has(item!))) throw new CompileError(`"If it does" after ${describe(plan.antecedent)} names an effect lifted out of its part (a designated spend or a loop's tail).`);
    const part = context.partOf(antecedent);
    if (consequents.some((index) => context.partOf(index) !== part)) throw new CompileError(`"If it does" after ${describe(plan.antecedent)} gates effects of another part; a gate across a moment has no lowering yet.`);
    const partItems = context.planned.filter((item) => !context.held.has(item) && context.partOf(item.index) === part);
    const laterOffers = context.partMoments.slice(1).some((moments) => moments.some((index) => context.rawOf[index]! <= context.rawOf[antecedent]!));
    const whole = partItems[0] === first && partItems.length === items.length && partItems.every((item) => items.includes(item));
    const normal = !context.stratagem && whole && (context.partMoments[part]?.length ?? 0) > 0 && !context.optional
      && (part > 0 || (!context.optionalSpend && !context.aura && !laterOffers));
    if (normal) {
      if (part === 0) result.optionalSentence = Math.max(result.optionalSentence ?? -1, context.rawOf[antecedent]!);
      else result.optionalParts.add(part);
      continue;
    }
    nest(first!, rest as PlannedItem[], context, plan);
  }
  return result;
}

/** The permission and its consequents as one optional ability-part, in the permission's place. */
function nest(first: PlannedItem, rest: PlannedItem[], context: ConnectiveContext, plan: Extract<ConditionOfPlan, { kind: "permission" }>): void {
  const name = describe(plan.antecedent);
  if ([first, ...rest].some((item) => item.replaces || item.node.type === "choice")) throw new CompileError(`"If it does" after ${name} gates an "instead" or a player's pick; the replacement and the optional part have no common reading yet.`);
  if (rest.some((item) => item.selected !== first.selected)) throw new CompileError(`"If it does" after ${name} gates effects that a unit selection limits differently.`);
  if (context.splitWindow) throw new CompileError(`"If it does" after ${name} sits under a window with several durations; which of its effects last for the window has no decided reading.`);
  const steps = [first.node, ...rest.map((item) => {
    const extra = item.gate.filter((node) => !first.gate.some((shared) => same(shared, node)));
    if (extra.some(isRollMarker)) throw new CompileError(`"If it does" after ${name} gates an effect under a roll result the permission does not share.`);
    const condition = allOf(extra);
    return condition ? { type: "conditional", condition, effect: item.node } : item.node;
  })];
  first.node = { type: "ability-part", optional: true, effect: steps.length === 1 ? steps[0]! : { type: "sequence", steps } };
  for (const item of rest) context.planned.splice(context.planned.indexOf(item), 1);
}

/** R8: an optional-use that "if you do" restates must be the choice that offers the antecedent. */
function checkUseCovers(plan: Extract<ConditionOfPlan, { kind: "use" }>, use: number, antecedent: number, context: ConnectiveContext, partHolding: (index: number) => number): void {
  if (use === -1) return void refuseUse(plan, "was folded into another leaf");
  if (context.consumed.has(use) || context.designationOptional.has(use) || context.optionalTarget(use) || context.optionalSpend) return;
  if (!context.optional) return void refuseUse(plan, "offers nothing the compiler makes optional");
  const part = partHolding(antecedent === -1 ? use : antecedent);
  if (part === 0) return;
  if (!(context.partMoments[part] ?? []).some((index) => context.rawOf[index]! <= context.optionalSentence)) refuseUse(plan, "is not the choice of the part that holds it");
}

function refuseUse(plan: Extract<ConditionOfPlan, { kind: "use" }>, why: string): never {
  throw new CompileError(`The optional-use that "if you do" restates before ${describe(plan.antecedent)} ${why}.`);
}
