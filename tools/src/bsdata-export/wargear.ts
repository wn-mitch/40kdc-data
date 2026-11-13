/**
 * A unit's models and wargear as BSData selections.
 *
 * Models: one model entry per composition row inside a "Models" group bounded
 * by the unit's model count. Wargear: under MFM loadout rules each model
 * carries its own bundle choices (`model-wargear.ts`). A unit with only
 * authored wargear options gets one link per item it can carry, whose min/max
 * at each squad size are the item's bounds from `Dataset.loadoutOf`, with the
 * default squad's copies as the default amount.
 */
import type { Dataset } from "../data/dataset.js";
import type { Unit } from "../generated.js";
import type { IdAllocator } from "./ids.js";
import type { MfmLoadoutRules } from "../data/mfm-loadout.js";
import { mfmRowSplits } from "../data/mfm-loadout-unit.js";
import { modelWargear } from "./model-wargear.js";
import { compact, condition, constraint, cost, entryLink, modifier } from "./nodes.js";
import type { BsNode } from "./source.js";

interface Row {
  readonly name: string;
  readonly min: number;
  readonly max: number;
}

export interface WargearContext {
  readonly ids: IdAllocator;
  readonly dataset: Dataset;
  readonly entryId: string;
  readonly ptsTypeId: string;
  /** The shared entry id for an item id, when the catalogue defines one. */
  readonly itemEntry: (itemId: string) => { readonly id: string; readonly name: string } | undefined;
  /** A hidden category, defined in the unit's catalogue, that the members of the shared cap `key` link to. */
  readonly capCategory: (key: string) => { readonly id: string; readonly name: string };
}

/** Every model count the unit can be fielded at. */
export function modelCounts(unit: Unit): number[] {
  const min = unit.model_count?.min ?? 1;
  const max = unit.model_count?.max ?? min;
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

export function compositionRows(dataset: Dataset, unit: Unit): Row[] {
  const rows = dataset.unitCompositionOf(unit)?.models ?? [];
  if (rows.length > 0) return rows.map((r) => ({ name: r.name, min: r.min, max: r.max }));
  const counts = modelCounts(unit);
  return [{ name: unit.name, min: counts[0], max: counts[counts.length - 1] }];
}

function countModifiers(ctx: WargearContext, constraintId: string, values: readonly (readonly [number, number])[]): BsNode[] {
  const out: BsNode[] = [];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i][1] === values[i - 1][1]) continue;
    out.push(
      modifier({
        field: constraintId,
        type: "set",
        value: values[i][1],
        conditions: [
          condition({ childId: "model", field: "selections", scope: ctx.entryId, type: "atLeast", value: values[i][0], includeChildSelections: true }),
        ],
      }),
    );
  }
  return out;
}

/** Min/max constraints whose values track the squad size. */
function sizedLimits(ctx: WargearContext, key: string, mins: [number, number][], maxes: [number, number][]): { constraints: BsNode[]; modifiers: BsNode[] } {
  const minId = ctx.ids.id(`${key}:min`);
  const maxId = ctx.ids.id(`${key}:max`);
  return {
    constraints: [
      constraint({ id: minId, type: "min", value: mins[0][1], field: "selections", scope: "parent" }),
      constraint({ id: maxId, type: "max", value: maxes[0][1], field: "selections", scope: "parent" }),
    ],
    modifiers: [...countModifiers(ctx, minId, mins), ...countModifiers(ctx, maxId, maxes)],
  };
}

export interface UnitSelections {
  readonly selectionEntries: BsNode[];
  readonly selectionEntryGroups: BsNode[];
  readonly entryLinks: BsNode[];
}

/** The unit's models and wargear; `multiModel` false for a single-model entry. */
export function unitSelections(unit: Unit, ctx: WargearContext, multiModel: boolean): UnitSelections {
  const counts = modelCounts(unit);
  const rows = compositionRows(ctx.dataset, unit);
  const key = `unit:${unit.faction_id}/${unit.id}`;
  const selectionEntryGroups: BsNode[] = [];

  const rules = (ctx.dataset.unitCompositionOf(unit)?.loadout ?? undefined) as MfmLoadoutRules | undefined;
  const perModel = rules ? modelWargear(unit, ctx, rules, rows, counts, multiModel) : undefined;

  if (multiModel) {
    const minId = ctx.ids.id(`${key}:models:min`);
    const composition = ctx.dataset.unitCompositionOf(unit);
    // Unit sizes no tier allows: reaching one raises the minimum to the next allowed size.
    const allowed = rules && composition ? counts.filter((n) => mfmRowSplits(composition as never, n).length > 0) : counts;
    const gaps = allowed.flatMap((n, i) => (i > 0 && n > allowed[i - 1] + 1 ? [[allowed[i - 1] + 1, n] as const] : []));
    const rowEntry = (row: Row, index: number, bounds: { min: number; max: number }): BsNode =>
      compact({
        name: row.name,
        id: ctx.ids.id(`${key}:model:${index}:${row.name}`),
        hidden: false,
        import: true,
        type: "model",
        constraints: [
          constraint({ id: ctx.ids.id(`${key}:model:${index}:min`), type: "min", value: bounds.min, field: "selections", scope: "parent" }),
          constraint({ id: ctx.ids.id(`${key}:model:${index}:max`), type: "max", value: bounds.max, field: "selections", scope: "parent" }),
        ],
        entryLinks: perModel?.rowLinks[index],
        selectionEntryGroups: perModel?.rowGroups[index],
        costs: [cost("pts", ctx.ptsTypeId, 0)],
      });
    const entries: BsNode[] = [];
    const groups: BsNode[] = [];
    rows.forEach((row, index) => {
      const bare = perModel?.bare[index] ?? 0;
      if (bare === 0) {
        entries.push(rowEntry(row, index, row));
        return;
      }
      // Up to `bare` of the row's models may carry nothing, as the default unit's do.
      const rowKey = `${key}:row-group:${index}`;
      groups.push({
        name: row.name,
        id: ctx.ids.id(rowKey),
        hidden: false,
        constraints: [
          constraint({ id: ctx.ids.id(`${rowKey}:min`), type: "min", value: row.min, field: "selections", scope: "parent", includeChildSelections: false }),
          constraint({ id: ctx.ids.id(`${rowKey}:max`), type: "max", value: row.max, field: "selections", scope: "parent", includeChildSelections: false }),
        ],
        selectionEntries: [
          rowEntry(row, index, { min: 0, max: row.max }),
          compact({
            name: `${row.name} (no wargear)`,
            id: ctx.ids.id(`${key}:model:${index}:bare`),
            hidden: false,
            import: true,
            type: "model",
            constraints: [constraint({ id: ctx.ids.id(`${key}:model:${index}:bare:max`), type: "max", value: bare, field: "selections", scope: "parent" })],
            costs: [cost("pts", ctx.ptsTypeId, 0)],
          }),
        ],
      });
    });
    // A unit whose rows must match one of several tiers: no matching tier sets the maximum to 0.
    const tiers = (composition?.tiers ?? []) as { models: Row[] }[];
    const rowIds = rows.map((_, index) => (perModel && (perModel.bare[index] ?? 0) > 0 ? ctx.ids.id(`${key}:row-group:${index}`) : ctx.ids.id(`${key}:model:${index}:${rows[index].name}`)));
    const tierRange = (tier: { models: Row[] }, index: number): { min: number; max: number } => {
      const ordinal = rows.slice(0, index + 1).filter((r) => r.name === rows[index].name).length;
      const named = tier.models.filter((m) => m.name === rows[index].name);
      return named[ordinal - 1] ?? { min: 0, max: 0 };
    };
    const outside = (tier: { models: Row[] }): BsNode => ({
      type: "or",
      conditions: rows.flatMap((_, index) => {
        const { min, max } = tierRange(tier, index);
        const count = (type: "lessThan" | "greaterThan", value: number) => condition({ childId: rowIds[index], field: "selections", scope: "unit", type, value, includeChildSelections: true });
        return [...(min > 0 ? [count("lessThan", min)] : []), count("greaterThan", max)];
      }),
    });
    const maxId = ctx.ids.id(`${key}:models:max`);
    const tierModifiers = tiers.length > 1 ? [modifier({ field: maxId, type: "set", value: 0, conditionGroups: [{ type: "and", conditionGroups: tiers.map(outside) }] })] : [];
    selectionEntryGroups.push(
      compact({
        name: "Models",
        id: ctx.ids.id(`${key}:models`),
        hidden: false,
        constraints: [
          constraint({ id: minId, type: "min", value: allowed[0] ?? counts[0], field: "selections", scope: "parent", includeChildSelections: false }),
          constraint({ id: maxId, type: "max", value: counts[counts.length - 1], field: "selections", scope: "parent", includeChildSelections: false }),
        ],
        modifiers: [
          ...gaps.map(([from, next]) =>
          modifier({
            field: minId,
            type: "set",
            value: next,
            conditions: [condition({ childId: "model", field: "selections", scope: ctx.entryId, type: "atLeast", value: from, includeChildSelections: true })],
          }),
          ),
          ...tierModifiers,
        ],
        selectionEntries: entries,
        selectionEntryGroups: groups,
      }),
    );
  }
  // Under MFM rules the models carry their wargear; the unit holds only its own slots.
  if (perModel) return { selectionEntries: [], selectionEntryGroups: [...selectionEntryGroups, ...perModel.unitGroups], entryLinks: [...perModel.unitLinks] };

  const view = ctx.dataset.loadoutOf(unit);
  const bounds = counts.map((n) => [n, view.bounds(n)] as const).filter(([, b]) => b !== null);
  const items = new Set<string>();
  for (const [, b] of bounds) for (const [id, bound] of b!) if (bound.max > 0) items.add(id);
  const wargearCost = new Map((unit.wargear_costs ?? []).map((wc) => [wc.item_id, wc.cost]));
  const sized = bounds.length > 0 ? bounds : [];

  const itemLink = (itemId: string): BsNode | null => {
    const target = ctx.itemEntry(itemId);
    if (!target || sized.length === 0) return null;
    const itemKey = `${key}:item:${itemId}`;
    const mins = sized.map(([n, b]) => [n, b!.get(itemId)?.min ?? 0] as [number, number]);
    const maxes = sized.map(([n, b]) => [n, b!.get(itemId)?.max ?? 0] as [number, number]);
    const limits = sizedLimits(ctx, itemKey, mins, maxes);
    const base = view.base(sized[0][0])?.get(itemId) ?? 0;
    const surcharge = wargearCost.get(itemId);
    return compact({
      ...entryLink({
        name: target.name,
        id: ctx.ids.id(itemKey),
        targetId: target.id,
        type: "selectionEntry",
        constraints: limits.constraints,
        modifiers: limits.modifiers.length > 0 ? limits.modifiers : undefined,
      }),
      defaultAmount: base > 0 ? base : undefined,
      costs: surcharge ? [cost("pts", ctx.ptsTypeId, surcharge)] : undefined,
    });
  };

  const entryLinks = [...items]
    .sort()
    .map(itemLink)
    .filter((l): l is BsNode => l !== null);
  return { selectionEntries: [], selectionEntryGroups, entryLinks };
}
