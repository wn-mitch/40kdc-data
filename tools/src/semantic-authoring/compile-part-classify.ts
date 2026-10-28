import { exactSpan } from "./contracts.js";
import { retargetMenu } from "./compile-activation.js";
import { FILTERED_UNITS } from "./compile-antecedent.js";
import { checkAbilityUsedWindows, namedAbilityChecks } from "./compile-named-ability.js";
import { nestedWhenMoments } from "./compile-when-subject.js";
import { bandMoments } from "./compile-band-moment.js";
import { addsAttackGate, attackTargetBinding } from "./compile-attack-backref.js";
import { trailingTestCondition } from "./compile-preceding-roll.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { activationWindowCondition, ATTACK_EVENTS, attackTypeCondition, condition, duration } from "./compile-conditions.js";
import { trigger, triggerLeaves, withDestroyedObject } from "./compile-triggers.js";
import { bandRunClauses, rawSentences } from "./compile-placement.js";
import { otherwiseElse, refuseOtherwiseGates } from "./compile-otherwise.js";
import { rollMarker } from "./compile-dice.js";
import { inheritClauseBands } from "./compile-clause-band.js";
import { isContainerOpener } from "./compile-containers.js";
import { WRAP_CONDITION_FAMILIES } from "./compile-wrappers.js";
import { namesSelection, onAttackedTarget } from "./compile-targeting-history.js";
import { usabilityGates } from "./compile-usability-gate.js";
import { type MoveEndRule } from "./compile-move-end.js";
import type { CoreCheck } from "./core-checks.js";
import { usageFor } from "./restriction-families.js";
import { bindPairEligibility, candidateIndexes, pairIndexes } from "./compile-pair-eligibility.js";
import { optionalTargetGroup } from "./compile-target-groups.js";
import { checkOptionalCosts, flatLeaves, isSpendRead, optionalSpendLeaves } from "./compile-optional-cost.js";
import { inheritRollGates } from "./compile-roll-gates.js";
import { conditionedInsteadAfter, ifGatedConditions, sentenceIfGates } from "./compile-instead-scope.js";
import type { Placement } from "./compile-placement.js";
import { siblingClauseConditions } from "./compile-sibling-conditions.js";

type Node = Record<string, unknown>;

/** Words that narrow which models a per-model roll covers; a per_model roll counts every model of its unit. */
const NARROWED_PER_MODEL = /\b(?:engaged|engagement range|within|that (?:is|are|has|have|made|was|were))\b/iu;

/** A condition written as an "If …" or "While …" clause that opens its sentence (after a full stop, colon, semicolon or line break). */
function opensIfSentence(sourceText: string, leaf: CompileLeaf): boolean {
  if (leaf.end_byte === undefined || !IF_CLAUSE.test(exactSpan(sourceText, leaf.start_byte, leaf.end_byte))) return false;
  const before = Buffer.from(sourceText, "utf8").subarray(Math.max(0, leaf.start_byte - 12), leaf.start_byte).toString("utf8");
  return /(?:^|[.;:\r\n])[\s*]*$/u.test(before);
}
const IF_CLAUSE = /^(?:if|while)\b/iu;

/** What a part's container plan settled before its leaves are classified (compile.ts compilePart). */
export type PartContainers = {
  containerNodes: Map<number, Node>;
  consumedByContainer: Set<number>;
  designationOptional: Set<number>;
  designationTiming: Set<number>;
  placesFromEventObject: boolean;
};

/** Everything one part's leaves say once each is classified: its gates, moments, durations, usages, selections and wrappers. */
export type PartFrame = ReturnType<typeof classifyLeaves>;

/**
 * Sorts each leaf of a part by what it is: a condition becomes a gate of the scope it binds to, an
 * event a trigger, a restriction a usage or a core-record check, and so on (the rules in compile.ts).
 * Effects are left for planEffects (compile-part-plan.ts). Refusals collect in `errors`.
 */
export function classifyLeaves(given: CompileLeaf[], places: Placement[], containers: PartContainers, sourceText: string | undefined) {
  const { containerNodes, consumedByContainer, designationOptional, designationTiming, placesFromEventObject } = containers;
  let list = given;
  const errors: string[] = refuseOtherwiseGates(list, places, sourceText);
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
  // "If A, do X. If B, do Y instead.": the instead sentence has its own condition, so an "if" condition of the first
  // sentence gates that sentence only; as an ability-wide gate it would also guard the replacement (compile-instead-scope.ts).
  const ownGates = conditionedInsteadAfter(list, places, firstSentence) ? ifGatedConditions(list, places, firstSentence, sourceText) : sentenceIfGates(list, places, rawSentences(list, sourceText), firstSentence, sourceText);
  // "If A, X, and if B, Y": each leading condition with an "and if" sibling gates only its clause.
  const siblingScoped = siblingClauseConditions(list, places, sourceText);
  const firstEffect = (sentence: number) => list.findIndex((leaf, index) => leaf.role === "EFFECT" && places[index]!.sentence === sentence);
  const attached = list.some((leaf) => leaf.family_id === "leading-unit");
  const global: Node[] = [];
  /** Conditions keyed by the scope they gate: a sentence's leading conditions, or one clause. */
  const sentenceGates = new Map<number, Node[]>();
  const clauseGates = new Map<number, Node[]>();
  /** The leaf each sentence gate came from, so a roll's later result bands can take the conditions printed before the roll. */
  const gateOrigin = new Map<Node, number>();
  // A condition trailing a change to a test just taken belongs to the change (compile-preceding-roll.ts trailingTestCondition).
  const attachedGates = new Map<number, Node[]>();
  const attachedAt = new Set<number>();
  const selectedClauses = new Set<number>();
  const selectedSentences = new Set<number>();
  let selectedGlobally = false;
  const triggers: Node[] = [];
  const triggerIndexes: number[] = [];
  const nestedMoments = nestedWhenMoments(list);
  const nestedTriggers: Node[] = [];
  // A moment inside a result band is a part of that band, never a trigger of the ability (compile-band-moment.ts).
  const inBand = bandMoments(list, places);
  const bandTriggers = new Map<number, Node[]>();
  const durations: string[] = [];
  const durationAt: number[] = [];
  const selections: CompileLeaf[] = [];
  const rolls: CompileLeaf[] = [];
  const combinators: number[] = [];
  const usages: Record<string, unknown>[] = [];
  const usageIndexes: number[] = [];
  const usageScopes = new Set<string>();
  // Per-model usage-limits: on a model selection each caps the selected model (selection_limit); otherwise they stay usages.
  const modelUsages: Array<{ leaf: CompileLeaf; index: number }> = [];
  // Per-selected-unit usage-limits ("once per turn" counted per unit selected): the selection's own cap (compile-selection-limit.ts).
  const selectedUnitUsages: Array<{ leaf: CompileLeaf; index: number }> = [];
  let optional = false;
  // The last source sentence holding an optional-use: moments opened after it ("If you do, … when this unit …") depend on the use and stay mandatory.
  let optionalSentence = -1;
  // "You can spend YP …" read later as "if you spent YP during this use", or by a trigger later in the ability: the spend is the optional part, not the use.
  const usabilityAt = usabilityGates(list);
  const usabilityNodes: Node[] = [];
  const optionalSpend = flatLeaves(list).some(isSpendRead);
  // An optional spend is offered by its own part, so it takes no clause gate and no instead clause's place (compile-optional-cost.ts).
  const optionalSpends = optionalSpendLeaves(list);
  const checks: CoreCheck[] = namedAbilityChecks(list);
  attempt(() => checkAbilityUsedWindows(list));
  attempt(() => checkOptionalCosts(list, sourceText));
  const targetParts: CompileLeaf[] = [];
  const targetPartIndexes: number[] = [];
  const targetConditions: Array<{ index: number; node: Node; eachTarget: boolean }> = [];
  const optionalTargets = new Set<number>();
  // Container-wrapping markers (batch 5): at most one of each is expected on a real ability.
  let auraLeaf: CompileLeaf | null = null;
  let leaderLeaf: CompileLeaf | null = null;
  let forEachLeaf: CompileLeaf | null = null;
  let rulesBundle = false;

  // "Your unit must end that move either …": the conditions after a move-must-end in its sentence
  // say where the preceding move ends, so they gate nothing and are taken out of clause binding.
  // A move-must-end or condition that a container option consumed belongs to that option, not to the outer move.
  const moveEnds: MoveEndRule[] = list.flatMap((leaf, index) => leaf.family_id === "move-must-end" && !consumedByContainer.has(index) ? [{
    index, match: String(leaf.parameters.match), cannot: leaf.parameters.polarity === "cannot",
    moveTypes: Array.isArray(leaf.parameters.move_types) ? leaf.parameters.move_types as string[] : null,
    conditions: list.flatMap((other, at) => at > index && other.role === "CONDITION" && !consumedByContainer.has(at) && places[at]!.sentence === places[index]!.sentence ? [at] : []),
    replaces: leaf.parameters.replaces === true,
  }] : []);
  const endConditions = new Set(moveEnds.flatMap((rule) => rule.conditions));
  // Conditions on the selected unit right after a selection in its sentence ("select one enemy
  // unit within 6\" of this unit", "that are on the battlefield") say which units can be selected:
  // the selection's eligibility, not a gate on the ability.
  // An effect-less selection sentence merges into the next one, so a gate in that next sentence
  // ("If one or more models in that unit are destroyed, …" before an Otherwise sentence) would share the
  // selection's merged sentence. In an ability with an Otherwise sentence the raw (pre-merge) sentence
  // decides instead; other abilities keep the merged test unchanged.
  const rawOf = rawSentences(list, sourceText);
  const sameSentence = (at: number, selected: number) => list.some((leaf) => leaf.family_id === "otherwise")
    ? rawOf[at] === rawOf[selected] : places[at]!.sentence === places[selected]!.sentence;
  // A bound selection pair (compile-pair-eligibility.ts): the outer unit's references after the inner select, and the inner's candidates.
  const pairs = pairIndexes(list);
  const pairCandidates = pairs ? candidateIndexes(list, pairs.inner, sameSentence) : [];
  if (pairs) {
    const bound = bindPairEligibility(list, pairs, pairCandidates);
    if (bound.refusal) errors.push(bound.refusal);
    list = bound.leaves;
  }
  for (const at of pairCandidates) endConditions.add(at);
  const selectionIndex = list.findIndex((leaf) => leaf.family_id === "select-unit");
  const eligibilityIndexes = selectionIndex === -1 ? [] : list.flatMap((leaf, at) => at > selectionIndex && leaf.role === "CONDITION"
    && leaf.parameters.subject === "selected-unit" && sameSentence(at, selectionIndex)
    && !list.slice(selectionIndex + 1, at).some((between) => between.role === "EFFECT") ? [at] : []);
  for (const at of eligibilityIndexes) endConditions.add(at);
  // A pair's outer gates come before the inner select and are not an embark eligibility (that names the inner Transport).
  const pairGatesBound = eligibilityIndexes.every((at) => pairs !== null && at < pairs.inner && !(list[at]!.family_id === "eligible" && list[at]!.parameters.to === "embark-within"));
  // "Otherwise, …": its else gate is the negation of the sentence before it (compile-otherwise.ts). The leading
  // conditions it negates move from the ability's gates to that sentence's gates, so they gate only that sentence.
  const otherwise = otherwiseElse(list, places, rawOf, sourceText, new Set([...endConditions, ...consumedByContainer, ...designationTiming]));
  errors.push(...otherwise.errors);
  const otherwiseMoved = otherwise.moved;
  for (const { sentence, gate } of otherwise.gates) sentenceGates.set(sentence, [...(sentenceGates.get(sentence) ?? []), gate]);
  const battleSizeCount = list.find((leaf) => leaf.family_id === "count-by-battle-size");
  const roundCount = list.find((leaf) => leaf.family_id === "count-by-battle-round");
  // Battle-size leaves for two or more sizes are table rows: alternatives, one per size. Each row
  // decides only its own sentence, so a row never joins the ability-wide gates (where rows would
  // AND together and the ability could never apply).
  const sizeRows = new Set(list.filter((leaf) => leaf.family_id === "battle-size").map((leaf) => String(leaf.parameters.size))).size >= 2;

  // Outside an aura or a for-each, a condition about the recipient is about each unit an effect's filter matches.
  // A clause that states a move-end and a condition: the condition gates the end rule, not a move
  // bonus in the same clause, which is available regardless.
  const endClauses = new Set(list.flatMap((leaf, at) => leaf.family_id === "move-end-nearest" || leaf.family_id === "move-end-waiver" ? [places[at]!.clause] : []));
  const perRecipient = !list.some((leaf) => leaf.family_id === "aura-range" || leaf.family_id === "for-each-unit-select");
  list.forEach((leaf, index) => {
    if (trailingTestCondition(list, index, sourceText) === "attach") {
      attachedAt.add(index + 1);
      const gate = attempt(() => condition(list[index + 1]!));
      if (gate) attachedGates.set(index, [gate]);
    }
  });
  list.forEach((leaf, index) => {
    if (endConditions.has(index)) return;
    if (attachedAt.has(index)) return;
    // An otherwise leaf is the else branch's marker: its gate is built above, and it is no combinator of its own.
    if (leaf.family_id === "otherwise") return;
    // A container opener's options are folded into its own node (`containerNodes.get(index)`,
    // used where planned effects are built below); the leaves that became those options never
    // separately reach condition/duration/event dispatch or their own planned effect.
    if (consumedByContainer.has(index) || designationTiming.has(index)) return;
    const { sentence, clause } = places[index]!;
    const first = firstEffect(sentence);
    const leading = first === -1 || index < first;
    const scope = (node: Node | "selected") => {
      // A leading condition an Otherwise sentence negates gates the sentence before it, not the ability's later sentences.
      if (node !== "selected" && otherwiseMoved.has(index)) {
        sentenceGates.set(sentence, [...(sentenceGates.get(sentence) ?? []), node]);
      // A result band decides only the effects of its own clause, wherever it sits in it.
      } else if (node !== "selected" && node.type === "__roll-result") {
        for (const bandClause of bandRunClauses(list, places, sourceText, index)) clauseGates.set(bandClause, [...(clauseGates.get(bandClause) ?? []), node]);
      // An "If …" sentence before an "Or:" player's pick ("If A, X. Or: If B, Y.") gates only its own option. A
      // condition inside a sentence ("…, if this unit is …"), a trigger, a scope heading ("This unit's melee attacks:"),
      // or an "If …" whose own sentence holds the pick ("If A, you can include X or Y") still gates the whole ability.
      } else if (node !== "selected" && leading && sourceText !== undefined && opensIfSentence(sourceText, list[index]!)
        && list.some((other, at) => at > index && other.role === "COMBINATOR" && other.parameters.choice === true && places[at]!.clause !== clause && places[at]!.sentence !== sentence)) {
        clauseGates.set(clause, [...(clauseGates.get(clause) ?? []), node]);
      } else if (!effectSentences.has(sentence) || (sentence === firstSentence && leading)) {
        if (node === "selected") selectedGlobally = true;
        else global.push(node);
      } else if (leading) {
        if (node === "selected") selectedSentences.add(sentence);
        else { sentenceGates.set(sentence, [...(sentenceGates.get(sentence) ?? []), node]); gateOrigin.set(node, index); }
      } else if (node === "selected") {
        selectedClauses.add(clause);
      } else {
        clauseGates.set(clause, [...(clauseGates.get(clause) ?? []), node]);
      }
    };
    attempt(() => {
      // A trigger's read of an optional spend gates the clause that uses the designation (an "instead"), never the
      // sentence that holds the spend: the spend is offered until it is paid, so the read cannot gate its own offer.
      if (leaf.role === "CONDITION" && leaf.family_id === "optional-cost-paid" && leaf.parameters.window === "trigger") {
        clauseGates.set(clause, [...(clauseGates.get(clause) ?? []), condition(leaf)]);
      }
      // In the TARGET fragment no attack is being made: "target" is the candidate unit, the eligibility's default subject.
      // Each target (subject each-target) is the candidate of every group it is copied into (compile-target-groups.ts).
      // A target or each-target condition in RESTRICTIONS ("You cannot target a unit that …", "Each unit targeted with this
      // Stratagem must …") is eligibility too: no attack is made there, so "target" is the Stratagem's.
      // A Stratagem's battle-round restriction is when it can be used: it joins the WHEN moment's condition (compile-usability-gate.ts).
      else if (usabilityAt.has(index)) usabilityNodes.push(condition(leaf));
      else if (leaf.role === "CONDITION" && (leaf.fragment === "TARGET" || (leaf.fragment === "RESTRICTIONS" && (leaf.parameters.subject === "each-target" || leaf.parameters.subject === "target")) || onAttackedTarget(list, leaf))) {
        // A WHEN condition on the targeted unit (compile-targeting-history.ts onAttackedTarget) is on the candidate too.
        const candidate = leaf.parameters.subject === "target" || leaf.parameters.subject === "each-target" || leaf.fragment === "WHEN";
        targetConditions.push({ index, eachTarget: leaf.parameters.subject === "each-target", node: condition(candidate ? { ...leaf, parameters: { ...leaf.parameters, subject: "this-unit" } } : leaf) });
      }
      else if (leaf.role === "CONDITION" && WRAP_CONDITION_FAMILIES.has(leaf.family_id)) {
        if (leaf.family_id === "aura-range") auraLeaf = leaf;
        else leaderLeaf = leaf;
      }
      else if (leaf.role === "CONDITION" && sizeRows && leaf.family_id === "battle-size") {
        // A row whose sentence holds a count-by-battle-size is already said by that count's value
        // for this size; a row with effects gates them; a bare heading row decides nothing.
        if (list.some((other, at) => other.family_id === "count-by-battle-size" && places[at]!.sentence === sentence)) return;
        // An effectless row joins the next sentence (compile-placement.ts), so two sizes on one
        // sentence are headings over the same effect, and neither says what its size decides.
        const other = list.find((item, at) => at !== index && item.family_id === "battle-size" && places[at]!.sentence === sentence && item.parameters.size !== leaf.parameters.size);
        if (!effectSentences.has(sentence) || other) throw new CompileError(`A ${String(leaf.parameters.size)} row has no effect or count in its sentence for its battle size to decide.`);
        sentenceGates.set(sentence, [...(sentenceGates.get(sentence) ?? []), condition(leaf)]);
      }
      // "If a friendly X unit is …, that unit's …": a per-recipient condition (compile-antecedent.ts)
      // is about the units of its own sentence's effect, so it gates only that sentence.
      else if (leaf.role === "CONDITION" && perRecipient && effectSentences.has(sentence) && Object.values(leaf.parameters).includes("recipient")) {
        sentenceGates.set(sentence, [...(sentenceGates.get(sentence) ?? []), condition(leaf)]);
      }
      else if (siblingScoped.has(index)) {
        clauseGates.set(clause, [...(clauseGates.get(clause) ?? []), condition(leaf)]);
      }
      else if (ownGates.has(index)) {
        sentenceGates.set(sentence, [...(sentenceGates.get(sentence) ?? []), condition(leaf)]);
      }
      else if (leaf.role === "CONDITION") scope(leaf.family_id === "target-is-selected" && !namesSelection(leaf) ? "selected" : leaf.family_id === "roll-result" ? rollMarker(leaf) : condition(leaf));
      else if (leaf.role === "DURATION") { durations.push(duration(leaf)); durationAt.push(index); }
      else if (leaf.role === "COMBINATOR") combinators.push(index);
      else if (leaf.role === "RESTRICTION") {
        if (leaf.family_id === "usage-limit") {
          usages.push(usageFor(leaf.parameters));
          usageIndexes.push(index);
          if (leaf.parameters.per !== undefined) usageScopes.add(String(leaf.parameters.per));
          if (leaf.parameters.per === "model") modelUsages.push({ leaf, index });
          if (leaf.parameters.per === "selected-unit") selectedUnitUsages.push({ leaf, index });
        } else if (leaf.family_id === "usage-scope") usageScopes.add(String(leaf.parameters.per));
        else if (leaf.family_id === "optional-use" && designationOptional.has(index)) { /* the designation's own choice: its opener is wrapped optional */ }
        else if (leaf.family_id === "optional-use") {
          // "You can also target one …": that later target is optional, not the Stratagem's use.
          const group = optionalTargetGroup(list, index);
          if (group === null) {
            optional = optional || !optionalSpend;
            if (!optionalSpend) optionalSentence = Math.max(optionalSentence, rawOf[index]!);
          }
          else optionalTargets.add(group);
        }
        else if (leaf.family_id === "rules-bundle-marker") rulesBundle = true;
        else if (["stratagem-target", "target-binding", "triggering-target"].includes(leaf.family_id)) { targetParts.push(leaf); targetPartIndexes.push(index); }
        else if (leaf.family_id === "use-window" || leaf.family_id === "bearer-eligibility") checks.push({ kind: leaf.family_id, parameters: leaf.parameters });
        // A non-Stratagem ability has no core record to hold its phases, so they gate the whole ability.
        else if (leaf.family_id === "activation-window") global.push(activationWindowCondition(leaf.parameters));
        else if (leaf.family_id === "move-must-end" || leaf.family_id === "reserves-arrival" || leaf.family_id === "count-by-battle-size" || leaf.family_id === "count-by-battle-round") { /* folded below */ }
        else if (leaf.family_id === "move-end-nearest" || leaf.family_id === "move-end-waiver") { /* attached below */ }
        // "this model has that ability": the menu before it already applies the chosen options;
        // "that unit has that ability": they are about the holder, not this unit.
        else if (leaf.family_id === "chosen-option-grant") {
          const opener = list.slice(0, index).map((other) => isContainerOpener(other.family_id)).lastIndexOf(true);
          if (opener < 0) throw new CompileError("\"Has that ability\" names the options chosen from a menu, but no menu opens before it.");
          // Every unit a bare unit-filter names (compile-unit-filters.ts gave the grant that filter as subject_filter).
          const filtered = leaf.parameters.holder === FILTERED_UNITS;
          if (filtered && leaf.parameters.subject_filter === undefined) throw new CompileError("\"That unit has that ability\" points back to a unit-filter whose units it cannot name.");
          const holder = filtered ? leaf.parameters.subject_filter : String(leaf.parameters.holder);
          if (holder !== "this-unit" && holder !== "this-model" && containerNodes.has(opener)) containerNodes.set(opener, retargetMenu(containerNodes.get(opener), holder) as Node);
        }
        else throw new CompileError(`Restriction ${leaf.family_id} has no DSL fragment yet.`);
      }
      else if (leaf.role === "EVENT") {
        if (leaf.family_id === "attack") {
          // "that targets an enemy unit visible to the bearer": the defender is the unit-filter right after it
          // (compile-unit-filters.ts folds it as attack_target_named). Without that filter the target would be dropped.
          if (leaf.parameters.target === "following-filter" && !list.some((other, at) => at > index && other.parameters.attack_target_named === true && other.fragment === leaf.fragment && at === index + 1)) {
            errors.push("An attack whose target is the unit-filter after it needs an enemy or friendly unit-filter right after it.");
          }
          // An attack whose properties compile-attack-properties.ts framed has its type on each of them;
          // a back-reference repeats its antecedent's type only where that one's gate does not reach.
          const gate = addsAttackGate(leaf) && leaf.parameters.permission_start === undefined ? attackTypeCondition(leaf) : null;
          if (gate) scope(gate);
          // "targets that unit": the designation's unit needs nothing more; the selected unit scopes as a selection.
          if (leaf.parameters.target === "that-unit" && attackTargetBinding(list, index) === "selected") scope("selected");
        } else if (leaf.family_id === "select-unit") selections.push(leaf);
        else if (leaf.family_id === "for-each-unit-select") forEachLeaf = leaf;
        else if (leaf.family_id === "dice-roll") {
          rolls.push(leaf);
          // per_model counts every model of its unit; wording that narrows the models ("engaged with that enemy unit") would be dropped.
          if (leaf.parameters.per_model !== undefined && sourceText !== undefined && leaf.end_byte !== undefined
            && NARROWED_PER_MODEL.test(exactSpan(sourceText, leaf.start_byte, leaf.end_byte))) {
            errors.push("A dice-roll per_model counts every model of its unit, but its wording narrows the models; author the bare quantifier (for-each-unit-select, a model unit-filter, membership, and the narrowing condition).");
          }
        }
        else if (!(leaf.family_id === "event" && ATTACK_EVENTS.has(String(leaf.parameters.kind)))) {
          // A list of roll kinds is one trigger per kind (compile-triggers.ts triggerLeaves).
          // A Stratagem's effect moment is a part under its WHEN moment (compile-when-subject.ts), not another trigger.
          const own = nestedMoments.has(index);
          const band = inBand.has(index);
          const place = (node: Node) => {
            if (band) bandTriggers.set(index, [...(bandTriggers.get(index) ?? []), node]);
            else if (own) nestedTriggers.push(node);
            else { triggers.push(node); triggerIndexes.push(index); }
          };
          for (const each of triggerLeaves(leaf)) place(withDestroyedObject(trigger(each), placesFromEventObject));
          // "At the start or end of this unit's move": the other end is an alternative moment.
          if (leaf.family_id === "event" && typeof leaf.parameters.also === "string") {
            const { also, ...rest } = leaf.parameters;
            place(trigger({ ...leaf, parameters: { ...rest, kind: also } }));
          }
        }
      } else if (leaf.role !== "EFFECT") throw new CompileError(`Role ${leaf.role} cannot compile.`);
    });
  });
  inheritRollGates(list, places, sentenceGates, gateOrigin);
  // A result band decides the later clauses of its sentence too ("on a 5+, X and must Y"), compile-clause-band.ts.
  inheritClauseBands(clauseGates, places, new Set(list.flatMap((leaf, at) => leaf.family_id === "fight-on-death" ? [places[at]!.sentence] : [])));
  return {
    list, places, errors, attempt, containerNodes, consumedByContainer, designationOptional, attached, global, sentenceGates, clauseGates,
    attachedGates, selectedClauses, selectedSentences, selectedGlobally: selectedGlobally as boolean, triggers, triggerIndexes, nestedMoments,
    nestedTriggers, inBand, bandTriggers, durations, durationAt, selections, rolls, combinators, usages, usageIndexes, usageScopes, modelUsages,
    selectedUnitUsages, optional: optional as boolean, optionalSentence, usabilityNodes, optionalSpend, optionalSpends, checks, targetParts,
    targetPartIndexes, targetConditions, optionalTargets, auraLeaf: auraLeaf as CompileLeaf | null, leaderLeaf: leaderLeaf as CompileLeaf | null,
    forEachLeaf: forEachLeaf as CompileLeaf | null, rulesBundle: rulesBundle as boolean, moveEnds, rawOf, pairCandidates, eligibilityIndexes,
    pairGatesBound, battleSizeCount, roundCount, endClauses,
  };
}
