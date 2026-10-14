import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/round5c/db.js";
import type { Embedder } from "../src/round5c/embeddings.js";

import { decidedSurfaces, segmentSpans } from "../src/round5c/jev-v2-segment.js";
import { confirmSurface } from "./round5c-human.js";

// Fabricated wording only; no GW rule prose.

type DatabaseSync = DatabaseType;
const DatabaseSyncCtor = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new (path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";

/** Bag-of-words vectors: wordings sharing words are alike (from round5c-leaf-proposals.test.ts). */
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

function fixtureDb(): DatabaseSync {
  const db = new DatabaseSyncCtor(":memory:") as DatabaseSync;
  initializeWorkbench(db);
  return db;
}

describe("Jev v2 segmentation", () => {
  it("lists every decided surface as a candidate to match against", () => {
    const db = fixtureDb();
    try {
      confirmSurface(db, { reviewer: REVIEWER, exact_text: "re-roll a hit roll of 1", family_id: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" } });
      const decided = decidedSurfaces(db);
      expect(decided).toHaveLength(1);
      expect(decided[0]).toMatchObject({ family_id: "reroll", family_version: 2 });
    } finally {
      db.close();
    }
  });

  it("matches a near-identical window against a decided surface and splits a connective and gap words around it", async () => {
    const db = fixtureDb();
    try {
      confirmSurface(db, { reviewer: REVIEWER, exact_text: "re-roll a hit roll of 1", family_id: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" } });
      const spanText = "gain a glimmer token and re-roll a hit roll of 1";
      const [pieces] = await segmentSpans(db, wordsEmbedder(), [{ text: spanText, start_byte: 0 }], { threshold: 0.6 });
      expect(pieces!.map((p) => p.kind)).toEqual(["gap", "connective", "matched"]);
      const matched = pieces!.find((p) => p.kind === "matched")!;
      expect(matched.text).toBe("re-roll a hit roll of 1");
      expect(matched.matched_surface?.family_id).toBe("reroll");
      expect(matched.match_score).toBeGreaterThan(0);
      const gap = pieces!.find((p) => p.kind === "gap")!;
      expect(gap.text).toBe("gain a glimmer token");
      const connective = pieces!.find((p) => p.kind === "connective")!;
      expect(connective.text.toLowerCase()).toBe("and");
      // Pieces reconstruct the whole span's byte range with no overlap and no gap.
      const sorted = [...pieces!].sort((a, b) => a.start_byte - b.start_byte);
      for (let i = 1; i < sorted.length; i += 1) expect(sorted[i]!.start_byte).toBeGreaterThanOrEqual(sorted[i - 1]!.end_byte);
    } finally {
      db.close();
    }
  });

  it("produces only gap pieces when nothing decided is close enough", async () => {
    const db = fixtureDb();
    try {
      confirmSurface(db, { reviewer: REVIEWER, exact_text: "re-roll a hit roll of 1", family_id: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" } });
      const spanText = "the murmuring tide recedes quietly across the board";
      const [pieces] = await segmentSpans(db, wordsEmbedder(), [{ text: spanText, start_byte: 0 }], { threshold: 0.9 });
      expect(pieces!.every((p) => p.kind === "gap")).toBe(true);
      expect(pieces!.map((p) => p.text).join(" ")).toBe(spanText);
    } finally {
      db.close();
    }
  });
});
