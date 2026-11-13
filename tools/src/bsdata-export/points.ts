/**
 * A unit's points as BSData cost modifiers. The base cost is the price of the
 * smallest squad as the army's first copy; `set` modifiers then apply each
 * tier in the order the package's pricing (`pricing.ts`) resolves them, so the
 * last matching modifier gives the price `hostUnitPoints` gives:
 *
 *  1. native tiers, by army-copy band then model count;
 *  2. a chapter's reprice of a shared datasheet (`allied_points` naming a
 *     faction), while that faction's catalogue is the army's catalogue;
 *  3. `detachment_pricing`, while that detachment is selected.
 */
import type { Unit } from "../generated.js";
import { compact, condition, modifier } from "./nodes.js";
import type { BsNode } from "./source.js";

type Tier = { models: number; cost: number; unit_count_min?: number; unit_count_max?: number | null };

export interface PointsContext {
  /** The unit entry's own id; model-count conditions count models beneath it. */
  readonly entryId: string;
  readonly entryName: string;
  /** Whether the entry is a multi-model unit (model-count tiers apply). */
  readonly multiModel: boolean;
  /** The unit's smallest model count. */
  readonly minModels: number;
  readonly ptsTypeId: string;
  /** The catalogue id for a faction id, when that faction has a catalogue. */
  readonly catalogueId: (factionId: string) => string | undefined;
  /** The detachment option id for a detachment id, when exported. */
  readonly detachmentEntryId: (detachmentId: string) => string | undefined;
}

/** The price of `models` models as the first copy, from the native table. */
export function basePrice(unit: Unit, models: number): number {
  const tiers = (unit.points ?? [])
    .filter((t) => (t.unit_count_min ?? 1) <= 1)
    .slice()
    .sort((a, b) => a.models - b.models);
  let chosen = tiers[0];
  for (const tier of tiers) if (models >= tier.models) chosen = tier;
  return chosen?.cost ?? 0;
}

/** Earlier copies of this entry in the force number at least `count`. */
export function earlierCopies(ctx: PointsContext, count: number): BsNode {
  return {
    type: "and",
    localConditionGroups: [
      {
        conditions: [
          condition({ childId: "any", field: "selections", scope: "self", type: "before", value: 1 }),
          condition({ childId: ctx.entryId, childName: ctx.entryName, field: "selections", scope: "self", type: "instanceOf", value: 1 }),
        ],
        field: "selections",
        includeChildForces: true,
        includeChildSelections: true,
        repeats: 1,
        scope: "parent",
        type: "atLeast",
        value: count,
      },
    ],
  };
}

function modelsAtLeast(ctx: PointsContext, models: number): BsNode {
  return condition({ childId: "model", field: "selections", scope: ctx.entryId, type: "atLeast", value: models, includeChildSelections: true });
}

function tierModifiers(ctx: PointsContext, tiers: readonly Tier[], guard: readonly BsNode[]): BsNode[] {
  const ordered = tiers
    .slice()
    .sort((a, b) => (a.unit_count_min ?? 1) - (b.unit_count_min ?? 1) || a.models - b.models);
  return ordered.map((tier) => {
    // The first copy's price at the smallest size is the entry's base cost.
    if ((tier.unit_count_min ?? 1) <= 1 && tier.models <= ctx.minModels && guard.length === 0) return {};
    const conditions = [...guard];
    if (ctx.multiModel && tier.models > 1) conditions.push(modelsAtLeast(ctx, tier.models));
    const groups: BsNode[] = [];
    const band = tier.unit_count_min ?? 1;
    if (band > 1) groups.push(earlierCopies(ctx, band - 1));
    return compact({
      ...modifier({ field: ctx.ptsTypeId, type: "set", value: tier.cost }),
      conditions: conditions.length > 0 ? conditions : undefined,
      conditionGroups: groups.length > 0 ? groups : undefined,
    });
  });
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}

/** The `set` modifiers that price the unit; empty when one cost always applies. */
export function pointsModifiers(unit: Unit, ctx: PointsContext): BsNode[] {
  const out = tierModifiers(ctx, (unit.points ?? []) as Tier[], []).filter((m) => m.field !== undefined);
  for (const [host, tiers] of groupBy(unit.allied_points ?? [], (t) => t.host_faction)) {
    const catalogueId = ctx.catalogueId(host);
    if (!catalogueId) continue;
    const inCatalogue = condition({ childId: catalogueId, field: "selections", scope: "primary-catalogue", type: "instanceOf", value: 1 });
    out.push(...tierModifiers(ctx, tiers as Tier[], [inCatalogue]));
  }
  for (const [detachment, tiers] of groupBy(unit.detachment_pricing ?? [], (t) => t.detachment_id)) {
    const detachmentId = ctx.detachmentEntryId(detachment);
    if (!detachmentId) continue;
    const selected = condition({ childId: detachmentId, field: "selections", scope: "force", type: "atLeast", value: 1, includeChildSelections: true });
    out.push(...tierModifiers(ctx, tiers as Tier[], [selected]));
  }
  return out;
}
