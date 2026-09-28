import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { openWorkbench } from "../src/round5c/db.js";
import { abandonLunaRun, ABANDON_AFTER_MS, claimLunaRun, finishLunaRun, lunaRunView, runLuna, startLunaRun } from "../src/round5c/luna-run.js";
import { LUNA_MODEL, LunaRunError } from "../src/round5c/luna-schema.js";
import { extractAssistantJson, ompArgs, OmpTransportError, providerError } from "../src/round5c/omp-driver.js";
import { importLuna, prepareLuna, type PreparedLuna } from "../src/round5c/proposal.js";

// Fabricated fixture prose only; nothing here is published source text.
const SOURCE = "Each time this unit attacks, re-roll a Hit roll of 1 and gain a glimmer token.";

let root: string;
let databasePath: string;
let previous: Record<string, string | undefined>;

function open(): DatabaseSync {
  return openWorkbench(databasePath);
}

function insertAbility(db: DatabaseSync, abilityId: string, source = SOURCE): number {
  return Number(db.prepare(`
    INSERT INTO abilities (faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, metadata_json, fragments_json, current)
    VALUES ('fixture', ?, ?, ?, 'unit', 'fixture', ?, '{}', ?, 1)
  `).run(abilityId, hashJson({ text: source }), source, abilityId, JSON.stringify([
    { fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(source, "utf8"), text: source },
  ])).lastInsertRowid);
}

function span(source: string, text: string): { start_byte: number; end_byte: number; exact_text: string } {
  const start = source.indexOf(text);
  if (start < 0) throw new Error(`Missing fixture text ${text}`);
  return { start_byte: Buffer.byteLength(source.slice(0, start)), end_byte: Buffer.byteLength(source.slice(0, start + text.length)), exact_text: text };
}

function validResponse(prepared: PreparedLuna, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const request = prepared.request as { abilities: Array<{ faction_id: string; ability_id: string; source_hash: string; source_text: string }> };
  return {
    schema_version: 2,
    input_hash: prepared.input_hash,
    model: LUNA_MODEL,
    model_version: "unknown",
    prompt_version: "v2",
    abilities: request.abilities.map((ability) => ({
      faction_id: ability.faction_id,
      ability_id: ability.ability_id,
      source_hash: ability.source_hash,
      spans: [
        { ...span(ability.source_text, "Each time this unit attacks"), role: "EVENT", status: "UNRESOLVED" },
        {
          ...span(ability.source_text, "re-roll a Hit roll of 1"), role: "EFFECT", status: "EXISTING",
          family_id: "reroll", family_version: 2, parameters: { roll: "hit", subset: "ones", weapon_type: "all" },
        },
        {
          ...span(ability.source_text, "gain a glimmer token"), role: "EFFECT", status: "NOVEL",
          hypothesis: { label: "token gain", distinction: "Adds a named token; no reviewed family counts tokens.", parameters: [{ name: "token", ...span(ability.source_text, "glimmer token") }] },
        },
      ],
      structural_spans: [{ ...span(ability.source_text, "this unit"), kind: "participant", description: "The acting unit." }],
      connectives: [{ ...span(ability.source_text, "and"), kind: "and" }],
      unresolved_regions: [],
    })).map((ability) => ({
      ...ability,
      // "this unit" sits inside the UNRESOLVED event span; keep the constituents disjoint.
      spans: ability.spans.map((item) => item.status === "UNRESOLVED" ? { ...item, ...span(request.abilities[0]!.source_text, "Each time") } : item),
    })),
    ...overrides,
  };
}

type Scenario = {
  body?: string;
  events?: Array<Record<string, unknown>>;
  exit_code?: number;
  sleep_ms?: number;
  provider?: string;
  model?: string;
  stop_reason?: string;
  extra_assistant?: boolean;
  extra_event?: Record<string, unknown>;
};

function writeScenario(scenario: Scenario): void {
  writeFileSync(join(root, "scenario.json"), JSON.stringify(scenario));
}

/** A fake `omp` that records its argv, stdin, and overlay, then replays a scripted event stream. */
function writeFakeOmp(): string {
  const path = join(root, "fake-omp.mjs");
  writeFileSync(path, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
if (argv[0] === "--version") { process.stdout.write("omp/0.0.0-fixture\\n"); process.exit(0); }
const stdin = readFileSync(0, "utf8");
const configPath = argv[argv.indexOf("--config") + 1];
const promptPath = argv[argv.indexOf("--system-prompt") + 1];
writeFileSync(process.env.FAKE_OMP_RECORD, JSON.stringify({ argv, stdin, overlay: readFileSync(configPath, "utf8"), system_prompt: readFileSync(promptPath, "utf8") }));
const scenario = JSON.parse(readFileSync(process.env.FAKE_OMP_SCENARIO, "utf8"));
const message = (text) => ({ role: "assistant", content: [{ type: "text", text }], provider: scenario.provider ?? "openai-codex", model: scenario.model ?? "gpt-5.6-luna", usage: { cost: { total: 0.001 } }, stopReason: scenario.stop_reason ?? "stop", duration: 12 });
const events = scenario.events ?? [
  { type: "session", version: 3 },
  { type: "agent_start" },
  { type: "message_start", message: message("") },
  ...(scenario.extra_event ? [scenario.extra_event] : []),
  { type: "message_end", message: message(scenario.body) },
  ...(scenario.extra_assistant ? [{ type: "message_end", message: message(scenario.body) }] : []),
  { type: "agent_end", messages: [message(scenario.body)], isTerminal: true },
];
setTimeout(() => {
  for (const event of events) process.stdout.write(JSON.stringify(event) + "\\n");
  process.exit(scenario.exit_code ?? 0);
}, scenario.sleep_ms ?? 0);
`);
  chmodSync(path, 0o755);
  return path;
}

function record(): { argv: string[]; stdin: string; overlay: string; system_prompt: string } {
  return JSON.parse(readFileSync(join(root, "record.json"), "utf8"));
}

function prepared(db: DatabaseSync, abilityId = "fixture-ability"): PreparedLuna {
  const id = insertAbility(db, abilityId);
  return prepareLuna(db, { ability_version_id: id });
}

function counts(db: DatabaseSync): { proposals: number; atoms: number; annotations: number; candidates: number } {
  const one = (sql: string) => Number((db.prepare(sql).get() as { total: number }).total);
  return {
    proposals: one("SELECT count(*) AS total FROM proposals"),
    atoms: one("SELECT count(*) AS total FROM source_atom_proposals"),
    annotations: one("SELECT count(*) AS total FROM annotations"),
    candidates: one("SELECT count(*) AS total FROM family_candidates"),
  };
}

let binary: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "round5c-luna-run-"));
  databasePath = join(root, "workbench.sqlite");
  previous = {
    ROUND5C_ARTIFACT_DIR: process.env.ROUND5C_ARTIFACT_DIR,
    FAKE_OMP_RECORD: process.env.FAKE_OMP_RECORD,
    FAKE_OMP_SCENARIO: process.env.FAKE_OMP_SCENARIO,
  };
  process.env.ROUND5C_ARTIFACT_DIR = join(root, "artifacts");
  process.env.FAKE_OMP_RECORD = join(root, "record.json");
  process.env.FAKE_OMP_SCENARIO = join(root, "scenario.json");
  binary = writeFakeOmp();
});

afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("Round 5C OMP Luna transport", () => {
  it("runs one isolated invocation and imports only pending suggestions with observed provenance", async () => {
    const db = open();
    const run = prepared(db);
    writeScenario({ body: JSON.stringify(validResponse(run)) });
    db.close();

    const view = await runLuna(open, run.run_id, { binary });
    expect(view).toMatchObject({ state: "completed", model: LUNA_MODEL, model_version: "omp/0.0.0-fixture", transport: "omp-json" });
    // "attacks" is not reported, so it becomes an explicit implicit-unresolved claim.
    expect(view.summary).toEqual({ proposals: 3, unresolved: 2, structural: 1, candidates: 1 });

    const seen = record();
    const scratchCwd = seen.argv[seen.argv.indexOf("--cwd") + 1]!;
    expect(seen.argv).toEqual(ompArgs({
      model: LUNA_MODEL,
      cwd: scratchCwd,
      configPath: seen.argv[seen.argv.indexOf("--config") + 1]!,
      systemPromptPath: seen.argv[seen.argv.indexOf("--system-prompt") + 1]!,
    }));
    expect(seen.argv.slice(0, 4)).toEqual(["-p", "--mode", "json", "--model"]);
    expect(seen.argv).toContain("--no-tools");
    expect(seen.argv[seen.argv.indexOf("--max-time") + 1]).toBe("1200");
    expect(existsSync(scratchCwd)).toBe(false);
    // stdin carries the canonical request plus the input hash the model must echo.
    expect(JSON.parse(seen.stdin)).toEqual({ input_hash: run.input_hash, request: JSON.parse(readFileSync(run.request_path, "utf8")) });
    expect(seen.stdin.endsWith(`"request":${readFileSync(run.request_path, "utf8")}}`)).toBe(true);
    expect(seen.system_prompt).toBe((run.request as { instructions: string }).instructions);
    expect(seen.overlay).toMatch(/modelFallback: false/u);
    expect(seen.overlay).toMatch(/fallbackChains: \{\}/u);
    expect(seen.overlay).toMatch(/enabledProviders: \[\]/u);
    expect(seen.overlay).toMatch(/claude-md/u);

    const check = open();
    try {
      expect(counts(check)).toMatchObject({ annotations: 0, atoms: 1, candidates: 1 });
      expect(check.prepare("SELECT DISTINCT origin FROM proposals").all()).toEqual([{ origin: "luna" }]);
      expect(check.prepare("SELECT count(*) AS total FROM proposals WHERE status NOT IN ('pending', 'unresolved')").get()).toEqual({ total: 0 });
      expect(check.prepare("SELECT status, origin, kind FROM source_atom_proposals").get()).toEqual({ status: "pending", origin: "luna", kind: "participant" });
      // One gap each for the UNRESOLVED span, the implicit region, and the NOVEL leaf.
      expect(check.prepare("SELECT count(*) AS total FROM gaps WHERE status = 'open'").get()).toEqual({ total: 3 });
    } finally {
      check.close();
    }
  });

  it.each([
    ["a fenced reply", (body: string) => ({ body: `\`\`\`json\n${body}\n\`\`\`` }), "NOT_JSON_OBJECT"],
    ["two assistant messages", (body: string) => ({ body, extra_assistant: true }), "EXTRA_ASSISTANT_MESSAGE"],
    ["a different model", (body: string) => ({ body, provider: "deepseek", model: "deepseek-v4-flash" }), "MODEL_MISMATCH"],
    ["a fallback event", (body: string) => ({ body, extra_event: { type: "model_fallback", from: "a", to: "b" } }), "MODEL_FALLBACK"],
    ["a tool event", (body: string) => ({ body, extra_event: { type: "tool_execution_start" } }), "TOOL_USE"],
    ["an error stop reason", (body: string) => ({ body, stop_reason: "error" }), "MODEL_ERROR"],
    ["a nonzero exit", (body: string) => ({ body, exit_code: 1 }), "NONZERO_EXIT"],
    ["a truncated stream", () => ({ events: [{ type: "session" }, { type: "agent_start" }] }), "INCOMPLETE_STREAM"],
  ])("fails closed on %s with no proposals", async (_label, scenario, reasonCode) => {
    const db = open();
    const run = prepared(db);
    writeScenario(scenario(JSON.stringify(validResponse(run))));
    db.close();
    const view = await runLuna(open, run.run_id, { binary });
    expect(view.state).toBe("failed");
    expect(view.failure).toMatchObject({ stage: "transport", reason_code: reasonCode });
    const check = open();
    try {
      expect(counts(check)).toEqual({ proposals: 0, atoms: 0, annotations: 0, candidates: 0 });
    } finally {
      check.close();
    }
  });

  it("kills a subprocess that overruns its deadline", async () => {
    const db = open();
    const run = prepared(db);
    writeScenario({ body: JSON.stringify(validResponse(run)), sleep_ms: 5_000 });
    db.close();
    const view = await runLuna(open, run.run_id, { binary, hardKillMs: 200 });
    expect(view.failure).toMatchObject({ reason_code: "TIMEOUT" });
  });

  it("rejects a forged self-report and a malformed body atomically", async () => {
    const db = open();
    const forged = prepared(db, "forged");
    writeScenario({ body: JSON.stringify(validResponse(forged, { model: "deepseek-v4-flash" })) });
    db.close();
    expect((await runLuna(open, forged.run_id, { binary })).failure).toMatchObject({ stage: "import", reason_code: "INVALID_RESPONSE" });

    const second = open();
    const malformed = prepared(second, "malformed");
    const body = validResponse(malformed) as { abilities: Array<{ structural_spans: Array<Record<string, unknown>> }> };
    body.abilities[0]!.structural_spans[0]!.exact_text = "that unit";
    writeScenario({ body: JSON.stringify(body) });
    second.close();
    const view = await runLuna(open, malformed.run_id, { binary });
    expect(view.failure).toMatchObject({ stage: "import", reason_code: "INVALID_RESPONSE" });
    expect(view.failure!.message).not.toMatch(/glimmer/u);
    const check = open();
    try {
      expect(counts(check)).toEqual({ proposals: 0, atoms: 0, annotations: 0, candidates: 0 });
    } finally {
      check.close();
    }
  });

  it("refuses a second claim, early abandonment, and a late result after abandonment", async () => {
    const db = open();
    const run = prepared(db);
    const start = new Date("2026-01-01T00:00:00.000Z");
    const claim = claimLunaRun(db, run.run_id, { omp_version: "omp/test", now: start });
    expect(() => claimLunaRun(db, run.run_id, { omp_version: "omp/test" })).toThrow(/already claimed/u);
    expect(() => importLuna(db, { run_id: run.run_id, response: validResponse(run) })).toThrow(/claimed by a running OMP invocation/u);
    const early = new Date(start.getTime() + ABANDON_AFTER_MS - 1);
    expect(() => abandonLunaRun(db, { run_id: run.run_id, reason: "stuck" }, early)).toThrow(LunaRunError);
    const late = new Date(start.getTime() + ABANDON_AFTER_MS);
    expect(abandonLunaRun(db, { run_id: run.run_id, reason: "stuck after deadline" }, late)).toMatchObject({
      state: "failed",
      failure: { stage: "abandon", reason_code: "ABANDONED_AFTER_DEADLINE", message: "stuck after deadline" },
    });
    db.close();

    writeScenario({ body: JSON.stringify(validResponse(run)) });
    const view = await finishLunaRun(open, { run_id: Number(run.run_id), execution: claim }, { binary });
    expect(view.failure).toMatchObject({ stage: "abandon" });
    const check = open();
    try {
      expect(counts(check).proposals).toBe(0);
    } finally {
      check.close();
    }
  });

  it("abandons an unclaimed run at once and retries only a failed run as a linked new run", () => {
    const db = open();
    try {
      const run = prepared(db);
      const abilityId = (db.prepare("SELECT id FROM abilities").get() as { id: number }).id;
      expect(() => prepareLuna(db, { ability_version_id: abilityId })).toThrow(/pending Luna run/u);
      expect(() => prepareLuna(db, { ability_version_id: abilityId, retry_of: Number(run.run_id) })).toThrow(/Only a failed run/u);
      expect(abandonLunaRun(db, { run_id: run.run_id, reason: "operator closed" })).toMatchObject({ state: "failed", failure: { reason_code: "ABANDONED_UNCLAIMED" } });
      const retry = prepareLuna(db, { ability_version_id: abilityId, retry_of: Number(run.run_id) });
      expect(lunaRunView(db, retry.run_id)).toMatchObject({ state: "prepared", predecessor_run_id: Number(run.run_id) });
      expect(lunaRunView(db, run.run_id)).toMatchObject({ successor_run_id: Number(retry.run_id) });
      expect(abandonLunaRun(db, { run_id: retry.run_id, reason: "again" }).state).toBe("failed");
      expect(() => prepareLuna(db, { ability_version_id: abilityId, retry_of: Number(run.run_id) })).toThrow(/already retried/u);
    } finally {
      db.close();
    }
  });

  it("refuses to claim or import against a changed source", async () => {
    const db = open();
    const run = prepared(db);
    db.prepare("UPDATE abilities SET current = 0").run();
    await expect(startLunaRun(db, run.run_id, { binary })).rejects.toThrow(/changed after this run was prepared/u);
    db.prepare("UPDATE abilities SET current = 1").run();
    const claimed = await startLunaRun(db, run.run_id, { binary });
    db.prepare("UPDATE abilities SET current = 0").run();
    db.close();
    writeScenario({ body: JSON.stringify(validResponse(run)) });
    const view = await finishLunaRun(open, claimed, { binary });
    expect(view.failure).toMatchObject({ reason_code: "SOURCE_STALE" });
  });

  it("reports an unavailable binary as 503 before claiming", async () => {
    const db = open();
    try {
      const run = prepared(db);
      await expect(startLunaRun(db, run.run_id, { binary: join(root, "missing-omp") })).rejects.toMatchObject({ status: 503 });
      expect(lunaRunView(db, run.run_id).state).toBe("prepared");
    } finally {
      db.close();
    }
  });

  it("labels an offline import of a v2 run as unverified external work", () => {
    const db = open();
    try {
      const run = prepared(db);
      importLuna(db, { run_id: run.run_id, response: validResponse(run) });
      expect(db.prepare("SELECT DISTINCT origin FROM proposals").all()).toEqual([{ origin: "external" }]);
      expect(db.prepare("SELECT model, model_version FROM model_runs WHERE id = ?").get(Number(run.run_id))).toEqual({ model: "external", model_version: "unverified" });
    } finally {
      db.close();
    }
  });

  it("still imports a run prepared under the v1 contract with its original meaning", () => {
    const db = open();
    try {
      const id = insertAbility(db, "legacy", "Re-roll a Hit roll of 1.");
      const ability = db.prepare("SELECT faction_id, ability_id, source_hash FROM abilities WHERE id = ?").get(id) as { faction_id: string; ability_id: string; source_hash: string };
      const end = Buffer.byteLength("Re-roll a Hit roll of 1");
      const runId = Number(db.prepare(`
        INSERT INTO model_runs (model, model_version, prompt_version, input_hash, config_json, status, created_at)
        VALUES ('luna', 'unknown', 'v1', ?, ?, 'pending', '2026-01-01T00:00:00.000Z')
      `).run("a".repeat(64), JSON.stringify({
        schema_version: 1, request_schema_version: 1, request_path: "legacy", request_bytes: 1, manual_review_abilities: [],
        request_abilities: [{ ability_version_id: id, ...ability, uncovered_regions: [{ fragment: "RAW_TEXT", start_byte: 0, end_byte: end }] }],
      })).lastInsertRowid);
      const result = importLuna(db, { run_id: String(runId), response: {
        schema_version: 1, input_hash: "a".repeat(64), model: "luna", model_version: "legacy", prompt_version: "v1",
        abilities: [{ ...ability, spans: [{ start_byte: 0, end_byte: end, exact_text: "Re-roll a Hit roll of 1", role: "EFFECT", status: "EXISTING", family_id: "reroll", family_version: 2, parameters: { roll: "hit", subset: "ones", weapon_type: "all" } }], connectives: [], unresolved_regions: [] }],
      } });
      expect(result).toMatchObject({ proposals: 1, structural: 0 });
      expect(db.prepare("SELECT origin FROM proposals").get()).toEqual({ origin: "luna" });
    } finally {
      db.close();
    }
  });
});

describe("OMP event-stream parser", () => {
  const message = (text: string, extra: Record<string, unknown> = {}) => ({ role: "assistant", content: [{ type: "text", text }], provider: "openai-codex", model: "gpt-5.6-luna", stopReason: "stop", ...extra });
  const stream = (events: unknown[]) => events.map((event) => JSON.stringify(event)).join("\n");

  it("uses streamed deltas only when no terminal body exists", () => {
    const parsed = extractAssistantJson(stream([
      { type: "session" },
      { type: "message_start", message: message("") },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "{\"ok\":" } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "true}" } },
      { type: "agent_end", messages: [] },
    ]), LUNA_MODEL);
    expect(parsed.body).toEqual({ ok: true });
  });

  it("names the provider's error from a failed stream, preferring the last", () => {
    expect(providerError(stream([
      { type: "session" },
      { type: "turn_end", message: { ...message(""), stopReason: "error", errorMessage: "first failure" } },
      { type: "auto_retry_end", success: false, finalError: "usage limit reached" },
    ]) + "\n{\"errorMessage\": trunc")).toBe("usage limit reached");
    expect(providerError(stream([{ type: "session" }, { type: "agent_end", messages: [] }]))).toBeNull();
  });

  it("rejects a non-JSON line and a missing session header", () => {
    expect(() => extractAssistantJson("not json", LUNA_MODEL)).toThrow(OmpTransportError);
    expect(() => extractAssistantJson(stream([{ type: "agent_end", messages: [message("{}")] }]), LUNA_MODEL)).toThrow(/session header/u);
  });
});

describe("v2 exact-text offset anchoring", () => {
  it("re-anchors a miscounted offset to the nearest exact text, flags it, and rejects ties and far jumps", async () => {
    const { anchorExactText } = await import("../src/round5c/luna-v2.js");
    const source = "Roll one and roll two and stop.";
    const second = Buffer.byteLength("Roll one and roll two ");
    expect(anchorExactText(source, second, second + 3, "and", "x")).toEqual({ start_byte: second, end_byte: second + 3, repaired: false });
    // One byte off, nearest occurrence wins and is flagged.
    expect(anchorExactText(source, second + 1, second + 4, "and", "x")).toEqual({ start_byte: second, end_byte: second + 3, repaired: true });
    // Equidistant from both occurrences: refuse rather than guess.
    const first = Buffer.byteLength("Roll one ");
    const midpoint = (first + second) / 2;
    expect(() => anchorExactText(source, midpoint, midpoint + 3, "and", "x")).toThrow(/unambiguously/u);
    expect(() => anchorExactText(source, 0, 3, "missing", "x")).toThrow(/does not match source bytes/u);
    const far = `${"filler ".repeat(12)}target`;
    expect(() => anchorExactText(far, 0, 6, "target", "x")).toThrow(/unambiguously/u);
  });

  it("records a repaired span on its pending proposal without widening what the model claimed", () => {
    const db = open();
    try {
      const run = prepared(db);
      const body = validResponse(run) as { abilities: Array<{ spans: Array<Record<string, unknown>> }> };
      const effect = body.abilities[0]!.spans[1]!;
      effect.start_byte = (effect.start_byte as number) + 2;
      effect.end_byte = (effect.end_byte as number) + 2;
      importLuna(db, { run_id: run.run_id, response: body });
      const row = db.prepare(`
        SELECT source_spans.exact_text, json_extract(proposals.reason_json, '$.offset_repaired') AS repaired
        FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id WHERE proposals.fingerprint_id IS NOT NULL
      `).get();
      expect(row).toEqual({ exact_text: "re-roll a Hit roll of 1", repaired: 1 });
    } finally {
      db.close();
    }
  });
});
