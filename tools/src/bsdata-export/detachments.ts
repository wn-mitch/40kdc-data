/**
 * Detachment and Enhancement entries, laid out as BSData lays them out: the
 * family root's Detachment selection holds every family detachment inline (its
 * Detachment Points, Force Dispositions, tag categories and rules), and one
 * shared Enhancements group holds every family enhancement inline, each hidden
 * unless its detachment is selected and the unit taking it may.
 */
import type { Dataset } from "../data/dataset.js";
import { equipableByNonCharacter, meetsEnhancementGroups, missingRequiredAbilities } from "../data/enhancement-eligibility.js";
import type { Detachment, Enhancement, Unit } from "../generated.js";
import type { CatalogueContext, CatalogueSet } from "./catalogue.js";
import { BSDATA_IDS } from "./ids.js";
import { categoryLink, characteristic, compact, condition, constraint, cost, hiddenWhen, profile } from "./nodes.js";
import type { BsNode } from "./source.js";
import { isEpicHero } from "./unit.js";

function isCharacter(unit: Unit): boolean {
  return unit.role === "character" || unit.role === "epic-hero" || (unit.keywords ?? []).includes("Character");
}

export function abilityText(dataset: Dataset, factionId: string, abilityId: string): { name: string; text: string } | undefined {
  const ability = dataset.abilities.byFaction(factionId).find((a) => a.id === abilityId) ?? dataset.abilities.getAny(abilityId);
  return ability ? { name: ability.name, text: ability.describe() } : undefined;
}

/**
 * Hides a detachment from armies whose primary catalogue doesn't offer it (a Chapter's own
 * detachment in the Space Marines list), as BSData does. None when every family army offers it.
 */
function offeredOnly(set: CatalogueSet, ctx: CatalogueContext, root: string, detachment: Detachment): BsNode[] {
  const family = set.familyOf(root);
  const offering = family.filter((f) => ctx.dataset.detachments.byFaction(f).some((d) => d.id === detachment.id));
  if (offering.length === family.length) return [];
  return [hiddenWhen(offering.map((f) => condition({ childId: set.catalogueId(f)!, field: "selections", scope: "primary-catalogue", type: "notInstanceOf", value: 1 })))];
}

export function detachmentEntry(set: CatalogueSet, ctx: CatalogueContext, root: string, detachment: Detachment, tagLinks: readonly BsNode[]): BsNode {
  const id = set.detachmentEntryId(detachment.id, root)!;
  const key = `detachment:${root}/${detachment.id}`;
  const rules = (detachment.detachment_rule_ids ?? (detachment.detachment_rule_id ? [detachment.detachment_rule_id] : []))
    .map((ruleId) => ({ ruleId, rule: abilityText(ctx.dataset, detachment.faction_id, ruleId) }))
    .filter((r): r is { ruleId: string; rule: { name: string; text: string } } => r.rule !== undefined)
    .map(({ ruleId, rule }) => ({ name: rule.name, id: ctx.ids.id(`${key}:rule:${ruleId}`), description: rule.text, hidden: false }));
  return compact({
    name: detachment.name,
    id,
    hidden: false,
    import: true,
    type: "upgrade",
    categoryLinks: [
      ...(detachment.force_dispositions ?? []).map((dispositionId) => {
        const disposition = ctx.refs.disposition(dispositionId);
        return categoryLink(disposition.name, ctx.ids.id(`${key}:disposition:${dispositionId}`), disposition.categoryId, false);
      }),
      ...tagLinks,
    ],
    constraints: [constraint({ id: ctx.ids.id(`${key}:max`), type: "max", value: 1, field: "selections", scope: "force", includeChildSelections: true })],
    costs: [cost("pts", ctx.refs.cost.pts, 0), cost("Detachment Points", ctx.refs.cost.dp, detachment.detachment_points ?? 0)],
    modifiers: offeredOnly(set, ctx, root, detachment),
    rules,
  });
}

/**
 * An enhancement, inline in the family's shared Enhancements group. `eligible` are the entry ids of
 * the units that may take it: it hides under any other unit, as BSData's `ancestor` conditions do.
 */
export function enhancementEntry(set: CatalogueSet, ctx: CatalogueContext, root: string, enhancement: Enhancement, detachment: Detachment, eligible: readonly string[]): BsNode {
  const id = set.enhancementEntryId(root, enhancement);
  const key = `enhancement:${root}/${enhancement.id}`;
  const detachmentId = set.detachmentEntryId(detachment.id, root)!;
  const rule = enhancement.ability_id ? abilityText(ctx.dataset, detachment.faction_id, enhancement.ability_id) : undefined;
  const abilities = ctx.refs.profileTypes.Abilities;
  return compact({
    name: enhancement.name,
    id,
    import: true,
    type: "upgrade",
    constraints: [
      constraint({ id: ctx.ids.id(`${key}:max`), type: "max", value: enhancement.max_targets ?? 1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true }),
    ],
    costs: [cost("pts", ctx.refs.cost.pts, enhancement.cost ?? 0), cost("Enhancements", ctx.refs.cost.enhancements, enhancement.counts_toward_enhancement_limit === false ? 0 : 1)],
    hidden: eligible.length === 0,
    modifiers: [
      hiddenWhen([condition({ childId: detachmentId, childName: detachment.name, field: "selections", scope: "force", type: "lessThan", value: 1, includeChildSelections: true })]),
      ...(eligible.length > 0 ? [hiddenWhen(eligible.map((unitId) => condition({ childId: unitId, field: "selections", scope: "ancestor", type: "notInstanceOf", value: 1 })))] : []),
    ],
    profiles: rule
      ? [profile(enhancement.name, ctx.ids.id(`${key}:profile`), abilities.id, "Abilities", [characteristic("Description", abilities.characteristics.Description, rule.text)])]
      : undefined,
  });
}

/**
 * The unit's keywords in `factionId`'s army with `detachment` selected, as roster validation reads
 * them: its own, the army's when its faction keywords fall within them, and the conditional
 * keywords that detachment and army grant (a Shadow Legion unit's SHADOW LEGION).
 */
function keywordHas(ctx: CatalogueContext, unit: Unit, factionId: string, detachment: Detachment): (keyword: string) => boolean {
  const army = ctx.dataset.factions.get(factionId)?.raw.keywords ?? [];
  const owned = new Set<string>([...(unit.keywords ?? []), ...(unit.faction_keywords ?? []), unit.name]);
  if (army.length > 0 && (unit.faction_keywords ?? []).every((k) => army.includes(k))) for (const k of army) owned.add(k);
  for (const grant of unit.conditional_keywords ?? []) {
    if (grant.choice_group) continue;
    if (grant.required_detachment_id && grant.required_detachment_id !== detachment.id) continue;
    if (grant.required_faction_keyword && !army.includes(grant.required_faction_keyword)) continue;
    owned.add(grant.keyword);
  }
  return (keyword) => owned.has(keyword);
}

/** Whether `unit` may take `enhancement` in some army that offers its `detachment`. */
export function canTake(ctx: CatalogueContext, unit: Unit, enhancement: Enhancement, detachment: Detachment): boolean {
  if (isEpicHero(unit) && enhancement.equipable_by_epic_hero !== true) return false;
  if (!isCharacter(unit) && !equipableByNonCharacter(enhancement)) return false;
  const rows = ctx.dataset.unitCompositionOf(unit)?.models ?? [];
  if (rows.length > 0 && rows.every((m) => m.excluded_from_enhancements === true)) return false;
  if (missingRequiredAbilities(enhancement, unit.ability_ids).length > 0) return false;
  const armies = ctx.factions.filter((f) => ctx.dataset.detachments.byFaction(f).some((d) => d.id === detachment.id));
  return armies.some((factionId) => {
    const has = keywordHas(ctx, unit, factionId, detachment);
    return meetsEnhancementGroups(enhancement, unit.id, has) && !(enhancement.exclusion_keywords ?? []).some(has);
  });
}

export function configurationContainer(ctx: CatalogueContext, key: string, name: string, preferredId: string | undefined, body: Record<string, unknown>): BsNode {
  return compact({
    name,
    id: ctx.ids.id(key, preferredId),
    hidden: false,
    import: true,
    type: "upgrade",
    categoryLinks: [categoryLink("Configuration", ctx.ids.id(`${key}:category`), ctx.refs.category("Configuration"), true)],
    constraints: [
      constraint({ id: ctx.ids.id(`${key}:min`), type: "min", value: 1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true }),
      constraint({ id: ctx.ids.id(`${key}:max`), type: "max", value: 1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true }),
    ],
    costs: [cost("pts", ctx.refs.cost.pts, 0)],
    ...body,
  });
}

/**
 * The Detachment selection an army picks its detachment from: the family root's, holding `entries`
 * inline. Child armies take it through their catalogue link to the root. Null when the family has
 * no detachments (the titan legions, taken only as allies): BSData gives those no Detachment
 * selection, and an empty choice would be one no roster could fill.
 */
export function detachmentContainer(ctx: CatalogueContext, root: string, entries: readonly BsNode[]): BsNode | null {
  const key = `detachments:${root}`;
  if (entries.length === 0) return null;
  return configurationContainer(ctx, key, "Detachment", BSDATA_IDS.factionEntries[root]?.Detachment, {
    selectionEntryGroups: [
      {
        name: "Detachment",
        id: ctx.ids.id(`${key}:group`),
        hidden: false,
        constraints: [constraint({ id: ctx.ids.id(`${key}:group:min`), type: "min", value: 1, field: "selections", scope: "parent" })],
        selectionEntries: [...entries],
      },
    ],
  });
}

/** The family's one shared Enhancements group, holding `entries` inline; one per unit. */
export function enhancementGroup(ctx: CatalogueContext, root: string, entries: readonly BsNode[]): BsNode | null {
  if (entries.length === 0) return null;
  const key = `enhancements:${root}`;
  return compact({
    name: "Enhancements",
    id: ctx.ids.id(key),
    hidden: false,
    constraints: [constraint({ id: ctx.ids.id(`${key}:max`), type: "max", value: 1, field: "selections", scope: "parent" })],
    selectionEntries: [...entries],
  });
}
