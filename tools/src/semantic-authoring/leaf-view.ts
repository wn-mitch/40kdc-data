import type { DatabaseSync } from "node:sqlite";

import type { CompileLeaf } from "./compile.js";
import type { LeafConnective } from "./compile-fragments.js";
import { NAME_FRAGMENT } from "./compile-name.js";
import { reviewedConnectives, type ReviewedConnective } from "./connective-rows.js";
import { getAbilityCoverage, getCurrentCoverage, type CoverageView } from "./coverage.js";
import { untiledRuns } from "./leaves.js";

/**
 * The leaves of every fully tiled source version under one view. The trusted view (the default)
 * reads human and derived rows only; it is what shapes, approval and publication see. A machine
 * view (`includeMachine`, `overlayRunIds`; see `CoverageView`) adds machine rows and the pending
 * proposals of named model runs, for pilot gates whose results are reports and never approvals.
 * In a machine view a trusted row shadows any machine row or overlay proposal it overlaps.
 */
export type TiledSource = {
  id: number; faction_id: string; ability_id: string; name: string | null; source_hash: string; source_text: string; source_type: string | null;
  leaves: CompileLeaf[];
  /** How many of the leaves are machine rows or overlay proposals (0 in the trusted view). */
  machine_leaves: number;
};

export type TiledSourceOptions = CoverageView & {
  abilityVersionIds?: ReadonlySet<number>;
  factionId?: string | null;
  /** Explicitly reviewed historical versions; each source must still match its pinned hash. */
  historicalSourceHashes?: ReadonlyMap<number, string>;
};

type LeafRow = {
  ability_version_id: number; start_byte: number; end_byte: number; fragment: string; exact_text: string; role: string;
  family_id: string; family_version: number; parameters_json: string; trusted: number;
  /** For an overlay proposal, its model run; later runs win overlaps. 0 for annotations. */
  run: number;
};

function idList(ids: Iterable<number>): string {
  return [...ids].map(Number).filter(Number.isSafeInteger).join(",") || "NULL";
}

export function tiledSources(
  db: DatabaseSync,
  options: TiledSourceOptions = {},
): TiledSource[] {
  const scope = options.abilityVersionIds ? `AND abilities.id IN (${idList(options.abilityVersionIds)})` : "";
  const faction = options.factionId ?? null;
  const coverage = getCurrentCoverage(db, options);
  const historical = options.historicalSourceHashes ?? new Map<number, string>();
  for (const [id, hash] of historical) {
    if (!options.abilityVersionIds?.has(id)) throw new Error(`Historical source ${id} must be explicitly requested.`);
    const row = db.prepare("SELECT source_hash, current FROM abilities WHERE id = ?").get(id) as { source_hash: string; current: number } | undefined;
    if (!row || row.current !== 0 || row.source_hash !== hash) throw new Error(`Historical source ${id} no longer matches its pinned historical identity.`);
    coverage.set(id, getAbilityCoverage(db, id, options));
  }
  const current = `(abilities.current = 1 OR abilities.id IN (${idList(historical.keys())}))`;
  const abilities = db.prepare(`
    SELECT id, faction_id, ability_id, name, source_hash, source_text, source_type FROM abilities
    WHERE ${current.replaceAll("abilities.", "")} AND (? IS NULL OR faction_id = ?) ${scope.replaceAll("abilities.id", "id")} ORDER BY faction_id, ability_id
  `).all(faction, faction) as Array<Omit<TiledSource, "leaves" | "machine_leaves">>;
  const columns = `source_spans.ability_version_id, source_spans.start_byte, source_spans.end_byte, source_spans.fragment, source_spans.exact_text, semantic_families.role,
    fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json`;
  const joins = `JOIN abilities ON abilities.id = source_spans.ability_version_id AND ${current}
    JOIN fingerprints ON fingerprints.id = X.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id AND semantic_families.version = fingerprints.family_version`;
  const rows = db.prepare(`
    SELECT ${columns}, CASE WHEN annotations.authority_kind = 'machine' THEN 0 ELSE 1 END AS trusted, 0 AS run
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id ${joins.replaceAll("X.", "annotations.")}
    WHERE annotations.status = 'active' ${options.includeMachine ? "" : "AND annotations.authority_kind != 'machine'"} ${scope}
  `).all() as LeafRow[];
  if (options.overlayRunIds && options.overlayRunIds.length > 0) {
    rows.push(...db.prepare(`
      SELECT ${columns}, 0 AS trusted, proposals.model_run_id AS run
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
  // Reviewed connectives are trusted decisions: only the trusted view reads them.
  const trustedView = !options.includeMachine && !(options.overlayRunIds && options.overlayRunIds.length > 0);
  const connectives = new Map<number, ReviewedConnective[]>();
  if (trustedView) {
    for (const row of reviewedConnectives(db, abilities.map((ability) => ability.id))) {
      connectives.set(row.ability_version_id, [...(connectives.get(row.ability_version_id) ?? []), row]);
    }
  }
  const result: TiledSource[] = [];
  for (const ability of abilities) {
    const view = coverage.get(ability.id);
    const own = shadowed(byAbility.get(ability.id) ?? []);
    if (!view || own.length === 0 || untiledRuns(view).length > 0) continue;
    const leaves: CompileLeaf[] = own.map((row) => ({
      role: row.role, family_id: row.family_id, family_version: row.family_version,
      parameters: JSON.parse(row.parameters_json) as Record<string, unknown>,
      start_byte: row.start_byte, end_byte: row.end_byte, fragment: row.fragment,
      // A NAME leaf carries its stored wording: compileWithName re-checks it against the current name.
      ...(row.fragment === NAME_FRAGMENT ? { exact_text: row.exact_text } : {}),
    }));
    result.push({
      ...ability,
      leaves: attachConnectives(leaves, connectives.get(ability.id) ?? []),
      machine_leaves: own.filter((row) => row.trusted === 0).length,
    });
  }
  return result;
}

/**
 * Drop untrusted leaves a trusted leaf overlaps. Among untrusted leaves, the latest model run
 * wins an overlap (a corrective re-run replaces the cut it corrects); machine annotations rank
 * below every overlay proposal.
 */
function shadowed(rows: LeafRow[]): LeafRow[] {
  const overlapsAny = (row: LeafRow, others: readonly LeafRow[]) =>
    others.some((other) => other.fragment === row.fragment && other.start_byte < row.end_byte && row.start_byte < other.end_byte);
  const kept = rows.filter((row) => row.trusted === 1);
  const untrusted = rows.filter((row) => row.trusted === 0).sort((left, right) => right.run - left.run || left.start_byte - right.start_byte);
  for (const row of untrusted) if (!overlapsAny(row, kept)) kept.push(row);
  return kept.sort((left, right) => left.start_byte - right.start_byte || left.end_byte - right.end_byte);
}

/**
 * Each connective on the leaf it introduces: the leaf whose span holds it (`within`), else the
 * first leaf of its fragment that starts at or after it. A connective with no leaf at or after it
 * in its fragment goes on the fragment's last leaf as `trailing`, so the compiler can refuse it
 * rather than lose it. Leaves without a connective are returned unchanged.
 */
export function attachConnectives(leaves: readonly CompileLeaf[], connectives: ReadonlyArray<LeafConnective & { fragment: string }>): CompileLeaf[] {
  const attached = new Map<number, LeafConnective[]>();
  for (const connective of connectives) {
    const own = leaves.map((leaf, index) => ({ leaf, index })).filter(({ leaf }) => (leaf.fragment ?? "RAW_TEXT") === connective.fragment);
    if (own.length === 0) continue;
    const holder = own.find(({ leaf }) => leaf.start_byte <= connective.start_byte && connective.end_byte <= (leaf.end_byte ?? leaf.start_byte));
    const next = own.filter(({ leaf }) => leaf.start_byte >= connective.start_byte).sort((left, right) => left.leaf.start_byte - right.leaf.start_byte)[0];
    const last = [...own].sort((left, right) => left.leaf.start_byte - right.leaf.start_byte).at(-1)!;
    const target = holder ?? next ?? last;
    const item: LeafConnective = {
      relation: connective.relation, surface: connective.surface, start_byte: connective.start_byte, end_byte: connective.end_byte,
      ...(holder ? { within: true } : {}), ...(!holder && !next ? { trailing: true } : {}),
    };
    attached.set(target.index, [...(attached.get(target.index) ?? []), item]);
  }
  return leaves.map((leaf, index) => attached.has(index) ? { ...leaf, connectives: [...(leaf.connectives ?? []), ...attached.get(index)!] } : leaf);
}
