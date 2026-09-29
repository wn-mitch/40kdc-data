import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalize, hashJson } from "../src/round4/hash.js";
import { initializeWorkbench } from "../src/round5c/db.js";
import { familyRole, normalizeFingerprintParameters, validateFingerprint } from "../src/round5c/contracts.js";
import { dropUncoveredRegions, importLuna, prepareLuna, serializeLunaRequest, type PreparedLuna } from "../src/round5c/proposal.js";
import { lunaStdinEnvelope } from "../src/round5c/luna-schema.js";
import { getCurrentCoverage } from "../src/round5c/coverage.js";

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
    family_version: 2,
    parameters: { roll: "hit", subset: "ones", weapon_type: "all" },
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
      // The cap bites: some but not all of the 13 normal abilities fit, in order, each whole.
      const sent = request.abilities.map((ability) => ability.ability_id);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.length).toBeLessThan(13);
      expect(sent).toEqual(rows.slice(1, 1 + sent.length).map((row) => row.abilityId));
      // The budget covers the abilities; the fixed instructions and family registry sit outside it.
      const fixedBytes = Buffer.byteLength(canonicalize({ ...prepared.request, abilities: [] }), "utf8");
      expect(Buffer.byteLength(canonicalize(prepared.request), "utf8") - fixedBytes).toBeLessThanOrEqual(48 * 1024);
      expect(readFileSync(prepared.request_path, "utf8")).toBe(serializeLunaRequest(prepared.request as Parameters<typeof serializeLunaRequest>[0]));
      for (const ability of request.abilities) {
        expect(ability.source_text).toBe(rows.find((row) => row.abilityId === ability.ability_id)?.source);
      }
      // The next request resumes at the first ability the capped one left out.
      const next = prepareLuna(value.db, { limit: 12 });
      expect(preparedRequest(next).abilities[0]?.ability_id).toBe(rows[1 + sent.length]!.abilityId);
      expect(value.db.prepare("SELECT count(*) AS total FROM gaps WHERE description LIKE 'Complete ability exceeds%' ").get())
        .toEqual({ total: 1 });
    } finally {
      value.db.close();
    }
  });

  it("caps a batch by outputBudgetTokens even when limit and the byte budget would allow more", () => {
    // Four abilities, each well inside the 48 KiB byte budget on its own; a small output-token
    // budget (a fraction of one ability's own estimated output) still stops the batch after the
    // first ability instead of packing all four in, the way the DeepSeek transport's default
    // batch-of-2 relies on this cap rather than `limit` alone.
    const rows = Array.from({ length: 4 }, (_, index) => ({ abilityId: `budget-${index}`, source: `Re-roll a Hit roll of 1. Ability ${index}.` }));
    const value = fixture(rows);
    try {
      const prepared = prepareLuna(value.db, { limit: 12, outputBudgetTokens: 1 });
      expect(preparedRequest(prepared).abilities.map((ability) => ability.ability_id)).toEqual(["budget-0"]);
      // Unset (the default) preserves the byte-budget-only behavior every other test relies on.
      const secondValue = fixture(rows);
      try {
        const unbudgeted = prepareLuna(secondValue.db, { limit: 12 });
        expect(preparedRequest(unbudgeted).abilities.length).toBe(4);
      } finally {
        secondValue.db.close();
      }
    } finally {
      value.db.close();
    }
  });

  it("gives two requests for different abilities an identical byte prefix up to \"abilities\", so a prompt-prefix cache can hit", () => {
    // Two abilities each on their own, via `limit: 1`, guarantees two different `abilities`
    // arrays over the same registry and confirmed examples — exactly what a real residue sweep
    // sends across successive DeepSeek requests.
    const value = fixture([
      { abilityId: "prefix-one", source: "Re-roll a Hit roll of 1." },
      { abilityId: "prefix-two", source: "Re-roll a Wound roll of 1." },
    ]);
    try {
      const first = prepareLuna(value.db, { limit: 1 });
      const second = prepareLuna(value.db, { limit: 1 });
      expect(preparedRequest(first).abilities.map((a) => a.ability_id)).toEqual(["prefix-one"]);
      expect(preparedRequest(second).abilities.map((a) => a.ability_id)).toEqual(["prefix-two"]);

      const firstSerialized = readFileSync(first.request_path, "utf8");
      const secondSerialized = readFileSync(second.request_path, "utf8");
      expect(firstSerialized).not.toBe(secondSerialized); // the abilities differ, so the requests must too
      const abilitiesMarker = ',"abilities":';
      const firstSplit = firstSerialized.indexOf(abilitiesMarker);
      const secondSplit = secondSerialized.indexOf(abilitiesMarker);
      expect(firstSplit).toBeGreaterThan(0);
      // Everything up to and including the `"abilities":` marker — every fixed field
      // (confirmed_examples, instructions, lexical_vocabulary, registry, response_schema,
      // schema_version) — is byte-identical between the two requests.
      expect(firstSerialized.slice(0, firstSplit + abilitiesMarker.length))
        .toBe(secondSerialized.slice(0, secondSplit + abilitiesMarker.length));
      expect(firstSerialized.slice(firstSplit)).not.toBe(secondSerialized.slice(secondSplit));

      // The actual stdin envelope (what `finishLunaRun` sends the model) preserves that same
      // shared prefix: `request` comes first, so `input_hash` — which necessarily differs per
      // request — trails behind the fixed part instead of leading it.
      const firstEnvelope = lunaStdinEnvelope(first.input_hash, firstSerialized);
      const secondEnvelope = lunaStdinEnvelope(second.input_hash, secondSerialized);
      expect(firstEnvelope.startsWith('{"request":')).toBe(true);
      expect(firstEnvelope.slice(0, firstSplit + '{"request":'.length))
        .toBe(secondEnvelope.slice(0, secondSplit + '{"request":'.length));
    } finally {
      value.db.close();
    }
  });

  it("accepts a precomputed coverage snapshot in place of its own getCurrentCoverage pass, for a caller batching several requests", () => {
    const rows = [
      { abilityId: "batch-one", source: "Re-roll a Hit roll of 1." },
      { abilityId: "batch-two", source: "Re-roll a Wound roll of 1." },
    ];
    // Two independent, identically-seeded databases: one exercises prepareLuna's default
    // internal getCurrentCoverage pass, the other a precomputed snapshot — same DB content, so
    // any difference in what gets selected is down to the coverage source, not fixture drift.
    const withoutSnapshot = fixture(rows);
    const withSnapshot = fixture(rows);
    try {
      const defaultResult = prepareLuna(withoutSnapshot.db, { limit: 1 });
      const coverage = getCurrentCoverage(withSnapshot.db);
      const snapshotResult = prepareLuna(withSnapshot.db, { limit: 1, coverage });
      expect(preparedRequest(snapshotResult).abilities.map((a) => a.ability_id))
        .toEqual(preparedRequest(defaultResult).abilities.map((a) => a.ability_id));

      // Proof the snapshot is actually consulted rather than silently ignored: an empty one
      // (as if nothing were ever confirmed) leaves prepareLuna with no residue to select from,
      // even though the database's own live coverage has plenty.
      const emptyCoverage = fixture(rows);
      try {
        expect(() => prepareLuna(emptyCoverage.db, { limit: 1, coverage: new Map() }))
          .toThrow(/No current abilities are available/i);
      } finally {
        emptyCoverage.db.close();
      }
    } finally {
      withoutSnapshot.db.close();
      withSnapshot.db.close();
    }
  });

  it("degrades a span with an unknown family to a rejected UNRESOLVED entry instead of failing the whole response", () => {
    // Per-span classification failures (bad family, bad parameters, role/family mismatch, …)
    // must not throw away every other well-formed span in the same response — only an
    // envelope-level problem (bad input_hash, unknown ability identity, malformed structure) does
    // that (covered elsewhere, e.g. the luna-run "forged self-report and malformed body" test).
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

      const result = importLuna(value.db, { run_id: prepared.run_id, response });
      expect(result.rejected_spans).toBe(1);
      expect(result.proposals).toBe(0);
      expect(result.unresolved).toBe(1);
      expect(value.db.prepare("SELECT status FROM model_runs WHERE id = ?").get(Number(prepared.run_id))).toEqual({ status: "completed" });
      const row = value.db.prepare(`
        SELECT proposals.role, proposals.status, json_extract(proposals.reason_json, '$.description') AS description
        FROM proposals
      `).get() as { role: string; status: string; description: string };
      expect(row).toEqual({ role: "UNRESOLVED", status: "unresolved", description: expect.stringMatching(/^Rejected: .*Unknown reviewed semantic family/i) });
    } finally {
      value.db.close();
    }
  });

  it("imports a valid span from a response even when another span in the same ability fails classification", () => {
    const source = "Re-roll a Hit roll of 1, gain a bogus token.";
    const value = fixture([{ abilityId: "mixed-validity", source }]);
    try {
      const prepared = prepareLuna(value.db, { limit: 1 });
      const requestAbility = preparedRequest(prepared).abilities[0]!;
      const response = emptyResponse(prepared);
      response.abilities[0]!.spans = [
        existingRerollSpan(requestAbility),
        {
          ...sourceSpan(requestAbility.source_text, "gain a bogus token"),
          role: "EFFECT",
          status: "EXISTING",
          family_id: "no-such-family",
          family_version: 1,
          parameters: {},
        },
      ];

      const result = importLuna(value.db, { run_id: prepared.run_id, response });
      expect(result.rejected_spans).toBe(1);
      expect(result.proposals).toBe(1); // the valid reroll span still imported
      const proposals = value.db.prepare(`
        SELECT proposals.role, proposals.status, source_spans.exact_text FROM proposals
        JOIN source_spans ON source_spans.id = proposals.span_id
        ORDER BY source_spans.start_byte
      `).all() as Array<{ role: string; status: string; exact_text: string }>;
      expect(proposals[0]).toMatchObject({ exact_text: "Re-roll a Hit roll of 1", status: "pending" });
      expect(proposals.find((p) => p.exact_text === "gain a bogus token")).toMatchObject({ role: "UNRESOLVED", status: "unresolved" });
    } finally {
      value.db.close();
    }
  });

  it("drops a span that lands outside the prepared uncovered source as a counted, non-erroring omission", () => {
    // Direct unit test of dropUncoveredRegions: a region whose byte range never overlaps any of
    // the ability's uncovered_regions (already covered by something else since the request was
    // prepared, or simply outside them) is silently removed and counted — not a thrown error —
    // while a region that does overlap is kept untouched.
    const ability = {
      id: 1, faction_id: "fixture", ability_id: "covered", source_hash: "x".repeat(64),
      source_text: "Re-roll a Hit roll of 1 and gain a glimmer token.", fragments_json: "[]",
    };
    const configured = [{
      ability_version_id: 1, faction_id: "fixture", ability_id: "covered", source_hash: ability.source_hash,
      uncovered_regions: [{ fragment: "RAW_TEXT", start_byte: 0, end_byte: 23 }], // only "Re-roll a Hit roll of 1" is still open
    }];
    const kept = { kind: "semantic" as const, ability, fragment: "RAW_TEXT", start_byte: 0, end_byte: 23, exact_text: "Re-roll a Hit roll of 1",
      reported_role: "EFFECT" as const, role: "EFFECT" as const, status: "NOVEL" as const, fingerprint_id: null, qualifier_spans: [],
      description: null, hypothesis: null, index: 0, offset_repaired: false };
    const droppedSpan = { ...kept, start_byte: 28, end_byte: 49, exact_text: "gain a glimmer token.", index: 1 };
    const parsed = {
      model: "test", model_version: "test", prompt_version: "v2", latency_ms: null, cost_usd: null, version: 2 as const,
      semantic_spans: [kept, droppedSpan], structural: [], connectives: [], unresolved: [],
      rejected_spans: 0, dropped_covered_spans: 0,
    };
    dropUncoveredRegions(parsed, configured);
    expect(parsed.semantic_spans).toEqual([kept]);
    expect(parsed.dropped_covered_spans).toBe(1);
    expect(parsed.rejected_spans).toBe(0); // a drop is never a rejection: no reason is recorded, nothing is reviewed
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
        rejected_spans: 0,
        dropped_covered_spans: 0,
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
        rejected_spans: 0,
        dropped_covered_spans: 0,
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
  it("registers the bearer's characteristic assignments as this-model effects", () => {
    const value = fixture([{ abilityId: "characteristics", source: "The bearer's M characteristic is 7 and its Sv characteristic is 3." }]);
    try {
      expect(familyRole("characteristic-set")).toBe("EFFECT");
      expect(normalizeFingerprintParameters("characteristic-set", {
        subject: "this-model",
        characteristic: "M",
        value: 7,
      }, 2)).toEqual({ subject: "this-model", characteristic: "M", value: 7 });
      // "The bearer" is this model; version 2 has no second spelling of it.
      expect(() => normalizeFingerprintParameters("characteristic-set", { subject: "bearer", characteristic: "M", value: 7 }, 2)).toThrow(/characteristic-set.subject/i);
      expect(() => validateFingerprint(value.db, "characteristic-set", { subject: "bearer", characteristic: "M", value: 7 }, 1)).toThrow(/not active/i);
      expect(normalizeFingerprintParameters("characteristic-set", {
        subject: "this-model",
        characteristic: "Sv",
        value: 3,
      }, 2)).toEqual({ subject: "this-model", characteristic: "Sv", value: 3 });

      expect(validateFingerprint(
        value.db,
        "characteristic-set",
        { subject: "this-model", characteristic: "M", value: 7 },
        2,
        "The bearer's M characteristic is 7",
      )).toMatch(/^fp_/);
      expect(validateFingerprint(
        value.db,
        "characteristic-set",
        { subject: "this-model", characteristic: "Sv", value: 3 },
        2,
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
        { subject: "this-model", characteristic: "M", value: { source: "D6" } },
        2,
        "Set the bearer's M characteristic to D6",
      )).toMatch(/^fp_/);
      expect(() => normalizeFingerprintParameters("characteristic-set", {
        subject: "target-unit",
        characteristic: "M",
        value: 7,
      }, 2)).toThrow(/characteristic-set.subject/i);
      expect(() => normalizeFingerprintParameters("characteristic-set", {
        subject: "this-model",
        characteristic: "Move",
        value: 7,
      }, 2)).toThrow(/characteristic-set.characteristic/i);
      expect(() => validateFingerprint(
        value.db,
        "characteristic-set",
        { subject: "this-model", characteristic: "M", value: { source: "D3" } },
        2,
        "Set the bearer's M characteristic to D6",
      )).toThrow(/exact source span/i);
    } finally {
      value.db.close();
    }
  });

  it("sends RESTRICTION and COMBINATOR families in the registry and accepts EXISTING spans labelled with those roles", () => {
    const source = "Instead of gaining a point, you can only use this Stratagem once per battle.";
    const value = fixture([{ abilityId: "restriction-combinator", source }]);
    try {
      const prepared = prepareLuna(value.db, { limit: 1 });
      const rawRegistry = (prepared.request as { registry: Array<{ id: string; role: string }> }).registry;
      expect(rawRegistry.some((family) => family.role === "RESTRICTION")).toBe(true);
      expect(rawRegistry.some((family) => family.role === "COMBINATOR")).toBe(true);

      const requestAbility = preparedRequest(prepared).abilities[0]!;
      const response = emptyResponse(prepared);
      response.abilities[0]!.spans = [
        {
          ...sourceSpan(requestAbility.source_text, "Instead"),
          role: "COMBINATOR",
          status: "EXISTING",
          family_id: "instead",
          family_version: 1,
          parameters: {},
        },
        {
          ...sourceSpan(requestAbility.source_text, "once per battle"),
          role: "RESTRICTION",
          status: "EXISTING",
          family_id: "usage-limit",
          family_version: 2,
          parameters: { frequency: "once-per-battle", per: "any" },
        },
      ];

      const result = importLuna(value.db, { run_id: prepared.run_id, response });
      expect(result.proposals).toBe(2);
      const roles = (value.db.prepare("SELECT role FROM proposals WHERE model_run_id = ? ORDER BY role").all(Number(prepared.run_id)) as Array<{ role: string }>)
        .map((row) => row.role);
      // The two labelled spans don't cover the whole source; the rest becomes an implicit
      // UNRESOLVED proposal (`addImplicitUnresolved`), not a failure of either labelled role.
      expect(roles).toEqual(["COMBINATOR", "RESTRICTION", "UNRESOLVED"]);
    } finally {
      value.db.close();
    }
  });

  it("excludes a Stratagem-only family from a unit ability's registry, and rejects it if claimed anyway", () => {
    // The fixture helper always inserts a 'unit' ability (source_type), so use-window and
    // stratagem-target (kinds: ["stratagem"]) must never appear in its request, and a response
    // that claims one anyway must degrade to UNRESOLVED, not throw the whole response away or
    // silently accept a family that means nothing on a unit ability.
    const source = "Once per battle, in the Fight phase, this model can use this ability.";
    const value = fixture([{ abilityId: "unit-timing", source }]);
    try {
      const prepared = prepareLuna(value.db, { limit: 1 });
      const rawRegistry = (prepared.request as { registry: Array<{ id: string }> }).registry;
      expect(rawRegistry.some((family) => family.id === "use-window")).toBe(false);
      expect(rawRegistry.some((family) => family.id === "stratagem-target")).toBe(false);
      expect(rawRegistry.some((family) => family.id === "activation-window")).toBe(true);

      const requestAbility = preparedRequest(prepared).abilities[0]!;
      const response = emptyResponse(prepared);
      response.abilities[0]!.spans = [{
        ...sourceSpan(requestAbility.source_text, "in the Fight phase"),
        role: "RESTRICTION",
        status: "EXISTING",
        family_id: "use-window",
        family_version: 1,
        parameters: { your_phases: [], opponent_phases: [], either_phases: ["fight"] },
      }];

      const result = importLuna(value.db, { run_id: prepared.run_id, response });
      expect(result.rejected_spans).toBe(1);
      const row = value.db.prepare(`
        SELECT proposals.role, json_extract(proposals.reason_json, '$.description') AS description
        FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
        WHERE source_spans.exact_text = 'in the Fight phase'
      `).get() as { role: string; description: string };
      expect(row.role).toBe("UNRESOLVED");
      expect(row.description).toMatch(/does not apply to a unit ability/i);
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
      expect(validateFingerprint(value.db, "army-faction", { faction: { source: "Example Guard" } }, 2, source)).toMatch(/^fp_/);
      expect(() => validateFingerprint(value.db, "army-faction", { faction: { source: "Other Guard" } }, 2, source)).toThrow(/exact source span/i);
      expect(() => normalizeFingerprintParameters("army-faction", { faction: "Example Guard" })).toThrow(/source-qualified/i);
    } finally {
      value.db.close();
    }
  });

  it("still rejects a source-qualified value found in none of the span, the ability's source text, or a binding reference", () => {
    const source = "At the start of your opponent's turn, if your army faction is Example Guard, gain a point.";
    const value = fixture([{ abilityId: "reference-rule", source }]);
    try {
      // Elsewhere in the ability's own source text: accepted even though it's outside the span.
      expect(validateFingerprint(value.db, "army-faction", { faction: { source: "Example Guard" } }, 2, "gain a point", {
        wholeSourceText: source,
      })).toMatch(/^fp_/);
      // A same-response binding reference: accepted even though it names no literal quote at all.
      expect(validateFingerprint(value.db, "army-faction", { faction: { source: "that faction" } }, 2, "gain a point", {
        wholeSourceText: source,
        bindingSurfaces: new Set(["that faction"]),
      })).toMatch(/^fp_/);
      // Found nowhere — not the span, not the ability's own text, not a binding — still rejected.
      expect(() => validateFingerprint(value.db, "army-faction", { faction: { source: "Nonexistent Guard" } }, 2, "gain a point", {
        wholeSourceText: source,
        bindingSurfaces: new Set(["that faction"]),
      })).toThrow(/must occur in the exact source span/i);
    } finally {
      value.db.close();
    }
  });
});
