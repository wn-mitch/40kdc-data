import { exactSpan } from "./contracts.js";
import { condition } from "./compile-conditions.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * Where a set-up may (or may not) place a unit. Three folds tie placement wording to the set-up
 * it qualifies instead of letting it gate that set-up:
 *
 * - Add-unit then set-up: "add a new unit … and set it up" is one add-unit that is set up on the
 *   battlefield. The set-up leaf, whose "it" is the new unit, merges into the add-unit.
 * - Set-up restriction: "enemy units that are set up from Reserves cannot be set up within 12\" of
 *   this model". The set-up moment right before a forbidden set-up (allow false) is not a trigger:
 *   it names whose set-ups are forbidden ({owner}) and where they come from (its `from`).
 * - Placement limits: a distance, a region or "not engaged" right after a set-up or a merged
 *   add-unit, joined only by glue words ("that is", "and", ","), is where that unit is set up.
 *
 * `foldSetUpPlacement` runs before antecedents bind, because "it" and "that unit" here name the
 * set-up's own unit, not the unit an earlier leaf introduced. It marks each limit with its owner.
 * `foldSetUpLimits` runs after unit-filters fold (a limit can measure to the filter after it) and
 * lowers each marked limit into its owner's placement fields.
 */

type Node = Record<string, unknown>;

/** Wording between a set-up and its limits, or between two limits, that adds no meaning. */
const LIMIT_GLUE = /^(?:\s|,|\band\b|\bthat (?:is|are)\b|\banywhere(?: on the battlefield)?)*$/iu;
/** Wording between an add-unit and the set-up of its new unit ("… and set it up"). */
const ADD_UNIT_GLUE = /^[\s,]*(?:\band\b)?[\s,]*$/iu;
const SENTENCE_BREAK = /[.;:]/u;

/** set-up parameters a merged add-unit can carry over; any other has no add-unit form. */
const MERGEABLE_SET_UP_KEYS = new Set(["subject", "to", "placement"]);

/** Owner key: the owner's start byte, which no other leaf of the ability shares. */
const LIMIT_OWNER = "set_up_limit_owner";

const sameFragment = (left: CompileLeaf, right: CompileLeaf) => (left.fragment ?? null) === (right.fragment ?? null);

/** The source wording between two leaves, or null when it cannot be read. */
function gap(previous: CompileLeaf, next: CompileLeaf, sourceText: string | undefined): string | null {
  if (sourceText === undefined || previous.end_byte === undefined || next.start_byte < previous.end_byte) return null;
  return exactSpan(sourceText, previous.end_byte, next.start_byte);
}

/** A leaf that can say where a set-up places its unit. */
function isLimit(leaf: CompileLeaf): boolean {
  if (leaf.role !== "CONDITION") return false;
  const p = leaf.parameters;
  if (leaf.family_id === "unit-position") return (p.kind === "within" || p.kind === "beyond") && p.of !== undefined;
  if (leaf.family_id === "in-region") return true;
  if (leaf.family_id === "unit-state") {
    const states = p.states as unknown[] | undefined;
    return Array.isArray(states) && states.length === 1 && states[0] === "engaged" && p.negated === true && p.with === undefined && p.at === undefined;
  }
  return false;
}

const isSetUp = (leaf: CompileLeaf) => leaf.role === "EFFECT" && leaf.family_id === "set-up";
const isAddUnit = (leaf: CompileLeaf) => leaf.role === "EFFECT" && leaf.family_id === "add-unit";

/** Check one limit's own parameters; what the DSL placement cannot say is refused here. */
function checkLimit(limit: CompileLeaf, ownerSubject: unknown): void {
  const p = limit.parameters;
  if (p.subject !== undefined && p.subject !== "antecedent" && p.subject !== ownerSubject) {
    throw new CompileError(`A placement limit after a set-up places the set-up's unit; this ${limit.family_id} is said of ${JSON.stringify(p.subject)}.`);
  }
  if (limit.family_id === "in-region") {
    if (p.negated === true) throw new CompileError("A set-up placed outside a region has no DSL placement; only within a region.");
    if (p.models !== undefined) throw new CompileError("A set-up's region placement places the whole unit; in-region models has no placement form.");
  }
  if (limit.family_id === "unit-position") {
    if (p.of === "antecedent") throw new CompileError("A set-up's placement limit measures to an earlier unit; name the place (event-subject, marker, this-model) instead of antecedent.");
    if (p.of_other === true) throw new CompileError("A set-up's placement limit measured to another unit than the one set up has no DSL placement yet.");
    const away = (p.kind === "beyond") !== (p.negated === true);
    if (away && p.wholly === true) throw new CompileError("A set-up cannot be placed wholly more than a distance away; wholly qualifies only within.");
  }
}

/**
 * Fold add-unit set-ups and set-up restrictions, and mark the placement limits after a set-up
 * with the set-up (or add-unit) they place. Without source text, nothing is folded.
 */
export function foldSetUpPlacement(leaves: readonly CompileLeaf[], sourceText: string | undefined): readonly CompileLeaf[] {
  if (sourceText === undefined || !leaves.some((leaf) => isSetUp(leaf))) return leaves;
  const result = [...leaves];
  const drop = new Set<number>();
  for (let at = 0; at < result.length; at++) {
    const leaf = result[at]!;
    let last = at;
    if (isAddUnit(leaf)) {
      const next = result[at + 1];
      const between = next ? gap(leaf, next, sourceText) : null;
      if (!next || !isSetUp(next) || next.parameters.subject !== "antecedent" || !sameFragment(leaf, next) || between === null || !ADD_UNIT_GLUE.test(between)) continue;
      if (leaf.parameters.held_in !== undefined) throw new CompileError("A unit added in Strategic Reserves is not also set up on the battlefield; drop held_in or the set-up.");
      const extra = Object.keys(next.parameters).find((key) => !MERGEABLE_SET_UP_KEYS.has(key));
      if (extra) throw new CompileError(`The set-up of a newly added unit has no add-unit form for ${extra}.`);
      if (next.parameters.to !== "battlefield") throw new CompileError("The set-up of a newly added unit puts it on the battlefield; a unit added in Reserves is add-unit held_in.");
      const merged: Node = { ...leaf.parameters, set_up: true };
      if (next.parameters.placement !== undefined) merged.set_up_placement = next.parameters.placement;
      result[at] = { ...leaf, parameters: merged, end_byte: next.end_byte };
      drop.add(at + 1);
      last = at + 1;
    } else if (isSetUp(leaf) && leaf.parameters.allow === false && leaf.parameters.subject === "antecedent") {
      const moment = result[at - 1];
      const between = moment ? gap(moment, leaf, sourceText) : null;
      if (moment && moment.role === "EVENT" && moment.family_id === "event" && moment.parameters.kind === "set-up" && sameFragment(moment, leaf) && between !== null && !SENTENCE_BREAK.test(between)) {
        result[at] = restriction(result, at, moment, sourceText);
        drop.add(at - 1);
      }
    } else if (!isSetUp(leaf)) {
      continue;
    }
    const ownerLeaf = result[at]!;
    const ownerSubject = isSetUp(ownerLeaf) && ownerLeaf.parameters.restricted_owner === undefined ? ownerLeaf.parameters.subject : "antecedent";
    let limits = 0;
    for (let next = last + 1; next < result.length; next++) {
      const candidate = result[next]!;
      const between = gap(result[next - 1]!, candidate, sourceText);
      if (!isLimit(candidate) || !sameFragment(ownerLeaf, candidate) || between === null || !LIMIT_GLUE.test(between)) break;
      checkLimit(candidate, ownerSubject);
      result[next] = { ...candidate, parameters: { ...candidate.parameters, ...(candidate.parameters.subject !== undefined ? { subject: "this-unit" } : {}), [LIMIT_OWNER]: ownerLeaf.start_byte } };
      limits += 1;
      last = next;
    }
    if (ownerLeaf.parameters.allow === false && limits > 1) {
      throw new CompileError("A forbidden set-up with more than one placement limit leaves unclear which zone is barred; split it into one restriction per zone.");
    }
    if (ownerLeaf.parameters.restricted_owner !== undefined) {
      if (limits === 0) throw new CompileError("A set-up restriction names no zone: a placement limit must follow \"cannot be set up\".");
      // "Enemy units that are set up from Reserves cannot be set up …, and …": the moment opens a second effect.
      const after = result[last + 1];
      const tail = after ? gap(result[last]!, after, sourceText) : null;
      if (after && after.role === "EFFECT" && sameFragment(ownerLeaf, after) && tail !== null && !SENTENCE_BREAK.test(tail)) {
        throw new CompileError("A set-up moment that a restriction consumes cannot also open another effect in its sentence.");
      }
    }
    at = last;
  }
  return result.filter((_, index) => !drop.has(index));
}

/** A forbidden set-up whose units are named by the set-up moment before it. */
function restriction(list: readonly CompileLeaf[], at: number, moment: CompileLeaf, sourceText: string): CompileLeaf {
  const setUp = list[at]!;
  const owner = moment.parameters.owner;
  if (moment.parameters.subject !== undefined) throw new CompileError("A set-up moment with a subject names one unit, not a side; a set-up restriction needs owner.");
  if (owner === undefined) throw new CompileError("A set-up restriction forbids the set-ups of one side's units; its set-up moment names no owner.");
  const from = moment.parameters.from;
  if (from === undefined) throw new CompileError("A set-up restriction's moment says where the units are set up from (from Reserves); without it, it would also forbid deployment.");
  if (setUp.parameters.from !== undefined && setUp.parameters.from !== from) throw new CompileError(`A set-up restriction's moment is from ${String(from)}, but its set-up says from ${JSON.stringify(setUp.parameters.from)}.`);
  const before = list[at - 2];
  const lead = before ? gap(before, moment, sourceText) : null;
  if (before && before.family_id === "unit-filter" && sameFragment(before, moment) && lead !== null && !SENTENCE_BREAK.test(lead)) {
    throw new CompileError("A unit-filter on a set-up restriction's moment has no fold yet; the restriction would forbid every unit of that side.");
  }
  return { ...setUp, start_byte: moment.start_byte, parameters: { ...setUp.parameters, subject: "this-unit", from, restricted_owner: owner } };
}

/** A forbidden set-up ("enemy units cannot be set up within 12\" of …") holds until it ends, like a permission. */
export function isForbiddenSetUp(node: Node): boolean {
  return node.type === "set-up" && (node.modifier as Node | undefined)?.allow === false;
}

/** Lower every marked placement limit into its owner and drop it. */
export function foldSetUpLimits(leaves: readonly CompileLeaf[]): readonly CompileLeaf[] {
  if (!leaves.some((leaf) => leaf.parameters[LIMIT_OWNER] !== undefined)) return leaves;
  const result = [...leaves];
  const drop = new Set<number>();
  result.forEach((leaf, index) => {
    const key = leaf.parameters[LIMIT_OWNER];
    if (key === undefined) return;
    const ownerAt = result.findIndex((other) => other.role === "EFFECT" && (isSetUp(other) || isAddUnit(other)) && other.start_byte === key);
    if (ownerAt === -1) throw new CompileError(`A placement limit (${leaf.family_id}) lost the set-up it places.`);
    result[ownerAt] = { ...result[ownerAt]!, parameters: withLimit(result[ownerAt]!, leaf) };
    drop.add(index);
  });
  return result.filter((_, index) => !drop.has(index));
}

function withLimit(owner: CompileLeaf, limit: CompileLeaf): Node {
  const parameters: Node = { ...owner.parameters };
  const { [LIMIT_OWNER]: _owner, ...rest } = limit.parameters;
  const append = (field: string, item: Node) => { parameters[field] = [...((parameters[field] as Node[] | undefined) ?? []), item]; };
  if (limit.family_id === "unit-state") {
    parameters.folded_unengaged = true;
    return parameters;
  }
  let node = condition({ ...limit, parameters: { ...rest, ...(rest.subject !== undefined ? { subject: "this-unit" } : {}) } });
  let negated = false;
  while (node.operator === "not") {
    negated = !negated;
    node = (node.operands as Node[])[0]!;
  }
  const { subject: _subject, ...found } = (node.parameters ?? {}) as Node;
  if (limit.family_id === "in-region") {
    if (parameters.folded_in_region !== undefined) throw new CompileError("A set-up is placed within two regions; the DSL placement holds one.");
    parameters.folded_in_region = { region: found.region, ...(found.wholly === true ? { wholly: true } : {}) };
    return parameters;
  }
  if (node.type !== "within") throw new CompileError(`A ${limit.family_id} placement limit lowered to ${String(node.type)}, which has no placement form.`);
  if (!negated) {
    append("folded_near", { of: found.of, range: found.range, ...(found.wholly === true ? { wholly: true } : {}) });
    return parameters;
  }
  const of = found.of as Node | string;
  const anyEnemy = typeof of === "object" && Object.keys(of).length === 1 && of.owner === "enemy";
  // "More than 9\" away from all enemy units" on a permitted set-up is its min_enemy_distance.
  if (anyEnemy && isSetUp(owner) && owner.parameters.allow !== false) {
    const inches = (found.range as Node).inches;
    if (parameters.min_enemy_distance !== undefined && parameters.min_enemy_distance !== inches) {
      throw new CompileError(`A set-up already sets up more than ${String(parameters.min_enemy_distance)}" from enemy units; its placement limit says ${String(inches)}".`);
    }
    parameters.min_enemy_distance = inches;
    return parameters;
  }
  append("folded_away_from", { of, range: found.range });
  return parameters;
}
