import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { AuthorityError, humanActor, machineActor } from "../src/round5c/authority.js";
import { authorityAudit } from "../src/round5c/authority-migration.js";
import { getAbilityCoverage } from "../src/round5c/coverage.js";
import { initializeWorkbench, openWorkbench } from "../src/round5c/db.js";
import { confirmSurface, reapplyLeafSurfaces } from "../src/round5c/leaves.js";
import { applyAnnotationBatch, undoBatch } from "../src/round5c/review.js";
import { applyChatReview } from "../src/round5c/review-apply.js";
import { refreshSources } from "../src/round5c/source.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
const WILL = humanActor("will", "test");
const PILOT = machineActor("pilot-auto");
// Fabricated fixture prose only.
const CP = "gain 1CP";
const cp = { family_id: "resource-action", parameters: { resource: "command-point", operation: "gain", amount: 1 } };

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(records: Array<{ ability_id: string; raw_text: string }>, path = ":memory:"): DatabaseSync {
  const root = mkdtempSync(join(tmpdir(), "round5c-authority-"));
  roots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(records.map((record) => ({ faction_id: "alpha", ...record }))));
  const db = path === ":memory:" ? new DatabaseSync(":memory:") : openWorkbench(path);
  initializeWorkbench(db);
  refreshSources(db, root);
  return db;
}

function ability(db: DatabaseSync, abilityId: string): { id: number; source_text: string; source_hash: string } {
  return db.prepare("SELECT id, source_text, source_hash FROM abilities WHERE current = 1 AND ability_id = ?").get(abilityId) as { id: number; source_text: string; source_hash: string };
}

function rows(db: DatabaseSync, abilityId: string): Array<{ authority_kind: string; status: string; derived_from_surface_id: number | null }> {
  return db.prepare(`
    SELECT annotations.authority_kind, annotations.status, annotations.derived_from_surface_id
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE source_spans.ability_version_id = ? ORDER BY annotations.id
  `).all(ability(db, abilityId).id) as Array<{ authority_kind: string; status: string; derived_from_surface_id: number | null }>;
}

function confirmDecision(db: DatabaseSync, abilityId: string, phrase: string) {
  const source = ability(db, abilityId);
  const start = Buffer.byteLength(source.source_text.slice(0, source.source_text.indexOf(phrase)), "utf8");
  return {
    action: "confirm", ability_version_id: source.id, source_hash: source.source_hash, fragment: "RAW_TEXT",
    start_byte: start, end_byte: start + Buffer.byteLength(phrase, "utf8"), exact_text: phrase, role: "EFFECT", ...cp,
  };
}

describe("Round 5C authority boundary", () => {
  it("never lets a machine actor decide, and never mints a human actor for a machine name", () => {
    const db = fixture([{ ability_id: "one", raw_text: `Once per battle, ${CP}.` }]);
    expect(() => applyAnnotationBatch(db, { reviewer: "pilot-auto", decisions: [confirmDecision(db, "one", CP)] }, PILOT)).toThrow(AuthorityError);
    expect(() => humanActor("pipeline-8b", "test")).toThrow(AuthorityError);
    expect(() => humanActor("jev-v2-round-3", "test")).toThrow(AuthorityError);
    expect(() => machineActor("will")).toThrow(AuthorityError);
    // A body naming someone else cannot borrow the actor's authority.
    expect(() => applyAnnotationBatch(db, { reviewer: "someone-else", decisions: [confirmDecision(db, "one", CP)] }, WILL)).toThrow(AuthorityError);
    expect(rows(db, "one")).toEqual([]);
  });

  it("mints human actors only in the review bridge, review apply, and tests", () => {
    const tools = resolve(import.meta.dirname, "..");
    const callers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { if (!["node_modules", "dist", "docs"].includes(entry.name)) walk(path); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (/\bhumanActor\(/.test(readFileSync(path, "utf8"))) callers.push(relative(tools, path));
      }
    };
    walk(join(tools, "src"));
    walk(join(tools, "round5-review"));
    const allowed = new Set(["round5-review/vite.config.ts", "src/round5c/authority.ts", "src/round5c/review-apply.ts"]);
    expect(callers.filter((path) => !allowed.has(path))).toEqual([]);
    expect(callers).toContain("round5-review/vite.config.ts");
  });

  it("keeps machine rows out of trusted coverage and lets a human confirmation promote them", () => {
    const db = fixture([{ ability_id: "one", raw_text: `Once per battle, ${CP}.` }, { ability_id: "two", raw_text: `At the start of your turn, ${CP}.` }]);
    confirmSurface(db, { exact_text: CP, ...cp }, PILOT);
    expect(rows(db, "one")).toEqual([expect.objectContaining({ authority_kind: "machine", status: "active" })]);
    expect(getAbilityCoverage(db, ability(db, "one").id).leaf_bytes.numerator).toBe(0);
    expect(getAbilityCoverage(db, ability(db, "one").id, { includeMachine: true }).leaf_bytes.numerator).toBeGreaterThan(0);

    // Will confirms the same wording: the machine surface is re-founded as human, and every
    // machine row at those bytes is promoted (superseded by a derived row), not counted "already".
    const report = confirmSurface(db, { reviewer: "will", exact_text: CP, ...cp }, WILL);
    expect(report).toMatchObject({ applied: 2, already: 0, promoted: 2 });
    expect(rows(db, "one").map((row) => [row.authority_kind, row.status])).toEqual([["machine", "superseded"], ["derived", "active"]]);
    expect(getAbilityCoverage(db, ability(db, "one").id).leaf_bytes.numerator).toBeGreaterThan(0);

    // Undo brings the machine rows back and trusted coverage returns to zero.
    undoBatch(db, report.batch_id, { reviewer: "will" }, WILL);
    expect(rows(db, "one").map((row) => [row.authority_kind, row.status])).toEqual([["machine", "active"], ["derived", "retracted"]]);
    expect(getAbilityCoverage(db, ability(db, "one").id).leaf_bytes.numerator).toBe(0);
  });

  it("promotes a machine row when a human decision confirms it span by span", () => {
    const db = fixture([{ ability_id: "one", raw_text: `Once per battle, ${CP}.` }]);
    confirmSurface(db, { exact_text: CP, ...cp }, PILOT);
    applyAnnotationBatch(db, { reviewer: "will", decisions: [confirmDecision(db, "one", CP)] }, WILL);
    expect(rows(db, "one").map((row) => [row.authority_kind, row.status])).toEqual([["machine", "superseded"], ["human", "active"]]);
  });

  it("never lets a machine surface replace or overlap a trusted leaf", () => {
    const db = fixture([{ ability_id: "one", raw_text: `Once per battle, ${CP}.` }]);
    confirmSurface(db, { reviewer: "will", exact_text: CP, ...cp }, WILL);
    // A longer machine wording that would swallow the trusted leaf is blocked, not applied.
    const report = confirmSurface(db, { exact_text: `battle, ${CP}`, ...cp }, PILOT);
    expect(report.applied).toBe(0);
    expect(report.blocked).toEqual([expect.objectContaining({ reason: "TRUSTED_HERE" })]);
    expect(rows(db, "one")).toEqual([expect.objectContaining({ authority_kind: "derived", status: "active" })]);
  });

  it("retracts a surface's later propagations when its founding decision is undone", () => {
    const records = [{ ability_id: "one", raw_text: `Once per battle, ${CP}.` }];
    const root = mkdtempSync(join(tmpdir(), "round5c-authority-late-"));
    roots.push(root);
    const db = fixture(records);
    const founded = confirmSurface(db, { reviewer: "will", exact_text: CP, ...cp }, WILL);
    // A later source refresh brings a new text; reapply propagates the surface in a system batch.
    writeFileSync(join(root, "fixture.json"), JSON.stringify([...records, { ability_id: "late", raw_text: `At the end of the phase, ${CP}.` }].map((record) => ({ faction_id: "alpha", ...record }))));
    refreshSources(db, root);
    reapplyLeafSurfaces(db);
    expect(rows(db, "late")).toEqual([{ authority_kind: "derived", status: "active", derived_from_surface_id: founded.surface_id }]);
    undoBatch(db, founded.batch_id, { reviewer: "will" }, WILL);
    expect(rows(db, "late")).toEqual([expect.objectContaining({ status: "retracted" })]);
  });

  it("applies a scoped propagation only inside its scope", () => {
    const db = fixture([{ ability_id: "one", raw_text: `Once per battle, ${CP}.` }, { ability_id: "two", raw_text: `At the start of your turn, ${CP}.` }]);
    confirmSurface(db, { reviewer: "will", exact_text: CP, ...cp, ability_version_ids: [ability(db, "one").id] }, WILL);
    expect(rows(db, "one")).toHaveLength(1);
    expect(rows(db, "two")).toEqual([]);
    reapplyLeafSurfaces(db, new Set([ability(db, "one").id]));
    expect(rows(db, "two")).toEqual([]);
  });

  it("classifies a database that predates authority by evidence, and returns machine decisions to review", () => {
    const directory = mkdtempSync(join(tmpdir(), "round5c-authority-migrate-"));
    roots.push(directory);
    const path = join(directory, "workbench.sqlite");
    let db = fixture([
      { ability_id: "one", raw_text: `Once per battle, ${CP}.` },
      { ability_id: "two", raw_text: `At the start of your turn, ${CP}.` },
      { ability_id: "three", raw_text: "Re-roll a Hit roll of 1." },
    ], path);
    // Will founds the CP surface; a pipeline founds the re-roll surface; a pipeline also
    // "confirms" a proposal. Written as today's code would, then rewound to the old schema with
    // every row claiming to be human, as every pre-authority database did.
    confirmSurface(db, { reviewer: "will", exact_text: CP, ...cp }, WILL);
    confirmSurface(db, { exact_text: "Re-roll a Hit roll of 1", family_id: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" } }, machineActor("pipeline-8b"));
    const two = ability(db, "two");
    db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at) VALUES ('pilot', 'review', 'pilot-auto', 'x')").run();
    const proposal = Number(db.prepare(`
      INSERT INTO proposals (span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at)
      SELECT span_id, fingerprint_id, 'EFFECT', 'luna', NULL, 'accepted', '{}', NULL, 'x' FROM annotations
      JOIN source_spans ON source_spans.id = annotations.span_id WHERE source_spans.ability_version_id = ?
    `).run(two.id).lastInsertRowid);
    db.prepare("INSERT INTO batch_members (batch_id, entity_kind, entity_id) VALUES ('pilot', 'proposal-accepted', ?)").run(String(proposal));
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE annotations_old (id INTEGER PRIMARY KEY, span_id INTEGER NOT NULL, fingerprint_id TEXT NOT NULL,
        status TEXT NOT NULL, origin TEXT NOT NULL, authority_kind TEXT NOT NULL DEFAULT 'human' CHECK(authority_kind IN ('human', 'stamp')),
        confirmed_by TEXT NOT NULL, batch_id TEXT NOT NULL, supersedes_id INTEGER, created_at TEXT NOT NULL) STRICT;
      INSERT INTO annotations_old SELECT id, span_id, fingerprint_id, status, origin, 'human', confirmed_by, batch_id, supersedes_id, created_at FROM annotations;
      DROP TABLE annotations; ALTER TABLE annotations_old RENAME TO annotations;
      CREATE TABLE surfaces_old (id INTEGER PRIMARY KEY, normalized_surface TEXT NOT NULL, fingerprint_id TEXT NOT NULL,
        status TEXT NOT NULL, batch_id TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      INSERT INTO surfaces_old SELECT id, normalized_surface, fingerprint_id, status, batch_id, created_at FROM leaf_surfaces;
      DROP TABLE leaf_surfaces; ALTER TABLE surfaces_old RENAME TO leaf_surfaces;
      PRAGMA foreign_keys = ON;
    `);
    db.close();

    db = openWorkbench(path);
    try {
      expect(rows(db, "one")).toEqual([expect.objectContaining({ authority_kind: "derived", status: "active" })]);
      expect(rows(db, "three")).toEqual([expect.objectContaining({ authority_kind: "machine", status: "active" })]);
      expect(db.prepare("SELECT status FROM proposals WHERE id = ?").get(proposal)).toEqual({ status: "pending" });
      const audit = authorityAudit(db)!;
      expect(audit.reverted.proposals).toBe(1);
      expect(audit.surfaces.map((surface) => surface.authority).sort()).toEqual(["human", "machine"]);
      expect(readdirSync(directory)).toContain("workbench.sqlite.pre5d");
    } finally {
      db.close();
    }
  });

  it("widens a trusted leaf through a chat correction that gives new wording, replacing the old row", () => {
    const db = fixture([{ ability_id: "wide", raw_text: `Then ${CP} next turn.` }]);
    try {
      applyAnnotationBatch(db, { reviewer: "will", decisions: [confirmDecision(db, "wide", CP)] }, WILL);
      const old = db.prepare("SELECT id FROM annotations WHERE status = 'active'").get() as { id: number };
      const result = applyChatReview(db, { reviewer: "will", decisions: [{ annotation_id: old.id, action: "correct", exact_text: `${CP} next turn` }] });
      expect(result.failed).toEqual([]);
      const active = db.prepare("SELECT source_spans.exact_text, annotations.authority_kind FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id WHERE annotations.status = 'active'").all();
      expect(active).toEqual([{ exact_text: `${CP} next turn`, authority_kind: "human" }]);
    } finally {
      db.close();
    }
  });
});
