import { describe, expect, it } from "vitest";
import {
  aiReviewState,
  authorityState,
  calibrationReport,
  compareReviews,
  createHumanStamp,
  decisionIdentity,
  draftFromAI,
  exportReviewSession,
  humanReviewState,
  matchesQueue,
  parsePartialReviewBundle,
  parseReviewSessionItems,
  shouldRevealAI,
  summarizeReviews,
  type AIReviewComplete,
  type HumanReviewStamp,
  type PartialCandidate,
} from "./partial-review.js";

const DIGEST = "a".repeat(64);
const CHANGED_DIGEST = "b".repeat(64);
const bundle = {
  kind: "partial-component-review-bundle-v2",
  items: [{
    key: "faction/example", component_id: "accepted-effect", name: "Example",
    source_text: "Private source text", candidate_render: "This unit gains an effect.",
    candidate_entry: { effect: { type: "keyword-grant", target: "unit", modifier: { keywords: ["stealth"] } } },
    residuals: [{ summary: "A selector remains unresolved.", category: "beneficiary", unresolved_slots: ["beneficiary"] }],
    source_digest: DIGEST, base_digest: DIGEST, entry_digest: DIGEST,
    render_digest: DIGEST, residual_digest: DIGEST, schema_valid: true, canonical: true,
  }],
};

function candidate(): PartialCandidate {
  return parsePartialReviewBundle(structuredClone(bundle))[0];
}

function aiReview(item = candidate(), overrides: Partial<AIReviewComplete> = {}): AIReviewComplete {
  return {
    status: "complete",
    semantics: "correct", partial_value: "useful-partial",
    residual_relationship: "residuals-compatible", render_quality: "render-good",
    follow_up_categories: [], rationale: "No divergence survived the adversarial check.",
    counterexample: { status: "not-found", summary: "No concrete counterexample found." },
    reviewer: { provider: "anthropic", model: "claude", model_version_or_id: "claude-haiku-4-5", prompt_contract_version: "partial-adversarial-v1" },
    reviewed_at: "2026-09-11T10:00:00.000Z", input_digests: { ...item.digests },
    usage: { input_tokens: 100, output_tokens: 20, cost_usd: 0.001 },
    ...overrides,
  };
}

function humanStamp(item = candidate(), overrides: Partial<HumanReviewStamp> = {}): HumanReviewStamp {
  return {
    ...createHumanStamp(item, {
      semantics: "correct", partial_value: "useful-partial",
      residual_relationship: "residuals-compatible", render_quality: "render-good",
      follow_up_categories: [], note: "",
    }, "blind", "2026-09-11T10:00:00.000Z", new Date("2026-09-11T10:00:05.000Z")),
    ...overrides,
  };
}

function withAI(item = candidate(), review = aiReview(item)): PartialCandidate {
  return { ...item, ai_review: review };
}

describe("partial review bundle", () => {
  it("loads source, candidate, residual metadata, and all five digest bindings", () => {
    const item = candidate();
    expect(item.source_text).toBe("Private source text");
    expect(item.component_shape).toBe("keyword-grant");
    expect(item.residuals[0].unresolved_slots).toEqual(["beneficiary"]);
    expect(item.digests).toEqual({
      source_digest: DIGEST, base_entry_digest: DIGEST, candidate_entry_digest: DIGEST,
      render_digest: DIGEST, residual_ledger_digest: DIGEST,
    });
  });

  it("rejects a bundle without residual ledger identity", () => {
    const missing = structuredClone(bundle);
    delete (missing.items[0] as Record<string, unknown>).residual_digest;
    expect(() => parsePartialReviewBundle(missing)).toThrow(/residual_ledger_digest/);
  });
});

describe("AI suggestion and human stamp authority", () => {
  it("does not count an AI suggestion as a human stamp", () => {
    const item = withAI();
    const summary = summarizeReviews([item], {}, "2026-09-11T10:00:00.000Z", new Date("2026-09-11T10:01:00.000Z"));
    expect(summary).toMatchObject({ ai_reviewed: 1, human_stamped: 0, human_pending: 1, human_approved_partials: 0 });
    expect(authorityState(item)).toBe("ai-suggested");
  });

  it("derives agreement when a human stamp agrees with AI", () => {
    const item = candidate();
    const comparison = compareReviews(aiReview(item), humanStamp(item));
    expect(comparison).toMatchObject({ full_agreement: true, semantic_agreement: true, dangerous_disagreement: false });
  });

  it("makes a human override explicit", () => {
    const item = candidate();
    const human = humanStamp(item, {
      semantics: "incorrect", partial_value: null, follow_up_categories: ["wrong-beneficiary"],
    });
    const comparison = compareReviews(aiReview(item), human);
    expect(comparison).toMatchObject({ semantic_agreement: false, dangerous_disagreement: true });
    expect(comparison.dimensions).toContain("semantics");
  });

  it("hides AI in blind mode until the current human stamp exists", () => {
    const item = withAI();
    expect(shouldRevealAI("blind", item)).toBe(false);
    expect(shouldRevealAI("blind", item, humanStamp(item))).toBe(true);
  });

  it("exposes and prefills AI in assisted mode without stamping", () => {
    const item = withAI();
    expect(shouldRevealAI("assisted", item)).toBe(true);
    expect(draftFromAI(item.ai_review as AIReviewComplete)).toMatchObject({ semantics: "correct", render_quality: "render-good" });
    expect(humanReviewState(item)).toBe("absent");
  });


  it("uses the AI-clean queue only for fully clean current suggestions", () => {
    const clean = withAI();
    const renderProblem = withAI(candidate(), aiReview(candidate(), { render_quality: "render-semantically-lossy", follow_up_categories: ["describer-problem"] }));
    expect(matchesQueue(clean, undefined, "ai-correct")).toBe(true);
    expect(matchesQueue(renderProblem, undefined, "ai-correct")).toBe(false);
  });
  it("marks AI and human review stale when a reviewed input changes", () => {
    const original = candidate();
    const changed = { ...withAI(original), digests: { ...original.digests, candidate_entry_digest: CHANGED_DIGEST }, human_review: humanStamp(original) };
    expect(aiReviewState(changed)).toBe("stale");
    expect(humanReviewState(changed)).toBe("stale");
    expect(authorityState(changed)).toBe("stale");
  });

  it("does not revive a stale human stamp when AI reviews new inputs", () => {
    const original = candidate();
    const changed = { ...original, digests: { ...original.digests, render_digest: CHANGED_DIGEST } };
    const reviewed = withAI(changed, aiReview(changed));
    expect(aiReviewState(reviewed)).toBe("current");
    expect(humanReviewState(reviewed, humanStamp(original))).toBe("stale");
  });

  it("keeps a human stamp component-only and outside full certification", () => {
    const item = candidate();
    const stamp = humanStamp(item);
    const output = exportReviewSession([item], { [decisionIdentity(item)]: stamp }, "2026-09-11T10:00:00.000Z");
    expect(output).toMatchObject({ authority: "human-stamp-required", component_only: true });
    expect(output).not.toHaveProperty("final_faithful");
    expect(output.items[0].human_review).not.toHaveProperty("final_faithful");
    expect(output.items[0].human_review?.reviewer).toEqual({ kind: "human", id: "human-reviewer" });
  });

  it("round-trips separate AI and human layers", () => {
    const item = withAI();
    const stamp = humanStamp(item);
    const output = exportReviewSession([item], { [decisionIdentity(item)]: stamp }, "2026-09-11T10:00:00.000Z", new Date("2026-09-11T10:01:00.000Z"));
    const [parsed] = parseReviewSessionItems(JSON.parse(JSON.stringify(output)));
    expect(parsed.ai_review?.status).toBe("complete");
    expect(parsed.human_review?.review_mode).toBe("blind");
    expect(parsed.comparison?.full_agreement).toBe(true);
  });

  it("round-trips stale review history without using it for calibration", () => {
    const item = withAI();
    const historicalAI = aiReview(item, { reviewed_at: "2026-09-10T10:00:00.000Z" });
    const historicalHuman = humanStamp(item, { stamped_at: "2026-09-10T10:00:05.000Z" });
    const currentHuman = humanStamp(item);
    const output = exportReviewSession(
      [{ ...item, ai_review_history: [historicalAI], human_review_history: [historicalHuman] }],
      { [decisionIdentity(item)]: currentHuman },
      "2026-09-11T10:00:00.000Z",
    );
    const [parsed] = parseReviewSessionItems(JSON.parse(JSON.stringify(output)));
    expect(parsed.ai_review_history).toHaveLength(1);
    expect(parsed.ai_review_history[0]).toMatchObject({ status: "complete", reviewed_at: historicalAI.reviewed_at });
    expect(parsed.human_review_history).toHaveLength(1);
    expect(parsed.human_review_history[0]).toMatchObject({ stamped_at: historicalHuman.stamped_at, semantics: historicalHuman.semantics });
    expect(calibrationReport([{ ...parsed, ai_state: "stale", comparison: null }]).compared).toBe(0);
  });

  it("counts dangerous, conservative, render, and category disagreements", () => {
    const first = withAI(candidate());
    const secondBase = { ...candidate(), key: "faction/second" };
    const second = withAI(secondBase, aiReview(secondBase, {
      semantics: "incorrect", partial_value: null, follow_up_categories: ["wrong-timing"],
      counterexample: { status: "found", dimension: "wrong-timing", summary: "The trigger fires in a different phase." },
    }));
    const humanReviews = {
      [decisionIdentity(first)]: humanStamp(first, { semantics: "incorrect", partial_value: null, follow_up_categories: ["wrong-beneficiary"] }),
      [decisionIdentity(second)]: humanStamp(second),
    };
    const summary = summarizeReviews([first, second], humanReviews, "2026-09-11T10:00:00.000Z");
    expect(summary).toMatchObject({ compared: 2, ai_false_approvals: 1, ai_conservative_misses: 1, semantic_agreement: 0 });
    const report = calibrationReport(exportReviewSession([first, second], humanReviews, "2026-09-11T10:00:00.000Z").items);
    expect(report.human_semantic_approval).toEqual({ correct: 1, total: 2, rate: 0.5 });
    expect(report.ai_semantic_suggestion).toEqual({ correct: 1, total: 2, rate: 0.5 });
    expect(report.ai_false_approvals).toEqual(["faction/example"]);
    expect(report.ai_conservative_cases).toEqual(["faction/second"]);
    expect(report.semantic_confusion_matrix.correct.incorrect).toBe(1);
    expect(report.semantic_confusion_matrix.incorrect.correct).toBe(1);
  });
});
