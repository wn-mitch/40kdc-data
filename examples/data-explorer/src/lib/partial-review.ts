export const SEMANTIC_DECISIONS = ["correct", "incorrect", "uncertain"] as const;
export type SemanticDecision = (typeof SEMANTIC_DECISIONS)[number];
export const PARTIAL_VALUES = ["useful-partial", "correct-but-low-value"] as const;
export type PartialValue = (typeof PARTIAL_VALUES)[number];
export const RESIDUAL_DECISIONS = ["residuals-compatible", "residual-blocks-component"] as const;
export type ResidualDecision = (typeof RESIDUAL_DECISIONS)[number];
export const RENDER_DECISIONS = ["render-good", "render-awkward-but-faithful", "render-semantically-lossy"] as const;
export type RenderDecision = (typeof RENDER_DECISIONS)[number];
export const REVIEW_MODES = ["blind", "assisted"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];
export const FOLLOW_UP_CATEGORIES = [
  "wrong-beneficiary", "missing-condition", "wrong-timing", "wrong-duration",
  "missing-usage", "missing-coupled-effect", "wrong-composition", "missing-selector",
  "missing-shape", "source-problem", "describer-problem", "tooling-gate-problem", "other",
] as const;
export type FollowUpCategory = (typeof FOLLOW_UP_CATEGORIES)[number];

export const FOLLOW_UP_GUIDANCE: Record<FollowUpCategory, { use_when: string; example: string }> = {
  "wrong-beneficiary": {
    use_when: "The effect applies to the wrong model, unit, attacker, defender, controller, or number of recipients.",
    example: "A bearer-only save is granted to the bearer’s whole unit.",
  },
  "missing-condition": {
    use_when: "The component is only true under a source condition that the candidate omits.",
    example: "A bonus requires the target to be Battle-shocked, but renders as unconditional.",
  },
  "wrong-timing": {
    use_when: "The trigger or activation window is wrong.",
    example: "An end-of-Fight-phase effect triggers when the unit is selected to fight.",
  },
  "wrong-duration": {
    use_when: "The effect starts correctly but lasts for the wrong period.",
    example: "A bonus lasting until phase end is represented for the rest of the battle.",
  },
  "missing-usage": {
    use_when: "A frequency, charge, or once-per-battle limit needed by this component is absent.",
    example: "A once-per-battle activation is represented as always available.",
  },
  "missing-coupled-effect": {
    use_when: "The retained effect is not independently true without another required consequence.",
    example: "A reactive move omits the source’s coupled cannot-charge restriction.",
  },
  "wrong-composition": {
    use_when: "The candidate combines alternatives as simultaneous effects, or splits an inseparable sequence.",
    example: "Choose one of two bonuses becomes gain both bonuses.",
  },
  "missing-selector": {
    use_when: "A choice, selected target, named weapon, or selected mode is not preserved.",
    example: "Select one enemy unit becomes every enemy unit in range.",
  },
  "missing-shape": {
    use_when: "The source mechanic is clear, but no existing DSL shape can express it faithfully.",
    example: "The DSL has no bearer-model repeated-Stratagem-target permission.",
  },
  "source-problem": {
    use_when: "The supplied source is incomplete, conflicting, or cannot establish the claimed mechanic.",
    example: "A referenced rule is named but its defining source record is missing.",
  },
  "describer-problem": {
    use_when: "The AST is faithful, but generated English is awkward or changes its meaning.",
    example: "The AST selects one unit, while the render reads as though it affects all units.",
  },
  "tooling-gate-problem": {
    use_when: "Schema or canonical lint rejects a representation that the declared DSL contract supports.",
    example: "A schema-defined modifier key is incorrectly absent from the canonical-key allowlist.",
  },
  other: {
    use_when: "A concrete defect fits none of the categories above.",
    example: "Explain the specific defect in Notes so a better category can be considered later.",
  },
};

export interface ReviewDigests {
  source_digest: string;
  base_entry_digest: string;
  candidate_entry_digest: string;
  render_digest: string;
  residual_ledger_digest: string;
}

export interface ResidualRecord {
  summary: string;
  category?: string;
  unresolved_slots?: string[];
  reason?: string;
  [key: string]: unknown;
}

export interface ReviewVerdict {
  semantics: SemanticDecision;
  partial_value: PartialValue | null;
  residual_relationship: ResidualDecision;
  render_quality: RenderDecision;
  follow_up_categories: FollowUpCategory[];
}

export interface ReviewerIdentity {
  provider: string;
  model: string;
  model_version_or_id: string;
  prompt_contract_version: string;
}

export interface AIUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cost_usd?: number;
}

export interface AICounterexample {
  status: "found" | "not-found" | "uncertain";
  dimension?: FollowUpCategory;
  summary: string;
}

export interface AIReviewComplete extends ReviewVerdict {
  status: "complete";
  rationale: string;
  counterexample: AICounterexample;
  reviewer: ReviewerIdentity;
  reviewed_at: string;
  input_digests: ReviewDigests;
  usage?: AIUsage;
}

export interface AIReviewFailure {
  status: "failed";
  error_category: "rate-limited" | "timeout" | "invalid-response" | "reviewer-error";
  message: string;
  reviewer: ReviewerIdentity;
  attempted_at: string;
  input_digests: ReviewDigests;
  usage?: AIUsage;
}

export type AIReview = AIReviewComplete | AIReviewFailure;

export interface HumanReviewerIdentity {
  kind: "human";
  id: string;
}

export interface ReviewTiming {
  opened_at: string;
  decided_at: string;
  active_ms: number;
}

export interface HumanReviewStamp extends ReviewVerdict {
  note: string;
  stamped_at: string;
  review_mode: ReviewMode;
  reviewer: HumanReviewerIdentity;
  input_digests: ReviewDigests;
  timing: ReviewTiming;
  component_shape?: string;
  component_parameters?: Record<string, unknown>;
  unresolved_slots: string[];
  residual_categories: string[];
  candidate_render?: string;
}

export interface PartialCandidate {
  key: string;
  component_id: string;
  name: string;
  faction_id?: string;
  source_text: string;
  candidate_render: string;
  current_render?: string;
  candidate_entry: unknown;
  current_entry?: unknown;
  residuals: ResidualRecord[];
  component_shape?: string;
  component_parameters?: Record<string, unknown>;
  digests: ReviewDigests;
  schema_valid?: boolean;
  canonical?: boolean;
  ai_review?: AIReview;
  human_review?: HumanReviewStamp;
  ai_review_history?: AIReview[];
  human_review_history?: HumanReviewStamp[];
  legacy_review?: { decision?: string; note?: string };
}

export interface DraftDecision {
  semantics: SemanticDecision | null;
  partial_value: PartialValue | null;
  residual_relationship: ResidualDecision | null;
  render_quality: RenderDecision | null;
  follow_up_categories: FollowUpCategory[];
  note: string;
}

export const EMPTY_DRAFT: DraftDecision = {
  semantics: null,
  partial_value: null,
  residual_relationship: null,
  render_quality: null,
  follow_up_categories: [],
  note: "",
};

export type ReviewLayerState = "absent" | "current" | "stale" | "failed";
export type ReviewAuthorityState = "unreviewed" | "ai-suggested" | "human-stamped" | "stale";
export type ReviewQueue = "all" | "human-pending" | "ai-correct" | "ai-uncertain" | "human-stamped" | "disagreement" | "ai-false-approvals" | "describer-defects" | "semantic-repair" | "stale";

export interface ReviewComparison {
  full_agreement: boolean;
  semantic_agreement: boolean;
  render_agreement: boolean;
  category_agreement: boolean;
  dangerous_disagreement: boolean;
  conservative_disagreement: boolean;
  human_uncertain: boolean;
  dimensions: string[];
}

export interface ReviewSummary {
  candidates: number;
  ai_reviewed: number;
  ai_failed: number;
  human_stamped: number;
  human_pending: number;
  stale: number;
  ai_semantic_correct: number;
  human_approved_partials: number;
  semantic_repair_queue: number;
  describer_queue: number;
  compared: number;
  semantic_agreement: number;
  ai_false_approvals: number;
  ai_conservative_misses: number;
  renderer_disagreements: number;
  category_disagreements: number;
  total_active_ms: number;
  total_session_ms: number;
  queues: Record<string, number>;
}

export interface ReviewSessionItem {
  key: string;
  component_id: string;
  component_shape?: string;
  ai_review: AIReview | null;
  human_review: HumanReviewStamp | null;
  ai_review_history: AIReview[];
  human_review_history: HumanReviewStamp[];
  ai_state: ReviewLayerState;
  human_state: ReviewLayerState;
  comparison: ReviewComparison | null;
}

export interface RendererProblemGroup {
  component_shape: string;
  count: number;
  renders: string[];
  notes: string[];
}

export interface ReviewSession {
  kind: "partial-component-review-v3";
  authority: "human-stamp-required";
  component_only: true;
  session_started_at: string;
  exported_at: string;
  items: ReviewSessionItem[];
  orphaned_human_reviews: Array<{ identity: string; human_review: HumanReviewStamp }>;
  summary: ReviewSummary;
  orphaned_human_review_history: Array<{ identity: string; human_review_history: HumanReviewStamp[] }>;
  renderer_problems: RendererProblemGroup[];
  calibration: CalibrationReport;
}

export interface CalibrationReport {
  compared: number;
  semantic_confusion_matrix: Record<SemanticDecision, Record<SemanticDecision, number>>;
  human_semantic_approval: { correct: number; total: number; rate: number | null };
  ai_semantic_suggestion: { correct: number; total: number; rate: number | null };
  semantic_agreement: { count: number; rate: number | null };
  render_quality_agreement: { count: number; rate: number | null };
  follow_up_category_agreement: { exact_matches: number; rate: number | null };
  ai_false_approvals: string[];
  ai_conservative_cases: string[];
  uncertain_cases: Array<{ key: string; ai: SemanticDecision; human: SemanticDecision; ai_rationale: string; human_note: string }>;
  disagreements: Array<{ key: string; dimensions: string[]; ai: SemanticDecision; human: SemanticDecision; ai_rationale: string; human_note: string; counterexample: AICounterexample }>;
  human_throughput: { stamped: number; active_ms: number; items_per_hour: number | null };
  ai_usage: { calls: number; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; total_tokens: number; cost_usd: number; models: string[] };
}

const DIGEST_KEYS: (keyof ReviewDigests)[] = [
  "source_digest", "base_entry_digest", "candidate_entry_digest", "render_digest", "residual_ledger_digest",
];

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
  return value;
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`${label} has an unsupported value.`);
  return value as T;
}
function parseDigests(value: unknown, label: string): ReviewDigests {
  const raw = record(value, label);
  const aliases: Record<keyof ReviewDigests, string[]> = {
    source_digest: ["source_digest", "source"],
    base_entry_digest: ["base_entry_digest", "base_digest", "base_entry"],
    candidate_entry_digest: ["candidate_entry_digest", "entry_digest", "candidate_entry"],
    render_digest: ["render_digest", "render"],
    residual_ledger_digest: ["residual_ledger_digest", "residual_digest", "ledger_digest", "residual_ledger"],
  };
  const digests = {} as ReviewDigests;
  for (const key of DIGEST_KEYS) {
    const found = aliases[key].map((alias) => raw[alias]).find((item) => typeof item === "string");
    digests[key] = requiredString(found, `${label}.${key}`);
  }
  return digests;
}
function parseResidual(value: unknown, label: string): ResidualRecord {
  if (typeof value === "string") return { summary: value };
  const raw = record(value, label);
  const summary = typeof raw.summary === "string" ? raw.summary : typeof raw.description === "string" ? raw.description : typeof raw.obligation === "string" ? raw.obligation : "Unresolved source obligation";
  return { ...raw, summary, category: optionalString(raw.category), unresolved_slots: stringArray(raw.unresolved_slots ?? raw.missing_slots), reason: optionalString(raw.reason) };
}
function parseVerdict(raw: Record<string, unknown>, label: string): ReviewVerdict {
  const semantics = enumValue(raw.semantics, SEMANTIC_DECISIONS, `${label}.semantics`);
  const partialValue = raw.partial_value == null ? null : enumValue(raw.partial_value, PARTIAL_VALUES, `${label}.partial_value`);
  const verdict: ReviewVerdict = {
    semantics,
    partial_value: semantics === "correct" ? partialValue : null,
    residual_relationship: enumValue(raw.residual_relationship, RESIDUAL_DECISIONS, `${label}.residual_relationship`),
    render_quality: enumValue(raw.render_quality, RENDER_DECISIONS, `${label}.render_quality`),
    follow_up_categories: stringArray(raw.follow_up_categories).filter((item): item is FollowUpCategory => FOLLOW_UP_CATEGORIES.includes(item as FollowUpCategory)),
  };
  if (!verdictComplete(verdict)) throw new Error(`${label} is incomplete.`);
  return verdict;
}
function parseReviewer(value: unknown, label: string): ReviewerIdentity {
  const raw = record(value, label);
  return {
    provider: requiredString(raw.provider, `${label}.provider`),
    model: requiredString(raw.model, `${label}.model`),
    model_version_or_id: requiredString(raw.model_version_or_id, `${label}.model_version_or_id`),
    prompt_contract_version: requiredString(raw.prompt_contract_version, `${label}.prompt_contract_version`),
  };
}
function parseUsage(value: unknown, label: string): AIUsage | undefined {
  if (value == null) return undefined;
  const raw = record(value, label);
  const number = (key: string): number => typeof raw[key] === "number" && raw[key] >= 0 ? raw[key] : 0;
  return {
    input_tokens: number("input_tokens"), output_tokens: number("output_tokens"),
    cache_read_input_tokens: number("cache_read_input_tokens"),
    cache_creation_input_tokens: number("cache_creation_input_tokens"),
    cost_usd: number("cost_usd"),
  };
}
function parseAIReview(value: unknown, label: string): AIReview | undefined {
  if (value == null) return undefined;
  const raw = record(value, label);
  const status = enumValue(raw.status, ["complete", "failed"] as const, `${label}.status`);
  const reviewer = parseReviewer(raw.reviewer, `${label}.reviewer`);
  const input_digests = parseDigests(raw.input_digests, `${label}.input_digests`);
  const usage = parseUsage(raw.usage, `${label}.usage`);
  if (status === "failed") {
    return {
      status,
      error_category: enumValue(raw.error_category, ["rate-limited", "timeout", "invalid-response", "reviewer-error"] as const, `${label}.error_category`),
      message: requiredString(raw.message, `${label}.message`), reviewer,
      attempted_at: requiredString(raw.attempted_at, `${label}.attempted_at`), input_digests, usage,
    };
  }
  const counterexampleRaw = record(raw.counterexample, `${label}.counterexample`);
  const verdict = parseVerdict(raw, label);
  return {
    status, ...verdict,
    rationale: requiredString(raw.rationale, `${label}.rationale`),
    counterexample: {
      status: enumValue(counterexampleRaw.status, ["found", "not-found", "uncertain"] as const, `${label}.counterexample.status`),
      dimension: counterexampleRaw.dimension == null ? undefined : enumValue(counterexampleRaw.dimension, FOLLOW_UP_CATEGORIES, `${label}.counterexample.dimension`),
      summary: requiredString(counterexampleRaw.summary, `${label}.counterexample.summary`),
    },
    reviewer, reviewed_at: requiredString(raw.reviewed_at, `${label}.reviewed_at`), input_digests, usage,
  };
}
function parseHumanReview(value: unknown, label: string): HumanReviewStamp | undefined {
  if (value == null) return undefined;
  const raw = record(value, label);
  const verdict = parseVerdict(raw, label);
  const timingRaw = record(raw.timing, `${label}.timing`);
  return {
    ...verdict,
    note: typeof raw.note === "string" ? raw.note : "",
    stamped_at: requiredString(raw.stamped_at ?? timingRaw.decided_at, `${label}.stamped_at`),
    reviewer: raw.reviewer && typeof raw.reviewer === "object" && !Array.isArray(raw.reviewer)
      ? { kind: "human", id: requiredString((raw.reviewer as Record<string, unknown>).id, `${label}.reviewer.id`) }
      : { kind: "human", id: typeof raw.reviewer_id === "string" && raw.reviewer_id.trim() ? raw.reviewer_id.trim() : "legacy-human-reviewer" },
    review_mode: enumValue(raw.review_mode ?? "blind", REVIEW_MODES, `${label}.review_mode`),
    input_digests: parseDigests(raw.input_digests ?? raw, `${label}.input_digests`),
    timing: {
      opened_at: requiredString(timingRaw.opened_at, `${label}.timing.opened_at`),
      decided_at: requiredString(timingRaw.decided_at, `${label}.timing.decided_at`),
      active_ms: typeof timingRaw.active_ms === "number" && timingRaw.active_ms >= 0 ? timingRaw.active_ms : 0,
    },
    component_shape: optionalString(raw.component_shape),
    component_parameters: raw.component_parameters && typeof raw.component_parameters === "object" && !Array.isArray(raw.component_parameters) ? raw.component_parameters as Record<string, unknown> : undefined,
    unresolved_slots: stringArray(raw.unresolved_slots), residual_categories: stringArray(raw.residual_categories),
    candidate_render: optionalString(raw.candidate_render ?? raw.current_render),
  };
}

/** Parse a private candidate bundle. Source prose remains only in this in-memory value. */
export function parsePartialReviewBundle(input: unknown): PartialCandidate[] {
  const root = record(input, "Review bundle");
  if (root.kind === "partial-component-human-review" || root.kind === "partial-component-review-v2" || root.kind === "partial-component-review-v3") {
    throw new Error("That file is a review export, not a candidate bundle. Choose the private review bundle.");
  }
  const rawItems = Array.isArray(root.items) ? root.items : Array.isArray(root.candidates) ? root.candidates : null;
  if (!rawItems) throw new Error("Review bundle must contain an items or candidates array.");
  return rawItems.map((value, index) => {
    const raw = record(value, `items[${index}]`);
    const digests = parseDigests(raw.digests ?? raw, `items[${index}].digests`);
    const residualRaw = raw.residuals ?? raw.residual_ledger ?? raw.unresolved;
    if (!Array.isArray(residualRaw)) throw new Error(`items[${index}].residuals must be an array.`);
    const candidate = raw.candidate_entry ?? raw.candidate ?? raw.entry;
    if (candidate === undefined) throw new Error(`items[${index}] is missing candidate_entry.`);
    const key = requiredString(raw.key, `items[${index}].key`);
    return {
      key, component_id: requiredString(raw.component_id, `items[${index}].component_id`),
      name: typeof raw.name === "string" ? raw.name : key.split("/").at(-1)!,
      faction_id: typeof raw.faction_id === "string" ? raw.faction_id : key.split("/")[0],
      source_text: requiredString(raw.source_text ?? raw.source, `items[${index}].source_text`),
      candidate_render: requiredString(raw.candidate_render ?? raw.render, `items[${index}].candidate_render`),
      current_render: optionalString(raw.current_render), candidate_entry: candidate, current_entry: raw.current_entry,
      residuals: residualRaw.map((item, residualIndex) => parseResidual(item, `items[${index}].residuals[${residualIndex}]`)),
      component_shape: typeof raw.component_shape === "string" ? raw.component_shape : effectShape(candidate),
      component_parameters: raw.component_parameters && typeof raw.component_parameters === "object" && !Array.isArray(raw.component_parameters) ? raw.component_parameters as Record<string, unknown> : effectParameters(candidate),
      digests, schema_valid: typeof raw.schema_valid === "boolean" ? raw.schema_valid : undefined,
      canonical: typeof raw.canonical === "boolean" ? raw.canonical : undefined,
      ai_review: parseAIReview(raw.ai_review, `items[${index}].ai_review`),
      human_review: parseHumanReview(raw.human_review, `items[${index}].human_review`),
      ai_review_history: Array.isArray(raw.ai_review_history) ? raw.ai_review_history.map((review, historyIndex) => parseAIReview(review, `items[${index}].ai_review_history[${historyIndex}]`)!) : [],
      human_review_history: Array.isArray(raw.human_review_history) ? raw.human_review_history.map((review, historyIndex) => parseHumanReview(review, `items[${index}].human_review_history[${historyIndex}]`)!) : [],
      legacy_review: raw.legacy_review && typeof raw.legacy_review === "object" ? raw.legacy_review as { decision?: string; note?: string } : undefined,
    };
  });
}

function effectNode(entry: unknown): Record<string, unknown> | undefined {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const raw = entry as Record<string, unknown>;
  const effect = raw.effect;
  return effect && typeof effect === "object" && !Array.isArray(effect) ? effect as Record<string, unknown> : raw;
}
function effectShape(entry: unknown): string | undefined {
  const effect = effectNode(entry);
  return typeof effect?.type === "string" ? effect.type : undefined;
}
function effectParameters(entry: unknown): Record<string, unknown> | undefined {
  const effect = effectNode(entry);
  if (!effect) return undefined;
  const { type: _type, ...parameters } = effect;
  return parameters;
}

export function decisionIdentity(candidate: Pick<PartialCandidate, "key" | "component_id">): string {
  return `${candidate.key}#${candidate.component_id}`;
}
export function digestsEqual(left: ReviewDigests, right: ReviewDigests): boolean {
  return DIGEST_KEYS.every((key) => left[key] === right[key]);
}
export function reviewIsStale(candidate: PartialCandidate, review: Pick<AIReview, "input_digests"> | Pick<HumanReviewStamp, "input_digests">): boolean {
  return !digestsEqual(candidate.digests, review.input_digests);
}
export function aiReviewState(candidate: PartialCandidate): ReviewLayerState {
  if (!candidate.ai_review) return "absent";
  if (reviewIsStale(candidate, candidate.ai_review)) return "stale";
  return candidate.ai_review.status === "failed" ? "failed" : "current";
}
export function humanReviewState(candidate: PartialCandidate, humanReview?: HumanReviewStamp): ReviewLayerState {
  const review = humanReview ?? candidate.human_review;
  if (!review) return "absent";
  return reviewIsStale(candidate, review) ? "stale" : "current";
}
export function authorityState(candidate: PartialCandidate, humanReview?: HumanReviewStamp): ReviewAuthorityState {
  const human = humanReviewState(candidate, humanReview);
  const ai = aiReviewState(candidate);
  if (human === "current") return "human-stamped";
  if (human === "stale" || ai === "stale") return "stale";
  if (ai === "current") return "ai-suggested";
  return "unreviewed";
}
export function verdictComplete(verdict: ReviewVerdict): boolean {
  if (verdict.semantics === "correct" && !verdict.partial_value) return false;
  if ((verdict.semantics === "incorrect" || verdict.residual_relationship === "residual-blocks-component" || verdict.render_quality !== "render-good") && verdict.follow_up_categories.length === 0) return false;
  return true;
}
export function draftComplete(draft: DraftDecision): draft is DraftDecision & ReviewVerdict {
  if (!draft.semantics || !draft.residual_relationship || !draft.render_quality) return false;
  return verdictComplete({
    semantics: draft.semantics, partial_value: draft.partial_value,
    residual_relationship: draft.residual_relationship, render_quality: draft.render_quality,
    follow_up_categories: draft.follow_up_categories,
  });
}
export function draftFromHuman(review?: HumanReviewStamp): DraftDecision {
  return review ? {
    semantics: review.semantics, partial_value: review.partial_value,
    residual_relationship: review.residual_relationship, render_quality: review.render_quality,
    follow_up_categories: [...review.follow_up_categories], note: review.note,
  } : { ...EMPTY_DRAFT, follow_up_categories: [] };
}
export function draftFromAI(review: AIReviewComplete): DraftDecision {
  return {
    semantics: review.semantics, partial_value: review.partial_value,
    residual_relationship: review.residual_relationship, render_quality: review.render_quality,
    follow_up_categories: [...review.follow_up_categories], note: "",
  };
}
export function shouldRevealAI(mode: ReviewMode, candidate: PartialCandidate, humanReview?: HumanReviewStamp): boolean {
  return mode === "assisted" || humanReviewState(candidate, humanReview) === "current";
}
export function createHumanStamp(candidate: PartialCandidate, draft: DraftDecision, reviewMode: ReviewMode, openedAt: string, decidedAt = new Date(), reviewerId = "human-reviewer"): HumanReviewStamp {
  if (!draftComplete(draft)) throw new Error("Complete semantics, residual, render, and required follow-up fields before stamping.");
  const unresolvedSlots = [...new Set(candidate.residuals.flatMap((residual) => residual.unresolved_slots ?? []))];
  const residualCategories = [...new Set(candidate.residuals.map((residual) => residual.category).filter((value): value is string => Boolean(value)))];
  return {
    semantics: draft.semantics,
    partial_value: draft.semantics === "correct" ? draft.partial_value : null,
    residual_relationship: draft.residual_relationship,
    render_quality: draft.render_quality,
    follow_up_categories: [...draft.follow_up_categories], note: draft.note.trim(),
    reviewer: { kind: "human", id: reviewerId.trim() || "human-reviewer" },
    stamped_at: decidedAt.toISOString(), review_mode: reviewMode, input_digests: { ...candidate.digests },
    timing: { opened_at: openedAt, decided_at: decidedAt.toISOString(), active_ms: Math.max(0, decidedAt.getTime() - new Date(openedAt).getTime()) },
    component_shape: candidate.component_shape, component_parameters: candidate.component_parameters,
    unresolved_slots: unresolvedSlots, residual_categories: residualCategories,
    candidate_render: draft.render_quality === "render-good" ? undefined : candidate.candidate_render,
  };
}

function sameCategories(left: readonly FollowUpCategory[], right: readonly FollowUpCategory[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}
export function compareReviews(ai: AIReviewComplete, human: HumanReviewStamp): ReviewComparison {
  const semanticAgreement = ai.semantics === human.semantics;
  const renderAgreement = ai.render_quality === human.render_quality;
  const categoryAgreement = sameCategories(ai.follow_up_categories, human.follow_up_categories);
  const partialAgreement = ai.partial_value === human.partial_value;
  const residualAgreement = ai.residual_relationship === human.residual_relationship;
  const dimensions: string[] = [];
  if (!semanticAgreement) dimensions.push("semantics");
  if (!partialAgreement) dimensions.push("partial-value");
  if (!residualAgreement) dimensions.push("residuals");
  if (!renderAgreement) dimensions.push("render");
  if (!categoryAgreement) dimensions.push("categories");
  return {
    full_agreement: dimensions.length === 0,
    semantic_agreement: semanticAgreement, render_agreement: renderAgreement, category_agreement: categoryAgreement,
    dangerous_disagreement: ai.semantics === "correct" && human.semantics === "incorrect",
    conservative_disagreement: ai.semantics !== "correct" && human.semantics === "correct",
    human_uncertain: human.semantics === "uncertain", dimensions,
  };
}

function currentAI(candidate: PartialCandidate): AIReviewComplete | undefined {
  return aiReviewState(candidate) === "current" && candidate.ai_review?.status === "complete" ? candidate.ai_review : undefined;
}
function currentHuman(candidate: PartialCandidate, humanReview?: HumanReviewStamp): HumanReviewStamp | undefined {
  const review = humanReview ?? candidate.human_review;
  return humanReviewState(candidate, review) === "current" ? review : undefined;
}
function aiIsClean(review: AIReviewComplete | undefined): boolean {
  return Boolean(
    review
      && review.semantics === "correct"
      && review.partial_value === "useful-partial"
      && review.residual_relationship === "residuals-compatible"
      && review.render_quality === "render-good"
      && review.follow_up_categories.length === 0,
  );
}
export function matchesQueue(candidate: PartialCandidate, humanReview: HumanReviewStamp | undefined, queue: ReviewQueue): boolean {
  if (queue === "all") return true;
  const ai = currentAI(candidate);
  const human = currentHuman(candidate, humanReview);
  const comparison = ai && human ? compareReviews(ai, human) : undefined;
  if (queue === "human-pending") return !human;
  if (queue === "ai-correct") return aiIsClean(ai) && !human;
  if (queue === "ai-uncertain") return ai?.semantics === "uncertain" && !human;
  if (queue === "human-stamped") return Boolean(human);
  if (queue === "disagreement") return Boolean(comparison && !comparison.full_agreement);
  if (queue === "ai-false-approvals") return comparison?.dangerous_disagreement === true;
  if (queue === "describer-defects") return human ? human.render_quality !== "render-good" : ai?.render_quality !== "render-good";
  if (queue === "semantic-repair") return human?.semantics === "incorrect";
  return authorityState(candidate, humanReview) === "stale";
}

export function summarizeReviews(candidates: PartialCandidate[], humanReviews: Record<string, HumanReviewStamp>, sessionStartedAt: string, now = new Date()): ReviewSummary {
  const queues: Record<string, number> = {};
  const add = (key: string): void => { queues[key] = (queues[key] ?? 0) + 1; };
  let aiReviewed = 0;
  let aiFailed = 0;
  let humanStamped = 0;
  let stale = 0;
  let aiCorrect = 0;
  let humanApproved = 0;
  let semanticRepair = 0;
  let describer = 0;
  let compared = 0;
  let semanticAgreement = 0;
  let falseApprovals = 0;
  let conservativeMisses = 0;
  let rendererDisagreements = 0;
  let categoryDisagreements = 0;
  let totalActiveMs = 0;
  for (const candidate of candidates) {
    const identity = decisionIdentity(candidate);
    const ai = currentAI(candidate);
    const human = currentHuman(candidate, humanReviews[identity]);
    if (candidate.ai_review?.status === "failed" && aiReviewState(candidate) === "failed") aiFailed++;
    if (authorityState(candidate, humanReviews[identity]) === "stale") stale++;
    if (ai) {
      aiReviewed++;
      if (ai.semantics === "correct") aiCorrect++;
    }
    if (human) {
      humanStamped++;
      totalActiveMs += human.timing.active_ms;
      if (human.semantics === "correct" && human.partial_value === "useful-partial") humanApproved++;
      if (human.semantics === "incorrect") semanticRepair++;
      if (human.render_quality !== "render-good") describer++;
      for (const category of human.follow_up_categories) add(category);
    }
    if (ai && human) {
      compared++;
      const comparison = compareReviews(ai, human);
      if (comparison.semantic_agreement) semanticAgreement++;
      if (comparison.dangerous_disagreement) falseApprovals++;
      if (comparison.conservative_disagreement) conservativeMisses++;
      if (!comparison.render_agreement) rendererDisagreements++;
      if (!comparison.category_agreement) categoryDisagreements++;
    }
  }
  queues["human-pending"] = candidates.length - humanStamped;
  queues["ai-clean-human-pending"] = candidates.filter((candidate) => matchesQueue(candidate, humanReviews[decisionIdentity(candidate)], "ai-correct")).length;
  queues["semantic-repair"] = semanticRepair;
  queues["describer-defects"] = describer;
  queues.stale = stale;
  return {
    candidates: candidates.length, ai_reviewed: aiReviewed, ai_failed: aiFailed,
    human_stamped: humanStamped, human_pending: candidates.length - humanStamped, stale,
    ai_semantic_correct: aiCorrect, human_approved_partials: humanApproved,
    semantic_repair_queue: semanticRepair, describer_queue: describer, compared,
    semantic_agreement: semanticAgreement, ai_false_approvals: falseApprovals,
    ai_conservative_misses: conservativeMisses, renderer_disagreements: rendererDisagreements,
    category_disagreements: categoryDisagreements, total_active_ms: totalActiveMs,
    total_session_ms: Math.max(0, now.getTime() - new Date(sessionStartedAt).getTime()), queues,
  };
}

export function calibrationReport(items: ReviewSessionItem[]): CalibrationReport {
  const matrix = Object.fromEntries(SEMANTIC_DECISIONS.map((ai) => [ai, Object.fromEntries(SEMANTIC_DECISIONS.map((human) => [human, 0]))])) as Record<SemanticDecision, Record<SemanticDecision, number>>;
  const comparisons: Array<{ item: ReviewSessionItem; ai: AIReviewComplete; human: HumanReviewStamp; comparison: ReviewComparison }> = [];
  const aiReviews: AIReview[] = [];
  for (const item of items) {
    if (item.ai_review) aiReviews.push(item.ai_review);
    if (item.ai_state !== "current" || item.human_state !== "current" || item.ai_review?.status !== "complete" || !item.human_review) continue;
    const comparison = item.comparison ?? compareReviews(item.ai_review, item.human_review);
    comparisons.push({ item, ai: item.ai_review, human: item.human_review, comparison });
    matrix[item.ai_review.semantics][item.human_review.semantics]++;
  }
  const currentAIReviews = items.flatMap((item) => item.ai_state === "current" && item.ai_review?.status === "complete" ? [item.ai_review] : []);
  const currentHumanReviews = items.flatMap((item) => item.human_state === "current" && item.human_review ? [item.human_review] : []);
  const aiCorrect = currentAIReviews.filter((review) => review.semantics === "correct").length;
  const humanCorrect = currentHumanReviews.filter((review) => review.semantics === "correct").length;
  const rate = (count: number): number | null => comparisons.length ? count / comparisons.length : null;
  const semanticMatches = comparisons.filter(({ comparison }) => comparison.semantic_agreement).length;
  const renderMatches = comparisons.filter(({ comparison }) => comparison.render_agreement).length;
  const categoryMatches = comparisons.filter(({ comparison }) => comparison.category_agreement).length;
  const activeMs = comparisons.reduce((sum, { human }) => sum + human.timing.active_ms, 0);
  const usage = aiReviews.reduce((sum, review) => {
    sum.input_tokens += review.usage?.input_tokens ?? 0;
    sum.output_tokens += review.usage?.output_tokens ?? 0;
    sum.cache_read_input_tokens += review.usage?.cache_read_input_tokens ?? 0;
    sum.cache_creation_input_tokens += review.usage?.cache_creation_input_tokens ?? 0;
    sum.cost_usd += review.usage?.cost_usd ?? 0;
    return sum;
  }, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0 });
  const totalTokens = usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
  return {
    compared: comparisons.length, semantic_confusion_matrix: matrix,
    semantic_agreement: { count: semanticMatches, rate: rate(semanticMatches) },
    human_semantic_approval: { correct: humanCorrect, total: currentHumanReviews.length, rate: currentHumanReviews.length ? humanCorrect / currentHumanReviews.length : null },
    ai_semantic_suggestion: { correct: aiCorrect, total: currentAIReviews.length, rate: currentAIReviews.length ? aiCorrect / currentAIReviews.length : null },
    render_quality_agreement: { count: renderMatches, rate: rate(renderMatches) },
    follow_up_category_agreement: { exact_matches: categoryMatches, rate: rate(categoryMatches) },
    ai_false_approvals: comparisons.filter(({ comparison }) => comparison.dangerous_disagreement).map(({ item }) => item.key),
    ai_conservative_cases: comparisons.filter(({ comparison }) => comparison.conservative_disagreement).map(({ item }) => item.key),
    uncertain_cases: comparisons.filter(({ ai, human }) => ai.semantics === "uncertain" || human.semantics === "uncertain").map(({ item, ai, human }) => ({ key: item.key, ai: ai.semantics, human: human.semantics, ai_rationale: ai.rationale, human_note: human.note })),
    disagreements: comparisons.filter(({ comparison }) => !comparison.full_agreement).map(({ item, ai, human, comparison }) => ({ key: item.key, dimensions: comparison.dimensions, ai: ai.semantics, human: human.semantics, ai_rationale: ai.rationale, human_note: human.note, counterexample: ai.counterexample })),
    human_throughput: { stamped: comparisons.length, active_ms: activeMs, items_per_hour: activeMs > 0 ? comparisons.length * 3_600_000 / activeMs : null },
    ai_usage: { calls: aiReviews.length, ...usage, total_tokens: totalTokens, models: [...new Set(aiReviews.map((review) => review.reviewer.model_version_or_id))].sort() },
  };
}

function uniqueHumanHistory(reviews: HumanReviewStamp[]): HumanReviewStamp[] {
  const seen = new Set<string>();
  return reviews.filter((review) => {
    const identity = `${review.stamped_at}:${JSON.stringify(review.input_digests)}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function exportReviewSession(
  current: PartialCandidate[],
  humanReviews: Record<string, HumanReviewStamp>,
  sessionStartedAt: string,
  now = new Date(),
  humanReviewHistory: Record<string, HumanReviewStamp[]> = {},
): ReviewSession {
  const identities = new Set(current.map(decisionIdentity));
  const items = current.map((candidate): ReviewSessionItem => {
    const identity = decisionIdentity(candidate);
    const human = humanReviews[identity] ?? candidate.human_review ?? null;
    const ai = candidate.ai_review ?? null;
    const currentAi = ai?.status === "complete" && !reviewIsStale(candidate, ai) ? ai : undefined;
    const currentHumanReview = human && !reviewIsStale(candidate, human) ? human : undefined;
    return {
      key: candidate.key, component_id: candidate.component_id, component_shape: candidate.component_shape,
      ai_review: ai, human_review: human,
      ai_review_history: candidate.ai_review_history ?? [],
      human_review_history: uniqueHumanHistory([...(candidate.human_review_history ?? []), ...(humanReviewHistory[identity] ?? [])]),
      ai_state: aiReviewState(candidate),
      human_state: humanReviewState(candidate, human ?? undefined),
      comparison: currentAi && currentHumanReview ? compareReviews(currentAi, currentHumanReview) : null,
    };
  });
  const rendererProblems = new Map<string, RendererProblemGroup>();
  for (const candidate of current) {
    const human = currentHuman(candidate, humanReviews[decisionIdentity(candidate)]);
    if (!human || human.render_quality === "render-good") continue;
    const shape = human.component_shape ?? candidate.component_shape ?? "unknown";
    const group = rendererProblems.get(shape) ?? { component_shape: shape, count: 0, renders: [], notes: [] };
    group.count++;
    if (human.candidate_render) group.renders.push(human.candidate_render);
    if (human.note) group.notes.push(human.note);
    rendererProblems.set(shape, group);
  }
  return {
    orphaned_human_review_history: Object.entries(humanReviewHistory).filter(([identity]) => !identities.has(identity)).map(([identity, human_review_history]) => ({ identity, human_review_history: uniqueHumanHistory(human_review_history) })),
    kind: "partial-component-review-v3", authority: "human-stamp-required", component_only: true,
    session_started_at: sessionStartedAt, exported_at: now.toISOString(), items,
    orphaned_human_reviews: Object.entries(humanReviews).filter(([identity]) => !identities.has(identity)).map(([identity, human_review]) => ({ identity, human_review })),
    summary: summarizeReviews(current, humanReviews, sessionStartedAt, now),
    renderer_problems: [...rendererProblems.values()].sort((left, right) => right.count - left.count || left.component_shape.localeCompare(right.component_shape)),
    calibration: calibrationReport(items),
  };
}

/** Parse v3 review exports and migrate v2 flat human-decision exports. */
export function parseReviewSessionItems(input: unknown): ReviewSessionItem[] {
  const root = record(input, "Review export");
  if (!Array.isArray(root.items)) throw new Error("Review export must contain an items array.");
  if (root.kind === "partial-component-review-v3") {
    return root.items.map((value, index) => {
      const raw = record(value, `items[${index}]`);
      const key = requiredString(raw.key, `items[${index}].key`);
      const componentId = requiredString(raw.component_id, `items[${index}].component_id`);
      const ai = parseAIReview(raw.ai_review, `items[${index}].ai_review`) ?? null;
      const human = parseHumanReview(raw.human_review, `items[${index}].human_review`) ?? null;
      const aiState = raw.ai_state == null ? (ai ? "current" : "absent") : enumValue(raw.ai_state, ["absent", "current", "stale", "failed"] as const, `items[${index}].ai_state`);
      const humanState = raw.human_state == null ? (human ? "current" : "absent") : enumValue(raw.human_state, ["absent", "current", "stale", "failed"] as const, `items[${index}].human_state`);
      return {
        key, component_id: componentId, component_shape: optionalString(raw.component_shape),
        ai_review: ai, human_review: human,
        ai_review_history: Array.isArray(raw.ai_review_history) ? raw.ai_review_history.map((review, historyIndex) => parseAIReview(review, `items[${index}].ai_review_history[${historyIndex}]`)!) : [],
        human_review_history: Array.isArray(raw.human_review_history) ? raw.human_review_history.map((review, historyIndex) => parseHumanReview(review, `items[${index}].human_review_history[${historyIndex}]`)!) : [],
        ai_state: aiState, human_state: humanState,
        comparison: aiState === "current" && humanState === "current" && ai?.status === "complete" && human ? compareReviews(ai, human) : null,
      };
    });
  }
  if (root.kind === "partial-component-review-v2") {
    return root.items.map((value, index) => {
      const raw = record(value, `items[${index}]`);
      return {
        key: requiredString(raw.key, `items[${index}].key`),
        component_id: requiredString(raw.component_id, `items[${index}].component_id`),
        component_shape: optionalString(raw.component_shape),
        ai_review: null, human_review: parseHumanReview(raw, `items[${index}]`) ?? null,
        ai_review_history: [], human_review_history: [],
        ai_state: "absent", human_state: "current", comparison: null,
      };
    });
  }
  throw new Error("Unsupported review export kind.");
}

/** Migrate one v2 flat human decision into the explicit v3 stamp. */
export function migrateLegacyHumanReview(value: unknown): HumanReviewStamp {
  return parseHumanReview(value, "legacy human review")!;
}
