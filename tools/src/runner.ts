#!/usr/bin/env node
/**
 * NDJSON conformance runner — the TypeScript implementation of the wire
 * protocol in `conformance/RUNNER_PROTOCOL.md`. Each line on stdin is a JSON
 * request `{op, args?}`; each line on stdout is a JSON response
 * `{ok: true, value}` or `{ok: false, error_kind, error_payload?}`.
 *
 * This file exports {@link processRequest} so vitest can drive the runner
 * in-process without spawning a child; the bottom `if (isCliMain())` block
 * wires the same dispatcher to real stdin/stdout for the cross-impl differ.
 *
 * The runner is a *thin* wrapper over the existing public API — it is not the
 * canonical way to use the package. Library consumers should import the
 * functions directly; the runner exists to give the cross-implementation
 * differ a uniform interface across language ports.
 */
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { Dataset } from "./data/dataset.js";
import { normalizeName } from "./data/normalize.js";
import { exportRoster, type ExportFormat } from "./export/index.js";
import { importRoster, tryImportRoster, REGISTERED_ADAPTERS } from "./import/import-roster.js";
import { selectAdapter } from "./import/adapter.js";
import { createValidator } from "./schema-loader.js";
import { attributeStages, crunch, type Buff, type EngineContext, type EngineInput } from "./cruncher/index.js";
import type Ajv from "ajv";

// -----------------------------------------------------------------------------
// Constants — spec version and implementation identity.
// -----------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSpecVersion(): number {
  // The corpus lives at repo-root/conformance/. Walk up from tools/src/ until
  // we find it so the runner works both from source (tsx) and from dist/.
  for (const candidate of [
    join(__dirname, "../../conformance/SPEC_VERSION"),
    join(__dirname, "../../../conformance/SPEC_VERSION"),
  ]) {
    try {
      return Number.parseInt(readFileSync(candidate, "utf8").trim(), 10);
    } catch {
      // try next
    }
  }
  throw new Error("could not locate conformance/SPEC_VERSION");
}

function loadImplVersion(): string {
  for (const candidate of [
    join(__dirname, "../package.json"),
    join(__dirname, "../../package.json"),
  ]) {
    try {
      return (JSON.parse(readFileSync(candidate, "utf8")) as { version: string }).version;
    } catch {
      // try next
    }
  }
  return "unknown";
}

const SPEC_VERSION = loadSpecVersion();
const IMPL_VERSION = loadImplVersion();
const IMPL_NAME = "ts";

// -----------------------------------------------------------------------------
// Error envelope helpers and the closed `error_kind` enum.
// -----------------------------------------------------------------------------

export type RunnerResponse =
  | { ok: true; value: unknown }
  | { ok: false; error_kind: ErrorKind; error_payload?: unknown };

const ERROR_KINDS = [
  "INVALID_INPUT",
  "UNKNOWN_OP",
  "UNKNOWN_ENTITY",
  "IMPORT_FAILED",
  "EXPORT_FAILED",
  "VALIDATION_ERROR",
  "CRUNCH_ERROR",
  "INTERNAL_ERROR",
] as const;
type ErrorKind = (typeof ERROR_KINDS)[number];

function ok(value: unknown): RunnerResponse {
  return { ok: true, value };
}
function err(kind: ErrorKind, payload?: unknown): RunnerResponse {
  return payload === undefined
    ? { ok: false, error_kind: kind }
    : { ok: false, error_kind: kind, error_payload: payload };
}

// -----------------------------------------------------------------------------
// Runner state — init must be the first request; subsequent ops fail with
// INVALID_INPUT until init succeeds. Dataset and validator are lazy.
// -----------------------------------------------------------------------------

export interface RunnerState {
  initialized: boolean;
  locale: string;
  tz: string;
  seed: number;
  dataset?: Dataset;
  validator?: Ajv;
}

export function createRunnerState(): RunnerState {
  return { initialized: false, locale: "C", tz: "UTC", seed: 0 };
}

function getDataset(state: RunnerState): Dataset {
  if (!state.dataset) state.dataset = Dataset.embedded();
  return state.dataset;
}

function getValidator(state: RunnerState): Ajv {
  if (!state.validator) state.validator = createValidator();
  return state.validator;
}

// -----------------------------------------------------------------------------
// Op handlers.
// -----------------------------------------------------------------------------

function handleInit(state: RunnerState, args: unknown): RunnerResponse {
  if (state.initialized) {
    return err("INVALID_INPUT", { detail: "init called twice" });
  }
  if (typeof args !== "object" || args === null) {
    return err("INVALID_INPUT", { detail: "init args must be an object" });
  }
  const a = args as { spec_version?: unknown; locale?: unknown; tz?: unknown; seed?: unknown };
  if (a.spec_version !== SPEC_VERSION) {
    return err("INVALID_INPUT", {
      detail: `spec_version mismatch: runner=${SPEC_VERSION}, request=${String(a.spec_version)}`,
    });
  }
  if (a.locale !== "C") {
    return err("INVALID_INPUT", { detail: `unsupported locale: ${String(a.locale)} (only "C")` });
  }
  if (a.tz !== "UTC") {
    return err("INVALID_INPUT", { detail: `unsupported tz: ${String(a.tz)} (only "UTC")` });
  }
  if (typeof a.seed !== "number") {
    return err("INVALID_INPUT", { detail: "seed must be a number" });
  }
  state.initialized = true;
  state.locale = a.locale;
  state.tz = a.tz;
  state.seed = a.seed;
  return ok({ impl: IMPL_NAME, spec_version: SPEC_VERSION, impl_version: IMPL_VERSION });
}

function handleNormalize(args: unknown): RunnerResponse {
  if (typeof args !== "object" || args === null) {
    return err("INVALID_INPUT", { detail: "normalize args must be an object" });
  }
  const a = args as { input?: unknown };
  if (typeof a.input !== "string") {
    return err("INVALID_INPUT", { detail: "normalize.input must be a string" });
  }
  return ok(normalizeName(a.input));
}

function handleImport(state: RunnerState, args: unknown): RunnerResponse {
  if (typeof args !== "object" || args === null) {
    return err("INVALID_INPUT", { detail: "import args must be an object" });
  }
  const a = args as { format?: unknown; input?: unknown };
  if (typeof a.input !== "string") {
    return err("INVALID_INPUT", { detail: "import.input must be a string" });
  }
  try {
    // The wire protocol carries every input as a string: JSON payloads come
    // through as the JSON text, text payloads come through as-is. The import
    // pipeline decides which by attempting to parse JSON first.
    const trimmed = a.input.trimStart();
    let decoded: unknown;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        decoded = JSON.parse(a.input);
      } catch {
        decoded = a.input;
      }
    } else {
      decoded = a.input;
    }
    const roster = importRoster(decoded, { dataset: getDataset(state) });
    return ok(roster);
  } catch (e) {
    return err("IMPORT_FAILED", { detail: (e as Error).message, format: a.format ?? null });
  }
}

function handleTryImport(state: RunnerState, args: unknown): RunnerResponse {
  if (typeof args !== "object" || args === null) {
    return err("INVALID_INPUT", { detail: "try_import args must be an object" });
  }
  const a = args as { input?: unknown };
  if (typeof a.input !== "string") {
    return err("INVALID_INPUT", { detail: "try_import.input must be a string" });
  }
  const result = tryImportRoster(a.input, { dataset: getDataset(state) });
  if (!result.ok) {
    return err("IMPORT_FAILED", { reason: result.reason, message: result.message });
  }
  return ok({ format: result.format, roster: result.roster });
}

const EXPORT_FORMATS: ExportFormat[] = [
  "newrecruit-json",
  "newrecruit-wtc-compact",
  "newrecruit-wtc-full",
  "newrecruit-simple",
  "roster-json",
  "rosterizer",
];

function handleExport(args: unknown): RunnerResponse {
  if (typeof args !== "object" || args === null) {
    return err("INVALID_INPUT", { detail: "export args must be an object" });
  }
  const a = args as { format?: unknown; roster?: unknown };
  if (typeof a.format !== "string" || !EXPORT_FORMATS.includes(a.format as ExportFormat)) {
    return err("INVALID_INPUT", { detail: `unknown export format: ${String(a.format)}` });
  }
  if (typeof a.roster !== "object" || a.roster === null) {
    return err("INVALID_INPUT", { detail: "export.roster must be an object" });
  }
  try {
    // We assume the caller passes the canonical resolved Roster shape; if they
    // pass something the serializer can't handle, this throws.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ok(exportRoster(a.roster as any, a.format as ExportFormat));
  } catch (e) {
    return err("EXPORT_FAILED", { detail: (e as Error).message });
  }
}

function handleLinkedQuery(state: RunnerState, args: unknown): RunnerResponse {
  if (typeof args !== "object" || args === null) {
    return err("INVALID_INPUT", { detail: "linked_query args must be an object" });
  }
  const a = args as { query?: unknown; input?: unknown };
  if (typeof a.query !== "string") {
    return err("INVALID_INPUT", { detail: "linked_query.query must be a string" });
  }
  const ds = getDataset(state);
  const input = (a.input ?? {}) as Record<string, string>;
  try {
    switch (a.query) {
      case "find_unit":
        return ok(ds.units.find(input.query ?? "")?.id ?? null);
      case "find_weapon":
        return ok(ds.weapons.find(input.query ?? "")?.id ?? null);
      case "find_faction":
        return ok(ds.factions.find(input.query ?? "")?.id ?? null);
      case "find_ability":
        return ok(ds.abilities.find(input.query ?? "")?.id ?? null);
      case "abilities_of": {
        const u = ds.units.get(input.unitId);
        if (!u) return err("UNKNOWN_ENTITY", { kind: "unit", id: input.unitId });
        return ok(u.abilities.map((x) => x.id));
      }
      case "weapons_of": {
        const u = ds.units.get(input.unitId);
        if (!u) return err("UNKNOWN_ENTITY", { kind: "unit", id: input.unitId });
        return ok(u.weapons.map((x) => x.id));
      }
      case "phases_of": {
        const ab = ds.abilities.get(input.abilityId);
        if (!ab) return err("UNKNOWN_ENTITY", { kind: "ability", id: input.abilityId });
        return ok([...ab.phases]);
      }
      case "faction_of": {
        const u = ds.units.get(input.unitId);
        if (!u) return err("UNKNOWN_ENTITY", { kind: "unit", id: input.unitId });
        return ok(u.faction?.id ?? null);
      }
      case "abilities_of_faction":
        return ok(ds.abilities.byFaction(input.factionId).map((x) => x.id));
      case "weapons_of_faction": {
        const f = ds.factions.get(input.factionId);
        if (!f) return err("UNKNOWN_ENTITY", { kind: "faction", id: input.factionId });
        return ok(f.weapons.map((x) => x.id));
      }
      default:
        return err("INVALID_INPUT", { detail: `unknown linked_query: ${a.query}` });
    }
  } catch (e) {
    return err("INTERNAL_ERROR", { detail: (e as Error).message });
  }
}

const VALIDATOR_TARGETS: Record<string, string> = {
  unit: "https://40kdc.dev/schemas/core/unit.schema.json",
  weapon: "https://40kdc.dev/schemas/core/weapon.schema.json",
  faction: "https://40kdc.dev/schemas/core/faction.schema.json",
  ability: "https://40kdc.dev/schemas/enrichment/ability-dsl/ability.schema.json",
};

function ajvKeywordToCode(keyword: string): string {
  switch (keyword) {
    case "required":
      return "REQUIRED_MISSING";
    case "type":
      return "TYPE_MISMATCH";
    case "enum":
      return "ENUM_VIOLATION";
    case "pattern":
    case "format":
      return "PATTERN_MISMATCH";
    case "minimum":
    case "maximum":
    case "exclusiveMinimum":
    case "exclusiveMaximum":
    case "minLength":
    case "maxLength":
    case "minItems":
    case "maxItems":
      return "RANGE_VIOLATION";
    case "additionalProperties":
      return "ADDITIONAL_PROPERTY";
    case "uniqueItems":
      return "UNIQUE_VIOLATION";
    default:
      return `UNMAPPED:${keyword}`;
  }
}

function handleValidate(state: RunnerState, args: unknown): RunnerResponse {
  if (typeof args !== "object" || args === null) {
    return err("INVALID_INPUT", { detail: "validate args must be an object" });
  }
  const a = args as { target?: unknown; value?: unknown };
  if (typeof a.target !== "string" || !(a.target in VALIDATOR_TARGETS)) {
    return err("INVALID_INPUT", { detail: `unknown validator target: ${String(a.target)}` });
  }
  let validate;
  try {
    validate = getValidator(state).getSchema(VALIDATOR_TARGETS[a.target]);
  } catch (e) {
    return err("VALIDATION_ERROR", { detail: (e as Error).message });
  }
  if (!validate) {
    return err("VALIDATION_ERROR", { detail: `schema not loaded: ${a.target}` });
  }
  validate(a.value);
  const raw = validate.errors ?? [];
  const seen = new Set<string>();
  const out: { path: string; code: string }[] = [];
  for (const e of raw) {
    const code = ajvKeywordToCode(e.keyword);
    if (code.startsWith("UNMAPPED:")) continue;
    const path =
      e.keyword === "required"
        ? `${e.instancePath}/${(e.params as { missingProperty?: string }).missingProperty ?? ""}`
        : e.instancePath;
    const key = `${path}|${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, code });
  }
  return ok(out);
}

interface CrunchArgs {
  attacker?: { weaponId?: string; profileIndex?: number };
  modelsFiring?: number;
  target?: { unitId?: string; profileIndex?: number; modelCount?: number };
  context?: EngineContext;
  buffs?: Buff[];
}

/**
 * Validate the wire-shape `crunch`/`attribution` args and assemble the
 * {@link EngineInput} both ops share, or return a typed runner error. The two
 * ops have identical inputs — separating this lets each handler stay tiny and
 * keeps the validation contract in one place.
 */
function buildEngineInput(
  state: RunnerState,
  a: CrunchArgs,
  opName: string,
): { ok: true; input: EngineInput } | { ok: false; response: RunnerResponse } {
  if (!a.attacker?.weaponId || typeof a.attacker.profileIndex !== "number") {
    return { ok: false, response: err("INVALID_INPUT", { detail: `${opName}.attacker.weaponId/profileIndex required` }) };
  }
  if (!a.target?.unitId || typeof a.target.profileIndex !== "number") {
    return { ok: false, response: err("INVALID_INPUT", { detail: `${opName}.target.unitId/profileIndex required` }) };
  }
  if (typeof a.modelsFiring !== "number") {
    return { ok: false, response: err("INVALID_INPUT", { detail: `${opName}.modelsFiring required` }) };
  }
  if (!a.context) {
    return { ok: false, response: err("INVALID_INPUT", { detail: `${opName}.context required` }) };
  }
  const ds = getDataset(state);
  const weapon = ds.weapons.get(a.attacker.weaponId);
  if (!weapon) return { ok: false, response: err("UNKNOWN_ENTITY", { kind: "weapon", id: a.attacker.weaponId }) };
  const unit = ds.units.get(a.target.unitId);
  if (!unit) return { ok: false, response: err("UNKNOWN_ENTITY", { kind: "unit", id: a.target.unitId }) };
  const input: EngineInput = {
    attacker: { weapon: weapon.raw, profileIndex: a.attacker.profileIndex },
    target: {
      unit: unit.raw,
      profileIndex: a.target.profileIndex,
      ...(a.target.modelCount !== undefined ? { modelCount: a.target.modelCount } : {}),
    },
    modelsFiring: a.modelsFiring,
    buffs: a.buffs ?? [],
    context: a.context,
  };
  return { ok: true, input };
}

function handleCrunch(state: RunnerState, args: unknown): RunnerResponse {
  if (typeof args !== "object" || args === null) {
    return err("INVALID_INPUT", { detail: "crunch args must be an object" });
  }
  const built = buildEngineInput(state, args as CrunchArgs, "crunch");
  if (!built.ok) return built.response;
  try {
    // Canonical wire shape: stages array only. `resolved` is impl-internal
    // (TS/Rust shape diverges); per-stage `detail` strings aren't byte-equal
    // across impls. The differ compares per-stage `expected` with 5e-4
    // tolerance — that's the cross-impl contract.
    const out = crunch(built.input, getDataset(state));
    return ok({ stages: out.stages.map((s) => ({ name: s.name, expected: s.expected })) });
  } catch (e) {
    return err("CRUNCH_ERROR", { detail: (e as Error).message });
  }
}

function handleAttribution(state: RunnerState, args: unknown): RunnerResponse {
  if (typeof args !== "object" || args === null) {
    return err("INVALID_INPUT", { detail: "attribution args must be an object" });
  }
  const a = args as CrunchArgs & { epsilon?: number };
  const built = buildEngineInput(state, a, "attribution");
  if (!built.ok) return built.response;
  try {
    const opts = typeof a.epsilon === "number" ? { epsilon: a.epsilon } : undefined;
    // Drop `detail` from the wire (impl-specific formatting). Keep all
    // numeric fields and the kind-tagged BuffSource shape that's already
    // serde-compatible.
    const stages = attributeStages(built.input, getDataset(state), opts);
    return ok(
      stages.map((s) => ({
        name: s.name,
        expected: s.expected,
        baseline: s.baseline,
        lifts: s.lifts,
        residual: s.residual,
        intrinsics: s.intrinsics,
      })),
    );
  } catch (e) {
    return err("CRUNCH_ERROR", { detail: (e as Error).message });
  }
}

// -----------------------------------------------------------------------------
// Dispatcher and per-line entry point.
// -----------------------------------------------------------------------------

/**
 * Apply one decoded request to the runner state and return the response. Used
 * directly by tests; the CLI loop wraps it with line parsing.
 */
export function dispatch(state: RunnerState, req: { op: string; args?: unknown }): RunnerResponse {
  if (!state.initialized && req.op !== "init") {
    return err("INVALID_INPUT", { detail: "must init before any other op" });
  }
  switch (req.op) {
    case "init":
      return handleInit(state, req.args);
    case "version":
      return ok({ impl: IMPL_NAME, spec_version: SPEC_VERSION, impl_version: IMPL_VERSION });
    case "normalize":
      return handleNormalize(req.args);
    case "import":
      return handleImport(state, req.args);
    case "try_import":
      return handleTryImport(state, req.args);
    case "export":
      return handleExport(req.args);
    case "linked_query":
      return handleLinkedQuery(state, req.args);
    case "validate":
      return handleValidate(state, req.args);
    case "crunch":
      return handleCrunch(state, req.args);
    case "attribution":
      return handleAttribution(state, req.args);
    case "shutdown":
      return ok(null);
    default:
      return err("UNKNOWN_OP", { op: req.op });
  }
}

/**
 * Process one line of stdin (one NDJSON request) and return the line that
 * should be written to stdout (one NDJSON response). Returns `null` only on
 * fully-empty input lines, which should be silently ignored.
 */
export function processRequest(state: RunnerState, line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  let req: { op?: unknown; args?: unknown };
  try {
    req = JSON.parse(trimmed);
  } catch (e) {
    return JSON.stringify(err("INVALID_INPUT", { detail: `not valid JSON: ${(e as Error).message}` }));
  }
  if (typeof req.op !== "string") {
    return JSON.stringify(err("INVALID_INPUT", { detail: "request must have a string `op` field" }));
  }
  const response = dispatch(state, { op: req.op, args: req.args });
  return JSON.stringify(response);
}

// -----------------------------------------------------------------------------
// CLI: wire stdin/stdout. Only runs when this file is the process entry point.
// -----------------------------------------------------------------------------

function isCliMain(): boolean {
  // process.argv[1] is the path the runtime invoked. With tsx and node both,
  // it points at this file (or its compiled .js form). Comparing absolute
  // paths is the most robust portable check.
  if (!process.argv[1]) return false;
  const entry = process.argv[1];
  const here = fileURLToPath(import.meta.url);
  return entry === here || entry.endsWith("/runner.js") || entry.endsWith("/runner.ts");
}

async function runCli(): Promise<void> {
  const state = createRunnerState();
  const rl = createInterface({ input: process.stdin });
  // We must respond on the same tick the request arrives — the differ
  // pipelines requests and expects responses in order. readline preserves
  // line ordering, so processing inside `line` handler is sufficient.
  for await (const line of rl) {
    const out = processRequest(state, line);
    if (out !== null) {
      process.stdout.write(out + "\n");
    }
    // `shutdown` returns `ok(null)`; honor it by exiting after the response
    // is flushed.
    try {
      const req = JSON.parse(line);
      if (req && req.op === "shutdown") {
        process.exit(0);
      }
    } catch {
      // already handled above; not a shutdown
    }
  }
}

if (isCliMain()) {
  runCli().catch((e) => {
    // Last-ditch INTERNAL_ERROR so the differ sees a typed failure rather
    // than an opaque crash.
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error_kind: "INTERNAL_ERROR",
        error_payload: { detail: (e as Error).message },
      }) + "\n",
    );
    process.exit(1);
  });
}
