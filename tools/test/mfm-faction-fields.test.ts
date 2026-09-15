import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_DUMP_PATH, loadDump } from "../src/mfm/loader.js";
import { CORE_DIR } from "../src/mfm/repo-files.js";
import { runFactionFields, type DirFactionResult } from "../src/mfm/faction-fields.js";

/**
 * WS3 faction-field reconcile over the real GW MFM dump (gitignored, so CI without
 * it skips this). Asserts the fill-only / confirm / review contract:
 *   - authored faction_rule_ids confirm against owned rules as an unordered set,
 *   - mismatched authored and owned rule arrays are both surfaced for review,
 *   - authored arrays are never overwritten,
 *   - a chapter confirms parent_faction_id: adeptus-astartes,
 *   - the localized common name is appended to aliases,
 *   - and runFactionFields only stages files it actually changed.
 */
describe.skipIf(!fs.existsSync(DEFAULT_DUMP_PATH))("faction-fields over the real dump", () => {
  // Load the dump lazily in beforeAll — never in the describe body, which Vitest
  // executes at collection time regardless of skipIf, before the guard applies.
  let report: ReturnType<typeof runFactionFields>;
  let byDir: Map<string, DirFactionResult>;
  beforeAll(() => {
    report = runFactionFields(loadDump());
    byDir = new Map<string, DirFactionResult>(report.dirs.map((d) => [d.dir, d]));
  });

  it("confirms an authored faction rule array", () => {
    expect(byDir.get("adepta-sororitas")?.ruleConfirmed).toBe(true);
  });

  it("reports both authored and owned rule sets without overwriting authored ids", () => {
    const dg = byDir.get("death-guard");
    expect(dg?.ruleConfirmed).toBeFalsy();
    expect(dg?.ruleReview).toEqual({
      authored: ["nurgle-s-gift-aura"],
      candidates: ["nurgles-gift", "pact-of-decay"],
    });
    expect(dg?.ruleFilled).toBeUndefined();
  });

  it("confirms multi-rule factions by order-insensitive set equality", () => {
    expect(byDir.get("tyranids")?.ruleConfirmed).toBe(true);
  });

  it("confirms a chapter's parent faction", () => {
    expect(byDir.get("black-templars")?.parentConfirmed).toBe(true);
  });

  it("ensures the localized common name is present in aliases (idempotent end-state)", () => {
    // Assert the end-state, not the per-run delta: whether this run adds it or a
    // prior --write already did, "Space Marines" must be an Adeptus Astartes alias.
    const added = byDir.get("adeptus-astartes")?.aliasesAdded ?? [];
    const record = JSON.parse(
      fs.readFileSync(path.join(CORE_DIR, "adeptus-astartes", "factions.json"), "utf8"),
    )[0] as { aliases?: string[] };
    expect(added.includes("Space Marines") || (record.aliases ?? []).includes("Space Marines")).toBe(true);
  });

  it("never stages a confirmed-only dir", () => {
    // adepta-sororitas confirms its rule with no fill/alias → nothing to write, ever.
    const sororitasStaged = report.staged.some((s) => s.path.includes("/adepta-sororitas/"));
    expect(sororitasStaged).toBe(false);
  });
});
