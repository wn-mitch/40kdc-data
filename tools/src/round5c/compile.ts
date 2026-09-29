import { exactSpan } from "./contracts.js";
import { closed, CompileError, effect, type CompileLeaf } from "./compile-fragments.js";
import {
  allOf, ATTACK_EVENTS, attackTypeCondition, condition, duration, kindKey, negate, targetRestrictions, trigger,
} from "./compile-conditions.js";
import { resolveRolls, rollMarker } from "./compile-dice.js";
import {
  designation, isContainerOpener, planContainers, selectUnit, wrapAura, wrapForEachUnit, wrapLeaderTarget, wrapRulesBundle, WRAP_CONDITION_FAMILIES,
} from "./compile-containers.js";
import { compileNamedRegionState } from "./compile-named-region.js";
import type { CoreCheck } from "./core-checks.js";
import type { Mechanics } from "./entries.js";
import { usageFor } from "./restriction-families.js";

export { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * Deterministic composition: reviewed leaves in source order become one Ability DSL entry.
 * Each family maps to one fixed fragment (`compile-fragments.ts`); these rules combine them:
 *
 * - Clauses. Sentences end at `.`, `;` or `:` (or a change of source fragment); a sentence
 *   with no effect joins the next one. Inside a sentence, an "and", "or" or "(" with an
 *   effect on both sides starts a new clause.
 * - Binding. Conditions before the ability's first effect gate every effect. A condition
 *   before a later sentence's first effect gates that sentence; any other condition gates only
 *   the effects of its own clause, in either word order ("if X, add 1" or "add 1 if X").
 * - Attacks. An attack leaf applies to the effects after it: melee or ranged gates them, the
 *   attacking model sets their target, and an attack that targets this unit moves hit, wound
 *   and damage modifiers onto the attacker.
 * - Instead. An `instead` combinator makes its clause's effect replace the nearest earlier effect
 *   of the same family: the earlier one applies only when the clause's condition does not.
 *   After a no-advance-roll, "instead, add 6\" to Move" is what that fragment already means.
 * - Selected unit. Effects gated by "the target is the selected unit" go inside one
 *   designate-target for the ability's select-unit leaf. Without that gate, the selection is a
 *   select-units around the effects, which name the selected unit ("that unit" suffers mortal wounds).
 * - Rolls. Result bands gate their clause's effects and become dice-gated or dice-table; fighting
 *   on death takes its band and conditions as its own per-model gate (compile-dice.ts).
 * - Stratagem TARGET. The target leaves and every condition in the TARGET fragment compile to
 *   the core record's target_restrictions (conditions become its eligibility), never the effect.
 * - Restrictions. How often compiles to `usage`; a stratagem's phases and an enhancement's
 *   eligible bearers compile to nothing and come back as checks against the core records.
 * - Two or more effects form a sequence in source order; a duration sets `scope.duration`;
 *   events other than attacks and selections become the trigger.
 *
 * No model is involved, so one approved shape produces the same kind of entry for every source.
 */

export type Compiled =
  | { ok: true; signature: string; mechanics: Mechanics; checks: CoreCheck[]; core?: CorePatch }
  | { ok: false; signature: string; errors: string[] };

type Node = Record<string, unknown>;

/** Fields the leaves set on the core record rather than the enrichment entry (a stratagem's target). */
export type CorePatch = { target_restrictions: Node };

/** Where each leaf sits: which sentence and which clause, both counted from zero. */
type Placement = { sentence: number; clause: number };

const ordered = (leaves: readonly CompileLeaf[]) => [...leaves].sort((left, right) => left.start_byte - right.start_byte);

function gapBetween(previous: CompileLeaf, next: CompileLeaf, sourceText: string | undefined): { sentence: boolean; and: boolean } {
  if (previous.fragment !== undefined && next.fragment !== undefined && previous.fragment !== next.fragment) return { sentence: true, and: false };
  if (sourceText === undefined || previous.end_byte === undefined || next.start_byte <= previous.end_byte) return { sentence: false, and: false };
  const gap = exactSpan(sourceText, previous.end_byte, next.start_byte);
  return { sentence: /[.;:]/u.test(gap), and: /\b(?:and|or)\b|\(/iu.test(gap) };
}

function placements(leaves: readonly CompileLeaf[], sourceText: string | undefined): Placement[] {
  const sentenceOf: number[] = [];
  const andBefore: boolean[] = [];
  leaves.forEach((leaf, index) => {
    const gap = index === 0 ? { sentence: false, and: false } : gapBetween(leaves[index - 1]!, leaf, sourceText);
    sentenceOf.push(index === 0 ? 0 : sentenceOf[index - 1]! + (gap.sentence ? 1 : 0));
    andBefore.push(gap.and && !gap.sentence);
  });
  // A sentence without an effect ("While this model is leading a unit.") only sets conditions
  // for what follows, so it joins the next sentence; the last one joins the one before.
  const effectful = new Set(leaves.flatMap((leaf, index) => leaf.role === "EFFECT" ? [sentenceOf[index]!] : []));
  const sentences = [...new Set(sentenceOf)];
  const merged = new Map<number, number>();
  let pending: number[] = [];
  for (const sentence of sentences) {
    pending.push(sentence);
    if (effectful.has(sentence)) {
      for (const item of pending) merged.set(item, sentence);
      pending = [];
    }
  }
  const last = [...effectful].at(-1) ?? sentences.at(-1) ?? 0;
  for (const item of pending) merged.set(item, last);
  sentenceOf.forEach((sentence, index) => { sentenceOf[index] = merged.get(sentence)!; });
  const result: Placement[] = [];
  let clause = 0;
  let clauseStart = 0;
  leaves.forEach((_, index) => {
    if (index > 0 && sentenceOf[index] !== sentenceOf[index - 1]) {
      clause += 1;
      clauseStart = index;
    } else if (index > 0 && andBefore[index]) {
      const sentence = sentenceOf[index];
      const left = leaves.slice(clauseStart, index);
      const right = leaves.slice(index).filter((_, offset) => sentenceOf[index + offset] === sentence);
      if (left.some((leaf) => leaf.role === "EFFECT") && right.some((leaf) => leaf.role === "EFFECT")) {
        clause += 1;
        clauseStart = index;
      }
    }
    result.push({ sentence: sentenceOf[index]!, clause });
  });
  return result;
}

function signaturePart(leaf: CompileLeaf): string {
  if (leaf.family_id === "attack") return `EVENT(attack:${String(leaf.parameters.direction)})`;
  if (leaf.role !== "EVENT") return `${leaf.role}(${leaf.family_id})`;
  if (leaf.family_id === "select-unit") return "EVENT(select-unit)";
  if (leaf.family_id === "dice-roll") return "EVENT(dice-roll)";
  return ATTACK_EVENTS.has(String(leaf.parameters.kind)) ? "EVENT(attack)" : `EVENT(${kindKey(leaf)})`;
}

/**
 * The shape of an ability: its leaves' roles and families in source order, parameters left out,
 * with ` | ` between clauses so the binding of conditions is part of what a reviewer approves.
 * Attacks keep their direction and other events their kind, because both change the structure.
 */
export function shapeSignature(leaves: readonly CompileLeaf[], sourceText?: string): string {
  const list = ordered(leaves);
  const places = placements(list, sourceText);
  return list.map((leaf, index) => `${index > 0 && places[index]!.clause !== places[index - 1]!.clause ? "| " : index > 0 ? "· " : ""}${signaturePart(leaf)}`).join(" ");
}

/** What one leaf contributes on its own, for the per-leaf preview. */
export type LeafFragment =
  | { kind: "effect" | "condition" | "trigger"; node: Node }
  | { kind: "duration"; duration: string }
  | { kind: "implicit"; note: string };

export function leafFragment(leaf: CompileLeaf): LeafFragment {
  if (isContainerOpener(leaf.family_id)) {
    return { kind: "implicit", note: "No separate text: opens a container; every sentence after it, up to the next opener, becomes one of its options." };
  }
  if (leaf.family_id === "named-option") return { kind: "implicit", note: "No separate text: its label names the option; the effects after it are that option's own." };
  if (leaf.family_id === "on-fail-open") return { kind: "implicit", note: "No separate text: the effects after it are risk-reward's on_fail." };
  if (leaf.family_id === "menu-action") return { kind: "implicit", note: "No separate text: its id, label and cost open one resource-action-menu action; the trigger and effect leaves after it are that action's own." };
  if (leaf.role === "EFFECT") return { kind: "effect", node: effect(leaf, { attached: false, incoming: false }) };
  if (leaf.role === "COMBINATOR") {
    return { kind: "implicit", note: "No separate text: this effect replaces an earlier one of the same kind when its condition holds." };
  }
  if (leaf.role === "RESTRICTION") {
    return { kind: "implicit", note: leaf.family_id === "usage-limit"
      ? `No separate text: sets the ability's usage to ${JSON.stringify(usageFor(leaf.parameters))}.`
      : leaf.family_id === "optional-use" ? "No separate text: the player chooses whether to use it (an optional trigger, or an activated ability)."
        : leaf.family_id === "rules-bundle-marker" ? "No separate text: the whole ability's body becomes a named rules bundle."
          : "No separate text: checked against the core record, which already holds it." };
  }
  if (leaf.family_id === "target-is-selected") return { kind: "implicit", note: "No separate text: the effects it gates apply to attacks against the selected unit." };
  if (leaf.family_id === "dice-roll") return { kind: "implicit", note: `No separate text: roll one ${String(leaf.parameters.dice)}; the result bands after it say what each result does.` };
  if (leaf.family_id === "roll-result") return { kind: "implicit", note: `No separate text: the effects in its clause happen on a ${String(leaf.parameters.from)}-${String(leaf.parameters.to)}.` };
  if (leaf.family_id === "aura-range" || leaf.family_id === "leader-target") {
    return { kind: "implicit", note: "No separate text: wraps the rest of the ability's effects, the same way select-unit does." };
  }
  if (leaf.role === "CONDITION") return { kind: "condition", node: condition(leaf) };
  if (leaf.role === "DURATION") return { kind: "duration", duration: duration(leaf) };
  if (leaf.family_id === "attack") {
    const gate = attackTypeCondition(leaf);
    return gate ? { kind: "condition", node: gate } : { kind: "implicit", note: "No separate text: an attack is part of the effect it goes with." };
  }
  if (leaf.family_id === "select-unit" || leaf.family_id === "for-each-unit-select") return { kind: "implicit", note: "No separate text: the selection is written with the effects that refer to the selected unit." };
  if (leaf.family_id === "event" && ATTACK_EVENTS.has(String(leaf.parameters.kind))) return { kind: "implicit", note: "No separate text: an attack-time event is part of the effect it goes with." };
  return { kind: "trigger", node: trigger(leaf) };
}

const gated = (gate: Node[], body: Node): Node => {
  const node = allOf(gate);
  return node ? { type: "conditional", condition: node, effect: body } : body;
};

/** Leaves only a stratagem has: its phase window and its TARGET. */
const STRATAGEM_FAMILIES = new Set(["use-window", "stratagem-target", "triggering-target", "target-binding"]);

/** Effects that forbid something; an "instead" after one says what happens in its place. */
const PROHIBITIONS = new Set(["no-advance-roll"]);

/** "Add 6 to Move": what a no-advance-roll's `advance: fixed-6` does in place of the roll. */
function isAdvanceInPlace(node: Node): boolean {
  const modifier = node.modifier as Node | undefined;
  return node.type === "stat-modifier" && node.target !== "attacker" && modifier?.stat === "M" && modifier.operation === "add"
    && Number(modifier.value) === 6 && modifier.weapon_type === undefined;
}

type PlannedEffect = { index: number; leaf: CompileLeaf; node: Node; gate: Node[]; selected: boolean; replaces: boolean };

/** Compile one ability's reviewed leaves. Failures name what is missing; nothing is guessed. */
export function compileLeaves(leaves: readonly CompileLeaf[], sourceText?: string): Compiled {
  const list = ordered(leaves);
  const signature = shapeSignature(list, sourceText);
  // named-region-state is a whole ability by itself: the DSL shape it produces has no room for
  // any other leaf beside it (see compile-named-region.ts for why).
  if (list.length === 1 && list[0]!.family_id === "named-region-state") {
    try {
      const { effect: node, behavior } = compileNamedRegionState(list[0]!);
      return { ok: true, signature, mechanics: { effect: node, scope: { duration: "permanent" }, behavior, trigger: null }, checks: [] };
    } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      return { ok: false, signature, errors: [error.message] };
    }
  }
  if (list.some((leaf) => leaf.family_id === "named-region-state")) {
    return { ok: false, signature, errors: ["named-region-state must be the ability's only leaf."] };
  }
  const places = placements(list, sourceText);
  let containerNodes: Map<number, Node>;
  let consumedByContainer: Set<number>;
  try {
    ({ nodes: containerNodes, consumed: consumedByContainer } = planContainers(list, places.map((place) => place.sentence)));
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature, errors: [error.message] };
  }
  const errors: string[] = [];
  const attempt = <T>(work: () => T): T | null => {
    try {
      return work();
    } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      errors.push(error.message);
      return null;
    }
  };

  const effectSentences = new Set(list.flatMap((leaf, index) => leaf.role === "EFFECT" ? [places[index]!.sentence] : []));
  const firstSentence = Math.min(...effectSentences);
  const firstEffect = (sentence: number) => list.findIndex((leaf, index) => leaf.role === "EFFECT" && places[index]!.sentence === sentence);
  const attached = list.some((leaf) => leaf.family_id === "leading-unit");
  const global: Node[] = [];
  /** Conditions keyed by the scope they gate: a sentence's leading conditions, or one clause. */
  const sentenceGates = new Map<number, Node[]>();
  const clauseGates = new Map<number, Node[]>();
  const selectedClauses = new Set<number>();
  const selectedSentences = new Set<number>();
  let selectedGlobally = false;
  const triggers: Node[] = [];
  const triggerIndexes: number[] = [];
  const durations: string[] = [];
  const selections: CompileLeaf[] = [];
  const rolls: CompileLeaf[] = [];
  const combinators: number[] = [];
  const usages: Record<string, unknown>[] = [];
  let optional = false;
  const checks: CoreCheck[] = [];
  const targetParts: CompileLeaf[] = [];
  const targetEligibility: Node[] = [];
  // Container-wrapping markers (batch 5): at most one of each is expected on a real ability.
  let auraLeaf: CompileLeaf | null = null;
  let leaderLeaf: CompileLeaf | null = null;
  let forEachLeaf: CompileLeaf | null = null;
  let rulesBundle = false;

  list.forEach((leaf, index) => {
    // A container opener's options are folded into its own node (`containerNodes.get(index)`,
    // used where planned effects are built below); the leaves that became those options never
    // separately reach condition/duration/event dispatch or their own planned effect.
    if (consumedByContainer.has(index)) return;
    const { sentence, clause } = places[index]!;
    const first = firstEffect(sentence);
    const leading = first === -1 || index < first;
    const scope = (node: Node | "selected") => {
      // A result band decides only the effects of its own clause, wherever it sits in it.
      if (node !== "selected" && node.type === "__roll-result") {
        clauseGates.set(clause, [...(clauseGates.get(clause) ?? []), node]);
      } else if (!effectSentences.has(sentence) || (sentence === firstSentence && leading)) {
        if (node === "selected") selectedGlobally = true;
        else global.push(node);
      } else if (leading) {
        if (node === "selected") selectedSentences.add(sentence);
        else sentenceGates.set(sentence, [...(sentenceGates.get(sentence) ?? []), node]);
      } else if (node === "selected") {
        selectedClauses.add(clause);
      } else {
        clauseGates.set(clause, [...(clauseGates.get(clause) ?? []), node]);
      }
    };
    attempt(() => {
      if (leaf.role === "CONDITION" && leaf.fragment === "TARGET") targetEligibility.push(condition(leaf));
      else if (leaf.role === "CONDITION" && WRAP_CONDITION_FAMILIES.has(leaf.family_id)) {
        if (leaf.family_id === "aura-range") auraLeaf = leaf;
        else leaderLeaf = leaf;
      }
      else if (leaf.role === "CONDITION") scope(leaf.family_id === "target-is-selected" ? "selected" : leaf.family_id === "roll-result" ? rollMarker(leaf) : condition(leaf));
      else if (leaf.role === "DURATION") durations.push(duration(leaf));
      else if (leaf.role === "COMBINATOR") combinators.push(index);
      else if (leaf.role === "RESTRICTION") {
        if (leaf.family_id === "usage-limit") usages.push(usageFor(leaf.parameters));
        else if (leaf.family_id === "optional-use") optional = true;
        else if (leaf.family_id === "rules-bundle-marker") rulesBundle = true;
        else if (["stratagem-target", "target-binding", "triggering-target"].includes(leaf.family_id)) targetParts.push(leaf);
        else if (leaf.family_id === "use-window" || leaf.family_id === "bearer-eligibility") checks.push({ kind: leaf.family_id, parameters: leaf.parameters });
        else throw new CompileError(`Restriction ${leaf.family_id} has no DSL fragment yet.`);
      }
      else if (leaf.role === "EVENT") {
        if (leaf.family_id === "attack") {
          const gate = attackTypeCondition(leaf);
          if (gate) scope(gate);
        } else if (leaf.family_id === "select-unit") selections.push(leaf);
        else if (leaf.family_id === "for-each-unit-select") forEachLeaf = leaf;
        else if (leaf.family_id === "dice-roll") rolls.push(leaf);
        else if (!(leaf.family_id === "event" && ATTACK_EVENTS.has(String(leaf.parameters.kind)))) {
          triggers.push(trigger(leaf));
          triggerIndexes.push(index);
        }
      } else if (leaf.role !== "EFFECT") throw new CompileError(`Role ${leaf.role} cannot compile.`);
    });
  });

  const planned: PlannedEffect[] = [];
  list.forEach((leaf, index) => {
    if (consumedByContainer.has(index)) return;
    if (leaf.role !== "EFFECT") return;
    const { sentence, clause } = places[index]!;
    const node = containerNodes.has(index) ? containerNodes.get(index)! : attempt(() => {
      // The nearest attack before this effect says who attacks and which way.
      const attack = list.slice(0, index).reverse().find((item) => item.family_id === "attack");
      return effect(leaf, {
        attached,
        attacker: attack && attack.parameters.direction === "makes" ? (attack.parameters.unit === "this-model" ? "this-model" : "this-unit") : null,
        incoming: attack?.parameters.direction === "targeted",
      });
    });
    if (!node) return;
    planned.push({
      index, leaf, node,
      gate: [...(sentenceGates.get(sentence) ?? []), ...(clauseGates.get(clause) ?? [])],
      selected: selectedGlobally || selectedSentences.has(sentence) || selectedClauses.has(clause),
      replaces: false,
    });
  });
  if (list.every((leaf) => leaf.role !== "EFFECT")) errors.push("There is no effect leaf to compile.");

  for (const combinator of combinators) {
    const clause = places[combinator]!.clause;
    const own = planned.filter((item) => places[item.index]!.clause === clause);
    if (own.length !== 1) {
      errors.push(`"Instead" needs exactly one effect in its clause; found ${own.length}.`);
      continue;
    }
    const replacement = own[0]!;
    const replaced = planned.filter((item) => item.index < replacement.index && item.leaf.family_id === replacement.leaf.family_id && !item.replaces).at(-1);
    // "Do not make an Advance roll; instead, add 6\" to its Move": the no-advance-roll fragment
    // already says what happens in its place, so the clause's effect folds into it. Anything
    // else in its place has no DSL fragment.
    const previous = planned.filter((item) => item.index < replacement.index).at(-1);
    if (!replaced && previous && PROHIBITIONS.has(previous.leaf.family_id)) {
      if (isAdvanceInPlace(replacement.node)) planned.splice(planned.indexOf(replacement), 1);
      else errors.push(`"Instead" after ${previous.leaf.family_id} must add 6 to Move; ${replacement.leaf.family_id} has no DSL fragment there.`);
      continue;
    }
    if (!replaced) {
      errors.push(`"Instead" has no earlier ${replacement.leaf.family_id} effect to replace.`);
      continue;
    }
    const alternative = allOf(replacement.gate);
    if (!alternative) {
      errors.push(`"Instead" needs a condition in its clause saying when ${replacement.leaf.family_id} is replaced.`);
      continue;
    }
    replaced.gate = [...replaced.gate, negate(alternative)];
    replacement.replaces = true;
  }

  // Moments before the first effect are the ability's own (several are alternatives: "selected
  // to shoot or to fight"). A moment after an effect starts a part of a compound ability: the
  // effects from it to the next such moment fire then, as one bullet of the same ability.
  const firstEffectIndex = list.findIndex((leaf) => leaf.role === "EFFECT");
  const partStarts: Array<{ index: number; moments: number[] }> = [];
  triggerIndexes.forEach((index, position) => {
    if (firstEffectIndex === -1 || index < firstEffectIndex) return;
    const last = partStarts.at(-1);
    // A moment right after another, with no effect between, is an alternative for the same part.
    if (last && !planned.some((item) => item.index > last.index && item.index < index)) last.moments.push(position);
    else partStarts.push({ index, moments: [position] });
  });
  if (partStarts.some((part, position) => !planned.some((item) => item.index > part.index && (partStarts[position + 1] === undefined || item.index < partStarts[position + 1]!.index)))) {
    errors.push("A moment ends the ability with no effect after it.");
  }
  if (partStarts.length && selections.length) errors.push("A unit is selected in an ability with parts; the compiler binds a selection only for one moment.");
  if (new Set(durations).size > 1) errors.push("Conflicting durations.");
  if (usages.length > 1) errors.push("More than one usage limit; the entry has one usage.");
  const target = attempt(() => targetRestrictions(targetParts, targetEligibility));
  const selected = planned.filter((item) => item.selected);
  if (selections.length > 1) errors.push("More than one unit is selected; the compiler binds only one.");
  // A selection without "attacks against that unit" is only who "that unit" names (it suffers
  // mortal wounds, say); with it, every effect must be limited to those attacks.
  if (selections.length === 1 && selected.length > 0 && selected.length !== planned.length) errors.push("A unit is selected, but not every effect is limited to attacks against it.");
  if (selections.length === 0 && selected.length > 0) errors.push("An attack targets \"that unit\", but no select-unit leaf says which unit.");
  if (selections.length === 0 && planned.some((item) => namesSelected(item.node))) errors.push("An effect names \"that unit\", but no select-unit leaf says which unit.");
  if (forEachLeaf && selections.length > 0) errors.push("A unit is selected and the ability also loops with for-each-unit-select; the compiler binds only one of them.");
  if (errors.length > 0) return { ok: false, signature, errors };

  const partOf = (index: number) => partStarts.filter((part) => part.index < index).length;
  const pieces = [0, ...partStarts.map((_, position) => position + 1)].map((part) => attempt(() => resolveRolls(
    planned.filter((item) => partOf(item.index) === part),
    part === 0 ? global : [],
    rolls.filter((leaf) => partOf(list.indexOf(leaf)) === part),
  )));
  if (pieces.some((piece) => !piece)) return { ok: false, signature, errors };
  const steps = pieces[0]!;
  let body: Node | null = steps.length === 1 ? steps[0]! : { type: "sequence", steps };
  const scopeDuration = durations[0] ?? "permanent";
  if (selections.length === 1 && selected.length > 0) body = attempt(() => designation(selections[0]!, list, body!, durations[0]));
  else if (selections.length === 1) body = selectUnit(selections[0]!, body);
  else if (forEachLeaf) { const each = forEachLeaf; body = attempt(() => wrapForEachUnit(each, body!)); }
  if (!body) return { ok: false, signature, errors };
  if (auraLeaf) { const aura = auraLeaf; body = attempt(() => wrapAura(aura, body!)); }
  if (leaderLeaf) { const leader = leaderLeaf; body = attempt(() => wrapLeaderTarget(leader, body!)); }
  if (!body) return { ok: false, signature, errors };
  if (rulesBundle) body = wrapRulesBundle(body);
  const stratagem = list.some((leaf) => STRATAGEM_FAMILIES.has(leaf.family_id));
  // "That X unit": the WHEN moment's unit must have the keywords the target names.
  const bound = targetParts.find((leaf) => leaf.family_id === "triggering-target");
  const moments = triggers.map((node) => {
    const moment: Node = optional ? { ...node, optional: true } : { ...node };
    // The keywords narrow whoever acted: a filter subject gains all_of; this unit gets a keyword condition.
    if (bound && bound.parameters.match === "all" && (bound.parameters.keywords as string[]).length) {
      const keywords = bound.parameters.keywords as string[];
      if (moment.subject !== null && typeof moment.subject === "object") moment.subject = { ...(moment.subject as Node), all_of: keywords };
      else {
        const gate: Node = { type: "has-keyword", parameters: { ...(moment.subject ? { subject: moment.subject } : {}), all_of: keywords } };
        const own = moment.condition as Node | undefined;
        moment.condition = own ? { operator: "and", operands: [own, gate] } : gate;
      }
    }
    return moment;
  });
  const asTrigger = (nodes: Node[]) => nodes.length === 0 ? null : nodes.length === 1 ? nodes[0]! : nodes;
  const leading = moments.filter((_, position) => !partStarts.some((part) => part.moments.includes(position)));
  let entryTrigger = asTrigger(leading);
  if (partStarts.length) {
    // The first part fires on the ability's leading moment, if it has one; each later part on its own.
    const first = pieces[0]!;
    const partSteps: Node[] = entryTrigger ? [{ type: "ability-part", trigger: entryTrigger, effect: body }] : first;
    partStarts.forEach((part, position) => {
      const own = pieces[position + 1]!;
      partSteps.push({ type: "ability-part", trigger: asTrigger(part.moments.map((index) => moments[index]!)), effect: own.length === 1 ? own[0]! : { type: "sequence", steps: own } });
    });
    body = { type: "sequence", steps: partSteps };
    entryTrigger = null;
  }
  return {
    ok: true,
    signature,
    ...(target ? { core: { target_restrictions: target } } : {}),
    mechanics: {
      effect: gated(global, body),
      scope: { duration: scopeDuration },
      // A choice with an event is an optional trigger; a choice without one is activated, as is a
      // stratagem (it has a phase window or a TARGET), which a player always chooses to use. An
      // aura-range leaf always reads as an aura, ahead of any of those.
      behavior: auraLeaf ? "aura" : triggers.length ? "reactive" : optional || stratagem ? "activated" : "passive",
      trigger: entryTrigger,
      ...(usages.length ? { usage: usages[0] } : {}),
    },
    checks,
  };
}

/** Whether an effect (or one nested in it) applies to the selected unit. */
function namesSelected(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(namesSelected);
  if (node === null || typeof node !== "object") return false;
  const record = node as Node;
  return record.target === "selected-unit" || Object.values(record).some(namesSelected);
}

