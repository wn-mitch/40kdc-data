import { FILTERED_UNITS } from "./compile-antecedent.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { dslUnitFilter } from "./compile-unit-filters.js";
import { STRATAGEM_HEADER } from "./compile-segments.js";
import { DESTRUCTION_ACTIVITIES } from "./family-extensions-17-triggering-destruction.js";

/**
 * Destruction by the triggering attacks (family-extensions-17-triggering-destruction.ts). The fold
 * pairs each destruction activity with the unit-filter that names what was destroyed, and with a
 * unit-position that measures it, then stores the object on the activity leaf. The lowering reads
 * that stored object as the DSL `happened` node with window `event`.
 */

const UNITS = "destroyed-units-by-triggering-attacks";
/** Moments whose attacks are those of the unit or units they name: attacks resolved, or an enemy having shot. */
const ATTACK_MOMENTS = new Set(["attacks-resolved", "enemy-has-shot"]);
/** Unit-ref roles a destroyed unit can be measured from at destruction. */
const POSITION_OF = new Set(["this-unit", "event-subject", "stratagem-target", "attacker", "defender", "selected-unit", "recipient"]);

function destructionActivity(leaf: CompileLeaf): string | undefined {
  const activities = Array.isArray(leaf.parameters.activities) ? leaf.parameters.activities as unknown[] : [];
  return activities.find((activity): activity is string => (DESTRUCTION_ACTIVITIES as readonly unknown[]).includes(activity));
}

export function isTriggeringDestruction(leaf: CompileLeaf | undefined): boolean {
  return leaf?.family_id === "unit-activity" && destructionActivity(leaf) !== undefined;
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
    const units = destructionActivity(leaf) === UNITS;
    const { named, container, destroyer } = leaf.parameters as { named: string; container: string; destroyer: unknown };
    if (units && (named === "none" || container !== "none")) throw new CompileError("A destroyed unit is named by a unit-filter before or after its verb; it has no container.");
    if (!units && named === "none" && container === "none") throw new CompileError("A destroyed model names a unit-filter: its own, or the unit it was in.");
    if (named !== "none" && container === "after") throw new CompileError("A destruction activity takes one unit-filter; it names the destroyed thing or its unit, not both.");
    if (!momentFor(destroyer, input)) throw new CompileError("Destroyed by those attacks needs a moment whose attacks it names: the attacks resolved, an enemy having shot, or the Stratagem's target.");
    const at = nextFilter(input, index, named === "before" ? -1 : 1, leaf.fragment);
    if (at === null) throw new CompileError(`A destruction activity names no unit-filter ${named === "before" ? "before" : "after"} its verb.`);
    if (claimed.has(at)) throw new CompileError("Two destruction activities name one unit-filter.");
    claimed.add(at);
    const filter = input[at]!;
    if (units && filter.parameters.level === "model") throw new CompileError("A destroyed unit is a unit; a model-level unit-filter names destroyed models.");
    const following = input[at + 1];
    const positioned = distanceFollows(following, leaf.fragment);
    let object: Record<string, unknown>;
    if (units) object = scoped(filter);
    else if (container === "after") object = { level: "model", member_of: scoped(filter) };
    else object = { ...scoped(filter, true), level: "model" };
    let proximity: Record<string, unknown> | undefined;
    if (units && named === "after" && positioned) {
      proximity = proximityOf(following!);
      dropped.add(at + 1);
    }
    if (units && named === "after" && !positioned && following?.family_id === "unit-filter" && following.fragment === leaf.fragment) {
      throw new CompileError("A unit-filter after a destroyed unit's filter names another unit the activity does not account for.");
    }
    if (!units && positioned) throw new CompileError("A distance after a destroyed model has no DSL shape; a destroyed unit takes one.");
    // The folded leaf covers the words of the filter it took, so the gap to a neighbouring leaf is the
    // text between the two halves: "or" there joins them as alternatives (compile-alternative-conditions.ts).
    const covered = [leaf, filter, ...(proximity ? [following!] : [])];
    replaced.set(index, {
      ...leaf,
      start_byte: Math.min(...covered.map((item) => item.start_byte)),
      end_byte: Math.max(...covered.map((item) => item.end_byte ?? item.start_byte)),
      parameters: { ...leaf.parameters, destruction: { object, ...(proximity ? { proximity } : {}) } },
    });
    // A container filter stays in the list when the leaf after it binds to it ("that unit"); the
    // activity still names the same unit. Otherwise the filter is consumed here.
    const bindsIt = following !== undefined && Object.values(following.parameters).includes(FILTERED_UNITS);
    if (!(container === "after" && bindsIt)) dropped.add(at);
  });
  return input.flatMap((leaf, index) => dropped.has(index) ? [] : [replaced.get(index) ?? leaf]);
}

/** The DSL `happened` parameters of a folded destruction activity: what was destroyed, by whom, in the event's own window. */
export function lowerTriggeringDestruction(leaf: CompileLeaf): Record<string, unknown> {
  const destruction = leaf.parameters.destruction as { object: Record<string, unknown>; proximity?: Record<string, unknown> } | undefined;
  if (!destruction) throw new CompileError("A destruction activity names no unit-filter beside it.");
  const units = destructionActivity(leaf) === UNITS;
  return {
    event: units ? "destroyed" : "model-destroyed",
    object: destruction.object,
    filter: { by: String(leaf.parameters.destroyer) },
    window: "event",
    ...(destruction.proximity ? { proximity: destruction.proximity } : {}),
  };
}
