import { FILTERED_UNITS } from "./compile-antecedent.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { dslUnitFilter } from "./compile-unit-filters.js";
import { STRATAGEM_HEADER } from "./compile-segments.js";
import { DESTRUCTION_ACTIVITIES } from "./family-extensions-17-triggering-destruction.js";
import { DESTROYED_STRATAGEM_TARGET } from "./family-extensions-20-antecedent-subject-binding.js";

/**
 * Destruction by the triggering attacks (family-extensions-17-triggering-destruction.ts). The fold
 * pairs each destruction activity with the unit-filter that names what was destroyed, and with a
 * unit-position that measures it, then stores the object on the activity leaf. The lowering reads
 * that stored object as the DSL `happened` node with window `event`.
 */

const UNITS = "destroyed-units-by-triggering-attacks";
const MODELS = "destroyed-models-by-triggering-attacks";
/** Moments whose attacks are those of the unit or units they name: attacks resolved, or an enemy having shot. */
const ATTACK_MOMENTS = new Set(["attacks-resolved", "enemy-has-shot"]);
/** Unit-ref roles a destroyed unit can be measured from at destruction. */
const POSITION_OF = new Set(["this-unit", "event-subject", "stratagem-target", "attacker", "defender", "selected-unit", "recipient"]);

/** The destruction activities a leaf names, in the family's order: a destroyed unit, a destroyed model, or both. */
function destructionActivities(leaf: CompileLeaf): string[] {
  const activities = Array.isArray(leaf.parameters.activities) ? leaf.parameters.activities as unknown[] : [];
  return (DESTRUCTION_ACTIVITIES as readonly string[]).filter((activity) => activities.includes(activity));
}

export function isTriggeringDestruction(leaf: CompileLeaf | undefined): boolean {
  return leaf?.family_id === "unit-activity" && destructionActivities(leaf).length > 0;
}

/** A moment the destroyer's attacks come from: a Stratagem's target, or an attack or attacks-resolved moment. */
function momentFor(destroyer: unknown, list: readonly CompileLeaf[]): boolean {
  if (destroyer === "stratagem-target") return list.some((leaf) => STRATAGEM_HEADER.has(leaf.family_id));
  return list.some((leaf) => leaf.family_id === "attack" || (leaf.family_id === "event" && ATTACK_MOMENTS.has(String(leaf.parameters.kind))));
}

/** The unit-filter at the next leaf of the fragment in one direction, past unit-owner leaves; null when another leaf comes first. */
function nextFilter(list: readonly CompileLeaf[], from: number, direction: number, fragment: string | undefined): number | null {
  for (let at = from + direction; at >= 0 && at < list.length && list[at]!.fragment === fragment; at += direction) {
    const leaf = list[at]!;
    if (leaf.family_id === "unit-owner") continue;
    return leaf.family_id === "unit-filter" ? at : null;
  }
  return null;
}

/**
 * A unit-ref the filter's owner is implied for: "any" is no owner at all. `warlord` allows the Warlord
 * designation, which only a destroyed model's filter takes here ("the enemy WARLORD was destroyed").
 */
function scoped(filter: CompileLeaf, warlord = false): Record<string, unknown> {
  const { owner, ...rest } = dslUnitFilter(filter, { warlordTest: warlord });
  return owner === "any" ? rest : { owner, ...rest };
}

/**
 * The distance right after a destroyed unit's filter: a unit-position, or the side-less aura-range
 * a filter takes in "a friendly X unit within 6\" of this unit". Read as the distance the destroyed
 * unit was from `of` at destruction.
 */
function proximityOf(position: CompileLeaf): Record<string, unknown> {
  const isAura = position.family_id === "aura-range";
  const { kind, of, inches, subject, wholly, negated, side } = position.parameters as Record<string, unknown>;
  if (!isAura && kind !== "within") throw new CompileError("A unit destroyed by triggering attacks is measured within a distance; beyond has no DSL shape here.");
  if (wholly === true || negated === true || side !== undefined) throw new CompileError("A destroyed unit's distance takes no wholly, negated or side.");
  if (!isAura && subject !== undefined && subject !== FILTERED_UNITS) throw new CompileError("A distance after a destroyed unit measures that unit only; it names another subject.");
  if (typeof of !== "string" || !POSITION_OF.has(of)) throw new CompileError("A destroyed unit's distance is measured from a unit-ref role.");
  if (typeof inches !== "number") throw new CompileError("A destroyed unit's distance needs its inches.");
  return { of, range: { inches } };
}

/** A distance leaf that follows a destroyed unit's filter in the same sentence. */
function distanceFollows(following: CompileLeaf | undefined, fragment: string | undefined): boolean {
  return following !== undefined && following.fragment === fragment && (following.family_id === "unit-position" || following.family_id === "aura-range");
}

/**
 * Pairs each destruction activity with the unit-filter it names and with its distance, removing
 * both from the list and storing the DSL object on the activity leaf as `destruction`.
 */
/**
 * A first-time usage limit is spent when its trigger fires. A destruction that gates an effect of a
 * non-destruction trigger would spend the limit on a fight with no kill, so the pair is refused.
 */
function firstUsageGatedByDestruction(input: readonly CompileLeaf[]): boolean {
  const first = input.some((leaf) => leaf.family_id === "usage-limit" && String(leaf.parameters.frequency).startsWith("first-"));
  const destroyMoment = input.some((leaf) => leaf.family_id === "event" && (leaf.parameters.kind === "unit-destroyed" || leaf.parameters.kind === "model-destroyed"));
  return first && !destroyMoment;
}

export function foldTriggeringDestruction(input: readonly CompileLeaf[]): CompileLeaf[] {
  const replaced = new Map<number, CompileLeaf>();
  const dropped = new Set<number>();
  const claimed = new Set<number>();
  input.forEach((leaf, index) => {
    if (!isTriggeringDestruction(leaf)) return;
    if (firstUsageGatedByDestruction(input)) throw new CompileError("A first-time usage limit cannot wait on a destruction that is not the trigger: the limit would be spent when the trigger fires, even with no destruction.");
    const activities = destructionActivities(leaf);
    const pair = activities.length === 2;
    const { named, container, destroyer, keywords } = leaf.parameters as { named: string; container: string; destroyer: unknown; keywords?: string[] };
    if (pair && (named === "none" || container !== "none")) throw new CompileError("A destruction of a unit or a model names one unit-filter before or after its verb, with no container.");
    if (keywords !== undefined && (container === "after" || !activities.includes(MODELS))) throw new CompileError("Destroyed models' keywords name a model-level unit-filter, with no container.");
    for (const activity of activities) {
      const units = activity === UNITS;
      if (units && (named === "none" || container !== "none")) throw new CompileError("A destroyed unit is named by a unit-filter before or after its verb; it has no container.");
      if (!units && named === "none" && container === "none") throw new CompileError("A destroyed model names a unit-filter: its own, or the unit it was in.");
    }
    if (named !== "none" && container === "after") throw new CompileError("A destruction activity takes one unit-filter; it names the destroyed thing or its unit, not both.");
    if (!momentFor(destroyer, input)) throw new CompileError("Destroyed by those attacks needs a moment whose attacks it names: the attacks resolved, an enemy having shot, or the Stratagem's target.");
    const at = nextFilter(input, index, named === "before" ? -1 : 1, leaf.fragment);
    if (at === null) throw new CompileError(`A destruction activity names no unit-filter ${named === "before" ? "before" : "after"} its verb.`);
    if (claimed.has(at)) throw new CompileError("Two destruction activities name one unit-filter.");
    claimed.add(at);
    const filter = input[at]!;
    if (activities.includes(UNITS) && filter.parameters.level === "model") throw new CompileError("A destroyed unit is a unit; a model-level unit-filter names destroyed models.");
    const following = input[at + 1];
    const positioned = distanceFollows(following, leaf.fragment);
    const destructions: Array<{ event: string; object: Record<string, unknown>; proximity?: Record<string, unknown> }> = [];
    for (const activity of activities) {
      const units = activity === UNITS;
      let object: Record<string, unknown>;
      if (units) object = scoped(filter);
      else if (container === "after") object = { level: "model", member_of: scoped(filter) };
      else object = { ...scoped(filter, true), level: "model", ...(keywords !== undefined ? { all_of: keywords } : {}) };
      let proximity: Record<string, unknown> | undefined;
      if (units && named === "after" && positioned) proximity = proximityOf(following!);
      if (!units && positioned) throw new CompileError("A distance after a destroyed model has no DSL shape; a destroyed unit takes one.");
      destructions.push({ event: units ? "destroyed" : "model-destroyed", object, ...(proximity ? { proximity } : {}) });
    }
    const proximityTaken = destructions.some((destruction) => destruction.proximity !== undefined);
    if (proximityTaken) dropped.add(at + 1);
    if (named === "after" && !positioned && following?.family_id === "unit-filter" && following.fragment === leaf.fragment && activities.includes(UNITS)) {
      throw new CompileError("A unit-filter after a destroyed unit's filter names another unit the activity does not account for.");
    }
    // The folded leaf covers the words of the filter it took, so the gap to a neighbouring leaf is the
    // text between the two halves: "or" there joins them as alternatives (compile-alternative-conditions.ts).
    const covered = [leaf, filter, ...(proximityTaken ? [following!] : [])];
    replaced.set(index, {
      ...leaf,
      start_byte: Math.min(...covered.map((item) => item.start_byte)),
      end_byte: Math.max(...covered.map((item) => item.end_byte ?? item.start_byte)),
      parameters: { ...leaf.parameters, destructions },
    });
    // A container filter stays in the list when the leaf after it binds to it ("that unit"); the
    // activity still names the same unit. Otherwise the filter is consumed here.
    const bindsIt = following !== undefined && Object.values(following.parameters).includes(FILTERED_UNITS);
    if (!(container === "after" && bindsIt)) dropped.add(at);
  });
  return input.flatMap((leaf, index) => dropped.has(index) ? [] : [replaced.get(index) ?? leaf]);
}

/**
 * The DSL `happened` parameters of a folded destruction leaf, one per destruction activity it
 * names (a destroyed unit or a destroyed model; any one of them happened): what was destroyed, by
 * whom, in the event's own window.
 */
export function lowerTriggeringDestructions(leaf: CompileLeaf): Record<string, unknown>[] {
  const destructions = leaf.parameters.destructions as Array<{ event: string; object: Record<string, unknown>; proximity?: Record<string, unknown> }> | undefined;
  if (!destructions?.length) throw new CompileError("A destruction activity names no unit-filter beside it.");
  return destructions.map(({ event, object, proximity }) => ({
    event,
    object,
    filter: { by: String(leaf.parameters.destroyer) },
    window: "event",
    ...(proximity ? { proximity } : {}),
  }));
}

/**
 * "targets the enemy unit that just destroyed your unit": the activity says the subject destroyed
 * the unit the Stratagem targets, which a Stratagem names only when a destruction moment in its
 * TARGET fragment says that unit was just destroyed. Anywhere else the Stratagem target is not a
 * destroyed unit, so the activity would test an event that never happened.
 */
export function refuseStratagemTargetActivity(leaves: readonly CompileLeaf[]): void {
  const leaf = leaves.find((item) => item.family_id === "unit-activity" && Array.isArray(item.parameters.activities) && item.parameters.activities.includes(DESTROYED_STRATAGEM_TARGET));
  if (leaf === undefined) return;
  const stratagem = leaves.some((item) => STRATAGEM_HEADER.has(item.family_id) || item.family_id === "triggering-target");
  const destroyedTarget = leaves.some((item) => item.family_id === "event" && item.fragment === "TARGET" && item.parameters.kind === "unit-destroyed");
  if (!stratagem || !destroyedTarget) {
    throw new CompileError(`${DESTROYED_STRATAGEM_TARGET} at byte ${leaf.start_byte} needs a Stratagem whose target was just destroyed.`);
  }
}
