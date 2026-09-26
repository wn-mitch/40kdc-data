import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/round5c/db.js";
import type { Embedder } from "../src/round5c/embeddings.js";
import { dismissLeafProposal, listLeafProposals, runLeafProposals, type ProposalSettings } from "../src/round5c/leaf-proposals.js";
import { confirmSurface } from "../src/round5c/leaves.js";
import { refreshSources } from "../src/round5c/source.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";
// Fabricated wording only.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(texts: Record<string, string>): DatabaseSync {
  const root = mkdtempSync(join(tmpdir(), "round5c-proposals-"));
  roots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(Object.entries(texts).map(([ability_id, raw_text]) => ({ faction_id: "fixture", ability_id, raw_text }))));
  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, root);
  return db;
}

/** Bag-of-words vectors: wordings sharing words are alike. Counts every text it is asked to embed. */
function wordsEmbedder(): Embedder & { calls: number; texts: number } {
  const dims = 128;
  const embedder = {
    model: "fixture-words", calls: 0, texts: 0,
    async embed(texts: readonly string[]) {
      embedder.calls += 1;
      embedder.texts += texts.length;
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
  return embedder;
}

const SETTINGS: ProposalSettings = { k: 5, direct_sim: 0.6, direct_share: 0.6, cluster_k: 3, cluster_sim: 0.6 };
const GRANT = "ranged weapons equipped by models in that unit have the [LETHAL HITS] ability";
const REROLL = "re-roll a hit roll of 1";

function decideExamples(db: DatabaseSync) {
  confirmSurface(db, { reviewer: REVIEWER, exact_text: GRANT, family_id: "weapon-ability-grant", parameters: { subject: "this-unit", keyword: "Lethal Hits", weapon_type: "ranged" } });
  confirmSurface(db, { reviewer: REVIEWER, exact_text: REROLL, family_id: "reroll", parameters: { roll: "hit", subset: "ones" } });
}

const proposals = (db: DatabaseSync) => listLeafProposals(db).clusters.flatMap((cluster) => cluster.proposals);

describe("Round 5C leaf proposals", () => {
  it("proposes a near spelling's leaf, with what the wording itself states replacing the example's values", async () => {
    const db = fixture({
      examples: `${GRANT}. Each time this model fights, ${REROLL}.`,
      assault: "Ranged weapons equipped by models in this unit have the [ASSAULT] ability.",
    });
    decideExamples(db);
    await runLeafProposals(db, wordsEmbedder(), SETTINGS);
    const assault = proposals(db).find((item) => item.sample_text.includes("ASSAULT"));
    expect(assault).toMatchObject({ kind: "direct", pieces: [{ family_id: "weapon-ability-grant", parameters: { subject: "this-unit", keyword: "Assault", weapon_type: "ranged" } }] });
    // The evidence names the example it came from.
    expect((assault!.pieces[0] as { neighbours: Array<{ surface: string }> }).neighbours[0]!.surface).toContain("lethal hits");
  });

  it("proposes composed wording piece by piece, leaving pieces no example names for the reviewer", async () => {
    const db = fixture({
      examples: `${GRANT}. Each time this model fights, ${REROLL}.`,
      both: "Re-roll hit rolls of 1, and ranged weapons equipped by models in this unit have the [ASSAULT] ability.",
      half: "Re-roll hit rolls of 1, and gain 1CP.",
    });
    decideExamples(db);
    await runLeafProposals(db, wordsEmbedder(), SETTINGS);
    const listed = proposals(db);
    expect(listed.find((item) => item.sample_text.includes("ASSAULT"))).toMatchObject({ kind: "decomposition", pieces: [
      { text: "Re-roll hit rolls of 1", family_id: "reroll", parameters: { roll: "hit", subset: "ones" } },
      { text: "ranged weapons equipped by models in this unit have the [ASSAULT] ability", family_id: "weapon-ability-grant" },
    ] });
    expect(listed.find((item) => item.sample_text.includes("1CP"))).toMatchObject({ kind: "partial", pieces: [
      { text: "Re-roll hit rolls of 1", family_id: "reroll" },
      { text: "gain 1CP", family_id: null },
    ] });
  });

  it("drops a proposal once its wording is decided, and embeds nothing twice", async () => {
    const db = fixture({
      examples: `${GRANT}. Each time this model fights, ${REROLL}.`,
      assault: "Ranged weapons equipped by models in this unit have the [ASSAULT] ability.",
    });
    decideExamples(db);
    const embedder = wordsEmbedder();
    const first = await runLeafProposals(db, embedder, SETTINGS);
    expect(first.counts.embedded).toBeGreaterThan(0);
    const assault = proposals(db).find((item) => item.sample_text.includes("ASSAULT"))!;
    confirmSurface(db, { reviewer: REVIEWER, exact_text: assault.sample_text, family_id: "weapon-ability-grant", parameters: { subject: "this-unit", keyword: "Assault", weapon_type: "ranged" } });
    expect(proposals(db).some((item) => item.id === assault.id)).toBe(false);
    const texts = embedder.texts;
    const second = await runLeafProposals(db, embedder, SETTINGS);
    expect(second.counts.embedded).toBe(0);
    expect(embedder.texts).toBe(texts);
  });

  it("keeps a dismissed proposal hidden in later runs while it proposes the same thing", async () => {
    const db = fixture({
      examples: `${GRANT}. Each time this model fights, ${REROLL}.`,
      assault: "Ranged weapons equipped by models in this unit have the [ASSAULT] ability.",
    });
    decideExamples(db);
    await runLeafProposals(db, wordsEmbedder(), SETTINGS);
    const assault = proposals(db).find((item) => item.sample_text.includes("ASSAULT"))!;
    expect(dismissLeafProposal(db, assault.id)).toEqual({ dismissed: 1 });
    await runLeafProposals(db, wordsEmbedder(), SETTINGS);
    expect(proposals(db).some((item) => item.sample_text.includes("ASSAULT"))).toBe(false);
  });

  it("groups alike wording that no example names into one cluster", async () => {
    const db = fixture({
      examples: `${GRANT}. Each time this model fights, ${REROLL}.`,
      one: "Gain 1CP at the end of the battle round.",
      two: "Gain 2CP at the end of the battle round.",
      other: "Swap places with a friendly unit.",
    });
    decideExamples(db);
    await runLeafProposals(db, wordsEmbedder(), SETTINGS);
    const clusters = listLeafProposals(db).clusters.map((cluster) => cluster.proposals.map((item) => item.sample_text).sort());
    expect(clusters).toContainEqual(["Gain 1CP at the end of the battle round", "Gain 2CP at the end of the battle round"]);
    expect(clusters).toContainEqual(["Swap places with a friendly unit"]);
  });
});
