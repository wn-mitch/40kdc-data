import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { familyRole, REVIEWED_FAMILY_REGISTRY, validateFingerprint } from "./contracts.js";
import { approvalsOnCurrentInputs, carryApprovals } from "./shapes.js";

/**
 * Move leaves from a retired family version to its successor, which may be another family. Each
 * mapping turns old parameters into new ones, or returns null when no current meaning exists.
 *
 * A bump edits the family's definition in place, raises its version, and adds a mapping from the
 * old version here. The next workbench open moves every leaf across: each active annotation takes
 * the successor fingerprint in place (or, when its span already carries the successor, is folded
 * into that annotation), proposals, candidate judgments and surfaces are re-pointed, leaf-proposal
 * pieces are rewritten, and the old fingerprint and family version are deleted. An approval whose
 * compiled shape the move leaves unchanged is carried to the new inputs. Unmapped fingerprints keep
 * their annotations and are reported, never guessed. Once a mapping has run on the workbench,
 * delete it.
 */
export type VersionMapping = {
  family: string;
  from: number;
  /** The successor family, when a meaning moves to a different family. */
  to_family?: string;
  to: number;
  map: (parameters: Record<string, unknown>) => Record<string, unknown> | null;
};

export const FAMILY_VERSION_MAPPINGS: readonly VersionMapping[] = [
  // event v41 adds passed and a Dark Pact or contract bind_as on a used moment; unit-activity v26 passed on
  // made-dark-pact-this-phase; roll-total v2 roll_var dark-pact-test; ability-modifier v9 aspect mortal-wounds.
  // Every earlier leaf keeps its meaning.
  { family: "event", from: 40, to: 43, map: (parameters) => ({ ...parameters }) },
  { family: "unit-activity", from: 25, to: 28, map: (parameters) => ({ ...parameters }) },
  { family: "roll-total", from: 1, to: 2, map: (parameters) => ({ ...parameters }) },
  { family: "ability-modifier", from: 8, to: 9, map: (parameters) => ({ ...parameters }) },
  // issue-orders-open v3 adds as_if_phase, issuer_keywords and same_order; order-rule v3 the
  // recipient-keywords rule. Every earlier leaf keeps its meaning.
  { family: "issue-orders-open", from: 2, to: 3, map: (parameters) => ({ ...parameters }) },
  { family: "order-rule", from: 2, to: 3, map: (parameters) => ({ ...parameters }) },
  // eligibility-permission v11 adds despite embarked ("even though it is embarked within a TRANSPORT").
  { family: "eligibility-permission", from: 10, to: 11, map: (parameters) => ({ ...parameters }) },
  // attack v10 lets a targeted attack's unit point back (antecedent); stratagem-target v6 allows count_max 1.
  // Every earlier leaf keeps its meaning.
  { family: "attack", from: 9, to: 10, map: (parameters) => ({ ...parameters }) },
  { family: "stratagem-target", from: 5, to: 7, map: (parameters) => ({ ...parameters }) },
  // resource-gain v7 and army-construction v5 accept a combat-patrol value in a battle-size table;
  // every earlier leaf keeps its meaning.
  { family: "resource-gain", from: 6, to: 7, map: (parameters) => ({ ...parameters }) },
  { family: "army-construction", from: 4, to: 5, map: (parameters) => ({ ...parameters }) },
  // instead v3 adds the optional `secondary` marker; every v2 leaf keeps its meaning.
  { family: "instead", from: 2, to: 3, map: (parameters) => ({ ...parameters }) },
  // named-option v5 adds the optional `secondary` marker, targeting-restriction v10 the charged-this-phase
  // target history; every earlier leaf keeps its meaning.
  { family: "named-option", from: 4, to: 5, map: (parameters) => ({ ...parameters }) },
  { family: "targeting-restriction", from: 9, to: 10, map: (parameters) => ({ ...parameters }) },
  // unit-mark v3 drops the hidden mark: hidden is the core-rules state unit-state reads.
  { family: "unit-mark", from: 2, to: 3, map: (parameters) => (parameters.mark === "hidden" ? null : { ...parameters }) },
  {
    family: "unit-mark",
    from: 2,
    to_family: "unit-state",
    to: 18,
    map: (parameters) => (parameters.mark === "hidden" ? { states: ["hidden"], subject: parameters.subject, negated: parameters.negated } : null),
  },
  // Yield Points: resource-spend v5 adds any, {up_to} and bind_as; resource-gain v7 also takes {difference_to};
  // resource v2 gained_this_turn; characteristic-modifier v22, characteristic-amount v2 and
  // return-models v8 a {spent} amount; dice-roll v11 plus_if; bearer-eligibility v9 wargear.
  // Every earlier leaf keeps its meaning.
  { family: "resource-spend", from: 4, to: 6, map: (parameters) => ({ ...parameters }) },
  { family: "resource", from: 1, to: 3, map: (parameters) => ({ ...parameters }) },
  { family: "characteristic-modifier", from: 21, to: 23, map: (parameters) => ({ ...parameters }) },
  { family: "characteristic-amount", from: 1, to: 2, map: (parameters) => ({ ...parameters }) },
  { family: "return-models", from: 7, to: 9, map: (parameters) => ({ ...parameters }) },
  { family: "dice-roll", from: 10, to: 12, map: (parameters) => ({ ...parameters }) },
  { family: "bearer-eligibility", from: 8, to: 9, map: (parameters) => ({ ...parameters }) },
  // Chaos Daemons: resource v3 holder opponent; optional-cost-paid v3 a Flux token spend; destroy-models v5
  // chosen_by; rule-state v5 sub_rule and aspect; sticky-objective v5 a designation tag.
  // Every earlier leaf keeps its meaning.
  { family: "resource", from: 2, to: 3, map: (parameters) => ({ ...parameters }) },
  { family: "optional-cost-paid", from: 2, to: 3, map: (parameters) => ({ ...parameters }) },
  { family: "destroy-models", from: 4, to: 5, map: (parameters) => ({ ...parameters }) },
  { family: "rule-state", from: 4, to: 6, map: (parameters) => ({ ...parameters }) },
  { family: "sticky-objective", from: 4, to: 5, map: (parameters) => ({ ...parameters }) },
  // apply-mark v10: the registry gains pyrogenesis-flux-spent; v11 six Stratagem targets (seers-eye, spirit-mark-psychic,
  // rites-of-exorcism, execution-order, exemplars-wisdom, virtue-of-courage); v12 avenge-the-star-children and
  // vengeance-for-the-martyr.
  { family: "apply-mark", from: 9, to: 12, map: (parameters) => ({ ...parameters }) },
  { family: "apply-mark", from: 10, to: 12, map: (parameters) => ({ ...parameters }) },
  { family: "apply-mark", from: 11, to: 12, map: (parameters) => ({ ...parameters }) },
  // choice-open v5 adds id (Feed the Swarm's Regenerate); ability-activate v6 adds immediate; ability-modifier
  // v8 names a record's option ({ability_id, option_id}) and adds the amount and received aspects. Every
  // earlier leaf keeps its meaning.
  { family: "choice-open", from: 4, to: 5, map: (parameters) => ({ ...parameters }) },
  { family: "ability-activate", from: 5, to: 6, map: (parameters) => ({ ...parameters }) },
  { family: "ability-modifier", from: 7, to: 9, map: (parameters) => ({ ...parameters }) },
  // return-models v9 adds exclude_model_keyword ("(excluding CHARACTERS)"); every earlier leaf keeps its meaning.
  { family: "return-models", from: 8, to: 9, map: (parameters) => ({ ...parameters }) },
  // Miracle dice + Pain: wounds-remaining v2 takes a spent amount ({spent}); every earlier leaf keeps its meaning.
  { family: "wounds-remaining", from: 1, to: 2, map: (parameters) => ({ ...parameters }) },
  // event v42: a resource-spent moment takes object_owner ("Empower units from your army").
  { family: "event", from: 41, to: 43, map: (parameters) => ({ ...parameters }) },
  // objective-criterion v3: occupied-by ("that has a friendly unit with this ability within range of it").
  { family: "objective-criterion", from: 2, to: 3, map: (parameters) => ({ ...parameters }) },
  // resource-die v2: value roll-result ("with a value equal to that result").
  { family: "resource-die", from: 1, to: 2, map: (parameters) => ({ ...parameters }) },
  // rule-state v6: ability_keyword names every ability with that tag, and subject unmarked (with tag) the units neither
  // carrying the tag nor part of a unit that does ("Pain abilities only apply to a unit while it is Empowered").
  { family: "rule-state", from: 5, to: 6, map: (parameters) => ({ ...parameters }) },
  // set-up v7: unengaged, printed inside the set-up's own wording.
  { family: "set-up", from: 6, to: 7, map: (parameters) => ({ ...parameters }) },
  // resource-spend v6: {up_to} takes at_least ("spend 1-3 Pain tokens").
  { family: "resource-spend", from: 5, to: 6, map: (parameters) => ({ ...parameters }) },
  // Long-tail batch A: critical-hit-threshold v2 value success; characteristic-set v11 Range.
  // Every earlier leaf keeps its meaning.
  { family: "critical-hit-threshold", from: 1, to: 2, map: (parameters) => ({ ...parameters }) },
  { family: "characteristic-set", from: 10, to: 11, map: (parameters) => ({ ...parameters }) },
  // feel-no-pain v6: against damage-1-unmodified, or a list of mortal, psychic and devastating-wounds.
  { family: "feel-no-pain", from: 5, to: 6, map: (parameters) => ({ ...parameters }) },
  // fight-on-death v3: act shoot-or-fight, after the attacking unit finishes.
  { family: "fight-on-death", from: 2, to: 3, map: (parameters) => ({ ...parameters }) },
  // roll-modifier v14 and characteristic-modifier v23: not_cumulative (negative-modifiers, or {ability}).
  { family: "roll-modifier", from: 13, to: 14, map: (parameters) => ({ ...parameters }) },
  { family: "characteristic-modifier", from: 22, to: 23, map: (parameters) => ({ ...parameters }) },
  // make-move v9: as_if_keywords (FLY) for that move.
  { family: "make-move", from: 8, to: 9, map: (parameters) => ({ ...parameters }) },
  // select-objective-open v2: visible_to.
  { family: "select-objective-open", from: 1, to: 2, map: (parameters) => ({ ...parameters }) },
  // usage-limit v7: count_from equipped-wargear.
  { family: "usage-limit", from: 6, to: 7, map: (parameters) => ({ ...parameters }) },
  // counts-as v4: model_count_below for a weapon ability's purposes (Blast).
  { family: "counts-as", from: 3, to: 5, map: (parameters) => ({ ...parameters }) },
  // Long-tail batch B: event v43 (an any-of destroyed-unit filter, the last model, a state change's cause and side,
  // a CP gained from an ability, before-removal, before-deadly-demise and before-marker-removal timings);
  // unit-activity v27 destroyed-by-event-subject-this-phase; designated-filter v4 at phase-start; unit-keyword v9
  // subject event-object; roll-result v4 from {battle_round_plus: 1}. Every earlier leaf keeps its meaning.
  { family: "event", from: 42, to: 43, map: (parameters) => ({ ...parameters }) },
  { family: "unit-activity", from: 26, to: 28, map: (parameters) => ({ ...parameters }) },
  { family: "designated-filter", from: 3, to: 5, map: (parameters) => ({ ...parameters }) },
  { family: "unit-keyword", from: 8, to: 9, map: (parameters) => ({ ...parameters }) },
  { family: "roll-result", from: 3, to: 4, map: (parameters) => ({ ...parameters }) },
  // battlefield-marker v6: a relocate takes min_enemy_distance. Every earlier leaf keeps its meaning.
  { family: "battlefield-marker", from: 5, to: 6, map: (parameters) => ({ ...parameters }) },
  // Long-tail batch C: stratagem-target v7 bind_as; counts-as v5 of {bound} and for_abilities.
  // Every earlier leaf keeps its meaning.
  { family: "stratagem-target", from: 6, to: 7, map: (parameters) => ({ ...parameters }) },
  { family: "counts-as", from: 4, to: 5, map: (parameters) => ({ ...parameters }) },
  // ignore-modifiers v5: subject attack; v6: choice any-or-all.
  { family: "ignore-modifiers", from: 4, to: 6, map: (parameters) => ({ ...parameters }) },
  { family: "ignore-modifiers", from: 5, to: 6, map: (parameters) => ({ ...parameters }) },
  // designated-filter v5: by {bound: name}.
  { family: "designated-filter", from: 4, to: 5, map: (parameters) => ({ ...parameters }) },
  // triggering-target v7: bind_as.
  { family: "triggering-target", from: 6, to: 7, map: (parameters) => ({ ...parameters }) },
  // target-is-selected v4: unit event-subject.
  { family: "target-is-selected", from: 3, to: 4, map: (parameters) => ({ ...parameters }) },
  // unit-activity v28: suffered and inflicted mortal wounds this phase; subject disembarked-from.
  { family: "unit-activity", from: 27, to: 28, map: (parameters) => ({ ...parameters }) },
  // dice-roll v12: count_history.
  { family: "dice-roll", from: 11, to: 12, map: (parameters) => ({ ...parameters }) },
  // unit-filter v21: state destroyed.
  { family: "unit-filter", from: 20, to: 21, map: (parameters) => ({ ...parameters }) },
  // regain-wounds v10: amount 2D6.
  { family: "regain-wounds", from: 9, to: 10, map: (parameters) => ({ ...parameters }) },
];

export type FamilyVersionReport = {
  migrated_fingerprints: number;
  migrated_annotations: number;
  repointed_proposals: number;
  repointed_surfaces: number;
  repointed_judgments: number;
  /** Candidate judgments dropped because the successor already holds the same judgment key. */
  judgment_conflicts: number;
  /** Leaf-proposal pieces moved to the current version of their family. */
  migrated_proposal_pieces: number;
  /** Leaf-proposal pieces on a retired version with no current meaning; left as they are. */
  unmapped_proposal_pieces: number;
  /** Approved compiled entries carried to their sources' new inputs. */
  carried_approvals: number;
  unmapped: Array<{ fingerprint_id: string; family_id: string; active_annotations: number }>;
};

/**
 * Apply successive mappings from one version until no later mapping exists, so a leaf moves
 * straight to the current version even across several bumps. When several mappings leave one
 * version (a kind that moved to another family), the first that gives a meaning wins; they are
 * written so at most one does.
 */
export function mapToLatest(
  family: string,
  from: number,
  parameters: Record<string, unknown>,
  mappings: readonly VersionMapping[] = FAMILY_VERSION_MAPPINGS,
): { family: string; version: number; parameters: Record<string, unknown> } | null {
  let current = { family, version: from, parameters };
  for (;;) {
    const steps = mappings.filter((item) => item.family === current.family && item.from === current.version);
    if (steps.length === 0) return current;
    const next = steps.map((step) => ({ step, parameters: step.map(current.parameters) })).find((item) => item.parameters);
    if (!next) return null;
    current = { family: next.step.to_family ?? current.family, version: next.step.to, parameters: next.parameters! };
  }
}

export function upgradeFamilyVersions(db: DatabaseSync, mappings: readonly VersionMapping[] = FAMILY_VERSION_MAPPINGS): FamilyVersionReport {
  const report: FamilyVersionReport = {
    migrated_fingerprints: 0, migrated_annotations: 0, repointed_proposals: 0, repointed_surfaces: 0, repointed_judgments: 0,
    judgment_conflicts: 0, migrated_proposal_pieces: 0, unmapped_proposal_pieces: 0, carried_approvals: 0, unmapped: [],
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
  const sources = [...new Map(mappings.map((item) => [`${item.family}@${item.from}`, item])).values()];
  const work: Array<{ fingerprint: string; successor: string }> = [];
  for (const mapping of sources) {
    const fingerprints = db.prepare(`
      SELECT id, parameters_json FROM fingerprints WHERE family_id = ? AND family_version = ? ORDER BY id
    `).all(mapping.family, mapping.from) as Array<{ id: string; parameters_json: string }>;
    for (const fingerprint of fingerprints) {
      const mapped = mapToLatest(mapping.family, mapping.from, JSON.parse(fingerprint.parameters_json) as Record<string, unknown>, mappings);
      if (!mapped) {
        const active = (db.prepare("SELECT count(*) AS n FROM annotations WHERE fingerprint_id = ? AND status = 'active'").get(fingerprint.id) as { n: number }).n;
        if (active > 0) report.unmapped.push({ fingerprint_id: fingerprint.id, family_id: mapping.family, active_annotations: active });
        continue;
      }
      work.push({ fingerprint: fingerprint.id, successor: validateFingerprint(db, mapped.family, mapped.parameters, mapped.version) });
    }
  }
  // The approvals each touched source holds on its inputs before the move.
  const touched = new Set<number>();
  const sourceOf = db.prepare("SELECT source_spans.ability_version_id AS id FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id WHERE annotations.fingerprint_id = ?");
  for (const { fingerprint } of work) for (const row of sourceOf.all(fingerprint) as Array<{ id: number }>) touched.add(row.id);
  const approvedBefore = approvalsOnCurrentInputs(db, touched);

  const annotationsOf = db.prepare("SELECT id, span_id, status FROM annotations WHERE fingerprint_id = ? ORDER BY id");
  const onSuccessor = db.prepare("SELECT id FROM annotations WHERE span_id = ? AND fingerprint_id = ? AND status = ?");
  for (const { fingerprint, successor } of work) {
    for (const annotation of annotationsOf.all(fingerprint) as Array<{ id: number; span_id: number; status: string }>) {
      const twin = onSuccessor.get(annotation.span_id, successor, annotation.status) as { id: number } | undefined;
      if (twin) {
        // Two old meanings that now read the same (bearer and this-model) fold into one annotation.
        foldAnnotation(db, annotation.id, twin.id);
        member.run(batch(), "annotation-folded", String(annotation.id));
      } else {
        db.prepare("UPDATE annotations SET fingerprint_id = ? WHERE id = ?").run(successor, annotation.id);
        member.run(batch(), "annotation-migrated", String(annotation.id));
      }
      report.migrated_annotations += 1;
    }
    report.repointed_proposals += Number(db.prepare("UPDATE proposals SET fingerprint_id = ? WHERE fingerprint_id = ?").run(successor, fingerprint).changes);
    report.repointed_surfaces += Number(db.prepare("UPDATE leaf_surfaces SET fingerprint_id = ? WHERE fingerprint_id = ?").run(successor, fingerprint).changes);
    const judgments = repointJudgments(db, fingerprint, successor);
    report.repointed_judgments += judgments.repointed;
    report.judgment_conflicts += judgments.conflicts;
    db.prepare("DELETE FROM fingerprints WHERE id = ?").run(fingerprint);
    member.run(batch(), "fingerprint-migrated", fingerprint);
    report.migrated_fingerprints += 1;
  }
  // A retired version the registry no longer defines, and no fingerprint uses, is gone.
  for (const mapping of sources) {
    if (REVIEWED_FAMILY_REGISTRY.some((family) => family.id === mapping.family && family.version === mapping.from)) continue;
    db.prepare(`
      DELETE FROM semantic_families WHERE id = ? AND version = ? AND status = 'deprecated'
        AND NOT EXISTS (SELECT 1 FROM fingerprints WHERE family_id = semantic_families.id AND family_version = semantic_families.version)
        AND NOT EXISTS (SELECT 1 FROM family_candidates WHERE mapped_family_id = semantic_families.id AND mapped_family_version = semantic_families.version)
    `).run(mapping.family, mapping.from);
  }
  if (work.length > 0) report.carried_approvals = carryApprovals(db, approvedBefore, batch());
  const pieces = migrateProposalPieces(db, mappings);
  report.migrated_proposal_pieces = pieces.migrated;
  report.unmapped_proposal_pieces = pieces.unmapped;
  return report;
}

/** Move every reference to annotation `from` onto `to`, then delete `from`. */
function foldAnnotation(db: DatabaseSync, from: number, to: number): void {
  db.prepare("UPDATE annotations SET derived_from_annotation_id = ? WHERE derived_from_annotation_id = ?").run(to, from);
  db.prepare("UPDATE annotations SET supersedes_id = NULL WHERE supersedes_id = ?").run(from);
  db.prepare("UPDATE leaf_surfaces SET authorizing_annotation_id = ? WHERE authorizing_annotation_id = ?").run(to, from);
  db.prepare("UPDATE source_atom_reviews SET contained_by_annotation_id = ? WHERE contained_by_annotation_id = ?").run(to, from);
  db.prepare("DELETE FROM annotations WHERE id = ?").run(from);
}

/**
 * Move judgments of a candidate against the old fingerprint to the successor. A judgment whose
 * key (candidate, fingerprint, source artifact) the successor already holds is dropped, and
 * counted.
 */
function repointJudgments(db: DatabaseSync, from: string, to: string): { repointed: number; conflicts: number } {
  const repointed = Number(db.prepare("UPDATE OR IGNORE candidate_judgments SET queried_fingerprint_id = ? WHERE queried_fingerprint_id = ?").run(to, from).changes);
  const conflicts = Number(db.prepare("DELETE FROM candidate_judgments WHERE queried_fingerprint_id = ?").run(from).changes);
  return { repointed, conflicts };
}

type StoredPiece = Record<string, unknown> & { family_id?: unknown; family_version?: unknown; parameters?: unknown };

/**
 * Rewrite each leaf-proposal piece that names a retired family version to the current version,
 * so accepting it records a current fingerprint. Dismissed proposals are rewritten too: their
 * pieces are what keeps a later run's identical proposal hidden.
 */
function migrateProposalPieces(db: DatabaseSync, mappings: readonly VersionMapping[]): { migrated: number; unmapped: number } {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'leaf_proposals'").get();
  if (!table) return { migrated: 0, unmapped: 0 };
  const update = db.prepare("UPDATE leaf_proposals SET pieces_json = ? WHERE id = ?");
  let migrated = 0;
  let unmapped = 0;
  for (const row of db.prepare("SELECT id, pieces_json FROM leaf_proposals ORDER BY id").all() as Array<{ id: number; pieces_json: string }>) {
    let changed = false;
    const pieces = (JSON.parse(row.pieces_json) as StoredPiece[]).map((piece) => {
      if (typeof piece.family_id !== "string" || typeof piece.family_version !== "number" || !piece.parameters || typeof piece.parameters !== "object") return piece;
      const mapped = mapToLatest(piece.family_id, piece.family_version, piece.parameters as Record<string, unknown>, mappings);
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
