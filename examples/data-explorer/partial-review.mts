import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  calibrationReport,
  decisionIdentity,
  parsePartialReviewBundle,
  parseReviewSessionItems,
  type AIReview,
  type AIUsage,
  type PartialCandidate,
  type ReviewerIdentity,
} from "./src/lib/partial-review.js";
import {
  AI_REVIEW_PROMPT_CONTRACT_VERSION,
  AI_REVIEW_SCHEMA,
  AI_REVIEW_SYSTEM_PROMPT,
  DEFAULT_AI_REVIEW_MODEL,
  ReviewerCallError,
  parseAIReviewSuggestion,
  reviewerInput,
  runAIReviewBatch,
  type AIReviewRunReport,
  type ReviewerResponse,
} from "./src/lib/partial-review-batch.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type JsonRecord = Record<string, any>;

function readJSON(file: string): JsonRecord {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file} must contain a JSON object.`);
  return value as JsonRecord;
}

function realpathAllowingMissing(target: string): string {
  let existing = target;
  const suffix: string[] = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`No existing ancestor for path: ${target}`);
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(realpathSync(existing), ...suffix);
}

/** Resolve source-bearing input or output through symlinks and keep it under `_private`. */
export function resolvePrivateReviewPath(requestedPath: string, repoRoot = REPO_ROOT): string {
  const requested = path.isAbsolute(requestedPath) ? path.normalize(requestedPath) : path.resolve(repoRoot, requestedPath);
  const resolved = realpathAllowingMissing(requested);
  const privateRoot = realpathAllowingMissing(path.join(repoRoot, "_private"));
  const relative = path.relative(privateRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    if (!relative) return resolved;
    throw new Error("Partial review source-bearing artifacts must remain under the repository _private directory");
  }
  return resolved;
}

function atomicWriteJSON(file: string, value: unknown): void {
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, file);
}

function parseEnvelope(stdout: string): JsonRecord {
  const start = stdout.indexOf("{");
  if (start < 0) throw new ReviewerCallError("Reviewer response contains no JSON object.", "invalid-response");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < stdout.length; index++) {
    const character = stdout[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      try {
        return JSON.parse(stdout.slice(start, index + 1)) as JsonRecord;
      } catch (error) {
        throw new ReviewerCallError(error instanceof Error ? error.message : String(error), "invalid-response");
      }
    }
  }
  throw new ReviewerCallError("Reviewer response contains incomplete JSON.", "invalid-response");
}

function usageFromEnvelope(envelope: JsonRecord): AIUsage {
  const usage = envelope.usage && typeof envelope.usage === "object" && !Array.isArray(envelope.usage) ? envelope.usage as JsonRecord : {};
  const cacheCreation = usage.cache_creation && typeof usage.cache_creation === "object" && !Array.isArray(usage.cache_creation) ? usage.cache_creation as JsonRecord : {};
  const nonnegative = (value: unknown): number => typeof value === "number" && value >= 0 ? value : 0;
  return {
    input_tokens: nonnegative(usage.input_tokens),
    output_tokens: nonnegative(usage.output_tokens),
    cache_read_input_tokens: nonnegative(usage.cache_read_input_tokens),
    cache_creation_input_tokens: nonnegative(usage.cache_creation_input_tokens ?? cacheCreation.ephemeral_5m_input_tokens),
    cost_usd: nonnegative(envelope.total_cost_usd),
  };
}

function deepSeekUsage(envelope: JsonRecord): AIUsage {
  const usage = envelope.usage && typeof envelope.usage === "object" && !Array.isArray(envelope.usage) ? envelope.usage as JsonRecord : {};
  const nonnegative = (value: unknown): number => typeof value === "number" && value >= 0 ? value : 0;
  const cached = nonnegative(usage.prompt_cache_hit_tokens ?? (usage.prompt_tokens_details as JsonRecord | undefined)?.cached_tokens);
  const prompt = nonnegative(usage.prompt_tokens);
  return {
    input_tokens: Math.max(0, nonnegative(usage.prompt_cache_miss_tokens) || prompt - cached),
    output_tokens: nonnegative(usage.completion_tokens),
    cache_read_input_tokens: cached,
  };
}

async function deepSeekReview(candidate: PartialCandidate, reviewer: ReviewerIdentity): Promise<ReviewerResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new ReviewerCallError("DEEPSEEK_API_KEY is not set.", "reviewer-error");
  let response: Response;
  try {
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: reviewer.model_version_or_id,
        messages: [
          {
            role: "system",
            content: `${AI_REVIEW_SYSTEM_PROMPT}\n\nReturn only valid JSON matching this schema:\n${JSON.stringify(AI_REVIEW_SCHEMA)}`,
          },
          { role: "user", content: reviewerInput(candidate) },
        ],
        response_format: { type: "json_object" },
        max_tokens: 2048,
        stream: false,
      }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const category = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "reviewer-error";
    throw new ReviewerCallError(message, category);
  }
  const body = await response.text();
  let envelope: JsonRecord;
  try {
    envelope = JSON.parse(body) as JsonRecord;
  } catch {
    throw new ReviewerCallError(`DeepSeek returned invalid response JSON: ${body.slice(0, 300)}`, "invalid-response");
  }
  const usage = deepSeekUsage(envelope);
  if (!response.ok) {
    const message = typeof envelope.error?.message === "string" ? envelope.error.message : `DeepSeek HTTP ${response.status}`;
    throw new ReviewerCallError(message, response.status === 429 ? "rate-limited" : "reviewer-error", usage);
  }
  const content = envelope.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new ReviewerCallError("DeepSeek returned no JSON content.", "invalid-response", usage);
  let suggestion: unknown;
  try {
    suggestion = JSON.parse(content);
  } catch {
    throw new ReviewerCallError("DeepSeek returned invalid structured JSON.", "invalid-response", usage);
  }
  return { suggestion: parseAIReviewSuggestion(suggestion), usage };
}

function claudeReview(candidate: PartialCandidate, reviewer: ReviewerIdentity): Promise<ReviewerResponse> {
  return new Promise((resolve, reject) => {
    execFile(
      "claude",
      [
        "-p", reviewerInput(candidate),
        "--system-prompt", AI_REVIEW_SYSTEM_PROMPT,
        "--exclude-dynamic-system-prompt-sections",
        "--json-schema", JSON.stringify(AI_REVIEW_SCHEMA),
        "--output-format", "json",
        "--model", reviewer.model_version_or_id,
        "--safe-mode",
        "--tools", "",
        "--permission-prompts", "none",
        "--no-session-persistence",
        "--prompt-suggestions", "false",
        "--effort", "low",
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: 300_000 },
      (error, stdout) => {
        let envelope: JsonRecord;
        try {
          envelope = parseEnvelope(String(stdout));
        } catch (parseError) {
          if (error && "killed" in error && error.killed) return reject(new ReviewerCallError("Reviewer call timed out.", "timeout"));
          return reject(parseError);
        }
        const usage = usageFromEnvelope(envelope);
        if (envelope.is_error) {
          const message = typeof envelope.result === "string" ? envelope.result : "Reviewer call failed.";
          const category = envelope.api_error_status === 429 || /rate|session limit|too many requests/i.test(message) ? "rate-limited" : "reviewer-error";
          return reject(new ReviewerCallError(message, category, usage));
        }
        if (!envelope.structured_output) return reject(new ReviewerCallError("Reviewer returned no structured output.", "invalid-response", usage));
        try {
          resolve({ suggestion: parseAIReviewSuggestion(envelope.structured_output), usage });
        } catch (parseError) {
          reject(new ReviewerCallError(parseError instanceof Error ? parseError.message : String(parseError), "invalid-response", usage));
        }
      },
    );
  });
}

function rawIdentity(item: JsonRecord): string {
  return `${String(item.key)}#${String(item.component_id)}`;
}

export function mergePriorReviewState(bundle: JsonRecord, priorBundle: JsonRecord): JsonRecord {
  if (!Array.isArray(bundle.items) || !Array.isArray(priorBundle.items)) throw new Error("Candidate bundles must contain items.");
  const priorItems = new Map(priorBundle.items.filter((value): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value)).map((item) => [rawIdentity(item), item]));
  const priorRuns = Array.isArray(priorBundle.ai_review_runs) ? priorBundle.ai_review_runs : [];
  const completedPriorRuns = priorBundle.ai_review_run ? [...priorRuns, priorBundle.ai_review_run] : priorRuns;
  return {
    ...bundle,
    items: bundle.items.map((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Candidate bundle item must be an object.");
      const item = value as JsonRecord;
      const prior = priorItems.get(rawIdentity(item));
      if (!prior) return item;
      return {
        ...item,
        ...(prior.ai_review ? { ai_review: prior.ai_review } : {}),
        ...(Array.isArray(prior.ai_review_history) ? { ai_review_history: prior.ai_review_history } : {}),
        ...(prior.human_review ? { human_review: prior.human_review } : {}),
        ...(Array.isArray(prior.human_review_history) ? { human_review_history: prior.human_review_history } : {}),
      };
    }),
    ...(completedPriorRuns.length ? { ai_review_runs: completedPriorRuns } : {}),
  };
}

export function mergeAIReviewsIntoBundle(bundle: JsonRecord, reviews: ReadonlyMap<string, AIReview>, report: AIReviewRunReport): JsonRecord {
  if (!Array.isArray(bundle.items)) throw new Error("Candidate bundle must contain items.");
  return {
    ...bundle,
    items: bundle.items.map((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Candidate bundle item must be an object.");
      const item = value as JsonRecord;
      const review = reviews.get(rawIdentity(item));
      if (!review) return item;
      const previous = item.ai_review;
      const history = Array.isArray(item.ai_review_history) ? [...item.ai_review_history] : [];
      if (previous && JSON.stringify(previous) !== JSON.stringify(review) && !history.some((entry) => JSON.stringify(entry) === JSON.stringify(previous))) {
        history.push(previous);
      }
      return { ...item, ai_review: review, ...(history.length ? { ai_review_history: history } : {}) };
    }),
    ai_review_runs: Array.isArray(bundle.ai_review_runs) ? bundle.ai_review_runs : [],
    ai_review_run: {
      completed_at: new Date().toISOString(),
      authority: "suggestion-only",
      ...report,
    },
  };
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export interface AIReviewCLIOptions {
  command: "ai-review";
  input: string;
  output: string;
  provider: "anthropic" | "deepseek";
  model: string;
  concurrency: number;
  force: boolean;
}

export function parseAIReviewCLI(argv: readonly string[], repoRoot = REPO_ROOT): AIReviewCLIOptions {
  if (argv[0] !== "ai-review" || !argv[1]) throw new Error("Usage: partial-review ai-review <private-bundle> [--provider anthropic|deepseek] [--output <private-path>] [--model <model>] [--concurrency 1-8] [--force]");
  const input = resolvePrivateReviewPath(argv[1], repoRoot);
  const defaultOutput = path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.ai-reviewed.json`);
  const output = resolvePrivateReviewPath(option(argv, "--output") ?? defaultOutput, repoRoot);
  const providerValue = option(argv, "--provider") ?? "anthropic";
  if (providerValue !== "anthropic" && providerValue !== "deepseek") throw new Error("--provider must be anthropic or deepseek.");
  const concurrency = Number.parseInt(option(argv, "--concurrency") ?? "2", 10);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("--concurrency must be between 1 and 8.");
  const model = option(argv, "--model") ?? (providerValue === "deepseek" ? "deepseek-chat" : DEFAULT_AI_REVIEW_MODEL);
  return { command: "ai-review", input, output, provider: providerValue, model, concurrency, force: argv.includes("--force") };
}

async function aiReviewCommand(argv: readonly string[]): Promise<void> {
  const options = parseAIReviewCLI(argv);
  const inputRoot = readJSON(options.input);
  const priorRoot = existsSync(options.output) ? readJSON(options.output) : undefined;
  const checkpointRoot = priorRoot ? mergePriorReviewState(inputRoot, priorRoot) : inputRoot;
  const candidates = parsePartialReviewBundle(checkpointRoot);
  const priorReviews = new Map<string, AIReview>();
  for (const candidate of candidates) {
    if (candidate.ai_review) priorReviews.set(decisionIdentity(candidate), candidate.ai_review);
  }
  const reviewer: ReviewerIdentity = options.provider === "deepseek"
    ? {
      provider: "deepseek", model: "deepseek",
      model_version_or_id: options.model,
      prompt_contract_version: AI_REVIEW_PROMPT_CONTRACT_VERSION,
    }
    : {
      provider: "anthropic", model: "claude",
      model_version_or_id: options.model,
      prompt_contract_version: AI_REVIEW_PROMPT_CONTRACT_VERSION,
    };
  const checkpoint = async (reviews: ReadonlyMap<string, AIReview>, report: AIReviewRunReport): Promise<void> => {
    atomicWriteJSON(options.output, mergeAIReviewsIntoBundle(checkpointRoot, reviews, report));
  };
  const transport = options.provider === "deepseek" ? deepSeekReview : claudeReview;
  const { report } = await runAIReviewBatch(candidates, priorReviews, {
    reviewer, concurrency: options.concurrency, force: options.force,
  }, transport, checkpoint);
  console.log(JSON.stringify({ output: options.output, ...report }, null, 2));
}

function calibrateCommand(argv: readonly string[]): void {
  const input = argv[1];
  if (!input) throw new Error("Usage: partial-review calibrate <review-export> [--output <private-path>]");
  const report = calibrationReport(parseReviewSessionItems(readJSON(resolvePrivateReviewPath(input))));
  const output = option(argv, "--output");
  if (output) atomicWriteJSON(resolvePrivateReviewPath(output), report);
  console.log(JSON.stringify(report, null, 2));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "ai-review") return aiReviewCommand(argv);
  if (argv[0] === "calibrate") return calibrateCommand(argv);
  throw new Error("Usage:\n  partial-review ai-review <private-bundle> [--provider anthropic|deepseek] [options]\n  partial-review calibrate <review-export> [--output <private-path>]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
