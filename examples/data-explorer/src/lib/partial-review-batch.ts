import {
  FOLLOW_UP_CATEGORIES,
  FOLLOW_UP_GUIDANCE,
  PARTIAL_VALUES,
  RENDER_DECISIONS,
  RESIDUAL_DECISIONS,
  SEMANTIC_DECISIONS,
  decisionIdentity,
  digestsEqual,
  verdictComplete,
  type AICounterexample,
  type AIReview,
  type AIReviewComplete,
  type AIReviewFailure,
  type AIUsage,
  type FollowUpCategory,
  type PartialCandidate,
  type PartialValue,
  type RenderDecision,
  type ResidualDecision,
  type ReviewerIdentity,
  type SemanticDecision,
} from "./partial-review.js";

export const AI_REVIEW_PROMPT_CONTRACT_VERSION = "partial-adversarial-v1";
export const DEFAULT_AI_REVIEW_MODEL = "claude-haiku-4-5";

export const AI_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    semantics: { enum: SEMANTIC_DECISIONS },
    partial_value: { anyOf: [{ enum: PARTIAL_VALUES }, { type: "null" }] },
    residual_relationship: { enum: RESIDUAL_DECISIONS },
    render_quality: { enum: RENDER_DECISIONS },
    follow_up_categories: { type: "array", uniqueItems: true, items: { enum: FOLLOW_UP_CATEGORIES } },
    rationale: { type: "string", minLength: 1, maxLength: 600 },
    counterexample: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { enum: ["found", "not-found", "uncertain"] },
        dimension: { anyOf: [{ enum: FOLLOW_UP_CATEGORIES }, { type: "null" }] },
        summary: { type: "string", minLength: 1, maxLength: 400 },
      },
      required: ["status", "dimension", "summary"],
    },
  },
  required: ["semantics", "partial_value", "residual_relationship", "render_quality", "follow_up_categories", "rationale", "counterexample"],
} as const;

export const AI_REVIEW_SYSTEM_PROMPT = `You are the existing adversarial reviewer for one partial Ability DSL component. AI review is a suggestion, never a human approval or whole-ability certification.

Given authoritative source text, candidate DSL, its generated render, and explicit residuals, attempt to construct a concrete game state where the candidate component asserts something different from the source. Check actor, beneficiary, singular/plural cardinality, keyword/model/unit scope, selection binding, option or branch binding, trigger, timing window, phase and turn, duration, usage, cost, exclusion, magnitude, coupled consequences, and source identity.

A partial component may be correct when the whole source has additional mechanics. Do not reject mere incompleteness when those mechanics are explicit compatible residuals. Reject omitted context when it changes whether, when, how often, or to whom the represented component applies. Treat applies_to as static roster applicability, not a runtime recipient filter.
Return only the small review taxonomy requested by the schema. A correct semantic verdict MUST choose useful-partial or correct-but-low-value and MUST use counterexample status not-found; partial_value is null only for incorrect or uncertain semantics. An incorrect verdict MUST use counterexample status found. An incorrect verdict, residual-blocks-component verdict, or non-good render verdict MUST include at least one follow_up_category. rationale and counterexample.summary must be concise conclusions, not hidden chain-of-thought. If you find a divergence, state one concrete counterexample and its closest follow-up category. If none survives, use counterexample status not-found. Do not infer or modify DSL.`;

export interface AIReviewSuggestion {
  semantics: SemanticDecision;
  partial_value: PartialValue | null;
  residual_relationship: ResidualDecision;
  render_quality: RenderDecision;
  follow_up_categories: FollowUpCategory[];
  rationale: string;
  counterexample: AICounterexample;
}

export interface ReviewerResponse {
  suggestion: AIReviewSuggestion;
  usage?: AIUsage;
}

export type AIReviewerTransport = (candidate: PartialCandidate, reviewer: ReviewerIdentity) => Promise<ReviewerResponse>;
export type AIReviewCheckpoint = (reviews: ReadonlyMap<string, AIReview>, report: AIReviewRunReport) => Promise<void> | void;

export interface AIReviewRunOptions {
  reviewer: ReviewerIdentity;
  concurrency: number;
  force?: boolean;
  now?: () => Date;
}

export interface AIReviewRunReport {
  model: string;
  prompt_contract_version: string;
  candidates: number;
  calls: number;
  failures: number;
  reused: number;
  freshly_reviewed: number;
  remaining: number;
  rate_limited: boolean;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

export class ReviewerCallError extends Error {
  constructor(
    message: string,
    readonly category: AIReviewFailure["error_category"],
    readonly usage?: AIUsage,
  ) {
    super(message);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}
function enumValue<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`${label} has an unsupported value.`);
  return value as T;
}

export function parseAIReviewSuggestion(value: unknown): AIReviewSuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI review must be an object.");
  const raw = value as Record<string, unknown>;
  const counterexampleRaw = raw.counterexample;
  if (!counterexampleRaw || typeof counterexampleRaw !== "object" || Array.isArray(counterexampleRaw)) throw new Error("AI review counterexample must be an object.");
  const counterexample = counterexampleRaw as Record<string, unknown>;
  const semantics = enumValue(raw.semantics, SEMANTIC_DECISIONS, "semantics");
  const partialValue = raw.partial_value == null ? null : enumValue(raw.partial_value, PARTIAL_VALUES, "partial_value");
  const residualRelationship = enumValue(raw.residual_relationship, RESIDUAL_DECISIONS, "residual_relationship");
  const renderQuality = enumValue(raw.render_quality, RENDER_DECISIONS, "render_quality");
  const counterexampleDimension = counterexample.dimension == null ? undefined : enumValue(counterexample.dimension, FOLLOW_UP_CATEGORIES, "counterexample.dimension");
  const followUpCategories = Array.isArray(raw.follow_up_categories)
    ? raw.follow_up_categories.map((item) => enumValue(item, FOLLOW_UP_CATEGORIES, "follow_up_categories"))
    : [];
  if (!followUpCategories.length && counterexampleDimension) followUpCategories.push(counterexampleDimension);
  if (!followUpCategories.length && renderQuality !== "render-good") followUpCategories.push("describer-problem");
  const result: AIReviewSuggestion = {
    semantics,
    partial_value: semantics === "correct" ? partialValue : null,
    residual_relationship: residualRelationship,
    render_quality: renderQuality,
    follow_up_categories: followUpCategories,
    rationale: requiredString(raw.rationale, "rationale"),
    counterexample: {
      status: enumValue(counterexample.status, ["found", "not-found", "uncertain"] as const, "counterexample.status"),
      dimension: counterexampleDimension,
      summary: requiredString(counterexample.summary, "counterexample.summary"),
    },
  };
  if (!verdictComplete(result)) throw new Error("AI review verdict is incomplete.");
  if (result.semantics === "correct" && result.counterexample.status === "found") throw new Error("AI review cannot mark semantics correct while reporting a counterexample.");
  if (result.semantics === "incorrect" && result.counterexample.status !== "found") throw new Error("An incorrect AI verdict requires a concrete counterexample.");
  return result;
}

export function reviewerInput(candidate: PartialCandidate): string {
  return JSON.stringify({
    task: "Adversarially review this partial component only.",
    identity: { key: candidate.key, component_id: candidate.component_id },
    source_text: candidate.source_text,
    candidate_entry: candidate.candidate_entry,
    follow_up_taxonomy: FOLLOW_UP_GUIDANCE,
    candidate_render: candidate.candidate_render,
    residuals: candidate.residuals,
    reviewed_input_digests: candidate.digests,
  });
}

export function reusableAIReview(candidate: PartialCandidate, review: AIReview | undefined, reviewer: ReviewerIdentity): review is AIReviewComplete {
  return Boolean(
    review?.status === "complete"
      && digestsEqual(candidate.digests, review.input_digests)
      && review.reviewer.provider === reviewer.provider
      && review.reviewer.model === reviewer.model
      && review.reviewer.model_version_or_id === reviewer.model_version_or_id
      && review.reviewer.prompt_contract_version === reviewer.prompt_contract_version,
  );
}

export async function runAIReviewBatch(
  candidates: PartialCandidate[],
  priorReviews: ReadonlyMap<string, AIReview>,
  options: AIReviewRunOptions,
  transport: AIReviewerTransport,
  checkpoint: AIReviewCheckpoint = () => {},
): Promise<{ reviews: Map<string, AIReview>; report: AIReviewRunReport }> {
  const now = options.now ?? (() => new Date());
  const reviews = new Map<string, AIReview>();
  const pending: PartialCandidate[] = [];
  const report: AIReviewRunReport = {
    model: options.reviewer.model_version_or_id,
    prompt_contract_version: options.reviewer.prompt_contract_version,
    candidates: candidates.length, calls: 0, failures: 0, reused: 0, freshly_reviewed: 0,
    remaining: 0, rate_limited: false, input_tokens: 0, output_tokens: 0,
    cache_read_input_tokens: 0, cache_creation_input_tokens: 0, total_tokens: 0, cost_usd: 0,
  };
  for (const candidate of candidates) {
    const prior = priorReviews.get(decisionIdentity(candidate)) ?? candidate.ai_review;
    if (prior) reviews.set(decisionIdentity(candidate), prior);
    if (!options.force && reusableAIReview(candidate, prior, options.reviewer)) {
      reviews.set(decisionIdentity(candidate), prior);
      report.reused++;
    } else {
      pending.push(candidate);
    }
  }

  let next = 0;
  let stopped = false;
  const updateUsage = (usage?: AIUsage): void => {
    report.input_tokens += usage?.input_tokens ?? 0;
    report.output_tokens += usage?.output_tokens ?? 0;
    report.cache_read_input_tokens += usage?.cache_read_input_tokens ?? 0;
    report.cache_creation_input_tokens += usage?.cache_creation_input_tokens ?? 0;
    report.total_tokens = report.input_tokens + report.output_tokens + report.cache_read_input_tokens + report.cache_creation_input_tokens;
    report.cost_usd += usage?.cost_usd ?? 0;
  };
  const worker = async (): Promise<void> => {
    while (!stopped) {
      const index = next++;
      if (index >= pending.length) return;
      const candidate = pending[index];
      const identity = decisionIdentity(candidate);
      report.calls++;
      try {
        const response = await transport(candidate, options.reviewer);
        const suggestion = parseAIReviewSuggestion(response.suggestion);
        const review: AIReviewComplete = {
          status: "complete", ...suggestion, reviewer: options.reviewer,
          reviewed_at: now().toISOString(), input_digests: { ...candidate.digests }, usage: response.usage,
        };
        reviews.set(identity, review);
        report.freshly_reviewed++;
        updateUsage(response.usage);
      } catch (error) {
        const known = error instanceof ReviewerCallError ? error : new ReviewerCallError(error instanceof Error ? error.message : String(error), "reviewer-error");
        const failure: AIReviewFailure = {
          status: "failed", error_category: known.category, message: known.message.slice(0, 500),
          reviewer: options.reviewer, attempted_at: now().toISOString(), input_digests: { ...candidate.digests }, usage: known.usage,
        };
        reviews.set(identity, failure);
        report.failures++;
        updateUsage(known.usage);
        if (known.category === "rate-limited") {
          report.rate_limited = true;
          stopped = true;
        }
      }
      report.remaining = Math.max(0, pending.length - Math.min(next, pending.length));
      await checkpoint(reviews, { ...report });
    }
  };
  const concurrency = Math.max(1, Math.min(8, Math.floor(options.concurrency) || 1, pending.length || 1));
  await Promise.all(Array.from({ length: concurrency }, worker));
  report.remaining = candidates.length - report.reused - report.freshly_reviewed - report.failures;
  await checkpoint(reviews, { ...report });
  return { reviews, report };
}
