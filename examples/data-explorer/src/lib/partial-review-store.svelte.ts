import {
  aiReviewState,
  createHumanStamp,
  decisionIdentity,
  draftFromAI,
  draftFromHuman,
  humanReviewState,
  matchesQueue,
  migrateLegacyHumanReview,
  summarizeReviews,
  type DraftDecision,
  type HumanReviewStamp,
  type PartialCandidate,
  type ReviewMode,
  type ReviewQueue,
} from "./partial-review.js";

const LS_HUMAN_KEY = "data-explorer:partial-component-human-stamps:v3";
const LS_LEGACY_KEY = "data-explorer:partial-component-reviews:v2";
const LS_HUMAN_HISTORY_KEY = "data-explorer:partial-component-human-stamp-history:v3";
const LS_SESSION_KEY = "data-explorer:partial-component-review-session:v3";
const LS_LEGACY_SESSION_KEY = "data-explorer:partial-component-review-session:v2";
const LS_REVIEWER_KEY = "data-explorer:partial-component-human-reviewer:v3";
const LS_MODE_KEY = "data-explorer:partial-component-review-mode:v3";

function loadHumanReviews(): Record<string, HumanReviewStamp> {
  if (typeof localStorage === "undefined") return {};
  try {
    const current = JSON.parse(localStorage.getItem(LS_HUMAN_KEY) ?? "{}");
    if (current && typeof current === "object" && !Array.isArray(current)) return current as Record<string, HumanReviewStamp>;
  } catch {
    // Try the v2 migration path below.
  }
  try {
    const legacy = JSON.parse(localStorage.getItem(LS_LEGACY_KEY) ?? "{}");
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return {};
    return Object.fromEntries(Object.entries(legacy).map(([identity, review]) => [identity, migrateLegacyHumanReview(review)]));
  } catch {
    return {};
  }
}

function loadHumanReviewHistory(): Record<string, HumanReviewStamp[]> {
  if (typeof localStorage === "undefined") return {};
  try {
    const value = JSON.parse(localStorage.getItem(LS_HUMAN_HISTORY_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, reviews]) => Array.isArray(reviews))) as Record<string, HumanReviewStamp[]>;
  } catch {
    return {};
  }
}

function mergeHumanHistory(...groups: HumanReviewStamp[][]): HumanReviewStamp[] {
  const reviews = new Map<string, HumanReviewStamp>();
  for (const review of groups.flat()) {
    const identity = `${review.stamped_at}:${JSON.stringify(review.input_digests)}`;
    if (!reviews.has(identity)) reviews.set(identity, review);
  }
  return [...reviews.values()];
}

function loadSessionStart(): string {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(LS_SESSION_KEY) ?? localStorage.getItem(LS_LEGACY_SESSION_KEY);
      if (saved) return saved;
    }
  } catch {
    // Session timing can continue in memory when storage is unavailable.
  }
  return new Date().toISOString();
}

function loadReviewerId(): string {
  try {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(LS_REVIEWER_KEY)?.trim() : "";
    return saved || "human-reviewer";
  } catch {
    return "human-reviewer";
  }
}

function loadReviewMode(): ReviewMode {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(LS_MODE_KEY) === "assisted" ? "assisted" : "blind";
  } catch {
    return "blind";
  }
}

class PartialReviewStore {
  candidates = $state<PartialCandidate[]>([]);
  humanReviews = $state<Record<string, HumanReviewStamp>>(loadHumanReviews());
  humanReviewHistory = $state<Record<string, HumanReviewStamp[]>>(loadHumanReviewHistory());
  index = $state(0);
  queue = $state<ReviewQueue>("all");
  reviewerId = $state(loadReviewerId());
  reviewMode = $state<ReviewMode>(loadReviewMode());
  openedAt = $state<string | null>(null);
  sessionStartedAt = $state(loadSessionStart());

  constructor() {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(LS_SESSION_KEY, this.sessionStartedAt);
    } catch {
      // Non-fatal.
    }
  }

  load(candidates: PartialCandidate[]): void {
    const embedded = Object.fromEntries(candidates.filter((candidate) => candidate.human_review).map((candidate) => [decisionIdentity(candidate), candidate.human_review!]));
    const mergedHistory = { ...this.humanReviewHistory };
    for (const candidate of candidates) {
      if (!candidate.human_review_history?.length) continue;
      const identity = decisionIdentity(candidate);
      mergedHistory[identity] = mergeHumanHistory(candidate.human_review_history, mergedHistory[identity] ?? []);
    }
    this.humanReviews = { ...embedded, ...this.humanReviews };
    this.humanReviewHistory = mergedHistory;
    this.candidates = candidates;
    this.index = 0;
    this.markOpened();
    this.persist();
  }

  visibleCandidates(): PartialCandidate[] {
    return this.candidates.filter((candidate) => matchesQueue(candidate, this.humanReviews[decisionIdentity(candidate)], this.queue));
  }

  current(): PartialCandidate | undefined {
    return this.visibleCandidates()[this.index];
  }

  humanReview(candidate: PartialCandidate): HumanReviewStamp | undefined {
    return this.humanReviews[decisionIdentity(candidate)] ?? candidate.human_review;
  }

  currentHumanReview(candidate = this.current()): HumanReviewStamp | undefined {
    if (!candidate) return undefined;
    const review = this.humanReview(candidate);
    return humanReviewState(candidate, review) === "current" ? review : undefined;
  }

  staleHumanReview(candidate = this.current()): HumanReviewStamp | undefined {
    if (!candidate) return undefined;
    const review = this.humanReview(candidate);
    return review && humanReviewState(candidate, review) === "stale" ? review : undefined;
  }

  setQueue(queue: ReviewQueue): void {
    this.queue = queue;
    this.index = 0;
    this.markOpened();
  }

  setReviewMode(mode: ReviewMode): void {
    this.reviewMode = mode;
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(LS_MODE_KEY, mode);
    } catch {
      // The explicit mode still applies for this session.
    }
  }

  setReviewerId(value: string): void {
    this.reviewerId = value.trim() || "human-reviewer";
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(LS_REVIEWER_KEY, this.reviewerId);
    } catch {
      // The reviewer identity still applies for this session.
    }
  }

  summary() {
    return summarizeReviews(this.candidates, this.humanReviews, this.sessionStartedAt);
  }

  staleCounts(): { ai: number; human: number } {
    return this.candidates.reduce((counts, candidate) => {
      if (aiReviewState(candidate) === "stale") counts.ai++;
      if (humanReviewState(candidate, this.humanReview(candidate)) === "stale") counts.human++;
      return counts;
    }, { ai: 0, human: 0 });
  }

  draft(candidate = this.current()): DraftDecision {
    return draftFromHuman(candidate ? this.currentHumanReview(candidate) : undefined);
  }

  suggestedDraft(candidate = this.current()): DraftDecision | undefined {
    if (!candidate || aiReviewState(candidate) !== "current" || candidate.ai_review?.status !== "complete") return undefined;
    return draftFromAI(candidate.ai_review);
  }

  save(candidate: PartialCandidate, draft: DraftDecision, decidedAt = new Date()): HumanReviewStamp {
    const openedAt = this.openedAt ?? decidedAt.toISOString();
    const stamp = createHumanStamp(candidate, draft, this.reviewMode, openedAt, decidedAt, this.reviewerId);
    const identity = decisionIdentity(candidate);
    const previous = this.humanReviews[identity] ?? candidate.human_review;
    if (previous && previous.stamped_at !== stamp.stamped_at) {
      const history = this.humanReviewHistory[identity] ?? [];
      this.humanReviewHistory = { ...this.humanReviewHistory, [identity]: mergeHumanHistory(history, [previous]) };
    }
    this.humanReviews = { ...this.humanReviews, [identity]: stamp };
    this.persist();
    return stamp;
  }

  stampAsSuggested(candidate: PartialCandidate, decidedAt = new Date()): HumanReviewStamp {
    const suggested = this.suggestedDraft(candidate);
    if (!suggested) throw new Error("A current, complete AI suggestion is required before it can be stamped.");
    return this.save(candidate, suggested, decidedAt);
  }

  next(): void {
    const visible = this.visibleCandidates();
    if (this.index < visible.length - 1) this.index++;
    this.markOpened();
  }

  previous(): void {
    if (this.index > 0) this.index--;
    this.markOpened();
  }

  markOpened(now = new Date()): void {
    this.openedAt = this.current() ? now.toISOString() : null;
  }

  clear(): void {
    this.candidates = [];
    this.index = 0;
    this.openedAt = null;
  }

  private persist(): void {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(LS_HUMAN_KEY, JSON.stringify(this.humanReviews));
        localStorage.setItem(LS_HUMAN_HISTORY_KEY, JSON.stringify(this.humanReviewHistory));
      }
    } catch {
      // Export remains available even when persistence is unavailable.
    }
  }
}

export const partialReview = new PartialReviewStore();
export type { DraftDecision } from "./partial-review.js";
