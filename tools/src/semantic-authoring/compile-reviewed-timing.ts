import { compileStratagemActivation } from "./compile-stratagem-activation.js";
import { duration } from "./compile-conditions.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { foldHolderAbilities } from "./compile-holder-abilities.js";
import { trigger } from "./compile-triggers.js";
import { dslUnitFilter } from "./compile-unit-filters.js";
import { resolveUnitNames, type UnitNameContext } from "./compile-unit-names.js";
import { selectUnit } from "./compile-wrappers.js";

type Node = Record<string, any>;

function combine(...conditions: unknown[]): Node | undefined {
  const present: Node[] = [];
  for (const value of conditions) {
    if (value == null) continue;
    if (typeof value !== "object" || Array.isArray(value)) throw new CompileError("A compiled trigger condition must be an object.");
    present.push(value as Node);
  }
  return present.length === 0 ? undefined : present.length === 1 ? present[0] : { operator: "and", operands: present };
}

function event(leaves: readonly CompileLeaf[], predicate: (leaf: CompileLeaf) => boolean): CompileLeaf | undefined {
  return leaves.find((leaf) => leaf.family_id === "event" && predicate(leaf));
}

function unitFilter(leaf: CompileLeaf): Node {
  return dslUnitFilter(leaf);
}

function phaseCondition(parameters: Record<string, unknown>): Node | undefined {
  const your = Array.isArray(parameters.your_phases) ? parameters.your_phases as string[] : [];
  const opponent = Array.isArray(parameters.opponent_phases) ? parameters.opponent_phases as string[] : [];
  const either = Array.isArray(parameters.either_phases) ? parameters.either_phases as string[] : [];
  const branches: Node[] = [
    ...your.map((phase) => ({ operator: "and", operands: [{ type: "phase-is", parameters: { phase } }, { type: "player-turn-is", parameters: { turn: "your-turn" } }] })),
    ...opponent.map((phase) => ({ operator: "and", operands: [{ type: "phase-is", parameters: { phase } }, { type: "player-turn-is", parameters: { turn: "opponent-turn" } }] })),
    ...either.map((phase) => ({ type: "phase-is", parameters: { phase } })),
  ];
  return branches.length === 0 ? undefined : branches.length === 1 ? branches[0] : { operator: "or", operands: branches };
}

function phaseWindow(leaves: readonly CompileLeaf[]): Node | undefined {
  const use = leaves.find((leaf) => leaf.family_id === "use-window");
  if (use) return phaseCondition(use.parameters);
  const phase = leaves.find((leaf) => leaf.family_id === "phase-window");
  if (!phase) return undefined;
  return combine(
    { type: "phase-is", parameters: { phase: phase.parameters.phase } },
    phase.parameters.turn === "your" ? { type: "player-turn-is", parameters: { turn: "your-turn" } }
      : phase.parameters.turn === "opponent" ? { type: "player-turn-is", parameters: { turn: "opponent-turn" } } : undefined,
  );
}

function optional(leaves: readonly CompileLeaf[]): boolean {
  return leaves.some((leaf) => leaf.family_id === "optional-use");
}

function localPart(triggerNode: Node, effect: Node): Node {
  return { type: "ability-part", trigger: triggerNode, effect: structuredClone(effect) };
}

function checkedKeys(leaf: CompileLeaf, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(leaf.parameters).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new CompileError(`${label} cannot consume ${leaf.family_id}.${unexpected.join(", ")}.`);
}

function reviewedWithin(leaf: CompileLeaf, subject: string, origin: string, label: string): { range: { inches: number }; wholly?: true } {
  checkedKeys(leaf, ["subject", "kind", "of", "inches", "negated", "wholly"], label);
  if (leaf.parameters.kind !== "within" || leaf.parameters.subject !== subject || leaf.parameters.of !== origin
    || leaf.parameters.negated === true || typeof leaf.parameters.inches !== "number") {
    throw new CompileError(`${label} must be a positive within-distance from ${subject} to ${origin}.`);
  }
  return {
    range: { inches: leaf.parameters.inches },
    ...(leaf.parameters.wholly === true ? { wholly: true as const } : {}),
  };
}

/**
 * A destroyed model opens a one-time selection of eligible model holders, then grants the selected
 * holder a reviewed reaction for a reviewed lifetime. Every source fact comes from a leaf: the
 * destroyed object, holder filter, reach, cardinality, later event and duration are never inferred
 * from an ability id or source spelling.
 */
function compileGrantedSelectionReaction(existing: Node, leaves: readonly CompileLeaf[]): Node | null {
  const selections = leaves.filter((leaf) => leaf.family_id === "select-unit");
  const destroyedModels = leaves.filter((leaf) => leaf.family_id === "event" && leaf.parameters.kind === "model-destroyed");
  if (selections.length === 0 || destroyedModels.length === 0) return null;

  const selection = selections.length === 1 ? selections[0]! : null;
  const destroyedModel = destroyedModels.length === 1 ? destroyedModels[0]! : null;
  const laterUses = selection === null ? [] : leaves.filter((leaf) =>
    leaf.family_id === "event" && leaf.parameters.kind === "used" && leaf.start_byte > selection.start_byte);
  if (laterUses.length === 0) return null;
  if (selection === null || destroyedModel === null || laterUses.length !== 1) {
    throw new CompileError("A granted model reaction needs one destruction, one selection and one later use event.");
  }
  const laterUse = laterUses[0]!;

  checkedKeys(selection, ["scope", "distance", "visible", "count", "up_to", "bind_as"], "A granted model reaction");
  if (selection.parameters.distance !== "any") {
    throw new CompileError("A granted model reaction's reviewed reach comes from unit-position; its select-unit distance must be any.");
  }

  const filters = leaves.filter((leaf) => leaf.family_id === "unit-filter");
  const destroyedFilter = filters.filter((leaf) => leaf.start_byte < destroyedModel.start_byte).at(-1);
  const recipientFilters = filters.filter((leaf) => leaf.start_byte > selection.start_byte && leaf.start_byte < laterUse.start_byte);
  const positions = leaves.filter((leaf) => leaf.family_id === "unit-position"
    && leaf.parameters.subject === "selected-unit" && leaf.start_byte < selection.start_byte);
  const lifetimes = leaves.filter((leaf) => leaf.family_id === "duration"
    && leaf.start_byte > selection.start_byte && leaf.start_byte < laterUse.start_byte);
  const objectAbilities = leaves.filter((leaf) => leaf.family_id === "unit-has-ability"
    && leaf.parameters.subject === "event-object" && leaf.start_byte < selection.start_byte);
  if (!destroyedFilter || recipientFilters.length !== 1 || positions.length !== 1 || lifetimes.length !== 1 || objectAbilities.length === 0) {
    throw new CompileError("A granted model reaction needs reviewed destroyed-model and recipient filters, reach, lifetime and destroyed-object ability eligibility.");
  }
  const recipientFilter = recipientFilters[0]!;
  const position = positions[0]!;
  const lifetime = lifetimes[0]!;

  const reach = reviewedWithin(position, "selected-unit", "event-object", "A granted model reaction's reach");

  let destroyedObject = unitFilter(destroyedFilter);
  const requiredAbilities: string[] = [];
  for (const ability of objectAbilities) {
    checkedKeys(ability, ["subject", "ability", "negated"], "A granted model reaction");
    if (ability.parameters.negated === true || typeof ability.parameters.ability !== "string") {
      throw new CompileError("A granted model reaction's destroyed object must positively require a reviewed ability id.");
    }
    requiredAbilities.push(ability.parameters.ability);
  }
  destroyedObject = { ...destroyedObject, has_ability: [...new Set(requiredAbilities)].sort() };

  const recipient = unitFilter(recipientFilter);
  if (recipient.level !== "model") throw new CompileError("A granted model reaction must select individual models.");
  if (!Array.isArray(recipient.has_ability) || !recipient.has_ability.includes(existing.ability_id)) {
    throw new CompileError("A granted model reaction needs a reviewed recipient filter for holders of this ability.");
  }
  if (selection.parameters.scope !== undefined && selection.parameters.scope !== recipient.owner) {
    throw new CompileError("A granted model reaction's selection side conflicts with its reviewed recipient filter.");
  }

  const selectedByReach: CompileLeaf = {
    ...selection,
    parameters: {
      ...selection.parameters,
      scope: recipient.owner,
      distance: "within",
      inches: reach.range.inches,
      within_origin: position.parameters.of,
      ...(reach.wholly === true ? { wholly: true } : {}),
      filter: recipientFilter.parameters,
    },
  };
  const definition = {
    type: "ability-part",
    trigger: trigger(laterUse),
    duration: duration(lifetime),
    effect: structuredClone(existing.effect),
  };
  const granted = {
    type: "ability-grant",
    target: "selected-unit",
    modifier: { definition },
  };
  const selected = selectUnit(selectedByReach, granted);

  const consumed = new Set<CompileLeaf>([
    selection, destroyedModel, laterUse, destroyedFilter, recipientFilter, position, lifetime, ...objectAbilities,
  ]);
  const unhandled = leaves.filter((leaf) =>
    !consumed.has(leaf) && leaf.role !== "EFFECT"
    && leaf.family_id !== "optional-use" && leaf.family_id !== "phase-window" && leaf.family_id !== "use-window");
  if (unhandled.length) {
    throw new CompileError(`A granted model reaction has unhandled activation metadata: ${unhandled.map((leaf) => leaf.family_id).join(", ")}.`);
  }

  const destroyed = trigger(destroyedModel);
  destroyed.object = destroyedObject;
  destroyed.condition = combine(destroyed.condition, phaseWindow(leaves));
  destroyed.optional = optional(leaves);
  return localPart(destroyed, selected);
}

/**
 * Compile only source-reviewed activation metadata onto an existing mechanical-stage entry.
 * Dispatch is by reviewed leaf families and parameters, never by ability identity. Existing
 * effects remain byte-equivalent subtrees; multipart rules only wrap those subtrees in local parts.
 */
export function compileReviewedTiming(existing: Node, leaves: readonly CompileLeaf[], sourceText?: string, context?: UnitNameContext): Node {
  leaves = foldHolderAbilities(resolveUnitNames(leaves, context), sourceText, existing.ability_id);
  const after = structuredClone(existing);
  const inWhen = leaves.some((leaf) => leaf.fragment === "WHEN");
  if (inWhen) {
    try {
      const activation = compileStratagemActivation(leaves, sourceText);
      after.behavior = activation.behavior;
      if (activation.trigger == null) delete after.trigger;
      else after.trigger = activation.trigger;
      return after;
    } catch (error) {
      const when = leaves.filter((leaf) => leaf.fragment === "WHEN");
      const moment = event(when, () => true);
      const filters = when.filter((leaf) => leaf.family_id === "unit-filter");
      const objective = when.find((leaf) => leaf.family_id === "unit-position" && leaf.parameters.kind === "objective-range");
      if (moment && objective && filters.length === 2 && moment.parameters.kind === "enemy-selected-targets") {
        const node = trigger(moment);
        node.subject = unitFilter(filters[0]!);
        node.object = { ...unitFilter(filters[1]!), within: { range: "objective-control", of: { objective: {} } } };
        node.condition = combine(node.condition, phaseWindow(when));
        after.behavior = "reactive";
        after.trigger = { ...node, optional: true };
        return after;
      }
      if (moment && moment.parameters.same_subject_targeted !== undefined && filters.length === 2) {
        const node = trigger(moment);
        node.subject = unitFilter(filters[0]!);
        node.condition = combine(node.condition, phaseWindow(when), { type: "matches", parameters: { subject: "stratagem-target", filter: unitFilter(filters[1]!) } });
        after.behavior = "reactive";
        after.trigger = { ...node, optional: true };
        return after;
      }
      if (moment && moment.parameters.causes_destruction !== undefined && filters.length >= 1) {
        const node = trigger(moment);
        node.subject = unitFilter(filters[0]!);
        node.condition = combine(node.condition, phaseWindow(when));
        after.behavior = "reactive";
        after.trigger = { ...node, optional: true };
        return after;
      }
      throw error;
    }
  }

  const rawEvents = leaves.filter((leaf) => leaf.family_id === "event").sort((left, right) => left.start_byte - right.start_byte);
  const filters = leaves.filter((leaf) => leaf.family_id === "unit-filter").sort((left, right) => left.start_byte - right.start_byte);
  const hasPhase = leaves.some((leaf) => leaf.family_id === "phase-window");
  if (rawEvents.length === 0) {
    after.behavior = hasPhase ? "activated" : "passive";
    delete after.trigger;
    return after;
  }

  const causal = rawEvents.find((leaf) => leaf.parameters.caused_by_destruction !== undefined || leaf.parameters.object_designated !== undefined);
  if (causal) {
    const node = trigger(causal);
    node.condition = combine(node.condition, phaseWindow(leaves));
    after.behavior = "reactive";
    after.trigger = { ...node, optional: optional(leaves) };
    return after;
  }

  const sameTargetSelections = rawEvents.filter((leaf) => leaf.parameters.kind === "selected" && ["shoot", "fight"].includes(String(leaf.parameters.to)));
  if (sameTargetSelections.length === 2 && filters.length === 1) {
    const subject = unitFilter(filters[0]!);
    after.behavior = "reactive";
    after.trigger = sameTargetSelections.map((leaf) => ({ ...trigger(leaf), subject, optional: optional(leaves) }));
    return after;
  }

  const destruction = rawEvents.find((leaf) => leaf.parameters.kind === "unit-destroyed");
  const beforeRoll = rawEvents.find((leaf) => leaf.parameters.kind === "before-roll");
  if (destruction && beforeRoll) {
    const node = trigger(beforeRoll);
    node.condition = combine(node.condition, phaseWindow(leaves), { type: "happened", parameters: { event: "destroyed", object: "this-unit", window: "event" } });
    after.behavior = "reactive";
    after.trigger = { ...node, optional: optional(leaves) };
    return after;
  }

  const abilityUse = leaves.find((leaf) =>
    leaf.family_id === "ability-use-context"
    || (leaf.family_id === "event" && leaf.parameters.kind === "used" && leaf.parameters.activity === "ability" && leaf.parameters.bind_as !== undefined));
  if (abilityUse) {
    after.behavior = "reactive";
    after.trigger = { ...trigger(abilityUse), optional: optional(leaves) };
    return after;
  }

  const boundaries = rawEvents.filter((leaf) => leaf.parameters.kind === "battle-started" || leaf.parameters.kind === "phase-end");
  if (boundaries.length >= 2 && boundaries.some((leaf) => leaf.parameters.kind === "battle-started")) {
    const unique = new Map(boundaries.map((leaf) => [JSON.stringify(leaf.parameters), leaf]));
    after.behavior = "reactive";
    after.trigger = [...unique.values()].map((leaf) => trigger(leaf));
    return after;
  }

  const selectedMove = rawEvents.find((leaf) => leaf.parameters.kind === "selected" && Array.isArray(leaf.parameters.move_types));
  if (selectedMove) {
    const node = trigger(selectedMove);
    node.condition = combine(node.condition, phaseWindow(leaves));
    after.behavior = "reactive";
    after.trigger = { ...node, optional: optional(leaves) };
    return after;
  }

  const phaseEnd = rawEvents.find((leaf) => leaf.parameters.kind === "phase-end");
  const manoeuvre = rawEvents.find((leaf) => leaf.parameters.kind === "used" && leaf.parameters.activity === "manoeuvre");
  const phaseStart = rawEvents.find((leaf) => leaf.parameters.kind === "phase-start");
  if (after.effect?.type === "sequence" && after.effect.steps?.length === 3 && phaseEnd && manoeuvre && phaseStart && filters.length >= 3) {
    const [first, second, third] = after.effect.steps;
    const position = leaves.find((leaf) => leaf.family_id === "unit-position" && leaf.parameters.of === "event-object");
    const proximity = position === undefined ? undefined : { of: "this-unit", ...reviewedWithin(position, "selected-unit", "event-object", "The destroyed-unit selection reach") };
    const firstTrigger = trigger(phaseEnd);
    firstTrigger.optional = optional(leaves);
    firstTrigger.condition = combine(firstTrigger.condition,
      { type: "matches", parameters: { subject: "this-unit", filter: unitFilter(filters[1]!) } },
      { type: "happened", parameters: { event: "destroyed", object: unitFilter(filters[0]!), window: "phase", ...(proximity ? { proximity } : {}) } });
    const secondTrigger = { ...trigger(manoeuvre), optional: optional(leaves) };
    const thirdTrigger = trigger(phaseStart);
    thirdTrigger.optional = optional(leaves);
    thirdTrigger.condition = combine(thirdTrigger.condition, { type: "matches", parameters: { subject: "this-unit", filter: unitFilter(filters.at(-1)!) } });
    after.behavior = "reactive";
    delete after.trigger;
    after.effect = { type: "sequence", steps: [localPart(firstTrigger, first), localPart(secondTrigger, second), localPart(thirdTrigger, third)] };
    return after;
  }

  const grantedSelectionReaction = compileGrantedSelectionReaction(existing, leaves);
  if (grantedSelectionReaction) {
    after.behavior = "reactive";
    delete after.trigger;
    after.effect = grantedSelectionReaction;
    return after;
  }

  const targetSelection = rawEvents.find((leaf) => leaf.parameters.kind === "targets-selected");
  if (sameTargetSelections.length >= 2 && targetSelection && filters.length >= 2) {
    const enemy = unitFilter(filters[0]!);
    const recipient = unitFilter(filters[1]!);
    after.behavior = "reactive";
    after.trigger = sameTargetSelections.slice(0, 2).map((leaf) => ({
      ...trigger(leaf), subject: enemy, optional: optional(leaves),
      condition: combine({ type: "happened", parameters: { event: "targets-selected", subject: "event-subject", object: "this-unit", filter: { kind: "attack" }, window: "event" } }, { type: "matches", parameters: { subject: "this-unit", filter: recipient } }),
    }));
    return after;
  }

  const direct = rawEvents[0]!;
  const node = trigger(direct);
  node.condition = combine(node.condition, phaseWindow(leaves));
  after.behavior = "reactive";
  after.trigger = { ...node, optional: optional(leaves) };
  return after;
}
