/**
 * Warlord eligibility, as the Warlord option each datasheet links. Mirrors
 * `roster-warlord.ts` and the detachment Warlord checks in `roster-resolve.ts`:
 *
 * - A CHARACTER, or a unit with a model that can lead without being one, gets
 *   the option. A unit none of whose models can be Warlord gets it only when a
 *   detachment names it for Warlord, hidden until one of those is selected.
 * - A unit with a Supreme Commander model links the "Supreme Commander"
 *   category; every other unit's option hides once the army includes one.
 * - A detachment that mandates its Warlord links a hidden "Warlord: <name>"
 *   category from the mandated units' options, whose minimum of 1 applies
 *   while that detachment is selected.
 * - An allied rule's Warlord lock hides the option in the host army unless a
 *   selected detachment names the unit for Warlord.
 */
import type { Dataset } from "../data/dataset.js";
import type { Detachment, Unit } from "../generated.js";
import type { IdAllocator } from "./ids.js";
import { categoryLink, compact, condition, constraint, entryLink, modifier } from "./nodes.js";
import type { BsNode } from "./source.js";
import type { SystemRefs } from "./system.js";

export interface WarlordContext {
  readonly ids: IdAllocator;
  readonly dataset: Dataset;
  readonly refs: SystemRefs;
  /** Detachment option id, for a detachment in this family. */
  readonly detachmentEntryId: (detachmentId: string) => string | undefined;
  /** This family's detachments. */
  readonly detachments: readonly Detachment[];
  /** The family's Warlord upgrade entry id. */
  readonly warlordId: string;
}

function isCharacter(unit: Unit): boolean {
  return unit.role === "character" || unit.role === "epic-hero" || (unit.keywords ?? []).includes("Character");
}

function rows(dataset: Dataset, unit: Unit) {
  return dataset.unitCompositionOf(unit)?.models ?? [];
}

/** True when no model of the unit can be the Warlord. */
export function cannotLead(dataset: Dataset, unit: Unit): boolean {
  const models = rows(dataset, unit);
  return models.length > 0 && models.every((m) => m.cannot_be_warlord === true);
}

/** Whether the unit has a Supreme Commander model that can be Warlord. */
export function isSupremeCommander(dataset: Dataset, unit: Unit): boolean {
  return !cannotLead(dataset, unit) && rows(dataset, unit).some((m) => m.is_supreme_commander === true && m.cannot_be_warlord !== true);
}

/** Whether the unit's models can lead as Warlord at all (CHARACTER or a flagged model). */
export function canLeadAsWarlord(dataset: Dataset, unit: Unit): boolean {
  return isCharacter(unit) || rows(dataset, unit).some((m) => m.can_be_non_character_warlord === true);
}

function namingDetachments(ctx: WarlordContext, unit: Unit): string[] {
  return ctx.detachments
    .filter((d) => [...(d.mandatory_warlord_datasheet_ids ?? []), ...(d.granted_warlord_datasheet_ids ?? [])].includes(unit.id))
    .map((d) => ctx.detachmentEntryId(d.id))
    .filter((id): id is string => id !== undefined);
}

function noneSelected(entryIds: readonly string[]): BsNode {
  return {
    type: "and",
    conditions: entryIds.map((id) => condition({ childId: id, field: "selections", scope: "force", type: "lessThan", value: 1, includeChildSelections: true })),
  };
}

/** The "Warlord: <detachment>" categories a family's mandating detachments use. */
export function mandateCategories(ctx: WarlordContext, root: string): BsNode[] {
  const out: BsNode[] = [];
  for (const d of ctx.detachments) {
    if ((d.mandatory_warlord_datasheet_ids ?? []).length === 0) continue;
    const entryId = ctx.detachmentEntryId(d.id);
    if (!entryId) continue;
    const key = `warlord-mandate:${root}/${d.id}`;
    const minId = ctx.ids.id(`${key}:min`);
    out.push({
      name: `Warlord: ${d.name}`,
      id: ctx.ids.id(key),
      hidden: true,
      constraints: [constraint({ id: minId, type: "min", value: 0, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true })],
      modifiers: [modifier({ field: minId, type: "set", value: 1, conditions: [condition({ childId: entryId, field: "selections", scope: "force", type: "atLeast", value: 1, includeChildSelections: true })] })],
    });
  }
  return out;
}

/**
 * The unit's Warlord option, or none. `lockedIn` lists catalogues where an
 * allied rule bars the unit from Warlord.
 */
export function warlordLink(ctx: WarlordContext, root: string, unit: Unit, entryKey: string, lockedIn: readonly string[]): BsNode | undefined {
  if (!canLeadAsWarlord(ctx.dataset, unit)) return undefined;
  const naming = namingDetachments(ctx, unit);
  const barred = cannotLead(ctx.dataset, unit);
  if (barred && naming.length === 0) return undefined;
  const modifiers: BsNode[] = [];
  if (barred) modifiers.push(modifier({ field: "hidden", type: "set", value: true, conditionGroups: [noneSelected(naming)] }));
  if (lockedIn.length > 0) {
    const inLocked: BsNode = {
      type: "or",
      conditions: lockedIn.map((id) => condition({ childId: id, field: "selections", scope: "primary-catalogue", type: "instanceOf", value: 1 })),
    };
    modifiers.push(
      modifier({ field: "hidden", type: "set", value: true, conditionGroups: [compact({ type: "and", conditionGroups: naming.length > 0 ? [inLocked, noneSelected(naming)] : [inLocked] })] }),
    );
  }
  if (!isSupremeCommander(ctx.dataset, unit)) {
    modifiers.push(
      modifier({
        field: "hidden",
        type: "set",
        value: true,
        conditions: [
          condition({ childId: ctx.refs.category("Supreme Commander"), field: "selections", scope: "roster", type: "atLeast", value: 1, includeChildSelections: true, includeChildForces: true }),
        ],
      }),
    );
  }
  const mandates = ctx.detachments
    .filter((d) => (d.mandatory_warlord_datasheet_ids ?? []).includes(unit.id) && ctx.detachmentEntryId(d.id) !== undefined)
    .map((d) => categoryLink(`Warlord: ${d.name}`, ctx.ids.id(`${entryKey}:warlord-mandate:${d.id}`), ctx.ids.id(`warlord-mandate:${root}/${d.id}`), false));
  return entryLink({
    name: "Warlord",
    id: ctx.ids.id(`${entryKey}:warlord`),
    targetId: ctx.warlordId,
    type: "selectionEntry",
    categoryLinks: mandates.length > 0 ? mandates : undefined,
    modifiers: modifiers.length > 0 ? modifiers : undefined,
  });
}

/** The Supreme Commander category link a unit entry carries, if any. */
export function supremeCommanderLink(ctx: WarlordContext, unit: Unit, entryKey: string): BsNode[] {
  return isSupremeCommander(ctx.dataset, unit) ? [categoryLink("Supreme Commander", ctx.ids.id(`${entryKey}:supreme-commander`), ctx.refs.category("Supreme Commander"), false)] : [];
}
