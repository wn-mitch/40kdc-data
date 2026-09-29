import type { DatabaseSync } from "node:sqlite";

import { mapWithConcurrency } from "./concurrency.js";
import { deepseekModelCall, DEEPSEEK_MODEL, DEEPSEEK_PRICE_SOURCE, type DeepSeekReasoningEffort, type DeepSeekUsage, type ModelCall } from "./leaf-proposals-llm.js";
import { runLuna, type LunaRunView } from "./luna-run.js";
import { DEFAULT_OUTPUT_BUDGET_TOKENS, prepareLuna, type PreparedLuna } from "./proposal.js";

/** A "stopped with length" transport failure: the reply was truncated before finishing its JSON. */
const LENGTH_STOP_PATTERN = /stopped with length/iu;

/**
 * The DeepSeek arm of the pilot: the real prepare-luna / run-luna / import-luna flow (see
 * `luna-run.ts`'s `transport: "deepseek"`), scoped to one pilot sample's ability versions, capped
 * on both request count and real spend. `LunaRunView`/`model_runs` don't carry DeepSeek's raw
 * usage breakdown (only `cost_usd`), so this wraps `deepseekModelCall` to capture it as a side
 * effect at the point of the actual HTTP reply, via `LunaRunOptions.deepseekCall`.
 */

export type DeepSeekRunLog = {
  run_id: string;
  state: LunaRunView["state"];
  ability_version_ids: number[];
  model: string;
  cost_usd: number | null;
  latency_ms: number | null;
  usage: DeepSeekUsage | null;
  summary: LunaRunView["summary"];
  failure: LunaRunView["failure"];
};

export type DeepSeekArmResult = {
  max_requests: number;
  spend_cap_usd: number;
  price_source: string;
  requests: number;
  total_cost_usd: number;
  usage_totals: DeepSeekUsage;
  budget_exhausted: boolean;
  runs: DeepSeekRunLog[];
};

export type DeepSeekPilotOptions = {
  maxRequests?: number;
  spendCapUsd?: number;
  /** Abilities requested per DeepSeek call, subject to the same output-budget cap as `prepareLuna`. */
  abilitiesPerRequest?: number;
  /** Forwarded to `prepareLuna`'s `outputBudgetTokens`; defaults to `DEFAULT_OUTPUT_BUDGET_TOKENS`. */
  outputBudgetTokens?: number;
  /** Test injection point for the transport call, mirroring `LunaRunOptions.deepseekCall`. */
  deepseekCall?: ModelCall;
  /** Requests in flight at once, via `mapWithConcurrency`. */
  concurrency?: number;
  /** DeepSeek model id, e.g. `DEEPSEEK_MODEL` (v4-pro) or `DEEPSEEK_FLASH_MODEL`. */
  model?: string;
  /** Forwarded to `deepseekModelCall`'s `maxTokens`. */
  maxTokens?: number;
  /** `reasoning_effort` sent on every request, when set. */
  reasoningEffort?: DeepSeekReasoningEffort;
};

/**
 * `abilitiesPerRequest` defaults to 2: at 15 abilities per request the DeepSeek transport
 * overflowed its 32,768-token output limit, while 2 completed reliably (see the pilot report).
 * `outputBudgetTokens` still caps the actual batch below this count for any unusually large
 * ability text.
 */
const DEFAULT_OPTIONS: Required<Omit<DeepSeekPilotOptions, "deepseekCall" | "model" | "maxTokens" | "reasoningEffort">> = {
  maxRequests: 12,
  spendCapUsd: 3,
  abilitiesPerRequest: 2,
  outputBudgetTokens: DEFAULT_OUTPUT_BUDGET_TOKENS,
  concurrency: 1,
};

const emptyUsage = (): DeepSeekUsage => ({ prompt_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0, completion_tokens: 0, reasoning_tokens: 0 });

/**
 * Run the DeepSeek transport over a pilot sample's residue, up to `maxRequests` prepared
 * requests or `spendCapUsd` of real cost, whichever comes first. Uses `db` for `prepareLuna` and
 * `openDb` — a fresh-connection factory, since `runLuna` opens and closes its own connections per
 * stage — for every actual transport call. Deliberately does NOT precompute one coverage snapshot
 * for the whole run and reuse it across slots the way `prepareLuna`'s own `coverage` option
 * invites: this loop prepares, runs, and imports a request within each slot, so annotations and
 * proposals change between slots (and even more so across concurrent slots) — a stale snapshot
 * would keep candidate selection blind to what earlier slots just imported, risking the same
 * exhausted-but-still-"residue" abilities being re-selected via `prepareLuna`'s own
 * completed-candidates fallback. Each `prepareLuna` call here gets its own fresh read instead.
 */
export async function runDeepSeekArm(
  db: DatabaseSync, openDb: () => DatabaseSync, abilityVersionIds: ReadonlySet<number>, options: DeepSeekPilotOptions = {},
): Promise<DeepSeekArmResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const usageTotals = emptyUsage();
  let totalCost = 0;
  let budgetExhausted = false;
  let noMoreCandidates = false;
  const baseCall = options.deepseekCall ?? deepseekModelCall(options.model ?? DEEPSEEK_MODEL, options.maxTokens, options.reasoningEffort);

  /** Runs one already-prepared request and folds its usage/cost into the shared totals. */
  async function runOnePreparedRequest(prepared: PreparedLuna): Promise<DeepSeekRunLog> {
    // The request sent to the model carries faction_id/ability_id/source_hash, not the internal
    // ability_version_id — that only lives in the run's own config (`request_abilities`).
    const requestAbilities = (db.prepare("SELECT config_json FROM model_runs WHERE id = ?").get(Number(prepared.run_id)) as { config_json: string })
      .config_json;
    const abilityVersionIdsForRun = (JSON.parse(requestAbilities) as { request_abilities: Array<{ ability_version_id: number }> })
      .request_abilities.map((item) => item.ability_version_id);
    const captured: { usage: DeepSeekUsage | null; latencyMs: number | null; costUsd: number | null } = { usage: null, latencyMs: null, costUsd: null };
    const view = await runLuna(openDb, prepared.run_id, {
      transport: "deepseek",
      deepseekModel: options.model ?? DEEPSEEK_MODEL,
      deepseekCall: async (instructions, requestText) => {
        const reply = await baseCall(instructions, requestText);
        captured.usage = reply.usage ?? null;
        captured.latencyMs = reply.latency_ms;
        // Priced against whatever model actually answered (deepseekModelCall already resolves
        // this correctly per-model); recomputing here without the model would silently default
        // to deepseek-v4-pro's price table even for a deepseek-flash reply.
        captured.costUsd = reply.cost_usd;
        return reply;
      },
    });
    const costUsd = captured.costUsd;
    // Synchronous updates after the only await in this function: safe against the other
    // concurrent slots, which cannot interleave with this code between awaits.
    if (captured.usage) {
      usageTotals.prompt_tokens += captured.usage.prompt_tokens;
      usageTotals.prompt_cache_hit_tokens += captured.usage.prompt_cache_hit_tokens;
      usageTotals.prompt_cache_miss_tokens += captured.usage.prompt_cache_miss_tokens;
      usageTotals.completion_tokens += captured.usage.completion_tokens;
      usageTotals.reasoning_tokens = (usageTotals.reasoning_tokens ?? 0) + (captured.usage.reasoning_tokens ?? 0);
    }
    if (costUsd !== null) totalCost += costUsd;
    if (totalCost >= opts.spendCapUsd) budgetExhausted = true;
    return {
      run_id: prepared.run_id, state: view.state,
      ability_version_ids: abilityVersionIdsForRun,
      model: view.model, cost_usd: costUsd, latency_ms: captured.latencyMs, usage: captured.usage, summary: view.summary, failure: view.failure,
    };
  }

  /**
   * One prepared-and-run request, plus — on a length-stop failure over more than one ability —
   * one retry of that same batch split into single-ability requests, so a batch that overflowed
   * the output budget still yields whatever of its abilities individually fit. This only ever
   * fires once per original batch: it's driven by that one failure, not by re-checking its own
   * retries for further length-stops. (`prepareLuna`'s own `ability_version_id` scoping, not
   * `retry_of`, selects each singleton — `retry_of` allows only one retry run per failed run
   * total, which doesn't fit fanning one failed batch out into several singleton requests.)
   * Returns an empty array when this slot found nothing to do (the spend cap was already hit, or
   * `prepareLuna` had no more sample candidates left). `prepareLuna` itself is synchronous and
   * transactional, so concurrent slots never race over which abilities each one claims — only the
   * actual transport call (the `await runLuna`) overlaps between slots.
   */
  async function runOneSlot(): Promise<DeepSeekRunLog[]> {
    if (budgetExhausted || noMoreCandidates) return [];
    let prepared: PreparedLuna;
    try {
      prepared = prepareLuna(db, {
        mode: "residue",
        limit: opts.abilitiesPerRequest,
        abilityVersionIds,
        outputBudgetTokens: opts.outputBudgetTokens,
      });
    } catch (error) {
      if (error instanceof RangeError) { noMoreCandidates = true; return []; } // no more candidates in the sample
      throw error;
    }
    const result = await runOnePreparedRequest(prepared);
    // Only a transport failure (the reply itself never finished) is worth retrying split into
    // singles. An INVALID_RESPONSE import rejection means the model answered in full and the
    // answer was wrong for at least one span; resending the identical batch just wastes spend on
    // the same mistake, and per-span import now already keeps every other span in that response.
    const isRetriableLengthStop = result.state === "failed"
      && result.failure?.stage === "transport"
      && LENGTH_STOP_PATTERN.test(result.failure.message);
    if (!isRetriableLengthStop || result.ability_version_ids.length <= 1) {
      return [result];
    }
    const retryResults: DeepSeekRunLog[] = [result];
    for (const abilityVersionId of result.ability_version_ids) {
      if (budgetExhausted) break;
      let singleton: PreparedLuna;
      try {
        singleton = prepareLuna(db, { ability_version_id: abilityVersionId, outputBudgetTokens: opts.outputBudgetTokens });
      } catch {
        continue; // this one ability no longer has unclaimed uncovered source; nothing to retry
      }
      retryResults.push(await runOnePreparedRequest(singleton));
    }
    return retryResults;
  }

  const slots = Array.from({ length: opts.maxRequests }, (_, index) => index);
  const results = await mapWithConcurrency(slots, opts.concurrency, () => runOneSlot());
  const runs = results.flat();

  return {
    max_requests: opts.maxRequests, spend_cap_usd: opts.spendCapUsd, price_source: DEEPSEEK_PRICE_SOURCE,
    requests: runs.length, total_cost_usd: totalCost, usage_totals: usageTotals, budget_exhausted: budgetExhausted, runs,
  };
}
