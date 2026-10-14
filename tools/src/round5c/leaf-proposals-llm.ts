import { existsSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { hashJson } from "../round4/hash.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "./contracts.js";
import { withTransaction } from "./db.js";
import { leafBoard, leafSurface } from "./leaves.js";
import type { ProposalPiece, UnnamedPiece } from "./leaf-proposals.js";

/**
 * The model's (DeepSeek's) turn at clusters the nearest-neighbour vote could not name. It sees the reviewed
 * families (with their parameter schemas), a few decided spellings of each as examples, and the
 * wording of each cluster, and answers with pieces and leaves. Nothing it says is trusted: a
 * piece must be a contiguous part of its wording and its parameters must validate, or it is
 * dropped with the reason. Accepted answers become ordinary proposals for the reviewer.
 */

export const LEAF_PROPOSAL_PROMPT_VERSION = "leaf-proposals-v1";
const CLUSTERS_PER_CALL = 10;
const MEMBERS_PER_CLUSTER = 8;
const EXAMPLES_PER_FAMILY = 3;

/** DeepSeek's own reported token accounting for one chat completion. */
export type DeepSeekUsage = {
  prompt_tokens: number; prompt_cache_hit_tokens: number; prompt_cache_miss_tokens: number; completion_tokens: number;
  /** From `usage.completion_tokens_details.reasoning_tokens` when DeepSeek reports it; already included in `completion_tokens` (and so already billed as output). Informational only. */
  reasoning_tokens?: number;
};
export type ModelReply = {
  body: Record<string, unknown>; model: string; model_version: string; cost_usd: number | null; latency_ms: number | null;
  /** Present only for a DeepSeek reply; other model transports leave it unset. */
  usage?: DeepSeekUsage;
};
/** One model call: instructions as the system prompt, the request as the user message. */
export type ModelCall = (instructions: string, request: string) => Promise<ModelReply>;

/**
 * DeepSeek's published off-peak per-million-token prices, as of 2026-09-29:
 * https://api-docs.deepseek.com/quick_start/pricing. Peak hours (01:00-04:00 and 06:00-10:00
 * UTC, Mon-Fri) double every price; this always reports the off-peak rate and says so, rather
 * than silently mis-costing a peak call.
 */
export const DEEPSEEK_PRICE_SOURCE = "https://api-docs.deepseek.com/quick_start/pricing (off-peak, read 2026-09-29)";
const DEEPSEEK_PRICE_PER_MILLION_USD: Record<string, { cacheHitInput: number; cacheMissInput: number; output: number }> = {
  "deepseek-v4-pro": { cacheHitInput: 0.022, cacheMissInput: 0.66, output: 1.98 },
  "deepseek-flash": { cacheHitInput: 0.003, cacheMissInput: 0.15, output: 0.6 },
};

/**
 * A DeepSeek call that billed (or may have billed) without a usable answer: a truncated reply, an
 * HTTP error after the model ran, invalid JSON, or a timeout. Carries whatever accounting the API
 * returned, so the run records its real cost; a timeout's cost is unknown, never zero.
 */
export class DeepSeekCallError extends Error {
  constructor(
    message: string,
    readonly accounting: { usage: DeepSeekUsage | null; cost_usd: number | null; latency_ms: number; cost_unknown: boolean },
  ) {
    super(message);
    this.name = "DeepSeekCallError";
  }
}

/**
 * The most one request can cost: every request byte priced as an uncached input token (~3 bytes
 * per token is a floor for JSON-heavy English) plus the full `maxTokens` of output. Reserved
 * against a spend cap before the request is sent, so concurrent requests cannot overshoot it.
 */
export function deepseekReservationUsd(requestBytes: number, maxTokens: number, model: string = DEEPSEEK_MODEL): number {
  const price = DEEPSEEK_PRICE_PER_MILLION_USD[model] ?? DEEPSEEK_PRICE_PER_MILLION_USD[DEEPSEEK_MODEL]!;
  return (Math.ceil(requestBytes / 3) / 1_000_000) * price.cacheMissInput + (maxTokens / 1_000_000) * price.output;
}

/** Cost of one DeepSeek reply from its own usage accounting, at the off-peak published prices. */
export function deepseekCostUsd(usage: DeepSeekUsage, model: string = DEEPSEEK_MODEL): number {
  const price = DEEPSEEK_PRICE_PER_MILLION_USD[model] ?? DEEPSEEK_PRICE_PER_MILLION_USD[DEEPSEEK_MODEL]!;
  return (usage.prompt_cache_hit_tokens / 1_000_000) * price.cacheHitInput
    + (usage.prompt_cache_miss_tokens / 1_000_000) * price.cacheMissInput
    + (usage.completion_tokens / 1_000_000) * price.output;
}

export const LEAF_PROPOSAL_INSTRUCTIONS = [
  "You label Warhammer 40,000 rules wording with leaves. A leaf is one meaning from the listed families: an EFFECT (what changes), a CONDITION (when it applies), an EVENT (when it fires), a DURATION, a RESTRICTION, or a COMBINATOR.",
  "For each wording, divide it into contiguous pieces, each carrying exactly one meaning, and give each piece a family_id and parameters. Copy each piece's text exactly from the wording. Joining words (and, as well, then) belong to no piece.",
  "Use only the listed families and versions. Parameters must satisfy the family's parameter schema exactly: no extra keys, only listed enum values.",
  "The examples show how reviewers have already labelled similar wording; follow their choices.",
  "If a piece has a meaning no listed family can express, set its family_id to null. If the whole wording is one meaning no family expresses, answer new_family with its role, a short label, and how it differs from the nearest listed family, instead of pieces.",
  "Reply with one JSON object only: {\"answers\": [{\"id\": <wording id>, \"pieces\": [{\"text\": ..., \"family_id\": ... | null, \"parameters\": {...}}]} | {\"id\": <wording id>, \"new_family\": {\"role\": ..., \"label\": ..., \"distinction\": ...}}]}.",
].join("\n");

export const DEEPSEEK_MODEL = "deepseek-v4-pro";
/** DeepSeek's fast/cheap model (the API's own id; the `omp` CLI profile calls it "deepseek-v4-flash"). */
export const DEEPSEEK_FLASH_MODEL = "deepseek-flash";
/** `reasoning_effort` request values DeepSeek's chat-completions API accepts. */
export const DEEPSEEK_REASONING_EFFORTS = ["none", "low", "high", "max"] as const;
export type DeepSeekReasoningEffort = typeof DEEPSEEK_REASONING_EFFORTS[number];
const DEEPSEEK_ENDPOINT = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/chat/completions";
/** The gitignored file holding the key when the environment does not. */
const DEEPSEEK_ENV_FILE = fileURLToPath(new URL("../../../_private/round5c/.env", import.meta.url));

/** The DeepSeek key from the environment, else from the private .env file; never logged. */
export function deepseekKey(): string {
  if (process.env.DEEPSEEK_API_KEY?.trim()) return process.env.DEEPSEEK_API_KEY.trim();
  if (existsSync(DEEPSEEK_ENV_FILE)) {
    const line = readFileSync(DEEPSEEK_ENV_FILE, "utf8").split(/\r?\n/u).find((entry) => entry.startsWith("DEEPSEEK_API_KEY="));
    const key = line?.slice("DEEPSEEK_API_KEY=".length).trim().replace(/^["']|["']$/gu, "");
    if (key) return key;
  }
  throw Object.assign(new Error("DEEPSEEK_API_KEY is not set in the environment or in _private/round5c/.env."), { status: 503 });
}

/**
 * DeepSeek's published ceiling for `max_tokens` (deepseek-v4-pro's context: 1M in, up to 384K
 * out) is 393216; the API's own default in thinking mode is 64K (128K at `reasoning_effort:
 * "max"`). The pilot's own default request budget below (100000) sits well above what a
 * two-ability Luna response has needed in practice (~27K completion tokens observed) but under
 * the ceiling, since reasoning tokens are billed and counted as completion tokens alongside the
 * JSON answer — a request that reasons heavily before answering can exhaust a too-small budget
 * before it ever reaches its answer ("DeepSeek stopped with length"). The old hardcoded 32768
 * sat *below* the model's own thinking-mode default and caused exactly that truncation.
 */
export const DEEPSEEK_MAX_TOKENS_CEILING = 393216;
export const DEFAULT_MAX_TOKENS = 100000;

/** Hard wall-clock budget for one DeepSeek HTTP call; a timeout is a transport failure like any other. */
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * A request that never reached the API (DNS or connection failure: fetch rejects with a
 * TypeError before any reply) is retried twice, 2 s then 8 s later. Nothing was sent or billed,
 * so a retry is safe; a timeout or any HTTP reply is not retried here.
 */
async function fetchRetryingNetwork(send: () => Promise<Response>): Promise<Response> {
  for (const wait of [2_000, 8_000]) {
    try {
      return await send();
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  return send();
}

/** DeepSeek's chat completions in JSON mode. */
export function deepseekModelCall(
  model = DEEPSEEK_MODEL, maxTokens = DEFAULT_MAX_TOKENS, reasoningEffort?: DeepSeekReasoningEffort, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): ModelCall {
  return async (instructions, request) => {
    const key = deepseekKey();
    const started = Date.now();
    let response: Response;
    try {
      response = await fetchRetryingNetwork(() => fetch(DEEPSEEK_ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model, temperature: 0, response_format: { type: "json_object" }, max_tokens: maxTokens,
          ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
          messages: [{ role: "system", content: instructions }, { role: "user", content: request }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      }));
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new DeepSeekCallError(`DeepSeek request timed out after ${Math.round(timeoutMs / 1000)}s.`, {
          usage: null, cost_usd: null, latency_ms: Date.now() - started, cost_unknown: true,
        });
      }
      // Never reached the API (DNS or connection failure, retries exhausted): nothing was billed.
      if (error instanceof TypeError) {
        throw new DeepSeekCallError(`DeepSeek was unreachable: ${error.message}.`, { usage: null, cost_usd: 0, latency_ms: Date.now() - started, cost_unknown: false });
      }
      throw error;
    }
    const payload = await response.json().catch(() => null) as {
      model?: unknown; choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>; error?: { message?: unknown };
      usage?: {
        prompt_tokens?: unknown; prompt_cache_hit_tokens?: unknown; prompt_cache_miss_tokens?: unknown; completion_tokens?: unknown;
        completion_tokens_details?: { reasoning_tokens?: unknown };
      };
    } | null;
    // Usage first: a truncated or malformed reply was still billed, and its run records the cost.
    const rawUsage = payload?.usage;
    const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
    const reasoningTokens = rawUsage?.completion_tokens_details?.reasoning_tokens;
    const usage: DeepSeekUsage | undefined = rawUsage ? {
      prompt_tokens: num(rawUsage.prompt_tokens), prompt_cache_hit_tokens: num(rawUsage.prompt_cache_hit_tokens),
      prompt_cache_miss_tokens: num(rawUsage.prompt_cache_miss_tokens), completion_tokens: num(rawUsage.completion_tokens),
      ...(reasoningTokens !== undefined ? { reasoning_tokens: num(reasoningTokens) } : {}),
    } : undefined;
    const failed = (message: string) => new DeepSeekCallError(message, {
      usage: usage ?? null, cost_usd: usage ? deepseekCostUsd(usage, model) : null, latency_ms: Date.now() - started, cost_unknown: !usage && response.ok,
    });
    if (!response.ok) throw failed(`DeepSeek HTTP ${response.status}: ${String(payload?.error?.message ?? response.statusText).slice(0, 300)}`);
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason !== "stop") throw failed(`DeepSeek stopped with ${String(choice?.finish_reason)}.`);
    const content = typeof choice.message?.content === "string" ? choice.message.content.trim() : "";
    let body: unknown;
    try {
      body = JSON.parse(content);
    } catch {
      throw failed("DeepSeek's reply is not valid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw failed("DeepSeek's reply is not a JSON object.");
    const returned = typeof payload?.model === "string" ? payload.model : model;
    return {
      body: body as Record<string, unknown>, model: returned, model_version: returned, latency_ms: Date.now() - started,
      cost_usd: usage ? deepseekCostUsd(usage, model) : null, usage,
    };
  };
}

type Row = { id: number; cluster: number; sample_text: string };

/** The listed families and a few decided spellings of each, as the model sees them. */
function context(db: DatabaseSync) {
  const families = REVIEWED_FAMILY_REGISTRY.filter((family) => !family.deprecated).map((family) => ({
    family_id: family.id, version: family.version, role: family.role, label: family.label, description: family.description, parameters: family.parameterSchema,
  }));
  const examples: Array<{ text: string; family_id: string; parameters: Record<string, unknown> }> = [];
  const perFamily = new Map<string, number>();
  for (const leaf of leafBoard(db, { limit: 0 }).leaves) {
    if (leaf.retired_version) continue;
    for (const surface of leaf.surfaces) {
      if (surface.surface_id === null && surface.annotations === 0) continue;
      if ((perFamily.get(leaf.family_id) ?? 0) >= EXAMPLES_PER_FAMILY) break;
      perFamily.set(leaf.family_id, (perFamily.get(leaf.family_id) ?? 0) + 1);
      examples.push({ text: surface.sample_text, family_id: leaf.family_id, parameters: leaf.parameters });
    }
  }
  return { families, examples };
}

/** Checked pieces for one answer, and why any piece was dropped. */
export function checkAnswer(wording: string, answer: unknown): { pieces: Array<ProposalPiece | UnnamedPiece>; dropped: string[]; new_family?: Record<string, string> } {
  const dropped: string[] = [];
  if (!answer || typeof answer !== "object") return { pieces: [], dropped: ["The model gave no answer for this wording."] };
  const record = answer as { pieces?: unknown; new_family?: unknown };
  if (record.new_family && typeof record.new_family === "object") {
    const { role, label, distinction } = record.new_family as Record<string, unknown>;
    if (typeof role === "string" && typeof label === "string" && typeof distinction === "string") return { pieces: [], dropped, new_family: { role, label, distinction } };
    return { pieces: [], dropped: ["The model's new family lacks a role, label or distinction."] };
  }
  if (!Array.isArray(record.pieces)) return { pieces: [], dropped: ["The model's answer has no pieces."] };
  const lower = wording.toLowerCase();
  const pieces: Array<ProposalPiece | UnnamedPiece> = [];
  for (const raw of record.pieces as Array<Record<string, unknown>>) {
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    if (!text || !lower.includes(text.toLowerCase()) || !leafSurface(text)) {
      dropped.push(`"${text}" is not part of the wording.`);
      continue;
    }
    // Keep the wording's own spelling of the piece; the model may have changed its case.
    const exact = wording.slice(lower.indexOf(text.toLowerCase()), lower.indexOf(text.toLowerCase()) + text.length);
    if (raw.family_id === null) {
      pieces.push({ text: exact, family_id: null });
      continue;
    }
    try {
      const familyId = String(raw.family_id);
      const version = currentFamilyVersion(familyId);
      const parameters = normalizeFingerprintParameters(familyId, (raw.parameters ?? {}) as Record<string, unknown>, version);
      pieces.push({ text: exact, family_id: familyId, family_version: version, role: familyRole(familyId, version), parameters, confidence: 0.5, neighbours: [] });
    } catch (error) {
      dropped.push(`"${exact}" as ${String(raw.family_id)}: ${error instanceof Error ? error.message : String(error)}`);
      pieces.push({ text: exact, family_id: null });
    }
  }
  return { pieces, dropped };
}

/**
 * Ask the model about unlabelled wording in the given clusters of the latest finished run, a
 * few clusters per call. Each call is recorded in model_runs; a failed call leaves its wording
 * unlabelled and is reported, and the other calls still go ahead.
 */
export async function askModelAboutClusters(db: DatabaseSync, clusters: readonly number[], call: ModelCall, modelName = DEEPSEEK_MODEL): Promise<{ asked: number; named: number; new_families: number; failed: string[] }> {
  const run = db.prepare("SELECT id FROM leaf_proposal_runs WHERE status = 'finished' ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  if (!run) throw Object.assign(new Error("Run the proposals first; the model only sees clusters from a finished run."), { status: 409 });
  const rows: Row[] = [];
  for (const cluster of new Set(clusters)) {
    rows.push(...db.prepare(`SELECT id, cluster, sample_text FROM leaf_proposals WHERE run_id = ? AND cluster = ? AND kind = 'unlabelled' AND status = 'open'
      ORDER BY closes DESC, occurrences DESC, id LIMIT ?`).all(run.id, cluster, MEMBERS_PER_CLUSTER) as Row[]);
  }
  const { families, examples } = context(db);
  const result = { asked: 0, named: 0, new_families: 0, failed: [] as string[] };
  const byCluster = [...new Set(rows.map((row) => row.cluster))];
  for (let start = 0; start < byCluster.length; start += CLUSTERS_PER_CALL) {
    const batch = rows.filter((row) => byCluster.slice(start, start + CLUSTERS_PER_CALL).includes(row.cluster));
    const request = { families, examples, wordings: batch.map((row) => ({ id: row.id, cluster: row.cluster, text: row.sample_text })) };
    const requestText = JSON.stringify(request);
    const inputHash = hashJson(request);
    let reply: ModelReply;
    try {
      reply = await call(LEAF_PROPOSAL_INSTRUCTIONS, requestText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare(`INSERT INTO model_runs (model, model_version, prompt_version, input_hash, config_json, status, created_at) VALUES (?, 'unknown', ?, ?, ?, 'failed', ?)`)
        .run(modelName, LEAF_PROPOSAL_PROMPT_VERSION, inputHash, JSON.stringify({ purpose: "leaf-proposals", error: message.slice(0, 500) }), new Date().toISOString());
      result.failed.push(message);
      continue;
    }
    result.asked += batch.length;
    const answers = new Map((Array.isArray(reply.body.answers) ? reply.body.answers as Array<Record<string, unknown>> : []).map((answer) => [Number(answer?.id), answer]));
    withTransaction(db, () => {
      const modelRunId = Number(db.prepare(`INSERT INTO model_runs (model, model_version, prompt_version, input_hash, config_json, output_json, latency_ms, cost_usd, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`).run(reply.model, reply.model_version, LEAF_PROPOSAL_PROMPT_VERSION, inputHash,
        JSON.stringify({ purpose: "leaf-proposals", run_id: run.id }), JSON.stringify(reply.body), reply.latency_ms, reply.cost_usd, new Date().toISOString()).lastInsertRowid);
      const update = db.prepare("UPDATE leaf_proposals SET kind = ?, pieces_json = ?, confidence = ?, dropped_json = ?, model_run_id = ? WHERE id = ?");
      for (const row of batch) {
        const checked = checkAnswer(row.sample_text, answers.get(row.id));
        if (checked.new_family) {
          update.run("new-family", JSON.stringify([{ new_family: checked.new_family }]), 0, "[]", modelRunId, row.id);
          result.new_families += 1;
        } else if (checked.pieces.some((piece) => piece.family_id !== null)) {
          update.run("llm", JSON.stringify(checked.pieces), 0.5, JSON.stringify(checked.dropped), modelRunId, row.id);
          result.named += 1;
        } else {
          update.run("unlabelled", "[]", 0, JSON.stringify(checked.dropped), modelRunId, row.id);
        }
      }
    });
  }
  return result;
}
