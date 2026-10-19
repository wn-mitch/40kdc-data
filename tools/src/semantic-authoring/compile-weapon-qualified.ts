/**
 * Attack qualifiers that name the weapon or attack type of a hit or a destruction, folded onto the
 * leaf they qualify (the wave-10 weapon-qualified attack reference). Each fold needs the two leaves
 * to touch: only spaces or emphasis between them, as the after-form hit fold requires.
 */

import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { HIT_ATTACK_TYPES, HIT_FILTER_KEYS } from "./compile-conditions.js";
import { bareFilter, hasAntecedent } from "./compile-antecedent.js";
import { currentFamilyVersion } from "./contracts.js";

const DESTROY_KINDS = new Set(["unit-destroyed", "model-destroyed"]);

function touching(bytes: Buffer, before: CompileLeaf, after: CompileLeaf): boolean {
  return /^[\s*]*$/u.test(bytes.subarray(before.end_byte, after.start_byte).toString("utf8"));
}

/** "after all of that attack's attacks have been resolved": an attacks-resolved moment with no subject or owner. */
export function isSameAttackResolved(leaf: CompileLeaf): boolean {
  return leaf.family_id === "event" && leaf.parameters.kind === "attacks-resolved"
    && leaf.parameters.subject === undefined && leaf.parameters.owner === undefined;
}

function isDestroy(leaf: CompileLeaf): boolean {
  return leaf.family_id === "event" && DESTROY_KINDS.has(String(leaf.parameters.kind));
}

/**
 * "Each time an attack made with this model's quake cannon destroys an enemy model": the
 * attack-filter before a destruction picks the attacks that destroy. The destruction's destroyer
 * (`by`) must be named, since the filter describes its attacks.
 *
 * "A melee attack that destroys an enemy unit": an attack leaf right before a destruction, with no
 * destroyer named, makes the destroying attacks of that type, by the attack's unit. The attack's
 * span ends at "that" in the source, so the two leaves touch.
 *
 * Both write the destruction's `destroy_filter`, which eventTrigger (compile-triggers.ts) sets as
 * the trigger's filter. A destruction that already has a filter is refused.
 */
export function foldDestroyFilters(leaves: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (sourceText === undefined || !leaves.some(isDestroy)) return [...leaves];
  const bytes = Buffer.from(sourceText, "utf8");
  const out: CompileLeaf[] = [];
  for (const leaf of leaves) {
    const before = out.at(-1);
    if (before === undefined || !isDestroy(leaf) || !touching(bytes, before, leaf)) { out.push(leaf); continue; }
    const attackFilter = before.family_id === "attack-filter";
    const attackLeaf = before.family_id === "attack" && before.parameters.direction === "makes" && before.parameters.refers === undefined
      && before.parameters.attack_type !== undefined && before.parameters.unit !== undefined;
    if (!attackFilter && !attackLeaf) { out.push(leaf); continue; }
    // "after all of that attack's attacks have been resolved" times the bonus by an attacks-resolved
    // moment that names only the attack just made (no subject, no owner). That event cannot say the
    // attack destroyed a model, so a destruction folded here would fire mid-attack instead.
    if (leaves.some(isSameAttackResolved)) {
      throw new CompileError("DSL gap: a destruction made by an attack cannot share a record with an \"after the attack's attacks are resolved\" moment; that event cannot say the attack destroyed a model.");
    }
    if (leaf.parameters.destroy_filter !== undefined) throw new CompileError("A destruction takes one attack qualifier, and this one already has one.");
    if (attackFilter) {
      const keys = Object.keys(before.parameters);
      if (before.parameters.negated === true || keys.length === 0 || !keys.every((key) => HIT_FILTER_KEYS.has(key))) {
        throw new CompileError(`A destruction's attack-filter can name only ${[...HIT_FILTER_KEYS].join(", ")}; drop the other fields.`);
      }
      if (leaf.parameters.by === undefined) throw new CompileError("A destruction qualified by its attacks names its destroyer (by).");
      out[out.length - 1] = { ...leaf, start_byte: before.start_byte, parameters: { ...leaf.parameters, destroy_filter: { ...before.parameters } } };
      continue;
    }
    if (!HIT_ATTACK_TYPES.has(String(before.parameters.attack_type))) throw new CompileError(`A destruction's attacks are melee, ranged or psychic, not ${String(before.parameters.attack_type)}.`);
    if (leaf.parameters.by !== undefined && leaf.parameters.by !== before.parameters.unit) throw new CompileError("A destruction names a destroyer other than the attack's unit.");
    out[out.length - 1] = { ...leaf, start_byte: before.start_byte, parameters: { ...leaf.parameters, by: before.parameters.unit, destroy_filter: { attack_type: before.parameters.attack_type } } };
  }
  return out;
}

/**
 * "those attacks made with its doomweaver scored a hit against an enemy unit": an attack-filter
 * right before a hit-by-attacks leaf that names the unit hit (object following-filter) says which
 * hits count. It is the leading form of foldHitFilters, which folds the trailing form.
 */
export function foldLeadingHitFilters(leaves: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (sourceText === undefined || !leaves.some((leaf) => leaf.family_id === "hit-by-attacks" && leaf.parameters.object === "following-filter")) return [...leaves];
  const bytes = Buffer.from(sourceText, "utf8");
  const out: CompileLeaf[] = [];
  for (const leaf of leaves) {
    const filter = out.at(-1);
    if (filter?.family_id !== "attack-filter" || leaf.family_id !== "hit-by-attacks" || leaf.parameters.object !== "following-filter" || !touching(bytes, filter, leaf)) {
      out.push(leaf);
      continue;
    }
    checkHitFilter(filter);
    if (leaf.parameters.hit_filter !== undefined) throw new CompileError("A hit names one attack-filter, and this one already has one.");
    out[out.length - 1] = { ...leaf, start_byte: filter.start_byte, parameters: { ...leaf.parameters, hit_filter: { ...filter.parameters } } };
  }
  return out;
}

/** The attack-filter fields a hit can name, checked the same way for a leading and a before-form hit. */
function checkHitFilter(filter: CompileLeaf): void {
  const keys = Object.keys(filter.parameters);
  if (filter.parameters.negated === true) throw new CompileError("A hit's attack-filter cannot be negated.");
  if (keys.some((key) => !HIT_FILTER_KEYS.has(key))) {
    const named = keys.find((key) => !HIT_FILTER_KEYS.has(key));
    throw new CompileError(`A hit's attack-filter names ${named}; the DSL hit filter has no ${named}.`);
  }
  if (filter.parameters.attack_type !== undefined && !HIT_ATTACK_TYPES.has(String(filter.parameters.attack_type))) throw new CompileError("A hit's attack_type is melee, ranged or psychic.");
}

/**
 * "…scored a hit against an enemy unit, until the start of your next turn, that enemy unit is
 * pinned": a before-form hit names its unit with the unit-filter after it, which a later leaf that
 * points back to "that unit" cannot reach. The binder would give that leaf the attacking unit, so the
 * record is refused. Only leaves in the hit's own fragment count.
 */
export function refuseBeforeFormAnaphors(leaves: readonly CompileLeaf[]): void {
  leaves.forEach((hit, index) => {
    if (hit.family_id !== "hit-by-attacks" || hit.parameters.object !== "following-filter") return;
    const anaphor = leaves.slice(index + 1).find((other) => other.fragment === hit.fragment && hasAntecedent(other));
    if (anaphor !== undefined) {
      throw new CompileError(`A before-form hit names the unit it hit by the unit-filter after it; the ${anaphor.family_id} at byte ${anaphor.start_byte} points back to that unit, which cannot bind yet.`);
    }
  });
}

/**
 * The before-form hit: "one or more of those attacks made with its doomweaver scored a hit against
 * an enemy unit, … that enemy unit is pinned". The hit's unit is the unit-filter right after it, so
 * a later "that unit" has no antecedent until the hit is bound. The binder rewrites the hit and its
 * touching attack-filter into one for-each-unit-select whose `hit` names the hit's filter; the
 * for-each then runs per unit the unit-filter selects, and "that unit" binds to that unit.
 *
 * Only a hit whose later leaves name "that unit" (an antecedent) is bound. Any other hit is left
 * for foldLeadingHitFilters, as before. A leftover hit is refused by refuseBeforeFormAnaphors.
 */
export function bindBeforeFormHits(leaves: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (sourceText === undefined) return [...leaves];
  const bytes = Buffer.from(sourceText, "utf8");
  let out = [...leaves];
  for (let at = 0; at < out.length; at += 1) {
    const hit = out[at]!;
    if (hit.family_id !== "hit-by-attacks" || hit.parameters.object !== "following-filter" || hit.parameters.window !== undefined) continue;
    const unit = out[at + 1];
    if (!out.slice(at + 1).some((other) => other.fragment === hit.fragment && hasAntecedent(other))) continue;
    if (unit?.family_id !== "unit-filter" || unit.fragment !== hit.fragment || !touching(bytes, hit, unit)) continue;
    const unitAt = at + 1;
    const anaphorAfter = out.slice(unitAt + 1).find((other) => other.fragment !== hit.fragment && hasAntecedent(other));
    if (anaphorAfter !== undefined) {
      throw new CompileError(`A before-form hit's unit is the unit-filter after it; the ${anaphorAfter.family_id} at byte ${anaphorAfter.start_byte} is in another part and points back to that unit, which cannot bind.`);
    }
    // A second unit-filter in the same part takes its own units; an anaphor after it could name either unit.
    const second = out.findIndex((other, index) => index > unitAt && other.family_id === "unit-filter" && other.fragment === hit.fragment);
    const ambiguous = second < 0 ? undefined : out.slice(second + 1).find((other) => other.fragment === hit.fragment && hasAntecedent(other));
    if (ambiguous !== undefined) {
      throw new CompileError(`A before-form hit's unit is followed by another unit-filter in its part; the ${ambiguous.family_id} at byte ${ambiguous.start_byte} after it cannot tell that filter's units from the hit's.`);
    }
    const filter = out[at - 1];
    const attackFilter = filter?.family_id === "attack-filter" && filter.fragment === hit.fragment && touching(bytes, filter, hit);
    let hitFilter: Record<string, unknown> | undefined;
    if (attackFilter) {
      checkHitFilter(filter);
      hitFilter = { ...filter.parameters };
    }
    const first = attackFilter ? at - 1 : at;
    const quantifier: CompileLeaf = {
      role: "EVENT",
      family_id: "for-each-unit-select",
      family_version: currentFamilyVersion("for-each-unit-select"),
      parameters: { hit: hitFilter === undefined ? {} : { hit_filter: hitFilter } },
      start_byte: out[first]!.start_byte,
      end_byte: hit.end_byte,
      fragment: hit.fragment,
    };
    out = [...out.slice(0, first), quantifier, ...out.slice(unitAt)];
    at = first;
  }
  const quantified = out.some((leaf) => leaf.family_id === "for-each-unit-select" && leaf.parameters.hit !== undefined);
  if (quantified && out.some((leaf) => (leaf.family_id === "army-construction" && leaf.parameters.rule === "composition") || leaf.family_id === "count-scale")) {
    throw new CompileError("A before-form hit's per-unit pass cannot share a record with an army composition or a count-scale; the hit would be dropped.");
  }
  return out;
}

/** The index bareFilter's walk stops at: past the unit-owners and antecedent conditions before `index`. Read it only when bareFilter holds. */
function bareFilterAt(leaves: readonly CompileLeaf[], index: number): number {
  const fragment = leaves[index]!.fragment;
  let at = index - 1;
  while (at >= 0 && leaves[at]!.fragment === fragment && (leaves[at]!.family_id === "unit-owner"
    || (leaves[at]!.role === "CONDITION" && hasAntecedent(leaves[at]!)))) at -= 1;
  return at;
}

/**
 * "each enemy INFANTRY unit that was hit by one or more of those attacks made with a graviton
 * crusher …": a hit-by-attacks whose subject is the antecedent, right after a bare unit-filter, names
 * the units that were hit. Nothing else claims that filter, so the binder rewrites the hit and its
 * touching attack-filter into one bare for-each-unit-select whose `hit` names the attack-filter, the
 * shape bindBeforeFormHits gives a before-form hit. The for-each runs per unit the filter selects,
 * and the hit gate (forEachHitGate) reads the bearer's own attacks, so the hit's moment must be this
 * unit's own after-shooting event. Any other moment is refused, since the gate cannot name its attacker.
 */
export function bindBareFilterHits(leaves: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (sourceText === undefined) return [...leaves];
  const bytes = Buffer.from(sourceText, "utf8");
  const replaced = new Map<number, CompileLeaf>();
  const removed = new Set<number>();
  for (let at = 0; at < leaves.length; at += 1) {
    const hit = leaves[at]!;
    if (hit.family_id !== "hit-by-attacks" || hit.parameters.subject !== "antecedent" || hit.parameters.object !== undefined
      || hit.parameters.window !== undefined || hit.parameters.by !== undefined) continue;
    if (!bareFilter(leaves, at)) continue;
    const filterAt = bareFilterAt(leaves, at);
    const filter = leaves[filterAt]!;
    if (filter.family_id !== "unit-filter") continue;
    if (replaced.has(filterAt)) throw new CompileError("A bare unit-filter takes one hit-by condition, and this one already has one.");
    const moment = leaves.filter((leaf) => leaf.start_byte < filter.start_byte && leaf.fragment === hit.fragment && leaf.family_id === "event")
      .reduce<CompileLeaf | undefined>((latest, leaf) => latest === undefined || leaf.start_byte > latest.start_byte ? leaf : latest, undefined);
    if (moment?.parameters.kind !== "after-shooting") {
      throw new CompileError("A hit-by condition on a bare unit-filter needs the attacks of this unit's own moment.");
    }
    const attackAt = at + 1;
    const next = leaves[attackAt];
    const attackFilter = next?.family_id === "attack-filter" && next.fragment === hit.fragment && touching(bytes, hit, next) ? next : undefined;
    if (attackFilter !== undefined) {
      checkHitFilter(attackFilter);
      if (Object.keys(attackFilter.parameters).length === 0) throw new CompileError("A hit's attack-filter names at least one attack field.");
    }
    const last = attackFilter === undefined ? at : attackAt;
    const anaphor = leaves.slice(last + 1).find((other) => other.fragment === hit.fragment && hasAntecedent(other));
    if (anaphor === undefined) throw new CompileError("A hit-by condition on a bare unit-filter needs a 'that unit' after it.");
    const takes = attackFilter ?? hit;
    replaced.set(filterAt, {
      role: "EVENT",
      family_id: "for-each-unit-select",
      family_version: currentFamilyVersion("for-each-unit-select"),
      parameters: { hit: attackFilter === undefined ? {} : { hit_filter: { ...attackFilter.parameters } } },
      start_byte: filter.start_byte,
      end_byte: takes.end_byte,
      fragment: hit.fragment,
    });
    removed.add(at);
    if (attackFilter !== undefined) removed.add(attackAt);
  }
  if (replaced.size === 0) return [...leaves];
  const out: CompileLeaf[] = [];
  leaves.forEach((leaf, index) => {
    const quantifier = replaced.get(index);
    if (quantifier !== undefined) out.push(quantifier);
    if (!removed.has(index)) out.push(leaf);
  });
  if (out.some((leaf) => (leaf.family_id === "army-construction" && leaf.parameters.rule === "composition") || leaf.family_id === "count-scale")) {
    throw new CompileError("A hit-by condition on a bare unit-filter's per-unit pass cannot share a record with an army composition or a count-scale; the hit would be dropped.");
  }
  return out;
}
