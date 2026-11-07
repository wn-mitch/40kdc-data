/**
 * A unit-filter's `model_names` names model profiles exactly as unit compositions print them
 * (`core/<faction>/unit-compositions.json` models[].name). Each name must be a model some unit can
 * field: for a filter over the ability's own unit (member_of this-unit or ability-unit), one of the
 * units the record lists in unit_ids; for a friendly or unowned filter, a unit of the ability's
 * faction or its shared-roster parents; for an enemy filter, a unit of any faction. Run as part of
 * `checkReferentialIntegrity`, so a typo or a renamed model fails validation.
 */

import { readFileSync } from "node:fs";
import { glob } from "glob";
import { basename, dirname } from "node:path";
import type { ValidationResult } from "./validate.js";
import { SHARED_ROSTERS } from "./mfm/faction-map.js";

type Composition = { unit_id?: unknown; models?: Array<{ name?: unknown }> };

/** The roles that name the unit carrying the ability. */
const OWN_UNIT = new Set(["this-unit", "ability-unit"]);

/** Model names by faction directory and unit id. */
async function compositionModels(root: string): Promise<Map<string, Map<string, Set<string>>>> {
  const byFaction = new Map<string, Map<string, Set<string>>>();
  for (const file of await glob("core/*/unit-compositions.json", { cwd: root, absolute: true })) {
    const faction = basename(dirname(file));
    if (faction.startsWith("_")) continue;
    const units = new Map<string, Set<string>>();
    try {
      for (const record of JSON.parse(readFileSync(file, "utf8")) as Composition[]) {
        if (typeof record.unit_id !== "string") continue;
        const names = units.get(record.unit_id) ?? new Set<string>();
        for (const model of record.models ?? []) if (typeof model.name === "string") names.add(model.name);
        units.set(record.unit_id, names);
      }
    } catch {
      continue; // unreadable: reported by schema validation
    }
    byFaction.set(faction, units);
  }
  return byFaction;
}

/** Every unit-filter that names models, at any depth of a record. */
export function modelNameFilters(value: unknown, found: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) modelNameFilters(item, found);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.model_names)) found.push(record);
    for (const child of Object.values(record)) modelNameFilters(child, found);
  }
  return found;
}

export async function checkModelNames(root: string, result: ValidationResult): Promise<void> {
  const models = await compositionModels(root);
  const union = (units: Iterable<Set<string>>): Set<string> => new Set([...units].flatMap((names) => [...names]));
  const anyFaction = union([...models.values()].flatMap((units) => [...units.values()]));
  const files = await glob("enrichment/*/abilities.json", { cwd: root, absolute: true });
  for (const file of files.sort()) {
    const faction = basename(dirname(file));
    if (faction.startsWith("_")) continue;
    let records: Array<Record<string, unknown>>;
    try {
      records = JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
    } catch {
      continue; // unreadable: reported by schema validation
    }
    const factionUnits = [faction, ...(SHARED_ROSTERS[faction] ?? [])].map((dir) => models.get(dir) ?? new Map<string, Set<string>>());
    const ownFaction = union(factionUnits.flatMap((units) => [...units.values()]));
    let fileCounted = false;
    records.forEach((record, index) => {
      const filters = modelNameFilters(record);
      // Only records that name models are counted, so unrelated records leave the totals unchanged.
      if (filters.length === 0) return;
      if (!fileCounted) {
        result.totalFiles++;
        fileCounted = true;
      }
      result.totalItems++;
      const unitIds = Array.isArray(record.unit_ids) ? record.unit_ids.filter((id): id is string => typeof id === "string") : [];
      const ownUnits = union(unitIds.flatMap((id) => factionUnits.map((units) => units.get(id) ?? new Set<string>())));
      const errors: Array<{ path: string; message: string }> = [];
      for (const filter of filters) {
        const ownUnit = typeof filter.member_of === "string" && OWN_UNIT.has(filter.member_of) && unitIds.length > 0;
        const known = ownUnit ? ownUnits : filter.owner === "enemy" ? anyFaction : ownFaction;
        const where = ownUnit ? `the units carrying it (${unitIds.join(", ")})` : filter.owner === "enemy" ? "any faction's units" : `${faction}'s units`;
        for (const name of filter.model_names as unknown[]) {
          if (typeof name !== "string" || known.has(name)) continue;
          errors.push({ path: `/${index}`, message: `ability "${String(record.ability_id)}" names model "${name}", which is not a model of ${where} in unit-compositions.json` });
        }
      }
      if (errors.length === 0) {
        result.passed++;
        return;
      }
      result.failed++;
      result.errors.push({ file, index, errors });
    });
  }
}
