/**
 * Per-model wargear in the BSData export, checked against the package's MFM
 * loadout checker in both directions: a loadout the export's selections allow
 * is legal (`Dataset.loadoutOf(...).check`), and a legal loadout the package
 * lists (`candidates`) can be built from the export's selections.
 */
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { RAW_DATA } from "../src/data/bundle.generated.js";
import type { MfmLoadoutRules } from "../src/data/mfm-loadout.js";
import { evaluateConstraint, type EvalContext } from "../src/bsdata-export/evaluate.js";
import { buildExport } from "../src/bsdata-export/export.js";
import { children, str, type BsNode } from "../src/bsdata-export/source.js";
import { IdAllocator } from "../src/bsdata-export/ids.js";
import { modelWargear } from "../src/bsdata-export/model-wargear.js";
import { compositionRows, modelCounts } from "../src/bsdata-export/wargear.js";
import { BSDATA_IDS } from "../src/bsdata-export/ids.js";
import { dataset, FACTIONS, loadExportFixture, type ExportFixture, type UnitEntry } from "./bsdata-export-fixture.js";

interface ChoiceNode {
  readonly id: string;
  readonly node: BsNode;
  readonly items: ReadonlyMap<string, number>;
}
interface GroupNode {
  readonly node: BsNode;
  readonly alternate: boolean;
  readonly choices: readonly ChoiceNode[];
}
interface RowNode {
  readonly id: string;
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly groups: readonly GroupNode[];
  /** Items every model of the row carries. */
  readonly fixed: ReadonlyMap<string, number>;
}
/** Rows whose models count together: one row, or a row and its bare-model entry. */
interface RowSet {
  /** The row entry's id, or the id of the group holding a row and its bare-model entry. */
  readonly id: string;
  readonly min: number;
  readonly max: number;
  readonly members: readonly RowNode[];
}
interface UnitModel {
  readonly entry: UnitEntry;
  readonly rules: MfmLoadoutRules;
  readonly sets: readonly RowSet[];
  readonly rows: readonly RowNode[];
  readonly unitGroups: readonly GroupNode[];
  readonly unitFixed: ReadonlyMap<string, number>;
  /** The Models group, whose minimum follows the allowed unit sizes. */
  readonly modelsGroup?: BsNode;
}

let fx: ExportFixture;
let models: UnitModel[];

function unitOf(entry: UnitEntry) {
  return dataset.units.byFaction(entry.factionId).find((u) => u.id === entry.unitId)!.raw;
}

function bound(node: BsNode, type: "min" | "max"): BsNode {
  return children(node, "constraints").find((c) => c.type === type && c.scope === "parent")!;
}

/** The unit's exported selections, with each item link resolved to its item id by name. */
function readUnit(entry: UnitEntry, rules: MfmLoadoutRules): UnitModel | null {
  const unit = unitOf(entry);
  const byName = new Map<string, string[]>();
  for (const id of new Set(rules.slots.flatMap((s) => s.choices.flat().map((i) => i.id)))) {
    const name = (dataset.weapons.byFaction(unit.faction_id).find((w) => w.id === id)?.name ?? dataset.weapons.getAny(id)?.name ?? dataset.wargear.getAny(id)?.name ?? id).toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), id]);
  }
  let ambiguous = false;
  const itemsOfLinks = (links: readonly BsNode[]): Map<string, number> => {
    const items = new Map<string, number>();
    for (const link of links) {
      const ids = byName.get(String(link.name).toLowerCase()) ?? [];
      if (ids.length !== 1) ambiguous = true;
      items.set(ids[0], (items.get(ids[0]) ?? 0) + Number(bound(link, "min").value));
    }
    return items;
  };
  const readGroup = (group: BsNode): GroupNode => ({
    node: group,
    alternate: String(group.name).startsWith("Alternative"),
    choices: children(group, "selectionEntries").map((choice) => ({ id: str(choice, "id")!, node: choice, items: itemsOfLinks(children(choice, "entryLinks")) })),
  });
  const wargearGroups = (node: BsNode) => children(node, "selectionEntryGroups").filter((g) => /^(Alternative wargear|Wargear) \d+$/.test(String(g.name))).map(readGroup);
  const readRow = (row: BsNode): RowNode => ({
    id: str(row, "id")!,
    name: String(row.name),
    min: children(row, "constraints").some((c) => c.type === "min") ? Number(bound(row, "min").value) : 0,
    max: Number(bound(row, "max").value),
    groups: wargearGroups(row),
    fixed: itemsOfLinks(children(row, "entryLinks")),
  });
  const modelsGroup = children(entry.node, "selectionEntryGroups").find((g) => g.name === "Models");
  const sets: RowSet[] = modelsGroup
    ? [
        ...children(modelsGroup, "selectionEntries").map((row) => {
          const r = readRow(row);
          return { id: r.id, min: r.min, max: r.max, members: [r] };
        }),
        ...children(modelsGroup, "selectionEntryGroups").map((group) => ({
          id: str(group, "id")!,
          min: Number(bound(group, "min").value),
          max: Number(bound(group, "max").value),
          members: children(group, "selectionEntries").map(readRow),
        })),
      ]
    : [{ id: "", min: 1, max: 1, members: [{ id: "", name: unit.name, min: 1, max: 1, groups: [], fixed: new Map() }] }];
  const unitFixed = itemsOfLinks(children(entry.node, "entryLinks").filter((l) => l.name !== "Warlord"));
  const model: UnitModel = { entry, rules, sets, rows: sets.flatMap((set) => set.members), unitGroups: wargearGroups(entry.node), unitFixed, modelsGroup };
  return ambiguous ? null : model;
}

/** Choice selections (per model and across the unit) are legal under the export's constraints. */
function exportAllows(model: UnitModel, n: number, perModel: readonly Map<string, number>[], unitPicks: Map<string, number>): boolean {
  const unitCounts = new Map<string, number>(unitPicks);
  for (const m of perModel) for (const [id, k] of m) unitCounts.set(id, (unitCounts.get(id) ?? 0) + k);
  const entryId = str(model.entry.node, "id")!;
  const groups = [...model.rows.flatMap((r) => r.groups), ...model.unitGroups];
  const base: EvalContext = { modelCount: n, earlierCopies: 0, primaryCatalogueId: "", selected: new Set(), counts: { unit: withCategories(groups, unitCounts) } };
  for (const group of groups) {
    for (const choice of group.choices) {
      for (const c of children(choice.node, "constraints")) {
        if (c.scope !== "unit") continue;
        const max = evaluateConstraint(choice.node, str(c, "id")!, entryId, base);
        if (max >= 0 && (unitCounts.get(choice.id) ?? 0) > max) return false;
      }
    }
  }
  return true;
}

/** Whether `picks` (choice id → count) satisfy `groups` on one model. */
function modelAllows(groups: readonly GroupNode[], picks: ReadonlyMap<string, number>): boolean {
  const ctx: EvalContext = { modelCount: 1, earlierCopies: 0, primaryCatalogueId: "", selected: new Set(), counts: { parent: groupTotals(groups, picks) } };
  return groups.every((group) => {
    const total = group.choices.reduce((n, c) => n + (picks.get(c.id) ?? 0), 0);
    const min = bound(group.node, "min");
    const max = bound(group.node, "max");
    const lo = evaluateConstraint(group.node, str(min, "id")!, "", ctx);
    const hi = evaluateConstraint(group.node, str(max, "id")!, "", ctx);
    // Every per-model maximum on a choice, including shared per-model caps.
    const each = group.choices.every((c) =>
      children(c.node, "constraints")
        .filter((k) => k.type === "max" && k.scope === "parent")
        .every((k) => {
          const max = evaluateConstraint(c.node, str(k, "id")!, "", ctx);
          return max < 0 || (picks.get(c.id) ?? 0) <= max;
        }),
    );
    return total >= lo && total <= hi && each;
  });
}

/** Selections per group id (alternate conditions count a group's selections), and per cap category. */
function groupTotals(groups: readonly GroupNode[], picks: ReadonlyMap<string, number>): Map<string, number> {
  const out = withCategories(groups, picks);
  for (const g of groups) out.set(str(g.node, "id")!, g.choices.reduce((n, c) => n + (picks.get(c.id) ?? 0), 0));
  return out;
}

/** `counts` (choice id → selections) plus each category's selections over the choices that link to it. */
function withCategories(groups: readonly GroupNode[], counts: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>(counts);
  for (const c of groups.flatMap((g) => g.choices)) {
    for (const link of children(c.node, "categoryLinks")) {
      const target = str(link, "targetId")!;
      out.set(target, (out.get(target) ?? 0) + (counts.get(c.id) ?? 0));
    }
  }
  return out;
}

function itemsOf(groups: readonly GroupNode[], picks: ReadonlyMap<string, number>, into: Map<string, number>): void {
  for (const g of groups) for (const c of g.choices) for (const [id, k] of c.items) if (picks.get(c.id)) into.set(id, (into.get(id) ?? 0) + k * picks.get(c.id)!);
}

/** Every way to fill `groups` on one model whose items are exactly `want`, up to `limit`. */
function decompositions(groups: readonly GroupNode[], want: ReadonlyMap<string, number>, limit = 8): Map<string, number>[] {
  const out: Map<string, number>[] = [];
  const choices = groups.flatMap((g) => g.choices);
  const walk = (index: number, picks: Map<string, number>, left: Map<string, number>): void => {
    if (out.length >= limit) return;
    if (index === choices.length) {
      if ([...left.values()].every((v) => v === 0) && modelAllows(groups, picks)) out.push(new Map(picks));
      return;
    }
    const choice = choices[index];
    for (let k = 0; k <= Number(bound(choice.node, "max").value); k += 1) {
      const next = new Map(left);
      let fits = true;
      for (const [id, n] of choice.items) {
        const rest = (next.get(id) ?? 0) - n * k;
        if (rest < 0) fits = false;
        next.set(id, rest);
      }
      if (!fits) break;
      if (k > 0) picks.set(choice.id, k);
      else picks.delete(choice.id);
      walk(index + 1, picks, next);
      picks.delete(choice.id);
    }
  };
  walk(0, new Map(), new Map(want));
  return out;
}

beforeAll(() => {
  fx = loadExportFixture();
  models = [...fx.entries.values()]
    .map((entry) => {
      const rules = dataset.unitCompositionOf(unitOf(entry))?.loadout as MfmLoadoutRules | undefined;
      return rules ? readUnit(entry, rules) : null;
    })
    .filter((m): m is UnitModel => m !== null);
}, 120_000);

/** Item copies `items` less `minus`; null when `minus` holds more of an item. */
function less(items: ReadonlyMap<string, number>, minus: ReadonlyMap<string, number>): Map<string, number> | null {
  const out = new Map(items);
  for (const [id, n] of minus) {
    const rest = (out.get(id) ?? 0) - n;
    if (rest < 0) return null;
    if (rest === 0) out.delete(id);
    else out.set(id, rest);
  }
  return out;
}

function addAll(into: Map<string, number>, items: ReadonlyMap<string, number>, times = 1): void {
  for (const [id, n] of items) into.set(id, (into.get(id) ?? 0) + n * times);
}

/** Whether the export's Models group admits a unit of `n` models split as `rowCounts` (row entry or row set id → models). */
function sizeAllowed(model: UnitModel, n: number, rowCounts?: ReadonlyMap<string, number>): boolean {
  if (!model.modelsGroup) return true;
  const ctx: EvalContext = { modelCount: n, earlierCopies: 0, primaryCatalogueId: "", selected: new Set(), counts: { unit: rowCounts ?? new Map() } };
  const entryId = str(model.entry.node, "id")!;
  const min = evaluateConstraint(model.modelsGroup, str(bound(model.modelsGroup, "min"), "id")!, entryId, ctx);
  const max = rowCounts ? evaluateConstraint(model.modelsGroup, str(bound(model.modelsGroup, "max"), "id")!, entryId, ctx) : n;
  return n >= min && n <= max;
}

/** Models per row entry and per row set. */
function rowCountsOf(model: UnitModel, perRow: ReadonlyMap<RowNode, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const set of model.sets) {
    let total = 0;
    for (const r of set.members) {
      out.set(r.id, perRow.get(r) ?? 0);
      total += perRow.get(r) ?? 0;
    }
    out.set(set.id, total);
  }
  return out;
}

/** Units (`faction/unit`) whose MFM rules the export encodes only in part. */
function unencodedWargear(): Set<string> {
  const out = new Set<string>();
  for (const view of dataset.forGameMode("all").units.all) {
    const unit = view.raw;
    const rules = dataset.unitCompositionOf(unit)?.loadout as MfmLoadoutRules | undefined;
    if (!rules) continue;
    const ctx = {
      ids: new IdAllocator(),
      dataset,
      entryId: "unit",
      ptsTypeId: "pts",
      itemEntry: (id: string) => ({ id, name: id }),
      capCategory: (key: string) => ({ id: key, name: key }),
    };
    const built = modelWargear(unit, ctx, rules, compositionRows(dataset, unit), modelCounts(unit), (unit.model_count?.max ?? 1) > 1);
    if (built.unencoded.length > 0) out.add(`${unit.faction_id}/${unit.id}`);
  }
  return out;
}

describe("BSData export per-model wargear agrees with the MFM loadout checker", () => {
  const unencodedUnits = unencodedWargear();

  it("encodes every limit but a few with multi-item choices", () => {
    if (process.env.MW_DEBUG) console.log([...unencodedUnits].sort().join(" "));
    // A rise here means a rule kind the export stopped encoding.
    expect(unencodedUnits.size).toBeGreaterThan(0);
    expect(unencodedUnits.size).toBeLessThanOrEqual(13);
  });

  it("allows only loadouts the package accepts", () => {
    expect(models.length).toBeGreaterThan(800);
    const rejected: string[] = [];
    let checked = 0;
    fc.assert(
      fc.property(fc.constantFrom(...models), fc.nat(), fc.array(fc.nat(), { minLength: 64, maxLength: 64 }), (model, sizePick, coins) => {
        let coin = 0;
        const next = (k: number): number => (k <= 0 ? 0 : coins[coin++ % coins.length] % (k + 1));
        const unit = unitOf(model.entry);
        const sizes = modelCounts(unit);
        const n = sizes[sizePick % sizes.length];
        fc.pre(sizeAllowed(model, n));
        // Split n over the rows within their own and their set's bounds.
        const split = new Map(model.rows.map((r) => [r, r.min]));
        let left = n - model.rows.reduce((a, r) => a + r.min, 0);
        for (const set of model.sets) {
          for (const r of set.members) {
            const room = Math.min(r.max - split.get(r)!, set.max - set.members.reduce((a, m) => a + split.get(m)!, 0), left);
            const add = next(Math.max(0, room));
            split.set(r, split.get(r)! + add);
            left -= add;
          }
        }
        fc.pre(left === 0 && model.sets.every((set) => set.members.reduce((a, m) => a + split.get(m)!, 0) >= set.min));
        fc.pre(sizeAllowed(model, n, rowCountsOf(model, split)));
        const fill = (groups: readonly GroupNode[]): Map<string, number> => {
          const useAlternate = groups.some((g) => g.alternate) && next(1) === 1;
          const picks = new Map<string, number>();
          for (const g of groups) {
            if (g.alternate !== useAlternate && groups.some((h) => h.alternate)) continue;
            const want = Number(bound(g.node, "max").value);
            for (let k = 0; k < want; k += 1) {
              const open = g.choices.filter((c) => (picks.get(c.id) ?? 0) < Number(bound(c.node, "max").value));
              if (open.length === 0) break;
              const c = open[next(open.length - 1)];
              picks.set(c.id, (picks.get(c.id) ?? 0) + 1);
            }
          }
          return picks;
        };
        const placed = model.rows.flatMap((r) => Array.from({ length: split.get(r)! }, () => ({ row: r, picks: fill(r.groups) })));
        const unitPicks = fill(model.unitGroups);
        fc.pre(placed.every((p) => modelAllows(p.row.groups, p.picks)) && modelAllows(model.unitGroups, unitPicks));
        fc.pre(exportAllows(model, n, placed.map((p) => p.picks), unitPicks));
        const items = new Map<string, number>();
        for (const p of placed) {
          addAll(items, p.row.fixed);
          itemsOf(p.row.groups, p.picks, items);
        }
        itemsOf(model.unitGroups, unitPicks, items);
        addAll(items, model.unitFixed);
        checked += 1;
        const violations = dataset.loadoutOf(unit).check(n, items);
        if (violations.length > 0) rejected.push(`${unit.faction_id}/${unit.id} n=${n} ${violations.map((v) => v.code).join(",")} ${[...items].map(([k, v]) => `${k}:${v}`).join(",")}`);
      }),
      { numRuns: 4000, maxSkipsPerRun: 1000 },
    );
    expect(checked).toBeGreaterThan(1000);
    if (process.env.MW_DEBUG) console.log(rejected.join("\n"));
    // Only units whose limits the export leaves to per-item counts may pass a loadout the package refuses.
    const units = [...new Set(rejected.map((r) => r.split(" ")[0]))].sort();
    expect(units.filter((u) => !unencodedUnits.has(u))).toEqual([]);
  });

  it("can build every loadout the package lists as legal", () => {
    const missing: string[] = [];
    let checked = 0;
    fc.assert(
      fc.property(fc.constantFrom(...models), fc.nat(), (model, sizePick) => {
        const unit = unitOf(model.entry);
        const sizes = modelCounts(unit);
        const n = sizes[sizePick % sizes.length];
        const oneModel = !model.modelsGroup;
        for (const candidate of dataset.loadoutOf(unit).candidates(n, 12)) {
          if (candidate.startsWith("…")) continue;
          const [witness] = candidate.split(" => ");
          const perModel: Map<string, number>[] = [];
          const used = new Map<RowNode, number>();
          let unitItems = new Map<string, number>();
          let problem = sizeAllowed(model, n) ? "" : "size";
          for (const group of witness.split("; ").filter(Boolean)) {
            const match = /^(.*?)(?:×(\d+))?\[(.*)\]$/.exec(group)!;
            const items = new Map((match[3] ? match[3].split(",") : []).map((p) => [p.slice(0, p.lastIndexOf(":")), Number(p.slice(p.lastIndexOf(":") + 1))] as [string, number]));
            const copies = Number(match[2] ?? 1);
            if (match[1] === "unit" || oneModel) {
              addAll(unitItems, items, copies);
              continue;
            }
            const hash = /^(.*)#(\d+)$/.exec(match[1]);
            const name = hash ? hash[1] : match[1];
            // `name#k` is the k-th row of that name; its bare-model entry sits beside it.
            const sameName = model.sets.filter((set) => set.members.some((r) => r.name === name));
            const sets = hash ? [sameName[Number(hash[2]) - 1]].filter(Boolean) : sameName;
            const fits = sets
              .flatMap((set) => set.members)
              .filter((r) => r.name === name || r.name === `${name} (no wargear)`)
              .map((r) => ({ r, rest: less(items, r.fixed) }))
              .map(({ r, rest }) => ({ r, ways: rest ? decompositions(r.groups, rest) : [] }))
              .filter(({ ways }) => ways.length > 0);
            if (fits.length === 0) {
              problem ||= `no bundle for ${group}`;
              continue;
            }
            // Same-name rows share the group's models: each copy fills the first row with room.
            for (let k = 0; k < copies; k += 1) {
              const fit = fits.find(({ r }) => (used.get(r) ?? 0) < r.max) ?? fits[0];
              used.set(fit.r, (used.get(fit.r) ?? 0) + 1);
              perModel.push(fit.ways[0]);
            }
          }
          const rest = less(unitItems, model.unitFixed);
          const unitWays = rest ? decompositions(model.unitGroups, rest) : [];
          if (unitWays.length === 0) problem ||= "no unit bundle";
          if ([...used].some(([r, k]) => k > r.max)) problem ||= "row over its maximum";
          if (!problem && !sizeAllowed(model, n, rowCountsOf(model, used))) problem = "row split outside every tier";
          checked += 1;
          if (!problem && !exportAllows(model, n, perModel, unitWays[0])) problem = "capped";
          if (problem) missing.push(`${unit.faction_id}/${unit.id} n=${n} ${problem}: ${witness}`);
        }
      }),
      { numRuns: 1500 },
    );
    expect(checked).toBeGreaterThan(1000);
    if (process.env.MW_DEBUG) console.log(missing.join("\n"));
    const units = [...new Set(missing.map((r) => `${r.split(" ")[0]} ${r.split(":")[0].split(" ").slice(2).join(" ")}`))].sort();
    expect({ count: missing.length, units }).toEqual({ count: 0, units: [] });
  });
});

describe("BSData export flat wargear for units without MFM rules", () => {
  it("bounds every item as Dataset.loadoutOf does at every squad size", () => {
    // The embedded data gives every unit MFM rules; without them the export falls back to authored wargear options.
    const flat = new Dataset({ ...RAW_DATA, unitCompositions: RAW_DATA.unitCompositions.map(({ loadout: _, ...c }) => c) } as typeof RAW_DATA);
    const documents = buildExport({ version: "1.5.1", dataset: flat });
    let compared = 0;
    for (const factionId of FACTIONS) {
      const doc = documents.find((d) => d.file === BSDATA_IDS.catalogues[factionId].file)!;
      const catalogue = Object.values(doc.document)[0] as BsNode;
      for (const entry of children(catalogue, "sharedSelectionEntries").filter((e) => e.type === "unit" || e.type === "model").slice(0, 40)) {
        // Names repeat across factions (each Chaos army has its own Helbrute).
        const view = flat.units.byFaction(factionId).find((u) => u.name === entry.name);
        if (!view) continue;
        for (const n of modelCounts(view.raw)) {
          const bounds = flat.loadoutOf(view.raw).bounds(n);
          if (!bounds) continue;
          const ctx: EvalContext = { modelCount: n, earlierCopies: 0, primaryCatalogueId: "", selected: new Set() };
          for (const link of children(entry, "entryLinks").filter((l) => l.name !== "Warlord")) {
            const ids = [...bounds.keys()].filter((id) => (flat.weapons.getAny(id)?.name ?? flat.wargear.getAny(id)?.name ?? "").toLowerCase() === String(link.name).toLowerCase());
            if (ids.length !== 1) continue;
            const [min, max] = children(link, "constraints");
            const actual = [evaluateConstraint(link, str(min, "id")!, str(entry, "id")!, ctx), evaluateConstraint(link, str(max, "id")!, str(entry, "id")!, ctx)];
            expect({ unit: view.id, item: ids[0], n, bounds: actual }).toEqual({ unit: view.id, item: ids[0], n, bounds: [bounds.get(ids[0])!.min, bounds.get(ids[0])!.max] });
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(500);
  }, 300_000);
});
