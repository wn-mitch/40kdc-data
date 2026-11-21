import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { currentFamilyVersion, validateFingerprint } from "../src/semantic-authoring/contracts.js";
import { initializeWorkbench, insertSpan } from "../src/semantic-authoring/db.js";
import { upgradeFamilyVersions } from "../src/semantic-authoring/family-versions.js";
import { applyLeafSurfaces, backfillLeafSurfaces, leafBoard, qualifiedAt, reapplyLeafSurfaces } from "../src/semantic-authoring/leaves.js";
import { getAbility } from "../src/semantic-authoring/review.js";
import { refreshSources } from "../src/semantic-authoring/source.js";
import { applyAnnotationBatch, confirmSurface, mergeFingerprints, moveSurface, retireSurface, undoBatch } from "./semantic-authoring-human.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";
// Fabricated fixture prose only.
const LEAD = "While this model is leading a unit";
const CP = "gain 1CP";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Record = { faction_id: string; ability_id: string; raw_text: string };

function store(records: Record[]): string {
  const root = mkdtempSync(join(tmpdir(), "semantic-authoring-leaves-"));
  roots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(records));
  return root;
}

function fixture(records: Record[]): { db: DatabaseSync; root: string } {
  const root = store(records);
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, root);
  return { db, root };
}

function current(db: DatabaseSync, abilityId: string): { id: number; source_text: string; source_hash: string } {
  const row = db.prepare("SELECT id, source_text, source_hash FROM abilities WHERE current = 1 AND ability_id = ?").get(abilityId);
  if (!row) throw new Error(`Missing ${abilityId}`);
  return row as { id: number; source_text: string; source_hash: string };
}

function leaves(db: DatabaseSync, abilityId: string): Array<{ family_id: string; exact_text: string; parameters: unknown }> {
  return getAbility(db, current(db, abilityId).id).annotations.map(({ family_id, exact_text, parameters }) => ({ family_id, exact_text, parameters }));
}

const cpMeaning = { family_id: "resource-action", parameters: { resource: "command-point", operation: "gain", amount: 1 } };
const leadMeaning = { family_id: "leading-unit", parameters: { subject: "this-model", attachment: "leading" } };

describe("Semantic authoring leaf surfaces", () => {
  it("applies one decision to every current copy, including byte-identical sources in other factions", () => {
    const { db } = fixture([
      { faction_id: "alpha", ability_id: "one", raw_text: `At the start of your turn, ${CP}.` },
      { faction_id: "alpha", ability_id: "two", raw_text: `Once per battle, ${CP}.` },
      { faction_id: "beta", ability_id: "copy", raw_text: `At the start of your turn, ${CP}.` },
      { faction_id: "beta", ability_id: "other", raw_text: "Re-roll a Hit roll of 1." },
    ]);
    try {
      const report = confirmSurface(db, { reviewer: REVIEWER, exact_text: CP, ...cpMeaning });
      expect(report).toMatchObject({ applied: 3, already: 0, blocked: [] });
      for (const id of ["one", "two", "copy"]) expect(leaves(db, id)).toEqual([{ family_id: "resource-action", exact_text: CP, parameters: cpMeaning.parameters }]);
      expect(leaves(db, "other")).toEqual([]);
      // Confirming again changes nothing.
      expect(confirmSurface(db, { reviewer: REVIEWER, exact_text: CP, ...cpMeaning })).toMatchObject({ applied: 0, already: 3 });
      // surfaceOccurrences finds these three occurrences by the indexed source_spans.normalized_surface
      // column, not a corpus-wide JS-side renormalize of every proposal; pin that insertSpan actually
      // populates it, matching every occurrence confirmSurface just applied.
      const normalized = (db.prepare("SELECT DISTINCT normalized_surface FROM source_spans WHERE exact_text = ?").all(CP) as Array<{ normalized_surface: string | null }>);
      expect(normalized).toHaveLength(1);
      expect(normalized[0]!.normalized_surface).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it("keeps several spellings of one meaning under one leaf and refuses a second meaning for a spelling", () => {
    const { db } = fixture([
      { faction_id: "alpha", ability_id: "short", raw_text: `Then ${CP}.` },
      { faction_id: "alpha", ability_id: "long", raw_text: "Then gain 1 Command point." },
    ]);
    try {
      confirmSurface(db, { reviewer: REVIEWER, exact_text: CP, ...cpMeaning });
      confirmSurface(db, { reviewer: REVIEWER, exact_text: "gain 1 Command point", ...cpMeaning });
      const board = leafBoard(db);
      expect(board.leaves).toHaveLength(1);
      expect(board.leaves[0]!.surfaces.map((surface) => surface.surface).sort()).toEqual(["gain 1 command point", "gain 1cp"]);
      expect(() => confirmSurface(db, { reviewer: REVIEWER, exact_text: CP, family_id: "resource-action", parameters: { resource: "command-point", operation: "gain", amount: 2 } }))
        .toThrow(/already means resource-action/u);
    } finally {
      db.close();
    }
  });

  it("reports occurrences another leaf or a human rejection already decides, without writing them", () => {
    const { db } = fixture([
      { faction_id: "alpha", ability_id: "free", raw_text: `Then ${CP}.` },
      { faction_id: "alpha", ability_id: "taken", raw_text: `Then ${CP}.` },
      { faction_id: "alpha", ability_id: "refused", raw_text: `Then ${CP}.` },
    ]);
    try {
      const taken = current(db, "taken");
      const start = Buffer.byteLength("Then ");
      applyAnnotationBatch(db, { reviewer: REVIEWER, decisions: [{
        action: "confirm", ability_version_id: taken.id, source_hash: taken.source_hash, fragment: "RAW_TEXT",
        start_byte: start, end_byte: start + CP.length, exact_text: CP, role: "EFFECT", ...cpMeaning,
        parameters: { resource: "command-point", operation: "gain", amount: { source: "1" } },
      }] });
      const refused = current(db, "refused");
      const spanId = insertSpan(db, refused.id, "RAW_TEXT", start, start + CP.length, CP);
      const fingerprint = validateFingerprint(db, "resource-action", cpMeaning.parameters, 1, CP);
      db.prepare("INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, created_at) VALUES (?, ?, 'EFFECT', 'fixture', 'rejected', '{}', ?)")
        .run(spanId, fingerprint, new Date().toISOString());
      const report = confirmSurface(db, { reviewer: REVIEWER, exact_text: CP, ...cpMeaning });
      expect(report.applied).toBe(1);
      expect(report.blocked.map((item) => [item.ability_id, item.reason]).sort()).toEqual([["refused", "REJECTED_HERE"], ["taken", "OTHER_LEAF_HERE"]]);
      expect(leaves(db, "refused")).toEqual([]);
      expect(leaves(db, "taken")[0]!.parameters).toEqual({ resource: "command-point", operation: "gain", amount: { source: "1" } });
    } finally {
      db.close();
    }
  });

  it("does not write a leaf over bytes a human marked as a connective, whatever the family's current version", () => {
    const { db } = fixture([
      { faction_id: "alpha", ability_id: "free", raw_text: `Then ${CP}.` },
      { faction_id: "alpha", ability_id: "glue", raw_text: `Then ${CP}.` },
    ]);
    try {
      const glue = current(db, "glue");
      const start = Buffer.byteLength("Then ");
      // An accepted connective covering the whole occurrence, keyed to no fingerprint at all.
      const spanId = insertSpan(db, glue.id, "RAW_TEXT", start, start + CP.length, CP);
      db.prepare("INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, created_at) VALUES (?, NULL, 'CONNECTIVE', 'connective-span', 'accepted', '{}', ?)")
        .run(spanId, new Date().toISOString());
      const report = confirmSurface(db, { reviewer: REVIEWER, exact_text: CP, ...cpMeaning });
      expect(report.applied).toBe(1);
      expect(report.blocked.map((item) => [item.ability_id, item.reason])).toEqual([["glue", "CONNECTIVE_HERE"]]);
      expect(leaves(db, "glue")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("accepts pending proposals it confirms and undoes the whole decision", () => {
    const { db } = fixture([
      { faction_id: "alpha", ability_id: "one", raw_text: `Then ${CP}.` },
      { faction_id: "alpha", ability_id: "two", raw_text: `Now ${CP}.` },
    ]);
    try {
      const one = current(db, "one");
      const start = Buffer.byteLength("Then ");
      const spanId = insertSpan(db, one.id, "RAW_TEXT", start, start + CP.length, CP);
      const fingerprint = validateFingerprint(db, "resource-action", cpMeaning.parameters, 1, CP);
      const proposal = Number(db.prepare("INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, created_at) VALUES (?, ?, 'EFFECT', 'luna', 'pending', '{}', ?)")
        .run(spanId, fingerprint, new Date().toISOString()).lastInsertRowid);
      const report = confirmSurface(db, { reviewer: REVIEWER, exact_text: CP, ...cpMeaning });
      expect(report.applied).toBe(2);
      expect(db.prepare("SELECT status FROM proposals WHERE id = ?").get(proposal)).toEqual({ status: "accepted" });
      undoBatch(db, report.batch_id, { reviewer: REVIEWER });
      expect(leaves(db, "one")).toEqual([]);
      expect(leaves(db, "two")).toEqual([]);
      expect(db.prepare("SELECT status FROM proposals WHERE id = ?").get(proposal)).toEqual({ status: "pending" });
      expect(db.prepare("SELECT status FROM leaf_surfaces WHERE id = ?").get(report.surface_id)).toEqual({ status: "retired" });
    } finally {
      db.close();
    }
  });

  it("moves a spelling to a new meaning and undoes the move exactly", () => {
    const { db } = fixture([
      { faction_id: "alpha", ability_id: "one", raw_text: "Re-roll the Hit roll." },
      { faction_id: "alpha", ability_id: "two", raw_text: "Then re-roll the Hit roll." },
    ]);
    try {
      const first = confirmSurface(db, { reviewer: REVIEWER, exact_text: "Re-roll the Hit roll", family_id: "reroll", parameters: { roll: "hit", subset: "failed", weapon_type: "all" } });
      const moved = moveSurface(db, { reviewer: REVIEWER, surface_id: first.surface_id, family_id: "reroll", parameters: { roll: "hit", subset: "all", weapon_type: "all" } });
      for (const id of ["one", "two"]) expect(leaves(db, id).map((leaf) => leaf.parameters)).toEqual([{ roll: "hit", subset: "all", weapon_type: "all" }]);
      expect(() => moveSurface(db, { reviewer: REVIEWER, surface_id: moved.surface_id, family_id: "leading-unit", parameters: leadMeaning.parameters }))
        .toThrow(/cannot change its role/u);
      undoBatch(db, moved.batch_id, { reviewer: REVIEWER });
      for (const id of ["one", "two"]) expect(leaves(db, id).map((leaf) => leaf.parameters)).toEqual([{ roll: "hit", subset: "failed", weapon_type: "all" }]);
      expect(db.prepare("SELECT status FROM leaf_surfaces WHERE id = ?").get(first.surface_id)).toEqual({ status: "active" });
    } finally {
      db.close();
    }
  });

  it("merges two leaves, re-points pending proposals, and restores everything on undo", () => {
    const { db } = fixture([
      { faction_id: "alpha", ability_id: "failed", raw_text: "Re-roll a failed Hit roll." },
      { faction_id: "alpha", ability_id: "all", raw_text: "Re-roll the Hit roll." },
      { faction_id: "alpha", ability_id: "pending", raw_text: "Now re-roll a failed Hit roll." },
    ]);
    try {
      const failedFingerprint = validateFingerprint(db, "reroll", { roll: "hit", subset: "failed", weapon_type: "all" }, currentFamilyVersion("reroll"));
      const allFingerprint = validateFingerprint(db, "reroll", { roll: "hit", subset: "all", weapon_type: "all" }, currentFamilyVersion("reroll"));
      const failed = confirmSurface(db, { reviewer: REVIEWER, exact_text: "Re-roll a failed Hit roll", family_id: "reroll", parameters: { roll: "hit", subset: "failed", weapon_type: "all" } });
      confirmSurface(db, { reviewer: REVIEWER, exact_text: "Re-roll the Hit roll", family_id: "reroll", parameters: { roll: "hit", subset: "all", weapon_type: "all" } });
      expect(failed.applied).toBe(2);
      // A retired pending proposal elsewhere follows the merge.
      const extra = current(db, "all");
      const proposalSpan = insertSpan(db, extra.id, "RAW_TEXT", 0, Buffer.byteLength("Re-roll"), "Re-roll");
      const proposal = Number(db.prepare("INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, created_at) VALUES (?, ?, 'EFFECT', 'luna', 'pending', '{}', ?)")
        .run(proposalSpan, failedFingerprint, new Date().toISOString()).lastInsertRowid);
      const merged = mergeFingerprints(db, { reviewer: REVIEWER, from_fingerprint_id: failedFingerprint, to_fingerprint_id: allFingerprint });
      expect(leaves(db, "failed").map((leaf) => leaf.parameters)).toEqual([{ roll: "hit", subset: "all", weapon_type: "all" }]);
      expect(db.prepare("SELECT fingerprint_id FROM proposals WHERE id = ?").get(proposal)).toEqual({ fingerprint_id: allFingerprint });
      expect(db.prepare("SELECT status FROM fingerprints WHERE id = ?").get(failedFingerprint)).toEqual({ status: "superseded" });
      expect(leafBoard(db).leaves.map((leaf) => leaf.fingerprint_id)).toEqual([allFingerprint]);
      undoBatch(db, merged.batch_id, { reviewer: REVIEWER });
      expect(leaves(db, "failed").map((leaf) => leaf.parameters)).toEqual([{ roll: "hit", subset: "failed", weapon_type: "all" }]);
      expect(db.prepare("SELECT fingerprint_id FROM proposals WHERE id = ?").get(proposal)).toEqual({ fingerprint_id: failedFingerprint });
      expect(db.prepare("SELECT status FROM fingerprints WHERE id = ?").get(failedFingerprint)).toEqual({ status: "active" });
    } finally {
      db.close();
    }
  });

  it("applies decided surfaces to new source versions, and a retired surface stops applying", () => {
    const records = [{ faction_id: "alpha", ability_id: "one", raw_text: `Then ${CP}.` }];
    const { db, root } = fixture(records);
    try {
      const decision = confirmSurface(db, { reviewer: REVIEWER, exact_text: CP, ...cpMeaning });
      writeFileSync(join(root, "fixture.json"), JSON.stringify([...records, { faction_id: "alpha", ability_id: "new", raw_text: `Later, ${CP}.` }]));
      refreshSources(db, root);
      expect(leaves(db, "new")).toEqual([]);
      expect(applyLeafSurfaces(db, { reviewer: REVIEWER })).toMatchObject({ applied: 1, already: 1 });
      expect(leaves(db, "new")).toHaveLength(1);
      retireSurface(db, { reviewer: REVIEWER, surface_id: decision.surface_id });
      writeFileSync(join(root, "fixture.json"), JSON.stringify([...records, { faction_id: "alpha", ability_id: "newer", raw_text: `Again, ${CP}.` }]));
      refreshSources(db, root);
      expect(applyLeafSurfaces(db, { reviewer: REVIEWER })).toMatchObject({ applied: 0 });
      expect(leaves(db, "newer")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("ranks untiled wording by the sources it would finish, ignoring punctuation and joining words", () => {
    const { db } = fixture([
      { faction_id: "alpha", ability_id: "nearly", raw_text: `${LEAD}, ${CP}.` },
      { faction_id: "alpha", ability_id: "joined", raw_text: `${LEAD} and ${CP}.` },
      { faction_id: "alpha", ability_id: "bare", raw_text: `${CP}.` },
    ]);
    try {
      confirmSurface(db, { reviewer: REVIEWER, exact_text: LEAD, ...leadMeaning });
      let board = leafBoard(db);
      expect(board.untiled[0]).toMatchObject({ surface: "gain 1cp", unlocks: 2, occurrences: 3 });
      expect(board.untiled.map((entry) => entry.surface)).not.toContain("and");
      expect(board.totals).toMatchObject({ current_sources: 3, tiled_sources: 0, sources_with_leaves: 2 });
      confirmSurface(db, { reviewer: REVIEWER, exact_text: CP, ...cpMeaning });
      board = leafBoard(db);
      expect(board.untiled).toEqual([]);
      expect(board.totals).toMatchObject({ tiled_sources: 3, sources_with_leaves: 3 });
    } finally {
      db.close();
    }
  });

  it("backfills surfaces once, only for spellings reviewers gave a single meaning", () => {
    const { db } = fixture([
      { faction_id: "alpha", ability_id: "one", raw_text: `Then ${CP}.` },
      { faction_id: "alpha", ability_id: "two", raw_text: "Re-roll the Hit roll." },
      { faction_id: "alpha", ability_id: "three", raw_text: "Now re-roll the Hit roll." },
    ]);
    try {
      const confirm = (abilityId: string, exactText: string, familyId: string, parameters: object) => {
        const row = current(db, abilityId);
        const start = Buffer.byteLength(row.source_text.slice(0, row.source_text.indexOf(exactText)));
        applyAnnotationBatch(db, { reviewer: REVIEWER, decisions: [{ action: "confirm", ability_version_id: row.id, source_hash: row.source_hash, fragment: "RAW_TEXT", start_byte: start, end_byte: start + Buffer.byteLength(exactText), exact_text: exactText, role: "EFFECT", family_id: familyId, parameters }] });
      };
      confirm("one", CP, "resource-action", cpMeaning.parameters);
      confirm("two", "Re-roll the Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all" });
      confirm("three", "re-roll the Hit roll", "reroll", { roll: "hit", subset: "failed", weapon_type: "all" });
      expect(backfillLeafSurfaces(db)).toEqual({ created: 1, conflicting: 1 });
      expect(db.prepare("SELECT normalized_surface FROM leaf_surfaces WHERE status = 'active'").all()).toEqual([{ normalized_surface: "gain 1cp" }]);
      expect(backfillLeafSurfaces(db)).toEqual({ created: 0, conflicting: 0 });
    } finally {
      db.close();
    }
  });
});

describe("Semantic authoring leaf re-application", () => {
  it("reaches sources that arrive after a decision, and leaves no batch when nothing is new", () => {
    const { db, root } = fixture([{ faction_id: "alpha", ability_id: "one", raw_text: `At the start of your turn, ${CP}.` }]);
    try {
      confirmSurface(db, { reviewer: REVIEWER, exact_text: CP, ...cpMeaning });
      writeFileSync(join(root, "fixture.json"), JSON.stringify([
        { faction_id: "alpha", ability_id: "one", raw_text: `At the start of your turn, ${CP}.` },
        { faction_id: "beta", ability_id: "two", raw_text: `When this unit is destroyed, ${CP}.` },
      ]));
      refreshSources(db, root);
      expect(leaves(db, "two")).toEqual([]);
      expect(reapplyLeafSurfaces(db)).toMatchObject({ applied: 1, already: 1 });
      expect(leaves(db, "two").map((item) => item.family_id)).toEqual(["resource-action"]);
      const batches = () => (db.prepare("SELECT count(*) AS total FROM annotation_batches").get() as { total: number }).total;
      const before = batches();
      expect(reapplyLeafSurfaces(db)).toMatchObject({ applied: 0, already: 2 });
      expect(batches()).toBe(before);
    } finally {
      db.close();
    }
  });
});

describe("Semantic authoring joining words", () => {
  it("needs no leaf for joining words or leftover HTML entities", () => {
    const { db } = fixture([{ faction_id: "alpha", ability_id: "one", raw_text: `${LEAD}, ${CP}. In addition, then ${CP}.&#x20;` }]);
    try {
      confirmSurface(db, { reviewer: REVIEWER, exact_text: LEAD, ...leadMeaning });
      confirmSurface(db, { reviewer: REVIEWER, exact_text: CP, ...cpMeaning });
      expect(leafBoard(db).untiled).toEqual([]);
      expect(leafBoard(db).totals.tiled_sources).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("Semantic authoring family versions", () => {
  it("decides a buff leaf everywhere and rejects values outside the game's range", () => {
    const text = "models in that unit have the Feel No Pain 5+ ability";
    const { db } = fixture([
      { faction_id: "alpha", ability_id: "one", raw_text: `${LEAD}, ${text}.` },
      { faction_id: "beta", ability_id: "two", raw_text: `${LEAD}, ${text}.` },
    ]);
    try {
      expect(confirmSurface(db, { reviewer: REVIEWER, exact_text: text, family_id: "feel-no-pain", parameters: { subject: "this-unit", threshold: 5, against: "all" } })).toMatchObject({ applied: 2 });
      expect(() => confirmSurface(db, { reviewer: REVIEWER, exact_text: text, family_id: "invulnerable-save", parameters: { subject: "this-unit", threshold: 7 } }))
        .toThrow(/integer from 2 to 6/u);
    } finally {
      db.close();
    }
  });

  it("leaves qualified wording to its own spelling, and undo takes the longer leaf back out", () => {
    const short = "weapons equipped by models in that unit have the [LETHAL HITS] ability";
    const long = `melee ${short}`;
    const grant = (weaponType: string) => ({ family_id: "weapon-ability-grant", parameters: { subject: "this-unit", keyword: "Lethal Hits", weapon_type: weaponType } });
    const { db } = fixture([
      { faction_id: "alpha", ability_id: "any", raw_text: `${LEAD}, ${short}.` },
      { faction_id: "alpha", ability_id: "melee", raw_text: `${LEAD}, ${long}.` },
    ]);
    try {
      // "melee" narrows the shorter wording, so it does not claim the melee source.
      expect(confirmSurface(db, { reviewer: REVIEWER, exact_text: short, ...grant("all") }))
        .toMatchObject({ applied: 1, blocked: [expect.objectContaining({ ability_id: "melee", reason: "QUALIFIED_HERE" })] });
      const decided = confirmSurface(db, { reviewer: REVIEWER, exact_text: long, ...grant("melee") });
      expect(decided).toMatchObject({ applied: 1, blocked: [] });
      const params = (id: string) => leaves(db, id).filter((item) => item.family_id === "weapon-ability-grant").map((item) => (item.parameters as { weapon_type: string }).weapon_type);
      expect(params("melee")).toEqual(["melee"]);
      expect(params("any")).toEqual(["all"]);
      // Deciding the shorter wording again cannot shrink the longer leaf.
      expect(confirmSurface(db, { reviewer: REVIEWER, exact_text: short, ...grant("all") })).toMatchObject({ applied: 0, blocked: [expect.objectContaining({ ability_id: "melee", reason: "OTHER_LEAF_HERE" })] });
      undoBatch(db, decided.batch_id, { reviewer: REVIEWER });
      expect(params("melee")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("re-queues a source when a longer wording is undone: the shorter wording's surface writes its leaf afresh", () => {
    const long = `${CP} at the start of the battle round`;
    const { db } = fixture([{ faction_id: "alpha", ability_id: "cp", raw_text: `${LEAD}, ${long}.` }]);
    try {
      confirmSurface(db, { reviewer: REVIEWER, exact_text: CP, ...cpMeaning });
      const row = () => db.prepare(`
        SELECT annotations.id, source_spans.exact_text FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
        JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
        WHERE annotations.status = 'active' AND fingerprints.family_id = 'resource-action'
      `).all() as Array<{ id: number; exact_text: string }>;
      const [shorter] = row();
      expect(shorter!.exact_text).toBe(CP);
      // Longer wording wins: the longer decision replaces the shorter leaf inside it.
      const decided = confirmSurface(db, { reviewer: REVIEWER, exact_text: long, ...cpMeaning });
      expect(row().map((item) => item.exact_text)).toEqual([long]);

      undoBatch(db, decided.batch_id, { reviewer: REVIEWER });
      // The replaced row is not restored; the shorter surface, still decided, writes a new one.
      const [again] = row();
      expect(again!.exact_text).toBe(CP);
      expect(again!.id).not.toBe(shorter!.id);
      expect(db.prepare("SELECT status FROM annotations WHERE id = ?").get(shorter!.id)).toEqual({ status: "superseded" });
    } finally {
      db.close();
    }
  });

  it("refuses to undo a batch from before the history compaction, and undoes one from after it", () => {
    const { db } = fixture([{ faction_id: "alpha", ability_id: "cp", raw_text: `${LEAD}, ${CP}.` }]);
    try {
      const older = confirmSurface(db, { reviewer: REVIEWER, exact_text: CP, ...cpMeaning });
      const compactedAt = new Date(Date.now() + 1000).toISOString();
      db.prepare("UPDATE workbench_state SET history_compacted_at = ? WHERE singleton = 1").run(compactedAt);
      expect(() => undoBatch(db, older.batch_id, { reviewer: REVIEWER })).toThrow(/predates the workbench history compaction/u);
      expect(leaves(db, "cp").map((leaf) => leaf.exact_text)).toEqual([CP]);
      db.prepare("UPDATE annotation_batches SET created_at = ? WHERE id = ?").run(new Date(Date.now() + 2000).toISOString(), older.batch_id);
      undoBatch(db, older.batch_id, { reviewer: REVIEWER });
      expect(leaves(db, "cp")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("treats a keyword before a noun as a qualifier but not before a duration, clause or determiner", () => {
    const at = (text: string, match: string) => qualifiedAt(text, Buffer.byteLength(text.slice(0, text.indexOf(match))));
    expect(at("select one **INFANTRY** unit from your army", "unit from your army")).toBe(true);
    expect(at("**PSYKER** models in your unit have the Feel No Pain 4+ ability", "models in your unit")).toBe(true);
    expect(at("melee weapons equipped by models in that unit have", "weapons equipped")).toBe(true);
    expect(at("this unit is not **eligible to declare a charge** until the end of the turn", "until the end of the turn")).toBe(false);
    expect(at("Is **riled up** until the start of your next turn", "until the start")).toBe(false);
    expect(at("If that unit is **BATTLE-SHOCKED** when this unit is selected to fight", "when this unit")).toBe(false);
    expect(at("those **riled up** models have -1 to wound rolls", "have -1")).toBe(false);
  });

  it("accepts melee and valued weapon abilities but not unit keywords", () => {
    const { db } = fixture([{ faction_id: "alpha", ability_id: "grant", raw_text: "Melee weapons equipped by models in that unit have the [SUSTAINED HITS 1] ability." }]);
    try {
      const exact = "Melee weapons equipped by models in that unit have the [SUSTAINED HITS 1] ability";
      expect(confirmSurface(db, { reviewer: REVIEWER, exact_text: exact, family_id: "weapon-ability-grant", parameters: { subject: "this-unit", keyword: "Sustained Hits 1", weapon_type: "melee" } })).toMatchObject({ applied: 1 });
      expect(() => confirmSurface(db, { reviewer: REVIEWER, exact_text: exact, family_id: "weapon-ability-grant", parameters: { subject: "this-unit", keyword: "Stealth", weapon_type: "melee" } }))
        .toThrow(/named weapon ability/u);
      expect(() => validateFingerprint(db, "weapon-ability-grant", { subject: "this-unit", keyword: "Sustained Hits 2", weapon_type: "melee" }, undefined, exact))
        .toThrow(/must occur in the exact source span/u);
    } finally {
      db.close();
    }
  });
});
