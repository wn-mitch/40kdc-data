import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalize, hashJson } from "../src/round4/hash.js";
import { initializeWorkbench } from "../src/round5c/db.js";
import { familyRole, normalizeFingerprintParameters, validateFingerprint } from "../src/round5c/contracts.js";
import { importLuna, prepareLuna, type PreparedLuna } from "../src/round5c/proposal.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };

const temporaryDirectories: string[] = [];
let previousArtifactDirectory: string | undefined;

beforeEach(() => {
  previousArtifactDirectory = process.env.ROUND5C_ARTIFACT_DIR;
  const directory = mkdtempSync(join(tmpdir(), "round5c-luna-"));
  temporaryDirectories.push(directory);
  process.env.ROUND5C_ARTIFACT_DIR = directory;
});

afterEach(() => {
  if (previousArtifactDirectory === undefined) delete process.env.ROUND5C_ARTIFACT_DIR;
  else process.env.ROUND5C_ARTIFACT_DIR = previousArtifactDirectory;
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

type SourceFixture = {
  db: DatabaseSync;
  ids: number[];
};

type RequestAbility = {
  faction_id: string;
  ability_id: string;
  source_hash: string;
  source_text: string;
  fragments: Array<{ fragment: string; start_byte: number; end_byte: number; text: string }>;
};

type ModelSpan = {
  start_byte: number;
  end_byte: number;
  exact_text: string;
  role: string;
  status: string;
  family_id?: string;
  family_version?: number;
  parameters?: Record<string, unknown>;
};

type ModelResponse = {
  schema_version: number;
  input_hash: string;
  model: string;
  model_version: string;
  prompt_version: string;
  abilities: Array<{
    faction_id: string;
    ability_id: string;
    source_hash: string;
    spans: ModelSpan[];
    structural_spans: unknown[];
    connectives: unknown[];
    unresolved_regions: unknown[];
  }>;
};

type PreparedRequest = { abilities: RequestAbility[] };

function sourceSpan(source: string, text: string): { start_byte: number; end_byte: number; exact_text: string } {
  const start = source.indexOf(text);
  if (start < 0) throw new Error(`Missing fixture text: ${text}`);
  return {
    start_byte: Buffer.byteLength(source.slice(0, start), "utf8"),
    end_byte: Buffer.byteLength(source.slice(0, start + text.length), "utf8"),
    exact_text: text,
  };
}

function insertAbility(
  db: DatabaseSync,
  abilityId: string,
  source: string,
  fragments = [{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source, "utf8"), text: source }],
): number {
  return Number(db.prepare(`
    INSERT INTO abilities (
      faction_id, ability_id, source_hash, source_text, source_type, source_kind,
      name, metadata_json, fragments_json, current
    ) VALUES ('fixture', ?, ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
  `).run(abilityId, hashJson({ text: source }), source, abilityId, JSON.stringify(fragments)).lastInsertRowid);
}

function fixture(rows: Array<{ abilityId: string; source: string; fragments?: Array<{ fragment: string; start_byte: number; end_byte: number; text: string }> }>): SourceFixture {
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  return {
    db,
    ids: rows.map((row) => insertAbility(db, row.abilityId, row.source, row.fragments)),
  };
}

function preparedRequest(prepared: PreparedLuna): PreparedRequest {
  return prepared.request as PreparedRequest;
}

function emptyResponse(prepared: PreparedLuna): ModelResponse {
  return {
    schema_version: 2,
    input_hash: prepared.input_hash,
    model: "luna",
    model_version: "test",
    prompt_version: "v2",
    abilities: preparedRequest(prepared).abilities.map((ability) => ({
      faction_id: ability.faction_id,
      ability_id: ability.ability_id,
      source_hash: ability.source_hash,
      spans: [],
      structural_spans: [],
      connectives: [],
      unresolved_regions: [],
    })),
  };
}
function existingRerollSpan(ability: RequestAbility) {
  const text = "Re-roll a Hit roll of 1";
  return {
    ...sourceSpan(ability.source_text, text),
    role: "EFFECT",
    status: "EXISTING",
    family_id: "reroll",
    family_version: 1,
    parameters: { roll: "hit", subset: "ones" },
  };
}

describe("Round 5C external Luna transport", () => {
  it("caps the canonical request without truncating complete abilities and marks oversized source for manual review", () => {
    const large = "Oversized source ".repeat(3_999) + "Oversized source";
    const rows = [
      { abilityId: "a-oversized", source: large },
      ...Array.from({ length: 13 }, (_, index) => ({ abilityId: `normal-${String(index).padStart(2, "0")}`, source: `Re-roll a Hit roll of 1. ${index}` })),
    ];
    const value = fixture(rows);
    try {
      const prepared = prepareLuna(value.db);
      const request = preparedRequest(prepared);
      expect(request.abilities).toHaveLength(12);
      expect(Buffer.byteLength(canonicalize(prepared.request), "utf8")).toBeLessThanOrEqual(48 * 1024);
      expect(readFileSync(prepared.request_path, "utf8")).toBe(canonicalize(prepared.request));
      for (const ability of request.abilities) {
        expect(ability.source_text).toBe(rows.find((row) => row.abilityId === ability.ability_id)?.source);
      }
      const next = prepareLuna(value.db, { limit: 12 });
      expect(preparedRequest(next).abilities.map((ability) => ability.ability_id)).toEqual(["normal-12"]);
      expect(value.db.prepare("SELECT count(*) AS total FROM gaps WHERE description LIKE 'Complete ability exceeds%' ").get())
        .toEqual({ total: 1 });
    } finally {
      value.db.close();
    }
  });

  it("rejects unknown families atomically and closes the run as failed", () => {
    const value = fixture([{ abilityId: "unknown-family", source: "Re-roll a Hit roll of 1." }]);
    try {
      const prepared = prepareLuna(value.db, { limit: 1 });
      const response = emptyResponse(prepared);
      const ability = preparedRequest(prepared).abilities[0]!;
      response.abilities[0]!.spans = [{
        ...sourceSpan(ability.source_text, "Re-roll a Hit roll of 1"),
        role: "EFFECT",
        status: "EXISTING",
        family_id: "unknown-family",
        family_version: 1,
        parameters: {},
      }];

      expect(() => importLuna(value.db, { run_id: prepared.run_id, response })).toThrow(/Unknown reviewed semantic family/i);
      expect(value.db.prepare("SELECT count(*) AS total FROM proposals").get()).toEqual({ total: 0 });
      expect(value.db.prepare("SELECT status FROM model_runs WHERE id = ?").get(Number(prepared.run_id))).toEqual({ status: "failed" });
    } finally {
      value.db.close();
    }
  });

  it("uses UTF-8 byte offsets and fragment bounds, then makes an omitted source clause explicit", () => {
    const source = "When café matters\nRe-roll a Hit roll of 1.";
    const when = "When café matters";
    const fragments = [
      { fragment: "WHEN", start_byte: 0, end_byte: Buffer.byteLength(when, "utf8"), text: when },
      {
        fragment: "EFFECT",
        start_byte: Buffer.byteLength(`${when}\n`, "utf8"),
        end_byte: Buffer.byteLength(source, "utf8"),
        text: "Re-roll a Hit roll of 1.",
      },
    ];
    const value = fixture([{ abilityId: "utf8", source, fragments }]);
    try {
      const prepared = prepareLuna(value.db, { limit: 1 });
      const requestAbility = preparedRequest(prepared).abilities[0]!;
      const response = emptyResponse(prepared);
      response.abilities[0]!.spans = [existingRerollSpan(requestAbility)];

      expect(importLuna(value.db, { run_id: prepared.run_id, response })).toEqual({
        run_id: prepared.run_id,
        proposals: 1,
        unresolved: 1,
        structural: 0,
        candidates: 0,
      });
      expect(() => importLuna(value.db, { run_id: prepared.run_id, response })).toThrow(/already been imported or failed/i);
      expect(value.db.prepare(`
        SELECT source_spans.fragment, source_spans.exact_text
        FROM proposals
        JOIN source_spans ON source_spans.id = proposals.span_id
        WHERE proposals.role = 'UNRESOLVED'
      `).get()).toEqual({ fragment: "WHEN", exact_text: when });
    } finally {
      value.db.close();
    }
  });

  it("includes every selected ability in the request and rejects an incomplete response", () => {
    const value = fixture([
      { abilityId: "first", source: "Re-roll a Hit roll of 1." },
      { abilityId: "second", source: "Re-roll a Hit roll of 1." },
    ]);
    try {
      const prepared = prepareLuna(value.db, { limit: 2 });
      const request = preparedRequest(prepared);
      expect(request.abilities.map((ability) => ability.ability_id)).toEqual(["first", "second"]);
      const response = emptyResponse(prepared);
      response.abilities.pop();

      expect(() => importLuna(value.db, { run_id: prepared.run_id, response })).toThrow(/every prepared ability exactly once/i);
      expect(value.db.prepare("SELECT count(*) AS total FROM proposals").get()).toEqual({ total: 0 });
      expect(value.db.prepare("SELECT status FROM model_runs WHERE id = ?").get(Number(prepared.run_id))).toEqual({ status: "failed" });
    } finally {
      value.db.close();
    }
  });
  it("turns a fully unreported requested ability into an explicit unresolved region", () => {
    const value = fixture([{ abilityId: "silent", source: "A semantic clause remains." }]);
    try {
      const prepared = prepareLuna(value.db, { limit: 1 });
      expect(importLuna(value.db, { run_id: prepared.run_id, response: emptyResponse(prepared) })).toEqual({
        run_id: prepared.run_id,
        proposals: 0,
        unresolved: 1,
        structural: 0,
        candidates: 0,
      });
      expect(value.db.prepare(`
        SELECT source_spans.exact_text, proposals.status
        FROM proposals
        JOIN source_spans ON source_spans.id = proposals.span_id
      `).get()).toEqual({ exact_text: "A semantic clause remains", status: "unresolved" });
      const repeat = prepareLuna(value.db, { limit: 1 });
      expect(preparedRequest(repeat).abilities.map((ability) => ability.ability_id)).toEqual(["silent"]);
    } finally {
      value.db.close();
    }
  });

});

describe("Round 5C characteristic-set family", () => {
  it("registers bearer characteristic assignments as reviewed effects", () => {
    const value = fixture([{ abilityId: "characteristics", source: "The bearer's M characteristic is 7 and its Sv characteristic is 3." }]);
    try {
      expect(familyRole("characteristic-set")).toBe("EFFECT");
      expect(normalizeFingerprintParameters("characteristic-set", {
        subject: "bearer",
        characteristic: "M",
        value: 7,
      })).toEqual({ subject: "bearer", characteristic: "M", value: 7 });
      expect(normalizeFingerprintParameters("characteristic-set", {
        subject: "bearer",
        characteristic: "Sv",
        value: 3,
      })).toEqual({ subject: "bearer", characteristic: "Sv", value: 3 });

      expect(validateFingerprint(
        value.db,
        "characteristic-set",
        { subject: "bearer", characteristic: "M", value: 7 },
        1,
        "The bearer's M characteristic is 7",
      )).toMatch(/^fp_/);
      expect(validateFingerprint(
        value.db,
        "characteristic-set",
        { subject: "bearer", characteristic: "Sv", value: 3 },
        1,
        "its Sv characteristic is 3",
      )).toMatch(/^fp_/);
    } finally {
      value.db.close();
    }
  });

  it("allows exact source-qualified values but rejects invalid characteristic parameters", () => {
    const value = fixture([{ abilityId: "source-qualified", source: "Set the bearer's M characteristic to D6." }]);
    try {
      expect(validateFingerprint(
        value.db,
        "characteristic-set",
        { subject: "bearer", characteristic: "M", value: { source: "D6" } },
        1,
        "Set the bearer's M characteristic to D6",
      )).toMatch(/^fp_/);
      expect(() => normalizeFingerprintParameters("characteristic-set", {
        subject: "target-unit",
        characteristic: "M",
        value: 7,
      })).toThrow(/characteristic-set.subject/i);
      expect(() => normalizeFingerprintParameters("characteristic-set", {
        subject: "bearer",
        characteristic: "Move",
        value: 7,
      })).toThrow(/characteristic-set.characteristic/i);
      expect(() => validateFingerprint(
        value.db,
        "characteristic-set",
        { subject: "bearer", characteristic: "M", value: { source: "D3" } },
        1,
        "Set the bearer's M characteristic to D6",
      )).toThrow(/exact source span/i);
    } finally {
      value.db.close();
    }
  });
});

describe("Round 5C turn and faction leaves", () => {
  it("registers distinct turn starts and requires an exact source-backed faction", () => {
    const source = "At the start of your opponent's turn, if your army faction is Example Guard, gain a point.";
    const value = fixture([{ abilityId: "timing", source }]);
    try {
      expect(familyRole("turn-start")).toBe("EVENT");
      expect(familyRole("army-faction")).toBe("CONDITION");
      for (const turn of ["battle-round", "player-turn", "opponent-turn"]) {
        expect(validateFingerprint(value.db, "turn-start", { turn }, 1)).toMatch(/^fp_/);
      }
      expect(validateFingerprint(value.db, "army-faction", { faction: { source: "Example Guard" } }, 1, source)).toMatch(/^fp_/);
      expect(() => validateFingerprint(value.db, "army-faction", { faction: { source: "Other Guard" } }, 1, source)).toThrow(/exact source span/i);
      expect(() => normalizeFingerprintParameters("army-faction", { faction: "Example Guard" })).toThrow(/source-qualified/i);
    } finally {
      value.db.close();
    }
  });
});
