import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { openWorkbench } from "../src/round5c/db.js";
import { runDeepSeekArm } from "../src/round5c/deepseek-pilot.js";
import type { DeepSeekUsage, ModelReply } from "../src/round5c/leaf-proposals-llm.js";

// Fabricated fixture prose only; nothing here is published source text.
const SOURCE = "Re-roll a Hit roll of 1 for this unit's attacks.";

let root: string;
let databasePath: string;
let previous: Record<string, string | undefined>;

function open(): DatabaseSync {
  return openWorkbench(databasePath);
}

function insertAbility(db: DatabaseSync, abilityId: string): number {
  return Number(db.prepare(`
    INSERT INTO abilities (faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, metadata_json, fragments_json, current)
    VALUES ('fixture', ?, ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
  `).run(abilityId, hashJson({ text: SOURCE, abilityId }), SOURCE, abilityId, JSON.stringify([
    { fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(SOURCE, "utf8"), text: SOURCE },
  ])).lastInsertRowid);
}

function emptyUsage(): DeepSeekUsage {
  return { prompt_tokens: 10, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, completion_tokens: 5 };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "round5c-deepseek-pilot-"));
  databasePath = join(root, "workbench.sqlite");
  previous = { ROUND5C_ARTIFACT_DIR: process.env.ROUND5C_ARTIFACT_DIR };
  process.env.ROUND5C_ARTIFACT_DIR = join(root, "artifacts");
});

afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("Round 5C DeepSeek pilot arm batching", () => {
  it("defaults to two abilities per request, not the transport's old fifteen-per-request batch", async () => {
    const db = open();
    const ids = ["batch-a", "batch-b", "batch-c", "batch-d"].map((id) => insertAbility(db, id));
    db.close();

    const abilitiesPerRequestSeen: number[] = [];
    const result = await runDeepSeekArm(
      open(),
      open,
      new Set(ids),
      {
        maxRequests: 10,
        spendCapUsd: 100,
        deepseekCall: async (_instructions: string, requestText: string): Promise<ModelReply> => {
          const parsed = JSON.parse(requestText) as { request: { abilities: Array<{ ability_id: string }> } };
          abilitiesPerRequestSeen.push(parsed.request.abilities.length);
          const body = {
            schema_version: 2,
            input_hash: (JSON.parse(requestText) as { input_hash: string }).input_hash,
            model: "deepseek-v4-pro",
            model_version: "deepseek-v4-pro",
            prompt_version: "v2",
            abilities: parsed.request.abilities.map((ability) => ({
              faction_id: "fixture",
              ability_id: ability.ability_id,
              source_hash: hashJson({ text: SOURCE, abilityId: ability.ability_id }),
              spans: [],
              structural_spans: [],
              connectives: [],
              unresolved_regions: [],
            })),
          };
          return { body, model: "deepseek-v4-pro", model_version: "deepseek-v4-pro", cost_usd: 0, latency_ms: 1, usage: emptyUsage() };
        },
      },
    );

    expect(result.requests).toBeGreaterThan(0);
    expect(abilitiesPerRequestSeen.every((count) => count <= 2)).toBe(true);
    expect(abilitiesPerRequestSeen[0]).toBe(2);
  });

  it("retries a length-stopped multi-ability batch split into single-ability requests, once", async () => {
    const db = open();
    const ids = ["retry-a", "retry-b"].map((id) => insertAbility(db, id));
    db.close();

    const batchSizesSeen: number[] = [];
    const succeed = (parsed: { request: { abilities: Array<{ ability_id: string }> } }, requestText: string): ModelReply => ({
      body: {
        schema_version: 2,
        input_hash: (JSON.parse(requestText) as { input_hash: string }).input_hash,
        model: "deepseek-v4-pro",
        model_version: "deepseek-v4-pro",
        prompt_version: "v2",
        abilities: parsed.request.abilities.map((ability) => ({
          faction_id: "fixture",
          ability_id: ability.ability_id,
          source_hash: hashJson({ text: SOURCE, abilityId: ability.ability_id }),
          spans: [], structural_spans: [], connectives: [], unresolved_regions: [],
        })),
      },
      model: "deepseek-v4-pro", model_version: "deepseek-v4-pro", cost_usd: 0, latency_ms: 1, usage: emptyUsage(),
    });
    const result = await runDeepSeekArm(
      open(),
      open,
      new Set(ids),
      {
        maxRequests: 10,
        spendCapUsd: 100,
        abilitiesPerRequest: 2,
        deepseekCall: async (_instructions: string, requestText: string): Promise<ModelReply> => {
          const parsed = JSON.parse(requestText) as { request: { abilities: Array<{ ability_id: string }> } };
          batchSizesSeen.push(parsed.request.abilities.length);
          if (parsed.request.abilities.length > 1) throw new Error("DeepSeek stopped with length.");
          return succeed(parsed, requestText);
        },
      },
    );

    // One failed 2-ability batch, then exactly one single-ability retry per ability in it —
    // never a second attempt at the original 2-ability shape.
    expect(batchSizesSeen).toEqual([2, 1, 1]);
    expect(result.requests).toBe(3);
    const failed = result.runs.filter((run) => run.state === "failed");
    const completed = result.runs.filter((run) => run.state === "completed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.failure?.message).toMatch(/stopped with length/i);
    expect(completed).toHaveLength(2);
    expect(completed.flatMap((run) => run.ability_version_ids).sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
  });
});
