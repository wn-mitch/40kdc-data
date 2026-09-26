import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { validateFingerprint } from "./contracts.js";
import { normalizedSurface } from "./matching.js";

/**
 * Move leaves from a deprecated family version to its successor, which may be another family.
 * Each mapping turns old parameters into new ones, or returns null when no current meaning
 * exists. A mapped active annotation is superseded by an identical one on the new fingerprint,
 * pending proposals and decided surfaces are re-pointed, and the old fingerprint is marked
 * superseded. Unmapped fingerprints keep their annotations and are reported, never guessed.
 */
type VersionMapping = {
  family: string;
  from: number;
  /** The successor family, when a meaning moves to a different family. */
  to_family?: string;
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
  // Version 4 moves attacks to the attack family. The only attack wording decided so far is
  // "each time a model in that unit makes an attack"; hit and wound rolls never named who attacked.
  {
    family: "event", from: 3, to: 4, map: (parameters) => {
      if (parameters.kind === "hit-roll" || parameters.kind === "wound-roll") return null;
      return parameters.kind === "attack-made" ? null : parameters;
    },
  },
  // Version 5 only adds kinds.
  { family: "event", from: 4, to: 5, map: (parameters) => parameters },
  { family: "event", from: 3, to_family: "attack", to: 1, map: (parameters) => (parameters.kind === "attack-made" ? { direction: "makes", unit: "that-unit", attack_type: "any" } : null) },
  // Version 2 adds the starts of your next turn and phases; quoted source endpoints have no meaning yet.
  { family: "duration", from: 1, to: 2, map: (parameters) => (typeof parameters.endpoint === "string" ? parameters : null) },
  // Version 2 of these only adds values (engaged; selected to move).
  { family: "unit-state", from: 1, to: 2, map: (parameters) => parameters },
  { family: "unit-activity", from: 1, to: 2, map: (parameters) => parameters },
  // Version 2 takes a set of characteristics, improve and worsen, and which weapons carry the change.
  {
    family: "characteristic-modifier", from: 1, to: 2,
    map: (parameters) => ({ subject: parameters.subject, characteristics: [parameters.characteristic], operation: parameters.operation, value: parameters.value, weapon_type: "all" }),
  },
  {
    family: "below-starting-strength", from: 1, to_family: "unit-state", to: 1,
    map: (parameters) => {
      const subject = parameters.subject === "this-unit" ? "this-unit" : parameters.subject === "target-unit" ? "target" : null;
      return subject ? { states: ["below-starting-strength"], subject, negated: false } : null;
    },
  },
];

export type FamilyVersionReport = {
  migrated_fingerprints: number;
  migrated_annotations: number;
  repointed_proposals: number;
  repointed_surfaces: number;
  /** Deprecated fingerprints that still carry active annotations and have no current meaning. */
  unmapped: Array<{ fingerprint_id: string; family_id: string; active_annotations: number }>;
};

/**
 * Apply successive mappings from one version until no later mapping exists, so a leaf moves
 * straight to the current version even when intermediate versions are already deprecated.
 * When several mappings leave one version (a kind that moved to another family), the first
 * that gives a meaning wins; they are written so at most one does.
 */
export function mapToLatest(family: string, from: number, parameters: Record<string, unknown>): { family: string; version: number; parameters: Record<string, unknown> } | null {
  let current = { family, version: from, parameters };
  for (;;) {
    const steps = FAMILY_VERSION_MAPPINGS.filter((item) => item.family === current.family && item.from === current.version);
    if (steps.length === 0) return current;
    const next = steps.map((step) => ({ step, parameters: step.map(current.parameters) })).find((item) => item.parameters);
    if (!next) return null;
    current = { family: next.step.to_family ?? current.family, version: next.step.to, parameters: next.parameters! };
  }
}

export function upgradeFamilyVersions(db: DatabaseSync): FamilyVersionReport {
  const report: FamilyVersionReport = { migrated_fingerprints: 0, migrated_annotations: 0, repointed_proposals: 0, repointed_surfaces: 0, unmapped: [] };
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
  const sources = [...new Map(FAMILY_VERSION_MAPPINGS.map((item) => [`${item.family}@${item.from}`, item])).values()];
  for (const mapping of sources) {
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
      const successor = validateFingerprint(db, mapped.family, mapped.parameters, mapped.version);
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
      report.repointed_surfaces += repointSurfaces(db, fingerprint.id, successor);
      db.prepare("UPDATE fingerprints SET status = 'superseded' WHERE id = ?").run(fingerprint.id);
      member.run(batch(), "fingerprint-superseded", fingerprint.id);
      report.migrated_fingerprints += 1;
    }
  }
  report.repointed_surfaces += repairStaleSurfaces(db);
  return report;
}

function repointSurfaces(db: DatabaseSync, from: string, to: string): number {
  return Number(db.prepare("UPDATE leaf_surfaces SET fingerprint_id = ? WHERE fingerprint_id = ? AND status = 'active'").run(to, from).changes);
}

/**
 * Decided surfaces left on a fingerprint an earlier migration superseded. The mappings are
 * deterministic, so mapping the stale fingerprint again finds the same successor its
 * annotations moved to. A surface with no current meaning stays put and keeps being reported
 * by the Leaves board as a retired family version.
 */
function repairStaleSurfaces(db: DatabaseSync): number {
  const stale = db.prepare(`
    SELECT DISTINCT fingerprints.id, fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json
    FROM leaf_surfaces JOIN fingerprints ON fingerprints.id = leaf_surfaces.fingerprint_id
    WHERE leaf_surfaces.status = 'active' AND fingerprints.status = 'superseded'
  `).all() as Array<{ id: string; family_id: string; family_version: number; parameters_json: string }>;
  let repointed = 0;
  for (const fingerprint of stale) {
    const mapped = mapToLatest(fingerprint.family_id, fingerprint.family_version, JSON.parse(fingerprint.parameters_json) as Record<string, unknown>);
    if (!mapped || (mapped.family === fingerprint.family_id && mapped.version === fingerprint.family_version)) continue;
    repointed += repointSurfaces(db, fingerprint.id, validateFingerprint(db, mapped.family, mapped.parameters, mapped.version));
  }
  return repointed;
}
