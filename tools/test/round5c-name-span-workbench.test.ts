import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { getAbilityCoverage } from "../src/round5c/coverage.js";
import { initializeWorkbench, insertSpan } from "../src/round5c/db.js";
import { currentFamilyVersion } from "../src/round5c/contracts.js";
import { applyChatReview, type ChatDecision } from "../src/round5c/review-apply.js";
import { applyAnnotationBatch, undoBatch } from "../src/round5c/review.js";
import { humanActor } from "../src/round5c/authority.js";

// Fabricated wording only. A NAME span indexes the record's name column, not source_text.

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };

const REVIEWER = "fixture-reviewer";
const NAME = "Fabricated Captain (psyker level 3)";
const BODY = "**Alpha Hex (psychic level 2)**\nIn your Shooting phase, roll one D6 (psychic). On a 4+, this unit has +1 Sv.";
const PARAMETERS = { subject: "this-model", characteristic: "psyker-level", value: 3 };

function fixture(name: string | null = NAME, body = BODY) {
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  const hash = hashJson({ text: body });
  const fragments = JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(body, "utf8"), text: body }]);
  const inserted = db.prepare(`
    INSERT INTO abilities (faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, metadata_json, fragments_json, current)
    VALUES ('fixture', 'captain', ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
  `).run(hash, body, name, fragments);
  return { db, abilityId: Number(inserted.lastInsertRowid) };
}

const nameBytes = (text: string, wording: string) => {
  const start = Buffer.byteLength(text.slice(0, text.indexOf(wording)), "utf8");
  return { start_byte: start, end_byte: start + Buffer.byteLength(wording, "utf8") };
};

function addName(value: ReturnType<typeof fixture>, extra: Partial<ChatDecision> = {}) {
  return applyChatReview(value.db, {
    reviewer: REVIEWER,
    decisions: [{
      action: "add", ability_version_id: value.abilityId, fragment: "NAME", exact_text: "psyker level 3",
      role: "EFFECT", family_id: "characteristic-set", family_version: currentFamilyVersion("characteristic-set"), parameters: PARAMETERS, ...extra,
    }],
  });
}

describe("Round 5C NAME spans in the workbench", () => {
  it("locates an added NAME wording in the name's bytes", () => {
    const value = fixture();
    try {
      const report = addName(value);
      expect(report.failed).toEqual([]);
      const span = value.db.prepare("SELECT fragment, start_byte, end_byte, exact_text FROM source_spans WHERE exact_text = 'psyker level 3'").get() as
        { fragment: string; start_byte: number; end_byte: number; exact_text: string };
      expect(span).toEqual({ fragment: "NAME", ...nameBytes(NAME, "psyker level 3"), exact_text: "psyker level 3" });
    } finally {
      value.db.close();
    }
  });

  it("refuses the same add without the NAME fragment, since the body does not contain the wording", () => {
    const value = fixture();
    try {
      const report = addName(value, { fragment: undefined });
      expect(report.applied).toEqual([]);
      expect(report.failed[0]?.error).toMatch(/must occur exactly once in ability/);
    } finally {
      value.db.close();
    }
  });

  it("refuses a NAME span whose text occurs only in source_text", () => {
    const value = fixture();
    try {
      const bodyWording = nameBytes(BODY, "Alpha Hex");
      expect(() => insertSpan(value.db, value.abilityId, "NAME", bodyWording.start_byte, bodyWording.end_byte, "Alpha Hex")).toThrow(/outside the record's name|does not exactly match/);
    } finally {
      value.db.close();
    }
  });

  it("refuses a NAME span past the name's byte length", () => {
    const value = fixture();
    try {
      const end = Buffer.byteLength(NAME, "utf8") + 1;
      expect(() => insertSpan(value.db, value.abilityId, "NAME", 0, end, NAME.slice(0, 1))).toThrow(/outside the record's name/);
    } finally {
      value.db.close();
    }
  });

  it("refuses a NAME span on a record with no name", () => {
    const value = fixture(null);
    try {
      const wording = nameBytes(NAME, "psyker level 3");
      expect(() => insertSpan(value.db, value.abilityId, "NAME", wording.start_byte, wording.end_byte, "psyker level 3")).toThrow(/needs a record with a name/);
      const report = addName(value);
      expect(report.failed[0]?.error).toMatch(/no name/);
    } finally {
      value.db.close();
    }
  });

  it("refuses a NAME add whose wording occurs twice in the name", () => {
    const value = fixture("Fabricated Captain (psyker level 3, psyker level 3)");
    try {
      const report = addName(value);
      expect(report.failed[0]?.error).toMatch(/must occur exactly once in the name/);
    } finally {
      value.db.close();
    }
  });

  it("corrects a NAME annotation inside the name, not the body", () => {
    const value = fixture();
    try {
      addName(value);
      const annotation = value.db.prepare("SELECT id FROM annotations WHERE status = 'active' LIMIT 1").get() as { id: number };
      const report = applyChatReview(value.db, {
        reviewer: REVIEWER,
        decisions: [{ action: "correct", annotation_id: annotation.id, exact_text: "psyker level 3", family_id: "characteristic-set", family_version: currentFamilyVersion("characteristic-set"), parameters: { ...PARAMETERS, value: 3 } }],
      });
      expect(report.failed).toEqual([]);
      const fragments = value.db.prepare("SELECT DISTINCT fragment FROM source_spans WHERE exact_text = 'psyker level 3'").all() as Array<{ fragment: string }>;
      expect(fragments.map((row) => row.fragment)).toEqual(["NAME"]);
    } finally {
      value.db.close();
    }
  });

  it("keeps whole-record coverage unchanged by a NAME annotation over body-offset bytes", () => {
    const value = fixture();
    try {
      const before = getAbilityCoverage(value.db, value.abilityId);
      addName(value);
      const after = getAbilityCoverage(value.db, value.abilityId);
      // The NAME span is 17..31 in name bytes, which are body bytes 17..31 too if read as body offsets.
      expect(after.leaf_bytes).toEqual(before.leaf_bytes);
      expect(after.partition).toEqual(before.partition);
      expect(after.accounted_bytes).toEqual(before.accounted_bytes);
    } finally {
      value.db.close();
    }
  });
  it("adds a repeated body occurrence by exact source span", () => {
    const body = "At battle start, one D6. Later, one D6.";
    const value = fixture(NAME, body);
    try {
      const first = body.indexOf("one D6");
      const second = body.lastIndexOf("one D6");
      insertSpan(value.db, value.abilityId, "RAW_TEXT", first, first + Buffer.byteLength("one D6", "utf8"), "one D6");
      const secondSpanId = insertSpan(value.db, value.abilityId, "RAW_TEXT", second, second + Buffer.byteLength("one D6", "utf8"), "one D6");
      const report = applyChatReview(value.db, {
        reviewer: REVIEWER,
        decisions: [{
          action: "add", ability_version_id: value.abilityId, span_id: secondSpanId, exact_text: "one D6",
          role: "EVENT", family_id: "event", family_version: currentFamilyVersion("event"), parameters: { kind: "battle-started" },
        }],
      });
      expect(report.failed).toEqual([]);
      const span = value.db.prepare("SELECT span_id FROM annotations WHERE status = 'active'").get() as { span_id: number };
      expect(span.span_id).toBe(secondSpanId);
    } finally {
      value.db.close();
    }
  });

  it("adds an occurrence by paired exact UTF-8 offsets", () => {
    const body = "At battle start, one D6. Later, one D6.";
    const value = fixture(NAME, body);
    try {
      const first = body.indexOf("one D6");
      const end = first + Buffer.byteLength("one D6", "utf8");
      insertSpan(value.db, value.abilityId, "RAW_TEXT", first, end, "one D6");
      const report = applyChatReview(value.db, {
        reviewer: REVIEWER,
        decisions: [{
          action: "add", ability_version_id: value.abilityId, start_byte: first, end_byte: end, exact_text: "one D6",
          role: "EVENT", family_id: "event", family_version: currentFamilyVersion("event"), parameters: { kind: "battle-started" },
        }],
      });
      expect(report.failed).toEqual([]);
      const span = value.db.prepare("SELECT span_id FROM annotations WHERE status = 'active'").get() as { span_id: number };
      expect(span.span_id).toBe(value.db.prepare("SELECT id FROM source_spans WHERE start_byte = ? AND end_byte = ?").get(first, end).id);
    } finally {
      value.db.close();
    }
  });

  it("rejects an explicit add occurrence whose wording does not match", () => {
    const body = "At battle start, one D6. Later, one D6.";
    const value = fixture(NAME, body);
    try {
      const second = body.lastIndexOf("one D6");
      const spanId = insertSpan(value.db, value.abilityId, "RAW_TEXT", second, second + Buffer.byteLength("one D6", "utf8"), "one D6");
      const report = applyChatReview(value.db, {
        reviewer: REVIEWER,
        decisions: [{
          action: "add", ability_version_id: value.abilityId, span_id: spanId, exact_text: "other text",
          role: "EVENT", family_id: "event", family_version: currentFamilyVersion("event"), parameters: { kind: "battle-started" },
        }],
      });
      expect(report.applied).toEqual([]);
      expect(report.failed[0]?.error).toMatch(/text does not exactly match/u);
    } finally {
      value.db.close();
    }
  });
  it("allows an explicitly hashed historical add without changing current state", () => {
    const value = fixture();
    try {
      const sourceHash = value.db.prepare("SELECT source_hash FROM abilities WHERE id = ?").get(value.abilityId) as { source_hash: string };
      value.db.prepare("UPDATE abilities SET current = 0 WHERE id = ?").run(value.abilityId);
      const report = addName(value, { historical: true, source_hash: sourceHash.source_hash });
      expect(report.failed).toEqual([]);
      expect(value.db.prepare("SELECT current FROM abilities WHERE id = ?").get(value.abilityId)).toEqual({ current: 0 });
    } finally {
      value.db.close();
    }
  });

  it("rejects a historical add with a mismatched source hash", () => {
    const value = fixture();
    try {
      value.db.prepare("UPDATE abilities SET current = 0 WHERE id = ?").run(value.abilityId);
      const report = addName(value, { historical: true, source_hash: "f".repeat(64) });
      expect(report.failed[0]?.error).toMatch(/source hash does not match/u);
    } finally {
      value.db.close();
    }
  });
  it("retires an authorized executable annotation and restores it through review undo", () => {
    const value = fixture();
    try {
      addName(value);
      const annotation = value.db.prepare("SELECT id FROM annotations WHERE status = 'active' LIMIT 1").get() as { id: number };
      const report = applyChatReview(value.db, {
        reviewer: REVIEWER,
        decisions: [{ action: "retire", annotation_id: annotation.id }],
      });
      expect(report.failed).toEqual([]);
      expect(value.db.prepare("SELECT status FROM annotations WHERE id = ?").get(annotation.id)).toEqual({ status: "superseded" });
      undoBatch(value.db, report.applied[0]!.batch_id, { reviewer: REVIEWER }, humanActor(REVIEWER, "test"));
      expect(value.db.prepare("SELECT status FROM annotations WHERE id = ?").get(annotation.id)).toEqual({ status: "active" });
    } finally {
      value.db.close();
    }
  });

  it("rejects retirement of a historical annotation without explicit historical authorization", () => {
    const value = fixture();
    try {
      addName(value);
      const annotation = value.db.prepare("SELECT id FROM annotations WHERE status = 'active' LIMIT 1").get() as { id: number };
      value.db.prepare("UPDATE abilities SET current = 0 WHERE id = ?").run(value.abilityId);
      const report = applyChatReview(value.db, {
        reviewer: REVIEWER,
        decisions: [{ action: "retire", annotation_id: annotation.id }],
      });
      expect(report.failed[0]?.error).toMatch(/source version is stale/u);
      expect(value.db.prepare("SELECT status FROM annotations WHERE id = ?").get(annotation.id)).toEqual({ status: "active" });
    } finally {
      value.db.close();
    }
  });
  it("rejects retirement when the annotation belongs to another ability version", () => {
    const value = fixture();
    try {
      addName(value);
      const annotation = value.db.prepare("SELECT id FROM annotations WHERE status = 'active' LIMIT 1").get() as { id: number };
      const ability = value.db.prepare("SELECT source_hash FROM abilities WHERE id = ?").get(value.abilityId) as { source_hash: string };
      const fragments = JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(BODY, "utf8"), text: BODY }]);
      const otherId = Number(value.db.prepare(`
        INSERT INTO abilities (faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, metadata_json, fragments_json, current)
        VALUES ('fixture', 'captain-copy', ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
      `).run(ability.source_hash, BODY, NAME, fragments).lastInsertRowid);
      const wording = nameBytes(NAME, "psyker level 3");
      insertSpan(value.db, otherId, "NAME", wording.start_byte, wording.end_byte, "psyker level 3");
      expect(() => applyAnnotationBatch(value.db, {
        reviewer: REVIEWER,
        decisions: [{
          action: "retire", ability_version_id: otherId, source_hash: ability.source_hash,
          fragment: "NAME", start_byte: wording.start_byte, end_byte: wording.end_byte,
          exact_text: "psyker level 3", role: "EFFECT", supersedes_annotation_id: annotation.id,
        }],
      }, humanActor(REVIEWER, "test"))).toThrow(/does not belong to this source version/u);
    } finally {
      value.db.close();
    }
  });
  it("rejects historical retirement with a mismatched source hash", () => {
    const value = fixture();
    try {
      addName(value);
      const annotation = value.db.prepare("SELECT id FROM annotations WHERE status = 'active' LIMIT 1").get() as { id: number };
      value.db.prepare("UPDATE abilities SET current = 0 WHERE id = ?").run(value.abilityId);
      const report = applyChatReview(value.db, {
        reviewer: REVIEWER,
        decisions: [{ action: "retire", annotation_id: annotation.id, historical: true, source_hash: "f".repeat(64) }],
      });
      expect(report.failed[0]?.error).toMatch(/source version is stale/u);
      expect(value.db.prepare("SELECT status FROM annotations WHERE id = ?").get(annotation.id)).toEqual({ status: "active" });
    } finally {
      value.db.close();
    }
  });
  it("requires explicit historical authorization for a stale source version", () => {
    const value = fixture();
    try {
      addName(value);
      const annotation = value.db.prepare("SELECT id FROM annotations WHERE status = 'active' LIMIT 1").get() as { id: number };
      value.db.prepare("UPDATE abilities SET current = 0 WHERE id = ?").run(value.abilityId);
      const ordinary = applyChatReview(value.db, {
        reviewer: REVIEWER,
        decisions: [{ action: "correct", annotation_id: annotation.id, family_id: "characteristic-set", family_version: currentFamilyVersion("characteristic-set"), parameters: PARAMETERS }],
      });
      expect(ordinary.failed[0]?.error).toMatch(/source version is stale/u);
      const historical = applyChatReview(value.db, {
        reviewer: REVIEWER,
        decisions: [{ action: "correct", annotation_id: annotation.id, historical: true, family_id: "characteristic-set", family_version: currentFamilyVersion("characteristic-set"), parameters: PARAMETERS }],
      });
      expect(historical.failed).toEqual([]);
      expect(value.db.prepare("SELECT current FROM abilities WHERE id = ?").get(value.abilityId)).toEqual({ current: 0 });
    } finally {
      value.db.close();
    }
  });

  it("rejects historical authorization with a mismatched source hash", () => {
    const value = fixture();
    try {
      addName(value);
      const annotation = value.db.prepare("SELECT id FROM annotations WHERE status = 'active' LIMIT 1").get() as { id: number };
      value.db.prepare("UPDATE abilities SET current = 0 WHERE id = ?").run(value.abilityId);
      const report = applyChatReview(value.db, {
        reviewer: REVIEWER,
        decisions: [{ action: "correct", annotation_id: annotation.id, historical: true, source_hash: "f".repeat(64), family_id: "characteristic-set", family_version: currentFamilyVersion("characteristic-set"), parameters: PARAMETERS }],
      });
      expect(report.failed[0]?.error).toMatch(/source version is stale/u);
      expect(value.db.prepare("SELECT current FROM abilities WHERE id = ?").get(value.abilityId)).toEqual({ current: 0 });
    } finally {
      value.db.close();
    }
  });

  it("rejects historical authorization on a current source version", () => {
    const value = fixture();
    try {
      addName(value);
      const annotation = value.db.prepare("SELECT id FROM annotations WHERE status = 'active' LIMIT 1").get() as { id: number };
      const sourceHash = value.db.prepare("SELECT source_hash FROM abilities WHERE id = ?").get(value.abilityId) as { source_hash: string };
      const report = applyChatReview(value.db, {
        reviewer: REVIEWER,
        decisions: [{ action: "correct", annotation_id: annotation.id, historical: true, source_hash: sourceHash.source_hash, family_id: "characteristic-set", family_version: currentFamilyVersion("characteristic-set"), parameters: PARAMETERS }],
      });
      expect(report.failed[0]?.error).toMatch(/stale or has an invalid historical authorization/u);
    } finally {
      value.db.close();
    }
  });
});
