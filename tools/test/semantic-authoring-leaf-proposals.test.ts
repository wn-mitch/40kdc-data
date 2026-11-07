import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { initializeWorkbench } from "../src/semantic-authoring/db.js";
import type { Embedder } from "../src/semantic-authoring/embeddings.js";
import { dismissLeafProposal, listLeafProposals, runLeafProposals, type ProposalSettings } from "../src/semantic-authoring/leaf-proposals.js";
import { askModelAboutClusters } from "../src/semantic-authoring/leaf-proposals-llm.js";
import { mutualKnnClusters, topK, vote } from "../src/semantic-authoring/leaf-knn.js";
import { keywordsIn, predicateProposal } from "../src/semantic-authoring/leaf-predicate-rules.js";
import { currentFamilyVersion } from "../src/semantic-authoring/contracts.js";

import { refreshSources } from "../src/semantic-authoring/source.js";
import { confirmSurface } from "./semantic-authoring-human.js";

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";
// Fabricated wording only.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(texts: Record<string, string>): DatabaseSync {
  const root = mkdtempSync(join(tmpdir(), "semantic-authoring-proposals-"));
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
  confirmSurface(db, { reviewer: REVIEWER, exact_text: REROLL, family_id: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" } });
}

const proposals = (db: DatabaseSync) => listLeafProposals(db).clusters.flatMap((cluster) => cluster.proposals);

describe("Semantic authoring leaf proposals", () => {
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

describe("Semantic authoring leaf proposals from the model", () => {
  it("keeps only pieces taken from the wording with valid leaves, and records every call", async () => {
    const db = fixture({
      examples: `${GRANT}. Each time this model fights, ${REROLL}.`,
      odd: "Swap places with a friendly unit and gain 1CP.",
      strange: "Roll off with your opponent for no reason.",
    });
    decideExamples(db);
    await runLeafProposals(db, wordsEmbedder(), SETTINGS);
    const unlabelled = listLeafProposals(db, { kinds: ["unlabelled"] });
    const byText = new Map(unlabelled.clusters.flatMap((cluster) => cluster.proposals).map((item) => [item.sample_text, item]));
    const odd = byText.get("Swap places with a friendly unit and gain 1CP")!;
    const strange = byText.get("Roll off with your opponent for no reason")!;
    let request: { families: Array<{ family_id: string }>; examples: unknown[]; wordings: Array<{ id: number; text: string }> } | null = null;
    const result = await askModelAboutClusters(db, unlabelled.clusters.map((cluster) => cluster.cluster), async (instructions, text) => {
      request = JSON.parse(text);
      expect(instructions).toMatch(/one JSON object/u);
      return { model: "fixture/model", model_version: "1", cost_usd: 0, latency_ms: 5, body: { answers: [
        { id: odd.id, pieces: [
          { text: "gain 1cp", family_id: "resource-action", parameters: { resource: "command-point", operation: "gain", amount: 1 } },
          { text: "Swap places with a friendly unit", family_id: null },
          { text: "teleport home", family_id: "reroll", parameters: { roll: "hit", subset: "ones" } },
          { text: "Swap places", family_id: "reroll", parameters: { roll: "hit", subset: "sometimes" } },
        ] },
        { id: strange.id, new_family: { role: "EVENT", label: "roll-off", distinction: "Not a phase or attack event." } },
      ] } };
    });
    expect(request!.wordings.map((item) => item.id)).toEqual(expect.arrayContaining([odd.id, strange.id]));
    expect(request!.families.some((family) => family.family_id === "reroll")).toBe(true);
    expect(result).toMatchObject({ asked: request!.wordings.length, named: 1, new_families: 1, failed: [] });
    const listed = new Map(listLeafProposals(db, { kinds: ["llm", "new-family"] }).clusters.flatMap((cluster) => cluster.proposals).map((item) => [item.id, item]));
    expect(listed.get(odd.id)).toMatchObject({ kind: "llm", pieces: [
      // The wording's own spelling, not the model's lowercase copy.
      { text: "gain 1CP", family_id: "resource-action" },
      { text: "Swap places with a friendly unit", family_id: null },
      { text: "Swap places", family_id: null },
    ] });
    expect(listed.get(odd.id)!.dropped).toEqual([expect.stringMatching(/"teleport home" is not part of the wording/u), expect.stringMatching(/^"Swap places" as reroll/u)]);
    expect(listed.get(strange.id)).toMatchObject({ kind: "new-family", pieces: [{ new_family: { label: "roll-off" } }] });
    expect(db.prepare("SELECT count(*) AS n FROM model_runs WHERE prompt_version = 'leaf-proposals-v1' AND status = 'completed'").get()).toEqual({ n: 1 });
  });

  it("leaves wording unlabelled and reports it when a call fails", async () => {
    const db = fixture({ examples: `${GRANT}.`, odd: "Swap places with a friendly unit." });
    confirmSurface(db, { reviewer: REVIEWER, exact_text: GRANT, family_id: "weapon-ability-grant", parameters: { subject: "this-unit", keyword: "Lethal Hits", weapon_type: "ranged" } });
    await runLeafProposals(db, wordsEmbedder(), SETTINGS);
    const clusters = listLeafProposals(db, { kinds: ["unlabelled"] }).clusters.map((cluster) => cluster.cluster);
    const result = await askModelAboutClusters(db, clusters, async () => { throw new Error("omp is not installed"); });
    expect(result).toMatchObject({ asked: 0, named: 0, failed: ["omp is not installed"] });
    expect(listLeafProposals(db, { kinds: ["unlabelled"] }).clusters.length).toBe(clusters.length);
    expect(db.prepare("SELECT status FROM model_runs WHERE prompt_version = 'leaf-proposals-v1'").all()).toEqual([{ status: "failed" }]);
  });
});

describe("Semantic authoring leaf proposal tables", () => {
  it("rebuilds a proposals table created before the current kinds", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE leaf_proposal_runs (id INTEGER PRIMARY KEY, model TEXT NOT NULL, settings_json TEXT NOT NULL, status TEXT NOT NULL, counts_json TEXT, error TEXT, started_at TEXT NOT NULL, finished_at TEXT) STRICT;
      CREATE TABLE leaf_proposals (id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, cluster INTEGER NOT NULL, surface TEXT NOT NULL, sample_text TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('direct', 'decomposition', 'llm', 'new-family', 'unlabelled')), pieces_json TEXT NOT NULL, confidence REAL NOT NULL,
        occurrences INTEGER NOT NULL, closes INTEGER NOT NULL, dropped_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, model_run_id INTEGER, UNIQUE(run_id, surface)) STRICT;
      INSERT INTO leaf_proposal_runs (model, settings_json, status, started_at) VALUES ('m', '{}', 'failed', 'now');`);
    initializeWorkbench(db);
    expect(() => db.prepare(`INSERT INTO leaf_proposals (run_id, cluster, surface, sample_text, kind, pieces_json, confidence, occurrences, closes, status)
      VALUES (1, 0, 's', 's', 'partial', '[]', 0, 1, 0, 'open')`).run()).not.toThrow();
    // The run history survives; only the rebuildable proposals are dropped.
    expect(db.prepare("SELECT count(*) AS n FROM leaf_proposal_runs").get()).toEqual({ n: 1 });
  });
});

const unit = (...values: number[]) => {
  const length = Math.hypot(...values);
  return new Float32Array(values.map((value) => value / length));
};

describe("Semantic authoring leaf kNN", () => {
  it("ranks neighbours by similarity, keeping pool order on ties, and can skip the query itself", () => {
    const pool = [unit(1, 0), unit(0, 1), unit(1, 0), unit(1, 1)];
    expect(topK(unit(1, 0), pool, 3).map((item) => item.index)).toEqual([0, 2, 3]);
    expect(topK(pool[0]!, pool, 2, 0).map((item) => item.index)).toEqual([2, 3]);
  });

  it("weights votes by similarity and reports the closest example of the winner", () => {
    const items = ["reroll", "grant", "grant"];
    const result = vote([{ index: 0, sim: 0.9 }, { index: 1, sim: 0.5 }, { index: 2, sim: 0.6 }], items, (item) => item);
    // Two weaker grant neighbours outvote one closer re-roll: 1.1 against 0.9.
    expect(result).toMatchObject({ label: "grant", best: { index: 2, sim: 0.6 } });
    expect(result!.share).toBeCloseTo(1.1 / 2);
  });

  it("breaks an even vote toward the closer example, not toward map order", () => {
    const items = ["a", "b"];
    expect(vote([{ index: 0, sim: 0.5 }, { index: 1, sim: 0.5 }], items, (item) => item)!.label).toBe("a");
    expect(vote([{ index: 1, sim: 0.7 }, { index: 0, sim: 0.3 }, { index: 0, sim: 0.4 }], ["a", "b"], (item) => item)!.label).toBe("b");
    expect(vote([], items, (item) => item)).toBeNull();
  });

  it("does not let a bridge between two tight groups merge them", () => {
    // Two tight groups on the x and y axes, and one wording halfway between.
    const vectors = [unit(1, 0.02), unit(1, 0.04), unit(1, 0.06), unit(0.02, 1), unit(0.04, 1), unit(0.06, 1), unit(1, 1)];
    const clusters = mutualKnnClusters(vectors, 2, 0.5);
    expect(clusters.map((cluster) => cluster.members)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    // The medoid is the member most like the rest of its group.
    expect(clusters[0]!.medoid).toBe(1);
  });

  it("links nothing below the similarity floor", () => {
    expect(mutualKnnClusters([unit(1, 0), unit(0, 1)], 1, 0.5).map((cluster) => cluster.members)).toEqual([[0], [1]]);
  });
});

// Fabricated keywords and wording only.
const index = new Map(["Monster", "Vehicle", "Fly", "Character", "Stellar Wardens", "Wardens"].map((keyword) => [keyword.toUpperCase(), keyword]));

describe("Semantic authoring predicate proposals from the wording", () => {
  it("finds core keywords whatever their case, preferring the longest", () => {
    expect(keywordsIn("that targets a Monster or **VEHICLE** unit", index)).toEqual(["MONSTER", "VEHICLE"]);
    expect(keywordsIn("that targets a STELLAR WARDENS unit", index)).toEqual(["STELLAR WARDENS"]);
  });

  it("proposes the keyword a targeted unit must have, negated where the words say not", () => {
    expect(predicateProposal("that targets a Monster or Vehicle unit", index)).toMatchObject({
      family_id: "unit-keyword", parameters: { keywords: ["MONSTER", "VEHICLE"], subject: "target", negated: false },
    });
    expect(predicateProposal("that target is a **MONSTER** or **VEHICLE** unit", index)).toMatchObject({ family_id: "unit-keyword", parameters: { keywords: ["MONSTER", "VEHICLE"] } });
    expect(predicateProposal("that targets a unit that cannot FLY", index)).toMatchObject({
      family_id: "unit-keyword", parameters: { keywords: ["FLY"], subject: "target", negated: true },
    });
  });

  it("proposes states and marks, including this model on the battlefield", () => {
    expect(predicateProposal("If this model is on the battlefield", index)).toMatchObject({
      family_id: "unit-state", family_version: currentFamilyVersion("unit-state"), parameters: { states: ["on-battlefield"], subject: "this-model", negated: false },
    });
    expect(predicateProposal("that targets a unit that is not Below Half-strength", index)).toMatchObject({
      family_id: "unit-state", parameters: { states: ["below-half-strength"], subject: "target", negated: true },
    });
    expect(predicateProposal("that targets a Spotted unit", index)).toMatchObject({ family_id: "unit-mark", parameters: { mark: "spotted", subject: "target" } });
  });

  it("proposes nothing for capitals that are not unit keywords, for effects, or for long composed wording", () => {
    expect(predicateProposal("that targets a GIZMO unit", index)).toBeNull();
    expect(predicateProposal("that targets an enemy unit", index)).toBeNull();
    expect(predicateProposal("add 1 to the Hit roll", index)).toBeNull();
    expect(predicateProposal("that targets a MONSTER unit, add 1 to the Hit roll and re-roll the Wound roll for every attack this unit makes", index)).toBeNull();
    // Two families fully stated at once is composed wording, not one leaf.
    expect(predicateProposal("that targets a MONSTER unit that is Battle-shocked", index)).toBeNull();
    // Words the leaf cannot hold (a model count, attachment, an event, an effect) mean it is not this leaf.
    expect(predicateProposal("that targets a Monster unit containing 5 or more models", index)).toBeNull();
    expect(predicateProposal("While a CHARACTER model is leading this unit", index)).toBeNull();
    expect(predicateProposal("when an enemy unit targets a friendly MONSTER unit", index)).toBeNull();
    expect(predicateProposal("that target a MONSTER/VEHICLE unit can re-roll wound rolls", index)).toBeNull();
    expect(predicateProposal("that targets the closest eligible target within 18", index)).toBeNull();
    expect(predicateProposal("that targets an enemy unit that is more than 12\" away", index)).toMatchObject({ family_id: "unit-position", parameters: { kind: "beyond", inches: 12 } });
  });
});
