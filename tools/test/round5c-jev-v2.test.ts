import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";

import { describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/round5c/db.js";
import type { Embedder } from "../src/round5c/embeddings.js";

import { runJevV2Proposer } from "../src/round5c/jev-v2.js";
import type { JevClient } from "../src/round5c/jev-core.js";
import type { Span } from "../src/round5c/jev-proposer.js";
import { confirmSurface } from "./round5c-human.js";

// Fabricated wording only; no GW rule prose.

type DatabaseSync = DatabaseType;
const DatabaseSyncCtor = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new (path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";

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

/** Answers "none of these" to anything not explicitly scripted, so an unexpected question (a
 * different piece reusing the same prompt text) doesn't crash the test — it just resolves to
 * "not a leaf" for that piece, which every test here already treats as an acceptable outcome. */
function fakeClient(script: Record<string, { choice: string; confidence?: number }>) {
  const calls: string[] = [];
  const client: JevClient = {
    async systemOne(request) {
      const question = (request.questions as Questions).answer as { type: string; criteria?: Record<string, unknown>; instructions?: unknown };
      const prompt = question.instructions as string;
      calls.push(prompt);
      if (question.type === "noul") {
        return {
          model: "jev-latest", answers: { answer: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 300, output_tokens: 10 },
        } as unknown as SystemOneResult<Questions>;
      }
      const criteria = question.criteria ?? {};
      const scripted = script[prompt];
      const choiceValue = scripted?.choice ?? (Object.keys(criteria).includes("none-of-these") ? "none-of-these" : Object.keys(criteria)[0]!);
      const confidence = scripted?.confidence ?? 0.9;
      return {
        model: "jev-latest",
        answers: { answer: { type: "choice", choice: choiceValue, confidence, probabilities: { [choiceValue]: confidence } } },
        usage: { input_tokens: 400, output_tokens: 15 },
      } as unknown as SystemOneResult<Questions>;
    },
  };
  return { client, calls };
}

function fixtureDb(): DatabaseSync {
  const db = new DatabaseSyncCtor(":memory:") as DatabaseSync;
  initializeWorkbench(db);
  confirmSurface(db, { reviewer: REVIEWER, exact_text: "re-roll a hit roll of 1", family_id: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" } });
  confirmSurface(db, { reviewer: REVIEWER, exact_text: "If this model is on the battlefield", family_id: "unit-state", family_version: 4, parameters: { states: ["on-battlefield"], subject: "this-model", negated: false } });
  return db;
}

describe("Jev v2 proposer", () => {
  it("asks one narrowed choice per role a matched piece has decided-surface candidates for, and reuses the matched surface's parameters as a seed", async () => {
    const db = fixtureDb();
    try {
      const span: Span = { ability_version_id: 1, faction_id: "fixture-faction", ability_id: "fixture-ability", fragment: "RAW_TEXT", start_byte: 0, end_byte: 30, text: "re-roll a hit roll of 1" };
      const { client, calls } = fakeClient({
        "Which of these effect families (or none) does this piece express?": { choice: "reroll" },
        "Which of these condition families (or none) does this piece express?": { choice: "none-of-these" },
      });
      const result = await runJevV2Proposer(db, wordsEmbedder(), client, [span], { segmentationThreshold: 0.5, confidenceFloor: 0.6 });
      expect(result.pieces).toHaveLength(1);
      const [piece] = result.pieces;
      expect(piece!.segment_kind).toBe("matched");
      expect(piece!.matched_family_id).toBe("reroll");
      // Only EFFECT and CONDITION have any decided-surface candidates in this two-surface
      // fixture (reroll is EFFECT, unit-state is CONDITION); the other four roles get no
      // question at all, since there is nothing to narrow their choice list from.
      expect(result.pieces[0]!.resolutions.map((r) => r.role).sort()).toEqual(["CONDITION", "EFFECT"]);
      const effectResolution = piece!.resolutions.find((r) => r.role === "EFFECT")!;
      expect(effectResolution.candidate_family_ids).toEqual(["reroll"]);
      expect(effectResolution.status).toBe("proposed");
      // Every param came from the matched surface / prefill — no per-parameter question needed.
      expect(effectResolution.parameters).toEqual({ roll: "hit", subset: "ones", weapon_type: "all" });
      const conditionResolution = piece!.resolutions.find((r) => r.role === "CONDITION")!;
      expect(conditionResolution.status).toBe("unanswered");
      expect(result.multi_role_pieces).toBe(0); // only EFFECT resolved to "proposed"
      expect(calls).toEqual([
        "Which of these effect families (or none) does this piece express?",
        "Which of these condition families (or none) does this piece express?",
      ]);
    } finally {
      db.close();
    }
  });

  it("counts a piece that resolves in more than one role as multi-role", async () => {
    const db = fixtureDb();
    try {
      const span: Span = { ability_version_id: 1, faction_id: "fixture-faction", ability_id: "fixture-ability", fragment: "RAW_TEXT", start_byte: 0, end_byte: 30, text: "re-roll a hit roll of 1" };
      const { client } = fakeClient({
        "Which of these effect families (or none) does this piece express?": { choice: "reroll" },
        "Which of these condition families (or none) does this piece express?": { choice: "unit-state" },
      });
      const result = await runJevV2Proposer(db, wordsEmbedder(), client, [span], { segmentationThreshold: 0.5, confidenceFloor: 0.6 });
      expect(result.multi_role_pieces).toBe(1);
    } finally {
      db.close();
    }
  });

  it("marks a connective piece as having no resolutions and asks nothing about it", async () => {
    const db = fixtureDb();
    try {
      const span: Span = { ability_version_id: 1, faction_id: "fixture-faction", ability_id: "fixture-ability", fragment: "RAW_TEXT", start_byte: 0, end_byte: 60, text: "gain a glimmer token and re-roll a hit roll of 1" };
      const { client } = fakeClient({});
      const result = await runJevV2Proposer(db, wordsEmbedder(), client, [span], { segmentationThreshold: 0.5, confidenceFloor: 0.6 });
      const pieceKinds = result.pieces.map((p) => p.segment_kind);
      expect(pieceKinds).toContain("connective");
      expect(pieceKinds).toContain("matched");
      expect(pieceKinds).toContain("gap");
      const connective = result.pieces.find((p) => p.segment_kind === "connective")!;
      expect(connective.resolutions).toEqual([]);
    } finally {
      db.close();
    }
  });
});
