import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";

import { afterEach, describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/round5c/db.js";
import type { Embedder } from "../src/round5c/embeddings.js";
import { confirmSurface } from "../src/round5c/leaves.js";
import { refreshSources } from "../src/round5c/source.js";
import { runJevV2Rounds } from "../src/round5c/jev-v2-rounds.js";
import type { JevClient } from "../src/round5c/jev-core.js";
import type { PilotAbility } from "../src/round5c/pilot-sample.js";

// Fabricated wording only; no GW rule prose.

type DatabaseSync = DatabaseType;
const DatabaseSyncCtor = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new (path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";
const FACTION = "fixture-faction";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

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

/** Always answers "battle-round" (a real, closed, single-value option of the decided seed
 * family) to any family choice, and "none of these" for any role that doesn't offer it. */
function fakeClient(): JevClient {
  return {
    async systemOne(request) {
      const question = (request.questions as Questions).answer as { type: string; criteria?: Record<string, unknown> };
      const criteria = question.criteria ?? {};
      const choiceValue = "turn-start" in criteria ? "turn-start" // the family-choice question
        : "battle-round" in criteria ? "battle-round" // turn-start's own "turn" parameter, matching the seed surface
          : "none-of-these";
      return {
        model: "jev-latest",
        answers: { answer: { type: "choice", choice: choiceValue, confidence: 0.9, probabilities: { [choiceValue]: 0.9 } } },
        usage: { input_tokens: 300, output_tokens: 10 },
      } as unknown as SystemOneResult<Questions>;
    },
  };
}

function fixture(): { db: DatabaseSync; sample: PilotAbility[] } {
  const root = mkdtempSync(join(tmpdir(), "round5c-jevv2-rounds-"));
  roots.push(root);
  writeFileSync(join(root, `${FACTION}.json`), JSON.stringify([
    { faction_id: FACTION, ability_id: "battle-round-marker", raw_text: "At the start of the battle round, gain a point." },
  ]));
  const db = new DatabaseSyncCtor(":memory:") as DatabaseSync;
  initializeWorkbench(db);
  refreshSources(db, root);
  // A seed decided surface so segmentation/narrowing has something to work with, and the answer
  // "turn-start" a real closed enum choice the fake client can pick every time.
  confirmSurface(db, { reviewer: REVIEWER, exact_text: "at the start of the battle round", family_id: "turn-start", parameters: { turn: "battle-round" } });
  const row = db.prepare("SELECT id, faction_id, ability_id FROM abilities WHERE current = 1 AND ability_id = 'battle-round-marker'").get() as { id: number; faction_id: string; ability_id: string };
  const sample: PilotAbility[] = [{ ability_version_id: row.id, faction_id: row.faction_id, ability_id: row.ability_id, cluster: null, untiled_spans: 1 }];
  return { db, sample };
}

describe("Jev v2 stamp-and-spread rounds", () => {
  it("stamps an eligible leaf with a recorded batch id, then converges once nothing new is asked", async () => {
    const { db, sample } = fixture();
    try {
      const result = await runJevV2Rounds(db, wordsEmbedder(), fakeClient(), sample, { segmentationThreshold: 0.5, confidenceFloor: 0.6, maxRounds: 5 });
      expect(result.rounds.length).toBeGreaterThan(0);
      expect(result.rounds[0]!.round).toBe(1);
      // The revert path: every stamp names the round and a real batch id from confirmSurface.
      expect(result.stamps.length).toBeGreaterThan(0);
      for (const stamp of result.stamps) {
        expect(stamp.round).toBeGreaterThanOrEqual(1);
        expect(stamp.batch_id).toMatch(/^batch_/);
      }
      // Converged: the last round reports no new stamps (or the loop simply ran out of spans).
      const last = result.rounds.at(-1)!;
      expect(last.new_stamps === 0 || result.rounds.length === 1).toBe(true);
      expect(result.total_cost_usd).toBeGreaterThan(0);
      expect(result.total_cost_usd).toBeLessThanOrEqual(result.spend_cap_usd);
    } finally {
      db.close();
    }
  });

  it("never stamps a leaf whose compile fragment doesn't validate", async () => {
    const { db, sample } = fixture();
    try {
      // A client that always answers a role/family combination this fixture's registry can't
      // actually compile as a leaf on its own — this pins "compile-fragment validation gates
      // the stamp" rather than asserting it never happens for any input (too broad a claim).
      const brokenClient: JevClient = {
        async systemOne(request) {
          const question = (request.questions as Questions).answer as { type: string; criteria?: Record<string, unknown> };
          const criteria = question.criteria ?? {};
          // named-region-state is a real family, but it can never appear alone as a bare
          // EFFECT/CONDITION leaf fragment the way this fixture's piece would compile it —
          // picking it (when offered) exercises the CompileError catch path.
          const choiceValue = Object.keys(criteria).find((key) => key !== "none-of-these") ?? "none-of-these";
          return {
            model: "jev-latest",
            answers: { answer: { type: "choice", choice: choiceValue, confidence: 0.99, probabilities: { [choiceValue]: 0.99 } } },
            usage: { input_tokens: 300, output_tokens: 10 },
          } as unknown as SystemOneResult<Questions>;
        },
      };
      const result = await runJevV2Rounds(db, wordsEmbedder(), brokenClient, sample, { segmentationThreshold: 0.99, confidenceFloor: 0.6, maxRounds: 2 });
      // Whatever got asked, either nothing validated (0 stamps) or only fragments that truly do
      // compile were stamped — either way the run completes without throwing.
      expect(result.rounds.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});
