/**
 * Enhancements that give their bearer a weapon ("this model has the following weapon"). The
 * translator hands a weapon grant back to its caller, so such an Enhancement yields no buff lever
 * of its own. The stack offers it as a points lever on each member that can take it, and the
 * bearer's loadout fires the weapon on one model while the lever is selected.
 */
import type { BuffSource, EngineContext } from "../cruncher/index.js";
import type { Dataset, StackableBuffGroup } from "../data/dataset.js";
import { canTakeEnhancement } from "../data/lever-providers.js";
import type { PoolLever, StackMember, StackSpec } from "./model.js";
import { WEAPON_GRANT_REASON, type WeaponGrant } from "./weapon-grants.js";

/** One Enhancement weapon grant offered to one bearer. */
export interface EnhancementGrant {
  /** The Enhancement's lever id, `enhancement:<enhancement id>@<bearer id>`. */
  leverId: string;
  enhancementId: string;
  enhancementName: string;
  cost: number;
  bearerId: string;
  bearerName: string;
  abilityId: string;
  weaponId: string;
  /** Copies of the weapon the bearer model gets. */
  copies: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The weapon grants to the bearer model that `member`'s own translation of the ability reaches. */
function bearerGrants(dataset: Dataset, abilityId: string, member: StackMember, context: EngineContext): { weaponId: string; copies: number }[] {
  const ability = dataset.abilities.getInFaction(abilityId, member.unit.factionId) ?? dataset.abilities.getAny(abilityId);
  if (!ability) return [];
  const source: BuffSource = { kind: "ability", abilityId: ability.id, abilityKind: "unit" };
  const out: { weaponId: string; copies: number }[] = [];
  for (const fragment of ability.describeBuffs(source, context, "attacker").unsupported) {
    const node = fragment.effectFragment;
    if (fragment.reason !== WEAPON_GRANT_REASON || !isObject(node) || node.target !== "this-model" || !isObject(node.modifier)) continue;
    const { weapon_id: weaponId, count } = node.modifier;
    const copies = count === undefined ? 1 : Number.isInteger(count) && (count as number) > 0 ? count as number : null;
    if (typeof weaponId !== "string" || copies === null || out.some((grant) => grant.weaponId === weaponId)) continue;
    out.push({ weaponId, copies });
  }
  return out;
}

/**
 * Every weapon grant an Enhancement of the spec's detachments offers a member that can take it,
 * read under that member's `contextFor` context.
 */
export function enhancementGrants(dataset: Dataset, spec: StackSpec, contextFor: (member: StackMember) => EngineContext): EnhancementGrant[] {
  const out: EnhancementGrant[] = [];
  const enhancements = [...dataset.forGameMode("all").enhancements];
  for (const detachmentId of spec.detachmentIds) {
    for (const enhancement of enhancements) {
      if (enhancement.detachment_id !== detachmentId || !enhancement.ability_id) continue;
      for (const member of spec.members) {
        if (!canTakeEnhancement(dataset, enhancement, member.unit)) continue;
        const leverId = `enhancement:${enhancement.id}@${member.unit.id}`;
        for (const grant of bearerGrants(dataset, enhancement.ability_id, member, contextFor(member))) {
          if (out.some((offered) => offered.leverId === leverId && offered.weaponId === grant.weaponId)) continue;
          out.push({
            leverId, enhancementId: enhancement.id, enhancementName: enhancement.name, cost: enhancement.cost,
            bearerId: member.unit.id, bearerName: member.unit.name, abilityId: enhancement.ability_id, ...grant,
          });
        }
      }
    }
  }
  return out;
}

/**
 * The pool's levers and groups with a points lever for each offered Enhancement that has none:
 * one per bearer, in the bearer's Enhancement group. An Enhancement whose other effects already
 * gave it a lever keeps that lever, and its grant rides on it.
 */
export function withEnhancementGrantLevers(
  levers: Map<string, PoolLever>,
  groups: Map<string, StackableBuffGroup>,
  grants: readonly EnhancementGrant[],
): void {
  for (const grant of grants) {
    if (levers.has(grant.leverId)) continue;
    const group = `enhancement@${grant.bearerId}`;
    const source: BuffSource = { kind: "ability", abilityId: grant.abilityId, abilityKind: "unit" };
    levers.set(grant.leverId, {
      id: grant.leverId, label: `${grant.enhancementName} (${grant.bearerName})`, buffs: [], enabled: false, source,
      cost: { points: grant.cost }, group, perMember: new Map(),
    });
    if (!groups.has(group)) groups.set(group, { id: group, label: `Enhancement on ${grant.bearerName}`, maxActivations: 1 });
  }
}

/**
 * The weapons the selected Enhancements give `bearerId`'s model, as grants of a fixed model count
 * (`models: 1`) for {@link unitLoadoutDamage}.
 */
export function selectedBearerGrants(grants: readonly EnhancementGrant[], selectedLeverIds: readonly string[], bearerId: string): WeaponGrant[] {
  const selected = new Set(selectedLeverIds);
  return grants
    .filter((grant) => grant.bearerId === bearerId && selected.has(grant.leverId))
    .map((grant) => ({ abilityId: grant.abilityId, wargearId: grant.leverId, weaponId: grant.weaponId, perBearer: grant.copies, models: 1 }));
}

/** Whether an unsupported fragment is a weapon grant of Enhancement lever `leverId`, which its bearer's loadout scores. */
export function scoredByBearer(grants: readonly EnhancementGrant[], leverId: string, fragment: { reason: string; effectFragment: unknown }): boolean {
  if (fragment.reason !== WEAPON_GRANT_REASON) return false;
  const weaponId = isObject(fragment.effectFragment) && isObject(fragment.effectFragment.modifier) ? fragment.effectFragment.modifier.weapon_id : undefined;
  return grants.some((grant) => grant.leverId === leverId && grant.weaponId === weaponId);
}
