import { describe, expect, it, vi } from "vitest";
import { mergeAIReviewsIntoBundle, mergePriorReviewState, parseAIReviewCLI, resolvePrivateReviewPath } from "../../partial-review.mjs";
import {
  AI_REVIEW_PROMPT_CONTRACT_VERSION,
  ReviewerCallError,
  reusableAIReview,
  runAIReviewBatch,
  type AIReviewerTransport,
} from "./partial-review-batch.js";
import { decisionIdentity, parsePartialReviewBundle, type AIReviewComplete, type PartialCandidate, type ReviewerIdentity } from "./partial-review.js";

const DIGEST = "a".repeat(64);
const reviewer: ReviewerIdentity = {
  provider: "anthropic", model: "claude", model_version_or_id: "claude-haiku-4-5",
  prompt_contract_version: AI_REVIEW_PROMPT_CONTRACT_VERSION,
};

function candidate(key: string): PartialCandidate {
  return parsePartialReviewBundle({
    kind: "partial-component-review-bundle-v2",
    items: [{
      key, component_id: "partial-1", source_text: "Private source text",
      candidate_render: "The unit gains an effect.", candidate_entry: { effect: { type: "ability-grant" } },
      residuals: [], source_digest: DIGEST, base_entry_digest: DIGEST,
      candidate_entry_digest: DIGEST, render_digest: DIGEST, residual_ledger_digest: DIGEST,
    }],
  })[0];
}

function review(item: PartialCandidate): AIReviewComplete {
  return {
    status: "complete", semantics: "correct", partial_value: "useful-partial",
    residual_relationship: "residuals-compatible", render_quality: "render-good",
    follow_up_categories: [], rationale: "No divergence found.",
    counterexample: { status: "not-found", summary: "No counterexample survived." },
    reviewer, reviewed_at: "2026-09-11T10:00:00.000Z", input_digests: { ...item.digests },
    usage: { input_tokens: 10, output_tokens: 2, cost_usd: 0.0001 },
  };
}

const successfulTransport: AIReviewerTransport = async () => ({
  suggestion: {
    semantics: "correct", partial_value: "useful-partial",
    residual_relationship: "residuals-compatible", render_quality: "render-good",
    follow_up_categories: [], rationale: "No divergence found.",
    counterexample: { status: "not-found", summary: "No counterexample survived." },
  },
  usage: { input_tokens: 10, output_tokens: 2, cost_usd: 0.0001 },
});

describe("AI review batch", () => {
  it("reuses only digest-identical reviews from the same model and prompt contract", () => {
    const item = candidate("faction/one");
    expect(reusableAIReview(item, review(item), reviewer)).toBe(true);
    expect(reusableAIReview({ ...item, digests: { ...item.digests, render_digest: "changed" } }, review(item), reviewer)).toBe(false);
    expect(reusableAIReview(item, review(item), { ...reviewer, prompt_contract_version: "new-contract" })).toBe(false);
    expect(reusableAIReview(item, review(item), { ...reviewer, model: "different-client" })).toBe(false);
  });

  it("resumes, stops after rate limiting, and preserves every completed checkpoint", async () => {
    const items = [candidate("faction/cached"), candidate("faction/fresh"), candidate("faction/limited"), candidate("faction/unattempted")];
    const transport = vi.fn<AIReviewerTransport>(async (item) => {
      if (item.key.endsWith("limited")) throw new ReviewerCallError("Session limit reached.", "rate-limited");
      return successfulTransport(item, reviewer);
    });
    const checkpoints: Array<Map<string, unknown>> = [];
    const result = await runAIReviewBatch(
      items,
      new Map([[decisionIdentity(items[0]), review(items[0])]]),
      { reviewer, concurrency: 1, now: () => new Date("2026-09-11T10:00:00.000Z") },
      transport,
      (reviews) => { checkpoints.push(new Map(reviews)); },
    );
    expect(result.report).toMatchObject({ calls: 2, failures: 1, reused: 1, freshly_reviewed: 1, remaining: 1, rate_limited: true });
    expect(result.reviews.get(decisionIdentity(items[0]))?.status).toBe("complete");
    expect(result.reviews.get(decisionIdentity(items[1]))?.status).toBe("complete");
    expect(result.reviews.get(decisionIdentity(items[2]))).toMatchObject({ status: "failed", error_category: "rate-limited" });
    expect(result.reviews.has(decisionIdentity(items[3]))).toBe(false);
    expect(checkpoints.at(-1)?.size).toBe(3);
  });

  it("records model usage without silently changing the requested model", async () => {
    const item = candidate("faction/one");
    const transport = vi.fn(successfulTransport);
    const result = await runAIReviewBatch([item], new Map(), { reviewer, concurrency: 2 }, transport);
    expect(transport).toHaveBeenCalledWith(item, reviewer);
    expect(result.report).toMatchObject({ model: "claude-haiku-4-5", input_tokens: 10, output_tokens: 2, total_tokens: 12, freshly_reviewed: 1 });
  });

  it("keeps source-bearing bundle paths private and leaves candidate DSL unchanged", () => {
    expect(resolvePrivateReviewPath("_private/partial-review/example.json")).toContain("/_private/partial-review/example.json");
    expect(() => resolvePrivateReviewPath("data/review.json")).toThrow(/must remain under/);
    const item = candidate("faction/one");
    const raw = {
      kind: "partial-component-review-bundle-v2",
      items: [{ key: item.key, component_id: item.component_id, candidate_entry: item.candidate_entry }],
    };
    const original = structuredClone(raw);
    const merged = mergeAIReviewsIntoBundle(raw, new Map([[decisionIdentity(item), review(item)]]), {
      model: reviewer.model_version_or_id, prompt_contract_version: reviewer.prompt_contract_version,
      candidates: 1, calls: 1, failures: 0, reused: 0, freshly_reviewed: 1, remaining: 0,
      rate_limited: false, input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, total_tokens: 12, cost_usd: 0.0001,
    });
    expect(raw).toEqual(original);
    expect(merged.items[0].candidate_entry).toEqual(item.candidate_entry);
    expect(merged.items[0].ai_review.status).toBe("complete");
    expect(merged).not.toHaveProperty("final_faithful");
  });

  it("selects DeepSeek explicitly and rejects unknown providers", () => {
    const options = parseAIReviewCLI(["ai-review", "_private/partial-review/example.json", "--provider", "deepseek"]);
    expect(options).toMatchObject({ provider: "deepseek", model: "deepseek-chat" });
    expect(() => parseAIReviewCLI(["ai-review", "_private/partial-review/example.json", "--provider", "other"])).toThrow(/provider/);
  });

  it("retains superseded AI decisions as history across resumed checkpoints", () => {
    const item = candidate("faction/one");
    const previous = review(item);
    const changed = { ...previous, reviewed_at: "2026-09-11T11:00:00.000Z", semantics: "incorrect" as const, partial_value: null };
    const raw = {
      kind: "partial-component-review-bundle-v2",
      items: [{ key: item.key, component_id: item.component_id, candidate_entry: item.candidate_entry }],
    };
    const resumed = mergePriorReviewState(raw, { ...raw, items: [{ ...raw.items[0], ai_review: previous }] });
    const merged = mergeAIReviewsIntoBundle(resumed, new Map([[decisionIdentity(item), changed]]), {
      model: reviewer.model_version_or_id, prompt_contract_version: reviewer.prompt_contract_version,
      candidates: 1, calls: 1, failures: 0, reused: 0, freshly_reviewed: 1, remaining: 0,
      rate_limited: false, input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, total_tokens: 12, cost_usd: 0.0001,
    });
    expect(merged.items[0].ai_review).toEqual(changed);
    expect(merged.items[0].ai_review_history).toEqual([previous]);
  });
});
