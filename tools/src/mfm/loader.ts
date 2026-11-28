import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import {
  MFM_RELATIONS,
  type MfmDumpPayload,
  type MfmIdTableName,
  type MfmMetadata,
  type MfmRelationName,
  type MfmRelationSource,
  type MfmRelationTarget,
  type MfmRow,
  type MfmStringKey,
  type MfmTableMap,
  type MfmTableName,
} from "./dump.generated.js";
import { REPO_ROOT } from "./repo-files.js";

export type * from "./dump.generated.js";

export const DEFAULT_DUMP_PATH = path.join(REPO_ROOT, "_private", "dump.json");

export type MfmDumpInit = {
  metadata?: Partial<MfmMetadata>;
  data: Partial<MfmTableMap>;
};

type LocalizedRow = {
  localisations?: {
    en?: {
      name?: string | null;
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Cached, typed access to the relational GW MFM snapshot. */
export class MfmDump {
  readonly version: number | undefined;
  readonly tables: Partial<MfmTableMap>;
  private readonly idIndexes = new Map<MfmIdTableName, ReadonlyMap<string, unknown>>();
  private readonly groupIndexes = new Map<string, ReadonlyMap<string, readonly unknown[]>>();
  private equipment: ReadonlySet<string> | undefined;

  constructor(payload: MfmDumpInit) {
    this.version = payload.metadata?.data_version;
    this.tables = payload.data;
  }

  /** Raw rows of a known table. Throws when a focused fixture omitted it. */
  table<N extends MfmTableName>(name: N): readonly MfmRow<N>[] {
    const rows = this.tables[name];
    if (!rows) throw new Error(`GW MFM dump has no table "${name}"`);
    return rows;
  }

  /** `id` to row index for a table with a verified string `id` identity. */
  byId<N extends MfmIdTableName>(name: N): ReadonlyMap<string, MfmRow<N>> {
    let index = this.idIndexes.get(name);
    if (!index) {
      const built = new Map<string, MfmRow<N>>();
      for (const row of this.table(name)) {
        const existing = built.get(row.id);
        if (existing) throw new Error(`GW MFM table "${name}" has duplicate identity "${row.id}"`);
        built.set(row.id, row);
      }
      index = built;
      this.idIndexes.set(name, index);
    }
    // The cache key fixes N; values were built from table(name) above.
    const typedIndex = index as ReadonlyMap<string, MfmRow<N>>;
    return typedIndex;
  }

  /** Group rows by a string or nullable-string column, cached by table and key. */
  groupBy<N extends MfmTableName, K extends MfmStringKey<N>>(
    name: N,
    key: K,
  ): ReadonlyMap<string, readonly MfmRow<N>[]> {
    const cacheKey = `${name}::${key}`;
    let index = this.groupIndexes.get(cacheKey);
    if (!index) {
      const built = new Map<string, MfmRow<N>[]>();
      for (const row of this.table(name)) {
        const value = row[key];
        if (typeof value !== "string") continue;
        const group = built.get(value) ?? [];
        group.push(row);
        built.set(value, group);
      }
      index = built;
      this.groupIndexes.set(cacheKey, index);
    }
    // The cache key fixes N and K; values were built from table(name) above.
    const typedIndex = index as ReadonlyMap<string, readonly MfmRow<N>[]>;
    return typedIndex;
  }

  /**
   * Miniatures with no Wounds characteristic. GW lists equipment a model is "equipped with" this
   * way when the app shows it as a figure: the Tidewall Shieldline's Tidewall defence platform is a
   * statline-less miniature its 105-point composition adds. It is wargear of the datasheet's model,
   * not a model of its own, so composition, tier, point and loadout passes leave it out (see
   * {@link compositionMiniatures}) and the wargear passes price and offer it as wargear.
   */
  equipmentMiniatureIds(): ReadonlySet<string> {
    this.equipment ??= new Set((this.tables.miniature ?? [])
      .filter((row) => typeof row.wounds === "string" && !/\d/.test(row.wounds))
      .map((row) => row.id));
    return this.equipment;
  }

  /** A unit composition's miniature rows, without {@link equipmentMiniatureIds} rows. */
  compositionMiniatures(unitCompositionId: string): readonly MfmRow<"unit_composition_miniature">[] {
    const equipment = this.equipmentMiniatureIds();
    return (this.groupBy("unit_composition_miniature", "unitCompositionId").get(unitCompositionId) ?? [])
      .filter((row) => !equipment.has(row.miniatureId));
  }

  /** Follow one verified relation from its source row to its optional parent. */
  parent<R extends MfmRelationName>(
    relation: R,
    row: MfmRelationSource<R>,
  ): MfmRelationTarget<R> | undefined {
    const spec = MFM_RELATIONS[relation];
    if (!isRecord(row)) return undefined;
    const targetId = row[spec.sourceField];
    if (typeof targetId !== "string") return undefined;
    const targetTable: MfmIdTableName = spec.targetTable;
    const target = this.byId(targetTable).get(targetId);
    // The generated relation contract fixes the target table for R.
    const typedTarget = target as MfmRelationTarget<R> | undefined;
    return typedTarget;
  }

  /** Follow one verified relation backwards to all matching source rows. */
  children<R extends MfmRelationName>(relation: R, targetId: string): readonly MfmRelationSource<R>[] {
    const spec = MFM_RELATIONS[relation];
    const sourceTable: MfmTableName = spec.sourceTable;
    const sourceField = spec.sourceField;
    const cacheKey = `${sourceTable}::${sourceField}`;
    let index = this.groupIndexes.get(cacheKey);
    if (!index) {
      const built = new Map<string, unknown[]>();
      for (const row of this.table(sourceTable)) {
        if (!isRecord(row)) continue;
        const value = row[sourceField];
        if (typeof value !== "string") continue;
        const group = built.get(value) ?? [];
        group.push(row);
        built.set(value, group);
      }
      index = built;
      this.groupIndexes.set(cacheKey, index);
    }
    const rows = index.get(targetId) ?? [];
    // The generated relation contract fixes the source table for R.
    const typedRows = rows as readonly MfmRelationSource<R>[];
    return typedRows;
  }

  /** Trimmed English display name for a localized row. */
  enName(row: LocalizedRow | undefined): string | undefined {
    return row?.localisations?.en?.name?.trim() || undefined;
  }

  /** Faction-keyword ownership for a datasheet through its publication. */
  factionKeywordOfDatasheet(datasheetId: string): string | null {
    const datasheet = this.byId("datasheet").get(datasheetId);
    if (!datasheet) return null;
    return this.parent("datasheet.publicationId", datasheet)?.factionKeywordId ?? null;
  }

  /** Faction-keyword ownership for a detachment through its publication. */
  factionKeywordOfDetachment(detachmentId: string): string | null {
    const detachment = this.byId("detachment").get(detachmentId);
    if (!detachment) return null;
    return this.parent("detachment.publicationId", detachment)?.factionKeywordId ?? null;
  }

  /** The first source disposition mapped to a detachment, or null when absent. */
  dispositionOfDetachment(detachmentId: string): string | null {
    return this.children("detachment_force_disposition.detachmentId", detachmentId)[0]?.forceDispositionId ?? null;
  }
}

/** Read the exact generated dump payload from disk. */
export function loadDump(filePath: string = DEFAULT_DUMP_PATH): MfmDump {
  if (!existsSync(filePath)) {
    throw new Error(`GW MFM dump not found at ${filePath}. Place the export there (it is .gitignored under _private/).`);
  }
  const payload: MfmDumpPayload = JSON.parse(readFileSync(filePath, "utf8"));
  return new MfmDump(payload);
}
