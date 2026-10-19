import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";
import { projectStatus } from "../src/semantic-authoring/cli-control.js";
import { familyStatus } from "../src/semantic-authoring/control-reads.js";
import { initializeWorkbench, insertSpan } from "../src/semantic-authoring/db.js";
import { trustedWordings } from "../src/semantic-authoring/jev-classify.js";
import { tiledCalibrationSample } from "../src/semantic-authoring/jev-v2-segment.js";
import { tiledSources } from "../src/semantic-authoring/leaf-view.js";
import { runCompileGates } from "../src/semantic-authoring/pipeline-8b-gates.js";
import { localEmbedder } from "../src/semantic-authoring/embeddings.js";
import { propagateDuplicateTexts } from "../src/semantic-authoring/propagate.js";
import { getAbility, progressCounts } from "../src/semantic-authoring/review.js";
import { applyChatReview } from "../src/semantic-authoring/review-apply.js";
import { confirmSurface } from "./semantic-authoring-human.js";

// Fabricated wording only. A NAME span indexes the record's name bytes. Each test below fails if the
// reader or path it names stops excluding (or ordering) NAME rows.

type Db = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };

const REVIEWER = "fixture-reviewer";
const NAME = "Fabricated Captain (psyker level 3)";
const BODY = "**Alpha Hex (psychic level 2)**\nIn your Shooting phase, roll one D6 (psychic). On a 4+, this unit has +1 Sv.";
const SPLIT_BODY = "Alpha Bravo";
const SCOUT_BODY = "**Beta Scout (psychic level 1)**\nIn your Shooting phase, psyker level 3 applies.";
const PARAMETERS = { subject: "this-model", characteristic: "psyker-level", value: 3 };

function open(): Db {
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  return db;
}

function bytesOf(text: string, wording: string): { start_byte: number; end_byte: number } {
  const start = Buffer.byteLength(text.slice(0, text.indexOf(wording)), "utf8");
  return { start_byte: start, end_byte: start + Buffer.byteLength(wording, "utf8") };
}

function addAbility(db: Db, abilityId: string, name: string | null, body: string): number {
  const fragments = JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(body, "utf8"), text: body }]);
  const row = db.prepare(`
    INSERT INTO abilities (faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, metadata_json, fragments_json, current)
    VALUES ('fixture', ?, ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
  `).run(abilityId, hashJson({ text: body }), body, name, fragments);
  return Number(row.lastInsertRowid);
}

/** Adds one trusted leaf through the review path: a NAME leaf when `fragment` is NAME, else a body leaf. */
function addLeaf(db: Db, abilityId: number, wording: string, family: string, parameters: Record<string, unknown>, fragment?: "NAME") {
  const version = currentFamilyVersion(family);
  return applyChatReview(db, {
    reviewer: REVIEWER,
    decisions: [{
      action: "add", ability_version_id: abilityId, ...(fragment ? { fragment } : {}), exact_text: wording,
      role: familyRole(family, version), family_id: family, family_version: version, parameters,
    }],
  });
}

/** The source span of `wording` inside `text`, in the given fragment (NAME offsets index the name). */
function spanFor(db: Db, abilityId: number, fragment: "NAME" | "RAW_TEXT", text: string, wording: string): number {
  const at = bytesOf(text, wording);
  return insertSpan(db, abilityId, fragment, at.start_byte, at.end_byte, wording);
}

function pend(db: Db, span: number): void {
  db.prepare(`INSERT INTO proposals (span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at)
    VALUES (?, NULL, 'EFFECT', 'fixture', NULL, 'pending', '{}', NULL, '2026-01-01T00:00:00.000Z')`).run(span);
}

function proposalStatus(db: Db, span: number): string {
  return (db.prepare("SELECT status FROM proposals WHERE span_id = ?").get(span) as { status: string }).status;
}

/** Annotations (trusted or not) on NAME spans. */
function nameLeafCount(db: Db): number {
  return (db.prepare("SELECT count(*) AS n FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id WHERE source_spans.fragment = 'NAME'").get() as { n: number }).n;
}

function familyRow(db: Db, family: string) {
  const row = familyStatus(db).find((item) => item.family_id === family);
  if (!row) throw new Error(`No status row for ${family}`);
  return row;
}

describe("Semantic authoring NAME rows stay out of body readers", () => {
  it("counts a pending proposal on a NAME span as no body progress", () => {
    const db = open();
    try {
      const id = addAbility(db, "captain", NAME, BODY);
      const body = insertSpan(db, id, "RAW_TEXT", bytesOf(BODY, "Alpha Hex").start_byte, bytesOf(BODY, "Alpha Hex").end_byte, "Alpha Hex");
      const name = bytesOf(NAME, "psyker level 3");
      const nameSpan = insertSpan(db, id, "NAME", name.start_byte, name.end_byte, "psyker level 3");
      for (const span of [body, nameSpan]) {
        db.prepare(`INSERT INTO proposals (span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at)
          VALUES (?, NULL, 'EFFECT', 'fixture', NULL, 'pending', '{}', NULL, '2026-01-01T00:00:00.000Z')`).run(span);
      }
      expect(progressCounts(db, id).get(id)?.pending).toBe(1);
    } finally {
      db.close();
    }
  });

  it("lets a body leaf overlap a NAME leaf's offsets, since they are different fragments", () => {
    const db = open();
    try {
      const id = addAbility(db, "captain", NAME, BODY);
      expect(addLeaf(db, id, "psyker level 3", "characteristic-set", PARAMETERS, "NAME").failed).toEqual([]);
      const body = addLeaf(db, id, "psychic level 2", "characteristic-set", { ...PARAMETERS, value: 2 });
      expect(body.failed).toEqual([]);
      expect(body.applied).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("keeps NAME wordings and texts out of familyStatus evidence", () => {
    const db = open();
    try {
      const id = addAbility(db, "captain", NAME, BODY);
      addLeaf(db, id, "psyker level 3", "characteristic-set", PARAMETERS, "NAME");
      const nameOnly = familyRow(db, "characteristic-set");
      expect({ wordings: nameOnly.wordings, texts: nameOnly.texts, occurrences: nameOnly.occurrences }).toEqual({ wordings: 0, texts: 0, occurrences: 1 });
      addLeaf(db, id, "Alpha Hex", "characteristic-set", { ...PARAMETERS, value: 1 });
      const withBody = familyRow(db, "characteristic-set");
      expect({ wordings: withBody.wordings, texts: withBody.texts }).toEqual({ wordings: 1, texts: 1 });
    } finally {
      db.close();
    }
  });

  it("keeps NAME wordings out of projectStatus distinct trusted wordings", () => {
    const db = open();
    try {
      const id = addAbility(db, "captain", NAME, BODY);
      addLeaf(db, id, "psyker level 3", "characteristic-set", PARAMETERS, "NAME");
      const families = () => (projectStatus(db).families as { distinct_trusted_wordings: number });
      expect(families().distinct_trusted_wordings).toBe(0);
      addLeaf(db, id, "Alpha Hex", "characteristic-set", { ...PARAMETERS, value: 1 });
      expect(families().distinct_trusted_wordings).toBe(1);
    } finally {
      db.close();
    }
  });

  it("omits a NAME-only family from the trusted wordings the classifier sees", () => {
    const db = open();
    try {
      const id = addAbility(db, "captain", NAME, BODY);
      addLeaf(db, id, "psyker level 3", "characteristic-set", PARAMETERS, "NAME");
      expect(trustedWordings(db).get("characteristic-set")).toBeUndefined();
      addLeaf(db, id, "Alpha Hex", "characteristic-set", { ...PARAMETERS, value: 1 });
      expect(trustedWordings(db).get("characteristic-set")?.map((example) => example.text)).toEqual(["Alpha Hex"]);
    } finally {
      db.close();
    }
  });

  it("samples boundaries from body spans only when calibrating segmentation", () => {
    const db = open();
    try {
      const id = addAbility(db, "captain", NAME, SPLIT_BODY);
      addLeaf(db, id, "Alpha", "characteristic-set", { ...PARAMETERS, value: 1 });
      addLeaf(db, id, "Bravo", "characteristic-set", { ...PARAMETERS, value: 2 });
      addLeaf(db, id, "psyker level 3", "characteristic-set", PARAMETERS, "NAME");
      const samples = tiledCalibrationSample(db, {} as never, 40);
      expect(samples).toHaveLength(1);
      // The NAME span sits at name bytes 20-34; body boundaries are only 0, 5, 6 and 11.
      expect(new Set(samples[0]!.trueBoundaries)).toEqual(new Set(["0", "5", "6", "11"]));
    } finally {
      db.close();
    }
  });
});

describe("Semantic authoring NAME rows: surfaces, duplicate copies, staleness and ordering", () => {
  it("carries a surface onto body text only, never onto a NAME row", () => {
    const db = open();
    try {
      const captain = addAbility(db, "captain", NAME, BODY);
      const scout = addAbility(db, "scout", "Fabricated Scout (psyker level 1)", SCOUT_BODY);
      const nameSpan = spanFor(db, captain, "NAME", NAME, "psyker level 3");
      const bodySpan = spanFor(db, scout, "RAW_TEXT", SCOUT_BODY, "psyker level 3");
      pend(db, nameSpan);
      pend(db, bodySpan);
      const report = confirmSurface(db, { reviewer: REVIEWER, exact_text: "psyker level 3", family_id: "characteristic-set", parameters: PARAMETERS });
      // Only the scout's body proposal is reached. The NAME proposal is inserted directly here: the pipeline
      // makes no NAME proposals, so this pins the surface exclusion rather than a live path.
      expect(report.applied).toBe(1);
      expect(nameLeafCount(db)).toBe(0);
      expect(proposalStatus(db, nameSpan)).toBe("pending");
      const bodyAnnotations = db.prepare("SELECT count(*) AS n FROM annotations WHERE span_id = ?").get(bodySpan) as { n: number };
      expect(bodyAnnotations.n).toBe(1);
    } finally {
      db.close();
    }
  });

  it("does not carry a surface scoped to the NAME fragment onto a NAME row", () => {
    const db = open();
    try {
      const captain = addAbility(db, "captain", NAME, BODY);
      const scout = addAbility(db, "scout", "Fabricated Scout (psyker level 1)", SCOUT_BODY);
      const nameSpan = spanFor(db, captain, "NAME", NAME, "psyker level 3");
      pend(db, nameSpan);
      pend(db, spanFor(db, scout, "RAW_TEXT", SCOUT_BODY, "psyker level 3"));
      const report = confirmSurface(db, {
        reviewer: REVIEWER, exact_text: "psyker level 3", family_id: "characteristic-set", parameters: PARAMETERS,
        scope: { version: 1, fragments: ["NAME"] },
      });
      expect(report.applied).toBe(0);
      expect(nameLeafCount(db)).toBe(0);
      expect(proposalStatus(db, nameSpan)).toBe("pending");
    } finally {
      db.close();
    }
  });

  it("does not copy a NAME row to a record that shares its body text", () => {
    const db = open();
    try {
      const captain = addAbility(db, "captain", NAME, BODY);
      const twin = addAbility(db, "twin", "Fabricated Scout (psyker level 1)", BODY);
      addLeaf(db, captain, "psyker level 3", "characteristic-set", PARAMETERS, "NAME");
      addLeaf(db, captain, "Alpha Hex", "characteristic-set", { ...PARAMETERS, value: 1 });
      expect(() => propagateDuplicateTexts(db, { dryRun: false })).not.toThrow();
      const twinRows = db.prepare("SELECT fragment, count(*) AS n FROM source_spans WHERE ability_version_id = ? GROUP BY fragment").all(twin) as Array<{ fragment: string; n: number }>;
      // The body leaf copies (positive control); the NAME leaf does not.
      expect(twinRows).toEqual([{ fragment: "RAW_TEXT", n: 1 }]);
    } finally {
      db.close();
    }
  });

  it("refuses a NAME leaf whose stored wording no longer sits in the current name", () => {
    const at = bytesOf(NAME, "psyker level 3");
    const leaf = {
      role: familyRole("characteristic-set", currentFamilyVersion("characteristic-set")), family_id: "characteristic-set",
      family_version: currentFamilyVersion("characteristic-set"), parameters: PARAMETERS,
      start_byte: at.start_byte, end_byte: at.end_byte, fragment: "NAME", exact_text: "psyker level 3",
    };
    // Same length, so the offsets still resolve; only the wording changed.
    const stale = compileLeaves([leaf], BODY, { name: "Fabricated Captain (psyker level 1)" });
    expect(stale.ok).toBe(false);
    expect(stale.ok ? "" : stale.errors.join(" ")).toMatch(/no longer matches/);
    const current = compileLeaves([leaf], BODY, { name: NAME });
    expect(current.ok ? "" : current.errors.join(" ")).not.toMatch(/no longer matches/);
  });

  it("hands the stored wording to the compiler through tiledSources and refuses a renamed record", () => {
    const db = open();
    try {
      const id = addAbility(db, "captain", NAME, SPLIT_BODY);
      addLeaf(db, id, "Alpha", "characteristic-set", { ...PARAMETERS, value: 1 });
      addLeaf(db, id, "Bravo", "characteristic-set", { ...PARAMETERS, value: 2 });
      addLeaf(db, id, "psyker level 3", "characteristic-set", PARAMETERS, "NAME");
      const source = tiledSources(db).find((item) => item.id === id);
      expect(source).toBeDefined();
      const nameLeaf = source!.leaves.find((leaf) => leaf.fragment === "NAME");
      expect(nameLeaf?.exact_text).toBe("psyker level 3");
      expect(source!.leaves.filter((leaf) => leaf.fragment !== "NAME").every((leaf) => leaf.exact_text === undefined)).toBe(true);
      // The record is renamed, same length, so the offsets still resolve but the wording moved.
      db.prepare("UPDATE abilities SET name = ? WHERE id = ?").run("Fabricated Captain (psyker level 1)", id);
      const renamed = tiledSources(db).find((item) => item.id === id)!;
      const result = compileLeaves(renamed.leaves, renamed.source_text, { name: renamed.name ?? undefined });
      expect(result.ok ? "" : result.errors.join(" ")).toMatch(/no longer matches/);
    } finally {
      db.close();
    }
  });

  it("compiles an explicitly hash-pinned historical source without making it current", () => {
    const db = open();
    try {
      const id = addAbility(db, "historic-example", null, "Alpha");
      addLeaf(db, id, "Alpha", "characteristic-set", { ...PARAMETERS, value: 1 });
      db.prepare("UPDATE abilities SET current = 0 WHERE id = ?").run(id);
      const hash = hashJson({ text: "Alpha" });
      const abilityVersionIds = new Set([id]);
      expect(tiledSources(db, { abilityVersionIds })).toEqual([]);
      expect(() => tiledSources(db, { historicalSourceHashes: new Map([[id, hash]]) })).toThrow(/explicitly requested/);
      expect(() => tiledSources(db, { abilityVersionIds, historicalSourceHashes: new Map([[id, "stale"]]) })).toThrow(/pinned historical identity/);
      const sources = tiledSources(db, { abilityVersionIds, historicalSourceHashes: new Map([[id, hash]]) });
      expect(sources).toHaveLength(1);
      expect(sources[0]!.machine_leaves).toBe(0);
      expect(compileLeaves(sources[0]!.leaves, sources[0]!.source_text).ok).toBe(true);
      expect(db.prepare("SELECT current, source_hash FROM abilities WHERE id = ?").get(id)).toEqual({ current: 0, source_hash: hash });
    } finally {
      db.close();
    }
  });

  it("refuses a historical publication identity without its exact source pin", async () => {
    const db = open();
    try {
      const id = addAbility(db, "historic-source", null, "Alpha");
      await expect(runCompileGates(db, localEmbedder(), 0.55, new Set([id]), {
        historicalEntityIds: new Map([[id, "preserved-entity"]]),
      })).rejects.toThrow(/requires a pinned source hash/);
      expect(db.prepare("SELECT ability_id, current FROM abilities WHERE id = ?").get(id)).toEqual({ ability_id: "historic-source", current: 1 });
    } finally {
      db.close();
    }
  });

  it("lists a NAME annotation after the body annotations, whatever its offsets", () => {
    const db = open();
    try {
      const id = addAbility(db, "captain", NAME, BODY);
      addLeaf(db, id, "psyker level 3", "characteristic-set", PARAMETERS, "NAME");
      addLeaf(db, id, "In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" });
      const fragments = getAbility(db, id).annotations.map((annotation) => annotation.fragment);
      expect(fragments).toEqual(["RAW_TEXT", "NAME"]);
    } finally {
      db.close();
    }
  });
});
