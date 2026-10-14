import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { currentFamilyVersion, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY, validateFingerprint } from "../src/round5c/contracts.js";
import { initializeWorkbench, insertSpan } from "../src/round5c/db.js";
import { FAMILY_VERSION_MAPPINGS, mapToLatest, upgradeFamilyVersions } from "../src/round5c/family-versions.js";
import { refreshSources } from "../src/round5c/source.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };

// Fabricated fixture prose only.
const TARGETED = "Each time an attack targets the bearer";
const TARGETED_MODEL = "Each time an attack targets this model";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(records: Array<{ ability_id: string; raw_text: string }>): DatabaseSync {
  const root = mkdtempSync(join(tmpdir(), "round5c-family-versions-"));
  roots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(records.map((record) => ({ faction_id: "alpha", ...record }))));
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, root);
  return db;
}

/** A leaf on a retired version, written the way an earlier workbench did. Returns its fingerprint and span. */
function legacyLeaf(db: DatabaseSync, abilityId: string, exactText: string, familyId: string, version: number, parameters: object): { fingerprint: string; span: number } {
  const row = db.prepare("SELECT id, source_text FROM abilities WHERE current = 1 AND ability_id = ?").get(abilityId) as { id: number; source_text: string };
  const start = Buffer.byteLength(row.source_text.slice(0, row.source_text.indexOf(exactText)));
  const span = insertSpan(db, row.id, "RAW_TEXT", start, start + Buffer.byteLength(exactText), exactText);
  db.prepare("UPDATE semantic_families SET status = 'active' WHERE id = ? AND version = ?").run(familyId, version);
  const fingerprint = validateFingerprint(db, familyId, parameters as never, version, exactText);
  db.prepare("UPDATE semantic_families SET status = 'deprecated' WHERE id = ? AND version = ?").run(familyId, version);
  db.prepare("INSERT OR IGNORE INTO annotation_batches (id, operation, reviewer, created_at) VALUES ('legacy', 'review', 'r', 'x')").run();
  db.prepare("INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, created_at) VALUES (?, ?, 'active', 'manual', 'human', 'r', 'legacy', 'x')").run(span, fingerprint);
  return { fingerprint, span };
}

describe("Round 5C family version registry", () => {
  it("gives every retired version a way forward and no current version a bearer", () => {
    for (const family of REVIEWED_FAMILY_REGISTRY.filter((item) => item.deprecated)) {
      expect(FAMILY_VERSION_MAPPINGS.some((mapping) => mapping.family === family.id && mapping.from === family.version), `${family.id}@${family.version}`).toBe(true);
    }
    for (const mapping of FAMILY_VERSION_MAPPINGS) {
      expect(REVIEWED_FAMILY_REGISTRY.find((item) => item.id === mapping.family && item.version === mapping.from)?.deprecated, `${mapping.family}@${mapping.from}`).toBe(true);
    }
    // "The bearer" is this model: no current leaf can say it a second way.
    for (const family of REVIEWED_FAMILY_REGISTRY.filter((item) => !item.deprecated)) {
      expect(JSON.stringify(family.parameterSchema), `${family.id}@${family.version}`).not.toMatch(/"bearer"/u);
    }
  });

  const collapses: Array<[string, number, Record<string, unknown>, Record<string, unknown>]> = [
    ["characteristic-set", 1, { subject: "bearer", characteristic: "M", value: 7 }, { subject: "this-model", characteristic: "M", value: 7 }],
    ["weapon-ability-grant", 1, { subject: "bearer", keyword: "Lethal Hits" }, { subject: "this-model", keyword: "Lethal Hits", weapon_type: "all" }],
    ["weapon-ability-grant", 2, { subject: "bearer", keyword: "Sustained Hits 1", weapon_type: "melee" }, { subject: "this-model", keyword: "Sustained Hits 1", weapon_type: "melee" }],
    ["feel-no-pain", 1, { subject: "bearer", threshold: 5, against: "mortal" }, { subject: "this-model", threshold: 5, against: "mortal" }],
    ["invulnerable-save", 1, { subject: "bearer", threshold: 4 }, { subject: "this-model", threshold: 4 }],
    ["fights-first", 1, { subject: "bearer" }, { subject: "this-model" }],
    ["no-advance-roll", 1, { subject: "bearer" }, { subject: "this-model" }],
    ["act-after-move", 1, { subject: "bearer", moves: ["advance"], acts: ["charge"] }, { subject: "this-model", moves: ["advance"], acts: ["charge"] }],
    ["regain-wounds", 1, { subject: "bearer", amount: "D3" }, { subject: "this-model", amount: "D3" }],
    ["characteristic-modifier", 1, { subject: "bearer", characteristic: "OC", operation: "add", value: 1 },
      { subject: "this-model", characteristics: ["OC"], operation: "add", value: 1, weapon_type: "all" }],
    ["characteristic-modifier", 2, { subject: "bearer", characteristics: ["S"], operation: "add", value: 1, weapon_type: "melee" },
      { subject: "this-model", characteristics: ["S"], operation: "add", value: 1, weapon_type: "melee" }],
    ["attack", 1, { direction: "targeted", unit: "bearer", attack_type: "any" }, { direction: "targeted", unit: "this-model", attack_type: "any" }],
    ["optional-use", 1, { who: "bearer" }, { who: "this-model" }],
  ];

  it.each(collapses)("moves %s@%i bearer to this-model at the current version", (family, from, parameters, expected) => {
    const mapped = mapToLatest(family, from, parameters);
    expect(mapped).toEqual({ family, version: currentFamilyVersion(family), parameters: expected });
    expect(normalizeFingerprintParameters(family, mapped!.parameters, mapped!.version)).toEqual(expected);
    // The retired spelling is not a current value.
    const withBearer = Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, value === "this-model" ? "bearer" : value]));
    expect(() => normalizeFingerprintParameters(family, withBearer, mapped!.version)).toThrow(TypeError);
  });

  it("leaves every other value alone, bearer's unit and the attack included", () => {
    expect(mapToLatest("attack", 1, { direction: "makes", unit: "bearers-unit", attack_type: "melee" })?.parameters).toEqual({ direction: "makes", unit: "bearers-unit", attack_type: "melee" });
    expect(mapToLatest("optional-use", 1, { who: "you" })?.parameters).toEqual({ who: "you" });
    expect(mapToLatest("characteristic-modifier", 2, { subject: "attack", characteristics: ["S"], operation: "add", value: 1, weapon_type: "all" })?.parameters.subject).toBe("attack");
    expect(mapToLatest("feel-no-pain", 1, { subject: "this-unit", threshold: 6, against: "all" })).toEqual({ family: "feel-no-pain", version: 2, parameters: { subject: "this-unit", threshold: 6, against: "all" } });
  });

  it("moves every event kind to version 6, and an old attack event through attack to its current version", () => {
    expect(mapToLatest("event", 5, { kind: "enemy-has-shot" })).toEqual({ family: "event", version: 9, parameters: { kind: "enemy-has-shot" } });
    expect(mapToLatest("event", 4, { kind: "phase-end", phase: "fight", turn: "your" })).toEqual({ family: "event", version: 9, parameters: { kind: "phase-end", phase: "fight", turn: "your" } });
    expect(mapToLatest("event", 3, { kind: "attack-made" })).toEqual({ family: "attack", version: 4, parameters: { direction: "makes", unit: "that-unit", attack_type: "any" } });
    expect(normalizeFingerprintParameters("event", { kind: "this-model-destroyed" }, 6)).toEqual({ kind: "this-model-destroyed" });
    expect(() => normalizeFingerprintParameters("event", { kind: "this-model-destroyed" }, 5)).toThrow(/event.kind/u);
  });
});

describe("Round 5C family version upgrade", () => {
  it("merges the bearer and this-model meanings of one span into one annotation and one decided surface", () => {
    const db = fixture([
      { ability_id: "ward", raw_text: `${TARGETED}, subtract 1 from the Hit roll.` },
      { ability_id: "hide", raw_text: `${TARGETED_MODEL}, subtract 1 from the Wound roll.` },
    ]);
    try {
      const bearer = legacyLeaf(db, "ward", TARGETED, "attack", 1, { direction: "targeted", unit: "bearer", attack_type: "any" });
      // The same span also carries the this-model reading: once bearer is this-model they are one meaning.
      db.prepare("UPDATE semantic_families SET status = 'active' WHERE id = 'attack' AND version = 1").run();
      const model = validateFingerprint(db, "attack", { direction: "targeted", unit: "this-model", attack_type: "any" }, 1, TARGETED);
      db.prepare("UPDATE semantic_families SET status = 'deprecated' WHERE id = 'attack' AND version = 1").run();
      db.prepare("INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, created_at) VALUES (?, ?, 'active', 'manual', 'human', 'r', 'legacy', 'x')").run(bearer.span, model);
      legacyLeaf(db, "hide", TARGETED_MODEL, "attack", 1, { direction: "targeted", unit: "this-model", attack_type: "any" });
      db.prepare("INSERT INTO leaf_surfaces (normalized_surface, fingerprint_id, status, authority_kind, batch_id, created_at) VALUES (?, ?, 'active', 'human', 'legacy', 'x')").run(TARGETED.toLowerCase(), bearer.fingerprint);

      const report = upgradeFamilyVersions(db);
      expect(report).toMatchObject({ migrated_fingerprints: 2, migrated_annotations: 3, repointed_surfaces: 1, unmapped: [] });
      const successor = validateFingerprint(db, "attack", { direction: "targeted", unit: "this-model", attack_type: "any" }, 4);
      const active = db.prepare("SELECT span_id, fingerprint_id FROM annotations WHERE status = 'active' ORDER BY span_id").all() as Array<{ span_id: number; fingerprint_id: string }>;
      // One annotation per span, both on the one current fingerprint: no duplicate for the merged span.
      expect(active).toHaveLength(2);
      expect(new Set(active.map((row) => row.fingerprint_id))).toEqual(new Set([successor]));
      expect(db.prepare("SELECT fingerprint_id FROM leaf_surfaces WHERE normalized_surface = ?").get(TARGETED.toLowerCase())).toEqual({ fingerprint_id: successor });
      expect(db.prepare("SELECT status FROM fingerprints WHERE id IN (?, ?)").all(bearer.fingerprint, model)).toEqual([{ status: "superseded" }, { status: "superseded" }]);
      expect(upgradeFamilyVersions(db)).toMatchObject({ migrated_fingerprints: 0, migrated_annotations: 0, repointed_surfaces: 0 });
    } finally {
      db.close();
    }
  });

  it("repoints candidate judgments to the successor and keeps a clashing one as history", () => {
    const db = fixture([{ ability_id: "ward", raw_text: `${TARGETED}, subtract 1 from the Hit roll.` }]);
    try {
      const bearer = legacyLeaf(db, "ward", TARGETED, "feel-no-pain", 1, { subject: "bearer", threshold: 5, against: "all" });
      const model = legacyLeaf(db, "ward", TARGETED, "feel-no-pain", 1, { subject: "this-model", threshold: 5, against: "all" });
      const judge = db.prepare("INSERT INTO candidate_judgments (candidate_id, queried_fingerprint_id, verdict, source_artifact_hash, source_row_json) VALUES (?, ?, 'exact-match', ?, '{}')");
      const hash = "a".repeat(64);
      judge.run("cand-shared", bearer.fingerprint, hash);
      judge.run("cand-shared", model.fingerprint, hash);
      judge.run("cand-bearer-only", bearer.fingerprint, hash);

      const report = upgradeFamilyVersions(db);
      const successor = validateFingerprint(db, "feel-no-pain", { subject: "this-model", threshold: 5, against: "all" }, 2);
      expect(report).toMatchObject({ repointed_judgments: 2, judgment_conflicts: 1 });
      const onSuccessor = db.prepare("SELECT candidate_id FROM candidate_judgments WHERE queried_fingerprint_id = ? ORDER BY candidate_id").all(successor);
      expect(onSuccessor).toEqual([{ candidate_id: "cand-bearer-only" }, { candidate_id: "cand-shared" }]);
      expect(db.prepare("SELECT COUNT(*) AS count FROM candidate_judgments").get()).toEqual({ count: 3 });
    } finally {
      db.close();
    }
  });

  it("rewrites leaf-proposal pieces on retired versions, dismissed ones too, and reports those with no current meaning", () => {
    const db = fixture([{ ability_id: "ward", raw_text: `${TARGETED}, subtract 1 from the Hit roll.` }]);
    try {
      const run = Number(db.prepare("INSERT INTO leaf_proposal_runs (model, settings_json, status, started_at) VALUES ('m', '{}', 'finished', 'x')").run().lastInsertRowid);
      const insert = db.prepare("INSERT INTO leaf_proposals (run_id, cluster, surface, sample_text, kind, pieces_json, confidence, occurrences, closes, status) VALUES (?, 0, ?, ?, ?, ?, 0.5, 1, 1, ?)");
      const piece = (family_id: string, family_version: number, role: string, parameters: object) => ({ text: "t", family_id, family_version, role, parameters, confidence: 0.5, neighbours: [] });
      const open = Number(insert.run(run, "open one", "Open one", "partial", JSON.stringify([
        piece("attack", 1, "EVENT", { direction: "targeted", unit: "bearer", attack_type: "any" }),
        { text: "rest", family_id: null },
        piece("reroll", 1, "EFFECT", { roll: "hit", subset: "ones" }),
      ]), "open").lastInsertRowid);
      const dismissed = Number(insert.run(run, "dismissed one", "Dismissed one", "direct", JSON.stringify([
        piece("weapon-ability-grant", 1, "EFFECT", { subject: "bearer", keyword: "Lethal Hits" }),
      ]), "dismissed").lastInsertRowid);
      const retired = Number(insert.run(run, "retired one", "Retired one", "direct", JSON.stringify([
        piece("event", 2, "EVENT", { kind: "phase-start" }),
      ]), "open").lastInsertRowid);
      const pieces = (id: number) => JSON.parse((db.prepare("SELECT pieces_json FROM leaf_proposals WHERE id = ?").get(id) as { pieces_json: string }).pieces_json) as unknown[];
      const retiredBefore = pieces(retired);

      const report = upgradeFamilyVersions(db);
      // reroll also migrates now (its version 2 adds weapon_type, defaulting old leaves to "all").
      expect(report).toMatchObject({ migrated_proposal_pieces: 3, unmapped_proposal_pieces: 1 });
      expect(pieces(open)).toEqual([
        piece("attack", 4, "EVENT", { direction: "targeted", unit: "this-model", attack_type: "any" }),
        { text: "rest", family_id: null },
        piece("reroll", 2, "EFFECT", { roll: "hit", subset: "ones", weapon_type: "all" }),
      ]);
      // weapon-ability-grant now continues 3->4 too (version 4 only adds optional filters/flags; identity map).
      expect(pieces(dismissed)).toEqual([piece("weapon-ability-grant", 4, "EFFECT", { subject: "this-model", keyword: "Lethal Hits", weapon_type: "all" })]);
      // A phase start that never named its phase has no current meaning; it is left, not guessed.
      expect(pieces(retired)).toEqual(retiredBefore);
      expect(upgradeFamilyVersions(db)).toMatchObject({ migrated_proposal_pieces: 0 });
    } finally {
      db.close();
    }
  });
});
