import type { Compiled, CompileOptions } from "./compile.js";
import { narrowUnitIds } from "./compile-unit-names.js";
import { forEachTail } from "./compile-for-each-tail.js";
import { battleStartSnapshot } from "./compile-recipient-snapshot.js";
import { armyCoreChecks } from "./compile-army.js";
import { foldConditionalTestModifiers } from "./compile-preceding-roll.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { allOf, condition } from "./compile-conditions.js";
import { durationPart, placeInWindow } from "./compile-durations.js";
import { isRollMarker, resolveRolls } from "./compile-dice.js";
import { boundAttackDesignation, designation, selectUnit, wrapAura, wrapForEachUnit, wrapLeaderTarget, wrapRulesBundle } from "./compile-wrappers.js";
import { destroyedFilterObject, wrapModelAura } from "./compile-model-level.js";
import { auraPart, namesUnboundRecipient } from "./compile-aura-parts.js";
import { isForbiddenSetUp } from "./compile-set-up-placement.js";
import { momentsUnderUse } from "./compile-nested-moment.js";
import { gatedMoment } from "./compile-usability-gate.js";
import { resolveEntry } from "./compile-target-refs.js";
import { optionalTargetGroup, severalTargets } from "./compile-target-groups.js";
import { type ConditionOfPlan } from "./compile-connective-plan.js";
import { lowerConditionOf } from "./compile-connective-lower.js";
import { wrapOptionalSpends } from "./compile-optional-cost.js";
import { isAttackMoment } from "./compile-attack-window.js";
import { AURA_RECIPIENT } from "./compile-antecedent.js";
import type { PartFrame } from "./compile-part-classify.js";
import type { planEffects } from "./compile-part-plan.js";
import type { PartBindings } from "./compile-part-bindings.js";

type Node = Record<string, unknown>;

const gated = (gate: Node[], body: Node): Node => {
  const node = allOf(gate);
  return node ? { type: "conditional", condition: node, effect: body } : body;
};

/**
 * A condition on the attacker of the attack a designation changes ("that disembarked from this
 * TRANSPORT this turn" + "makes an attack"): it is checked per attack, not once when the
 * designation starts, because the attacker is not the unit that made the selection.
 */
const isAttackerGate = (node: Node): boolean => node.type === "happened" && (node.parameters as { subject?: unknown } | undefined)?.subject === "attacker";

/** Leaves only a stratagem has: its phase window and its TARGET. */
const STRATAGEM_FAMILIES = new Set(["use-window", "stratagem-target", "triggering-target", "target-binding"]);

/**
 * Effects that keep changing the game until something ends them, so a duration bounds them. One-off
 * results (mortal wounds, a move, a test, a set-up, regained wounds, CP) and effects that end by
 * their own rule (a designation, a sticky objective, a state change, an activated option) are not.
 */
const LASTING_EFFECTS = new Set([
  "ability-grant", "ability-modifier", "act-on-death", "borrow-weapons", "cost-modifier", "counts-as", "damage-reduction",
  "destruction-rule", "feel-no-pain", "ignore-modifiers", "invulnerable-save", "keyword-grant",
  "move-modifier", "named-region-state", "permission", "re-roll", "roll-modifier", "roll-result", "rule-state", "stat-modifier",
  "targeting", "test-exemption", "transport-capacity", "weapon-ability-grant", "weapon-ability-range", "weapon-grant",
]);

/** Whether an effect tree holds a lasting effect. */
function hasLastingEffect(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasLastingEffect);
  if (node === null || typeof node !== "object") return false;
  const record = node as Node;
  // An extra use "but not in the same phase" can only be spent after this phase, so the window cannot bound it.
  if (record.type === "ability-modifier" && (record.modifier as Node | undefined)?.not_same === "phase") return false;
  return (typeof record.type === "string" && LASTING_EFFECTS.has(record.type)) || isForbiddenSetUp(record) || Object.values(record).some(hasLastingEffect);
}

/**
 * The period a used or triggered ability's window names, which its effects last for when no
 * duration is printed (core rule 01.02.02: "In the Shooting phase" with no duration lasts until the
 * end of that Shooting phase). A window of phases is a phase; "in your turn" alone is the turn.
 */
function windowPeriod(list: readonly CompileLeaf[]): "phase" | "turn" | null {
  // A folded either-phase window ("in your Shooting phase and the Fight phase") is one any-of whose
  // alternatives are each one phase window; those alternatives are the windows. Other any-of leaves
  // (an "or" with a non-window condition) hold no window.
  const flat = list.flatMap((leaf) => {
    if (leaf.family_id !== "__any-of") return [leaf];
    const alternatives = leaf.parameters.alternatives as CompileLeaf[][];
    return alternatives.every((alternative) => alternative.length === 1 && alternative[0]!.family_id === "phase-window") ? alternatives.flat() : [];
  });
  const windows = flat.filter((leaf) => leaf.family_id === "use-window" || leaf.family_id === "activation-window"
    || (leaf.family_id === "phase-window" && leaf.parameters.phase !== "any"));
  if (windows.some((leaf) => leaf.family_id !== "phase-window" || leaf.parameters.phase !== undefined)) return "phase";
  if (windows.length) return "turn";
  // "At the start of the Fight phase, …" names the phase it happens in, as a window does (core rule 01.02.02).
  return flat.some((leaf) => leaf.family_id === "event" && leaf.parameters.kind === "phase-start" && leaf.parameters.phase !== undefined && leaf.parameters.phase !== "any") ? "phase" : null;
}


/**
 * Builds a part's entry from its planned effects and bindings: durations and windows, the
 * selection, aura, leader and for-each wraps, the moments and later parts, and the Stratagem's
 * core target restrictions. Runs only once the earlier phases found no refusal.
 */
export function assemblePart(
  frame: PartFrame, plan: ReturnType<typeof planEffects>, bindings: PartBindings, conditionOf: ConditionOfPlan[], signature: string,
  sourceText: string | undefined, options: CompileOptions,
): Compiled {
  const {
    list, places, errors, attempt, consumedByContainer, designationOptional, global, triggers, triggerIndexes, nestedMoments, nestedTriggers,
    bandTriggers, durations, selections, rolls, usages, usageIndexes, usabilityNodes, optionalSpend, checks, targetParts, auraLeaf, leaderLeaf,
    forEachLeaf, rulesBundle, rawOf, eligibilityIndexes, pairCandidates, battleSizeCount, roundCount,
  } = frame;
  let { optional, optionalSentence } = frame;
  const { planned, split, boundDuration, window } = plan;
  const { firstEffectIndex, partStarts, afterDestruction, delayed, fold, selectionLimit, target, nearTarget, selected, pair, independent, designatedSpends } = bindings;
  // A Stratagem's RESTRICTIONS apply to its use as a whole, so they belong to the first part, not to the moment printed before them.
  const partOf = (index: number) => list[index]!.fragment === "RESTRICTIONS" ? 0 : partStarts.filter((part) => part.index < index).length;
  // Each effect's own duration wraps its node before the parts are built. Under a window, an effect that
  // lasts as long as the window is left bare (the window part carries it); a shorter one nests, a longer one is a sibling.
  const windowInside = new Map<number, boolean>();
  if (split) {
    for (const item of planned) {
      const bound = boundDuration.get(item.index);
      if (window === null) { if (bound !== undefined) item.node = durationPart(bound, item.node); continue; }
      // A later part has a moment of its own: its effects take their own duration as a part of theirs (the window is the first moment's).
      if (partOf(item.index) > 0 && bound !== undefined) { windowInside.set(item.index, false); item.node = durationPart(bound, item.node); continue; }
      const place = attempt(() => placeInWindow(bound, window));
      if (place === null) return { ok: false, signature, errors };
      windowInside.set(item.index, place !== "outside");
      if (place !== "same") item.node = durationPart(bound!, item.node);
    }
  }
  // A sentence after a for-each's happens once, after the loop, only when both rules agree: it opens with "Then"
  // and names no unit of the loop (compile-for-each-tail.ts), and it is an effect on the bearer's own unit or model.
  // A loop the before-form hit fold made (its leaf carries `hit`) prints no "for each", so an effect on the bearer's
  // unit or model in a later sentence happens once without a "Then".
  const thenTail = partStarts.length === 0 && selections.length === 0 ? forEachTail(list, places, planned, forEachLeaf, sourceText) : [];
  // A for-each loop repeats the effects of its own sentence. An effect on a fixed recipient in a later sentence
  // ("Then, your unit suffers 3D3 mortal wounds") is the loop's tail when thenTail also holds.
  const loopAt = forEachLeaf ? list.indexOf(forEachLeaf) : -1;
  const fixedRecipientTail = forEachLeaf && partStarts.length === 0
    ? planned.filter((item) => item.index > loopAt && rawOf[item.index]! > rawOf[loopAt]! && (item.node.target === "this-unit" || item.node.target === "this-model"))
    : [];
  const hitLoop = (forEachLeaf as CompileLeaf | null)?.parameters.hit !== undefined;
  const afterLoop = planned.filter((item) => fixedRecipientTail.includes(item) && (hitLoop || thenTail.includes(item)));
  // A banded effect after the loop has no DSL shape: it would resolve against the loop's roll or run once per unit.
  if (afterLoop.some((item) => item.gate.some(isRollMarker))) errors.push("A roll-result band on a later sentence's effect on the bearer's unit has no DSL shape after a for-each-unit loop.");
  if (errors.length > 0) return { ok: false, signature, errors };
  // "It can …. If it does, …": the permission and what it gates are one choice of the player (compile-connective-lower.ts).
  const connective = attempt(() => lowerConditionOf(conditionOf, {
    list, planned, partOf, rawOf, optional, optionalSentence, optionalSpend, designationOptional,
    partMoments: [triggerIndexes.filter((_, at) => !partStarts.some((part) => part.moments.includes(at))), ...partStarts.map((part) => part.moments.map((at) => triggerIndexes[at]!))],
    stratagem: list.some((leaf) => STRATAGEM_FAMILIES.has(leaf.family_id)), aura: auraLeaf !== null, splitWindow: split && window !== null,
    consumed: consumedByContainer, optionalTarget: (index) => optionalTargetGroup(list, index) !== null, held: new Set([...designatedSpends, ...afterLoop]),
  }));
  if (connective === null) return { ok: false, signature, errors };
  if (connective.optionalSentence !== null) { optional = true; optionalSentence = Math.max(optionalSentence, connective.optionalSentence); }
  const pieceItems = planned.filter((item) => !designatedSpends.includes(item) && !afterLoop.includes(item));
  const pieces = [0, ...partStarts.map((_, position) => position + 1)].map((part) => attempt(() => resolveRolls(
    pieceItems.filter((item) => partOf(item.index) === part),
    part === 0 ? global : [],
    // A conditional change's condition is compiled here, where its roll is resolved (compile-dice.ts).
    rolls.filter((leaf) => partOf(list.indexOf(leaf)) === part).map((leaf) => {
      const poolLeaf = leaf.parameters.pool_condition as CompileLeaf | undefined;
      if (poolLeaf !== undefined) return { ...leaf, parameters: { ...leaf.parameters, pool_condition: condition(poolLeaf) } };
      const bonus = leaf.parameters.conditional_bonus as { value: number; leaf: CompileLeaf } | undefined;
      if (bonus === undefined) return leaf;
      return { ...leaf, parameters: { ...leaf.parameters, conditional_bonus: { value: bonus.value, node: condition(bonus.leaf) } } };
    }),
  )));
  if (pieces.some((piece) => !piece)) return { ok: false, signature, errors };
  // In a compound ability, a selection wraps only its own part's effects.
  const selectionPart = partStarts.length && selections.length === 1 ? partOf(list.indexOf(selections[0]!)) : null;
  // The selection's eligibility: each condition on the selected unit, read by the select that wraps it (below).
  const eligibility = eligibilityIndexes.length ? attempt(() => allOf(eligibilityIndexes.map((at) => condition(eligibilityLeaf(list[at]!))))) : null;
  // A condition the selection cannot say is a refusal, not an eligibility left off the selection.
  if (eligibilityIndexes.length && eligibility === null) return { ok: false, signature, errors };
  if (selectionPart !== null && selectionPart > 0) {
    const own = pieces[selectionPart]!;
    // A designated selection takes its eligibility in designation() below, so the part's select takes it only otherwise.
    const designated = selected.length > 0;
    pieces[selectionPart] = [selectUnit(selections[0]!, own.length === 1 ? own[0]! : { type: "sequence", steps: own }, { selectionLimit, eligibility: designated ? null : eligibility })];
  }
  let steps = pieces[0]!;
  // Under a window, the effects that last within it sit in one window part, which takes the moment as its trigger below.
  let windowHead: Node | null = null;
  if (window !== null) {
    const inside = pieceItems.filter((item) => partOf(item.index) === 0).map((item) => windowInside.get(item.index) === true);
    if (inside.length !== steps.length) { errors.push("A window's effects have no decided order yet."); return { ok: false, signature, errors }; }
    const within = steps.filter((_, at) => inside[at]);
    if (within.length === 0) { errors.push("A moment with a window has no effect inside the window."); return { ok: false, signature, errors }; }
    const head: Node = { type: "ability-part", duration: window, effect: within.length === 1 ? within[0]! : { type: "sequence", steps: within } };
    windowHead = head;
    const merged: Node[] = [];
    steps.forEach((step, at) => {
      if (!inside[at]) merged.push(step);
      else if (!merged.includes(head)) merged.push(head);
    });
    steps = merged;
  }
  let body: Node | null = steps.length === 1 ? steps[0]! : { type: "sequence", steps };
  // The first part before any wrap: a part list below keeps a wrapped first part whole (an aura's, a selection's).
  const unwrapped = body;
  const scopeDuration = split ? "permanent" : (durations[0] ?? "permanent");
  // "If an enemy unit within 8\" of this unit is below Starting Strength": a gate on each unit an
  // aura or a for-each reaches holds per recipient, inside the wrap, not once around it.
  if (auraLeaf || forEachLeaf) {
    const perUnit = global.filter((node) => JSON.stringify(node).includes(`"${AURA_RECIPIENT}"`));
    if (perUnit.length) {
      global.splice(0, global.length, ...global.filter((node) => !perUnit.includes(node)));
      body = gated(perUnit, body!);
    }
  }
  // A Stratagem's effect moment holds the selection printed before it, never the reverse: "Select one … unit. When it
  // declares a charge, …" selects at the WHEN moment, and the later moment is the selected unit's.
  const selectsBeforeMoment = [...nestedMoments].some((moment) => list.some((leaf, at) => at < moment && (leaf.family_id === "select-unit" || leaf.family_id === "for-each-unit-select")));
  if (nestedTriggers.length && selectsBeforeMoment) {
    body = { type: "ability-part", trigger: nestedTriggers.length === 1 ? nestedTriggers[0]! : nestedTriggers, effect: gated(global, body!) };
    global.splice(0, global.length);
  }
  const pairCandidateEligibility = pairCandidates.length ? attempt(() => allOf(pairCandidates.map((at) => condition(list[at]!)))) : null;

  if (selections.length === 1 && selected.length > 0) {
    // "Ranged attacks that target that unit": an attack-type gate says which attacks against the
    // designated unit are changed, so it narrows the designation's effect, not the selection. The
    // attacker gate ("that disembarked from this TRANSPORT") narrows it the same way.
    const attackGates = global.filter((node) => node.type === "attack-is" || isAttackerGate(node));
    if (attackGates.length) global.splice(0, global.length, ...global.filter((node) => !attackGates.includes(node)));
    body = attempt(() => designation(options.name, selections[0]!, list, gated(attackGates, body!), durations[0], eligibility, selectionLimit));
    // The lifted spends come before the designation, so the designation's read of them is set when it is tested.
    if (body && designatedSpends.length) body = { type: "sequence", steps: [...designatedSpends.map((item) => gated(item.gate, item.node)), body] };
  }
  // A friendly unit and an enemy unit selected apart: the enemy is designated, the friendly unit takes the grant against it.
  else if (independent && body) {
    const attackGates = global.filter((node) => node.type === "attack-is" || isAttackerGate(node));
    if (attackGates.length) global.splice(0, global.length, ...global.filter((node) => !attackGates.includes(node)));
    // A condition on the selected unit belongs to the nearest select before it (the enemy unit's "visible to this model", say).
    const eligibilityOf = (selection: CompileLeaf) => {
      const own = eligibilityIndexes.filter((at) => list.slice(0, at).map((item) => item.family_id === "select-unit").lastIndexOf(true) === list.indexOf(selection));
      return own.length ? allOf(own.map((at) => condition(eligibilityLeaf(list[at]!)))) : null;
    };
    body = attempt(() => boundAttackDesignation(options.name, independent, list, gated(attackGates, body!), durations[0], { friendly: eligibilityOf(independent.friendly), enemy: eligibilityOf(independent.enemy) }));
  }
  // "Select one enemy unit to be this model's prey": a persistent designation makes that selection itself.
  // A designation's own select, possibly wrapped optional, is the body's, not a select around it.
  else if (selections.length === 1 && (body?.type === "persistent-designation" || (body?.type === "ability-part" && (body.effect as Node | undefined)?.type === "persistent-designation"))) {
    const designationNode = body!.type === "ability-part" ? body!.effect as Node : body!;
    const selection = designationNode.select as Node;
    if (selection.kind !== "unit") return { ok: false, signature, errors: [...errors, "A unit selection cannot establish an objective designation."] };
    const existing = selection.selector as Node;
    selection.selector = {
      ...(selectUnit(selections[0]!, body!, { eligibility, selectionLimit }).selector as Node),
      ...(existing.bind_as === undefined ? {} : { bind_as: existing.bind_as }),
    };
  }
  else if (pair && body) {
    // A bound pair: the outer select takes the selection's eligibility, the inner one its candidate's (compile-pair-eligibility.ts).
    body = selectUnit(pair.outer, selectUnit(pair.inner, body, { eligibility: pairCandidateEligibility }), { eligibility });
  }
  else if (selections.length === 1 && (selectionPart === null || selectionPart === 0)) {
    body = selectUnit(selections[0]!, body, {
      ...(battleSizeCount ? { maxCount: { incursion: battleSizeCount.parameters.incursion, "strike-force": battleSizeCount.parameters["strike-force"], onslaught: battleSizeCount.parameters.onslaught } } : {}),
      ...(roundCount && !battleSizeCount ? { maxCount: { count_of: "battle-round" } } : {}),
      eligibility,
      selectionLimit,
    });
  }
  else if (forEachLeaf) {
    const each = forEachLeaf;
    body = attempt(() => wrapForEachUnit(each, body!));
    if (body && afterLoop.length) body = { type: "sequence", steps: [body, ...afterLoop.map((item) => gated(item.gate, item.node))] };
  }
  if (!body) return { ok: false, signature, errors };
  // With later parts, the aura wraps the first part only when that part names its recipient (compile-aura-parts.ts).
  const auraFirst = auraLeaf !== null && (partStarts.length === 0 || namesUnboundRecipient(unwrapped));
  if (auraLeaf && auraFirst) { const aura: CompileLeaf = auraLeaf; body = attempt(() => aura.parameters.model_recipient !== undefined ? wrapModelAura(aura, body!, triggers) : wrapAura(aura, body!)); }
  if (leaderLeaf) { const leader = leaderLeaf; body = attempt(() => wrapLeaderTarget(leader, body!)); }
  if (!body) return { ok: false, signature, errors };
  // A refusal here returns at once: the errors list was already checked above, so a later attempt() error would be dropped.
  if (optionalSpend) {
    const wrapped = attempt(() => wrapOptionalSpends(body!, list, durations) as typeof body);
    if (wrapped === null) return { ok: false, signature, errors };
    body = wrapped;
  }
  if (rulesBundle) body = wrapRulesBundle(body);
  const stratagem = list.some((leaf) => STRATAGEM_FAMILIES.has(leaf.family_id));
  // "(Once per battle) … you can use this ability. If you do, … within 6\" of this unit …": the
  // player uses the ability, and the aura is what using it sets up. A "you can" with no trigger or
  // usage limit is a permission inside the aura ("you can re-roll …"), and the aura stays passive.
  const usedAura = auraLeaf !== null && optional && (triggers.length > 0 || bandTriggers.size > 0 || usages.length > 0);
  const behavior = auraLeaf && !usedAura ? "aura" : triggers.length || bandTriggers.size ? "reactive" : optional || stratagem ? "activated" : "passive";
  // A used or triggered ability with no printed duration lasts for its window's period. A passive
  // ability gated on a phase already holds only in that phase, and an aura only while in range.
  // A menu's options hold their own windows; only the leaves outside it say how long the menu's use lasts.
  // In a compound ability, a window printed in a later part's opening sentence, before its moment ("…. In your
  // Shooting phase, when this unit has shot, …"), is that part's own: it bounds only that part's effects.
  const windowPart = (index: number): number => {
    const part = partOf(index);
    const next = partStarts[part];
    if (next === undefined || list[index]!.fragment === "RESTRICTIONS") return part;
    const effectBetween = planned.some((item) => item.index > index && item.index < next.index);
    return !effectBetween && places[index]!.sentence === places[next.index]!.sentence ? part + 1 : part;
  };
  const windowLeaves = (part: number | null) => list.filter((_, index) => !consumedByContainer.has(index) && (part === null || windowPart(index) === part));
  const usedOrTriggered = durations.length === 0 && (behavior === "reactive" || behavior === "activated");
  const period = usedOrTriggered && hasLastingEffect(body) ? windowPeriod(windowLeaves(partStarts.length ? 0 : null)) : null;
  // A later part's own window gives it a lifetime when it holds a lasting effect and the record's window does not already bound it.
  const partPeriods = partStarts.map((_, position) => usedOrTriggered && period === null && hasLastingEffect(pieces[position + 1])
    ? windowPeriod(windowLeaves(position + 1)) : null);
  // "That X unit": the WHEN moment's unit must have the keywords the target names.
  const bound = targetParts.find((leaf) => leaf.family_id === "triggering-target");
  const offerMoments = triggerIndexes.some((index) => rawOf[index]! <= optionalSentence);
  const moments = triggers.map((node, position) => {
    // Only the moments of the sentence that offers the use (or the WHEN clauses before it) are the player's choice.
    // When every moment comes after the offer ("you can use this ability. If you do, when …"), no moment
    // decides the use, so the choice stays on them: a mandatory trigger would lose it.
    const decidesUse = optional && (!offerMoments || rawOf[triggerIndexes[position]!]! <= optionalSentence);
    const moment: Node = decidesUse ? { ...node, optional: true } : { ...node };
    // The keywords narrow whoever acted: a filter subject gains all_of; this unit gets a keyword condition.
    const unitIds = bound?.parameters.unit_ids as string[] | undefined;
    if (bound && ((bound.parameters.match === "all" && (bound.parameters.keywords as string[]).length) || unitIds)) {
      const keywords = bound.parameters.match === "all" ? bound.parameters.keywords as string[] : [];
      const withKeywords = (unit: Node) => {
        const narrowed = keywords.length ? { ...unit, all_of: [...new Set([...((unit.all_of as string[] | undefined) ?? []), ...keywords])] } : unit;
        return unitIds ? narrowUnitIds(narrowed, unitIds) : narrowed;
      };
      // When an enemy acts ("when an enemy unit targets a friendly X unit", "ends a move within 8\"
      // of a friendly X unit") the Stratagem's unit is never that enemy: it is the moment's
      // object, or else this unit, which the keywords gate.
      const enemyActs = moment.subject !== null && typeof moment.subject === "object" && (moment.subject as Node).owner === "enemy";
      // "When a friendly X unit is destroyed" + "that X unit": the destroyed unit, the moment's object.
      if (destroyedFilterObject(moment)) moment.object = withKeywords(moment.object as Node);
      else if (enemyActs) {
        if (moment.object !== null && typeof moment.object === "object" && (moment.object as Node).owner !== "enemy") moment.object = withKeywords(moment.object as Node);
        else if (nearTarget) {
          // The target is the friendly unit the moment's distance names, so the enemy mover needs no keyword gate.
        } else {
          const gate: Node = { type: "matches", parameters: { filter: withKeywords({}) } };
          const own = moment.condition as Node | undefined;
          moment.condition = own ? { operator: "and", operands: [own, gate] } : gate;
        }
      } else if (moment.subject !== null && typeof moment.subject === "object") moment.subject = withKeywords(moment.subject as Node);
      else {
        const gate: Node = { type: "matches", parameters: { ...(moment.subject ? { subject: moment.subject } : {}), filter: withKeywords({}) } };
        const own = moment.condition as Node | undefined;
        moment.condition = own ? { operator: "and", operands: [own, gate] } : gate;
      }
    }
    return moment;
  });
  moments.forEach((moment, position) => { if (list[triggerIndexes[position]!]!.fragment === "WHEN") moments[position] = gatedMoment(moment, usabilityNodes); });
  const asTrigger = (nodes: Node[]) => nodes.length === 0 ? null : nodes.length === 1 ? nodes[0]! : nodes;
  const leading = moments.filter((_, position) => !delayed.dropped.has(position) && !partStarts.some((part) => part.moments.includes(position)));
  let entryTrigger = asTrigger(leading);
  // The end of the phase in which a named model was destroyed: the destruction's part holds the phase end for that phase.
  for (const position of delayed.nested) body = { type: "ability-part", trigger: moments[position]!, effect: body, duration: "phase" };
  let foldedPhase = false;
  if (fold !== null && fold !== "refused") {
    // The attack moments end at the attack sequence; the other moments and the phase stay on the entry.
    // A delayed or dropped attack moment leaves nothing to end the effect, so the entry is refused.
    const attacks = leading.filter(isAttackMoment);
    if (attacks.length === 0) return { ok: false, signature, errors: ["Conflicting durations."] };
    body = { type: "ability-part", trigger: asTrigger(attacks), effect: body, duration: "attack-sequence" };
    entryTrigger = asTrigger(leading.filter((moment) => !isAttackMoment(moment)));
    foldedPhase = true;
  }
  // The window part is the moments' lifetime: its trigger is the leading moments, and the ability has no top-level trigger.
  if (windowHead) { windowHead.trigger = entryTrigger; entryTrigger = null; }
  if (partStarts.length) {
    // The first part fires on the ability's leading moment, if it has one; each later part on its own.
    const first = auraFirst ? [body!] : steps;
    const partSteps: Node[] = entryTrigger ? [{ type: "ability-part", trigger: entryTrigger, effect: body }] : first;
    // "The first time the bearer's unit destroys an enemy unit": a usage limit right before a later
    // part's moment, after an earlier effect, limits only that part.
    const usageAt = usageIndexes.length === 1 && firstEffectIndex !== -1 && usageIndexes[0]! > firstEffectIndex ? usageIndexes[0]! : -1;
    const usagePart = usageAt === -1 ? -1 : partStarts.findIndex((part) => part.index > usageAt && !planned.some((item) => item.index > usageAt && item.index < part.index));
    // A moment under the use the first moment offers ("If you do: … When …") nests in the entry part for the phase.
    const under = entryTrigger ? new Set([...momentsUnderUse(list, triggerIndexes, partStarts, firstEffectIndex, sourceText, durations.length), ...afterDestruction]) : new Set<number>();
    under.delete(usagePart);
    const nestedSteps: Node[] = [];
    // "In addition, … if such an enemy unit is …, it must …": a later part about the aura's recipient holds for each unit in the aura.
    const rawEffects: Node[] = partStarts.map((_, position) => {
      const own = pieces[position + 1]!;
      return own.length === 1 ? own[0]! : { type: "sequence", steps: own };
    });
    // "each time a friendly X unit within 9\" of the bearer fails a test, …": an aura no part's effect names the recipient of
    // describes a moment's unit, which a part's trigger cannot hold here, so its range would be dropped.
    if (auraLeaf && !auraFirst && !rawEffects.some(namesUnboundRecipient)) {
      return { ok: false, signature, errors: [...errors, "An aura in an ability with several moments reaches no effect's recipient; its range would be dropped."] };
    }
    const partEffects = partStarts.map((part, position) => attempt(() => auraPart(auraLeaf, rawEffects[position]!, part.moments.map((index) => moments[index]!))));
    if (partEffects.some((effect) => effect === null)) return { ok: false, signature, errors };
    partStarts.forEach((part, position) => {
      const node: Node = {
        type: "ability-part", trigger: asTrigger(part.moments.map((index) => moments[index]!)), effect: partEffects[position]!,
        ...(position === usagePart ? { usage: usages[0] } : {}),
        ...(connective.optionalParts.has(position + 1) ? { optional: true } : {}),
        ...(partPeriods[position] ? { duration: partPeriods[position] } : {}),
      };
      if (under.has(position)) nestedSteps.push({ ...node, duration: "phase" });
      else partSteps.push(node);
    });
    if (nestedSteps.length) {
      const entry = partSteps[0]!;
      const inner = entry.effect as Node;
      partSteps[0] = { ...entry, effect: { type: "sequence", steps: [...(inner.type === "sequence" ? inner.steps as Node[] : [inner]), ...nestedSteps] } };
    }
    if (usagePart !== -1) usages.splice(0);
    body = partSteps.length === 1 ? partSteps[0]! : { type: "sequence", steps: partSteps };
    entryTrigger = null;
  }
  let resolved: ReturnType<typeof resolveEntry>;
  try {
    const effect = gated(global, foldConditionalTestModifiers(body));
    const nestedNow = nestedTriggers.length > 0 && !selectsBeforeMoment;
    resolved = resolveEntry(nestedNow ? { type: "ability-part", trigger: asTrigger(nestedTriggers), effect } : effect, entryTrigger, target, severalTargets(list));
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature, errors: [error.message] };
  }
  const lifetime = foldedPhase ? "phase" : period ?? scopeDuration;
  const snapshot = battleStartSnapshot(resolved.effect, resolved.trigger, lifetime);
  return {
    ok: true,
    signature,
    ...(resolved.core ? { core: resolved.core } : {}),
    mechanics: {
      effect: snapshot.effect,
      scope: { duration: lifetime },
      // A choice with an event is an optional trigger; a choice without one is activated, as is a
      // stratagem (it has a phase window or a TARGET), which a player always chooses to use. An
      // aura-range leaf always reads as an aura, ahead of any of those.
      behavior,
      // An optional use of the whole ability, which no trigger times and which is not a
      // Stratagem (always the player's choice), renders as the player's choice.
      ...(optional && behavior === "activated" && !stratagem ? { optional: true as const } : {}),
      trigger: snapshot.trigger as typeof entryTrigger,
      ...(usages.length ? { usage: usages[0] } : {}),
    },
    checks: [...checks, ...armyCoreChecks(list)],
  };
}

/**
 * A selection's eligibility condition as the DSL reads it. "This unit" in a hit's eligibility is the
 * candidate being selected, so a hit-by-attacks names its unit as this-unit; the leaf is otherwise unchanged.
 */
function eligibilityLeaf(leaf: CompileLeaf): CompileLeaf {
  return leaf.family_id === "hit-by-attacks" ? { ...leaf, parameters: { ...leaf.parameters, subject: "this-unit" } } : leaf;
}
