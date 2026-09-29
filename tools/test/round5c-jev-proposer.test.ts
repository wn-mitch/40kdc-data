import { describe, expect, it } from "vitest";
import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";

import { runJevProposer, type JevClient } from "../src/round5c/jev-proposer.js";

// Fabricated wording only; no GW rule prose.

/**
 * A fake `JevClient` scripted by exact prompt text, so each test controls precisely what the
 * "model" answers without any network call or TYPESAFE_API_KEY. Every call is logged so a test
 * can assert exactly how many requests a span consumed.
 */
function fakeClient(script: Record<string, { choice?: string; confidence?: number; noul?: number }>) {
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
    const { client, calls } = fakeClient({
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
    const { client, calls } = fakeClient({
      "Which kind of DSL leaf does this span express?": { choice: "EVENT", confidence: 0.2 },
    });
    const result = await runJevProposer(client, [SPAN], { confidenceFloor: 0.6 });
    expect(result.proposals[0]).toMatchObject({ status: "unanswered", role: "EVENT", role_confidence: 0.2, family_id: null, requests: 1 });
    expect(calls).toHaveLength(1);
  });

  it("treats a role of none-of-these as unanswered", async () => {
    const { client } = fakeClient({
      "Which kind of DSL leaf does this span express?": { choice: "none-of-these", confidence: 0.95 },
    });
    const result = await runJevProposer(client, [SPAN]);
    expect(result.proposals[0]).toMatchObject({ status: "unanswered", role: null });
  });

  it("marks a family with an unresolvable array-of-enum parameter as partial, not proposed", async () => {
    // Text with no "unit"/"half-strength"/etc. wording, so `prefillFromSource` finds nothing —
    // every parameter this test cares about is resolved (or not) purely by the scripted answers.
    const conditionSpan = { ...SPAN, ability_id: "fixture-condition", text: "the murmuring tide recedes quietly" };
    const { client } = fakeClient({
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
    const { client, calls } = fakeClient({
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
