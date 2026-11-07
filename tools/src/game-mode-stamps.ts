/**
 * `game_modes` on records whose mode follows from the records that use them, within one faction
 * directory of `data/core/`:
 *
 *  - a wargear option is in its unit's modes;
 *  - a weapon is in every mode of the units that carry it, take it through a wargear option, or
 *    equip it by default in a unit composition;
 *  - a stratagem is in its detachment's modes.
 *
 * An absent `game_modes` means matched play only, so a record used only by matched-play records
 * carries none. A record nothing uses keeps what it has.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ValidationResult } from "./validate.js";

/** The schema's game-mode ids, in the order a stamp lists them. */
export const GAME_MODE_ORDER = ["matched-play", "combat-patrol", "boarding-actions", "crusade"] as const;

type Rec = Record<string, unknown>;

/** One faction directory's records, by file. Absent files are absent collections. */
export type FactionCore = {
  units?: Rec[];
  weapons?: Rec[];
  wargearOptions?: Rec[];
  stratagems?: Rec[];
  detachments?: Rec[];
  compositions?: Rec[];
};

/** The files {@link FactionCore} reads, by collection. */
export const STAMP_FILES = {
  units: "units.json",
  weapons: "weapons.json",
  wargearOptions: "wargear-options.json",
  stratagems: "stratagems.json",
  detachments: "detachments.json",
  compositions: "unit-compositions.json",
} as const;

/** A collection a stamp writes to. */
export type StampedCollection = "weapons" | "wargearOptions" | "stratagems";

/** One record whose stamp differs from the modes the records that use it give. */
export type StampDrift = { collection: StampedCollection; id: string; current: string[]; derived: string[] };

const modesOf = (record: Rec | undefined): string[] => {
  const modes = record?.game_modes;
  return Array.isArray(modes) && modes.length > 0 ? modes.filter((mode): mode is string => typeof mode === "string") : ["matched-play"];
};

function ordered(modes: Iterable<string>): string[] {
  const set = new Set(modes);
  const known = GAME_MODE_ORDER.filter((mode) => set.has(mode));
  return [...known, ...[...set].filter((mode) => !(GAME_MODE_ORDER as readonly string[]).includes(mode)).sort()];
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((mode, index) => mode === b[index]);

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);

/** The weapon ids a wargear option swaps out or offers. */
function optionWeaponIds(option: Rec): string[] {
  const out = [...strings(option.replaces), ...strings(option.replacement)];
  for (const group of Array.isArray(option.replacement_choice) ? option.replacement_choice : []) {
    for (const id of Array.isArray(group) ? group : []) if (typeof id === "string") out.push(id);
  }
  return out;
}

/** The modes each stamped record should carry, by collection and id; a record nothing uses is absent. */
function derivedModes(core: FactionCore): Record<StampedCollection, Map<string, string[]>> {
  const unitModes = new Map<string, string[]>();
  for (const unit of core.units ?? []) if (typeof unit.id === "string") unitModes.set(unit.id, ordered([...(unitModes.get(unit.id) ?? []), ...modesOf(unit)]));
  const weaponUsers = new Map<string, Set<string>>();
  const use = (weaponId: string, modes: readonly string[]) => {
    const set = weaponUsers.get(weaponId) ?? new Set<string>();
    for (const mode of modes) set.add(mode);
    weaponUsers.set(weaponId, set);
  };
  for (const unit of core.units ?? []) {
    for (const id of Array.isArray(unit.weapon_ids) ? unit.weapon_ids : []) if (typeof id === "string") use(id, modesOf(unit));
  }
  const options = new Map<string, string[]>();
  for (const option of core.wargearOptions ?? []) {
    const modes = typeof option.unit_id === "string" ? unitModes.get(option.unit_id) : undefined;
    if (!modes) continue;
    if (typeof option.id === "string") options.set(option.id, modes);
    for (const id of optionWeaponIds(option)) use(id, modes);
  }
  for (const composition of core.compositions ?? []) {
    const modes = (typeof composition.unit_id === "string" ? unitModes.get(composition.unit_id) : undefined) ?? modesOf(composition);
    for (const model of Array.isArray(composition.models) ? (composition.models as Rec[]) : []) {
      for (const id of strings(model.default_weapon_ids)) use(id, modes);
    }
  }
  const detachmentModes = new Map<string, string[]>();
  for (const detachment of core.detachments ?? []) if (typeof detachment.id === "string") detachmentModes.set(detachment.id, modesOf(detachment));
  const stratagems = new Map<string, string[]>();
  for (const stratagem of core.stratagems ?? []) {
    const modes = typeof stratagem.detachment_id === "string" ? detachmentModes.get(stratagem.detachment_id) : undefined;
    if (modes && typeof stratagem.id === "string") stratagems.set(stratagem.id, modes);
  }
  return {
    weapons: new Map([...weaponUsers].map(([id, modes]) => [id, ordered(modes)])),
    wargearOptions: options,
    stratagems,
  };
}

/** Every record in `core` whose `game_modes` differs from the modes the records that use it give. */
export function gameModeDrift(core: FactionCore): StampDrift[] {
  const derived = derivedModes(core);
  const out: StampDrift[] = [];
  for (const collection of ["weapons", "wargearOptions", "stratagems"] as const) {
    for (const record of core[collection] ?? []) {
      const want = typeof record.id === "string" ? derived[collection].get(record.id) : undefined;
      if (!want) continue;
      const current = modesOf(record);
      if (!same(current, want)) out.push({ collection, id: record.id as string, current, derived: want });
    }
  }
  return out;
}

/**
 * Stamp `core` in place: each record a stamp covers gets the modes the records that use it give,
 * or loses `game_modes` when that is matched play only. Returns the collections it changed.
 */
export function stampGameModes(core: FactionCore): Set<StampedCollection> {
  const derived = derivedModes(core);
  const changed = new Set<StampedCollection>();
  for (const collection of ["weapons", "wargearOptions", "stratagems"] as const) {
    for (const record of core[collection] ?? []) {
      const want = typeof record.id === "string" ? derived[collection].get(record.id) : undefined;
      if (!want || same(modesOf(record), want)) continue;
      if (same(want, ["matched-play"])) delete record.game_modes;
      else record.game_modes = [...want];
      changed.add(collection);
    }
  }
  return changed;
}

/**
 * Read one faction directory's records through `read` (file name → text, or undefined when absent).
 * A file that is not a JSON array is left out: schema validation reports it.
 */
export function readFactionCore(read: (file: string) => string | undefined): FactionCore {
  const core: FactionCore = {};
  for (const [collection, file] of Object.entries(STAMP_FILES) as [keyof FactionCore, string][]) {
    const text = read(file);
    if (text === undefined) continue;
    let records: unknown;
    try {
      records = JSON.parse(text);
    } catch {
      continue;
    }
    if (Array.isArray(records)) core[collection] = records.filter((record): record is Rec => typeof record === "object" && record !== null && !Array.isArray(record));
  }
  return core;
}

/** The faction directories under `data/core/` (directories starting with `_` excluded). */
export function factionCoreDirs(dataRoot: string): string[] {
  const core = join(dataRoot, "core");
  if (!existsSync(core)) return [];
  return readdirSync(core, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => join(core, entry.name))
    .sort();
}

/** Stamp every faction directory under `dataRoot` on disk when `write`; returns the files that drift. */
export function stampDataRoot(dataRoot: string, write: boolean): string[] {
  const drifted: string[] = [];
  for (const dir of factionCoreDirs(dataRoot)) {
    const core = readFactionCore((file) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : undefined));
    for (const collection of stampGameModes(core)) {
      const path = join(dir, STAMP_FILES[collection]);
      drifted.push(path);
      if (write) writeFileSync(path, JSON.stringify(core[collection], null, 2) + "\n");
    }
  }
  return drifted;
}

/**
 * Integrity: every stamped record's `game_modes` matches the modes the records that use it give,
 * so a Combat Patrol record never lists in matched play and a weapon a Combat Patrol unit carries
 * lists in Combat Patrol. `npm run stamp:game-modes -- --write` repairs a drift.
 */
export function checkGameModeStamps(root: string, result: ValidationResult): void {
  for (const dir of factionCoreDirs(root)) {
    const texts = new Map<string, string>();
    const core = readFactionCore((file) => {
      const path = join(dir, file);
      if (!existsSync(path)) return undefined;
      const text = readFileSync(path, "utf8");
      texts.set(file, text);
      return text;
    });
    for (const drift of gameModeDrift(core)) {
      const records = core[drift.collection] ?? [];
      const index = records.findIndex((record) => record.id === drift.id);
      result.failed++;
      result.errors.push({
        file: join(dir, STAMP_FILES[drift.collection]),
        index,
        errors: [{
          path: `/${index}/game_modes`,
          message: `"${drift.id}" lists in ${drift.current.join(", ")}, but the records that use it are in ${drift.derived.join(", ")}; run \`npm run stamp:game-modes -- --write\``,
        }],
      });
    }
  }
}
