/**
 * Bridge helpers between the importer's flat-data {@link Roster} types and
 * the linked {@link UnitView} the cruncher consumes. The importer ships
 * unit entries as plain interfaces (`RosterUnit` is data, not behaviour),
 * so the lookup is a free function rather than a method.
 *
 * @packageDocumentation
 */
import type { Roster, RosterUnit, RosterWargear } from "../import/types.js";
import type { Dataset } from "./dataset.js";
import type { UnitView, WeaponView } from "./entities.js";

/**
 * Resolve a roster's unit entry against the dataset, returning the linked
 * {@link UnitView}. Returns `undefined` when:
 *   - the roster's `ref.id` is `null` (the importer couldn't match the unit), or
 *   - the id doesn't appear in the dataset (e.g. the roster was authored
 *     against an older dataslate than the bundled one).
 *
 * Doesn't surface diagnostics — the caller already has them on the roster's
 * own `diagnostics` field.
 */
export function resolveRosterUnit(
  rosterUnit: RosterUnit,
  dataset: Dataset,
): UnitView | undefined {
  const id = rosterUnit.ref.id;
  if (id === null) return undefined;
  return dataset.units.get(id);
}

/**
 * Resolve every wargear entry on a roster unit to a {@link WeaponView},
 * keeping each entry's count alongside. Unresolved entries are dropped
 * silently (matching {@link resolveRosterUnit}). Useful when the SPA
 * needs to enumerate firing options after the user picks a roster unit.
 */
export function resolveRosterWargear(
  wargear: RosterWargear[],
  dataset: Dataset,
): { weapon: WeaponView; count: number }[] {
  const out: { weapon: WeaponView; count: number }[] = [];
  for (const w of wargear) {
    const id = w.ref.id;
    if (id === null) continue;
    const weapon = dataset.weapons.get(id);
    if (!weapon) continue;
    out.push({ weapon, count: w.count });
  }
  return out;
}

/**
 * The roster's leader entry attached to `bodyguardUnitId`, if any. Import
 * stores the inferred (always-provisional) attachment on the *leader's*
 * {@link RosterUnit}, pointing down to its bodyguard via
 * `leader_attachment.bodyguard_ref`. Selection UIs start from the body unit,
 * so this scans for the leader whose `bodyguard_ref.id` matches. Returns
 * `undefined` when no leader in the roster is attached to that unit (the
 * common case — attachments are optional at game start).
 */
export function resolveAttachedLeader(
  roster: Roster,
  bodyguardUnitId: string,
): RosterUnit | undefined {
  return roster.units.find(
    (u) => u.leader_attachment?.bodyguard_ref.id === bodyguardUnitId,
  );
}

/**
 * Every roster unit attached to `unitId`, resolved from *either* end of the
 * attachment. A leader+bodyguard are one combined unit, so a selection UI may
 * start from either half:
 *   - `unitId` is the **bodyguard** → the leader(s) whose
 *     `leader_attachment.bodyguard_ref.id` points at it (body-first, the
 *     {@link resolveAttachedLeader} direction), and
 *   - `unitId` is the **leader** → the bodyguard its own `leader_attachment`
 *     points to.
 * Returns the partner {@link RosterUnit}s (deduped, source order). Empty when
 * the unit has no attachment in this roster — the common case, since
 * attachments are optional at game start. Shaped as a list to carry 11th
 * edition's multi-member attachments without an API change.
 */
export function resolveAttachmentPartners(
  roster: Roster,
  unitId: string,
): RosterUnit[] {
  const seen = new Set<RosterUnit>();
  const out: RosterUnit[] = [];
  const add = (u: RosterUnit | undefined) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };

  for (const u of roster.units) {
    // Body-first: leaders pointing down at `unitId`.
    if (u.leader_attachment?.bodyguard_ref.id === unitId) add(u);
    // Leader-first: `unitId`'s own entry points down at a bodyguard.
    if (u.ref.id === unitId && u.leader_attachment) {
      add(roster.units.find((b) => b.ref.id === u.leader_attachment!.bodyguard_ref.id));
    }
  }
  return out;
}
