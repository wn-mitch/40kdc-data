import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { applySourceAtomBatch, proposeSourceAtom } from "../src/round5c/atoms.js";
import { getAbilityCoverage } from "../src/round5c/coverage.js";
import { initializeWorkbench } from "../src/round5c/db.js";
import { partitionExclusive, totalLength } from "../src/round5c/partition.js";
import { importLuna, prepareLuna } from "../src/round5c/proposal.js";
import { abilityReadiness } from "../src/round5c/readiness.js";
import { applyAnnotationBatch, getAbility, reviewAbility, undoBatch } from "../src/round5c/review.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
type DatabaseSync = DatabaseType;

// Fabricated fixture prose; the multibyte participant exercises UTF-8 boundaries.
const SOURCE = "Lead-state active; squad modèls repeat any Hit result.";
const REVIEWER = "fixture-reviewer";

let artifacts: string;
let previousArtifacts: string | undefined;
beforeEach(() => {
  previousArtifacts = process.env.ROUND5C_ARTIFACT_DIR;
  artifacts = mkdtempSync(join(tmpdir(), "round5c-atoms-"));
  process.env.ROUND5C_ARTIFACT_DIR = artifacts;
});
afterEach(() => {
  if (previousArtifacts === undefined) delete process.env.ROUND5C_ARTIFACT_DIR;
  else process.env.ROUND5C_ARTIFACT_DIR = previousArtifacts;
  rmSync(artifacts, { recursive: true, force: true });
});

type Fixture = { db: DatabaseSync; id: number; hash: string };

function fixture(source = SOURCE): Fixture {
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  const hash = hashJson({ text: source });
  const id = Number(db.prepare(`
    INSERT INTO abilities (faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, metadata_json, fragments_json, current)
    VALUES ('fixture', 'atoms', ?, ?, 'unit', 'fixture', 'atoms', '{}', ?, 1)
  `).run(hash, source, JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source), text: source }])).lastInsertRowid);
  return { db, id, hash };
}

function bytes(text: string, source = SOURCE): { start_byte: number; end_byte: number; exact_text: string } {
  const start = source.indexOf(text);
  if (start < 0) throw new Error(`Missing ${text}`);
  return { start_byte: Buffer.byteLength(source.slice(0, start)), end_byte: Buffer.byteLength(source.slice(0, start + text.length)), exact_text: text };
}

function confirm(value: Fixture, text: string, role: string, familyId: string, parameters: Record<string, unknown>): string {
  return applyAnnotationBatch(value.db, {
    reviewer: REVIEWER,
    decisions: [{ action: "confirm", ability_version_id: value.id, source_hash: value.hash, fragment: "RAW_TEXT", ...bytes(text), role, family_id: familyId, parameters }],
  }).batch_id;
}

function propose(value: Fixture, text: string, kind: string, extra: Record<string, unknown> = {}) {
  return proposeSourceAtom(value.db, {
    ability_version_id: value.id, source_hash: value.hash, fragment: "RAW_TEXT", ...bytes(text), kind,
    description: `fixture ${kind}`, reviewer: REVIEWER, ...extra,
  });
}

function accept(value: Fixture, proposalId: number, extra: Record<string, unknown> = {}): string {
  return applySourceAtomBatch(value.db, {
    reviewer: REVIEWER,
    decisions: [{ atom_proposal_id: proposalId, action: "accept", source_hash: value.hash, ...extra }],
  }).batch_id;
}

function paintLeaves(value: Fixture): void {
  confirm(value, "Lead-state active", "CONDITION", "leading-unit", { subject: "this-model", attachment: "leading" });
  confirm(value, "repeat any Hit result", "EFFECT", "reroll", { roll: "hit", subset: "all", weapon_type: "all" });
}

describe("exclusive byte partition", () => {
  it("assigns every meaningful byte to exactly one layer in priority order", () => {
    const meaningful = [{ start: 0, end: 10 }, { start: 12, end: 20 }];
    const partition = partitionExclusive(meaningful, {
      leaf: [{ start: 0, end: 4 }],
      structural: [{ start: 2, end: 6 }],
      connective: [{ start: 5, end: 8 }],
      pending: [{ start: 0, end: 20 }],
      unresolved: [{ start: 18, end: 25 }],
    });
    expect(partition.leaf).toEqual([{ start: 0, end: 4 }]);
    expect(partition.structural).toEqual([{ start: 4, end: 6 }]);
    expect(partition.connective).toEqual([{ start: 6, end: 8 }]);
    expect(partition.pending).toEqual([{ start: 8, end: 10 }, { start: 12, end: 20 }]);
    expect(partition.unresolved).toEqual([]);
    const sum = Object.values(partition).reduce((total, layer) => total + totalLength(layer), 0);
    expect(sum).toBe(totalLength(meaningful));
  });
});

describe("Round 5C structural source authority", () => {
  it("fails closed on stale sources, split UTF-8 characters, and mismatched text", () => {
    const value = fixture();
    try {
      const participant = bytes("squad modèls");
      expect(() => proposeSourceAtom(value.db, { ability_version_id: value.id, source_hash: "0".repeat(64), fragment: "RAW_TEXT", ...participant, kind: "participant", description: "x", reviewer: REVIEWER }))
        .toThrow(expect.objectContaining({ status: 409 }));
      // End one byte inside the two-byte "è".
      const split = { ...participant, end_byte: bytes("squad mod").end_byte + 1, exact_text: "squad mod" };
      expect(() => proposeSourceAtom(value.db, { ability_version_id: value.id, source_hash: value.hash, fragment: "RAW_TEXT", ...split, kind: "participant", description: "x", reviewer: REVIEWER }))
        .toThrow(expect.objectContaining({ status: 422 }));
      expect(() => proposeSourceAtom(value.db, { ability_version_id: value.id, source_hash: value.hash, fragment: "RAW_TEXT", ...participant, exact_text: "squad models", kind: "participant", description: "x", reviewer: REVIEWER }))
        .toThrow(expect.objectContaining({ status: 422 }));
      expect(() => propose(value, "squad modèls", "effect")).toThrow(expect.objectContaining({ status: 422 }));
    } finally {
      value.db.close();
    }
  });

  it("counts a structural constituent only after human acceptance and keeps leaf_fraction unchanged", () => {
    const value = fixture();
    try {
      paintLeaves(value);
      const before = getAbilityCoverage(value.db, value.id);
      const proposed = propose(value, "squad modèls", "participant");
      const pending = getAbilityCoverage(value.db, value.id);
      expect(pending.accounted_fraction).toBe(before.accounted_fraction);
      expect(pending.partition.pending).toBe(Buffer.byteLength("squadmodèls"));
      expect(abilityReadiness(value.db, value.id).reasons.map((reason) => reason.code)).toContain("PENDING_CLAIMS");

      accept(value, proposed.proposal_id);
      const after = getAbilityCoverage(value.db, value.id);
      expect(after.leaf_fraction).toBe(before.leaf_fraction);
      expect(after.accounted_bytes.numerator).toBe(after.accounted_bytes.denominator);
      expect(after.accounted_fraction).toBe(1);
      expect(after.partition).toMatchObject({ structural: Buffer.byteLength("squadmodèls"), pending: 0, residue: 0 });
      expect(after.overlaps).toEqual([]);
      expect(abilityReadiness(value.db, value.id)).toMatchObject({ ready: true, reasons: [] });
    } finally {
      value.db.close();
    }
  });

  it("refuses independent overlaps with leaves, structure, and connectives", () => {
    const value = fixture();
    try {
      paintLeaves(value);
      expect(() => propose(value, "Lead-state", "selector")).toThrow(expect.objectContaining({ status: 409 }));
      const first = propose(value, "squad modèls", "participant");
      accept(value, first.proposal_id);
      expect(() => propose(value, "modèls", "selector")).toThrow(expect.objectContaining({ status: 409 }));
      expect(() => confirm(value, "squad modèls", "CONDITION", "leading-unit", { subject: "this-model", attachment: "leading" })).toThrow(/structural constituent/u);
    } finally {
      value.db.close();
    }
  });

  it("corrects kind, rejects, and undoes structural decisions exactly", () => {
    const value = fixture();
    try {
      paintLeaves(value);
      const proposed = propose(value, "squad modèls", "participant");
      const corrected = applySourceAtomBatch(value.db, {
        reviewer: REVIEWER,
        decisions: [{ atom_proposal_id: proposed.proposal_id, action: "correct", kind: "selector", source_hash: value.hash }],
      });
      expect(value.db.prepare("SELECT kind, status FROM source_atom_reviews").get()).toEqual({ kind: "selector", status: "active" });
      expect(() => applySourceAtomBatch(value.db, {
        reviewer: REVIEWER,
        decisions: [{ atom_proposal_id: proposed.proposal_id, action: "correct", kind: "bogus", source_hash: value.hash }],
      })).toThrow(expect.objectContaining({ status: 422 }));
      undoBatch(value.db, corrected.batch_id, { reviewer: REVIEWER });
      expect(value.db.prepare("SELECT status FROM source_atom_reviews").get()).toEqual({ status: "retracted" });
      expect(value.db.prepare("SELECT status FROM source_atom_proposals").get()).toEqual({ status: "pending" });
      expect(getAbilityCoverage(value.db, value.id).accounted_fraction).toBeLessThan(1);

      const rejected = applySourceAtomBatch(value.db, {
        reviewer: REVIEWER,
        decisions: [{ atom_proposal_id: proposed.proposal_id, action: "reject", source_hash: value.hash }],
      });
      expect(value.db.prepare("SELECT status FROM source_atom_proposals").get()).toEqual({ status: "rejected" });
      undoBatch(value.db, rejected.batch_id, { reviewer: REVIEWER });
      undoBatch(value.db, proposed.batch_id, { reviewer: REVIEWER });
      expect(value.db.prepare("SELECT status FROM source_atom_proposals").get()).toEqual({ status: "rejected" });
      expect(getAbilityCoverage(value.db, value.id).partition.pending).toBe(0);
    } finally {
      value.db.close();
    }
  });

  it("requires a reviewed connective with its relation before the source is accounted for", () => {
    const source = "Lead-state active and squad models repeat any Hit result.";
    const value = fixture(source);
    try {
      applyAnnotationBatch(value.db, { reviewer: REVIEWER, decisions: [
        { action: "confirm", ability_version_id: value.id, source_hash: value.hash, fragment: "RAW_TEXT", ...bytes("Lead-state active", source), role: "CONDITION", family_id: "leading-unit", family_version: 2, parameters: { subject: "this-model", attachment: "leading" } },
        { action: "confirm", ability_version_id: value.id, source_hash: value.hash, fragment: "RAW_TEXT", ...bytes("repeat any Hit result", source), role: "EFFECT", family_id: "reroll", family_version: 2, parameters: { roll: "hit", subset: "all", weapon_type: "all" } },
      ] });
      const participant = proposeSourceAtom(value.db, { ability_version_id: value.id, source_hash: value.hash, fragment: "RAW_TEXT", ...bytes("squad models", source), kind: "participant", description: "who", reviewer: REVIEWER });
      accept(value, participant.proposal_id);
      const connective = proposeSourceAtom(value.db, { ability_version_id: value.id, source_hash: value.hash, fragment: "RAW_TEXT", ...bytes("and", source), kind: "CONNECTIVE", connective_kind: "and", description: "joins", reviewer: REVIEWER });
      expect(abilityReadiness(value.db, value.id)).toMatchObject({ ready: false });
      expect(abilityReadiness(value.db, value.id).reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(["PENDING_CLAIMS", "UNACCOUNTED_SOURCE"]));
      expect(() => applyAnnotationBatch(value.db, { reviewer: REVIEWER, decisions: [{ action: "confirm-connective", proposal_id: connective.proposal_id, ability_version_id: value.id, source_hash: value.hash, fragment: "RAW_TEXT", ...bytes("and", source), role: "CONNECTIVE", relation: "joins" }] }))
        .toThrow(/not a known relation type/u);
      applyAnnotationBatch(value.db, { reviewer: REVIEWER, decisions: [{ action: "confirm-connective", proposal_id: connective.proposal_id, ability_version_id: value.id, source_hash: value.hash, fragment: "RAW_TEXT", ...bytes("and", source), role: "CONNECTIVE", relation: "coexists-with" }] });
      expect(value.db.prepare("SELECT json_extract(reason_json, '$.reviewed_relation') AS relation FROM proposals WHERE id = ?").get(connective.proposal_id)).toEqual({ relation: "coexists-with" });
      expect(abilityReadiness(value.db, value.id)).toMatchObject({ ready: true });
    } finally {
      value.db.close();
    }
  });

  it("becomes composition-eligible only once the full source is accounted for and explicitly checked", () => {
    const value = fixture();
    try {
      paintLeaves(value);
      const pending = propose(value, "squad modèls", "participant");
      reviewAbility(value.db, value.id, { source_hash: value.hash, reviewer: REVIEWER, whole_context_checked: true });
      expect(abilityReadiness(value.db, value.id)).toMatchObject({ ready: false, composition_eligible: false });
      accept(value, pending.proposal_id);
      // Accepting the structure is a reviewed-source change, so it clears the earlier check.
      expect(abilityReadiness(value.db, value.id)).toMatchObject({ ready: true, whole_context_checked: false, composition_eligible: false });
      reviewAbility(value.db, value.id, { source_hash: value.hash, reviewer: REVIEWER, whole_context_checked: true });
      expect(abilityReadiness(value.db, value.id)).toMatchObject({ ready: true, composition_eligible: true });
    } finally {
      value.db.close();
    }
  });

  it("links a nested qualifier to its reviewed parent without double-counting and drops it with the parent", () => {
    const value = fixture();
    try {
      const run = prepareLuna(value.db, { ability_version_id: value.id });
      const request = run.request as { abilities: Array<{ faction_id: string; ability_id: string; source_hash: string }> };
      const clause = bytes("squad modèls repeat any Hit result");
      importLuna(value.db, { run_id: run.run_id, response: {
        schema_version: 2, input_hash: run.input_hash, model: "external", model_version: "unknown", prompt_version: "v2",
        abilities: [{
          faction_id: request.abilities[0]!.faction_id,
          ability_id: request.abilities[0]!.ability_id,
          source_hash: request.abilities[0]!.source_hash,
          spans: [
            { ...bytes("Lead-state active"), role: "CONDITION", status: "EXISTING", family_id: "leading-unit", family_version: 2, parameters: { subject: "this-model", attachment: "leading" } },
            { ...clause, role: "EFFECT", status: "EXISTING", family_id: "reroll", family_version: 2, parameters: { roll: "hit", subset: "all", weapon_type: "all" }, qualifier_spans: [bytes("squad modèls")] },
          ],
          structural_spans: [{ ...bytes("squad modèls"), kind: "participant", description: "who", parent_span_index: 1 }],
          connectives: [],
          unresolved_regions: [],
        }],
      } });
      const proposals = value.db.prepare("SELECT id, role FROM proposals ORDER BY id").all() as Array<{ id: number; role: string }>;
      const atom = value.db.prepare("SELECT id, parent_proposal_id FROM source_atom_proposals").get() as { id: number; parent_proposal_id: number };
      expect(atom.parent_proposal_id).toBe(proposals[1]!.id);
      applyAnnotationBatch(value.db, { reviewer: REVIEWER, decisions: [
        { action: "confirm", proposal_id: proposals[0]!.id, ability_version_id: value.id, source_hash: value.hash, fragment: "RAW_TEXT", ...bytes("Lead-state active"), role: "CONDITION" },
      ] });
      const parentBatch = applyAnnotationBatch(value.db, { reviewer: REVIEWER, decisions: [
        { action: "confirm", proposal_id: proposals[1]!.id, ability_version_id: value.id, source_hash: value.hash, fragment: "RAW_TEXT", ...clause, role: "EFFECT" },
      ] }).batch_id;
      const parent = value.db.prepare("SELECT id FROM annotations WHERE status = 'active' ORDER BY id DESC").get() as { id: number };

      expect(() => accept(value, atom.id)).toThrow(expect.objectContaining({ status: 409 }));
      accept(value, atom.id, { contained_by_annotation_id: parent.id });
      const coverage = getAbilityCoverage(value.db, value.id);
      expect(coverage.accounted_bytes.numerator).toBe(coverage.accounted_bytes.denominator);
      expect(coverage.partition.structural).toBe(0);
      expect(coverage.overlaps).toEqual([expect.objectContaining({ kind: "leaf-structural", sanctioned: true })]);
      expect(abilityReadiness(value.db, value.id).ready).toBe(true);

      // Retracting the parent removes the child's support: its bytes and readiness drop together.
      undoBatch(value.db, parentBatch, { reviewer: REVIEWER });
      const readiness = abilityReadiness(value.db, value.id);
      expect(readiness.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(["UNSUPPORTED_STRUCTURE", "UNACCOUNTED_SOURCE"]));
    } finally {
      value.db.close();
    }
  });
});
