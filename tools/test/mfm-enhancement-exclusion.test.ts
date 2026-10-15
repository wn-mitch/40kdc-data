import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_DUMP_PATH, loadDump } from "../src/mfm/loader.js";
import { CORE_DIR } from "../src/mfm/repo-files.js";
import { runCompositionNames } from "../src/mfm/wargear.js";

/** composition-names projects miniature.excludedFromEnhancements onto composition model rows. */
describe.skipIf(!fs.existsSync(DEFAULT_DUMP_PATH))("per-model Enhancement exclusion over the real dump", () => {
  it("flags exactly the models the dump marks excludedFromEnhancements, and a re-run changes nothing", () => {
    const flagged = fs
      .readdirSync(CORE_DIR)
      .flatMap((dir) => {
        const p = path.join(CORE_DIR, dir, "unit-compositions.json");
        if (!fs.existsSync(p)) return [];
        const comps = JSON.parse(fs.readFileSync(p, "utf8")) as { unit_id: string; models: { name: string; excluded_from_enhancements?: boolean }[] }[];
        return comps.flatMap((c) => c.models.filter((m) => m.excluded_from_enhancements).map((m) => `${c.unit_id}/${m.name}`));
      })
      .sort();
    expect(flagged).toEqual([
      "exalted-flamer/Exalted Flamer",
      "ogryn-bodyguard/Ogryn Bodyguard",
      "sir-hekhtur/Sir Hekhtur",
      "transcendent-ctan/Transcendent C’tan",
    ]);
    expect(runCompositionNames(loadDump()).staged).toEqual([]);
  });
});
