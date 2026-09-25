import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { validateFingerprint } from "./contracts.js";
import { normalizedSurface } from "./matching.js";

/**
 * Move leaves from a deprecated family version to its successor. Each mapping turns old
 * parameters into new ones, or returns null when no current meaning exists. A mapped active
 * annotation is superseded by an identical one on the new fingerprint, pending proposals are
 * re-pointed, and the old fingerprint is marked superseded. Unmapped fingerprints keep their
 * annotations and are reported, never guessed.
 */
type VersionMapping = {
  family: string;
  from: number;
  to: number;
  map: (parameters: Record<string, unknown>) => Record<string, unknown> | null;
};

/** Free-text event kinds that name a closed-enum kind exactly, by normalized source text. */
const EVENT_SOURCE_KINDS: Record<string, string> = {
  "after this unit has shot": "after-shooting",
};

export const FAMILY_VERSION_MAPPINGS: readonly VersionMapping[] = [
  { family: "leading-unit", from: 1, to: 2, map: (parameters) => ({ ...parameters, attachment: "leading" }) },
  { family: "weapon-ability-grant", from: 1, to: 2, map: (parameters) => ({ ...parameters, weapon_type: "all" }) },
  {
    family: "event",
    from: 1,
    to: 2,
    map: (parameters) => {
      const kind = parameters.kind;
      if (typeof kind === "string") return { kind };
      if (kind && typeof kind === "object" && "source" in kind && typeof kind.source === "string") {
        const mapped = EVENT_SOURCE_KINDS[normalizedSurface(kind.source)];
        return mapped ? { kind: mapped } : null;
      }
      return null;
    },
  },
  // Version 3 names the phase of a phase boundary, which older leaves never recorded.
  { family: "event", from: 2, to: 3, map: (parameters) => (parameters.kind === "phase-start" || parameters.kind === "phase-end" ? null : { kind: parameters.kind }) },
];

export type FamilyVersionReport = {
  migrated_fingerprints: number;
  migrated_annotations: number;
  repointed_proposals: number;
  /** Deprecated fingerprints that still carry active annotations and have no current meaning. */
  unmapped: Array<{ fingerprint_id: string; family_id: string; active_annotations: number }>;
};

/**
 * Apply successive mappings from one version until no later mapping exists, so a leaf moves
 * straight to the current version even when intermediate versions are already deprecated.
 */
function mapToLatest(family: string, from: number, parameters: Record<string, unknown>): { version: number; parameters: Record<string, unknown> } | null {
  let version = from;
  let current: Record<string, unknown> | null = parameters;
  for (let step = FAMILY_VERSION_MAPPINGS.find((item) => item.family === family && item.from === version); step; step = FAMILY_VERSION_MAPPINGS.find((item) => item.family === family && item.from === version)) {
    current = step.map(current);
    if (!current) return null;
    version = step.to;
  }
  return { version, parameters: current };
}

export function upgradeFamilyVersions(db: DatabaseSync): FamilyVersionReport {
  const report: FamilyVersionReport = { migrated_fingerprints: 0, migrated_annotations: 0, repointed_proposals: 0, unmapped: [] };
  let batchId: string | null = null;
  const batch = (): string => {
    if (batchId) return batchId;
    batchId = `migration_${randomUUID()}`;
    db.prepare(`
      INSERT INTO annotation_batches (id, operation, reviewer, created_at) VALUES (?, 'migration-family-versions', 'system', ?)
    `).run(batchId, new Date().toISOString());
    return batchId;
  };
  const member = db.prepare("INSERT OR IGNORE INTO batch_members (batch_id, entity_kind, entity_id) VALUES (?, ?, ?)");
  for (const mapping of FAMILY_VERSION_MAPPINGS) {
    const fingerprints = db.prepare(`
      SELECT id, parameters_json FROM fingerprints
      WHERE family_id = ? AND family_version = ? AND status = 'active'
      ORDER BY id
    `).all(mapping.family, mapping.from) as Array<{ id: string; parameters_json: string }>;
    for (const fingerprint of fingerprints) {
      const annotations = db.prepare(`
        SELECT id, span_id, origin, confirmed_by FROM annotations
        WHERE fingerprint_id = ? AND status = 'active' ORDER BY id
      `).all(fingerprint.id) as Array<{ id: number; span_id: number; origin: string; confirmed_by: string }>;
      const mapped = mapToLatest(mapping.family, mapping.from, JSON.parse(fingerprint.parameters_json) as Record<string, unknown>);
      if (!mapped) {
        if (annotations.length > 0) {
          report.unmapped.push({ fingerprint_id: fingerprint.id, family_id: mapping.family, active_annotations: annotations.length });
          continue;
        }
        db.prepare("UPDATE fingerprints SET status = 'superseded' WHERE id = ?").run(fingerprint.id);
        continue;
      }
      const successor = validateFingerprint(db, mapping.family, mapped.parameters, mapped.version);
      const now = new Date().toISOString();
      for (const annotation of annotations) {
        db.prepare("UPDATE annotations SET status = 'superseded' WHERE id = ? AND status = 'active'").run(annotation.id);
        const inserted = db.prepare(`
          INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, supersedes_id, created_at)
          VALUES (?, ?, 'active', ?, 'human', ?, ?, ?, ?)
        `).run(annotation.span_id, successor, annotation.origin, annotation.confirmed_by, batch(), annotation.id, now);
        member.run(batch(), "annotation-migrated", String(inserted.lastInsertRowid));
        report.migrated_annotations += 1;
      }
      report.repointed_proposals += Number(db.prepare(`
        UPDATE proposals SET fingerprint_id = ? WHERE fingerprint_id = ? AND status IN ('pending', 'unresolved')
      `).run(successor, fingerprint.id).changes);
      db.prepare("UPDATE fingerprints SET status = 'superseded' WHERE id = ?").run(fingerprint.id);
      member.run(batch(), "fingerprint-superseded", fingerprint.id);
      report.migrated_fingerprints += 1;
    }
  }
  return report;
}
