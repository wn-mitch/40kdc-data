import { foldActivationPicks, retargetMenu } from "./compile-activation.js";
import { AURA_RECIPIENT, bindAntecedents, UNIT_EVENT_KINDS } from "./compile-antecedent.js";
import { foldAsIfPhases } from "./compile-as-if.js";
import { addsAttackGate, attackTargetBinding, isBackref, resolveAttackBackrefs } from "./compile-attack-backref.js";
import { bindPrecedingRolls, foldConditionalTestModifiers } from "./compile-preceding-roll.js";
import { CompileError, effect, type CompileLeaf } from "./compile-fragments.js";
import { activationWindowCondition, allOf, ATTACK_EVENTS, attackTypeCondition, bindDesignationSubjects, condition, duration, foldHitFilters, negate, targetRestrictions } from "./compile-conditions.js";
import { trigger } from "./compile-triggers.js";
import { ordered, placements, shapeSignature } from "./compile-placement.js";
import { resolveRolls, rollMarker } from "./compile-dice.js";
import { isContainerOpener, planContainers } from "./compile-containers.js";
import { designation, selectUnit, wrapAura, wrapForEachUnit, wrapLeaderTarget, wrapRulesBundle, WRAP_CONDITION_FAMILIES } from "./compile-wrappers.js";
import { compileNamedRegionState } from "./compile-named-region.js";
import { foldAlternativeConditions } from "./compile-alternative-conditions.js";
import { foldUnitFilters, mergeStackedFilters } from "./compile-unit-filters.js";
import { applyHolderAllowance, foldHolderAbilities } from "./compile-holder-abilities.js";
import { bindTargetedTarget, namesSelection } from "./compile-targeting-history.js";
import { foldWeaponKeywords } from "./compile-weapon-keywords.js";
import { foldWeaponScopes } from "./compile-weapon-scopes.js";
import { foldAttackProperties } from "./compile-attack-properties.js";
import { foldReturnedModelExclusions } from "./compile-returned-model-exclusions.js";
import { foldModelState } from "./compile-model-state.js";
import { joinSegments, sentenceSegments, STRATAGEM_HEADER } from "./compile-segments.js";
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
 * - Independent sentences. A sentence opening a new moment or "In addition," and an
 *   army-construction sentence compile alone as parts of the ability (`compile-segments.ts`);
 *   the rules below apply inside each part.
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

export { leafFragment, type LeafFragment } from "./compile-leaf-fragment.js";
export { shapeSignature } from "./compile-placement.js";

/**
 * Who makes an attack: a unit-filter folded onto it (compile-unit-filters.ts), any friendly or
 * enemy unit, this model, the aura's recipient or this unit. "That unit" is the unit an earlier
 * leaf introduced: the aura's recipient, else the selected unit, else this unit (a led unit).
 */
function attackerOf(attack: CompileLeaf, thatUnit: string): Node | string {
  if (attack.parameters.attacker_filter !== undefined) return structuredClone(attack.parameters.attacker_filter as Node);
  const unit = attack.parameters.unit;
  if (unit === "friendly-unit") return { owner: "friendly" };
  if (unit === "enemy-unit") return { owner: "enemy" };
  if (unit === "that-unit") return thatUnit;
  return unit === "this-model" ? "this-model" : unit === "recipient" ? "recipient" : "this-unit";
}

const gated = (gate: Node[], body: Node): Node => {
  const node = allOf(gate);
  return node ? { type: "conditional", condition: node, effect: body } : body;
};

/** Leaves only a stratagem has: its phase window and its TARGET. */
const STRATAGEM_FAMILIES = new Set(["use-window", "stratagem-target", "triggering-target", "target-binding"]);

/**
 * Effects that keep changing the game until something ends them, so a duration bounds them. One-off
 * results (mortal wounds, a move, a test, a set-up, regained wounds, CP) and effects that end by
 * their own rule (a designation, a sticky objective, a state change, an activated option) are not.
 */
const LASTING_EFFECTS = new Set([
  "ability-grant", "ability-modifier", "act-on-death", "borrow-weapons", "cost-modifier", "counts-as", "damage-reduction",
  "destruction-rule", "feel-no-pain", "ignore-modifiers", "invulnerable-save", "keyword-grant", "leader-model-ability-grant",
  "move-modifier", "named-region-state", "permission", "re-roll", "roll-modifier", "roll-result", "rule-state", "stat-modifier",
  "targeting", "test-exemption", "transport-capacity", "weapon-ability-grant", "weapon-grant",
]);

/** Whether an effect tree holds a lasting effect. */
function hasLastingEffect(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasLastingEffect);
  if (node === null || typeof node !== "object") return false;
  const record = node as Node;
  return (typeof record.type === "string" && LASTING_EFFECTS.has(record.type)) || Object.values(record).some(hasLastingEffect);
}

/**
 * The period a used or triggered ability's window names, which its effects last for when no
 * duration is printed (core rule 01.02.02: "In the Shooting phase" with no duration lasts until the
 * end of that Shooting phase). A window of phases is a phase; "in your turn" alone is the turn.
 */
function windowPeriod(list: readonly CompileLeaf[]): "phase" | "turn" | null {
  const windows = list.filter((leaf) => leaf.family_id === "use-window" || leaf.family_id === "activation-window"
    || (leaf.family_id === "phase-window" && leaf.parameters.phase !== "any"));
  if (windows.some((leaf) => leaf.family_id !== "phase-window" || leaf.parameters.phase !== undefined)) return "phase";
  return windows.length ? "turn" : null;
}

/** Effects that forbid something; an "instead" after one says what happens in its place. */
const PROHIBITIONS = new Set(["no-advance-roll"]);

/** "Add 6 to Move": what a no-advance-roll's `advance: fixed-6` does in place of the roll. */
function isAdvanceInPlace(node: Node): boolean {
  const modifier = node.modifier as Node | undefined;
  return node.type === "stat-modifier" && node.target !== "attacker" && modifier?.stat === "M" && modifier.operation === "add"
    && Number(modifier.value) === 6 && modifier.weapon_type === undefined;
}

type PlannedEffect = { index: number; leaf: CompileLeaf; node: Node; gate: Node[]; selected: boolean; replaces: boolean };

/**
 * A container option that carries its own moment or conditions, compiled as a whole ability and
 * returned as one ability-part: its trigger, usage and duration go on the part, its effect inside.
 */
function nestedPart(group: readonly CompileLeaf[], sourceText: string | undefined, options: CompileOptions): Node {
  const compiled = compileLeaves(group, sourceText, options);
  if (!compiled.ok) throw new CompileError(compiled.errors[0]!);
  const { effect: body, trigger: moment, usage, scope } = compiled.mechanics;
  if (!moment && !usage && (scope.duration === undefined || scope.duration === "permanent")) return body;
  const part: Node = { type: "ability-part", effect: body };
  if (moment) part.trigger = moment;
  if (usage) part.usage = usage;
  if (scope.duration !== undefined && scope.duration !== "permanent") part.duration = scope.duration;
  return part;
}

/**
 * An ignore-modifiers list that names characteristics and rolls together ("BS, Hit rolls and
 * Wound rolls") is one leaf; the DSL's ignore-modifiers holds one kind, so it lowers to one
 * single-kind leaf per kind, on the same wording, in the list's order.
 */
function splitIgnoreModifiers(list: readonly CompileLeaf[]): CompileLeaf[] {
  return list.flatMap((leaf) => {
    if (leaf.family_id !== "ignore-modifiers" || !Array.isArray(leaf.parameters.what)) return [leaf];
    const { what, stats, rolls, ...rest } = leaf.parameters as Record<string, unknown> & { what: string[] };
    return what.map((kind) => ({ ...leaf, parameters: { ...rest, what: kind, ...(kind === "characteristics" ? (stats === undefined ? {} : { stats }) : { rolls }) } }));
  });
}

/** What the compiler knows of the record: `abilityId` is the ability "this ability" names (own-abilities.ts). */
export type CompileOptions = { abilityId?: string };

/** Compile one ability's reviewed leaves. Failures name what is missing; nothing is guessed. */
export function compileLeaves(leaves: readonly CompileLeaf[], sourceText?: string, options: CompileOptions = {}): Compiled {
  const segments = sentenceSegments(ordered(leaves), sourceText);
  if (!segments) return compilePart(leaves, sourceText, options);
  // Independent sentences (compile-segments.ts) compile alone and join as parts of one ability.
  const signature = shapeSignature(ordered(leaves), sourceText);
  const results = segments.map((part) => compilePart(part, sourceText, options));
  // A part that cannot stand alone ("such a unit", an "instead" of an earlier sentence's effect)
  // is still tied to the sentences before it: the ability compiles as one part.
  if (results.some((result) => !result.ok)) return compilePart(leaves, sourceText, options);
  const joined = joinSegments(results.flatMap((result) => result.ok ? [result] : []), leaves.some((leaf) => STRATAGEM_HEADER.has(leaf.family_id)));
  if (joined.errors.length) return { ok: false, signature, errors: joined.errors };
  return { ok: true, signature, mechanics: joined.mechanics, checks: joined.checks, ...(joined.core ? { core: joined.core } : {}) };
}

function compilePart(leaves: readonly CompileLeaf[], sourceText: string | undefined, options: CompileOptions): Compiled {
  const signature = shapeSignature(ordered(leaves), sourceText);
  let list: CompileLeaf[];
  try {
    list = foldActivationPicks(foldAlternativeConditions(bindTargetedTarget(foldUnitFilters(foldWeaponKeywords(foldAttackProperties(foldWeaponScopes(foldModelState(foldReturnedModelExclusions(foldAsIfPhases(foldHitFilters(bindDesignationSubjects(bindPrecedingRolls(bindAntecedents(mergeStackedFilters(foldHolderAbilities(splitIgnoreModifiers(resolveAttackBackrefs(ordered(leaves))), sourceText, options.abilityId), sourceText)))), sourceText), sourceText), sourceText)), sourceText), sourceText), sourceText), sourceText)), sourceText));
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature, errors: [error.message] };
  }
  // "within range of that objective marker": the marker this record's one select-objective chose.
  const objectiveSelections = list.filter((leaf) => leaf.family_id === "select-objective-open").map((leaf) => String(leaf.parameters.bind_as));
  list = list.map((leaf) => leaf.family_id === "unit-position" && leaf.parameters.objective === "selected" && objectiveSelections.length === 1
    ? { ...leaf, parameters: { ...leaf.parameters, selection_var: objectiveSelections[0] } } : leaf);
  // "in any phase" with no turn restricts nothing: it says the ability is not phase-bound.
  list = list.filter((leaf) => !(leaf.family_id === "phase-window" && leaf.parameters.phase === "any"
    && (leaf.parameters.turn === undefined || leaf.parameters.turn === "either")));
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
    ({ nodes: containerNodes, consumed: consumedByContainer } = planContainers(list, places.map((place) => place.sentence), (group) => nestedPart(group, sourceText, options)));
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
  const usageIndexes: number[] = [];
  const usageScopes = new Set<string>();
  let optional = false;
  const checks: CoreCheck[] = [];
  const targetParts: CompileLeaf[] = [];
  const targetEligibility: Node[] = [];
  // Container-wrapping markers (batch 5): at most one of each is expected on a real ability.
  let auraLeaf: CompileLeaf | null = null;
  let leaderLeaf: CompileLeaf | null = null;
  let forEachLeaf: CompileLeaf | null = null;
  let rulesBundle = false;

  // "Your unit must end that move either …": the conditions after a move-must-end in its sentence
  // say where the preceding move ends, so they gate nothing and are taken out of clause binding.
  const moveEnds = list.flatMap((leaf, index) => leaf.family_id === "move-must-end" ? [{
    index, match: String(leaf.parameters.match), cannot: leaf.parameters.polarity === "cannot",
    conditions: list.flatMap((other, at) => at > index && other.role === "CONDITION" && places[at]!.sentence === places[index]!.sentence ? [at] : []),
  }] : []);
  const endConditions = new Set(moveEnds.flatMap((rule) => rule.conditions));
  // Conditions on the selected unit right after a selection in its sentence ("select one enemy
  // unit within 6\" of this unit", "that are on the battlefield") say which units can be selected:
  // the selection's eligibility, not a gate on the ability.
  const selectionIndex = list.findIndex((leaf) => leaf.family_id === "select-unit");
  const eligibilityIndexes = selectionIndex === -1 ? [] : list.flatMap((leaf, at) => at > selectionIndex && leaf.role === "CONDITION"
    && leaf.parameters.subject === "selected-unit" && places[at]!.sentence === places[selectionIndex]!.sentence
    && !list.slice(selectionIndex + 1, at).some((between) => between.role === "EFFECT") ? [at] : []);
  for (const at of eligibilityIndexes) endConditions.add(at);
  const battleSizeCount = list.find((leaf) => leaf.family_id === "count-by-battle-size");
  // Battle-size leaves for two or more sizes are table rows: alternatives, one per size. Each row
  // decides only its own sentence, so a row never joins the ability-wide gates (where rows would
  // AND together and the ability could never apply).
  const sizeRows = new Set(list.filter((leaf) => leaf.family_id === "battle-size").map((leaf) => String(leaf.parameters.size))).size >= 2;

  // Outside an aura or a for-each, a condition about the recipient is about each unit an effect's filter matches.
  const perRecipient = !list.some((leaf) => leaf.family_id === "aura-range" || leaf.family_id === "for-each-unit-select");
  list.forEach((leaf, index) => {
    if (endConditions.has(index)) return;
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
      // In the TARGET fragment no attack is being made: "target" is the candidate unit, the eligibility's default subject.
      if (leaf.role === "CONDITION" && leaf.fragment === "TARGET") targetEligibility.push(condition(leaf.parameters.subject === "target" ? { ...leaf, parameters: { ...leaf.parameters, subject: "this-unit" } } : leaf));
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
      else if (leaf.role === "CONDITION") scope(leaf.family_id === "target-is-selected" && !namesSelection(leaf) ? "selected" : leaf.family_id === "roll-result" ? rollMarker(leaf) : condition(leaf));
      else if (leaf.role === "DURATION") durations.push(duration(leaf));
      else if (leaf.role === "COMBINATOR") combinators.push(index);
      else if (leaf.role === "RESTRICTION") {
        if (leaf.family_id === "usage-limit") {
          usages.push(usageFor(leaf.parameters));
          usageIndexes.push(index);
          if (leaf.parameters.per !== undefined) usageScopes.add(String(leaf.parameters.per));
        } else if (leaf.family_id === "usage-scope") usageScopes.add(String(leaf.parameters.per));
        else if (leaf.family_id === "optional-use") optional = true;
        else if (leaf.family_id === "rules-bundle-marker") rulesBundle = true;
        else if (["stratagem-target", "target-binding", "triggering-target"].includes(leaf.family_id)) targetParts.push(leaf);
        else if (leaf.family_id === "use-window" || leaf.family_id === "bearer-eligibility") checks.push({ kind: leaf.family_id, parameters: leaf.parameters });
        // A non-Stratagem ability has no core record to hold its phases, so they gate the whole ability.
        else if (leaf.family_id === "activation-window") global.push(activationWindowCondition(leaf.parameters));
        else if (leaf.family_id === "move-must-end" || leaf.family_id === "reserves-arrival" || leaf.family_id === "count-by-battle-size") { /* folded below */ }
        // "this model has that ability": the menu before it already applies the chosen options;
        // "that unit has that ability": they are about the holder, not this unit.
        else if (leaf.family_id === "chosen-option-grant") {
          const opener = list.slice(0, index).map((other) => isContainerOpener(other.family_id)).lastIndexOf(true);
          if (opener < 0) throw new CompileError("\"Has that ability\" names the options chosen from a menu, but no menu opens before it.");
          const holder = String(leaf.parameters.holder);
          if (holder !== "this-unit" && holder !== "this-model" && containerNodes.has(opener)) containerNodes.set(opener, retargetMenu(containerNodes.get(opener), holder) as Node);
        }
        else throw new CompileError(`Restriction ${leaf.family_id} has no DSL fragment yet.`);
      }
      else if (leaf.role === "EVENT") {
        if (leaf.family_id === "attack") {
          // An attack whose properties compile-attack-properties.ts framed has its type on each of them;
          // a back-reference repeats its antecedent's type only where that one's gate does not reach.
          const gate = addsAttackGate(leaf) ? attackTypeCondition(leaf) : null;
          if (gate) scope(gate);
          // "targets that unit": the designation's unit needs nothing more; the selected unit scopes as a selection.
          if (leaf.parameters.target === "that-unit" && attackTargetBinding(list, index) === "selected") scope("selected");
        } else if (leaf.family_id === "select-unit") selections.push(leaf);
        else if (leaf.family_id === "for-each-unit-select") forEachLeaf = leaf;
        else if (leaf.family_id === "dice-roll") rolls.push(leaf);
        else if (!(leaf.family_id === "event" && ATTACK_EVENTS.has(String(leaf.parameters.kind)))) {
          triggers.push(trigger(leaf));
          triggerIndexes.push(index);
          // "At the start or end of this unit's move": the other end is an alternative moment.
          if (leaf.family_id === "event" && typeof leaf.parameters.also === "string") {
            const { also, ...rest } = leaf.parameters;
            triggers.push(trigger({ ...leaf, parameters: { ...rest, kind: also } }));
            triggerIndexes.push(index);
          }
        }
      } else if (leaf.role !== "EFFECT") throw new CompileError(`Role ${leaf.role} cannot compile.`);
    });
  });

  // "a model in that unit makes an attack": the aura's recipient, else the selected unit, else the
  // unit of the moment the ability fires on, else this unit (a led unit).
  const unitMoment = list.some((leaf) => leaf.family_id === "event" && UNIT_EVENT_KINDS.has(String(leaf.parameters.kind)) && !ATTACK_EVENTS.has(String(leaf.parameters.kind)));
  const thatUnit = auraLeaf ? AURA_RECIPIENT : selections.length ? "selected-unit" : unitMoment ? "event-subject" : "this-unit";
  const planned: PlannedEffect[] = [];
  list.forEach((leaf, index) => {
    if (consumedByContainer.has(index)) return;
    if (leaf.role !== "EFFECT") return;
    const { sentence, clause } = places[index]!;
    const node = containerNodes.has(index) ? containerNodes.get(index)! : attempt(() => {
      // The nearest attack before this effect says who attacks and which way; a back-reference
      // ("that attack") is its antecedent, which still carries the attacker's filter.
      const attack = list.slice(0, index).reverse().find((item) => item.family_id === "attack" && !isBackref(item));
      return effect(leaf, {
        attached,
        attacker: attack && attack.parameters.direction === "makes" ? attackerOf(attack, thatUnit) : null,
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

  // "Can make an ingress move in your next Movement phase": the set-up before it returns then.
  for (const [index, leaf] of list.entries()) {
    if (leaf.family_id !== "reserves-arrival") continue;
    const setUp = planned.filter((item) => item.index < index && item.node.type === "set-up").at(-1);
    if (!setUp) { errors.push("A reserves arrival has no set-up before it."); continue; }
    const modifier = setUp.node.modifier as Node;
    modifier.arrives = "next-movement-phase";
    if (leaf.parameters.allow_first_round === true) modifier.allow_first_round = true;
  }
  for (const rule of moveEnds) {
    const move = planned.filter((item) => item.index < rule.index && item.node.type === "move").at(-1);
    if (!move) { errors.push("\"Must end that move\" has no move before it."); continue; }
    if (rule.conditions.length === 0) { errors.push("\"Must end that move\" names no condition for where the move ends."); continue; }
    const nodes = rule.conditions.map((at) => attempt(() => condition(list[at]!))).filter((node): node is Node => node !== null);
    if (nodes.length !== rule.conditions.length) continue;
    const where: Node = nodes.length === 1 ? nodes[0]! : { operator: rule.match === "any" ? "or" : "and", operands: nodes };
    // "Cannot end that move …": the move ends anywhere the named place is not.
    (move.node.modifier as Node).ends_when = rule.cannot ? { operator: "not", operands: [where] } : where;
  }

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
      // "It can move up to 6\" instead of up to 3\"": the default it replaces is another rule's,
      // printed after "instead of", so the clause's effect already says the new value.
      const named = sourceText !== undefined && /^\s*of\b/u.test(Buffer.from(sourceText, "utf8").subarray(list[combinator]!.end_byte).toString("utf8"));
      if (!named) errors.push(`"Instead" has no earlier ${replacement.leaf.family_id} effect to replace.`);
      continue;
    }
    // "Re-roll Hit rolls of 1. Or: if …, re-roll Hit rolls": the player picks one of the two, each
    // under its own conditions.
    if (list[combinator]!.parameters.choice === true) {
      replaced.node = { type: "choice", options: [gated(replaced.gate, replaced.node), gated(replacement.gate, replacement.node)] };
      replaced.gate = [];
      planned.splice(planned.indexOf(replacement), 1);
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
  // A plain selection ("select one enemy unit … that unit suffers …") binds inside the part that
  // holds it. A selection that limits attacks to that unit (designation) still needs one moment.
  if (partStarts.length && selections.length && planned.some((item) => item.selected)) {
    errors.push("A unit is selected for attacks in an ability with parts; the compiler binds that only for one moment.");
  }
  // "One or more units from your army with this ability": once for the army (compile-holder-abilities.ts).
  applyHolderAllowance(list, triggers, options.abilityId, usages, usageScopes);
  if (new Set(durations).size > 1) errors.push("Conflicting durations.");
  if (usages.length > 1) errors.push("More than one usage limit; the entry has one usage.");
  if (usageScopes.size > 1) errors.push("Conflicting usage scopes.");
  if (usages.length && usageScopes.size === 0) errors.push("Usage frequency needs a reviewed usage scope.");
  if (!usages.length && usageScopes.size) errors.push("Usage scope has no frequency.");
  if (usages.length === 1 && usageScopes.size === 1) {
    const per = usageScopes.values().next().value!;
    if (per !== "any") usages[0]!.per = per;
  }
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
  // In a compound ability, a selection wraps only its own part's effects.
  const selectionPart = partStarts.length && selections.length === 1 ? partOf(list.indexOf(selections[0]!)) : null;
  if (selectionPart !== null && selectionPart > 0) {
    const own = pieces[selectionPart]!;
    pieces[selectionPart] = [selectUnit(selections[0]!, own.length === 1 ? own[0]! : { type: "sequence", steps: own })];
  }
  const steps = pieces[0]!;
  let body: Node | null = steps.length === 1 ? steps[0]! : { type: "sequence", steps };
  const scopeDuration = durations[0] ?? "permanent";
  // "If an enemy unit within 8\" of this unit is below Starting Strength": a gate on each unit an
  // aura or a for-each reaches holds per recipient, inside the wrap, not once around it.
  if (auraLeaf || forEachLeaf) {
    const perUnit = global.filter((node) => JSON.stringify(node).includes(`"${AURA_RECIPIENT}"`));
    if (perUnit.length) {
      global.splice(0, global.length, ...global.filter((node) => !perUnit.includes(node)));
      body = gated(perUnit, body!);
    }
  }
  const eligibility = eligibilityIndexes.length ? attempt(() => allOf(eligibilityIndexes.map((at) => condition(list[at]!)))) : null;
  if (selections.length === 1 && selected.length > 0) {
    // "Ranged attacks that target that unit": an attack-type gate says which attacks against the
    // designated unit are changed, so it narrows the designation's effect, not the selection.
    const attackGates = global.filter((node) => node.type === "attack-is");
    if (attackGates.length) global.splice(0, global.length, ...global.filter((node) => node.type !== "attack-is"));
    body = attempt(() => designation(selections[0]!, list, gated(attackGates, body!), durations[0], eligibility));
  }
  // "Select one enemy unit to be this model's prey": a persistent designation makes that selection itself.
  else if (selections.length === 1 && body?.type === "persistent-designation") { /* its own select */ }
  else if (selections.length === 1 && (selectionPart === null || selectionPart === 0)) {
    body = selectUnit(selections[0]!, body, {
      ...(battleSizeCount ? { maxCount: { incursion: battleSizeCount.parameters.incursion, "strike-force": battleSizeCount.parameters["strike-force"], onslaught: battleSizeCount.parameters.onslaught } } : {}),
      eligibility,
    });
  }
  else if (forEachLeaf) { const each = forEachLeaf; body = attempt(() => wrapForEachUnit(each, body!)); }
  if (!body) return { ok: false, signature, errors };
  if (auraLeaf) { const aura = auraLeaf; body = attempt(() => wrapAura(aura, body!)); }
  if (leaderLeaf) { const leader = leaderLeaf; body = attempt(() => wrapLeaderTarget(leader, body!)); }
  if (!body) return { ok: false, signature, errors };
  if (rulesBundle) body = wrapRulesBundle(body);
  const stratagem = list.some((leaf) => STRATAGEM_FAMILIES.has(leaf.family_id));
  const behavior = auraLeaf ? "aura" : triggers.length ? "reactive" : optional || stratagem ? "activated" : "passive";
  // A used or triggered ability with no printed duration lasts for its window's period. A passive
  // ability gated on a phase already holds only in that phase, and an aura only while in range.
  const period = durations.length === 0 && (behavior === "reactive" || behavior === "activated") && hasLastingEffect(body) ? windowPeriod(list) : null;
  // "That X unit": the WHEN moment's unit must have the keywords the target names.
  const bound = targetParts.find((leaf) => leaf.family_id === "triggering-target");
  const moments = triggers.map((node) => {
    const moment: Node = optional ? { ...node, optional: true } : { ...node };
    // The keywords narrow whoever acted: a filter subject gains all_of; this unit gets a keyword condition.
    if (bound && bound.parameters.match === "all" && (bound.parameters.keywords as string[]).length) {
      const keywords = bound.parameters.keywords as string[];
      const withKeywords = (unit: Node) => ({ ...unit, all_of: [...new Set([...((unit.all_of as string[] | undefined) ?? []), ...keywords])] });
      // When an enemy acts ("when an enemy unit targets a friendly X unit", "ends a move within 8\"
      // of a friendly X unit") the Stratagem's unit is never that enemy: it is the moment's
      // object, or else this unit, which the keywords gate.
      const enemyActs = moment.subject !== null && typeof moment.subject === "object" && (moment.subject as Node).owner === "enemy";
      if (enemyActs) {
        if (moment.object !== null && typeof moment.object === "object" && (moment.object as Node).owner !== "enemy") moment.object = withKeywords(moment.object as Node);
        else {
          const gate: Node = { type: "has-keyword", parameters: { all_of: keywords } };
          const own = moment.condition as Node | undefined;
          moment.condition = own ? { operator: "and", operands: [own, gate] } : gate;
        }
      } else if (moment.subject !== null && typeof moment.subject === "object") moment.subject = withKeywords(moment.subject as Node);
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
    // "The first time the bearer's unit destroys an enemy unit": a usage limit right before a later
    // part's moment, after an earlier effect, limits only that part.
    const usageAt = usageIndexes.length === 1 && firstEffectIndex !== -1 && usageIndexes[0]! > firstEffectIndex ? usageIndexes[0]! : -1;
    const usagePart = usageAt === -1 ? -1 : partStarts.findIndex((part) => part.index > usageAt && !planned.some((item) => item.index > usageAt && item.index < part.index));
    partStarts.forEach((part, position) => {
      const own = pieces[position + 1]!;
      partSteps.push({
        type: "ability-part", trigger: asTrigger(part.moments.map((index) => moments[index]!)), effect: own.length === 1 ? own[0]! : { type: "sequence", steps: own },
        ...(position === usagePart ? { usage: usages[0] } : {}),
      });
    });
    if (usagePart !== -1) usages.splice(0);
    body = { type: "sequence", steps: partSteps };
    entryTrigger = null;
  }
  return {
    ok: true,
    signature,
    ...(target ? { core: { target_restrictions: target } } : {}),
    mechanics: {
      effect: gated(global, foldConditionalTestModifiers(body)),
      scope: { duration: period ?? scopeDuration },
      // A choice with an event is an optional trigger; a choice without one is activated, as is a
      // stratagem (it has a phase window or a TARGET), which a player always chooses to use. An
      // aura-range leaf always reads as an aura, ahead of any of those.
      behavior,
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
  // A selection already compiled into a node (an option's own select-units) binds its own selected unit.
  if (record.type === "select-units") return false;
  return record.target === "selected-unit" || Object.values(record).some(namesSelected);
}

