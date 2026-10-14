import { execFile, spawn } from "node:child_process";

/**
 * Drives the installed `omp` CLI for one Luna decomposition. It never uses a shell, never logs
 * or returns stdout/stderr bodies in errors (they contain source text), and accepts exactly one
 * assistant JSON object from an unbroken, un-fallen-back invocation of the requested model.
 */

/** Wall-clock budget passed to `omp --max-time`. */
export const OMP_MAX_TIME_MS = 20 * 60 * 1000;
/** Extra time before the driver hard-kills a subprocess that ignores its own deadline. */
export const OMP_KILL_GRACE_MS = 60 * 1000;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;

export type OmpReasonCode =
  | "OMP_UNAVAILABLE" | "TIMEOUT" | "OUTPUT_LIMIT" | "NONZERO_EXIT" | "MALFORMED_EVENT_STREAM"
  | "INCOMPLETE_STREAM" | "TOOL_USE" | "MODEL_FALLBACK" | "MODEL_MISMATCH" | "MODEL_ERROR"
  | "EXTRA_ASSISTANT_MESSAGE" | "NO_ASSISTANT_MESSAGE" | "NOT_JSON_OBJECT";

/** A source-free transport failure; `message` never quotes model or source output. */
export class OmpTransportError extends Error {
  readonly reason_code: OmpReasonCode;
  readonly exit_code: number | null;

  constructor(reasonCode: OmpReasonCode, message: string, exitCode: number | null = null) {
    super(message);
    this.name = "OmpTransportError";
    this.reason_code = reasonCode;
    this.exit_code = exitCode;
  }
}

/** Resolve the `omp` executable; `ROUND5C_OMP_BIN` substitutes a fixture in tests. */
export function ompBinary(): string {
  return process.env.ROUND5C_OMP_BIN ?? "omp";
}

/**
 * Config overlay isolating one run from user and project context: no discovered providers,
 * rules, memory, MCP, skills, or context promotion, and no model fallback of any kind.
 */
export function overlayYaml(): string {
  return [
    "retry:",
    "  modelFallback: false",
    "  usageAwareFallback: false",
    "  fallbackChains: {}",
    "providers:",
    "  anthropic:",
    "    serverSideFallback: false",
    "enabledProviders: []",
    "disabledProviders: [native, agents-md, claude-md, claude, codex, claude-plugins, mcp-json, cursor, cline, vscode, windsurf, opencode, github, gemini]",
    "mcp:",
    "  enableProjectConfig: false",
    "memory:",
    "  backend: off",
    "memories:",
    "  enabled: false",
    "contextPromotion:",
    "  enabled: false",
    "skills:",
    "  enabled: false",
    "lsp:",
    "  enabled: false",
    "compaction:",
    "  enabled: false",
    "",
  ].join("\n");
}

/** Exact argv for one isolated, tool-free, sessionless print-mode JSON invocation. */
export function ompArgs(options: { model: string; cwd: string; configPath: string; systemPromptPath: string; maxTimeMs?: number }): string[] {
  return [
    "-p", "--mode", "json", "--model", options.model,
    "--no-tools", "--no-lsp", "--no-pty", "--no-extensions", "--no-skills", "--no-rules",
    "--no-session", "--no-title", "--thinking", "off",
    "--max-time", String(Math.ceil((options.maxTimeMs ?? OMP_MAX_TIME_MS) / 1000)),
    "--cwd", options.cwd, "--config", options.configPath, "--system-prompt", options.systemPromptPath,
  ];
}

/** The installed binary's version string, e.g. `omp/18.2.11`. */
export function ompVersion(binary = ompBinary()): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(binary, ["--version"], { timeout: 10_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        reject(new OmpTransportError("OMP_UNAVAILABLE", code === "ENOENT" ? `The ${binary} executable is not installed.` : `${binary} --version failed.`));
        return;
      }
      const version = stdout.trim().split(/\s+/u)[0] ?? "";
      if (!version) reject(new OmpTransportError("OMP_UNAVAILABLE", `${binary} --version printed nothing.`));
      else resolvePromise(version);
    });
  });
}

export type OmpProcessResult = { stdout: string; duration_ms: number };

/**
 * The provider's own error from a failed run's event stream (a usage limit, an auth failure),
 * which omp reports on stdout rather than stderr. The last one wins; at most 300 characters.
 */
export function providerError(stdout: string): string | null {
  let found: string | null = null;
  for (const line of stdout.split("\n")) {
    if (!line.includes("errorMessage") && !line.includes("finalError")) continue;
    try {
      const event = JSON.parse(line) as { message?: { errorMessage?: unknown }; finalError?: unknown };
      const message = event.message?.errorMessage ?? event.finalError;
      if (typeof message === "string" && message.trim()) found = message.trim();
    } catch {
      // A truncated line carries nothing usable.
    }
  }
  return found ? found.slice(0, 300) : null;
}

/** Run one invocation with the request on non-TTY stdin, bounding output and wall time. */
export function runOmpProcess(options: {
  binary?: string;
  args: readonly string[];
  cwd: string;
  stdin: string;
  hardKillMs?: number;
}): Promise<OmpProcessResult> {
  const binary = options.binary ?? ompBinary();
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const chunks: Buffer[] = [];
    const child = spawn(binary, [...options.args], { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"], shell: false });
    const finish = (error: OmpTransportError | null, result?: OmpProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolvePromise(result!);
    };
    const timer = setTimeout(
      () => finish(new OmpTransportError("TIMEOUT", "The omp invocation exceeded its deadline and was killed.")),
      options.hardKillMs ?? OMP_MAX_TIME_MS + OMP_KILL_GRACE_MS,
    );
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(new OmpTransportError("OMP_UNAVAILABLE", error.code === "ENOENT" ? `The ${binary} executable is not installed.` : "The omp process could not start."));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) finish(new OmpTransportError("OUTPUT_LIMIT", `omp stdout exceeded ${MAX_STDOUT_BYTES} bytes.`));
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR_BYTES) finish(new OmpTransportError("OUTPUT_LIMIT", `omp stderr exceeded ${MAX_STDERR_BYTES} bytes.`));
    });
    child.on("close", (code, signal) => {
      if (code !== 0) {
        const reason = providerError(Buffer.concat(chunks).toString("utf8"));
        finish(new OmpTransportError("NONZERO_EXIT", `omp exited with ${code === null ? `signal ${signal}` : `code ${code}`} after ${stderrBytes} stderr bytes${reason ? `: ${reason}` : ""}.`, code));
        return;
      }
      finish(null, { stdout: Buffer.concat(chunks).toString("utf8"), duration_ms: Date.now() - started });
    });
    child.stdin.on("error", () => { /* A process that exits early surfaces through `close`. */ });
    child.stdin.end(options.stdin, "utf8");
  });
}

type EventMessage = {
  role?: unknown;
  content?: unknown;
  provider?: unknown;
  model?: unknown;
  stopReason?: unknown;
  usage?: { cost?: { total?: unknown } };
  duration?: unknown;
};

/** The single accepted assistant result and the model identity the event stream observed. */
export type ExtractedAssistant = {
  body: Record<string, unknown>;
  model: string;
  cost_usd: number | null;
  latency_ms: number | null;
};

const FALLBACK_EVENT = /fallback|model_change|model_switch|retry_model/iu;

function observedModel(message: EventMessage): string {
  if (typeof message.provider !== "string" || typeof message.model !== "string") {
    throw new OmpTransportError("MALFORMED_EVENT_STREAM", "An assistant message has no provider/model identity.");
  }
  return `${message.provider}/${message.model}`;
}

function assistantText(message: EventMessage): string {
  if (!Array.isArray(message.content)) throw new OmpTransportError("MALFORMED_EVENT_STREAM", "The assistant message has no content parts.");
  let text = "";
  for (const part of message.content as Array<{ type?: unknown; text?: unknown }>) {
    if (part?.type === "thinking") continue;
    if (part?.type !== "text" || typeof part.text !== "string") {
      throw new OmpTransportError("TOOL_USE", `The assistant message contains a ${String(part?.type)} part.`);
    }
    text += part.text;
  }
  return text;
}

/**
 * Parse the NDJSON event stream and return exactly one assistant JSON object. Terminal
 * `message_end` bodies are authoritative; streamed deltas are used only when no terminal body
 * exists. Any tool event, fallback or model change, extra assistant message, non-`stop` stop
 * reason, fence, or non-object body is rejected.
 */
export function extractAssistantJson(stdout: string, requestedModel: string): ExtractedAssistant {
  const events: Array<Record<string, unknown>> = [];
  for (const [index, line] of stdout.split("\n").entries()) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new OmpTransportError("MALFORMED_EVENT_STREAM", `Event line ${index + 1} is not JSON.`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as { type?: unknown }).type !== "string") {
      throw new OmpTransportError("MALFORMED_EVENT_STREAM", `Event line ${index + 1} is not a typed event object.`);
    }
    events.push(parsed as Record<string, unknown>);
  }
  if (events[0]?.type !== "session") throw new OmpTransportError("MALFORMED_EVENT_STREAM", "The event stream does not start with a session header.");
  const terminal: EventMessage[] = [];
  let started: EventMessage | null = null;
  let deltas = "";
  let agentEnd: Record<string, unknown> | null = null;
  for (const event of events) {
    const type = event.type as string;
    if (type.startsWith("tool_")) throw new OmpTransportError("TOOL_USE", `The invocation emitted a ${type} event.`);
    if (FALLBACK_EVENT.test(type)) throw new OmpTransportError("MODEL_FALLBACK", `The invocation emitted a ${type} event.`);
    const message = event.message as EventMessage | undefined;
    if (type === "message_start" && message?.role === "assistant") {
      if (started) throw new OmpTransportError("EXTRA_ASSISTANT_MESSAGE", "The invocation started more than one assistant message.");
      started = message;
      if (observedModel(message) !== requestedModel) throw new OmpTransportError("MODEL_MISMATCH", `The invocation used ${observedModel(message)}, not ${requestedModel}.`);
    }
    if (type === "message_update") {
      const update = event.assistantMessageEvent as { type?: unknown; delta?: unknown } | undefined;
      if (update?.type === "text_delta" && typeof update.delta === "string") deltas += update.delta;
    }
    if (type === "message_end" && message?.role === "assistant") terminal.push(message);
    if (type === "agent_end") agentEnd = event;
  }
  if (!agentEnd) throw new OmpTransportError("INCOMPLETE_STREAM", "The event stream has no terminal agent_end event.");
  const finalMessages = Array.isArray(agentEnd.messages)
    ? (agentEnd.messages as EventMessage[]).filter((message) => message?.role === "assistant")
    : [];
  if (terminal.length > 1 || finalMessages.length > 1) throw new OmpTransportError("EXTRA_ASSISTANT_MESSAGE", "The invocation produced more than one assistant message.");
  const message = terminal[0] ?? finalMessages[0] ?? null;
  const identity = message ?? started;
  if (!identity) throw new OmpTransportError("NO_ASSISTANT_MESSAGE", "The invocation produced no assistant message.");
  const model = observedModel(identity);
  if (model !== requestedModel) throw new OmpTransportError("MODEL_MISMATCH", `The invocation used ${model}, not ${requestedModel}.`);
  if (message && message.stopReason !== "stop") {
    throw new OmpTransportError("MODEL_ERROR", `The assistant message stopped with ${String(message.stopReason)}.`);
  }
  const text = (message ? assistantText(message) : deltas).trim();
  if (!text.startsWith("{") || !text.endsWith("}")) throw new OmpTransportError("NOT_JSON_OBJECT", "The assistant reply is not one bare JSON object.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OmpTransportError("NOT_JSON_OBJECT", "The assistant reply is not valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new OmpTransportError("NOT_JSON_OBJECT", "The assistant reply is not a JSON object.");
  const cost = message?.usage?.cost?.total;
  const duration = message?.duration;
  return {
    body: body as Record<string, unknown>,
    model,
    cost_usd: typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null,
    latency_ms: typeof duration === "number" && Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
  };
}
