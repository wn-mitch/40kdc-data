import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/round5c/db.js";
import type { Embedder } from "../src/round5c/embeddings.js";
import { runLeafProposals, type ProposalSettings } from "../src/round5c/leaf-proposals.js";
import { refreshSources } from "../src/round5c/source.js";
import { selectPilotSample } from "../src/round5c/pilot-sample.js";

// Fabricated wording only; no GW rule prose.

type DatabaseSync = DatabaseType;
const DatabaseSyncCtor = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new (path: string): DatabaseType };

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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

const SETTINGS: ProposalSettings = { k: 5, direct_sim: 0.6, direct_share: 0.6, cluster_k: 3, cluster_sim: 0.6 };
const FACTIONS = ["fixture-alpha", "fixture-beta", "fixture-gamma", "fixture-delta", "fixture-epsilon", "fixture-zeta"];

/** Two abilities per faction sharing one made-up untiled phrase (so each faction forms its own
 * residue cluster), decided nowhere — nothing here is a real leaf family's wording. */
function fixture(): DatabaseSync {
  const root = mkdtempSync(join(tmpdir(), "round5c-pilot-"));
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
