import * as fs from "node:fs";
import * as path from "node:path";
import { checkMfmContract, type ContractReport } from "./gen-dump-schema.js";
import { runIngestMfmCommand, type IngestMfmCommand } from "../ingest-mfm.js";
import { loadDump } from "./loader.js";

export type MfmSyncResult = { dataVersion: number };

export type MfmSyncDependencies = {
  checkContract: (dumpPath: string) => Promise<ContractReport>;
  loadDump: typeof loadDump;
  runCommand: typeof runIngestMfmCommand;
};

export const MFM_SYNC_COMMANDS: readonly IngestMfmCommand[] = [
  "normalize-enhancements",
  "cull-legends",
  "seed-units",
  "seed-detachments",
  "base-sizes",
  "wargear",
  "wargear-budgets",
  "wargear-costs",
  "composition-names",
  "points-and-composition-tiers",
  "weapon-variants",
  "attachment-role",
  "chapter-scope",
  "faction-fields",
  "dispositions",
  "detachment-fields",
  "enhancements",
  "seed-stratagems",
  "stratagems",
  "missions",
  "mission-matchups",
  "allies",
  "coverage",
  "golden",
];

const productionDependencies: MfmSyncDependencies = {
  checkContract: (dumpPath) => checkMfmContract(dumpPath, { checkPrivateMirror: false }),
  loadDump,
  runCommand: runIngestMfmCommand,
};

/** Validate the source contract, then reconcile every MFM-backed data category serially. */
export async function runMfmSync(
  options: { dumpPath: string; write: boolean },
  dependencies: Partial<MfmSyncDependencies> = {},
): Promise<MfmSyncResult> {
  if (!options.write) throw new Error("--write is required.");
  const resolvedDependencies = { ...productionDependencies, ...dependencies };
  await resolvedDependencies.checkContract(options.dumpPath);

  const dump = resolvedDependencies.loadDump(options.dumpPath);
  const dataVersion = dump.version;
  if (typeof dataVersion !== "number" || !Number.isInteger(dataVersion)) {
    throw new Error("MFM dump metadata.data_version must be an integer.");
  }

  for (const command of MFM_SYNC_COMMANDS) {
    await resolvedDependencies.runCommand(command, {
      dumpPath: options.dumpPath,
      write: true,
      includeCombatPatrol: true,
    });
  }

  return { dataVersion };
}

function parseCliArguments(argv: string[]): { dumpPath: string; write: true } {
  let dumpPath: string | undefined;
  let write = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      if (write) throw new Error("--write may be specified only once.");
      write = true;
      continue;
    }
    if (argument === "--dump") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--dump requires a path.");
      if (dumpPath) throw new Error("--dump may be specified only once.");
      dumpPath = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!dumpPath) throw new Error("--dump is required.");
  if (!write) throw new Error("--write is required.");
  let stats: fs.Stats;
  try {
    stats = fs.statSync(dumpPath);
  } catch {
    throw new Error(`MFM dump is not a file: ${dumpPath}`);
  }
  if (!stats.isFile()) throw new Error(`MFM dump is not a file: ${dumpPath}`);
  return { dumpPath, write: true };
}

export async function runMfmSyncCli(
  argv: string[],
  dependencies: Partial<MfmSyncDependencies> = {},
): Promise<void> {
  const options = parseCliArguments(argv);
  const result = await runMfmSync(options, dependencies);
  console.log(`MFM_SYNC_OK data_version=${result.dataVersion}`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  runMfmSyncCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
