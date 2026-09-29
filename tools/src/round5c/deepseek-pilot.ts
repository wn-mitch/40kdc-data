import type { DatabaseSync } from "node:sqlite";

import { getCurrentCoverage } from "./coverage.js";
import { deepseekCostUsd, deepseekModelCall, DEEPSEEK_MODEL, DEEPSEEK_PRICE_SOURCE, type DeepSeekUsage } from "./leaf-proposals-llm.js";
import { runLuna, type LunaRunView } from "./luna-run.js";
import { prepareLuna } from "./proposal.js";

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

export type DeepSeekPilotOptions = { maxRequests?: number; spendCapUsd?: number };

const DEFAULT_OPTIONS: Required<DeepSeekPilotOptions> = { maxRequests: 12, spendCapUsd: 3 };

const emptyUsage = (): DeepSeekUsage => ({ prompt_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0, completion_tokens: 0 });

/**
 * Run the DeepSeek transport over a pilot sample's residue, up to `maxRequests` prepared
 * requests or `spendCapUsd` of real cost, whichever comes first. Uses `db` for `prepareLuna`
 * (one coverage snapshot for the whole batch, per `PrepareLunaOptions.coverage`) and `openDb` — a
 * fresh-connection factory, since `runLuna` opens and closes its own connections per stage — for
 * every actual transport call.
 */
export async function runDeepSeekArm(
  db: DatabaseSync, openDb: () => DatabaseSync, abilityVersionIds: ReadonlySet<number>, options: DeepSeekPilotOptions = {},
): Promise<DeepSeekArmResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const coverage = getCurrentCoverage(db);
  const runs: DeepSeekRunLog[] = [];
  const usageTotals = emptyUsage();
  let totalCost = 0;
  let budgetExhausted = false;
  const baseCall = deepseekModelCall(DEEPSEEK_MODEL);

  for (let requestIndex = 0; requestIndex < opts.maxRequests; requestIndex += 1) {
    if (totalCost >= opts.spendCapUsd) { budgetExhausted = true; break; }
    let prepared;
    try {
      prepared = prepareLuna(db, { mode: "residue", limit: 15, abilityVersionIds, coverage });
    } catch (error) {
      if (error instanceof RangeError) break; // no more candidates in the sample
      throw error;
    }
    // The request sent to the model carries faction_id/ability_id/source_hash, not the internal
    // ability_version_id — that only lives in the run's own config (`request_abilities`).
    const requestAbilities = (db.prepare("SELECT config_json FROM model_runs WHERE id = ?").get(Number(prepared.run_id)) as { config_json: string })
      .config_json;
    const abilityVersionIdsForRun = (JSON.parse(requestAbilities) as { request_abilities: Array<{ ability_version_id: number }> })
      .request_abilities.map((item) => item.ability_version_id);
    const captured: { usage: DeepSeekUsage | null; latencyMs: number | null } = { usage: null, latencyMs: null };
    const view = await runLuna(openDb, prepared.run_id, {
      transport: "deepseek",
      deepseekCall: async (instructions, requestText) => {
        const reply = await baseCall(instructions, requestText);
        captured.usage = reply.usage ?? null;
        captured.latencyMs = reply.latency_ms;
        return reply;
      },
    });
    if (captured.usage) {
      usageTotals.prompt_tokens += captured.usage.prompt_tokens;
      usageTotals.prompt_cache_hit_tokens += captured.usage.prompt_cache_hit_tokens;
      usageTotals.prompt_cache_miss_tokens += captured.usage.prompt_cache_miss_tokens;
      usageTotals.completion_tokens += captured.usage.completion_tokens;
    }
    const costUsd = captured.usage ? deepseekCostUsd(captured.usage) : null;
    if (costUsd !== null) totalCost += costUsd;
    runs.push({
      run_id: prepared.run_id, state: view.state,
      ability_version_ids: abilityVersionIdsForRun,
      model: view.model, cost_usd: costUsd, latency_ms: captured.latencyMs, usage: captured.usage, summary: view.summary, failure: view.failure,
    });
  }

  return {
    max_requests: opts.maxRequests, spend_cap_usd: opts.spendCapUsd, price_source: DEEPSEEK_PRICE_SOURCE,
    requests: runs.length, total_cost_usd: totalCost, usage_totals: usageTotals, budget_exhausted: budgetExhausted, runs,
  };
}
