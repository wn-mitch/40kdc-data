import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { humanActor } from "../src/semantic-authoring/authority.js";
import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { compilationInputsHash } from "../src/semantic-authoring/compiled.js";
import { confirmConnectiveSpan, relabelConnective } from "../src/semantic-authoring/connective-surfaces.js";
import { connectiveRowsSql, reviewedConnectives } from "../src/semantic-authoring/connective-rows.js";
import { initializeWorkbench } from "../src/semantic-authoring/db.js";
import { tiledSources } from "../src/semantic-authoring/leaf-view.js";
import { propagateDuplicateTexts } from "../src/semantic-authoring/propagate.js";
import { applyAnnotationBatch, undoBatch } from "./semantic-authoring-human.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
type DatabaseSync = DatabaseType;

// Fabricated fixture prose, not rules text.
const SOURCE = "After the squad fires, it can relocate 5 inches. If it does, the squad is barred from charging.";
const REVIEWER = "fixture-reviewer";

let artifacts: string;
let previousArtifacts: string | undefined;
beforeEach(() => {
  previousArtifacts = process.env.SEMANTIC_AUTHORING_ARTIFACT_DIR;
  artifacts = mkdtempSync(join(tmpdir(), "semantic-authoring-connective-rows-"));
  process.env.SEMANTIC_AUTHORING_ARTIFACT_DIR = artifacts;
});
afterEach(() => {
  if (previousArtifacts === undefined) delete process.env.SEMANTIC_AUTHORING_ARTIFACT_DIR;
  else process.env.SEMANTIC_AUTHORING_ARTIFACT_DIR = previousArtifacts;
  rmSync(artifacts, { recursive: true, force: true });
});

function addAbility(db: DatabaseSync, abilityId: string): number {
  return Number(db.prepare(`
    INSERT INTO abilities (faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, metadata_json, fragments_json, current)
    VALUES ('fixture', ?, ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
  `).run(abilityId, hashJson({ text: SOURCE }), SOURCE, abilityId, JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(SOURCE), text: SOURCE }])).lastInsertRowid);
}

function bytes(text: string): { start_byte: number; end_byte: number; exact_text: string } {
  const start = SOURCE.indexOf(text);
  if (start < 0) throw new Error(`Missing ${text}`);
  return { start_byte: Buffer.byteLength(SOURCE.slice(0, start)), end_byte: Buffer.byteLength(SOURCE.slice(0, start + text.length)), exact_text: text };
}

/** One record with its three leaves confirmed, and a copy of its text that holds none yet. */
function fixture(relation: string | undefined): { db: DatabaseSync; source: number; twin: number; proposal: number } {
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  const source = addAbility(db, "fade-step");
  const twin = addAbility(db, "fade-step-twin");
  const leaf = (text: string, role: string, family_id: string, parameters: Record<string, unknown>) =>
    ({ action: "confirm", ability_version_id: source, source_hash: hashJson({ text: SOURCE }), fragment: "RAW_TEXT", ...bytes(text), role, family_id, parameters });
  applyAnnotationBatch(db, {
    reviewer: REVIEWER,
    decisions: [
      leaf("After the squad fires", "EVENT", "event", { kind: "after-shooting" }),
      leaf("it can relocate 5 inches", "EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: 5 }),
      leaf("the squad is barred from charging", "EFFECT", "eligibility-permission", { subject: "this-unit", activity: "declare-charge", allow: false }),
    ],
  });
  confirmConnectiveSpan(db, { reviewer: REVIEWER, ability_version_id: source, exact_text: "If it does", ...(relation ? { relation } : {}) }, humanActor(REVIEWER, "test"));
  const proposal = (db.prepare("SELECT id FROM proposals WHERE role = 'CONNECTIVE'").get() as { id: number }).id;
  return { db, source, twin, proposal };
}

const setRelation = (db: DatabaseSync, proposal: number, relation: string) =>
  db.prepare("UPDATE proposals SET reason_json = json_set(reason_json, '$.reviewed_relation', ?) WHERE id = ?").run(relation, proposal);

/** The hash formula before connectives joined it: the source hash and its active leaves only. */
function leavesOnlyHash(db: DatabaseSync, id: number): string {
  const ability = db.prepare("SELECT source_hash FROM abilities WHERE id = ?").get(id) as { source_hash: string };
  const leaves = db.prepare(`
    SELECT source_spans.fragment, source_spans.start_byte, source_spans.end_byte, annotations.fingerprint_id, annotations.authority_kind
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE annotations.status = 'active' AND source_spans.ability_version_id = ?
    ORDER BY source_spans.fragment = 'NAME', source_spans.start_byte, source_spans.end_byte, source_spans.fragment, annotations.fingerprint_id, annotations.authority_kind
  `).all(id);
  return hashJson({ source_hash: ability.source_hash, leaves });
}

describe("reviewed connective rows", () => {
  it("gives a duplicate-text copy the relation of the row it copies, while that row stands", () => {
    const { db, twin, proposal } = fixture("condition-of");
    try {
      propagateDuplicateTexts(db, { dryRun: false });
      const copy = db.prepare(`
        SELECT proposals.id, proposals.reason_json FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
        WHERE proposals.role = 'CONNECTIVE' AND source_spans.ability_version_id = ?
      `).get(twin) as { id: number; reason_json: string };
      // The copy names its source and carries no relation of its own.
      expect(JSON.parse(copy.reason_json)).toEqual({ copied_from_proposal: proposal });
      const { start_byte, end_byte } = bytes("If it does");
      expect(reviewedConnectives(db, [twin])).toEqual([{ ability_version_id: twin, fragment: "RAW_TEXT", start_byte, end_byte, surface: "If it does", relation: "condition-of" }]);
      // A relation the copy records itself wins over its source's.
      setRelation(db, copy.id, "coexists-with");
      expect(reviewedConnectives(db, [twin])).toEqual([]);
      db.prepare("UPDATE proposals SET reason_json = json_remove(reason_json, '$.reviewed_relation') WHERE id = ?").run(copy.id);
      expect(reviewedConnectives(db, [twin])).toHaveLength(1);
      // A source that is no longer accepted gives nothing.
      db.prepare("UPDATE proposals SET status = 'rejected' WHERE id = ?").run(proposal);
      expect(reviewedConnectives(db, [twin])).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("relabels an accepted connective through its source, and undo restores the relation it replaced", () => {
    const { db, source, twin, proposal } = fixture("condition-of");
    const actor = humanActor(REVIEWER, "test");
    try {
      propagateDuplicateTexts(db, { dryRun: false });
      const copy = (db.prepare(`
        SELECT proposals.id FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
        WHERE proposals.role = 'CONNECTIVE' AND source_spans.ability_version_id = ?
      `).get(twin) as { id: number }).id;
      // A copy has no relation of its own to decide.
      expect(() => relabelConnective(db, { reviewer: REVIEWER, proposal_id: copy, relation: null }, actor)).toThrow(/is a copy of/u);
      expect(() => relabelConnective(db, { reviewer: REVIEWER, proposal_id: proposal, relation: "condition-of" }, actor)).toThrow(/already has relation/u);
      expect(() => relabelConnective(db, { reviewer: REVIEWER, proposal_id: proposal, relation: "means-something" }, actor)).toThrow(/not a known relation/u);
      const { batch_id } = relabelConnective(db, { reviewer: REVIEWER, proposal_id: proposal, relation: null }, actor);
      // Cleared at the source, so the copy follows.
      expect(reviewedConnectives(db, [source, twin])).toEqual([]);
      undoBatch(db, batch_id, { reviewer: REVIEWER });
      expect(reviewedConnectives(db, [source, twin]).map((row) => row.relation)).toEqual(["condition-of", "condition-of"]);
      // A relation changed after the relabel is not overwritten by undoing it.
      const again = relabelConnective(db, { reviewer: REVIEWER, proposal_id: proposal, relation: null }, actor);
      setRelation(db, proposal, "coexists-with");
      expect(() => undoBatch(db, again.batch_id, { reviewer: REVIEWER })).toThrow(/later changed/u);
    } finally {
      db.close();
    }
  });

  it("reads only the relations compilation consumes", () => {
    const { db, source, proposal } = fixture("coexists-with");
    try {
      expect(reviewedConnectives(db, [source])).toEqual([]);
      setRelation(db, proposal, "condition-of");
      expect(reviewedConnectives(db, [source]).map((row) => row.relation)).toEqual(["condition-of"]);
    } finally {
      db.close();
    }
  });

  it("attaches the connective to the leaf after it in the trusted view only, where it gates the compilation", () => {
    const { db, source } = fixture("condition-of");
    try {
      const [trusted] = tiledSources(db, { abilityVersionIds: new Set([source]) });
      const annotated = trusted!.leaves.filter((leaf) => leaf.connectives !== undefined);
      expect(annotated.map((leaf) => leaf.family_id)).toEqual(["eligibility-permission"]);
      expect(annotated[0]!.connectives).toEqual([{ relation: "condition-of", surface: "If it does", start_byte: bytes("If it does").start_byte, end_byte: bytes("If it does").end_byte }]);
      const compiled = compileLeaves(trusted!.leaves, trusted!.source_text);
      expect(compiled.ok && compiled.mechanics.trigger).toMatchObject({ optional: true });
      const [machine] = tiledSources(db, { abilityVersionIds: new Set([source]), includeMachine: true });
      expect(machine!.leaves.some((leaf) => leaf.connectives !== undefined)).toBe(false);
    } finally {
      db.close();
    }
  });
});

describe("compilation inputs hash", () => {
  it("is the leaves-only hash until a consumed connective is reviewed, and changes with that connective", () => {
    const { db, source, twin, proposal } = fixture(undefined);
    try {
      // An accepted connective with no relation, or one compilation does not read, leaves every hash as it was.
      expect(compilationInputsHash(db, source)).toBe(leavesOnlyHash(db, source));
      setRelation(db, proposal, "coexists-with");
      expect(compilationInputsHash(db, source)).toBe(leavesOnlyHash(db, source));
      propagateDuplicateTexts(db, { dryRun: false });
      const copyBefore = compilationInputsHash(db, twin);
      expect(copyBefore).toBe(leavesOnlyHash(db, twin));
      // Reviewing it as a condition changes the source's hash and, through the copy, its twin's.
      setRelation(db, proposal, "condition-of");
      expect(compilationInputsHash(db, source)).not.toBe(leavesOnlyHash(db, source));
      expect(compilationInputsHash(db, twin)).not.toBe(copyBefore);
    } finally {
      db.close();
    }
  });
});

describe("connective row lookup", () => {
  it("reads one version's connectives through its spans, not a scan of every accepted proposal", () => {
    // The inputs hash runs this per ability; a status-index scan made each call cost the whole
    // accepted-proposal table on the live workbench.
    const db = new DatabaseSync(":memory:");
    try {
      initializeWorkbench(db);
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${connectiveRowsSql([1])}`).all() as { detail: string }[]).map((row) => row.detail);
      expect(plan.some((detail) => detail.includes("source_spans_ability_lookup"))).toBe(true);
      expect(plan.some((detail) => detail.includes("proposals_span_role_lookup"))).toBe(true);
      expect(plan.some((detail) => detail.includes("proposals_status_origin_lookup"))).toBe(false);
    } finally {
      db.close();
    }
  });
});
