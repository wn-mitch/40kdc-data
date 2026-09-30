import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { familyRole, validateFingerprint } from "./contracts.js";
import { normalizedSurface } from "./matching.js";

/**
 * Move leaves from a deprecated family version to its successor, which may be another family.
 * Each mapping turns old parameters into new ones, or returns null when no current meaning
 * exists. A mapped active annotation is superseded by an identical one on the new fingerprint
 * (or, when its span already carries the new fingerprint, only superseded), pending proposals,
 * candidate judgments and decided surfaces are re-pointed, leaf-proposal pieces are rewritten,
 * and the old fingerprint is marked superseded. Unmapped fingerprints keep their annotations
 * and are reported, never guessed.
 */
type VersionMapping = {
  family: string;
  from: number;
  /** The successor family, when a meaning moves to a different family. */
  to_family?: string;
  to: number;
  map: (parameters: Record<string, unknown>) => Record<string, unknown> | null;
};

/** "The bearer" is the model that has the ability; one value, this-model, now says so. */
function bearerIsThisModel(key: string): (parameters: Record<string, unknown>) => Record<string, unknown> {
  return (parameters) => (parameters[key] === "bearer" ? { ...parameters, [key]: "this-model" } : parameters);
}

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
  // Versions 5 and 6 only add kinds.
  { family: "event", from: 4, to: 5, map: (parameters) => parameters },
  { family: "event", from: 5, to: 6, map: (parameters) => parameters },
  { family: "event", from: 3, to_family: "attack", to: 1, map: (parameters) => (parameters.kind === "attack-made" ? { direction: "makes", unit: "that-unit", attack_type: "any" } : null) },
  // Version 2 adds the starts of your next turn and phases; quoted source endpoints have no meaning yet.
  { family: "duration", from: 1, to: 2, map: (parameters) => (typeof parameters.endpoint === "string" ? parameters : null) },
  // Version 2 of these only adds values (engaged; selected to move).
  { family: "unit-state", from: 1, to: 2, map: (parameters) => parameters },
  { family: "unit-state", from: 2, to: 3, map: (parameters) => parameters },
  { family: "unit-activity", from: 1, to: 2, map: (parameters) => parameters },
  // Version 4/2/3 (batch 6) only widen the subject enum; an existing this-unit/this-model/target still fits.
  { family: "unit-state", from: 3, to: 4, map: (parameters) => parameters },
  { family: "unit-keyword", from: 1, to: 2, map: (parameters) => parameters },
  { family: "unit-activity", from: 2, to: 3, map: (parameters) => parameters },
  // Version 2 (batch 6) only adds optional to/range on closest-eligible and widens subject.
  { family: "unit-position", from: 1, to: 2, map: (parameters) => parameters },
  // Version 2 takes a set of characteristics, improve and worsen, and which weapons carry the change.
  {
    family: "characteristic-modifier", from: 1, to: 2,
    map: (parameters) => ({ subject: parameters.subject, characteristics: [parameters.characteristic], operation: parameters.operation, value: parameters.value, weapon_type: "all" }),
  },
  // These versions drop the value "bearer", which meant the same model as "this-model".
  { family: "characteristic-set", from: 1, to: 2, map: bearerIsThisModel("subject") },
  { family: "weapon-ability-grant", from: 2, to: 3, map: bearerIsThisModel("subject") },
  { family: "feel-no-pain", from: 1, to: 2, map: bearerIsThisModel("subject") },
  { family: "invulnerable-save", from: 1, to: 2, map: bearerIsThisModel("subject") },
  { family: "fights-first", from: 1, to: 2, map: bearerIsThisModel("subject") },
  { family: "no-advance-roll", from: 1, to: 2, map: bearerIsThisModel("subject") },
  { family: "act-after-move", from: 1, to: 2, map: bearerIsThisModel("subject") },
  { family: "regain-wounds", from: 1, to: 2, map: bearerIsThisModel("subject") },
  { family: "characteristic-modifier", from: 2, to: 3, map: bearerIsThisModel("subject") },
  // Version 4 only adds detection range and the selected unit; version 3 parameters still fit.
  { family: "characteristic-modifier", from: 3, to: 4, map: (parameters) => parameters },
  { family: "attack", from: 1, to: 2, map: bearerIsThisModel("unit") },
  { family: "optional-use", from: 1, to: 2, map: bearerIsThisModel("who") },
  // Version 3 only adds amounts (D3+1, D3+2) and an optional per; existing parameters still fit.
  { family: "regain-wounds", from: 2, to: 3, map: (parameters) => parameters },
  // Version 2 only adds an optional subject; v1's empty parameters (always this-unit) still fit.
  { family: "sticky-objective", from: 1, to: 2, map: (parameters) => parameters },
  // Version 2 only adds an optional roll_var (the phase-4 `roll` binding container); v1's plain dice still fits.
  { family: "dice-roll", from: 1, to: 2, map: (parameters) => parameters },
  // Version 3 only adds an optional count (several dice); one die leaves it out, so v2 still fits.
  { family: "dice-roll", from: 2, to: 3, map: (parameters) => parameters },
  // Version 2 only adds an optional reward_choice_label; v1's plain {test} still fits.
  { family: "risk-reward-open", from: 1, to: 2, map: (parameters) => parameters },
  // Version 2 only adds optional eligibility/binds_event_variable fields; v1's plain shape still fits.
  { family: "menu-action", from: 1, to: 2, map: (parameters) => parameters },
  // Version 2 only adds an optional label; v1's plain {pool, amount} still fits.
  { family: "resource-spend", from: 1, to: 2, map: (parameters) => parameters },
  { family: "resource-gain", from: 1, to: 2, map: (parameters) => parameters },
  // Version 2 only adds optional pool_gain/pool_spend; v1's plain {menu_id, pool_id} still fits.
  { family: "resource-action-menu-open", from: 1, to: 2, map: (parameters) => parameters },
  // Version 2 only adds optional of_owner/of_keywords and (test only) scaling_*; v1's shape still fits.
  { family: "test", from: 1, to: 2, map: (parameters) => parameters },
  { family: "test-exemption", from: 1, to: 2, map: (parameters) => parameters },
  {
    family: "below-starting-strength", from: 1, to_family: "unit-state", to: 1,
    map: (parameters) => {
      const subject = parameters.subject === "this-unit" ? "this-unit" : parameters.subject === "target-unit" ? "target" : null;
      return subject ? { states: ["below-starting-strength"], subject, negated: false } : null;
    },
  },
  // Version 2 widens the roll enum and adds count and weapon_type, defaulting to "all".
  { family: "reroll", from: 1, to: 2, map: (parameters) => ({ ...parameters, weapon_type: "all" }) },
  // Version 4 only adds independent optional filters and flags; existing parameters still fit.
  { family: "weapon-ability-grant", from: 3, to: 4, map: (parameters) => parameters },
  // Version 2 widens the aspect/operation enums and adds recipients/options/uses-only fields; a
  // version 1 leaf's aspect and operation are both still in the widened enums, so it fits as is.
  { family: "ability-modifier", from: 1, to: 2, map: (parameters) => parameters },
  // Version 2 adds act (fight/shoot); every version 1 leaf meant fighting.
  { family: "fight-on-death", from: 1, to: 2, map: (parameters) => ({ ...parameters, act: "fight" }) },
  // Version 7 (batch 6) only adds kinds and their own filter fields; existing leaves still fit.
  { family: "event", from: 6, to: 7, map: (parameters) => parameters },
  // Version 2 only widens faction from always-quoted to quoted-or-resolved; a pending quote still fits.
  { family: "army-faction", from: 1, to: 2, map: (parameters) => parameters },
  // Version 8/3/2 (batch 7a) only add kinds/endpoints/frequencies and their own filter fields.
  { family: "event", from: 7, to: 8, map: (parameters) => parameters },
  // Version 9 only adds four new kinds and their own owner/move_types/to/action_kind fields; v8's shapes still fit.
  { family: "event", from: 8, to: 9, map: (parameters) => parameters },
  { family: "duration", from: 2, to: 3, map: (parameters) => parameters },
  { family: "usage-limit", from: 1, to: 2, map: (parameters) => parameters },
  // Version 2/2 (batch 7a) only add an optional range_cap_inches/counts_as_move field.
  { family: "aura-range", from: 1, to: 2, map: (parameters) => parameters },
  { family: "make-move", from: 1, to: 2, map: (parameters) => parameters },
  // Version 3 only widens which subjects within/beyond accept; every version 2 leaf's subject
  // (never more than "target" for those two kinds under v2's own rule) still fits.
  { family: "unit-position", from: 2, to: 3, map: (parameters) => parameters },
  // Version 4 makes within/beyond say what they measure from. Earlier versions always meant the
  // distance between this unit and the attack's target, so that is what they become.
  {
    family: "unit-position", from: 3, to: 4,
    map: (parameters) => parameters.kind === "within" || parameters.kind === "beyond"
      ? { ...parameters, ...(parameters.subject === "target" ? { of: "this-unit" } : { of: "target" }) }
      : parameters,
  },
];

export type FamilyVersionReport = {
  migrated_fingerprints: number;
  migrated_annotations: number;
  repointed_proposals: number;
  repointed_surfaces: number;
  repointed_judgments: number;
  /** Candidate judgments left on the old fingerprint because the successor already has the same judgment key. */
  judgment_conflicts: number;
  /** Leaf-proposal pieces moved to the current version of their family. */
  migrated_proposal_pieces: number;
  /** Leaf-proposal pieces on a retired version with no current meaning; left as they are. */
  unmapped_proposal_pieces: number;
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
  const report: FamilyVersionReport = {
    migrated_fingerprints: 0, migrated_annotations: 0, repointed_proposals: 0, repointed_surfaces: 0, repointed_judgments: 0,
    judgment_conflicts: 0, migrated_proposal_pieces: 0, unmapped_proposal_pieces: 0, unmapped: [],
  };
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
  const recordsAuthority = (db.prepare("PRAGMA table_info(annotations)").all() as Array<{ name: string }>).some((column) => column.name === "derived_from_surface_id");
  const sources = [...new Map(FAMILY_VERSION_MAPPINGS.map((item) => [`${item.family}@${item.from}`, item])).values()];
  for (const mapping of sources) {
    const fingerprints = db.prepare(`
      SELECT id, parameters_json FROM fingerprints
      WHERE family_id = ? AND family_version = ? AND status = 'active'
      ORDER BY id
    `).all(mapping.family, mapping.from) as Array<{ id: string; parameters_json: string }>;
    for (const fingerprint of fingerprints) {
      const annotations = db.prepare(`
        SELECT id, span_id, origin, confirmed_by, ${recordsAuthority ? "authority_kind, derived_from_surface_id" : "'human' AS authority_kind, NULL AS derived_from_surface_id"} FROM annotations
        WHERE fingerprint_id = ? AND status = 'active' ORDER BY id
      `).all(fingerprint.id) as Array<{ id: number; span_id: number; origin: string; confirmed_by: string; authority_kind: string; derived_from_surface_id: number | null }>;
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
      const alreadyOnSuccessor = db.prepare("SELECT 1 FROM annotations WHERE span_id = ? AND fingerprint_id = ? AND status = 'active'");
      for (const annotation of annotations) {
        db.prepare("UPDATE annotations SET status = 'superseded' WHERE id = ? AND status = 'active'").run(annotation.id);
        // Two old meanings that now read the same (bearer and this-model) merge into one annotation.
        if (alreadyOnSuccessor.get(annotation.span_id, successor)) {
          member.run(batch(), "annotation-merged", String(annotation.id));
          report.migrated_annotations += 1;
          continue;
        }
        // A migrated copy keeps the authority and surface link of the row it replaces. A database
        // that predates recorded authority is migrated right after (authority-migration.ts),
        // which classifies these copies by the row they supersede.
        const inserted = recordsAuthority
          ? db.prepare(`
            INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, supersedes_id, derived_from_surface_id, created_at)
            VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
          `).run(annotation.span_id, successor, annotation.origin, annotation.authority_kind, annotation.confirmed_by, batch(), annotation.id, annotation.derived_from_surface_id, now)
          : db.prepare(`
            INSERT INTO annotations (span_id, fingerprint_id, status, origin, confirmed_by, batch_id, supersedes_id, created_at)
            VALUES (?, ?, 'active', ?, ?, ?, ?, ?)
          `).run(annotation.span_id, successor, annotation.origin, annotation.confirmed_by, batch(), annotation.id, now);
        member.run(batch(), "annotation-migrated", String(inserted.lastInsertRowid));
        report.migrated_annotations += 1;
      }
      report.repointed_proposals += Number(db.prepare(`
        UPDATE proposals SET fingerprint_id = ? WHERE fingerprint_id = ? AND status IN ('pending', 'unresolved')
      `).run(successor, fingerprint.id).changes);
      report.repointed_surfaces += repointSurfaces(db, fingerprint.id, successor);
      const judgments = repointJudgments(db, fingerprint.id, successor);
      report.repointed_judgments += judgments.repointed;
      report.judgment_conflicts += judgments.conflicts;
      db.prepare("UPDATE fingerprints SET status = 'superseded' WHERE id = ?").run(fingerprint.id);
      member.run(batch(), "fingerprint-superseded", fingerprint.id);
      report.migrated_fingerprints += 1;
    }
  }
  report.repointed_surfaces += repairStaleSurfaces(db);
  const pieces = migrateProposalPieces(db);
  report.migrated_proposal_pieces = pieces.migrated;
  report.unmapped_proposal_pieces = pieces.unmapped;
  return report;
}

/**
 * Move judgments of a candidate against the old fingerprint to the successor. A judgment whose
 * key (candidate, fingerprint, source artifact) the successor already holds stays where it is,
 * as history of the superseded fingerprint, and is counted.
 */
function repointJudgments(db: DatabaseSync, from: string, to: string): { repointed: number; conflicts: number } {
  const repointed = Number(db.prepare("UPDATE OR IGNORE candidate_judgments SET queried_fingerprint_id = ? WHERE queried_fingerprint_id = ?").run(to, from).changes);
  const left = db.prepare("SELECT COUNT(*) AS count FROM candidate_judgments WHERE queried_fingerprint_id = ?").get(from) as { count: number };
  return { repointed, conflicts: left.count };
}

type StoredPiece = Record<string, unknown> & { family_id?: unknown; family_version?: unknown; parameters?: unknown };

/**
 * Rewrite each leaf-proposal piece that names a retired family version to the current version,
 * so accepting it records a current fingerprint. Dismissed proposals are rewritten too: their
 * pieces are what keeps a later run's identical proposal hidden.
 */
function migrateProposalPieces(db: DatabaseSync): { migrated: number; unmapped: number } {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'leaf_proposals'").get();
  if (!table) return { migrated: 0, unmapped: 0 };
  const update = db.prepare("UPDATE leaf_proposals SET pieces_json = ? WHERE id = ?");
  let migrated = 0;
  let unmapped = 0;
  for (const row of db.prepare("SELECT id, pieces_json FROM leaf_proposals ORDER BY id").all() as Array<{ id: number; pieces_json: string }>) {
    let changed = false;
    const pieces = (JSON.parse(row.pieces_json) as StoredPiece[]).map((piece) => {
      if (typeof piece.family_id !== "string" || typeof piece.family_version !== "number" || !piece.parameters || typeof piece.parameters !== "object") return piece;
      const mapped = mapToLatest(piece.family_id, piece.family_version, piece.parameters as Record<string, unknown>);
      if (!mapped) {
        unmapped += 1;
        return piece;
      }
      if (mapped.family === piece.family_id && mapped.version === piece.family_version) return piece;
      changed = true;
      migrated += 1;
      return { ...piece, family_id: mapped.family, family_version: mapped.version, role: familyRole(mapped.family, mapped.version), parameters: mapped.parameters };
    });
    if (changed) update.run(JSON.stringify(pieces), row.id);
  }
  return { migrated, unmapped };
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
