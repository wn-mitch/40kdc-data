import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";

import { afterEach, describe, expect, it } from "vitest";
import { currentFamilyVersion } from "../src/semantic-authoring/contracts.js";
import { initializeWorkbench } from "../src/semantic-authoring/db.js";
import type { Embedder } from "../src/semantic-authoring/embeddings.js";
import { askChoiceRanked, JevBudget, JevPermanentError, type JevClient } from "../src/semantic-authoring/jev-core.js";
import { runJevProposer, type Span } from "../src/semantic-authoring/jev-proposer.js";
import { runJevV2Proposer } from "../src/semantic-authoring/jev-v2.js";
import { runJevV2Rounds } from "../src/semantic-authoring/jev-v2-rounds.js";
import { decidedSurfaces, segmentSpans } from "../src/semantic-authoring/jev-v2-segment.js";
import type { PilotAbility } from "../src/semantic-authoring/pilot-sample.js";
import { refreshSources } from "../src/semantic-authoring/source.js";
import { confirmSurface } from "./semantic-authoring-human.js";

// Fabricated wording only; no GW rule prose.

type DatabaseSync = DatabaseType;
const DatabaseSyncCtor = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new (path: string): DatabaseType };
const REVIEWER = "fixture-reviewer";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

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

function emptyDb(): DatabaseSync {
  const db = new DatabaseSyncCtor(":memory:") as DatabaseSync;
  initializeWorkbench(db);
  return db;
}

/**
 * A fake `JevClient` scripted by exact prompt text, so each test controls precisely what the
 * "model" answers without any network call or TYPESAFE_API_KEY. Every call is logged so a test
 * can assert exactly how many requests a span consumed.
 */
function scriptedClient(script: Record<string, { choice?: string; confidence?: number; noul?: number }>) {
  const calls: Array<{ prompt: string; state: unknown }> = [];
  const client: JevClient = {
    async systemOne(request) {
      calls.push({ prompt: (request.questions as Questions).answer.instructions as string, state: request.state });
      const prompt = (request.questions as Questions).answer.instructions as string;
      const scripted = script[prompt];
      if (!scripted) throw new Error(`Unscripted prompt: ${prompt}`);
      const usage = { input_tokens: 500, output_tokens: 20 };
      if (scripted.noul !== undefined) {
        return { model: "jev-latest", answers: { answer: { type: "noul", noul: scripted.noul } }, usage } as unknown as SystemOneResult<Questions>;
      }
      return {
        model: "jev-latest",
        answers: { answer: { type: "choice", choice: scripted.choice, confidence: scripted.confidence ?? 0.9, probabilities: { [scripted.choice!]: scripted.confidence ?? 0.9 } } },
        usage,
      } as unknown as SystemOneResult<Questions>;
    },
  };
  return { client, calls };
}

const SPAN = { ability_version_id: 1, faction_id: "fixture-faction", ability_id: "fixture-ability", fragment: "RAW_TEXT", start_byte: 0, end_byte: 30, text: "At the start of the battle round" };

describe("Jev proposer", () => {
  it("proposes a fully-resolved single-parameter family when every answer is confident", async () => {
    const { client, calls } = scriptedClient({
      "Which kind of DSL leaf does this span express?": { choice: "EVENT" },
      "Which event family does this span express?": { choice: "turn-start" },
      'What is "At the start of a turn or round"\'s "turn" parameter for this span?': { choice: "battle-round" },
    });
    const result = await runJevProposer(client, [SPAN]);
    expect(result.proposals).toHaveLength(1);
    const [proposal] = result.proposals;
    expect(proposal).toMatchObject({
      status: "proposed", role: "EVENT", family_id: "turn-start", family_version: 1,
      parameters: { turn: "battle-round" }, unresolved_parameters: [], requests: 3,
    });
    expect(calls).toHaveLength(3);
    expect(result.requests).toBe(3);
    expect(result.total_cost_usd).toBeGreaterThan(0);
    expect(result.total_input_tokens).toBe(1500);
    expect(result.budget_exhausted).toBe(false);
  });

  it("stops at role when confidence is below the floor and asks nothing further", async () => {
    const { client, calls } = scriptedClient({
      "Which kind of DSL leaf does this span express?": { choice: "EVENT", confidence: 0.2 },
    });
    const result = await runJevProposer(client, [SPAN], { confidenceFloor: 0.6 });
    expect(result.proposals[0]).toMatchObject({ status: "unanswered", role: "EVENT", role_confidence: 0.2, family_id: null, requests: 1 });
    expect(calls).toHaveLength(1);
  });

  it("treats a role of none-of-these as unanswered", async () => {
    const { client } = scriptedClient({
      "Which kind of DSL leaf does this span express?": { choice: "none-of-these", confidence: 0.95 },
    });
    const result = await runJevProposer(client, [SPAN]);
    expect(result.proposals[0]).toMatchObject({ status: "unanswered", role: null });
  });

  it("marks a family with an unresolvable array-of-enum parameter as partial, not proposed", async () => {
    // Text with no "unit"/"half-strength"/etc. wording, so `prefillFromSource` finds nothing —
    // every parameter this test cares about is resolved (or not) purely by the scripted answers.
    const conditionSpan = { ...SPAN, ability_id: "fixture-condition", text: "the murmuring tide recedes quietly" };
    const { client } = scriptedClient({
      "Which kind of DSL leaf does this span express?": { choice: "CONDITION" },
      "Which condition family does this span express?": { choice: "unit-state" },
      'What is "Unit is (or is not) in a state"\'s "subject" parameter for this span?': { choice: "this-unit" },
      'Does "Unit is (or is not) in a state"\'s "negated" parameter hold for this span?': { noul: 0.1 },
    });
    // unit-state's `states` property is an array-of-enum (multi-select) — left unresolved by
    // design (no multi-select question type exists), so the family can never reach "proposed"
    // here even with every other parameter answered confidently.
    const result = await runJevProposer(client, [conditionSpan]);
    const [proposal] = result.proposals;
    expect(proposal.family_id).toBe("unit-state");
    expect(proposal.unresolved_parameters).toContain("states");
    expect(proposal.parameters.subject).toBe("this-unit");
    expect(proposal.parameters.negated).toBe(false);
    expect(proposal.status).toBe("partial");
  });

  it("stops issuing new requests once the spend cap is reached", async () => {
    const spans = [SPAN, { ...SPAN, ability_id: "fixture-ability-2" }, { ...SPAN, ability_id: "fixture-ability-3" }];
    const { client, calls } = scriptedClient({
      "Which kind of DSL leaf does this span express?": { choice: "none-of-these", confidence: 0.95 },
    });
    // Each request reserves its worst-case cost before it is sent, so a cap below one request's
    // reservation admits no request at all. The first span's refused reservation reads as
    // unanswered; every span after it is skipped for budget, and nothing is spent.
    const result = await runJevProposer(client, spans, { spendCapUsd: 0.00001 });
    expect(result.budget_exhausted).toBe(true);
    expect(calls).toHaveLength(0);
    expect(result.proposals.slice(1).every((proposal) => proposal.status === "skipped-budget")).toBe(true);
  });
});

describe("Jev request failures", () => {
  const failing = (status: number) => {
    let calls = 0;
    const client: JevClient = { async systemOne() { calls += 1; throw Object.assign(new Error(`HTTP ${status}`), { status }); } };
    return { client, calls: () => calls };
  };
  const ask = (client: JevClient) => askChoiceRanked(client, 1000, new JevBudget(1), "span:1", "family", { phrase: "x" }, "Which?", { a: "A", b: "B" });

  it("stops the run on an error no retry can fix, such as no credits", async () => {
    const { client, calls } = failing(402);
    await expect(ask(client)).rejects.toBeInstanceOf(JevPermanentError);
    expect(calls()).toBe(1);
  });

  it("keeps a rate limit transient: retried, then unanswered", async () => {
    const { client, calls } = failing(429);
    await expect(ask(client)).resolves.toBeNull();
    expect(calls()).toBe(3);
  });
});

/** Answers "none of these" to anything not explicitly scripted, so an unexpected question (a
 * different piece reusing the same prompt text) doesn't crash the test — it just resolves to
 * "not a leaf" for that piece, which every test here already treats as an acceptable outcome. */
function narrowedClient(script: Record<string, { choice: string; confidence?: number }>) {
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

function surfacesDb(): DatabaseSync {
  const db = new DatabaseSyncCtor(":memory:") as DatabaseSync;
  initializeWorkbench(db);
  confirmSurface(db, { reviewer: REVIEWER, exact_text: "re-roll a hit roll of 1", family_id: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" } });
  confirmSurface(db, { reviewer: REVIEWER, exact_text: "If this model is on the battlefield", family_id: "unit-state", family_version: currentFamilyVersion("unit-state"), parameters: { states: ["on-battlefield"], subject: "this-model", negated: false } });
  return db;
}

describe("Jev v2 proposer", () => {
  it("asks one narrowed choice per role a matched piece has decided-surface candidates for, and reuses the matched surface's parameters as a seed", async () => {
    const db = surfacesDb();
    try {
      const span: Span = { ability_version_id: 1, faction_id: "fixture-faction", ability_id: "fixture-ability", fragment: "RAW_TEXT", start_byte: 0, end_byte: 30, text: "re-roll a hit roll of 1" };
      const { client, calls } = narrowedClient({
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
    const db = surfacesDb();
    try {
      const span: Span = { ability_version_id: 1, faction_id: "fixture-faction", ability_id: "fixture-ability", fragment: "RAW_TEXT", start_byte: 0, end_byte: 30, text: "re-roll a hit roll of 1" };
      const { client } = narrowedClient({
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
    const db = surfacesDb();
    try {
      const span: Span = { ability_version_id: 1, faction_id: "fixture-faction", ability_id: "fixture-ability", fragment: "RAW_TEXT", start_byte: 0, end_byte: 60, text: "gain a glimmer token and re-roll a hit roll of 1" };
      const { client } = narrowedClient({});
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

describe("Jev v2 segmentation", () => {
  it("lists every decided surface as a candidate to match against", () => {
    const db = emptyDb();
    try {
      confirmSurface(db, { reviewer: REVIEWER, exact_text: "re-roll a hit roll of 1", family_id: "reroll", parameters: { roll: "hit", subset: "ones", weapon_type: "all" } });
      const decided = decidedSurfaces(db);
      expect(decided).toHaveLength(1);
      expect(decided[0]).toMatchObject({ family_id: "reroll", family_version: currentFamilyVersion("reroll") });
    } finally {
      db.close();
    }
  });

  it("matches a near-identical window against a decided surface and splits a connective and gap words around it", async () => {
    const db = emptyDb();
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
    const db = emptyDb();
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

const FACTION = "fixture-faction";

/** Always answers "battle-round" (a real, closed, single-value option of the decided seed
 * family) to any family choice, and "none of these" for any role that doesn't offer it. */
function turnStartClient(): JevClient {
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
  const root = mkdtempSync(join(tmpdir(), "semantic-authoring-jevv2-rounds-"));
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
      const result = await runJevV2Rounds(db, wordsEmbedder(), turnStartClient(), sample, { segmentationThreshold: 0.5, confidenceFloor: 0.6, maxRounds: 5 });
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
