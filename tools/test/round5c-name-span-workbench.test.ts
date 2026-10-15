import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { getAbilityCoverage } from "../src/round5c/coverage.js";
import { initializeWorkbench, insertSpan } from "../src/round5c/db.js";
import { currentFamilyVersion } from "../src/round5c/contracts.js";
import { applyChatReview, type ChatDecision } from "../src/round5c/review-apply.js";

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
});
