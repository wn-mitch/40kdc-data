/**
 * Copies a datasheet's wargear rules from the MFM dump into a unit composition's `loadout`, in the
 * dump's own structure: stock (the default unit's widget defaults), templates (one added model's
 * stock row), slots (per-model choice sets), limits (limited choice sets with their breakpoints) and
 * uniform sets (all-model choice sets). Rows are copied, not interpreted; the only translation is
 * naming — dump items become repo item ids through the faction's resolver, dump miniatures become
 * the composition's model names. A datasheet with any unresolvable item or model gets no `loadout`.
 */
import * as fs from "fs";
import * as path from "path";
import { nameToId } from "../converters/id-generator.js";
import type { MfmDump, DatasheetRow } from "./loader.js";
import { CORE_DIR, readJsonArray } from "./repo-files.js";
import { repoDirs } from "./faction-map.js";
import type { StagedWrite } from "./apply.js";
import {
  makeResolver,
  unitScopedResolver,
  candidateDirs,
  homeScore,
  WEAPON_ALIASES,
  type AutoResolution,
} from "./wargear.js";

export interface LoadoutItem { id: string; count: number }
export interface ModelItems { model: string; items: LoadoutItem[] }
export interface LoadoutSlot { model?: string; picks: number; repeats: boolean; alternate: boolean; choices: LoadoutItem[][] }
export interface LoadoutBreakpoint { models: number; choices: number; per_choice?: number }
export interface LoadoutLimit { model?: string; breakpoints: LoadoutBreakpoint[]; choices: LoadoutItem[][] }
export interface LoadoutUniform { model?: string; choices: { items: LoadoutItem[]; substitute: boolean }[] }
/** One app widget: the item an option adds, on its model row, and its input. */
export interface LoadoutOption { model?: string; id: string; input: "checkbox" | "stepper"; default: number }
/** `individual`: the app lists this row's models one by one, each with its own widgets. */
export interface StockRow { model?: string; models: number; items: LoadoutItem[]; individual?: true }
export interface MfmLoadout {
  stock: StockRow[];
  templates: ModelItems[];
  slots: LoadoutSlot[];
  limits: LoadoutLimit[];
  options: LoadoutOption[];
  uniform: LoadoutUniform[];
}

export type LiftResult =
  | { loadout: MfmLoadout }
  | { unresolvedItems: string[]; unresolvedModels: string[] };

/** Sums an item list into one entry per id, sorted by id. */
function items(rows: readonly { id: string; count: number }[]): LoadoutItem[] {
  const out = new Map<string, number>();
  for (const row of rows) if (row.count > 0) out.set(row.id, (out.get(row.id) ?? 0) + row.count);
  return [...out].sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => ({ id, count }));
}

const byKey = (value: unknown) => JSON.stringify(value);

/**
 * The dump's wargear rules for `datasheetId`. `resolve` maps a dump item name to a repo id;
 * `modelRows` counts the unit composition's rows per model name, which the dump's miniatures must match.
 */
export function liftLoadout(
  dump: MfmDump,
  datasheetId: string,
  resolve: (name: string) => string | null,
  modelRows: ReadonlyMap<string, number>,
): LiftResult {
  const modelNames = new Set(modelRows.keys());
  const itemName = dump.byId("wargear_item");
  const miniature = dump.byId("miniature");
  const unresolvedItems = new Set<string>();
  const unresolvedModels = new Set<string>();
  const itemId = (wargearItemId: string): string => {
    const name = dump.enName(itemName.get(wargearItemId)) ?? wargearItemId;
    const id = resolve(name);
    if (!id) unresolvedItems.add(name);
    return id ?? "";
  };
  // A name several of the datasheet's miniatures share is keyed `name#k`, the k-th of them in
  // display order, matching the k-th same-named row of the composition's models.
  const minis = [...miniature.values()]
    .filter((row) => row.datasheetId === datasheetId)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id.localeCompare(b.id));
  const rowKey = new Map<string, string>();
  for (const row of minis) {
    const name = dump.enName(row) ?? row.id;
    const same = minis.filter((other) => (dump.enName(other) ?? other.id) === name);
    rowKey.set(row.id, same.length > 1 ? `${name}#${same.indexOf(row) + 1}` : name);
  }
  const modelName = (miniatureId: string | null | undefined): string | undefined => {
    if (!miniatureId) return undefined;
    const key = rowKey.get(miniatureId) ?? dump.enName(miniature.get(miniatureId)) ?? miniatureId;
    const [name, ordinal] = key.split("#");
    if (!modelNames.has(name) || (ordinal !== undefined && Number(ordinal) > (modelRows.get(name) ?? 0))) unresolvedModels.add(key);
    return key;
  };

  // Rows whose miniature the app lists model by model (`isIndividualModels`).
  const individual = new Set(minis.filter((row) => row.isIndividualModels).map((row) => modelName(row.id)!));

  for (const set of dump.groupBy("limited_wargear_choice_set", "datasheetId").get(datasheetId) ?? []) {
    if (set.mandatory) throw new Error(`limited set ${set.id} is mandatory; its meaning is unverified`);
  }
  const groups = dump.groupBy("wargear_option_group", "datasheetId").get(datasheetId) ?? [];
  for (const group of groups) {
    if (group.isStaticWargear) throw new Error(`option group ${group.id} is static wargear; its meaning is unverified`);
  }

  // The default unit's model count per row.
  const defaultComposition = (dump.groupBy("unit_composition", "datasheetId").get(datasheetId) ?? []).find((row) => row.isDefault);
  const defaultModels = new Map<string, number>();
  for (const row of dump.groupBy("unit_composition_miniature", "unitCompositionId").get(defaultComposition?.id ?? "") ?? []) {
    const model = modelName(row.miniatureId);
    if (model) defaultModels.set(model, (defaultModels.get(model) ?? 0) + row.min);
  }

  // Stock: every option with a nonzero default is the default unit's copies of that item.
  const optionsByGroup = dump.groupBy("wargear_option", "wargearOptionGroupId");
  const stockRows = new Map<string, { id: string; count: number }[]>();
  const options: LoadoutOption[] = [];
  for (const group of groups) {
    for (const option of optionsByGroup.get(group.id) ?? []) {
      if (option.inputType !== "checkbox" && option.inputType !== "stepper") {
        throw new Error(`option ${option.id} has input ${option.inputType}; its meaning is unverified`);
      }
      const owner = modelName(group.miniatureId);
      options.push({ ...(owner ? { model: owner } : {}), id: itemId(option.wargearItemId), input: option.inputType, default: option.defaultValue });
      if (!(option.defaultValue > 0)) continue;
      const model = modelName(group.miniatureId) ?? "";
      const rows = stockRows.get(model) ?? [];
      rows.push({ id: itemId(option.wargearItemId), count: option.defaultValue });
      stockRows.set(model, rows);
    }
  }

  const optionById = dump.byId("wargear_option");
  const templateOptions = dump.groupBy("base_miniature_loadout_wargear_option", "baseMiniatureLoadoutId");
  const templates: ModelItems[] = [];
  for (const base of dump.groupBy("base_miniature_loadout", "datasheetId").get(datasheetId) ?? []) {
    const model = modelName(base.miniatureId);
    if (!model) continue;
    const rows = (templateOptions.get(base.id) ?? []).flatMap((row) => {
      const option = optionById.get(row.wargearOptionId);
      return option ? [{ id: itemId(option.wargearItemId), count: row.count }] : [];
    });
    templates.push({ model, items: items(rows) });
  }

  const choiceItems = (rows: readonly { wargearItemId: string; count: number | null }[]) =>
    items(rows.map((row) => ({ id: itemId(row.wargearItemId), count: row.count ?? 1 })));

  const loadoutChoices = dump.groupBy("loadout_choice", "loadoutChoiceSetId");
  const loadoutChoiceItems = dump.groupBy("loadout_choice_wargear_item", "loadoutChoiceId");
  const slots: LoadoutSlot[] = [];
  for (const set of dump.groupBy("loadout_choice_set", "datasheetId").get(datasheetId) ?? []) {
    const model = modelName(set.miniatureId);
    slots.push({
      ...(model ? { model } : {}),
      picks: set.limit,
      repeats: set.allowDuplicates,
      alternate: set.alternate,
      choices: (loadoutChoices.get(set.id) ?? []).map((choice) => choiceItems(loadoutChoiceItems.get(choice.id) ?? [])),
    });
  }

  const limitedChoices = dump.groupBy("limited_wargear_choice", "limitedWargearChoiceSetId");
  const limitedItems = dump.groupBy("limited_wargear_choice_wargear_item", "limitedWargearChoiceId");
  const limitRows = dump.groupBy("wargear_limit", "limitedWargearChoiceSetId");
  const limits: LoadoutLimit[] = [];
  for (const set of dump.groupBy("limited_wargear_choice_set", "datasheetId").get(datasheetId) ?? []) {
    const model = modelName(set.miniatureId);
    const breakpoints = (limitRows.get(set.id) ?? [])
      .map((row) => ({
        models: row.modelCount,
        choices: row.choiceLimit,
        ...(row.duplicateLimit != null ? { per_choice: row.duplicateLimit } : {}),
      }))
      .sort((a, b) => a.models - b.models || a.choices - b.choices);
    if (breakpoints.length === 0) throw new Error(`limited set ${set.id} has no wargear_limit rows`);
    limits.push({
      ...(model ? { model } : {}),
      breakpoints,
      choices: (limitedChoices.get(set.id) ?? []).map((choice) => choiceItems(limitedItems.get(choice.id) ?? [])),
    });
  }

  const uniformChoices = dump.groupBy("all_model_wargear_choice", "allModelWargearChoiceSetId");
  const uniformItems = dump.groupBy("all_model_wargear_choice_wargear_item", "allModelWargearChoiceId");
  const uniform: LoadoutUniform[] = [];
  for (const set of dump.groupBy("all_model_wargear_choice_set", "datasheetId").get(datasheetId) ?? []) {
    const model = modelName(set.miniatureId);
    uniform.push({
      ...(model ? { model } : {}),
      choices: (uniformChoices.get(set.id) ?? []).map((choice) => ({
        items: choiceItems(uniformItems.get(choice.id) ?? []),
        substitute: choice.substitute,
      })),
    });
  }

  if (unresolvedItems.size > 0 || unresolvedModels.size > 0) {
    return { unresolvedItems: [...unresolvedItems].sort(), unresolvedModels: [...unresolvedModels].sort() };
  }
  // Sorted throughout so a re-run over the same dump writes byte-identical data.
  const sortRows = <T>(rows: T[]) => rows.sort((a, b) => byKey(a).localeCompare(byKey(b)));
  for (const slot of slots) sortRows(slot.choices);
  for (const limit of limits) sortRows(limit.choices);
  for (const set of uniform) sortRows(set.choices);
  return {
    loadout: {
      // A row keyed "" is wargear the unit takes once, with no model of its own.
      stock: sortRows([...new Set([...defaultModels.keys(), ...stockRows.keys()])].map((model) => ({
        ...(model ? { model } : {}),
        models: model ? defaultModels.get(model) ?? 0 : 0,
        items: items(stockRows.get(model) ?? []),
        ...(model && individual.has(model) ? { individual: true as const } : {}),
      }))),
      templates: sortRows(templates),
      slots: sortRows(slots),
      limits: sortRows(limits),
      options: sortRows(options),
      uniform: sortRows(uniform),
    },
  };
}

export interface LoadoutLiftReport {
  dirs: { dir: string; matched: number; lifted: number; skipped: { unitId: string; items: string[]; models: string[] }[] }[];
  staged: StagedWrite[];
}

interface CompositionRecord {
  unit_id: string;
  models: { name: string }[];
  loadout?: MfmLoadout;
}

/**
 * Writes {@link liftLoadout} onto each dump-backed unit's `unit-compositions.json` record, matching
 * datasheets to repo units the same way the wargear pass does (home faction first) and resolving
 * items with the same resolver, so the ids match the unit's existing loadout data.
 */
export function runLoadoutLift(dump: MfmDump, onlyDir?: string): LoadoutLiftReport {
  const dirs = repoDirs();
  const byDir = new Map<string, DatasheetRow[]>();
  for (const ds of dump.table("datasheet")) {
    if (ds.isLegends) continue;
    for (const dir of candidateDirs(dump, ds)) {
      if (!dirs.has(dir)) continue;
      (byDir.get(dir) ?? byDir.set(dir, []).get(dir)!).push(ds);
    }
  }
  const report: LoadoutLiftReport = { dirs: [], staged: [] };
  for (const dir of [...dirs].sort()) {
    if (onlyDir && dir !== onlyDir) continue;
    const compositionPath = path.join(CORE_DIR, dir, "unit-compositions.json");
    if (!fs.existsSync(compositionPath)) continue;
    const compositions = readJsonArray<CompositionRecord>(compositionPath);
    const byUnit = new Map(compositions.map((record) => [record.unit_id, record]));

    const validIds = new Set<string>();
    for (const file of ["weapons.json", "wargear.json"]) {
      const filePath = path.join(CORE_DIR, dir, file);
      if (fs.existsSync(filePath)) for (const record of readJsonArray<{ id?: string }>(filePath)) if (record.id) validIds.add(record.id);
    }
    const sharedWargear = path.join(CORE_DIR, "wargear.json");
    if (fs.existsSync(sharedWargear)) for (const record of readJsonArray<{ id?: string }>(sharedWargear)) if (record.id) validIds.add(record.id);
    for (const unit of readJsonArray<{ weapon_ids?: string[] }>(path.join(CORE_DIR, dir, "units.json"))) {
      for (const id of unit.weapon_ids ?? []) validIds.add(id);
    }
    const audit: AutoResolution[] = [];
    const resolve = makeResolver(validIds, audit, WEAPON_ALIASES[dir] ?? {});

    const matchedUnits = new Set<string>();
    const dirReport = { dir, matched: 0, lifted: 0, skipped: [] as LoadoutLiftReport["dirs"][number]["skipped"] };
    let changed = false;
    const datasheets = (byDir.get(dir) ?? []).slice().sort((a, b) => homeScore(dump, a, dir) - homeScore(dump, b, dir));
    for (const ds of datasheets) {
      const name = dump.enName(ds);
      if (!name) continue;
      let unitId: string;
      try {
        unitId = nameToId(name);
      } catch {
        continue;
      }
      const record = byUnit.get(unitId);
      if (!record || matchedUnits.has(unitId)) continue;
      matchedUnits.add(unitId);
      dirReport.matched++;
      const before = byKey(record.loadout ?? null);
      const result = liftLoadout(dump, ds.id!, unitScopedResolver(validIds, audit, dir, unitId, resolve), record.models.reduce((rows, model) => rows.set(model.name, (rows.get(model.name) ?? 0) + 1), new Map<string, number>()));
      if ("loadout" in result) {
        record.loadout = result.loadout;
        dirReport.lifted++;
      } else {
        delete record.loadout;
        dirReport.skipped.push({ unitId, items: result.unresolvedItems, models: result.unresolvedModels });
      }
      if (byKey(record.loadout ?? null) !== before) changed = true;
    }
    if (changed) report.staged.push({ path: compositionPath, value: compositions });
    report.dirs.push(dirReport);
  }
  return report;
}
