import { exactSpan } from "./contracts.js";
import {
  ATTACK_EVENTS, attackTypeCondition, closed, CompileError, condition, DURATIONS, effect, kindKey, negate, trigger, type CompileLeaf,
} from "./compile-fragments.js";
import { resolveRolls, rollMarker } from "./compile-dice.js";
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
 * - Selected unit. Effects gated by "the target is the selected unit" go inside one
 *   designate-target for the ability's select-unit leaf. Without that gate, the selection only
 *   names "that unit" for effects such as mortal wounds.
 * - Rolls. Result bands gate their clause's effects and become dice-gated or dice-table; fighting
 *   on death takes its band and conditions as its own per-model gate (compile-dice.ts).
 * - Restrictions. How often compiles to `usage`; a stratagem's phases and an enhancement's
 *   eligible bearers compile to nothing and come back as checks against the core records.
 * - Two or more effects form a sequence in source order; a duration sets `scope.duration`;
 *   events other than attacks and selections become the trigger.
 *
 * No model is involved, so one approved shape produces the same kind of entry for every source.
 */

export type Compiled =
  | { ok: true; signature: string; mechanics: Mechanics; checks: CoreCheck[] }
  | { ok: false; signature: string; errors: string[] };

type Node = Record<string, unknown>;

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
  if (leaf.role === "EFFECT") return { kind: "effect", node: effect(leaf, { attached: false, incoming: false }) };
  if (leaf.role === "COMBINATOR") return { kind: "implicit", note: "No separate text: this effect replaces an earlier one of the same kind when its condition holds." };
  if (leaf.role === "RESTRICTION") {
    return { kind: "implicit", note: leaf.family_id === "usage-limit"
      ? `No separate text: sets the ability's usage to ${JSON.stringify(usageFor(leaf.parameters))}.`
      : leaf.family_id === "optional-use" ? "No separate text: the player chooses whether to use it (an optional trigger, or an activated ability)."
        : "No separate text: checked against the core record, which already holds it." };
  }
  if (leaf.family_id === "target-is-selected") return { kind: "implicit", note: "No separate text: the effects it gates apply to attacks against the selected unit." };
  if (leaf.family_id === "dice-roll") return { kind: "implicit", note: `No separate text: roll one ${String(leaf.parameters.dice)}; the result bands after it say what each result does.` };
  if (leaf.family_id === "roll-result") return { kind: "implicit", note: `No separate text: the effects in its clause happen on a ${String(leaf.parameters.from)}-${String(leaf.parameters.to)}.` };
  if (leaf.role === "CONDITION") return { kind: "condition", node: condition(leaf) };
  if (leaf.role === "DURATION") return { kind: "duration", duration: duration(leaf) };
  if (leaf.family_id === "attack") {
    const gate = attackTypeCondition(leaf);
    return gate ? { kind: "condition", node: gate } : { kind: "implicit", note: "No separate text: an attack is part of the effect it goes with." };
  }
  if (leaf.family_id === "select-unit") return { kind: "implicit", note: "No separate text: the selection is written with the effects that refer to the selected unit." };
  if (leaf.family_id === "event" && ATTACK_EVENTS.has(String(leaf.parameters.kind))) return { kind: "implicit", note: "No separate text: an attack-time event is part of the effect it goes with." };
  return { kind: "trigger", node: trigger(leaf) };
}

function duration(leaf: CompileLeaf): string {
  const found = DURATIONS[String(closed(leaf, "endpoint"))];
  if (!found) throw new CompileError(`Duration ${String(leaf.parameters.endpoint)} has no DSL scope yet.`);
  return found;
}

const allOf = (nodes: Node[]): Node | null => nodes.length === 0 ? null : nodes.length === 1 ? nodes[0]! : { operator: "and", operands: nodes };
const gated = (gate: Node[], body: Node): Node => {
  const node = allOf(gate);
  return node ? { type: "conditional", condition: node, effect: body } : body;
};

/** Effects that forbid something; an "instead" after one says what happens in its place. */
const PROHIBITIONS = new Set(["no-advance-roll"]);

type PlannedEffect = { index: number; leaf: CompileLeaf; node: Node; gate: Node[]; selected: boolean; replaces: boolean };

/** Compile one ability's reviewed leaves. Failures name what is missing; nothing is guessed. */
export function compileLeaves(leaves: readonly CompileLeaf[], sourceText?: string): Compiled {
  const list = ordered(leaves);
  const signature = shapeSignature(list, sourceText);
  const places = placements(list, sourceText);
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
  const durations: string[] = [];
  const selections: CompileLeaf[] = [];
  const rolls: CompileLeaf[] = [];
  const combinators: number[] = [];
  const usages: Record<string, unknown>[] = [];
  let optional = false;
  const checks: CoreCheck[] = [];

  list.forEach((leaf, index) => {
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
      if (leaf.role === "CONDITION") scope(leaf.family_id === "target-is-selected" ? "selected" : leaf.family_id === "roll-result" ? rollMarker(leaf) : condition(leaf));
      else if (leaf.role === "DURATION") durations.push(duration(leaf));
      else if (leaf.role === "COMBINATOR") combinators.push(index);
      else if (leaf.role === "RESTRICTION") {
        if (leaf.family_id === "usage-limit") usages.push(usageFor(leaf.parameters));
        else if (leaf.family_id === "optional-use") optional = true;
        else if (leaf.family_id === "use-window" || leaf.family_id === "bearer-eligibility") checks.push({ kind: leaf.family_id, parameters: leaf.parameters });
        else throw new CompileError(`Restriction ${leaf.family_id} has no DSL fragment yet.`);
      }
      else if (leaf.role === "EVENT") {
        if (leaf.family_id === "attack") {
          const gate = attackTypeCondition(leaf);
          if (gate) scope(gate);
        } else if (leaf.family_id === "select-unit") selections.push(leaf);
        else if (leaf.family_id === "dice-roll") rolls.push(leaf);
        else if (!(leaf.family_id === "event" && ATTACK_EVENTS.has(String(leaf.parameters.kind)))) triggers.push(trigger(leaf));
      } else if (leaf.role !== "EFFECT") throw new CompileError(`Role ${leaf.role} cannot compile.`);
    });
  });

  const planned: PlannedEffect[] = [];
  list.forEach((leaf, index) => {
    if (leaf.role !== "EFFECT") return;
    const { sentence, clause } = places[index]!;
    // The nearest attack before this effect says who attacks and which way.
    const attack = list.slice(0, index).reverse().find((item) => item.family_id === "attack");
    const node = attempt(() => effect(leaf, {
      attached,
      attacker: attack && attack.parameters.direction === "makes" ? (attack.parameters.unit === "this-model" ? "self" : "unit") : null,
      incoming: attack?.parameters.direction === "targeted",
    }));
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
    // "Do not make an Advance roll; instead, add 6\"": after a prohibition, "instead" says what
    // happens in its place, so the two effects simply both apply.
    const previous = planned.filter((item) => item.index < replacement.index).at(-1);
    if (!replaced && previous && PROHIBITIONS.has(previous.leaf.family_id)) continue;
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

  if (triggers.length > 1) errors.push("More than one trigger event; the shape needs a combinator the compiler does not have.");
  if (new Set(durations).size > 1) errors.push("Conflicting durations.");
  if (usages.length > 1) errors.push("More than one usage limit; the entry has one usage.");
  const selected = planned.filter((item) => item.selected);
  if (selections.length > 1) errors.push("More than one unit is selected; the compiler binds only one.");
  // A selection without "attacks against that unit" is only who "that unit" names (it suffers
  // mortal wounds, say); with it, every effect must be limited to those attacks.
  if (selections.length === 1 && selected.length > 0 && selected.length !== planned.length) errors.push("A unit is selected, but not every effect is limited to attacks against it.");
  if (selections.length === 0 && selected.length > 0) errors.push("An attack targets \"that unit\", but no select-unit leaf says which unit.");
  if (errors.length > 0) return { ok: false, signature, errors };

  const steps = attempt(() => resolveRolls(planned, global, rolls));
  if (!steps) return { ok: false, signature, errors };
  let body: Node | null = steps.length === 1 ? steps[0]! : { type: "sequence", steps };
  const scopeDuration = durations[0] ?? "permanent";
  if (selections.length === 1 && selected.length > 0) body = attempt(() => designation(selections[0]!, list, body!, durations[0]));
  if (!body) return { ok: false, signature, errors };
  return {
    ok: true,
    signature,
    mechanics: {
      effect: gated(global, body),
      scope: { range: "unit", duration: scopeDuration },
      // A choice with an event is an optional trigger; a choice without one is activated.
      behavior: triggers.length ? "reactive" : optional ? "activated" : "passive",
      trigger: triggers[0] ? (optional ? { ...triggers[0], optional: true } : triggers[0]) : null,
      ...(usages.length ? { usage: usages[0] } : {}),
    },
    checks,
  };
}

/** The selected unit and the effects on attacks against it, as the DSL's designate-target. */
function designation(selection: CompileLeaf, leaves: readonly CompileLeaf[], body: Node, lasting: string | undefined): Node {
  const attack = leaves.find((leaf) => leaf.family_id === "attack" && leaf.start_byte > selection.start_byte) ?? leaves.find((leaf) => leaf.family_id === "attack");
  if (!attack) throw new CompileError("A selected unit needs an attack leaf saying whose attacks against it are affected.");
  const own = attack.parameters.unit === "this-model" || attack.parameters.unit === "bearer";
  return {
    type: "designate-target",
    designation: "selected-unit",
    select: {
      scope: selection.parameters.scope === "friendly" ? "friendly-unit" : "enemy-unit",
      count: 1,
      ...(selection.parameters.distance === "within" ? { within_inches: selection.parameters.inches } : {}),
      ...(selection.parameters.visible === true ? { visibility_required: true } : {}),
    },
    applies: { to: own ? "bearer-attacks-target" : "attackers-of-target", effect: body },
    ...(lasting ? { duration: lasting } : {}),
  };
}
