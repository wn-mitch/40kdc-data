/**
 * A unit's models and wargear as BSData selections.
 *
 * Models: one model entry per composition row inside a "Models" group bounded
 * by the unit's model count. Wargear: one link per item the unit can carry,
 * whose min/max at each squad size are the item's bounds from
 * `Dataset.loadoutOf` (the same rules roster validation checks), with the
 * default squad's copies as the default amount. Where an MFM slot gives each
 * model exactly one pick among items no other slot offers, the slot's items sit
 * in a group whose total is fixed at picks × that row's models, so a swap
 * cannot leave models unarmed. Slots that fail that check against the default
 * loadout get no group.
 */
import type { Dataset } from "../data/dataset.js";
import type { Unit } from "../generated.js";
import type { IdAllocator } from "./ids.js";
import { compact, condition, constraint, cost, entryLink, modifier } from "./nodes.js";
import type { BsNode } from "./source.js";

interface Row {
  readonly name: string;
  readonly min: number;
  readonly max: number;
}

interface Slot {
  readonly model?: string;
  readonly picks: number;
  readonly repeats: boolean;
  readonly alternate: boolean;
  readonly choices: readonly (readonly { id: string; count: number }[])[];
}

export interface WargearContext {
  readonly ids: IdAllocator;
  readonly dataset: Dataset;
  readonly entryId: string;
  readonly ptsTypeId: string;
  /** The shared entry id for an item id, when the catalogue defines one. */
  readonly itemEntry: (itemId: string) => { readonly id: string; readonly name: string } | undefined;
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

/** Models on `row` in a unit of `total` models, when the rows decide it. */
function rowModels(rows: readonly Row[], rowName: string, total: number): number | null {
  const variable = rows.filter((r) => r.min !== r.max);
  const fixed = rows.filter((r) => r.min === r.max).reduce((sum, r) => sum + r.min, 0);
  const row = rows.find((r) => r.name === rowName.replace(/#\d+$/, ""));
  if (!row) return null;
  if (row.min === row.max) return row.min;
  if (variable.length !== 1) return null;
  return total - fixed;
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

function safeGroups(unit: Unit, ctx: WargearContext, rows: readonly Row[], items: ReadonlySet<string>): { slot: Slot; itemIds: string[] }[] {
  const loadout = ctx.dataset.unitCompositionOf(unit)?.loadout as { slots?: Slot[] } | undefined;
  const slots = loadout?.slots ?? [];
  const offeredBy = new Map<string, number>();
  for (const slot of slots) for (const choice of slot.choices) for (const item of choice) offeredBy.set(item.id, (offeredBy.get(item.id) ?? 0) + 1);
  const view = ctx.dataset.loadoutOf(unit);
  const out: { slot: Slot; itemIds: string[] }[] = [];
  for (const slot of slots) {
    if (slot.alternate || !slot.model || slot.choices.length < 2) continue;
    if (!slot.choices.every((choice) => choice.length === 1 && choice[0].count === 1)) continue;
    const itemIds = slot.choices.map((choice) => choice[0].id);
    if (new Set(itemIds).size !== itemIds.length) continue;
    if (!itemIds.every((id) => offeredBy.get(id) === 1 && items.has(id))) continue;
    const holds = modelCounts(unit).every((n) => {
      const models = rowModels(rows, slot.model!, n);
      const base = view.base(n);
      if (models === null || !base) return false;
      return itemIds.reduce((sum, id) => sum + (base.get(id) ?? 0), 0) === slot.picks * models;
    });
    if (holds) out.push({ slot, itemIds });
  }
  return out;
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

  if (multiModel) {
    selectionEntryGroups.push({
      name: "Models",
      id: ctx.ids.id(`${key}:models`),
      hidden: false,
      constraints: [
        constraint({ id: ctx.ids.id(`${key}:models:min`), type: "min", value: counts[0], field: "selections", scope: "parent", includeChildSelections: false }),
        constraint({ id: ctx.ids.id(`${key}:models:max`), type: "max", value: counts[counts.length - 1], field: "selections", scope: "parent", includeChildSelections: false }),
      ],
      selectionEntries: rows.map((row, index) =>
        compact({
          name: row.name,
          id: ctx.ids.id(`${key}:model:${index}:${row.name}`),
          hidden: false,
          import: true,
          type: "model",
          constraints: [
            constraint({ id: ctx.ids.id(`${key}:model:${index}:min`), type: "min", value: row.min, field: "selections", scope: "parent" }),
            constraint({ id: ctx.ids.id(`${key}:model:${index}:max`), type: "max", value: row.max, field: "selections", scope: "parent" }),
          ],
          costs: [cost("pts", ctx.ptsTypeId, 0)],
        }),
      ),
    });
  }

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

  const grouped = new Set<string>();
  safeGroups(unit, ctx, rows, items).forEach(({ slot, itemIds }, index) => {
    const links = itemIds.map(itemLink).filter((l): l is BsNode => l !== null);
    if (links.length !== itemIds.length) return;
    for (const id of itemIds) grouped.add(id);
    const totals = counts.map((n) => [n, slot.picks * rowModels(rows, slot.model!, n)!] as [number, number]);
    const limits = sizedLimits(ctx, `${key}:slot:${index}`, totals, totals);
    selectionEntryGroups.push(
      compact({
        name: `${slot.model!.replace(/#\d+$/, "")} wargear`,
        id: ctx.ids.id(`${key}:slot:${index}`),
        hidden: false,
        constraints: limits.constraints,
        entryLinks: links,
        modifiers: limits.modifiers.length > 0 ? limits.modifiers : undefined,
      }),
    );
  });

  const entryLinks = [...items]
    .filter((id) => !grouped.has(id))
    .sort()
    .map(itemLink)
    .filter((l): l is BsNode => l !== null);
  return { selectionEntries: [], selectionEntryGroups, entryLinks };
}
