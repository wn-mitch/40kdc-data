import type { DatabaseSync } from "node:sqlite";

import type { CompileLeaf } from "./compile.js";
import { getCurrentCoverage, type CoverageView } from "./coverage.js";
import { untiledRuns } from "./leaves.js";

/**
 * The leaves of every fully tiled source version under one view. The trusted view (the default)
 * reads human and derived rows only; it is what shapes, approval and publication see. A machine
 * view (`includeMachine`, `overlayRunIds`; see `CoverageView`) adds machine rows and the pending
 * proposals of named model runs, for pilot gates whose results are reports and never approvals.
 * In a machine view a trusted row shadows any machine row or overlay proposal it overlaps.
 */
export type TiledSource = {
  id: number; faction_id: string; ability_id: string; name: string | null; source_hash: string; source_text: string;
  leaves: CompileLeaf[];
  /** How many of the leaves are machine rows or overlay proposals (0 in the trusted view). */
  machine_leaves: number;
};

type LeafRow = {
  ability_version_id: number; start_byte: number; end_byte: number; fragment: string; role: string;
  family_id: string; family_version: number; parameters_json: string; trusted: number;
};

function idList(ids: Iterable<number>): string {
  return [...ids].map(Number).filter(Number.isSafeInteger).join(",") || "NULL";
}

export function tiledSources(
  db: DatabaseSync,
  options: CoverageView & { abilityVersionIds?: ReadonlySet<number>; factionId?: string | null } = {},
): TiledSource[] {
  const scope = options.abilityVersionIds ? `AND abilities.id IN (${idList(options.abilityVersionIds)})` : "";
  const faction = options.factionId ?? null;
  const coverage = getCurrentCoverage(db, options);
  const abilities = db.prepare(`
    SELECT id, faction_id, ability_id, name, source_hash, source_text FROM abilities
    WHERE current = 1 AND (? IS NULL OR faction_id = ?) ${scope.replaceAll("abilities.id", "id")} ORDER BY faction_id, ability_id
  `).all(faction, faction) as Array<Omit<TiledSource, "leaves" | "machine_leaves">>;
  const columns = `source_spans.ability_version_id, source_spans.start_byte, source_spans.end_byte, source_spans.fragment, semantic_families.role,
    fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json`;
  const joins = `JOIN abilities ON abilities.id = source_spans.ability_version_id AND abilities.current = 1
    JOIN fingerprints ON fingerprints.id = X.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id AND semantic_families.version = fingerprints.family_version`;
  const rows = db.prepare(`
    SELECT ${columns}, CASE WHEN annotations.authority_kind = 'machine' THEN 0 ELSE 1 END AS trusted
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id ${joins.replaceAll("X.", "annotations.")}
    WHERE annotations.status = 'active' ${options.includeMachine ? "" : "AND annotations.authority_kind != 'machine'"} ${scope}
  `).all() as LeafRow[];
  if (options.overlayRunIds && options.overlayRunIds.length > 0) {
    rows.push(...db.prepare(`
      SELECT ${columns}, 0 AS trusted
      FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id ${joins.replaceAll("X.", "proposals.")}
      WHERE proposals.status = 'pending' AND proposals.model_run_id IN (${idList(options.overlayRunIds)}) ${scope}
    `).all() as LeafRow[]);
  }
  const byAbility = new Map<number, LeafRow[]>();
  for (const row of rows) {
    const list = byAbility.get(row.ability_version_id) ?? [];
    list.push(row);
    byAbility.set(row.ability_version_id, list);
  }
  const result: TiledSource[] = [];
  for (const ability of abilities) {
    const view = coverage.get(ability.id);
    const own = shadowed(byAbility.get(ability.id) ?? []);
    if (!view || own.length === 0 || untiledRuns(view).length > 0) continue;
    result.push({
      ...ability,
      leaves: own.map((row) => ({
        role: row.role, family_id: row.family_id, family_version: row.family_version,
        parameters: JSON.parse(row.parameters_json) as Record<string, unknown>,
        start_byte: row.start_byte, end_byte: row.end_byte, fragment: row.fragment,
      })),
      machine_leaves: own.filter((row) => row.trusted === 0).length,
    });
  }
  return result;
}

/** Drop untrusted leaves a trusted leaf overlaps, and exact duplicates among the untrusted. */
function shadowed(rows: LeafRow[]): LeafRow[] {
  const trusted = rows.filter((row) => row.trusted === 1);
  const kept = [...trusted];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.trusted === 1) continue;
    if (trusted.some((other) => other.fragment === row.fragment && other.start_byte < row.end_byte && row.start_byte < other.end_byte)) continue;
    const key = `${row.fragment}:${row.start_byte}:${row.end_byte}:${row.family_id}:${row.family_version}:${row.parameters_json}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  return kept.sort((left, right) => left.start_byte - right.start_byte || left.end_byte - right.end_byte);
}
