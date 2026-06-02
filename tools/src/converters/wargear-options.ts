/**
 * Build wargear-option and wargear entities for one faction from army-assist's
 * prose option table. Ties together the {@link parseOption} prose parser and the
 * numeric→UUID {@link bridgeOptionsToUnits} bridge, then resolves the parsed
 * weapon/wargear *names* to entity ids against the faction's own weapon registry
 * (a name that is not a known weapon becomes a non-weapon `wargear` item).
 *
 * Anything that does not resolve cleanly — an unbridged datasheet, a prose line
 * the parser rejects, an ambiguous unit match — is collected in `unparsed` for
 * the caller to write to a report rather than dropped silently or guessed.
 */
import { nameToId } from "./id-generator.js";
import { parseOption, type ParsedConstraint } from "./option-parser.js";
import {
  bridgeOptionsToUnits,
  modelNameFromComposition,
  normModelName,
} from "./option-bridge.js";

interface SourceOption {
  datasheet_id: string; // numeric
  line: string;
  description: string | null;
}
interface SourceComposition {
  datasheet_id: string; // numeric
  line: string;
  description: string;
}
interface SourceModel {
  datasheet_id: string; // UUID
  name: string;
}

interface GameVersion {
  edition: string;
  dataslate: string;
}

export interface WargearEntity {
  id: string;
  name: string;
  category?: string;
  game_version: GameVersion;
}

export interface WargearOptionEntity {
  id: string;
  unit_id: string;
  model_constraint?: ParsedConstraint;
  replaces?: string[];
  replacement?: string[];
  replacement_choice?: string[][];
  is_free: boolean;
  game_version: GameVersion;
}

export interface UnparsedOption {
  unit_id: string | null;
  datasheet: string;
  line: string;
  description: string | null;
  reason: string;
}

export interface BuildWargearResult {
  wargearOptions: WargearOptionEntity[];
  wargear: WargearEntity[];
  unparsed: UnparsedOption[];
}

/** Guess a coarse category for a non-weapon item from its name. */
function categorize(name: string): string | undefined {
  const n = name.toLowerCase();
  if (n.includes("icon")) return "icon";
  if (n.includes("standard") || n.includes("banner")) return "standard";
  if (n.includes("token")) return "token";
  return undefined;
}

/** Drop empty fields from a parsed constraint; return undefined if nothing left. */
function cleanConstraint(c: ParsedConstraint): ParsedConstraint | undefined {
  const out: ParsedConstraint = {};
  if (c.model_name) out.model_name = c.model_name;
  if (c.per_n_models) out.per_n_models = c.per_n_models;
  if (c.max_count) out.max_count = c.max_count;
  if (c.any_number) out.any_number = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildWargearOptions(
  factionDatasheets: readonly { id: string; name: string }[],
  allModels: readonly SourceModel[],
  allOptions: readonly SourceOption[],
  allComposition: readonly SourceComposition[],
  unitWeaponIds: Map<string, Set<string>>, // UUID → weapon ids on that unit
  globalWeaponIds: Set<string>, // every weapon id in the faction
  gameVersion: GameVersion,
): BuildWargearResult {
  const factionUuids = factionDatasheets.map((d) => d.id);
  const factionUuidSet = new Set(factionUuids);
  const nameByUuid = new Map(factionDatasheets.map((d) => [d.id, d.name]));

  // UUID → normalized model-name set (numeric-side bridge target).
  const modelsByUuid = new Map<string, Set<string>>();
  for (const m of allModels) {
    if (!factionUuidSet.has(m.datasheet_id)) continue;
    let set = modelsByUuid.get(m.datasheet_id);
    if (!set) modelsByUuid.set(m.datasheet_id, (set = new Set()));
    set.add(normModelName(m.name));
  }

  // numeric → normalized model-name set (from composition descriptions).
  const compByNumeric = new Map<string, Set<string>>();
  for (const c of allComposition) {
    let set = compByNumeric.get(c.datasheet_id);
    if (!set) compByNumeric.set(c.datasheet_id, (set = new Set()));
    set.add(modelNameFromComposition(c.description));
  }

  // numeric → its option rows.
  const optionsByNumeric = new Map<string, SourceOption[]>();
  for (const o of allOptions) {
    let rows = optionsByNumeric.get(o.datasheet_id);
    if (!rows) optionsByNumeric.set(o.datasheet_id, (rows = []));
    rows.push(o);
  }

  const { byNumeric, ambiguous } = bridgeOptionsToUnits(
    factionUuids,
    modelsByUuid,
    compByNumeric,
    optionsByNumeric.keys(),
  );

  // Shared units appear under several numeric ids (faction "views"); merge each
  // UUID's option rows, deduped by description text, so we emit options once.
  const rowsByUuid = new Map<string, SourceOption[]>();
  for (const [numericId, uuid] of byNumeric) {
    const seen = new Set(rowsByUuid.get(uuid)?.map((r) => r.description ?? ""));
    const rows = rowsByUuid.get(uuid) ?? [];
    for (const r of optionsByNumeric.get(numericId) ?? []) {
      const key = r.description ?? "";
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(r);
    }
    rowsByUuid.set(uuid, rows);
  }

  const wargearOptions: WargearOptionEntity[] = [];
  const wargearById = new Map<string, WargearEntity>();
  const unparsed: UnparsedOption[] = [];

  const MAX_LEN = 128; // entity-id / name schema maxLength
  // Resolve a name to an id, queuing any new non-weapon item into `pending`
  // (committed by the caller only once the whole option resolves, so a later
  // failure can't leave an orphan wargear entity behind). Throws on a name that
  // can't form a valid, in-bounds entity — the caller reports it.
  const resolveName = (
    name: string,
    weaponIds: Set<string>,
    pending: Map<string, WargearEntity>,
  ): string => {
    if (name.length > MAX_LEN) throw new Error(`name too long: ${name.slice(0, 40)}…`);
    const id = nameToId(name); // throws on a name with no id-safe characters
    if (id.length > MAX_LEN) throw new Error(`id too long: ${id.slice(0, 40)}…`);
    if (weaponIds.has(id) || globalWeaponIds.has(id)) return id;
    if (!wargearById.has(id) && !pending.has(id)) {
      const entity: WargearEntity = { id, name, game_version: gameVersion };
      const category = categorize(name);
      if (category) entity.category = category;
      pending.set(id, entity);
    }
    return id;
  };

  for (const [uuid, rows] of rowsByUuid) {
    const unitName = nameByUuid.get(uuid)!;
    const unitId = nameToId(unitName);
    const weaponIds = unitWeaponIds.get(uuid) ?? new Set<string>();

    for (const row of rows.sort((a, b) => Number(a.line) - Number(b.line))) {
      const result = parseOption(row.description);
      if (result.ok === "skip") continue;
      if (result.ok === false) {
        unparsed.push({
          unit_id: unitId,
          datasheet: unitName,
          line: row.line,
          description: row.description,
          reason: result.reason,
        });
        continue;
      }
      const o = result.option;
      const entity: WargearOptionEntity = {
        id: `${unitId}-${o.kind}-${row.line}`,
        unit_id: unitId,
        is_free: true,
        game_version: gameVersion,
      };
      const constraint = cleanConstraint(o.constraint);
      if (constraint) entity.model_constraint = constraint;
      const pending = new Map<string, WargearEntity>();
      try {
        if (o.replaces.length > 0) {
          entity.replaces = o.replaces.map((n) => resolveName(n, weaponIds, pending));
        }
        if (o.replacement) {
          entity.replacement = o.replacement.map((n) => resolveName(n, weaponIds, pending));
        }
        if (o.replacement_choice) {
          entity.replacement_choice = o.replacement_choice.map((g) =>
            g.map((n) => resolveName(n, weaponIds, pending)),
          );
        }
      } catch (err) {
        // A name that can't form a valid, in-bounds entity id (stray
        // punctuation, an over-captured clause): report it rather than abort the
        // faction, and discard any pending wargear so no orphan is emitted.
        unparsed.push({
          unit_id: unitId,
          datasheet: unitName,
          line: row.line,
          description: row.description,
          reason: `name resolution failed: ${(err as Error).message}`,
        });
        continue;
      }
      for (const [id, w] of pending) wargearById.set(id, w);
      wargearOptions.push(entity);
    }
  }

  for (const numericId of ambiguous) {
    for (const row of optionsByNumeric.get(numericId) ?? []) {
      unparsed.push({
        unit_id: null,
        datasheet: `numeric:${numericId}`,
        line: row.line,
        description: row.description,
        reason: "ambiguous unit match (model names tie across datasheets)",
      });
    }
  }

  return {
    wargearOptions,
    wargear: [...wargearById.values()],
    unparsed,
  };
}
