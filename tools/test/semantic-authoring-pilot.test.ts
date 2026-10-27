import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { initializeWorkbench, openWorkbench } from "../src/semantic-authoring/db.js";
import type { Embedder } from "../src/semantic-authoring/embeddings.js";
import type { JevClient } from "../src/semantic-authoring/jev-core.js";
import { runLeafProposals, type ProposalSettings } from "../src/semantic-authoring/leaf-proposals.js";
import type { ModelReply } from "../src/semantic-authoring/leaf-proposals-llm.js";
import { planPilotStep, reportPilotStep, runPilotStep, type PilotStepOptions } from "../src/semantic-authoring/pilot.js";
import { selectPilotSample } from "../src/semantic-authoring/pilot-sample.js";
import { refreshSources } from "../src/semantic-authoring/source.js";
import { applyAnnotationBatch, markPilotReviewed } from "./semantic-authoring-human.js";
import { currentFamilyVersion } from "../src/semantic-authoring/contracts.js";


// Fabricated fixture prose only; nothing here is published source text.
const PHRASE = "Re-roll a Hit roll of 1";
const sourceOf = (index: number) => `${PHRASE} for fixture unit ${index}.`;

let root: string;
let dbPath: string;
let previous: string | undefined;
let modelCalls = 0;
let jevCalls = 0;

function insertAbilities(count: number): number[] {
  const db = openWorkbench(dbPath);
  try {
    return Array.from({ length: count }, (_, index) => {
      const source = sourceOf(index);
      return Number(db.prepare(`
        INSERT INTO abilities (faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, metadata_json, fragments_json, current)
        VALUES ('fixture', ?, ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
      `).run(`ability-${index}`, hashJson({ text: source }), source, `ability-${index}`, JSON.stringify([
        { fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source, "utf8"), text: source },
      ])).lastInsertRowid);
    });
  } finally {
    db.close();
  }
}

/** DeepSeek stand-in: labels the re-roll phrase in every requested ability, nothing else. */
async function deepseekCall(_instructions: string, requestText: string): Promise<ModelReply> {
  modelCalls += 1;
  const envelope = JSON.parse(requestText) as { input_hash: string; request: { abilities: Array<{ ability_id: string; source_hash: string; source_text: string }> } };
  const body = {
    schema_version: 2, input_hash: envelope.input_hash, model: "deepseek-flash", model_version: "deepseek-flash", prompt_version: "v2",
    abilities: envelope.request.abilities.map((ability) => ({
      faction_id: "fixture", ability_id: ability.ability_id, source_hash: ability.source_hash,
      spans: [{
        start_byte: 0, end_byte: Buffer.byteLength(PHRASE, "utf8"), exact_text: PHRASE, role: "EFFECT", status: "EXISTING",
        family_id: "reroll", family_version: currentFamilyVersion("reroll"), parameters: { roll: "hit", subset: "ones", weapon_type: "all" },
      }],
      structural_spans: [], connectives: [], unresolved_regions: [],
    })),
  };
  return { body, model: "deepseek-flash", model_version: "deepseek-flash", cost_usd: 0.001, latency_ms: 1, usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100, completion_tokens: 50 } };
}

/** Jev stand-in: picks reroll for the family, and the matching closed parameters. */
const jevClient: JevClient = {
  async systemOne(request) {
    jevCalls += 1;
    const questions = request.questions as Record<string, { type: string; criteria?: Record<string, unknown> }>;
    const answers: Record<string, unknown> = {};
    const wanted: Record<string, string> = { answer: "reroll", roll: "hit", subset: "ones", weapon_type: "all" };
    for (const [key, question] of Object.entries(questions)) {
      if (question.type === "noul") { answers[key] = { type: "noul", noul: 0.1 }; continue; }
      const value = wanted[key] && question.criteria && wanted[key]! in question.criteria ? wanted[key]! : "none-of-these";
      answers[key] = { type: "choice", choice: value, confidence: 0.9, probabilities: { [value]: 0.9, "none-of-these": 0.1 } };
    }
    return { model: "jev-latest", answers, usage: { input_tokens: 500, output_tokens: 5 } } as unknown as SystemOneResult<Questions>;
  },
};

function options(step: string, extra: Partial<PilotStepOptions> = {}): PilotStepOptions {
  return { step, dbPath, artifactDirectory: join(root, "artifacts"), samplePath: join(root, "sample.json"), exclude: [], deepseekCall, jevClient, spendCapUsd: 1, ...extra };
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("Semantic authoring pilot step", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "semantic-authoring-pilot-"));
    dbPath = join(root, "copy", "workbench.sqlite");
    mkdirSync(join(root, "copy"), { recursive: true });
    previous = process.env.SEMANTIC_AUTHORING_ARTIFACT_DIR;
    process.env.SEMANTIC_AUTHORING_ARTIFACT_DIR = join(root, "artifacts");
    modelCalls = 0;
    jevCalls = 0;
    const ids = insertAbilities(4);
    writeFileSync(join(root, "sample.json"), JSON.stringify({
      seed: 1, generated_at: "x", target_size: 4, factions_represented: 1, strata: [],
      abilities: ids.map((id, index) => ({ ability_version_id: id, faction_id: "fixture", ability_id: `ability-${index}`, cluster: index % 2, untiled_spans: 1 })),
    }));
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.SEMANTIC_AUTHORING_ARTIFACT_DIR;
    else process.env.SEMANTIC_AUTHORING_ARTIFACT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses the live workbench before opening it", async () => {
    const live = resolve(import.meta.dirname, "../../_private/round5c/workbench.sqlite");
    await expect(runPilotStep(options("live", { dbPath: live, next: 1 }))).rejects.toMatchObject({ code: "LIVE_DATABASE_REFUSED" });
    expect(() => planPilotStep(options("live", { dbPath: live, next: 1 }))).toThrow(/copy of the workbench/u);
  });

  it("plans without writing a byte or calling a model", () => {
    const before = digest(dbPath);
    const plan = planPilotStep(options("fib-3", { next: 2 }));
    expect(plan.ability_version_ids).toHaveLength(2);
    expect(plan.schedule_persisted).toBe(false);
    expect(digest(dbPath)).toBe(before);
    expect(existsSync(join(root, "artifacts"))).toBe(false);
    expect(modelCalls + jevCalls).toBe(0);
  });

  it("labels a cohort without deciding anything, resumes without paying twice, and waits for review", async () => {
    const report = await runPilotStep(options("fib-3", { next: 2 }));
    expect(report.ability_version_ids).toHaveLength(2);
    expect(modelCalls).toBe(1); // two abilities per request
    for (const ability of report.abilities) {
      // The labelled phrase, and the rest of the text the model left unlabelled.
      expect(ability.spans).toEqual([
        expect.objectContaining({ family: `reroll@${currentFamilyVersion("reroll")}`, status: "pending", jev_agrees: true }),
        expect.objectContaining({ role: "UNRESOLVED", status: "unresolved", family: null }),
      ]);
    }
    expect(report.spend.cost_usd).toBeCloseTo(0.001);
    const db = openWorkbench(dbPath);
    try {
      // The pilot wrote no trusted row and decided no proposal.
      expect(db.prepare("SELECT count(*) AS n FROM annotations").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT DISTINCT status FROM proposals WHERE model_run_id IS NOT NULL ORDER BY status").all()).toEqual([{ status: "pending" }, { status: "unresolved" }]);
    } finally {
      db.close();
    }

    // Resuming the same step calls neither model again.
    const calls = [modelCalls, jevCalls];
    await runPilotStep(options("fib-3"));
    expect([modelCalls, jevCalls]).toEqual(calls);

    // The next step waits until Will has reviewed every ability of this one.
    await expect(runPilotStep(options("fib-5", { next: 2 }))).rejects.toMatchObject({ code: "PREVIOUS_STEP_UNREVIEWED" });
    expect(readdirSync(join(root, "artifacts", "pilot-steps"))).toEqual(["fib-3"]);
  });

  it("measures the review against the frozen labels", async () => {
    const report = await runPilotStep(options("fib-3", { next: 2 }));
    const db = openWorkbench(dbPath);
    try {
      const [first, second] = report.ability_version_ids;
      // Will confirms the first label unchanged, and widens the second to the whole clause.
      for (const [id, text] of [[first!, PHRASE], [second!, `${PHRASE} for fixture unit`]] as const) {
        const ability = db.prepare("SELECT source_hash FROM abilities WHERE id = ?").get(id) as { source_hash: string };
        const proposal = db.prepare("SELECT proposals.id FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id WHERE source_spans.ability_version_id = ?").get(id) as { id: number };
        applyAnnotationBatch(db, { reviewer: "will", decisions: [{
          action: text === PHRASE ? "confirm" : "correct", proposal_id: proposal.id, ability_version_id: id, source_hash: ability.source_hash,
          fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(text, "utf8"), exact_text: text, role: "EFFECT",
          family_id: "reroll", family_version: currentFamilyVersion("reroll"), parameters: { roll: "hit", subset: "ones", weapon_type: "all" },
        }] });
        // The unlabelled residue keeps the source from being fully accounted, so the whole-context
        // check is unavailable; the pilot mark is how Will says the step's review is done.
        markPilotReviewed(db, id, { source_hash: ability.source_hash, reviewer: "will" });
      }
    } finally {
      db.close();
    }
    const evaluated = reportPilotStep(options("fib-3")).evaluation;
    expect(evaluated.reviewed_abilities).toHaveLength(2);
    expect(evaluated.repairs).toMatchObject({ unchanged: 1, expanded: 1, added: 0, removed: 0 });
    expect(evaluated.deepseek_family).toEqual({ correct: 2, compared: 2 });
    expect(evaluated.jev_family).toEqual({ top1: 2, top3: 2, compared: 2 });
    expect(evaluated.segmentation_unchanged_rate).toBe(0.5);
    // With the step reviewed, the next step may start.
    await expect(runPilotStep(options("fib-5", { next: 2 }))).resolves.toMatchObject({ step: "fib-5" });
    expect(evaluated.jev_parameters).toEqual({ agreed: 6, asked: 6 });
  });
});

// selectPilotSample: the stratified sample a pilot step labels.

type DatabaseSync = DatabaseType;
const DatabaseSyncCtor = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new (path: string): DatabaseType };

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Bag-of-words vectors: wordings sharing words are alike (from semantic-authoring-leaf-proposals.test.ts). */
function wordsEmbedder(): Embedder {
  const dims = 128;
  return {
    model: "fixture-words",
    async embed(texts: readonly string[]) {
      return texts.map((text) => {
        const vector = new Float32Array(dims);
        for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
          let hash = 0;
          for (const char of word) hash = (hash * 31 + char.codePointAt(0)!) % dims;
          vector[hash] += 1;
        }
        const length = Math.hypot(...vector) || 1;
        return vector.map((value) => value / length);
      });
    },
  };
}

const SETTINGS: ProposalSettings = { k: 5, direct_sim: 0.6, direct_share: 0.6, cluster_k: 3, cluster_sim: 0.6 };
const FACTIONS = ["fixture-alpha", "fixture-beta", "fixture-gamma", "fixture-delta", "fixture-epsilon", "fixture-zeta"];

/** Two abilities per faction sharing one made-up untiled phrase (so each faction forms its own
 * residue cluster), decided nowhere — nothing here is a real leaf family's wording. */
function fixture(): DatabaseSync {
  const root = mkdtempSync(join(tmpdir(), "semantic-authoring-pilot-"));
  roots.push(root);
  for (const faction of FACTIONS) {
    writeFileSync(join(root, `${faction}.json`), JSON.stringify([
      { faction_id: faction, ability_id: `${faction}-first`, raw_text: `A wobbling gizmo hums near the ${faction} standard.` },
      { faction_id: faction, ability_id: `${faction}-second`, raw_text: `A wobbling gizmo hums near the ${faction} banner.` },
    ]));
  }
  const db = new DatabaseSyncCtor(":memory:") as DatabaseSync;
  initializeWorkbench(db);
  refreshSources(db, root);
  return db;
}

describe("pilot-sample", () => {
  it("is deterministic for a fixed seed and stratifies across factions and clusters", async () => {
    const db = fixture();
    try {
      await runLeafProposals(db, wordsEmbedder(), SETTINGS);

      const first = selectPilotSample(db, { seed: 7, targetSize: 8, topClusters: 4 });
      const second = selectPilotSample(db, { seed: 7, targetSize: 8, topClusters: 4 });
      // `generated_at` is a real timestamp and legitimately differs between calls.
      expect({ ...second, generated_at: null }).toEqual({ ...first, generated_at: null });

      expect(first.abilities.length).toBeGreaterThan(0);
      expect(first.abilities.length).toBeLessThanOrEqual(8);
      expect(first.factions_represented).toBeGreaterThan(1);
      const clustersRepresented = new Set(first.abilities.map((a) => a.cluster));
      expect(clustersRepresented.size).toBeGreaterThan(1);
      // No duplicate abilities in one sample.
      const ids = first.abilities.map((a) => a.ability_version_id);
      expect(new Set(ids).size).toBe(ids.length);

      const differentSeed = selectPilotSample(db, { seed: 99, targetSize: 8, topClusters: 4 });
      expect(differentSeed.abilities.map((a) => a.ability_id)).not.toEqual(first.abilities.map((a) => a.ability_id));
    } finally {
      db.close();
    }
  });

  it("caps the sample at the corpus size when the target exceeds available residue", async () => {
    const db = fixture();
    try {
      await runLeafProposals(db, wordsEmbedder(), SETTINGS);
      const sample = selectPilotSample(db, { seed: 1, targetSize: 1000, topClusters: 4 });
      expect(sample.abilities.length).toBe(FACTIONS.length * 2);
    } finally {
      db.close();
    }
  });
});
