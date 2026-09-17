import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { MfmDump } from "../src/mfm/loader.js";
import {
  MFM_SYNC_COMMANDS,
  runMfmSync,
  runMfmSyncCli,
  type MfmSyncDependencies,
} from "../src/mfm/sync.js";
import type { ContractReport } from "../src/mfm/gen-dump-schema.js";
import {
  mergePointsAndCompositionTierWrites,
  type IngestMfmCommand,
  type IngestMfmOptions,
} from "../src/ingest-mfm.js";

const TEMP_DIR = mkdtempSync(path.join(tmpdir(), "mfm-sync-test-"));
const DUMP_PATH = path.join(TEMP_DIR, "dump.json");
writeFileSync(DUMP_PATH, "{}\n");

const CONTRACT_REPORT: ContractReport = {
  ok: true,
  errors: [],
  tables: { observed: 0, total: 0 },
  paths: { observed: 0, total: 0 },
  mappings: { present: 0, total: 0 },
  coverage: {},
};

const SYNTHETIC_DUMP = new MfmDump({ metadata: { data_version: 867 }, data: {} });

type CommandCall = { command: IngestMfmCommand; options: IngestMfmOptions };

function dependencies(
  calls: CommandCall[],
  overrides: Partial<MfmSyncDependencies> = {},
): MfmSyncDependencies {
  return {
    checkContract: async () => CONTRACT_REPORT,
    loadDump: () => SYNTHETIC_DUMP,
    runCommand: async (command, options) => {
      calls.push({ command, options });
    },
    ...overrides,
  };
}

afterAll(() => rmSync(TEMP_DIR, { recursive: true, force: true }));

describe("MFM sync", () => {
  it("requires --dump before calling any dependency", async () => {
    const calls: CommandCall[] = [];
    await expect(runMfmSyncCli(["--write"], dependencies(calls))).rejects.toThrow("--dump is required.");
    expect(calls).toEqual([]);
  });

  it("requires --write before calling any dependency", async () => {
    const calls: CommandCall[] = [];
    await expect(runMfmSyncCli(["--dump", DUMP_PATH], dependencies(calls))).rejects.toThrow("--write is required.");
    expect(calls).toEqual([]);
  });

  it("rejects unknown CLI flags before calling any dependency", async () => {
    const calls: CommandCall[] = [];
    await expect(runMfmSyncCli(["--dump", DUMP_PATH, "--write", "--unexpected"], dependencies(calls))).rejects.toThrow(
      "Unknown argument: --unexpected",
    );
    expect(calls).toEqual([]);
  });

  it("stops before transforms when the contract is rejected", async () => {
    const calls: CommandCall[] = [];
    const checkContract = async (): Promise<ContractReport> => {
      throw new Error("unreviewed source field");
    };
    const loadDump = (): MfmDump => {
      throw new Error("load must not run after a contract rejection");
    };

    await expect(
      runMfmSync({ dumpPath: DUMP_PATH, write: true }, dependencies(calls, { checkContract, loadDump })),
    ).rejects.toThrow("unreviewed source field");
    expect(calls).toEqual([]);
  });

  it("stops after a failed transform", async () => {
    const calls: CommandCall[] = [];
    const runCommand: MfmSyncDependencies["runCommand"] = async (command, options) => {
      calls.push({ command, options });
      if (command === "points-and-composition-tiers") throw new Error("price-size sync failed");
    };

    await expect(runMfmSync({ dumpPath: DUMP_PATH, write: true }, dependencies(calls, { runCommand }))).rejects.toThrow(
      "price-size sync failed",
    );
    expect(calls.map((call) => call.command)).toEqual(
      MFM_SYNC_COMMANDS.slice(0, MFM_SYNC_COMMANDS.indexOf("points-and-composition-tiers") + 1),
    );
  });

  it("runs the complete serialized Combat Patrol-inclusive transform sequence", async () => {
    const calls: CommandCall[] = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runMfmSyncCli(["--dump", DUMP_PATH, "--write"], dependencies(calls));

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenLastCalledWith("MFM_SYNC_OK data_version=867");
    log.mockRestore();
    expect(calls.map((call) => call.command)).toEqual(MFM_SYNC_COMMANDS);
    expect(calls).toHaveLength(24);
    for (const call of calls) {
      expect(call.options).toEqual({ dumpPath: DUMP_PATH, write: true, includeCombatPatrol: true });
    }
    for (const command of ["seed-units", "seed-detachments", "seed-stratagems"] as const) {
      expect(calls.find((call) => call.command === command)?.options.includeCombatPatrol).toBe(true);
    }
  });

  it("preserves point tiers while adopting composition model counts", () => {
    const unitsPath = "/data/core/orks/units.json";
    const merged = mergePointsAndCompositionTierWrites(
      [
        {
          path: unitsPath,
          value: [{ id: "ghazghkull-thraka", model_count: { min: 1, max: 1 }, points: [{ models: 2, cost: 315 }] }],
        },
      ],
      [
        {
          path: unitsPath,
          value: [{ id: "ghazghkull-thraka", model_count: { min: 2, max: 2 }, points: [{ models: 1, cost: 285 }] }],
        },
      ],
    );

    expect(merged).toEqual([
      {
        path: unitsPath,
        value: [{ id: "ghazghkull-thraka", model_count: { min: 2, max: 2 }, points: [{ models: 2, cost: 315 }] }],
      },
    ]);
  });
});
