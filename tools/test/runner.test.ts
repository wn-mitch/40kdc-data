/**
 * Test the NDJSON runner in-process. We import {@link processRequest} and
 * {@link createRunnerState} directly so the test runs without spawning a
 * subprocess; the CLI loop in `runner.ts` is a thin wrapper over the same
 * dispatcher.
 *
 * A separate end-to-end test (`runner-cli.test.ts`) verifies the CLI
 * integration via `tsx`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createRunnerState, processRequest, type RunnerState } from "../src/runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_VERSION_PATH = join(__dirname, "../../conformance/SPEC_VERSION");
const SPEC_VERSION = Number.parseInt(readFileSync(SPEC_VERSION_PATH, "utf8").trim(), 10);

function send(state: RunnerState, req: unknown): { ok: boolean; value?: unknown; error_kind?: string; error_payload?: unknown } {
  const line = processRequest(state, JSON.stringify(req));
  if (line === null) throw new Error("empty line; test did not expect that");
  return JSON.parse(line);
}

function init(state: RunnerState): void {
  const resp = send(state, {
    op: "init",
    args: { spec_version: SPEC_VERSION, locale: "C", tz: "UTC", seed: 0 },
  });
  expect(resp.ok).toBe(true);
}

describe("runner: handshake", () => {
  it("init must come first", () => {
    const state = createRunnerState();
    const resp = send(state, { op: "normalize", args: { input: "Khârn" } });
    expect(resp.ok).toBe(false);
    expect(resp.error_kind).toBe("INVALID_INPUT");
  });

  it("init accepts the current spec_version", () => {
    const state = createRunnerState();
    const resp = send(state, {
      op: "init",
      args: { spec_version: SPEC_VERSION, locale: "C", tz: "UTC", seed: 0 },
    });
    expect(resp.ok).toBe(true);
    const value = resp.value as { impl: string; spec_version: number };
    expect(value.impl).toBe("ts");
    expect(value.spec_version).toBe(SPEC_VERSION);
  });

  it("init rejects spec_version mismatch", () => {
    const state = createRunnerState();
    const resp = send(state, {
      op: "init",
      args: { spec_version: SPEC_VERSION + 99, locale: "C", tz: "UTC", seed: 0 },
    });
    expect(resp.ok).toBe(false);
    expect(resp.error_kind).toBe("INVALID_INPUT");
  });

  it("init rejects non-C locale", () => {
    const state = createRunnerState();
    const resp = send(state, {
      op: "init",
      args: { spec_version: SPEC_VERSION, locale: "tr_TR", tz: "UTC", seed: 0 },
    });
    expect(resp.ok).toBe(false);
    expect(resp.error_kind).toBe("INVALID_INPUT");
  });

  it("init twice is rejected", () => {
    const state = createRunnerState();
    init(state);
    const resp = send(state, {
      op: "init",
      args: { spec_version: SPEC_VERSION, locale: "C", tz: "UTC", seed: 0 },
    });
    expect(resp.ok).toBe(false);
  });

  it("unknown op returns UNKNOWN_OP", () => {
    const state = createRunnerState();
    init(state);
    const resp = send(state, { op: "made-up-op" });
    expect(resp.error_kind).toBe("UNKNOWN_OP");
  });

  it("version op reports impl identity and spec_version", () => {
    const state = createRunnerState();
    init(state);
    const resp = send(state, { op: "version" });
    expect(resp.ok).toBe(true);
    const v = resp.value as { impl: string; spec_version: number };
    expect(v.impl).toBe("ts");
    expect(v.spec_version).toBe(SPEC_VERSION);
  });
});

describe("runner: ops dispatch through the public API", () => {
  it("normalize matches the library function", () => {
    const state = createRunnerState();
    init(state);
    expect(send(state, { op: "normalize", args: { input: "Khârn the Betrayer" } }).value).toBe(
      "kharn the betrayer",
    );
    expect(send(state, { op: "normalize", args: { input: "Khorne Lord" } }).value).toBe(
      "khorne lord",
    );
  });

  it("linked_query/find_unit resolves a diacritic-bearing name", () => {
    const state = createRunnerState();
    init(state);
    const resp = send(state, {
      op: "linked_query",
      args: { query: "find_unit", input: { query: "Kharn" } },
    });
    expect(resp.value).toBe("kharn-the-betrayer");
  });

  it("linked_query/abilities_of returns an ordered id list", () => {
    const state = createRunnerState();
    init(state);
    const resp = send(state, {
      op: "linked_query",
      args: { query: "abilities_of", input: { unitId: "kharn-the-betrayer" } },
    });
    expect(resp.value).toEqual(["berzerker-frenzy", "leader", "legendary-killer", "the-betrayer"]);
  });

  it("linked_query rejects an unknown unit with UNKNOWN_ENTITY", () => {
    const state = createRunnerState();
    init(state);
    const resp = send(state, {
      op: "linked_query",
      args: { query: "abilities_of", input: { unitId: "not-a-unit" } },
    });
    expect(resp.error_kind).toBe("UNKNOWN_ENTITY");
  });

  it("validate returns the closed-enum error codes", () => {
    const state = createRunnerState();
    init(state);
    const resp = send(state, {
      op: "validate",
      args: {
        target: "unit",
        value: {
          id: "x",
          name: "X",
          faction_id: "y",
          role: "character",
          profiles: [
            { name: "X", M: 6, T: 4, W: 4, Sv: 99, invuln_sv: null, Ld: 6, OC: 1 },
          ],
          points: [{ models: 1, cost: 80 }],
          keywords: ["Infantry"],
          faction_keywords: ["X"],
          base_size_mm: { shape: "round", diameter: 32 },
          model_count: { min: 1, max: 1 },
          weapon_ids: ["w"],
          game_version: { edition: "10th", dataslate: "2025-q3" },
          is_legend: false,
        },
      },
    });
    expect(resp.ok).toBe(true);
    const errors = resp.value as { path: string; code: string }[];
    expect(errors.some((e) => e.path === "/profiles/0/Sv" && e.code === "RANGE_VIOLATION")).toBe(true);
  });

  it("crunch with a known weapon/unit returns 7 stages", () => {
    const state = createRunnerState();
    init(state);
    const resp = send(state, {
      op: "crunch",
      args: {
        attacker: { weaponId: "bolt-rifle", profileIndex: 0 },
        modelsFiring: 5,
        target: { unitId: "intercessor-squad", profileIndex: 0 },
        context: { phase: "shooting", attackerStationary: false, withinHalfRange: false },
        buffs: [],
      },
    });
    expect(resp.ok).toBe(true);
    const out = resp.value as { stages: { name: string }[] };
    expect(out.stages).toHaveLength(7);
    expect(out.stages[0].name).toBe("attacks");
  });

  it("shutdown returns ok null (CLI exits separately)", () => {
    const state = createRunnerState();
    init(state);
    const resp = send(state, { op: "shutdown" });
    expect(resp.ok).toBe(true);
    expect(resp.value).toBeNull();
  });
});

describe("runner: input hygiene", () => {
  it("malformed JSON returns INVALID_INPUT without crashing", () => {
    const state = createRunnerState();
    const line = processRequest(state, "{not json");
    expect(line).not.toBeNull();
    const resp = JSON.parse(line!);
    expect(resp.error_kind).toBe("INVALID_INPUT");
  });

  it("missing op field returns INVALID_INPUT", () => {
    const state = createRunnerState();
    const resp = send(state, { args: { foo: "bar" } });
    expect(resp.error_kind).toBe("INVALID_INPUT");
  });

  it("empty line is silently ignored", () => {
    const state = createRunnerState();
    expect(processRequest(state, "")).toBeNull();
    expect(processRequest(state, "   \t  ")).toBeNull();
  });
});
