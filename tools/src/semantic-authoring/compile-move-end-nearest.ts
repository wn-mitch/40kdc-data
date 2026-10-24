import type { CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/** A planned node: the leaf index it came from, the leaf, and the DSL node it compiled to. */
export type PlannedNode = { index: number; leaf: CompileLeaf; node: Node };

/** A move-distance bonus node: a move-modifier that names how far the bonus adds. */
export function isBonusNode(node: Node): boolean {
  return node.type === "move-modifier" && (node.modifier as Node | undefined)?.distance_bonus !== undefined;
}

/** A move-end nearest's destination: following-filter (version 1, the unit its filter names) when absent. */
export function destinationOf(leaf: CompileLeaf): string {
  return typeof leaf.parameters.to === "string" ? leaf.parameters.to : "following-filter";
}

/**
 * The DSL value of one move-end nearest: `of` (the unit its folded filter names, the enemy unit the
 * trigger names, any objective marker, or the objective a select-objective bound), per model when it
 * says so, and instead_of.
 * The selected objective is bound by exactly one select-objective: a select-objective leaf in this
 * ability, or the one whose body this ability is (`selectedObjective`). A select leaf in this ability
 * must come before the move-end, since the DSL binds the name for the select's own effect only.
 * Returns an error when the destination has no value in this ability.
 */
export function endsNearestValue(list: readonly CompileLeaf[], at: number, selectedObjective?: string): { value: Node } | { error: string } {
  const leaf = list[at]!;
  const to = destinationOf(leaf);
  const value: Node = {};
  if (to === "following-filter") {
    if (leaf.parameters.of === undefined) return { error: "A move-end nearest has no unit-filter for the unit it ends nearest." };
    value.of = leaf.parameters.of;
  } else if (to === "event-subject") {
    // "as close as possible to that enemy unit": the unit the trigger names, not a filter or an objective.
    value.of = "event-subject";
  } else if (to === "closest-objective-marker") {
    value.of = { objective: {} };
  } else {
    const selections = list.flatMap((other, index) => other.family_id === "select-objective-open" ? [{ name: String(other.parameters.bind_as), index }] : []);
    const bound = selectedObjective === undefined ? selections : [...selections, { name: selectedObjective, index: -1 }];
    if (bound.length !== 1) return { error: "A move-end nearest to the selected objective needs exactly one select-objective in its ability." };
    if (bound[0]!.index > at) return { error: "A move-end nearest to the selected objective comes before the select-objective that binds it." };
    value.of = { objective: { selection_var: bound[0]!.name } };
  }
  if (leaf.parameters.per === "model") value.per = "model";
  if (leaf.parameters.instead_of !== undefined) value.instead_of = leaf.parameters.instead_of;
  return { value };
}

/**
 * "…, can end that move as close as possible to …": the sentence the move-end sits in has "can" and
 * no "must", so the unit may choose this destination. The sentence is the text between the sentence
 * stops (. ; :) around the leaf. Needs the source text; without it the answer is no.
 */
export function sentenceIsOptional(sourceText: string | undefined, leaf: CompileLeaf): boolean {
  if (sourceText === undefined || leaf.end_byte === undefined) return false;
  const bytes = Buffer.from(sourceText, "utf8");
  const before = bytes.subarray(0, leaf.start_byte).toString("utf8").replace(/^[\s\S]*[.;:]/u, "");
  const own = bytes.subarray(leaf.start_byte, leaf.end_byte).toString("utf8");
  const after = bytes.subarray(leaf.end_byte).toString("utf8").replace(/[.;:][\s\S]*$/u, "");
  const sentence = `${before}${own}${after}`;
  return /\bcan\b/iu.test(sentence) && !/\bmust\b/iu.test(sentence);
}

/**
 * The trigger's move for a move-end with no make-move in its sentence: the nearest earlier selected
 * or move-ended event. A selection names the moves it covers (move_types) and the move ends after it.
 * A move-ended trigger has no move left to end, and a trigger with no move_types names no move.
 */
function triggerEndNearest(list: readonly CompileLeaf[], at: number, endsNearest: Node): { node: Node; trigger: number } | { error: string } {
  let trigger = -1;
  for (let other = at - 1; other >= 0 && trigger < 0; other -= 1) {
    const leaf = list[other]!;
    if (leaf.family_id === "event" && (leaf.parameters.kind === "selected" || leaf.parameters.kind === "move-ended")) trigger = other;
  }
  const named = trigger < 0 ? undefined : list[trigger];
  if (named === undefined || !Array.isArray(named.parameters.move_types)) return { error: "A move-end has no move to attach to." };
  if (named.parameters.kind === "move-ended") return { error: "A move-end after a move-ended trigger has no move left to end: the move has already ended." };
  return { node: { type: "move-modifier", target: "event-subject", modifier: { applies_to_moves: named.parameters.move_types, ends_nearest: endsNearest } }, trigger };
}

/**
 * Attaches each move-end-nearest (its filter already folded into `of` for a following-filter
 * destination) and its waiver, if any, to the nearest earlier move in the same sentence: a make-move
 * gets ends_nearest on its modifier; a move-distance bonus gets a new move-modifier of its own, so the
 * bonus itself is never gated by the end rule. With no move in the sentence, the end attaches to the
 * ability's selected move (triggerEndNearest), as an entry built by `entryFor`. Returns the refusals;
 * nothing is attached when one is returned for that leaf.
 */
export function attachMoveEndNearest<T extends PlannedNode>(
  list: readonly CompileLeaf[], planned: T[], sentenceAt: (index: number) => number, gateAt: (index: number) => Node[],
  entryFor: (at: number, node: Node) => T, sourceText?: string, selectedObjective?: string,
  consumed: ReadonlySet<number> = new Set(),
): string[] {
  const errors: string[] = [];
  // A leaf a container took (consumed) is compiled inside that container's body, not here.
  const nearests = list.flatMap((leaf, at) => leaf.family_id === "move-end-nearest" && !consumed.has(at) ? [at] : []);
  const waivers = list.flatMap((leaf, at) => leaf.family_id === "move-end-waiver" && !consumed.has(at) ? [at] : []);
  for (const waiver of waivers) {
    if (!nearests.some((at) => sentenceAt(at) === sentenceAt(waiver))) errors.push("A move-end waiver needs a move-end nearest the closest unit in its sentence.");
  }
  for (const at of nearests) {
    const sentence = sentenceAt(at);
    const leaf = list[at]!;
    const own = waivers.filter((waiver) => sentenceAt(waiver) === sentence);
    if (own.length > 1) { errors.push("A move-end nearest has more than one waiver in its sentence."); continue; }
    if (own.length === 1 && destinationOf(leaf) !== "following-filter") { errors.push("A move-end waiver applies only to a move-end nearest the closest unit."); continue; }
    if (own.length === 1 && leaf.parameters.instead_of !== undefined) { errors.push("A move-end waiver and \"instead of\" the closest enemy unit in one sentence have no DSL form together."); continue; }
    const built = endsNearestValue(list, at, selectedObjective);
    if ("error" in built) { errors.push(built.error); continue; }
    if (sentenceIsOptional(sourceText, leaf)) { errors.push("A move-end the unit can choose is optional; no optional destination shape exists."); continue; }
    const endsNearest: Node = built.value;
    if (own.length === 1) endsNearest.waives = list[own[0]!]!.parameters.rule;
    const target = planned.filter((item) => item.index < at && sentenceAt(item.index) === sentence && (item.node.type === "move" || isBonusNode(item.node))).at(-1);
    if (!target) {
      const fallback = triggerEndNearest(list, at, endsNearest);
      if ("error" in fallback) { errors.push(fallback.error); continue; }
      // One move-end per trigger: an earlier fallback end on the same trigger's move is already there.
      if (planned.some((item) => item.index > fallback.trigger && item.index < at && (item.node.target === "event-subject") && (item.node.modifier as Node | undefined)?.ends_nearest !== undefined)) {
        errors.push("A second move-end nearest on the same move has no DSL form.");
        continue;
      }
      const next = planned.findIndex((item) => item.index > at);
      const entry = entryFor(at, fallback.node);
      if (next === -1) planned.push(entry); else planned.splice(next, 0, entry);
      continue;
    }
    if (target.node.type === "move") {
      const modifier = target.node.modifier as Node;
      if (modifier.ends_nearest !== undefined) { errors.push("A move already has a move-end nearest; a second one has no DSL form."); continue; }
      modifier.ends_nearest = endsNearest;
      continue;
    }
    const bonus = target.node.modifier as Node;
    const node: Node = { type: "move-modifier", target: target.node.target, modifier: { applies_to_moves: bonus.applies_to_moves, ends_nearest: endsNearest } };
    // The new node is the end rule's own effect: it takes the gates of the end leaf's clause, not the bonus's.
    planned.splice(planned.indexOf(target) + 1, 0, { ...target, index: at, leaf, node: node as T["node"], gate: gateAt(at) });
  }
  return errors;
}

/**
 * A permission flagged engaged_with_move_end names the unit the ability's move ends nearest. It is
 * not a permission of its own: it binds allow_engagement on the nearest earlier make-move that ends
 * nearest, so the permission node is dropped from the plan. A bound permission with no such move is
 * refused.
 */
export function bindEngagedPermissions(planned: PlannedNode[]): string[] {
  const errors: string[] = [];
  for (const item of [...planned]) {
    if (item.leaf.family_id !== "eligibility-permission" || item.leaf.parameters.engaged_with_move_end !== true) continue;
    const move = planned.filter((other) => other.index < item.index && other.node.type === "move" && (other.node.modifier as Node).ends_nearest !== undefined).at(-1);
    if (!move) { errors.push("A permission bound to the move-end's unit has no move-end nearest in its ability."); continue; }
    const modifier = move.node.modifier as Node;
    modifier.allow_engagement = true;
    modifier.engaged_with = "nearest-move-end";
    planned.splice(planned.indexOf(item), 1);
  }
  return errors;
}
