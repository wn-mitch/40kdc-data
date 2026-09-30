import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { bumpWorkbenchRevision, insertSpan, withTransaction } from "./db.js";

/**
 * Copy trusted decisions between records whose source is byte-identical (the same source hash
 * and fragments: a shared datasheet ability listed under several factions). A copy is `derived`
 * and names the row it copies (`derived_from_annotation_id`), so undoing that row retracts the
 * copy (`retractOrphanedCopies`). Accepted connectives are copied the same way, as accepted
 * connective proposals whose `reason_json.copied_from_proposal` names their source.
 *
 * Copies follow the same layering as a surface's derived rows: a copy promotes a machine row at
 * the same bytes and meaning, ignores other machine rows, never replaces a trusted row
 * (`TRUSTED_HERE`), and is not written where Will rejected that meaning (`REJECTED_HERE`) or
 * where two records of the same text were decided differently (`SOURCES_DISAGREE`).
 */

export type DuplicateBlock = { ability_version_id: number; fragment: string; start_byte: number; end_byte: number; reason: "TRUSTED_HERE" | "REJECTED_HERE" | "SOURCES_DISAGREE" };

export type DuplicatePropagation = {
  dry_run: boolean;
  groups: number;
  records_in_groups: number;
  leaves: { planned: number; already: number; promoted: number };
  connectives: { planned: number; already: number; settled: number };
  stale_copies: number;
  blocked: DuplicateBlock[];
  /** Records of a duplicate group that gain at least one copy. */
  records_touched: number;
  batch_id: string | null;
};

type LeafRow = { id: number; ability_version_id: number; fragment: string; start_byte: number; end_byte: number; exact_text: string; fingerprint_id: string; authority_kind: string };
type PlannedLeaf = { source: LeafRow; target: number; promote: number | null };
type ConnectiveRow = { id: number; ability_version_id: number; fragment: string; start_byte: number; end_byte: number; exact_text: string };
type PlannedConnective = { source: ConnectiveRow; target: number; pending: number | null };

const COPY_ORIGIN = "duplicate-text";

function idList(ids: Iterable<number>): string {
  return [...ids].map(Number).filter(Number.isSafeInteger).join(",") || "NULL";
}

/** Byte-identical record groups among current records, optionally only groups touching `scope`. */
function duplicateGroups(db: DatabaseSync, scope?: ReadonlySet<number>): number[][] {
  const rows = db.prepare(`
    SELECT group_concat(id) AS ids FROM abilities WHERE current = 1
    GROUP BY source_hash, fragments_json HAVING count(*) > 1
  `).all() as Array<{ ids: string }>;
  const groups = rows.map((row) => row.ids.split(",").map(Number).sort((left, right) => left - right));
  return scope ? groups.filter((group) => group.some((id) => scope.has(id))) : groups;
}

/** Active copies whose source row is no longer active: they follow their source out. */
function staleCopies(db: DatabaseSync): Array<{ id: number; supersedes_id: number | null }> {
  return db.prepare(`
    SELECT copy.id, copy.supersedes_id FROM annotations copy JOIN annotations source ON source.id = copy.derived_from_annotation_id
    WHERE copy.status = 'active' AND source.status <> 'active'
  `).all() as Array<{ id: number; supersedes_id: number | null }>;
}

function staleConnectives(db: DatabaseSync): Array<{ id: number; origin: string }> {
  return (db.prepare(`
    SELECT copy.id, copy.origin FROM proposals copy JOIN proposals source ON source.id = json_extract(copy.reason_json, '$.copied_from_proposal')
    WHERE copy.status = 'accepted' AND source.status <> 'accepted'
  `).all() as Array<{ id: number; origin: string }>);
}

function addMember(db: DatabaseSync, batchId: string, kind: string, id: number | string): void {
  db.prepare("INSERT OR IGNORE INTO batch_members (batch_id, entity_kind, entity_id) VALUES (?, ?, ?)").run(batchId, kind, String(id));
}

/**
 * Retract every copy whose source row is gone (undone, retracted or superseded), restoring what
 * the copy promoted. Called inside an undo's transaction, and before each propagation.
 */
export function retractOrphanedCopies(db: DatabaseSync, batchId: string): number {
  let retracted = 0;
  for (const copy of staleCopies(db)) {
    db.prepare("UPDATE annotations SET status = 'retracted' WHERE id = ? AND status = 'active'").run(copy.id);
    addMember(db, batchId, "annotation-retracted-with-source", copy.id);
    if (copy.supersedes_id !== null) {
      const restored = db.prepare("UPDATE annotations SET status = 'active' WHERE id = ? AND status = 'superseded'").run(copy.supersedes_id);
      if (restored.changes === 1) addMember(db, batchId, "annotation-restored", copy.supersedes_id);
    }
    retracted += 1;
  }
  for (const { id, origin } of staleConnectives(db)) {
    // A copied connective is withdrawn; a model's proposal the copy settled goes back to review.
    if (origin === COPY_ORIGIN) db.prepare("UPDATE proposals SET status = 'superseded' WHERE id = ? AND status = 'accepted'").run(id);
    else db.prepare("UPDATE proposals SET status = 'pending', reason_json = json_remove(reason_json, '$.copied_from_proposal') WHERE id = ? AND status = 'accepted'").run(id);
    addMember(db, batchId, "connective-retracted-with-source", id);
    retracted += 1;
  }
  return retracted;
}

function plan(db: DatabaseSync, groups: readonly number[][]): { leaves: PlannedLeaf[]; connectives: PlannedConnective[]; already: { leaves: number; connectives: number }; blocked: DuplicateBlock[] } {
  const leaves: PlannedLeaf[] = [];
  const connectives: PlannedConnective[] = [];
  const blocked: DuplicateBlock[] = [];
  const already = { leaves: 0, connectives: 0 };
  const members = new Set(groups.flat());
  const active = db.prepare(`
    SELECT annotations.id, source_spans.ability_version_id, source_spans.fragment, source_spans.start_byte, source_spans.end_byte,
      source_spans.exact_text, annotations.fingerprint_id, annotations.authority_kind, annotations.derived_from_annotation_id
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE annotations.status = 'active' AND source_spans.ability_version_id IN (${idList(members)})
  `).all() as Array<LeafRow & { derived_from_annotation_id: number | null }>;
  const byAbility = new Map<number, typeof active>();
  for (const row of active) byAbility.set(row.ability_version_id, [...(byAbility.get(row.ability_version_id) ?? []), row]);
  const refused = db.prepare(`
    SELECT 1 FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE source_spans.ability_version_id = ? AND source_spans.fragment = ? AND source_spans.start_byte = ? AND source_spans.end_byte = ?
      AND proposals.fingerprint_id = ? AND proposals.status IN ('rejected', 'corrected') LIMIT 1
  `);
  const accepted = db.prepare(`
    SELECT proposals.id, proposals.status, json_extract(proposals.reason_json, '$.copied_from_proposal') IS NOT NULL AS copied, source_spans.ability_version_id, source_spans.fragment, source_spans.start_byte, source_spans.end_byte, source_spans.exact_text
    FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE proposals.role = 'CONNECTIVE' AND proposals.status IN ('accepted', 'pending') AND source_spans.ability_version_id IN (${idList(members)})
  `).all() as Array<ConnectiveRow & { status: string; copied: number }>;
  const overlaps = (left: { fragment: string; start_byte: number; end_byte: number }, right: { fragment: string; start_byte: number; end_byte: number }) =>
    left.fragment === right.fragment && left.start_byte < right.end_byte && right.start_byte < left.end_byte;
  const same = (left: { fragment: string; start_byte: number; end_byte: number }, right: { fragment: string; start_byte: number; end_byte: number }) =>
    left.fragment === right.fragment && left.start_byte === right.start_byte && left.end_byte === right.end_byte;

  for (const group of groups) {
    // Sources: trusted rows that are not themselves copies, so a copy is never copied back.
    const sources = group.flatMap((id) => (byAbility.get(id) ?? []).filter((row) => row.authority_kind !== "machine" && row.derived_from_annotation_id === null));
    for (const target of group) {
      const here = byAbility.get(target) ?? [];
      const trustedHere = here.filter((row) => row.authority_kind !== "machine");
      const wanted = sources.filter((source) => source.ability_version_id !== target);
      const keyed = new Map<string, LeafRow>();
      for (const source of wanted) keyed.set(`${source.fragment}:${source.start_byte}:${source.end_byte}:${source.fingerprint_id}`, source);
      const unique = [...keyed.values()];
      for (const source of unique) {
        const block = (reason: DuplicateBlock["reason"]) => blocked.push({ ability_version_id: target, fragment: source.fragment, start_byte: source.start_byte, end_byte: source.end_byte, reason });
        if (trustedHere.some((row) => same(row, source) && row.fingerprint_id === source.fingerprint_id)) { already.leaves += 1; continue; }
        if (trustedHere.some((row) => overlaps(row, source))) { block("TRUSTED_HERE"); continue; }
        // Two records of one text decided differently: neither copy is written.
        if (unique.some((other) => other !== source && overlaps(other, source))) { block("SOURCES_DISAGREE"); continue; }
        if (refused.get(target, source.fragment, source.start_byte, source.end_byte, source.fingerprint_id)) { block("REJECTED_HERE"); continue; }
        const promote = here.find((row) => row.authority_kind === "machine" && same(row, source) && row.fingerprint_id === source.fingerprint_id);
        leaves.push({ source, target, promote: promote?.id ?? null });
      }
      const sourceConnectives = accepted.filter((row) => row.status === "accepted" && row.copied === 0 && row.ability_version_id !== target && group.includes(row.ability_version_id));
      const seen = new Set<string>();
      for (const source of sourceConnectives) {
        const key = `${source.fragment}:${source.start_byte}:${source.end_byte}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const mine = accepted.filter((row) => row.ability_version_id === target && same(row, source));
        if (mine.some((row) => row.status === "accepted")) { already.connectives += 1; continue; }
        if (trustedHere.some((row) => overlaps(row, source))) continue;
        connectives.push({ source, target, pending: mine.find((row) => row.status === "pending")?.id ?? null });
      }
    }
  }
  return { leaves, connectives, already, blocked };
}

/**
 * Copy trusted decisions across byte-identical records. `dryRun` plans against a read-only
 * database and writes nothing; otherwise one `duplicate-texts` batch holds every write.
 */
export function propagateDuplicateTexts(db: DatabaseSync, options: { dryRun: boolean; abilityVersionIds?: ReadonlySet<number> }): DuplicatePropagation {
  const groups = duplicateGroups(db, options.abilityVersionIds);
  const report = (planned: ReturnType<typeof plan>, stale: number, batchId: string | null): DuplicatePropagation => ({
    dry_run: options.dryRun,
    groups: groups.length,
    records_in_groups: groups.reduce((sum, group) => sum + group.length, 0),
    leaves: { planned: planned.leaves.length, already: planned.already.leaves, promoted: planned.leaves.filter((item) => item.promote !== null).length },
    connectives: { planned: planned.connectives.length, already: planned.already.connectives, settled: planned.connectives.filter((item) => item.pending !== null).length },
    stale_copies: stale,
    blocked: planned.blocked,
    records_touched: new Set([...planned.leaves, ...planned.connectives].map((item) => item.target)).size,
    batch_id: batchId,
  });
  if (options.dryRun) return report(plan(db, groups), staleCopies(db).length + staleConnectives(db).length, null);
  return withTransaction(db, () => {
    const batchId = `dup_${randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at, metadata_json) VALUES (?, 'duplicate-texts', 'system', ?, '{}')").run(batchId, now);
    const stale = retractOrphanedCopies(db, batchId);
    const planned = plan(db, groups);
    const insert = db.prepare(`
      INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, supersedes_id, derived_from_annotation_id, created_at)
      VALUES (?, ?, 'active', '${COPY_ORIGIN}', 'derived', 'system', ?, ?, ?, ?)
    `);
    const restating = db.prepare(`
      SELECT proposals.id, proposals.status FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
      WHERE source_spans.ability_version_id = ? AND source_spans.fragment = ? AND source_spans.start_byte = ? AND source_spans.end_byte = ?
        AND proposals.fingerprint_id = ? AND proposals.status IN ('pending', 'unresolved')
    `);
    for (const item of planned.leaves) {
      const { source, target } = item;
      if (item.promote !== null) db.prepare("UPDATE annotations SET status = 'superseded' WHERE id = ? AND status = 'active'").run(item.promote);
      const spanId = insertSpan(db, target, source.fragment, source.start_byte, source.end_byte, source.exact_text);
      const row = insert.run(spanId, source.fingerprint_id, batchId, item.promote, source.id, now);
      addMember(db, batchId, "annotation", Number(row.lastInsertRowid));
      // A trusted copy settles the proposals that restate it, as a surface's derived row does.
      for (const proposal of restating.all(target, source.fragment, source.start_byte, source.end_byte, source.fingerprint_id) as Array<{ id: number; status: string }>) {
        db.prepare("UPDATE proposals SET status = 'accepted' WHERE id = ?").run(proposal.id);
        addMember(db, batchId, proposal.status === "unresolved" ? "proposal-accepted-unresolved" : "proposal-accepted", proposal.id);
      }
    }
    for (const item of planned.connectives) {
      const { source, target } = item;
      if (item.pending !== null) {
        db.prepare("UPDATE proposals SET status = 'accepted', reason_json = json_set(reason_json, '$.copied_from_proposal', ?) WHERE id = ? AND status = 'pending'").run(source.id, item.pending);
        addMember(db, batchId, "connective-accepted", item.pending);
        continue;
      }
      const spanId = insertSpan(db, target, source.fragment, source.start_byte, source.end_byte, source.exact_text);
      const row = db.prepare(`
        INSERT INTO proposals (span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at)
        VALUES (?, NULL, 'CONNECTIVE', '${COPY_ORIGIN}', NULL, 'accepted', json_object('copied_from_proposal', ?), NULL, ?)
      `).run(spanId, source.id, now);
      addMember(db, batchId, "connective-copied", Number(row.lastInsertRowid));
    }
    bumpWorkbenchRevision(db);
    return report(planned, stale, batchId);
  });
}
