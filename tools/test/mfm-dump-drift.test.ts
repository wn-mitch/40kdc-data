import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { StagedWrite } from "../src/mfm/apply.js";
import { DEFAULT_DUMP_PATH, loadDump, type MfmDump } from "../src/mfm/loader.js";
import { REPO_ROOT } from "../src/mfm/repo-files.js";
import { runAllies } from "../src/mfm/allies.js";
import { runAttachmentRoles } from "../src/mfm/attachment.js";
import { runBaseSizes } from "../src/mfm/base-sizes.js";
import { runChapterScope } from "../src/mfm/chapter-scope.js";
import { runConditionalKeywords } from "../src/mfm/conditional-keywords.js";
import { runDataslates } from "../src/mfm/dataslates/run.js";
import { runDetachmentFields } from "../src/mfm/detachment-fields.js";
import { runDispositions } from "../src/mfm/dispositions.js";
import { runEnhancements } from "../src/mfm/enhancements.js";
import { runMfmExternalRefs } from "../src/mfm/external-refs.js";
import { runFactionFields } from "../src/mfm/faction-fields.js";
import { runCull } from "../src/mfm/legends-cull.js";
import { runMissionMatchups } from "../src/mfm/mission-matchups.js";
import { runMissions } from "../src/mfm/missions.js";
import { runPoints } from "../src/mfm/points.js";
import { runReissue } from "../src/mfm/reissue.js";
import { runSeedDetachments } from "../src/mfm/seed-detachments.js";
import { runSeedUnits } from "../src/mfm/seed-units.js";
import { runStratagems } from "../src/mfm/stratagems.js";
import { runUnitKeywords } from "../src/mfm/unit-keywords.js";
import {
  runCompositionNames,
  runCompositionTiers,
  runWargear,
  runWargearBudgets,
  runWargearCosts,
} from "../src/mfm/wargear.js";
import { runWeaponStats } from "../src/mfm/weapon-stats.js";
import { runWeaponVariants } from "../src/mfm/weapon-variants.js";
import { openWorkbenchReadOnly } from "../src/semantic-authoring/db.js";

/**
 * The dump is authoritative, so the repo should already hold what every ingest pass would write:
 * a pass that stages new bytes against the current dump is drift to apply (`ingest-mfm <pass>
 * --write`) or a pass defect to fix. Skipped without the private dump.
 */

/** Repo-relative paths of the staged files whose bytes differ from disk. */
function changedFiles(staged: readonly StagedWrite[]): string[] {
  return staged
    .filter((write) => (write.text ?? `${JSON.stringify(write.value, null, 2)}\n`) !== fs.readFileSync(write.path, "utf8"))
    .map((write) => path.relative(REPO_ROOT, write.path))
    .sort();
}

const PASSES: [string, (dump: MfmDump) => { staged: StagedWrite[] }][] = [
  ["dispositions", (dump) => runDispositions(dump, false)],
  ["enhancements", (dump) => runEnhancements(dump, false)],
  ["faction-fields", runFactionFields],
  ["detachment-fields", runDetachmentFields],
  ["conditional-keywords", (dump) => runConditionalKeywords(dump)],
  ["points", (dump) => runPoints(dump, false)],
  ["cull-legends", (dump) => runCull(dump, false)],
  ["reissued-refs", (dump) => runReissue(dump)],
  ["stratagems", (dump) => runStratagems(dump, false)],
  ["missions", (dump) => runMissions(dump, false)],
  ["mission-matchups", runMissionMatchups],
  ["base-sizes", runBaseSizes],
  ["unit-keywords", runUnitKeywords],
  ["chapter-scope", (dump) => runChapterScope(dump, false)],
  ["wargear", (dump) => runWargear(dump, false)],
  ["wargear-budgets", (dump) => runWargearBudgets(dump)],
  ["wargear-costs", (dump) => runWargearCosts(dump)],
  ["composition-names", runCompositionNames],
  ["composition-tiers", (dump) => runCompositionTiers(dump)],
  ["attachment-role", (dump) => runAttachmentRoles(dump)],
  ["seed-units", (dump) => runSeedUnits(dump)],
  ["seed-detachments", (dump) => runSeedDetachments(dump)],
  ["allies", runAllies],
  ["weapon-variants", (dump) => runWeaponVariants(dump)],
  ["weapon-stats", (dump) => runWeaponStats(dump)],
  ["external-refs", (dump) => runMfmExternalRefs(dump)],
  ["dataslates", (dump) => {
    const db = openWorkbenchReadOnly();
    try {
      return runDataslates(dump, { dataRoot: path.join(REPO_ROOT, "data"), dumpPath: DEFAULT_DUMP_PATH, db });
    } finally {
      db.close();
    }
  }],
];

describe.skipIf(!fs.existsSync(DEFAULT_DUMP_PATH))("the repo is in sync with the MFM dump", () => {
  let dump: MfmDump | undefined;
  const shared = () => (dump ??= loadDump());

  for (const [name, run] of PASSES) {
    it(`ingest-mfm ${name} has nothing left to write`, () => {
      expect(changedFiles(run(shared()).staged)).toEqual([]);
    }, 300_000);
  }
});
