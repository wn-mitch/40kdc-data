import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_DUMP_PATH, loadDump, MfmDump } from "../src/mfm/loader.js";
import { CORE_DIR } from "../src/mfm/repo-files.js";
import { keywordLimitsByDir, runFactionFields, type DirFactionResult } from "../src/mfm/faction-fields.js";
import { keywordLimitOverridesForDetachment } from "../src/mfm/detachment-fields.js";

/** Synthetic keyword_restriction_group rows (Asuryani caps, a Ynnari exemption, a limitless group). */
function capsDump(): MfmDump {
  const fk = (id: string, name: string) => ({ id, localisations: { en: { name } } });
  const kw = (id: string, name: string) => ({ id, localisations: { en: { name } } });
  return new MfmDump({
    data: {
      faction_keyword: [fk("fk-asu", "Asuryani"), fk("fk-ynn", "Ynnari"), fk("fk-ck", "Chaos Knights"), fk("fk-gsc", "Genestealer Cults"), fk("fk-tau", "T’au Empire")],
      keyword: [kw("k-tm", "Troupe Master"), kw("k-eh", "Epic Hero"), kw("k-yv", "Yvraine"), kw("k-wd", "War Dog"), kw("k-pa", "Patriarch"), kw("k-fs", "Commander Farsight"), kw("k-et", "Ethereal")],
      // One datasheet carries EPIC HERO + YVRAINE; FARSIGHT and ETHEREAL live on different datasheets.
      datasheet: [
        { id: "ds-yv", isLegends: false, localisations: { en: { name: "Yvraine" } } },
        { id: "ds-fs", isLegends: false, localisations: { en: { name: "Commander Farsight" } } },
        { id: "ds-et", isLegends: false, localisations: { en: { name: "Ethereal" } } },
      ],
      miniature: [
        { id: "m-yv", datasheetId: "ds-yv" },
        { id: "m-fs", datasheetId: "ds-fs" },
        { id: "m-et", datasheetId: "ds-et" },
      ],
      miniature_keyword: [
        { id: "mk1", miniatureId: "m-yv", keywordId: "k-eh" },
        { id: "mk2", miniatureId: "m-yv", keywordId: "k-yv" },
        { id: "mk3", miniatureId: "m-fs", keywordId: "k-eh" },
        { id: "mk4", miniatureId: "m-fs", keywordId: "k-fs" },
        { id: "mk5", miniatureId: "m-et", keywordId: "k-et" },
      ],
      datasheet_faction_keyword: [],
      keyword_restriction_group: [
        { id: "g-tm", limit: 1, factionKeywordId: "fk-asu", excludedFactionKeywordId: null, requiresWarlordMiniatureId: null },
        { id: "g-yv", limit: 0, factionKeywordId: "fk-asu", excludedFactionKeywordId: "fk-ynn", requiresWarlordMiniatureId: null },
        { id: "g-wd", limit: null, factionKeywordId: "fk-ck", excludedFactionKeywordId: null, requiresWarlordMiniatureId: null },
        { id: "g-pa", limit: 1, factionKeywordId: "fk-gsc", excludedFactionKeywordId: null, requiresWarlordMiniatureId: null },
        { id: "g-fs", limit: 1, factionKeywordId: "fk-tau", excludedFactionKeywordId: null, requiresWarlordMiniatureId: null },
      ],
      keyword_restriction_group_keyword: [
        { keywordRestrictionGroupId: "g-tm", keywordId: "k-tm" },
        { keywordRestrictionGroupId: "g-yv", keywordId: "k-yv" },
        { keywordRestrictionGroupId: "g-yv", keywordId: "k-eh" },
        { keywordRestrictionGroupId: "g-wd", keywordId: "k-wd" },
        { keywordRestrictionGroupId: "g-pa", keywordId: "k-pa" },
        { keywordRestrictionGroupId: "g-fs", keywordId: "k-fs" },
        { keywordRestrictionGroupId: "g-fs", keywordId: "k-et" },
      ],
      restriction_group_detachment_limit: [
        { id: "r1", detachmentId: "d-ghosts", restrictionGroupId: "g-tm", minRosterLimit: null, maxRosterLimit: 3 },
        { id: "r2", detachmentId: "d-hound", restrictionGroupId: "g-wd", minRosterLimit: 3, maxRosterLimit: null },
      ],
    } as never,
  });
}

describe("keyword caps from keyword_restriction_group (synthetic)", () => {
  it("routes each capped group to its faction dir with sorted keywords and the exemption", () => {
    const byDir = keywordLimitsByDir(capsDump());
    expect(byDir.get("aeldari")).toEqual([
      { keywords: ["Epic Hero", "Yvraine"], max: 0, exempt_faction_keywords: ["Ynnari"] },
      { keywords: ["Troupe Master"], max: 1 },
    ]);
    expect(byDir.get("genestealer-cults")).toEqual([{ keywords: ["Patriarch"], max: 1 }]);
  });

  it("reads keywords spread over different datasheets as alternatives, and co-located keywords as one identity", () => {
    const byDir = keywordLimitsByDir(capsDump());
    expect(byDir.get("tau-empire")).toEqual([{ keywords: ["Commander Farsight", "Ethereal"], max: 1, mode: "alternatives" }]);
    // EPIC HERO + YVRAINE share a datasheet, so it stays a units cap (no mode).
    expect(byDir.get("aeldari")?.find((k) => k.keywords.includes("Yvraine"))?.mode).toBeUndefined();
  });

  it("skips a group with no limit (it only carries a detachment minimum)", () => {
    expect(keywordLimitsByDir(capsDump()).has("chaos-knights")).toBe(false);
  });

  it("projects a detachment's maxRosterLimit as an override and ignores a minimum-only row", () => {
    expect(keywordLimitOverridesForDetachment(capsDump(), "d-ghosts")).toEqual([{ keywords: ["Troupe Master"], max: 3 }]);
    expect(keywordLimitOverridesForDetachment(capsDump(), "d-hound")).toEqual([]);
  });
});

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

  it("confirms the army rules the mirror stored for a faction with several", () => {
    // `mfm:mirror` writes both of Death Guard's army rules, so this pass confirms rather than reviews.
    const dg = byDir.get("death-guard");
    expect(dg?.ruleConfirmed).toBe(true);
    expect(dg?.ruleReview).toBeUndefined();
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
