import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { applyWrites, type StagedWrite } from "./mfm/apply.js";
import { CORE_DIR, readJsonArray } from "./mfm/repo-files.js";

// The inventory is intentionally private because `abilities` carries source prose.
type Json = Record<string, unknown>;
type EntityName = keyof typeof ENTITY_FILES;
type ReviewKind = "unit" | "detachment" | "faction";
type ReviewStatus = "exact" | "not-on-card" | "blocked-source";

const ENTITY_FILES = {
  factions: "factions.json",
  units: "units.json",
  weapons: "weapons.json",
  unit_compositions: "unit-compositions.json",
  wargear: "wargear.json",
  wargear_options: "wargear-options.json",
  leader_attachments: "leader-attachments.json",
  detachments: "detachments.json",
  enhancements: "enhancements.json",
  stratagems: "stratagems.json",
} as const;

const REQUIRED_REVIEW_FIELDS: Record<ReviewKind, readonly string[]> = {
  unit: [
    "profile", "invulnerable_save", "weapons", "core_labels", "army_rules",
    "named_abilities", "wargear_options", "composition", "default_equipment",
    "transport_capacity", "keywords", "attachment_role", "eligible_bodyguards",
    "points", "base_size",
  ],
  detachment: ["metadata", "detachment_rule", "enhancements", "stratagems"],
  faction: ["army_rule"],
};

interface ReviewField {
  status: ReviewStatus;
  source_ref: string;
  evidence_region: string;
}

interface Review {
  kind: ReviewKind;
  id: string;
  source_refs: string[];
  fields: Record<string, ReviewField>;
}

export interface CodexInventory {
  faction_id: string;
  game_version: { edition: string; dataslate: string };
  source_revision: number;
  sources: { id: string; path: string; page: number; sha256: string }[];
  coverage: { unit_ids: string[]; detachment_ids: string[] };
  reviews: Review[];
  entities: Record<EntityName, Json[]>;
  abilities: Json[];
  retire?: Partial<Record<EntityName, string[]>>;
}

export interface SnapshotScope {
  faction_id: string;
  game_version: { edition: string; dataslate: string };
  unit_ids: string[];
  detachment_ids: string[];
}

export interface AuthorManifest {
  records: Json[];
  replace_scope: SnapshotScope;
}

export interface ReconciliationReport {
  faction_id: string;
  game_version: { edition: string; dataslate: string };
  source_revision: number;
  blend_matrix: Record<EntityName, Record<string, number>>;
  buckets: Record<"current" | "update" | "missing-repository" | "repository-only" | "blocked-source", Json[]>;
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));
const asObject = (value: unknown, label: string): Json => {
  if (value == null || Array.isArray(value) || typeof value !== "object") throw new Error(`${label} must be an object`);
  return value as Json;
};
const asArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
};
const string = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
};

function entityKey(name: EntityName, entity: Json): string {
  if (name === "unit_compositions") return string(entity.unit_id, `${name}.unit_id`);
  if (name === "leader_attachments") return string(entity.leader_id, `${name}.leader_id`);
  return string(entity.id, `${name}.id`);
}

function duplicateKeys(name: EntityName, rows: Json[]): string[] {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const row of rows) {
    const key = entityKey(name, row);
    const serialized = JSON.stringify(row);
    const previous = seen.get(key);
    if (previous != null && previous !== serialized) duplicates.push(key);
    else seen.set(key, serialized);
  }
  return duplicates;
}

function assertNoIllegible(value: unknown, label: string): void {
  if (typeof value === "string" && /illegible|unreadable|unclear/i.test(value)) {
    throw new Error(`${label} is marked exact but contains unresolved source text`);
  }
  if (Array.isArray(value)) value.forEach((item, index) => assertNoIllegible(item, `${label}[${index}]`));
  else if (value != null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertNoIllegible(item, `${label}.${key}`);
  }
}

function sourceSet(inventory: CodexInventory): Set<string> {
  return new Set(inventory.sources.map((source) => source.id));
}

function sourceRefExists(ref: string, sources: Set<string>): boolean {
  return ref === "mfm" || sources.has(ref);
}

/** Validate source-review completeness before any current data is read or changed. */
export function validateInventory(inventory: CodexInventory): void {
  if (!inventory.faction_id) throw new Error("inventory.faction_id is required");
  if (!inventory.game_version?.edition || !inventory.game_version?.dataslate) throw new Error("inventory.game_version is required");
  if (!Number.isInteger(inventory.source_revision)) throw new Error("inventory.source_revision must be an integer");
  if (new Set(inventory.coverage.unit_ids).size !== inventory.coverage.unit_ids.length) throw new Error("coverage.unit_ids contains duplicates");
  if (new Set(inventory.coverage.detachment_ids).size !== inventory.coverage.detachment_ids.length) throw new Error("coverage.detachment_ids contains duplicates");
  const sources = sourceSet(inventory);
  if (sources.size !== inventory.sources.length || sources.size === 0) throw new Error("sources must have unique ids");
  for (const source of inventory.sources) {
    if (!source.path || !Number.isInteger(source.page) || !/^[a-f0-9]{64}$/i.test(source.sha256)) {
      throw new Error(`invalid source record: ${JSON.stringify(source)}`);
    }
  }

  const reviews = new Map<string, Review>();
  for (const review of inventory.reviews) {
    const key = `${review.kind}:${review.id}`;
    if (reviews.has(key)) throw new Error(`duplicate review: ${key}`);
    reviews.set(key, review);
    if (!REQUIRED_REVIEW_FIELDS[review.kind]) throw new Error(`unknown review kind: ${review.kind}`);
    for (const ref of review.source_refs) if (!sourceRefExists(ref, sources)) throw new Error(`unknown review source: ${ref}`);
    for (const field of REQUIRED_REVIEW_FIELDS[review.kind]) {
      const disposition = review.fields[field];
      if (!disposition) throw new Error(`review ${key} omits required field: ${field}`);
      if (!(["exact", "not-on-card", "blocked-source"] as const).includes(disposition.status)) {
        throw new Error(`review ${key}.${field} has an invalid status`);
      }
      if (!sourceRefExists(disposition.source_ref, sources)) throw new Error(`review ${key}.${field} has an unknown source`);
      if (!disposition.evidence_region) throw new Error(`review ${key}.${field} lacks evidence_region`);
    }
  }
  for (const unitId of inventory.coverage.unit_ids) if (!reviews.has(`unit:${unitId}`)) throw new Error(`covered unit lacks review: ${unitId}`);
  for (const detachmentId of inventory.coverage.detachment_ids) if (!reviews.has(`detachment:${detachmentId}`)) throw new Error(`covered detachment lacks review: ${detachmentId}`);

  for (const name of Object.keys(ENTITY_FILES) as EntityName[]) {
    const rows = inventory.entities[name];
    if (!Array.isArray(rows)) throw new Error(`entities.${name} must be an array`);
    const duplicates = duplicateKeys(name, rows);
    if (duplicates.length) throw new Error(`entities.${name} has conflicting duplicate ids: ${duplicates.join(", ")}`);
  }
  const coveredUnits = new Set(inventory.coverage.unit_ids);
  const suppliedUnits = new Map(inventory.entities.units.map((unit) => [string(unit.id, "unit.id"), unit]));
  const suppliedWeapons = new Set(inventory.entities.weapons.map((weapon) => string(weapon.id, "weapon.id")));
  const abilityIds = new Set(inventory.abilities.map((ability) => string(ability.ability_id, "ability.ability_id")));
  for (const unitId of coveredUnits) {
    const unit = suppliedUnits.get(unitId);
    if (!unit) throw new Error(`covered unit lacks entity data: ${unitId}`);
    if (!inventory.entities.unit_compositions.some((composition) => composition.unit_id === unitId)) throw new Error(`covered unit lacks composition/default loadout: ${unitId}`);
    for (const weaponId of asArray(unit.weapon_ids, `unit ${unitId}.weapon_ids`)) {
      if (!suppliedWeapons.has(string(weaponId, `unit ${unitId}.weapon_ids`))) throw new Error(`covered unit has unresolved weapon ${weaponId} (${unitId})`);
    }
    for (const abilityId of asArray(unit.ability_ids, `unit ${unitId}.ability_ids`)) {
      if (!abilityIds.has(string(abilityId, `unit ${unitId}.ability_ids`))) throw new Error(`covered unit has unresolved ability ${abilityId} (${unitId})`);
    }
  }
  const suppliedDetachments = new Map(inventory.entities.detachments.map((row) => [string(row.id, "detachment.id"), row]));
  const assertRoster = (
    detachmentId: string,
    detachment: Json,
    entityName: "enhancements" | "stratagems",
    rosterField: "enhancement_ids" | "stratagem_ids",
  ): void => {
    const label = entityName === "enhancements" ? "enhancement" : "stratagem";
    const expected = asArray(detachment[rosterField], `detachment ${detachmentId}.${rosterField}`)
      .map((id) => string(id, `detachment ${detachmentId}.${rosterField}`))
      .sort();
    const supplied = inventory.entities[entityName]
      .filter((row) => row.detachment_id === detachmentId)
      .map((row) => string(row.id, `${label}.id`))
      .sort();
    if (JSON.stringify(supplied) !== JSON.stringify(expected)) {
      throw new Error(`covered detachment ${label} roster mismatch: ${detachmentId}`);
    }
    for (const row of inventory.entities[entityName].filter((candidate) => candidate.detachment_id === detachmentId)) {
      const abilityId = string(row.ability_id, `${label} ${row.id}.ability_id`);
      if (!abilityIds.has(abilityId)) throw new Error(`covered detachment has unresolved ${label} ability ${abilityId}`);
    }
  };
  for (const detachmentId of inventory.coverage.detachment_ids) {
    const detachment = suppliedDetachments.get(detachmentId);
    if (!detachment) throw new Error(`covered detachment lacks entity data: ${detachmentId}`);
    for (const ruleId of asArray(detachment.detachment_rule_ids, `detachment ${detachmentId}.detachment_rule_ids`)) {
      if (!abilityIds.has(string(ruleId, `detachment ${detachmentId}.detachment_rule_ids`))) throw new Error(`covered detachment has unresolved rule ${ruleId}`);
    }
    if (reviewFieldIsExact(inventory, "detachment", detachmentId, "enhancements")) {
      assertRoster(detachmentId, detachment, "enhancements", "enhancement_ids");
    }
    if (reviewFieldIsExact(inventory, "detachment", detachmentId, "stratagems")) {
      assertRoster(detachmentId, detachment, "stratagems", "stratagem_ids");
    }
  }
  for (const name of Object.keys(ENTITY_FILES) as EntityName[]) {
    for (const row of inventory.entities[name]) assertNoIllegible(row, `entities.${name}`);
  }
  for (const ability of inventory.abilities) {
    if (!ability.ability_id) throw new Error("ability record lacks ability_id");
    if (ability.source_kind === "image") assertNoIllegible(ability.raw_text, `ability ${ability.ability_id}`);
  }
}

export function authorManifest(inventory: CodexInventory): AuthorManifest {
  return {
    records: inventory.abilities,
    replace_scope: {
      faction_id: inventory.faction_id,
      game_version: inventory.game_version,
      unit_ids: inventory.coverage.unit_ids,
      detachment_ids: inventory.coverage.detachment_ids,
    },
  };
}

function currentFaction(inventory: CodexInventory): Record<EntityName, Json[]> {
  const dir = path.join(CORE_DIR, inventory.faction_id);
  const entries = Object.entries(ENTITY_FILES).map(([name, file]) => [name, readJsonArray<Json>(path.join(dir, file))]);
  return Object.fromEntries(entries) as Record<EntityName, Json[]>;
}

function replaceByKey(name: EntityName, current: Json[], supplied: Json[]): Json[] {
  const replacements = new Map(supplied.map((row) => [entityKey(name, row), row]));
  return [...current.filter((row) => !replacements.has(entityKey(name, row))), ...supplied];
}

function reviewFieldIsExact(
  inventory: CodexInventory,
  kind: ReviewKind,
  id: string,
  field: string,
): boolean {
  return inventory.reviews.find((review) => review.kind === kind && review.id === id)
    ?.fields[field]?.status === "exact";
}

function exactReviewIds(inventory: CodexInventory, kind: ReviewKind, field: string): Set<string> {
  return new Set(inventory.reviews
    .filter((review) => review.kind === kind && review.fields[field]?.status === "exact")
    .map((review) => review.id));
}

function replaceInPlaceByKey(
  name: EntityName,
  current: Json[],
  supplied: Json[],
  replacementScope: ReadonlySet<string>,
): Json[] {
  const replacements = new Map(supplied.map((row) => [entityKey(name, row), row]));
  const projected = current.flatMap((row) => {
    const key = entityKey(name, row);
    const replacement = replacements.get(key);
    if (replacement != null) {
      replacements.delete(key);
      return [replacement];
    }
    return replacementScope.has(key) ? [] : [row];
  });
  return [...projected, ...replacements.values()];
}

function removeCoverageRows(name: EntityName, rows: Json[], inventory: CodexInventory): Json[] {
  const units = new Set(inventory.coverage.unit_ids);
  if (name === "unit_compositions" || name === "wargear_options") return rows.filter((row) => !units.has(string(row.unit_id, `${name}.unit_id`)));
  if (name === "enhancements" || name === "stratagems") {
    const field = name === "enhancements" ? "enhancements" : "stratagems";
    const exactDetachments = exactReviewIds(inventory, "detachment", field);
    return rows.filter((row) => !exactDetachments.has(string(row.detachment_id, `${name}.detachment_id`)));
  }
  return rows;
}

function referencesId(value: unknown, id: string, key?: string): boolean {
  if (typeof value === "string") return key !== "id" && value === id;
  if (Array.isArray(value)) return value.some((item) => referencesId(item, id));
  if (value != null && typeof value === "object") return Object.entries(value).some(([childKey, child]) => referencesId(child, id, childKey));
  return false;
}

function retire(projected: Record<EntityName, Json[]>, inventory: CodexInventory): void {
  for (const [name, ids] of Object.entries(inventory.retire ?? {}) as [EntityName, string[]][]) {
    for (const id of ids) {
      const rows = projected[name];
      if (!rows.some((row) => entityKey(name, row) === id)) continue;
      const candidate = { ...projected, [name]: rows.filter((row) => entityKey(name, row) !== id) };
      const referencedBy = (Object.keys(candidate) as EntityName[]).find((other) => candidate[other].some((row) => referencesId(row, id)));
      if (referencedBy) throw new Error(`cannot retire ${name}:${id}; still referenced by ${referencedBy}`);
      projected[name] = candidate[name];
    }
  }
}

/** Pure replacement boundary used by both audit and apply. */
export function projectInventory(inventory: CodexInventory, current: Record<EntityName, Json[]>): Record<EntityName, Json[]> {
  validateInventory(inventory);
  const projected = {} as Record<EntityName, Json[]>;
  for (const name of Object.keys(ENTITY_FILES) as EntityName[]) {
    const base = removeCoverageRows(name, current[name], inventory);
    let supplied = inventory.entities[name];
    if (name === "leader_attachments") {
      const exactLeaders = exactReviewIds(inventory, "unit", "eligible_bodyguards");
      supplied = supplied.filter((row) => exactLeaders.has(string(row.leader_id, "leader_attachment.leader_id")));
      projected[name] = replaceInPlaceByKey(name, current[name], supplied, exactLeaders);
      continue;
    }
    if (name === "enhancements" || name === "stratagems") {
      const field = name === "enhancements" ? "enhancements" : "stratagems";
      const exactDetachments = exactReviewIds(inventory, "detachment", field);
      supplied = supplied.filter((row) => {
        const detachmentId = string(row.detachment_id, `${name}.detachment_id`);
        return !inventory.coverage.detachment_ids.includes(detachmentId) || exactDetachments.has(detachmentId);
      });
    } else if (name === "detachments") {
      const currentById = new Map(current[name].map((row) => [entityKey(name, row), row]));
      supplied = supplied.map((row) => {
        const detachmentId = entityKey(name, row);
        const prior = currentById.get(detachmentId);
        const projectedRow = { ...row };
        for (const [reviewField, rosterField] of [["enhancements", "enhancement_ids"], ["stratagems", "stratagem_ids"]] as const) {
          if (reviewFieldIsExact(inventory, "detachment", detachmentId, reviewField)) continue;
          if (prior?.[rosterField] === undefined) delete projectedRow[rosterField];
          else projectedRow[rosterField] = prior[rosterField];
        }
        return projectedRow;
      });
    }
    projected[name] = (name === "unit_compositions" || name === "wargear_options" || name === "enhancements" || name === "stratagems")
      ? [...base, ...supplied]
      : replaceByKey(name, base, supplied);
  }
  retire(projected, inventory);
  return projected;
}

function blendMatrix(current: Record<EntityName, Json[]>): Record<EntityName, Record<string, number>> {
  return Object.fromEntries((Object.keys(ENTITY_FILES) as EntityName[]).map((name) => [name, current[name].reduce<Record<string, number>>((counts, row) => {
    const version = asObject(row.game_version ?? {}, `${name}.game_version`);
    const dataslate = typeof version.dataslate === "string" ? version.dataslate : "unversioned";
    counts[dataslate] = (counts[dataslate] ?? 0) + 1;
    return counts;
  }, {})])) as Record<EntityName, Record<string, number>>;
}

export function reconciliationReport(inventory: CodexInventory, current: Record<EntityName, Json[]>): ReconciliationReport {
  const projected = projectInventory(inventory, current);
  const buckets: ReconciliationReport["buckets"] = {
    current: [], update: [], "missing-repository": [], "repository-only": [], "blocked-source": [],
  };
  for (const name of Object.keys(ENTITY_FILES) as EntityName[]) {
    const source = new Map(inventory.entities[name].map((row) => [entityKey(name, row), row]));
    const old = new Map(current[name].map((row) => [entityKey(name, row), row]));
    for (const [key, row] of source) {
      const existing = old.get(key);
      buckets[existing == null ? "missing-repository" : JSON.stringify(existing) === JSON.stringify(row) ? "current" : "update"].push({ entity: name, id: key });
    }
    for (const [key] of old) if (!source.has(key)) buckets["repository-only"].push({ entity: name, id: key });
  }
  for (const review of inventory.reviews) for (const [field, disposition] of Object.entries(review.fields)) {
    if (disposition.status === "blocked-source") buckets["blocked-source"].push({ kind: review.kind, id: review.id, field });
  }
  // Force evaluation now: an audit must prove its replacement projection is internally coherent.
  void projected;
  return { faction_id: inventory.faction_id, game_version: inventory.game_version, source_revision: inventory.source_revision, blend_matrix: blendMatrix(current), buckets };
}

export async function applyInventory(inventory: CodexInventory, write: boolean): Promise<void> {
  const current = currentFaction(inventory);
  const projected = projectInventory(inventory, current);
  const directory = path.join(CORE_DIR, inventory.faction_id);
  const staged: StagedWrite[] = (Object.entries(ENTITY_FILES) as [EntityName, string][]).map(([name, file]) => ({ path: path.join(directory, file), value: projected[name] }));
  await applyWrites(staged, { write, label: `Codex snapshot: ${inventory.faction_id}` });
}

function usage(): never {
  throw new Error("Usage: import-codex-core.ts audit <codex-inventory.json> --report <codex-reconciliation.json> --author-manifest <author.manifest.json> | apply <codex-inventory.json> [--write]");
}

async function main(): Promise<void> {
  const [mode, inventoryFile, ...flags] = process.argv.slice(2);
  if ((mode !== "audit" && mode !== "apply") || !inventoryFile) usage();
  const inventory = readJson(path.resolve(inventoryFile)) as CodexInventory;
  validateInventory(inventory);
  if (mode === "audit") {
    const reportAt = flags.indexOf("--report");
    const authorAt = flags.indexOf("--author-manifest");
    if (reportAt < 0 || authorAt < 0 || !flags[reportAt + 1] || !flags[authorAt + 1]) usage();
    const current = currentFaction(inventory);
    fs.writeFileSync(path.resolve(flags[reportAt + 1]), `${JSON.stringify(reconciliationReport(inventory, current), null, 2)}\n`);
    fs.writeFileSync(path.resolve(flags[authorAt + 1]), `${JSON.stringify(authorManifest(inventory), null, 2)}\n`);
    return;
  }
  await applyInventory(inventory, flags.includes("--write"));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) void main();
