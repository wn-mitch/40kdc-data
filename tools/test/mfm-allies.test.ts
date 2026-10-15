import { describe, it, expect } from "vitest";
import * as fs from "fs";
import { DEFAULT_DUMP_PATH, loadDump, MfmDump } from "../src/mfm/loader.js";
import { detachmentOffersPoolEnhancement, runAllies } from "../src/mfm/allies.js";

/** A pool datasheet (Great Unclean One) and its detachment's enhancement keyword groups. */
function mkDump(groups: { kw?: string[]; fk?: string[] }[]): MfmDump {
  const kwId = (n: string) => `kw-${n}`;
  const fkId = (n: string) => `fk-${n}`;
  const names = new Set(groups.flatMap((g) => [...(g.kw ?? []), ...(g.fk ?? [])]));
  return new MfmDump({
    data: {
      keyword: [...new Set([...names, "Monster", "Great Unclean One"])].map((n) => ({ id: kwId(n), localisations: { en: { name: n } } })),
      faction_keyword: [...new Set([...names, "Plague Legions", "Death Guard"])].map((n) => ({ id: fkId(n), localisations: { en: { name: n } } })),
      miniature: [{ id: "m1", datasheetId: "ds-guo" }],
      miniature_keyword: [
        { id: "mk1", miniatureId: "m1", keywordId: kwId("Monster") },
        { id: "mk2", miniatureId: "m1", keywordId: kwId("Great Unclean One") },
      ],
      datasheet_faction_keyword: [{ id: "d1", datasheetId: "ds-guo", factionKeywordId: fkId("Plague Legions") }],
      enhancement: [{ id: "e1", detachmentId: "det-tally" }],
      enhancement_required_keyword_group: groups.map((_, i) => ({ id: `g${i}`, enhancementId: "e1" })),
      enhancement_required_keyword_group_keyword: groups.flatMap((g, i) =>
        (g.kw ?? []).map((n) => ({ enhancementRequiredKeywordGroupId: `g${i}`, keywordId: kwId(n) })),
      ),
      enhancement_required_keyword_group_faction_keyword: groups.flatMap((g, i) =>
        (g.fk ?? []).map((n) => ({ enhancementRequiredKeywordGroupId: `g${i}`, factionKeywordId: fkId(n) })),
      ),
    } as never,
  });
}

describe("detachmentOffersPoolEnhancement", () => {
  it("is true when an enhancement keyword group names a pool datasheet keyword", () => {
    expect(detachmentOffersPoolEnhancement(mkDump([{ kw: ["Great Unclean One"] }]), ["det-tally"], ["ds-guo"])).toBe(true);
  });

  it("is true when an alternative group names the pool's faction keyword", () => {
    const dump = mkDump([{ fk: ["Death Guard"] }, { fk: ["Plague Legions"] }]);
    expect(detachmentOffersPoolEnhancement(dump, ["det-tally"], ["ds-guo"])).toBe(true);
  });

  it("is false when every group needs a keyword no pool datasheet carries", () => {
    // A group's keywords all apply: Infantry + Plague Legions excludes a Monster.
    const dump = mkDump([{ fk: ["Death Guard"] }, { kw: ["Infantry"], fk: ["Plague Legions"] }]);
    expect(detachmentOffersPoolEnhancement(dump, ["det-tally"], ["ds-guo"])).toBe(false);
  });

  it("is false for a pool with no required detachment", () => {
    expect(detachmentOffersPoolEnhancement(mkDump([{ kw: ["Great Unclean One"] }]), [], ["ds-guo"])).toBe(false);
  });
});

describe.skipIf(!fs.existsSync(DEFAULT_DUMP_PATH))("runAllies over the real dump", () => {
  it("sources each daemon-detachment pool from its host's cult-legion views, gated and capped", () => {
    const rules = new Map(runAllies(loadDump()).rules.map((r) => [r.id, r]));
    const expected: Record<string, [string, string]> = {
      "world-eaters-khorne-daemons": ["world-eaters", "khorne-daemonkin"],
      "death-guard-nurgle-daemons": ["death-guard", "tallyband-summoners"],
      "emperors-children-slaanesh-daemons": ["emperors-children", "carnival-of-excess"],
      "thousand-sons-tzeentch-daemons": ["thousand-sons", "changehost-of-deceit"],
    };
    for (const [id, [source, detachment]] of Object.entries(expected)) {
      const rule = rules.get(id);
      expect(rule?.source_faction_id, id).toBe(source);
      expect(rule?.detachment_ids, id).toEqual([detachment]);
      expect(rule?.points_limits?.map((p) => p.max_points), id).toEqual([500, 1000, 1500]);
      expect(rule?.cannot_be_warlord, id).toBe(true);
      // Each detachment prints an enhancement its daemons can take.
      expect(rule?.cannot_take_enhancements, id).toBeUndefined();
      // The pool's daemons are not ordinary picks of the host faction.
      expect(rule?.exclusive, id).toBe(true);
    }
    // Ynnari exist only under Devoted of Ynnead; Harlequins (Disparate Paths: any
    // Asuryani army, no required detachment) stay ordinary Aeldari picks.
    expect(rules.get("aeldari-ynnari")?.exclusive).toBe(true);
    expect(rules.get("aeldari-ynnari")?.detachment_ids).toEqual(["devoted-of-ynnead"]);
    expect(rules.get("aeldari-harlequins")?.exclusive).toBeUndefined();
  });
});
