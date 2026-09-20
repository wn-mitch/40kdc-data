import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import type { StampDefinition, WorkRequest } from "../src/round5c/contracts.js";
import { getWorkbenchRevision, initializeWorkbench, invalidateAbilityEvidence } from "../src/round5c/db.js";
import { applyAnnotationBatch, getDashboard } from "../src/round5c/review.js";
import { applySourceAtomBatch, proposeSourceAtom } from "../src/round5c/atoms.js";
import { approveStamp, createEscalation, decideEscalation, escalationEvidenceHash, listEscalations, previewStamp, proposeStamp, reconcileWorkbench } from "../src/round5c/stamps.js";
import { importWork, prepareWork, runDeepSeekWork, type PreparedWork } from "../src/round5c/work.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
type DatabaseSync = DatabaseType;

type AbilityFixture = { id: number; source: string; sourceHash: string };
type WorkFixture = { db: DatabaseSync; databasePath: string; directory: string; abilities: AbilityFixture[]; escalationIds: string[] };

const directories: string[] = [];
let originalArtifactDirectory: string | undefined;
let originalDataRoot: string | undefined;

let originalDeepSeekKey: string | undefined;
beforeEach(() => {
  originalArtifactDirectory = process.env.ROUND5C_ARTIFACT_DIR;
  originalDataRoot = process.env.ROUND5C_DATA_ROOT;
  originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
});

afterEach(() => {
  if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
  vi.unstubAllGlobals();
  if (originalArtifactDirectory === undefined) delete process.env.ROUND5C_ARTIFACT_DIR;
  else process.env.ROUND5C_ARTIFACT_DIR = originalArtifactDirectory;
  if (originalDataRoot === undefined) delete process.env.ROUND5C_DATA_ROOT;
  else process.env.ROUND5C_DATA_ROOT = originalDataRoot;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function addAbility(db: DatabaseSync, abilityId: string): AbilityFixture {
  const source = "Repeat the Hit roll";
  const sourceHash = hashJson({ abilityId, source });
  const inserted = db.prepare(`
    INSERT INTO abilities (
      faction_id, ability_id, source_hash, source_text, source_type, source_kind,
      name, metadata_json, fragments_json, current
    ) VALUES ('fixture', ?, ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
  `).run(abilityId, sourceHash, source, abilityId, JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source, "utf8"), text: source }]));
  return { id: Number(inserted.lastInsertRowid), source, sourceHash };
}

function fixture(count = 2): WorkFixture {
  const directory = mkdtempSync(join(tmpdir(), "round5c-work-"));
  directories.push(directory);
  process.env.ROUND5C_ARTIFACT_DIR = join(directory, "artifacts");
  const databasePath = join(directory, "workbench.sqlite");
  const db = new DatabaseSync(databasePath);
  initializeWorkbench(db);
  const abilities = Array.from({ length: count }, (_, index) => addAbility(db, `ability-${index + 1}`));
  const escalationIds = abilities.map((ability, index) => createEscalation(
    db,
    "NEW_FORM",
    { path: "uncovered-leaf", candidate_definition: { fixture: index + 1 }, question: `Interpret fixture ${index + 1}?` },
    [{ ability_version_id: ability.id, source_hash: ability.sourceHash }],
  ));
  return { db, databasePath, directory, abilities, escalationIds };
}

function definition(label: string, typed = false): StampDefinition {
  return {
    schema_version: 1,
    kind: "leaf",
    label,
    variants: [{
      id: "exact",
      source_types: "any",
      fragments: [{
        fragment: "RAW_TEXT",
        segments: typed ? [
          { id: "prefix", literal: "Repeat the " },
          { id: "roll", slot: "roll" },
          { id: "suffix", literal: " roll" },
        ] : [{ id: "form", literal: "Repeat the Hit roll" }],
      }],
      slots: typed ? { roll: { kind: "enum", values: [{ text: "Hit", value: "hit" }] } } : {},
      before: [{ boundary: "fragment" }],
      after: [{ boundary: "fragment" }],
      output: { family_id: "reroll", family_version: 1, parameters: { roll: typed ? { $bind: "roll" } : "hit", subset: "all" } },
      allow_containment: [],
    }],
  };
}

function sourceReference(source: Record<string, unknown>) {
  const text = source.source_text as string;
  return {
    ability_version_id: source.ability_version_id as number,
    source_hash: source.source_hash as string,
    fragment: "RAW_TEXT",
    start_byte: 0,
    end_byte: Buffer.byteLength(text, "utf8"),
    exact_text: text,
  };
}

function proposedResult(item: WorkRequest["items"][number], index = 0): Record<string, unknown> {
  const sources = item.sources as Array<Record<string, unknown>>;
  const escalation = item.escalation as { members: Array<{ member_id: string }> };
  return {
    definition: definition(`Fixture rule ${index + 1}`),
    positives: [sourceReference(sources[0]!)],
    counterexamples: [],
    closest_stamp_ids: [],
    exact_mismatch: "No existing approved rule covers this exact form.",
    question: "Should this exact literal form be reusable?",
    affected_member_ids: escalation.members.map((member) => member.member_id),
  };
}

function response(prepared: PreparedWork, results?: (item: WorkRequest["items"][number], index: number) => Record<string, unknown>): Record<string, unknown> {
  return {
    schema_version: 1,
    run_id: prepared.run_id,
    input_hash: prepared.input_hash,
    model: "fixture-model",
    model_version: "fixture-version",
    prompt_version: "round5c-work/v1",
    items: prepared.request.items.map((item, index) => ({ item_id: item.item_id, evidence_hash: item.evidence_hash, result: results ? results(item, index) : proposedResult(item, index) })),
    latency_ms: 5,
    cost_usd: 0,
  };
}

function stampReference(ability: AbilityFixture) {
  return {
    ability_version_id: ability.id,
    source_hash: ability.sourceHash,
    fragment: "RAW_TEXT",
    start_byte: 0,
    end_byte: Buffer.byteLength(ability.source, "utf8"),
    exact_text: ability.source,
  };
}

function buildVerificationFixture(db: DatabaseSync, directory: string): { draftId: string; abilityId: number } {
  const source = "Lead-state active; squad models repeat any Hit result.";
  const sourceHash = hashJson({ abilityId: "work-verifier", source });
  const inserted = db.prepare(`
    INSERT INTO abilities (
      faction_id, ability_id, source_hash, source_text, source_type, source_kind,
      name, metadata_json, fragments_json, current
    ) VALUES ('fixture', 'work-verifier', ?, ?, 'unit', 'fixture', 'work-verifier', '{}', ?, 1)
  `).run(sourceHash, source, JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source, "utf8"), text: source }]));
  const abilityId = Number(inserted.lastInsertRowid);
  const confirm = (exactText: string, role: "CONDITION" | "EFFECT", familyId: "leading-unit" | "reroll", parameters: Record<string, unknown>): void => {
    const characterStart = source.indexOf(exactText);
    const startByte = Buffer.byteLength(source.slice(0, characterStart), "utf8");
    applyAnnotationBatch(db, {
      reviewer: "fixture-reviewer",
      decisions: [{
        action: "confirm",
        ability_version_id: abilityId,
        source_hash: sourceHash,
        fragment: "RAW_TEXT",
        start_byte: startByte,
        end_byte: startByte + Buffer.byteLength(exactText, "utf8"),
        exact_text: exactText,
        role,
        family_id: familyId,
        family_version: 1,
        parameters,
      }],
    });
  };
  confirm("Lead-state active", "CONDITION", "leading-unit", { subject: "this-model" });
  confirm("repeat any Hit result", "EFFECT", "reroll", { roll: "hit", subset: "all" });
  // The participant graph node must rest on a reviewed structural constituent.
  const participantStart = Buffer.byteLength(source.slice(0, source.indexOf("squad models")), "utf8");
  const participant = proposeSourceAtom(db, {
    ability_version_id: abilityId, source_hash: sourceHash, fragment: "RAW_TEXT",
    start_byte: participantStart, end_byte: participantStart + Buffer.byteLength("squad models", "utf8"),
    exact_text: "squad models", kind: "participant", description: "Who benefits.", reviewer: "fixture-reviewer",
  });
  applySourceAtomBatch(db, { reviewer: "fixture-reviewer", decisions: [{ atom_proposal_id: participant.proposal_id, action: "accept", source_hash: sourceHash }] });

  const dataRoot = join(directory, "data");
  const factionDirectory = join(dataRoot, "enrichment", "fixture");
  mkdirSync(factionDirectory, { recursive: true });
  process.env.ROUND5C_DATA_ROOT = dataRoot;
  writeFileSync(join(factionDirectory, "abilities.json"), JSON.stringify([{
    ability_id: "work-verifier",
    name: "work-verifier",
    authored_by: "fixture",
    game_version: { edition: "11th", dataslate: "fixture-version" },
    faction_id: "fixture",
    ability_type: "unit",
    behavior: "reactive",
    effect: { type: "custom", target: "unit" },
    scope: { range: "unit", duration: "permanent" },
  }]));

  const composition: StampDefinition = {
    schema_version: 1,
    kind: "composition",
    label: "Verifier work composition",
    variants: [{
      id: "mapped",
      source_types: ["unit"],
      fragments: [{
        fragment: "RAW_TEXT",
        segments: [
          { id: "condition_leaf", leaf: { family_id: "leading-unit", family_version: 1 } },
          { id: "condition_joiner", literal: "; " },
          { id: "participant", slot: "participant" },
          { id: "participant_joiner", literal: " " },
          { id: "reroll_leaf", leaf: { family_id: "reroll", family_version: 1 } },
          { id: "terminator", literal: "." },
        ],
      }],
      slots: { participant: { kind: "enum", values: [{ text: "squad models", value: "unit" }] } },
      graph_template: {
        schema_version: 1,
        nodes: [{
          id: "leading_condition",
          kind: "leaf",
          family_id: "leading-unit",
          family_version: 1,
          parameters: { subject: { $bind: "condition_leaf.parameters.subject" } },
          evidence: { fragment: "RAW_TEXT", first_segment_id: "condition_leaf", last_segment_id: "condition_leaf" },
        }, {
          id: "beneficiary",
          kind: "participant",
          parameters: { target: { $bind: "participant" } },
          evidence: { fragment: "RAW_TEXT", first_segment_id: "participant", last_segment_id: "participant" },
        }, {
          id: "reroll_effect",
          kind: "leaf",
          family_id: "reroll",
          family_version: 1,
          parameters: { roll: { $bind: "reroll_leaf.parameters.roll" }, subset: { $bind: "reroll_leaf.parameters.subset" } },
          evidence: { fragment: "RAW_TEXT", first_segment_id: "reroll_leaf", last_segment_id: "reroll_leaf" },
        }],
        relations: [{
          id: "condition_controls_effect",
          type: "condition-of",
          from_node_id: "leading_condition",
          to_node_id: "reroll_effect",
          evidence: { fragment: "RAW_TEXT", first_segment_id: "condition_leaf", last_segment_id: "reroll_leaf" },
        }, {
          id: "effect_targets_beneficiary",
          type: "targets",
          from_node_id: "reroll_effect",
          to_node_id: "beneficiary",
          evidence: { fragment: "RAW_TEXT", first_segment_id: "participant", last_segment_id: "reroll_leaf" },
        }],
        roots: ["reroll_effect"],
      },
      mechanics_template: {
        effect: {
          type: "conditional",
          condition: { type: "model-is-leader" },
          effect: {
            type: "re-roll",
            target: { $bind: "participant" },
            modifier: { roll: { $bind: "reroll_leaf.parameters.roll" }, result_scope: "any-result" },
          },
        },
        scope: { range: "unit", duration: "permanent" },
        behavior: "passive",
        trigger: null,
        usage: null,
        applies_to: null,
      },
    }],
  };
  const proposed = proposeStamp(db, {
    definition: composition,
    positives: [{ ability_version_id: abilityId, source_hash: sourceHash, fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source, "utf8"), exact_text: source }],
    counterexamples: [],
  });
  const challenge = prepareWork(db, { purpose: "challenge-rule", ids: [`${proposed.stamp_id}@${proposed.revision}`] });
  expect(importWork(db, { run_id: challenge.run_id, response: response(challenge, () => ({ verdict: "clear", findings: [] })) })).toMatchObject({ imported: 1 });
  const preview = previewStamp(db, proposed.stamp_id, proposed.revision);
  approveStamp(db, proposed.stamp_id, proposed.revision, { reviewer: "fixture-reviewer", preview_hash: preview.preview_hash });
  const draft = db.prepare("SELECT id FROM assembly_drafts WHERE status = 'proposed'").get() as { id: string } | undefined;
  if (!draft) throw new Error("Verification fixture did not assemble a proposed draft.");
  return { draftId: draft.id, abilityId };
}

describe("Round 5C assistant work packets", () => {
  it("runs a prepared source-bound packet through DeepSeek and imports only an unapproved proposal", async () => {
    const value = fixture(1);
    try {
      const prepared = prepareWork(value.db, { purpose: "propose-rule", ids: value.escalationIds });
      process.env.DEEPSEEK_API_KEY = "fixture-key";
      const fetchProvider = vi.fn(async (url: string, options: RequestInit) => {
        expect(url).toBe("https://api.deepseek.com/chat/completions");
        expect(options.headers).toMatchObject({ authorization: "Bearer fixture-key" });
        const request = JSON.parse(options.body as string) as { model: string; response_format: { type: string }; messages: Array<{ content: string }> };
        expect(request.model).toBe("deepseek-v4-pro");
        expect(request.response_format.type).toBe("json_object");
        expect(JSON.parse(request.messages[1]!.content)).toEqual(prepared.request);
        return new Response(JSON.stringify({
          model: "deepseek-v4-pro",
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ items: response(prepared).items }) } }],
        }), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchProvider);
      expect(await runDeepSeekWork(value.db, { run_id: prepared.run_id })).toMatchObject({ imported: 1, stale: 0, failed: 0 });
      expect(fetchProvider).toHaveBeenCalledTimes(1);
      expect(value.db.prepare("SELECT model, status FROM model_runs WHERE id = ?").get(Number(prepared.run_id))).toEqual({ model: "deepseek-v4-pro", status: "completed" });
      expect(value.db.prepare("SELECT status FROM stamps").all()).toEqual([{ status: "proposed" }]);
      await expect(runDeepSeekWork(value.db, { run_id: prepared.run_id })).rejects.toThrow(/terminal/u);
      expect(fetchProvider).toHaveBeenCalledTimes(1);
    } finally {
      value.db.close();
    }
  });

  it("does not send source data without a key or after its evidence changes", async () => {
    const value = fixture(1);
    try {
      const prepared = prepareWork(value.db, { purpose: "propose-rule", ids: value.escalationIds });
      delete process.env.DEEPSEEK_API_KEY;
      const fetchProvider = vi.fn();
      vi.stubGlobal("fetch", fetchProvider);
      await expect(runDeepSeekWork(value.db, { run_id: prepared.run_id })).rejects.toThrow(/DEEPSEEK_API_KEY/u);
      process.env.DEEPSEEK_API_KEY = "fixture-key";
      decideEscalation(value.db, value.escalationIds[0]!, {
        reviewer: "fixture-reviewer",
        evidence_hash: escalationEvidenceHash(value.db, value.escalationIds[0]!),
        action: "defer",
      });
      await expect(runDeepSeekWork(value.db, { run_id: prepared.run_id })).rejects.toThrow(/Prepare a fresh packet/u);
      expect(fetchProvider).not.toHaveBeenCalled();
      expect(value.db.prepare("SELECT status FROM model_runs WHERE id = ?").get(Number(prepared.run_id))).toEqual({ status: "pending" });
    } finally {
      value.db.close();
    }
  });

  it("leaves a truncated provider completion pending so it can be retried without duplicate semantic writes", async () => {
    const value = fixture(1);
    try {
      const prepared = prepareWork(value.db, { purpose: "propose-rule", ids: value.escalationIds });
      process.env.DEEPSEEK_API_KEY = "fixture-key";
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        choices: [{ finish_reason: "length", message: { content: "{}" } }],
      }), { status: 200 })));
      await expect(runDeepSeekWork(value.db, { run_id: prepared.run_id })).rejects.toThrow(/incomplete JSON/u);
      expect(value.db.prepare("SELECT status FROM model_runs WHERE id = ?").get(Number(prepared.run_id))).toEqual({ status: "pending" });
      expect(value.db.prepare("SELECT count(*) AS total FROM stamps").get()).toEqual({ total: 0 });
    } finally {
      value.db.close();
    }
  });
  it("imports current items independently while a second-connection decision makes only its item stale", () => {
    const value = fixture();
    const second = new DatabaseSync(value.databasePath);
    initializeWorkbench(second);
    try {
      const prepared = prepareWork(value.db, { purpose: "propose-rule", ids: value.escalationIds });
      expect(JSON.parse(readFileSync(prepared.request_path, "utf8"))).toEqual(prepared.request);
      decideEscalation(second, value.escalationIds[0]!, {
        reviewer: "fixture-reviewer",
        evidence_hash: escalationEvidenceHash(second, value.escalationIds[0]!),
        action: "defer",
      });

      const revisionBeforeImport = getWorkbenchRevision(value.db);
      const report = importWork(value.db, { run_id: prepared.run_id, response: response(prepared) });
      expect(report).toMatchObject({ imported: 1, stale: 1, failed: 0 });
      expect(report.items.map((item) => item.status)).toEqual(["stale", "imported"]);
      expect(value.db.prepare("SELECT status, count(*) AS total FROM stamps GROUP BY status").all()).toEqual([{ status: "proposed", total: 1 }]);
      expect(value.db.prepare("SELECT count(*) AS total FROM stamps WHERE status = 'approved'").get()).toEqual({ total: 0 });
      expect(getWorkbenchRevision(value.db)).toBe(revisionBeforeImport + 1);
      expect(getDashboard(value.db).escalations).toMatchObject({ deferred: { groups: 1, occurrences: 1 }, open: { groups: 1, occurrences: 1 } });
    } finally {
      second.close();
      value.db.close();
    }
  });

  it("rejects duplicate, missing, and unknown response item envelopes before any semantic writes", () => {
    for (const malformed of ["duplicate", "missing", "unknown"] as const) {
      const value = fixture(1);
      try {
        const prepared = prepareWork(value.db, { purpose: "propose-rule", ids: value.escalationIds, retry_reason: malformed });
        const body = response(prepared);
        const items = body.items as Array<Record<string, unknown>>;
        if (malformed === "duplicate") items.push(structuredClone(items[0]!));
        else if (malformed === "missing") items.splice(0);
        else items[0] = { ...items[0], item_id: "unknown-escalation" };
        expect(() => importWork(value.db, { run_id: prepared.run_id, response: body })).toThrow();
        expect(value.db.prepare("SELECT status FROM model_runs WHERE id = ?").get(Number(prepared.run_id))).toEqual({ status: "failed" });
        expect(value.db.prepare("SELECT count(*) AS total FROM stamps").get()).toEqual({ total: 0 });
      } finally {
        value.db.close();
      }
    }
  });

  it("records a malformed proposed definition as an item failure without granting authority", () => {
    const value = fixture(1);
    try {
      const prepared = prepareWork(value.db, { purpose: "propose-rule", ids: value.escalationIds });
      const report = importWork(value.db, {
        run_id: prepared.run_id,
        response: response(prepared, (item) => ({ ...proposedResult(item), definition: { schema_version: 1, kind: "leaf", label: "broken", variants: [] } })),
      });
      expect(report).toMatchObject({ imported: 0, stale: 0, failed: 1 });
      expect(value.db.prepare("SELECT count(*) AS total FROM stamps").get()).toEqual({ total: 0 });
      expect(value.db.prepare("SELECT status FROM model_runs WHERE id = ?").get(Number(prepared.run_id))).toEqual({ status: "completed" });
    } finally {
      value.db.close();
    }
  });

  it("reuses unchanged terminal work, requires explicit retry provenance, and replays identical imports idempotently", () => {
    const value = fixture(1);
    try {
      const first = prepareWork(value.db, { purpose: "propose-rule", ids: value.escalationIds });
      const body = response(first);
      const imported = importWork(value.db, { run_id: first.run_id, response: body });
      expect(importWork(value.db, { run_id: first.run_id, response: body })).toEqual(imported);
      expect(() => importWork(value.db, { run_id: first.run_id, response: { ...body, model_version: "altered" } })).toThrow(/terminal/u);

      const reused = prepareWork(value.db, { purpose: "propose-rule", ids: value.escalationIds });
      expect(reused).toMatchObject({ run_id: first.run_id, reused: true, status: "completed" });
      const retry = prepareWork(value.db, { purpose: "propose-rule", ids: value.escalationIds, retry_reason: "Review the bounded question again." });
      expect(retry.reused).toBe(false);
      expect(retry.run_id).not.toBe(first.run_id);
      const retryConfig = JSON.parse((value.db.prepare("SELECT config_json FROM model_runs WHERE id = ?").get(Number(retry.run_id)) as { config_json: string }).config_json) as { retry_reason: string; predecessor_run_id: number };
      expect(retryConfig).toMatchObject({ retry_reason: "Review the bounded question again.", predecessor_run_id: Number(first.run_id) });
      expect(value.db.prepare("SELECT count(*) AS total FROM stamps WHERE status = 'approved'").get()).toEqual({ total: 0 });
    } finally {
      value.db.close();
    }
  });

  it("keeps deferred groups unresolved and out of the default frontier while allowing explicit inspection", () => {
    const value = fixture(1);
    try {
      decideEscalation(value.db, value.escalationIds[0]!, {
        reviewer: "fixture-reviewer",
        evidence_hash: escalationEvidenceHash(value.db, value.escalationIds[0]!),
        action: "defer",
      });
      expect(() => prepareWork(value.db, { purpose: "propose-rule" })).toThrow(/No propose-rule work/u);
      const explicit = prepareWork(value.db, { purpose: "propose-rule", ids: value.escalationIds });
      expect((explicit.request.items[0]!.escalation as { state: string }).state).toBe("deferred");
      expect(getDashboard(value.db).escalations).toMatchObject({ deferred: { groups: 1, occurrences: 1 } });
    } finally {
      value.db.close();
    }
  });

  it("imports a source-bound challenge without approving the stamp and satisfies later explicit approval", () => {
    const value = fixture(1);
    try {
      const proposed = proposeStamp(value.db, {
        definition: definition("Typed fixture", true),
        positives: [stampReference(value.abilities[0]!)],
        counterexamples: [],
      });
      const identity = `${proposed.stamp_id}@${proposed.revision}`;
      const prepared = prepareWork(value.db, { purpose: "challenge-rule", ids: [identity] });
      const imported = importWork(value.db, {
        run_id: prepared.run_id,
        response: response(prepared, () => ({ verdict: "clear", findings: [] })),
      });
      expect(imported).toMatchObject({ imported: 1, stale: 0, failed: 0 });
      expect(value.db.prepare("SELECT status, challenge_run_id FROM stamps WHERE id = ? AND revision = ?").get(proposed.stamp_id, proposed.revision)).toEqual({ status: "proposed", challenge_run_id: Number(prepared.run_id) });

      const preview = previewStamp(value.db, proposed.stamp_id, proposed.revision);
      expect(approveStamp(value.db, proposed.stamp_id, proposed.revision, { reviewer: "fixture-reviewer", preview_hash: preview.preview_hash })).toMatchObject({ applied: 1 });
    } finally {
      value.db.close();
    }
  });

  it("groups source-bound escalations by deterministic decision scope and orders contradictions first", () => {
    const value = fixture();
    try {
      const question = { stamp_id: "fixture-rule", revision: 1, variant_id: "exact", path: "participant", candidate_definition: { kind: "fixture" } };
      const first = createEscalation(value.db, "COMPOSITION_GAP", question, [{ ability_version_id: value.abilities[0]!.id, source_hash: value.abilities[0]!.sourceHash }]);
      const second = createEscalation(value.db, "COMPOSITION_GAP", { ...question, detail: "another occurrence" }, [{ ability_version_id: value.abilities[1]!.id, source_hash: value.abilities[1]!.sourceHash }]);
      expect(second).toBe(first);
      const staleToken = escalationEvidenceHash(value.db, first);
      decideEscalation(value.db, first, {
        reviewer: "fixture-reviewer",
        evidence_hash: staleToken,
        action: "request-revision",
        note: "Keep the participant distinction explicit.",
      });
      expect(() => decideEscalation(value.db, first, {
        reviewer: "fixture-reviewer",
        evidence_hash: staleToken,
        action: "request-revision",
        note: "Overwrite the first note with stale evidence.",
      })).toThrow(/evidence changed/i);
      expect(() => decideEscalation(value.db, first, {
        reviewer: "fixture-reviewer",
        evidence_hash: escalationEvidenceHash(value.db, first),
        action: "approve",
      })).toThrow(/action must be/i);
      createEscalation(value.db, "COMPOSITION_GAP", question, [{ ability_version_id: value.abilities[0]!.id, source_hash: value.abilities[0]!.sourceHash }]);
      createEscalation(value.db, "CONFLICT", { stamp_id: "fixture-rule", revision: 1, variant_id: "exact", path: "overlap" }, [{ ability_version_id: value.abilities[0]!.id, source_hash: value.abilities[0]!.sourceHash }]);

      const frontier = listEscalations(value.db);
      expect(frontier.items[0]).toMatchObject({ reason_code: "CONFLICT", assemblable_abilities: null });
      expect(frontier.items.find((item) => item.id === first)).toMatchObject({
        occurrence_count: 2,
        assemblable_abilities: null,
        question: { revision_request: "Keep the participant distinction explicit." },
      });
    } finally {
      value.db.close();
    }
  });

  it("rejects an escalation action token made stale through a second database connection", () => {
    const directory = mkdtempSync(join(tmpdir(), "round5c-escalation-token-"));
    directories.push(directory);
    const path = join(directory, "workbench.sqlite");
    const first = new DatabaseSync(path);
    const second = new DatabaseSync(path);
    initializeWorkbench(first);
    initializeWorkbench(second);
    try {
      const ability = addAbility(first, "two-connection-token");
      const escalationId = createEscalation(first, "NEW_FORM", {
        item_id: "two-connection-token",
        options: ["literal", "typed"],
      }, [{ ability_version_id: ability.id, source_hash: ability.sourceHash }]);
      const staleToken = escalationEvidenceHash(first, escalationId);
      decideEscalation(second, escalationId, {
        reviewer: "second-reviewer",
        evidence_hash: staleToken,
        action: "request-revision",
        note: "Preserve the exact terminal guard.",
      });
      expect(() => decideEscalation(first, escalationId, {
        reviewer: "first-reviewer",
        evidence_hash: staleToken,
        action: "defer",
      })).toThrow(/evidence changed/i);
      expect(listEscalations(first).items.find((item) => item.id === escalationId)).toMatchObject({
        state: "open",
        question: { revision_request: "Preserve the exact terminal guard." },
      });
    } finally {
      second.close();
      first.close();
    }
  });

  it("retains exact escalation spans through work packets and only stales them when their source evidence retires", () => {
    const value = fixture(1);
    try {
      const ability = value.abilities[0]!;
      const exact = "Repeat the Hit roll";
      const characterStart = ability.source.indexOf(exact);
      const startByte = Buffer.byteLength(ability.source.slice(0, characterStart), "utf8");
      const span = {
        fragment: "RAW_TEXT",
        start_byte: startByte,
        end_byte: startByte + Buffer.byteLength(exact, "utf8"),
        exact_text: exact,
        bindings: {},
        segments: {},
        leaf_dependencies: [],
      };
      const escalationId = createEscalation(value.db, "MODEL_ERROR", {
        item_id: "durable-challenge",
        path: "challenge",
      }, [{ ability_version_id: ability.id, source_hash: ability.sourceHash, span }]);
      const prepared = prepareWork(value.db, { purpose: "propose-rule", ids: [escalationId] });
      const escalation = prepared.request.items[0]!.escalation as {
        members: Array<{ span_id: number | null; span: Record<string, unknown> | null }>;
      };
      expect(escalation.members[0]).toMatchObject({
        span_id: expect.any(Number),
        span: {
          fragment: "RAW_TEXT",
          start_byte: startByte,
          end_byte: startByte + Buffer.byteLength(exact, "utf8"),
          exact_text: exact,
        },
      });

      applyAnnotationBatch(value.db, {
        reviewer: "fixture-reviewer",
        decisions: [{
          action: "confirm",
          ...stampReference(ability),
          role: "EFFECT",
          family_id: "reroll",
          family_version: 1,
          parameters: { roll: "hit", subset: "all" },
        }],
      });
      expect(value.db.prepare(`
        SELECT status FROM escalation_members
        WHERE escalation_id=?
      `).get(escalationId)).toEqual({ status: "active" });

      value.db.prepare("UPDATE abilities SET current=0 WHERE id=?").run(ability.id);
      invalidateAbilityEvidence(value.db, [ability.id], "SOURCE_VERSION_RETIRED");
      expect(value.db.prepare(`
        SELECT status FROM escalation_members
        WHERE escalation_id=?
      `).get(escalationId)).toEqual({ status: "stale" });
      value.db.prepare("UPDATE abilities SET current=1 WHERE id=?").run(ability.id);
      reconcileWorkbench(value.db, { ability_version_ids: [ability.id] });
      expect(value.db.prepare(`
        SELECT status FROM escalation_members
        WHERE escalation_id=?
      `).get(escalationId)).toEqual({ status: "stale" });
      expect(listEscalations(value.db).items.some((item) => item.id === escalationId)).toBe(false);
    } finally {
      value.db.close();
    }
  });

  it("orders known composition impact before frequency while leaving unknown impact null", () => {
    const value = fixture(2);
    try {
      const now = "2026-01-01T00:00:00.000Z";
      value.db.prepare(`
        INSERT INTO annotation_batches (id, operation, reviewer, created_at)
        VALUES ('impact-approval', 'stamp-approval', 'fixture-reviewer', ?)
      `).run(now);
      const compositionDefinition = {
        schema_version: 1,
        kind: "composition",
        label: "Impact fixture",
        variants: [{
          id: "complete",
          source_types: "any",
          fragments: [{ fragment: "RAW_TEXT", segments: [{ id: "all", literal: value.abilities[0]!.source }] }],
          slots: {},
          graph_template: {
            schema_version: 1,
            nodes: [{
              id: "source",
              kind: "participant",
              parameters: {},
              evidence: { fragment: "RAW_TEXT", first_segment_id: "all", last_segment_id: "all" },
            }],
            relations: [],
            roots: ["source"],
          },
          mechanics_template: null,
        }],
      };
      value.db.prepare(`
        INSERT INTO stamps (
          id, revision, kind, status, definition_json, definition_hash,
          approval_batch_id, created_at, updated_at
        ) VALUES ('impact-composition', 1, 'composition', 'approved', ?, ?, 'impact-approval', ?, ?)
      `).run(JSON.stringify(compositionDefinition), hashJson(compositionDefinition), now, now);
      value.db.prepare(`
        INSERT INTO stamp_applications (
          id, stamp_id, stamp_revision, ability_version_id, variant_id,
          inputs_hash, bindings_json, dependencies_json, status, reason_code,
          created_at, updated_at
        ) VALUES (
          'impact-application', 'impact-composition', 1, ?, 'complete',
          ?, '{}', '{}', 'blocked', 'DSL_GAP', ?, ?
        )
      `).run(value.abilities[0]!.id, "a".repeat(64), now, now);
      const known = createEscalation(value.db, "DSL_GAP", {
        stamp_id: "impact-composition",
        revision: 1,
        variant_id: "complete",
        path: "mechanics_template",
      }, [{ ability_version_id: value.abilities[0]!.id, source_hash: value.abilities[0]!.sourceHash }]);
      const unknown = createEscalation(value.db, "NEW_FORM", {
        item_id: "high-frequency-unknown",
      }, value.abilities.map((ability) => ({ ability_version_id: ability.id, source_hash: ability.sourceHash })));

      const frontier = listEscalations(value.db);
      const knownIndex = frontier.items.findIndex((item) => item.id === known);
      const unknownIndex = frontier.items.findIndex((item) => item.id === unknown);
      expect(frontier.items[knownIndex]).toMatchObject({ assemblable_abilities: 1 });
      expect(frontier.items[unknownIndex]).toMatchObject({ assemblable_abilities: null, occurrence_count: 2 });
      expect(knownIndex).toBeLessThan(unknownIndex);
      const prepared = prepareWork(value.db, { purpose: "propose-rule", ids: [known] });
      expect(prepared.request.items[0]!.escalation).toMatchObject({ assemblable_abilities: 1 });
    } finally {
      value.db.close();
    }
  });

  it("keeps escalation pagination on its original ordered snapshot across a new priority insertion", () => {
    const value = fixture(1);
    try {
      const ability = value.abilities[0]!;
      for (let index = 0; index < 21; index += 1) {
        createEscalation(value.db, "NEW_FORM", { item_id: `pagination-${index}` }, [{
          ability_version_id: ability.id,
          source_hash: ability.sourceHash,
        }]);
      }
      const expected: string[] = [];
      let expectedCursor: string | undefined;
      do {
        const page = listEscalations(value.db, { cursor: expectedCursor });
        expected.push(...page.items.map((item) => String(item.id)));
        expectedCursor = page.next_cursor ?? undefined;
      } while (expectedCursor !== undefined);

      const first = listEscalations(value.db);
      createEscalation(value.db, "CONFLICT", { item_id: "inserted-conflict" }, [{
        ability_version_id: ability.id,
        source_hash: ability.sourceHash,
      }]);
      const second = listEscalations(value.db, { cursor: first.next_cursor! });
      expect([...first.items, ...second.items].map((item) => String(item.id))).toEqual(expected);
      expect(second.total).toBe(expected.length);
    } finally {
      value.db.close();
    }
  });

  it("accepts a complete draft only through a current faithful verifier work result", () => {
    const value = fixture(0);
    try {
      const verification = buildVerificationFixture(value.db, value.directory);
      const prepared = prepareWork(value.db, { purpose: "verify-draft", ids: [verification.draftId] });
      const report = importWork(value.db, {
        run_id: prepared.run_id,
        response: response(prepared, () => ({ faithful: true, severity: "ok", findings: [] })),
      });
      expect(report.items[0]?.reason).toBe("draft accepted");
      expect(report).toMatchObject({ imported: 1, stale: 0, failed: 0 });
      expect(value.db.prepare("SELECT status, verifier_run_id FROM assembly_drafts WHERE id = ?").get(verification.draftId)).toEqual({
        status: "accepted",
        verifier_run_id: Number(prepared.run_id),
      });
      expect(value.db.prepare("SELECT whole_context_checked FROM ability_reviews WHERE ability_version_id = ?").get(verification.abilityId)).toBeUndefined();
    } finally {
      value.db.close();
    }
  });
});

describe("Round 5C composition grammar exemplar", () => {
  it("is a valid composition definition whose mechanics instantiate all six non-null envelope fields", async () => {
    const { COMPOSITION_EXEMPLAR } = await import("../src/round5c/work.js");
    const { instantiateTemplate, validateStampDefinition } = await import("../src/round5c/matching.js");
    const concrete = JSON.parse(JSON.stringify(COMPOSITION_EXEMPLAR)
      .replace("<exact reviewed participant wording>", "squad models")
      .replace("<ability source_type>", "unit")) as StampDefinition;
    const definition = validateStampDefinition(concrete);
    const variant = definition.variants[0] as { mechanics_template: unknown };
    expect(variant.mechanics_template).not.toBeNull();
    for (const [subset, expected] of [["ones", { subset: "ones" }], ["failed", { subset: "all-failures" }], ["all", { result_scope: "any-result" }]] as const) {
      const mechanics = instantiateTemplate(variant.mechanics_template as never, { effect_leaf: { parameters: { roll: "hit", subset } } }) as Record<string, unknown>;
      expect(Object.keys(mechanics).sort()).toEqual(["applies_to", "behavior", "effect", "scope", "trigger", "usage"]);
      expect(mechanics.effect).toMatchObject({ type: "re-roll", target: "unit", modifier: { roll: "hit", ...expected } });
    }
  });
});
