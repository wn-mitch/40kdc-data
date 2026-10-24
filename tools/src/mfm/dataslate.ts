/**
 * dataslate.ts — the `game_version` an MFM ingest stamps, keyed by the dump's `data_version`.
 *
 * Every dump-sourced record carries the dataslate of the dump it was verified against. The
 * mapping below is the one place a dump `data_version` names a `data/core/game-versions.json`
 * entry; an unmapped version throws, so a newer dump cannot silently inherit an older slate.
 * Adding a dump means adding its game-versions.json entry and its row here.
 */
import * as path from "node:path";

import { CORE_DIR, readJsonArray } from "./repo-files.js";

export interface GameVersion {
  edition: string;
  dataslate: string;
}

/** Dump `metadata.data_version` → the game-versions.json dataslate its records are stamped with. */
export const DATASLATE_BY_DATA_VERSION: Readonly<Record<number, string>> = Object.freeze({
  963: "mfm-963",
  995: "mfm-995",
});

/** The slate a record falls back to when its dump verification fails. */
export const PROVISIONAL_DATASLATE = "pre-launch-provisional";

/**
 * Slates that claim dump confirmation. The current dump supersedes each of them, so a record
 * stamped with one is re-verified: verified records move to the current slate, failures are
 * demoted to {@link PROVISIONAL_DATASLATE}.
 */
export const DUMP_CONFIRMED_DATASLATES: ReadonlySet<string> = new Set([
  "launch",
  "codex-orks",
  ...Object.values(DATASLATE_BY_DATA_VERSION),
]);

type GameVersionEntry = { edition: string; dataslate: string };

let registered: GameVersionEntry[] | null = null;

function registeredVersions(): GameVersionEntry[] {
  registered ??= readJsonArray<GameVersionEntry>(path.join(CORE_DIR, "game-versions.json"));
  return registered;
}

/**
 * The game_version for a dump `data_version`. Throws when the version is absent, unmapped, or
 * maps to a slate game-versions.json does not declare.
 */
export function gameVersionForDataVersion(
  dataVersion: number | undefined,
  entries: readonly GameVersionEntry[] = registeredVersions(),
): GameVersion {
  if (typeof dataVersion !== "number" || !Number.isInteger(dataVersion)) {
    throw new Error("MFM dump has no integer metadata.data_version; cannot name its dataslate.");
  }
  const dataslate = DATASLATE_BY_DATA_VERSION[dataVersion];
  if (!dataslate) {
    throw new Error(
      `MFM dump data_version ${dataVersion} has no dataslate. Add a data/core/game-versions.json entry and map it in tools/src/mfm/dataslate.ts.`,
    );
  }
  const entry = entries.find((candidate) => candidate.dataslate === dataslate);
  if (!entry) throw new Error(`Dataslate "${dataslate}" (dump data_version ${dataVersion}) is missing from game-versions.json.`);
  return { edition: entry.edition, dataslate };
}

/** The game_version records verified against this dump are stamped with. */
export function currentGameVersion(dump: { readonly version?: number | undefined }): GameVersion {
  return gameVersionForDataVersion(dump.version);
}

/** The game_version a record that fails dump verification is demoted to (same edition). */
export function provisionalGameVersion(current: GameVersion): GameVersion {
  return { edition: current.edition, dataslate: PROVISIONAL_DATASLATE };
}
