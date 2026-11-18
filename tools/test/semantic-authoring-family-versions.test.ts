import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { hashJson } from "../src/canonical-hash.js";
import { currentFamilyVersion, familyRole, REVIEWED_FAMILY_REGISTRY, seedReviewedFamilies, validateFingerprint } from "../src/semantic-authoring/contracts.js";
import { initializeWorkbench, insertSpan } from "../src/semantic-authoring/db.js";
import { FAMILY_VERSION_MAPPINGS, mapToLatest, upgradeFamilyVersions, type VersionMapping } from "../src/semantic-authoring/family-versions.js";
import { refreshSources } from "../src/semantic-authoring/source.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };

// Fabricated fixture prose only.
const TARGETED = "Each time an attack targets this model";
/** A version number no real family reaches: the retired version a synthetic bump leaves. */
const RETIRED = 900;
const FNP = "feel-no-pain";
const ward = (subject: string) => ({ subject, threshold: 5, against: "all" });

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(records: Array<{ ability_id: string; raw_text: string }>): DatabaseSync {
  const root = mkdtempSync(join(tmpdir(), "semantic-authoring-family-versions-"));
  roots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(records.map((record) => ({ faction_id: "alpha", ...record }))));
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, root);
  db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at) VALUES ('legacy', 'review', 'r', 'x')").run();
  return db;
}

function span(db: DatabaseSync, abilityId: string, exactText: string): number {
  const row = db.prepare("SELECT id, source_text FROM abilities WHERE current = 1 AND ability_id = ?").get(abilityId) as { id: number; source_text: string };
  const start = Buffer.byteLength(row.source_text.slice(0, row.source_text.indexOf(exactText)));
  return insertSpan(db, row.id, "RAW_TEXT", start, start + Buffer.byteLength(exactText), exactText);
}

/** A fingerprint on the retired version of `family`, as the workbench held it before a bump. */
function retiredFingerprint(db: DatabaseSync, family: string, parameters: Record<string, unknown>): string {
  db.prepare("INSERT OR IGNORE INTO semantic_families (id, version, role, parameter_schema_json, status) VALUES (?, ?, ?, '{}', 'deprecated')")
    .run(family, RETIRED, familyRole(family, currentFamilyVersion(family)));
  const hash = hashJson({ family, version: RETIRED, parameters });
  db.prepare("INSERT INTO fingerprints (id, family_id, family_version, parameters_json, canonical_hash, status) VALUES (?, ?, ?, ?, ?, 'active')")
    .run(`fp_${hash}`, family, RETIRED, JSON.stringify(parameters), hash);
  return `fp_${hash}`;
}

function annotate(db: DatabaseSync, spanId: number, fingerprint: string): number {
  return Number(db.prepare("INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, created_at) VALUES (?, ?, 'active', 'manual', 'human', 'r', 'legacy', 'x')")
    .run(spanId, fingerprint).lastInsertRowid);
}

/** The bump under test: the retired version's leaves move to the current version, `map`ped. */
const bump = (family: string, map: VersionMapping["map"] = (parameters) => parameters): VersionMapping[] =>
  [{ family, from: RETIRED, to: currentFamilyVersion(family), map }];

describe("Semantic authoring family registry", () => {
  it("keeps one current version per family, and maps only onto current versions", () => {
    expect(REVIEWED_FAMILY_REGISTRY.filter((family) => family.deprecated).map((family) => `${family.id}@${family.version}`)).toEqual([]);
    for (const family of REVIEWED_FAMILY_REGISTRY) expect(() => currentFamilyVersion(family.id), family.id).not.toThrow();
    for (const mapping of FAMILY_VERSION_MAPPINGS) expect(mapping.to, mapping.family).toBe(currentFamilyVersion(mapping.to_family ?? mapping.family));
  });

  it("gives no current family a bearer: this-model is the one way to name the model with the ability", () => {
    for (const family of REVIEWED_FAMILY_REGISTRY.filter((item) => !item.deprecated)) {
      expect(JSON.stringify(family.parameterSchema), `${family.id}@${family.version}`).not.toMatch(/"bearer"/u);
    }
  });

  it("deprecates the version a bump replaced on the next open, then drops it once no leaf uses it", () => {
    const db = fixture([{ ability_id: "ward", raw_text: `${TARGETED}, it has a 5+ Feel No Pain.` }]);
    try {
      // Before the bump, the replaced version was the current one: its row is active.
      const old = retiredFingerprint(db, FNP, ward("this-unit"));
      db.prepare("UPDATE semantic_families SET status = 'active' WHERE id = ? AND version = ?").run(FNP, RETIRED);
      annotate(db, span(db, "ward", TARGETED), old);
      const status = () => db.prepare("SELECT status FROM semantic_families WHERE id = ? AND version = ?").get(FNP, RETIRED);

      seedReviewedFamilies(db);
      expect(status()).toEqual({ status: "deprecated" });
      expect(db.prepare("SELECT count(*) AS n FROM semantic_families WHERE status = 'active'").get()).toEqual({ n: REVIEWED_FAMILY_REGISTRY.filter((family) => !family.deprecated).length });
      upgradeFamilyVersions(db, bump(FNP));
      expect(status()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("follows successive bumps to the last, and stops at a mapping with no meaning", () => {
    const chain: VersionMapping[] = [
      { family: "a", from: 1, to: 2, map: (parameters) => ({ ...parameters, two: true }) },
      { family: "a", from: 2, to_family: "b", to: 1, map: (parameters) => (parameters.drop ? null : { ...parameters, moved: true }) },
    ];
    expect(mapToLatest("a", 1, { x: 1 }, chain)).toEqual({ family: "b", version: 1, parameters: { x: 1, two: true, moved: true } });
    expect(mapToLatest("a", 1, { drop: true }, chain)).toBeNull();
    expect(mapToLatest("a", 3, { x: 1 }, chain)).toEqual({ family: "a", version: 3, parameters: { x: 1 } });
  });
});

describe("Semantic authoring family version bump", () => {
  it("moves a leaf to its successor fingerprint in place, re-points what named the old one, and drops the retired version", () => {
    const db = fixture([{ ability_id: "ward", raw_text: `${TARGETED}, it has a 5+ Feel No Pain.` }]);
    try {
      const old = retiredFingerprint(db, FNP, ward("bearer"));
      const spanId = span(db, "ward", TARGETED);
      const leaf = annotate(db, spanId, old);
      const proposal = Number(db.prepare("INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, created_at) VALUES (?, ?, 'EFFECT', 'luna', 'rejected', '{}', 'x')").run(spanId, old).lastInsertRowid);
      db.prepare("INSERT INTO leaf_surfaces (normalized_surface, fingerprint_id, status, authority_kind, batch_id, created_at) VALUES ('a retired spelling', ?, 'retired', 'human', 'legacy', 'x')").run(old);

      const report = upgradeFamilyVersions(db, bump(FNP, (parameters) => ({ ...parameters, subject: "this-model" })));
      const successor = validateFingerprint(db, FNP, ward("this-model"), currentFamilyVersion(FNP));
      expect(report).toMatchObject({ migrated_fingerprints: 1, migrated_annotations: 1, repointed_proposals: 1, repointed_surfaces: 1, unmapped: [] });
      // The same row, now on the successor: review undo still finds the leaf its batch wrote.
      expect(db.prepare("SELECT id, fingerprint_id, status FROM annotations").all()).toEqual([{ id: leaf, fingerprint_id: successor, status: "active" }]);
      // A rejection keeps refusing the meaning on its new fingerprint.
      expect(db.prepare("SELECT fingerprint_id, status FROM proposals WHERE id = ?").get(proposal)).toEqual({ fingerprint_id: successor, status: "rejected" });
      expect(db.prepare("SELECT fingerprint_id FROM leaf_surfaces").all()).toEqual([{ fingerprint_id: successor }]);
      expect(db.prepare("SELECT id FROM fingerprints WHERE id = ?").get(old)).toBeUndefined();
      expect(db.prepare("SELECT 1 FROM semantic_families WHERE id = ? AND version = ?").get(FNP, RETIRED)).toBeUndefined();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(upgradeFamilyVersions(db, bump(FNP))).toMatchObject({ migrated_fingerprints: 0, migrated_annotations: 0 });
    } finally {
      db.close();
    }
  });

  it("folds a leaf into the one its span already has with the same meaning, moving what cited it", () => {
    const db = fixture([
      { ability_id: "ward", raw_text: `${TARGETED}, it has a 5+ Feel No Pain.` },
      { ability_id: "copy", raw_text: `${TARGETED}, it has a 5+ Feel No Pain.` },
    ]);
    try {
      const spanId = span(db, "ward", TARGETED);
      const current = validateFingerprint(db, FNP, ward("this-model"), currentFamilyVersion(FNP));
      const kept = annotate(db, spanId, current);
      const old = retiredFingerprint(db, FNP, ward("bearer"));
      const folded = annotate(db, spanId, old);
      const copy = Number(db.prepare("INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, derived_from_annotation_id, created_at) VALUES (?, ?, 'active', 'duplicate-text', 'derived', 'r', 'legacy', ?, 'x')")
        .run(span(db, "copy", TARGETED), old, folded).lastInsertRowid);
      const surface = Number(db.prepare("INSERT INTO leaf_surfaces (normalized_surface, fingerprint_id, status, authority_kind, authorizing_annotation_id, batch_id, created_at) VALUES ('w', ?, 'active', 'human', ?, 'legacy', 'x')")
        .run(current, folded).lastInsertRowid);

      const report = upgradeFamilyVersions(db, bump(FNP, (parameters) => ({ ...parameters, subject: "this-model" })));
      expect(report).toMatchObject({ migrated_fingerprints: 1, migrated_annotations: 2 });
      expect(db.prepare("SELECT id FROM annotations WHERE id = ?").get(folded)).toBeUndefined();
      expect(db.prepare("SELECT fingerprint_id, derived_from_annotation_id FROM annotations WHERE id = ?").get(copy)).toEqual({ fingerprint_id: current, derived_from_annotation_id: kept });
      expect(db.prepare("SELECT authorizing_annotation_id FROM leaf_surfaces WHERE id = ?").get(surface)).toEqual({ authorizing_annotation_id: kept });
      expect(db.prepare("SELECT count(*) AS n FROM annotations WHERE span_id = ?").get(spanId)).toEqual({ n: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("re-points candidate judgments to the successor and drops one whose key the successor already holds", () => {
    const db = fixture([{ ability_id: "ward", raw_text: `${TARGETED}, it has a 5+ Feel No Pain.` }]);
    try {
      const old = retiredFingerprint(db, FNP, ward("bearer"));
      const successor = validateFingerprint(db, FNP, ward("this-model"), currentFamilyVersion(FNP));
      const judge = db.prepare("INSERT INTO candidate_judgments (candidate_id, queried_fingerprint_id, verdict, source_artifact_hash, source_row_json) VALUES (?, ?, 'exact-match', ?, '{}')");
      const hash = "a".repeat(64);
      judge.run("cand-shared", old, hash);
      judge.run("cand-shared", successor, hash);
      judge.run("cand-old-only", old, hash);

      const report = upgradeFamilyVersions(db, bump(FNP, (parameters) => ({ ...parameters, subject: "this-model" })));
      expect(report).toMatchObject({ repointed_judgments: 1, judgment_conflicts: 1 });
      expect(db.prepare("SELECT candidate_id, queried_fingerprint_id FROM candidate_judgments ORDER BY candidate_id").all()).toEqual([
        { candidate_id: "cand-old-only", queried_fingerprint_id: successor },
        { candidate_id: "cand-shared", queried_fingerprint_id: successor },
      ]);
    } finally {
      db.close();
    }
  });

  it("keeps a leaf whose bump gives no current meaning, and reports it for review", () => {
    const db = fixture([{ ability_id: "ward", raw_text: `${TARGETED}, it has a 5+ Feel No Pain.` }]);
    try {
      const old = retiredFingerprint(db, FNP, ward("bearer"));
      const leaf = annotate(db, span(db, "ward", TARGETED), old);
      const report = upgradeFamilyVersions(db, bump(FNP, () => null));
      expect(report.unmapped).toEqual([{ fingerprint_id: old, family_id: FNP, active_annotations: 1 }]);
      expect(db.prepare("SELECT fingerprint_id, status FROM annotations WHERE id = ?").get(leaf)).toEqual({ fingerprint_id: old, status: "active" });
      expect(db.prepare("SELECT 1 AS kept FROM semantic_families WHERE id = ? AND version = ?").get(FNP, RETIRED)).toEqual({ kept: 1 });
    } finally {
      db.close();
    }
  });

  it("rewrites leaf-proposal pieces on the retired version, dismissed ones too, and counts those with no meaning", () => {
    const db = fixture([{ ability_id: "ward", raw_text: `${TARGETED}, it has a 5+ Feel No Pain.` }]);
    try {
      const run = Number(db.prepare("INSERT INTO leaf_proposal_runs (model, settings_json, status, started_at) VALUES ('m', '{}', 'finished', 'x')").run().lastInsertRowid);
      const insert = db.prepare("INSERT INTO leaf_proposals (run_id, cluster, surface, sample_text, kind, pieces_json, confidence, occurrences, closes, status) VALUES (?, 0, ?, ?, ?, ?, 0.5, 1, 1, ?)");
      const piece = (family_version: number, parameters: object) => ({ text: "t", family_id: FNP, family_version, role: "EFFECT", parameters, confidence: 0.5, neighbours: [] });
      const open = Number(insert.run(run, "open one", "Open one", "partial", JSON.stringify([piece(RETIRED, ward("bearer")), { text: "rest", family_id: null }]), "open").lastInsertRowid);
      const dismissed = Number(insert.run(run, "dismissed one", "Dismissed one", "direct", JSON.stringify([piece(RETIRED, ward("bearer"))]), "dismissed").lastInsertRowid);
      const lost = Number(insert.run(run, "lost one", "Lost one", "direct", JSON.stringify([piece(RETIRED, { ...ward("bearer"), lost: true })]), "open").lastInsertRowid);
      const pieces = (id: number) => JSON.parse((db.prepare("SELECT pieces_json FROM leaf_proposals WHERE id = ?").get(id) as { pieces_json: string }).pieces_json) as unknown[];
      const lostBefore = pieces(lost);

      const report = upgradeFamilyVersions(db, bump(FNP, (parameters) => (parameters.lost ? null : { ...parameters, subject: "this-model" })));
      expect(report).toMatchObject({ migrated_proposal_pieces: 2, unmapped_proposal_pieces: 1 });
      const current = currentFamilyVersion(FNP);
      expect(pieces(open)).toEqual([piece(current, ward("this-model")), { text: "rest", family_id: null }]);
      expect(pieces(dismissed)).toEqual([piece(current, ward("this-model"))]);
      expect(pieces(lost)).toEqual(lostBefore);
    } finally {
      db.close();
    }
  });
});
