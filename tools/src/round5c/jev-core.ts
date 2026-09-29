import { TypeSafeClient, choice, noul, type ChoiceCriteria, type JsonValue, type Questions, type SystemOneResult } from "@typesafe-ai/sdk";

import { cacheKeyFor, getCachedAnswer, putCachedAnswer, type JevCache } from "./jev-cache.js";

/**
 * Shared plumbing for both Jev proposer arms (v1: role-then-family over every active family; v2:
 * a single narrowed choice per piece, seeded by segmentation against decided surfaces) — the
 * TypeSafe client shape, request/cost accounting, the answer cache, and the two question-asking
 * primitives. Mirrors `round4/jev.ts`'s client/cost/usage shape.
 *
 * Concurrency and spend-cap exactness: callers may fire many `askChoice`/`askYesNo` calls
 * concurrently (see `concurrency.ts`'s `mapWithConcurrency`). To keep the cap exact under that —
 * rather than merely "probably close" — every request reserves a conservative worst-case cost
 * against the cap *before* it is sent (`JevBudget.tryReserve`, synchronous, so concurrent callers
 * can never jointly over-admit) and settles to the real cost once the response is in
 * (`JevBudget.settle`) or releases the reservation on failure (`JevBudget.releaseReservation`).
 */

export const JEV_MODEL = "jev-latest";
/** Matches round4/jev.ts's derived-cost convention; no separate published price for this pilot. */
export const JEV_INPUT_PRICE_PER_MILLION_USD = 0.042;
export const NONE_OF_THESE = "none-of-these";
/** No published TypeSafe rate limit is documented in the SDK or its README; this is a
 * conservative default, not a measured ceiling — errors/timeouts still retry with backoff, so an
 * over-eager value degrades gracefully rather than corrupting results. */
export const DEFAULT_JEV_CONCURRENCY = 16;

/** The `systemOne` shape this module needs — a real `TypeSafeClient` or a test double. */
export type JevClient = { systemOne: TypeSafeClient["systemOne"] };

export type JevRequestKind = "role" | "family" | "parameter";

export type JevRequestLog = {
  span_key: string;
  kind: JevRequestKind;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  /** True when this "request" was actually a cache hit — no network call was made. */
  cached: boolean;
  /** Network attempts made (0 for a cache hit or a budget-skip; >1 means a retry fired). */
  attempts: number;
};

const RETRY_ATTEMPTS = 3; // 1 initial + 2 retries, per the "bounded retry (2 attempts, backoff)" ask
const RETRY_BACKOFF_MS = [300, 900];

export class JevBudget {
  totalCostUsd = 0;
  totalInputTokens = 0;
  totalOutputTokens = 0;
  totalLatencyMs = 0;
  /** Real network requests only — a cache hit is deliberately not counted here (see `cacheHits`),
   * since "no request" is the point of the cache. */
  requests = 0;
  cacheHits = 0;
  private reservedUsd = 0;
  readonly log: JevRequestLog[] = [];
  constructor(private readonly capUsd: number) {}

  private get committedUsd(): number {
    return this.totalCostUsd + this.reservedUsd;
  }

  /** Set once a reservation is refused: the cap cannot admit even the next request. */
  private refused = false;

  exhausted(): boolean {
    return this.refused || this.committedUsd >= this.capUsd;
  }

  /** Synchronous admission control. Must run with no `await` between the check and the reserve
   * (it does) so concurrent callers can never collectively reserve past the cap: JS's single
   * thread guarantees no other call can observe `committedUsd` between the read and the write. */
  tryReserve(estimateUsd: number): boolean {
    if (this.committedUsd + estimateUsd > this.capUsd) {
      this.refused = true;
      return false;
    }
    this.reservedUsd += estimateUsd;
    return true;
  }

  /** A successful request: release its reservation and record the real cost/usage. */
  settle(reservedUsd: number, spanKey: string, kind: JevRequestKind, usage: { input_tokens: number; output_tokens: number }, latencyMs: number, attempts: number): number {
    this.reservedUsd = Math.max(0, this.reservedUsd - reservedUsd);
    const cost = (usage.input_tokens / 1_000_000) * JEV_INPUT_PRICE_PER_MILLION_USD;
    this.totalCostUsd += cost;
    this.totalInputTokens += usage.input_tokens;
    this.totalOutputTokens += usage.output_tokens;
    this.totalLatencyMs += latencyMs;
    this.requests += 1;
    this.log.push({ span_key: spanKey, kind, cost_usd: cost, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, latency_ms: latencyMs, cached: false, attempts });
    return cost;
  }

  /** Every retry attempt failed: free the reservation, spend nothing, log it as unanswered. */
  releaseReservation(reservedUsd: number, spanKey: string, kind: JevRequestKind, latencyMs: number, attempts: number): void {
    this.reservedUsd = Math.max(0, this.reservedUsd - reservedUsd);
    this.log.push({ span_key: spanKey, kind, cost_usd: 0, input_tokens: 0, output_tokens: 0, latency_ms: latencyMs, cached: false, attempts });
  }

  recordCacheHit(spanKey: string, kind: JevRequestKind): void {
    this.cacheHits += 1;
    this.log.push({ span_key: spanKey, kind, cost_usd: 0, input_tokens: 0, output_tokens: 0, latency_ms: 0, cached: true, attempts: 0 });
  }
}

/** A conservative (over-, never under-) estimate of a request's cost, used only to reserve room
 * against the cap before the real token count is known. Cost is priced on input tokens only (see
 * `JevBudget.settle`), so this estimates input size from the serialized request body: ~3 chars per
 * token is a safe floor for English JSON (real average is closer to 4), plus a fixed margin for
 * whatever fixed system-prompt overhead the request doesn't itself carry. */
export function estimateWorstCaseCostUsd(state: Record<string, JsonValue>, questions: Questions): number {
  const approxChars = JSON.stringify({ state, questions }).length;
  const approxTokens = Math.ceil(approxChars / 3) + 200;
  return (approxTokens / 1_000_000) * JEV_INPUT_PRICE_PER_MILLION_USD;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<{ value: T; attempts: number } | { error: unknown; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return { value: await fn(), attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1] ?? 900));
    }
  }
  return { error: lastError, attempts: RETRY_ATTEMPTS };
}

/** The shared request path: cache lookup, reserve, retry-with-backoff, settle/release, cache
 * write. Returns `null` for a cache miss the caller can't afford (budget exhausted) or that never
 * got a usable answer (every retry failed, or the model returned something unexpected). */
async function performRequest(
  client: JevClient, timeoutMs: number, budget: JevBudget, spanKey: string, kind: JevRequestKind,
  state: Record<string, JsonValue>, questions: Questions, cache: JevCache | undefined,
): Promise<SystemOneResult<Questions> | null> {
  const cacheKey = cache ? cacheKeyFor(JEV_MODEL, state, questions) : null;
  if (cache && cacheKey) {
    const cached = getCachedAnswer(cache, cacheKey);
    if (cached) {
      budget.recordCacheHit(spanKey, kind);
      return cached;
    }
  }

  const estimate = estimateWorstCaseCostUsd(state, questions);
  if (!budget.tryReserve(estimate)) return null; // skipped-budget: no network call, no reservation held

  const started = performance.now();
  const outcome = await withRetry(() => client.systemOne({ state, questions, model: JEV_MODEL }, { timeout: timeoutMs, retry: { maxRetries: 0 } }));
  const latency = Math.round(performance.now() - started);

  if ("error" in outcome) {
    // A transient failure (timeout, network hiccup) surviving the retries is not a reason to
    // abort a multi-hour, capped, real-money run and lose every prior round's progress — it's
    // logged at zero cost and treated as an unanswered question, same as the model declining.
    budget.releaseReservation(estimate, spanKey, kind, latency, outcome.attempts);
    return null;
  }

  budget.settle(estimate, spanKey, kind, outcome.value.usage, latency, outcome.attempts);
  if (cache && cacheKey) putCachedAnswer(cache, cacheKey, JEV_MODEL, outcome.value);
  return outcome.value;
}

export async function askChoice(
  client: JevClient, timeoutMs: number, budget: JevBudget, spanKey: string, kind: JevRequestKind,
  state: Record<string, JsonValue>, prompt: string, criteria: ChoiceCriteria, cache?: JevCache,
): Promise<{ selected: string; confidence: number } | null> {
  const questions: Questions = { answer: choice(prompt, criteria) };
  const result = await performRequest(client, timeoutMs, budget, spanKey, kind, state, questions, cache);
  if (!result) return null;
  const answer = result.answers.answer;
  if (!answer || answer.type !== "choice") return null;
  return { selected: answer.choice, confidence: answer.confidence };
}

export async function askYesNo(
  client: JevClient, timeoutMs: number, budget: JevBudget, spanKey: string,
  state: Record<string, JsonValue>, prompt: string, cache?: JevCache,
): Promise<{ value: boolean; confidence: number } | null> {
  const questions: Questions = { answer: noul(prompt) };
  const result = await performRequest(client, timeoutMs, budget, spanKey, "parameter", state, questions, cache);
  if (!result) return null;
  const answer = result.answers.answer;
  if (!answer || answer.type !== "noul") return null;
  const confidence = Math.max(answer.noul, 1 - answer.noul);
  return { value: answer.noul >= 0.5, confidence };
}

/** A closed-enum criteria map for the given values, each self-labelled, plus "none of these". */
export function enumCriteria(values: readonly string[], describe: (value: string) => string | null = () => null): ChoiceCriteria {
  const criteria: ChoiceCriteria = {};
  for (const value of values) criteria[value] = describe(value);
  criteria[NONE_OF_THESE] = "None of the listed options describe this.";
  return criteria;
}

/** Trim descriptive text to keep the per-request state small. */
export const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function buildTypeSafeClient(): TypeSafeClient {
  if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is required for the Jev proposer.");
  return new TypeSafeClient({ logLevel: "off", retry: { maxRetries: 0 }, timeout: 60_000 });
}
