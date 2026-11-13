/**
 * Detachment and Enhancement entries: each detachment's option (its Detachment
 * Points, Force Dispositions, tag categories and rules), each Enhancement
 * (hidden unless its detachment is selected) with the datasheets that may take
 * it, and the Detachment selection an army picks from.
 */
import type { Dataset } from "../data/dataset.js";
import { meetsEnhancementGroups, missingRequiredAbilities } from "../data/enhancement-eligibility.js";
import type { Detachment, Enhancement, Unit } from "../generated.js";
import type { CatalogueContext, CatalogueSet } from "./catalogue.js";
import { BSDATA_IDS } from "./ids.js";
import { categoryLink, characteristic, compact, condition, constraint, cost, entryLink, hiddenWhen, profile } from "./nodes.js";
import type { BsNode } from "./source.js";
import { isEpicHero } from "./unit.js";

function isCharacter(unit: Unit): boolean {
  return unit.role === "character" || unit.role === "epic-hero" || (unit.keywords ?? []).includes("Character");
}

function abilityText(dataset: Dataset, factionId: string, abilityId: string): { name: string; text: string } | undefined {
  const ability = dataset.abilities.byFaction(factionId).find((a) => a.id === abilityId) ?? dataset.abilities.getAny(abilityId);
  return ability ? { name: ability.name, text: ability.describe() } : undefined;
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
    rules,
  });
}

export function enhancementEntry(set: CatalogueSet, ctx: CatalogueContext, root: string, enhancement: Enhancement, detachment: Detachment): BsNode {
  const id = set.enhancementEntryId(root, enhancement);
  const key = `enhancement:${root}/${enhancement.id}`;
  const detachmentId = set.detachmentEntryId(detachment.id, root)!;
  const rule = enhancement.ability_id ? abilityText(ctx.dataset, detachment.faction_id, enhancement.ability_id) : undefined;
  const abilities = ctx.refs.profileTypes.Abilities;
  return compact({
    name: enhancement.name,
    id,
    hidden: false,
    import: true,
    type: "upgrade",
    constraints: [
      constraint({ id: ctx.ids.id(`${key}:max`), type: "max", value: enhancement.max_targets ?? 1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true }),
    ],
    costs: [cost("pts", ctx.refs.cost.pts, enhancement.cost ?? 0), cost("Enhancements", ctx.refs.cost.enhancements, 1)],
    modifiers: [
      hiddenWhen([condition({ childId: detachmentId, childName: detachment.name, field: "selections", scope: "force", type: "lessThan", value: 1, includeChildSelections: true })]),
    ],
    profiles: rule
      ? [profile(enhancement.name, ctx.ids.id(`${key}:profile`), abilities.id, "Abilities", [characteristic("Description", abilities.characteristics.Description, rule.text)])]
      : undefined,
  });
}

function keywordHas(unit: Unit): (keyword: string) => boolean {
  const owned = new Set<string>([...(unit.keywords ?? []), ...(unit.faction_keywords ?? []), unit.name]);
  return (keyword) => owned.has(keyword);
}

export function canTake(ctx: CatalogueContext, unit: Unit, enhancement: Enhancement): boolean {
  if (isEpicHero(unit)) return false;
  if (!isCharacter(unit) && enhancement.upgrade_tag !== true) return false;
  const rows = ctx.dataset.unitCompositionOf(unit)?.models ?? [];
  if (rows.length > 0 && rows.every((m) => m.excluded_from_enhancements === true)) return false;
  const has = keywordHas(unit);
  if (!meetsEnhancementGroups(enhancement, unit.id, has)) return false;
  if (missingRequiredAbilities(enhancement, unit.ability_ids).length > 0) return false;
  return !(enhancement.exclusion_keywords ?? []).some(has);
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

/** The Detachment selection a faction's army picks its detachments from. */
export function detachmentContainer(set: CatalogueSet, ctx: CatalogueContext, factionId: string, root: string): BsNode {
  const key = `detachments:${factionId}`;
  const own = ctx.dataset.detachments.byFaction(factionId);
  const hideOutside =
    factionId === root && set.familyOf(root).length > 1
      ? [hiddenWhen([condition({ childId: set.catalogueId(root)!, field: "selections", scope: "primary-catalogue", type: "notInstanceOf", value: 1 })])]
      : undefined;
  return configurationContainer(ctx, key, "Detachment", BSDATA_IDS.factionEntries[factionId]?.Detachment, {
    modifiers: hideOutside,
    selectionEntryGroups: [
      {
        name: "Detachment",
        id: ctx.ids.id(`${key}:group`),
        hidden: false,
        constraints: [constraint({ id: ctx.ids.id(`${key}:group:min`), type: "min", value: 1, field: "selections", scope: "parent" })],
        entryLinks: own.map((detachment) =>
          entryLink({ name: detachment.name, id: ctx.ids.id(`${key}:link:${detachment.id}`), targetId: set.detachmentEntryId(detachment.id, root)!, type: "selectionEntry" }),
        ),
      },
    ],
  });
}
