import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_DUMP_PATH, loadDump, MfmDump } from "../src/mfm/loader.js";
import { CORE_DIR } from "../src/mfm/repo-files.js";
import {
  applyAuthoritativeDetachmentFields,
  runDetachmentFields,
  requiredKeywordsForDetachment,
  tagsForDetachment,
  ruleIdsForDetachment,
  type DetFieldsReport,
  type DirDetFieldResult,
} from "../src/mfm/detachment-fields.js";

/**
 * WS2 detachment-field reconcile. The derivation helpers are unit-tested with
 * synthetic fixtures (no dump needed); the whole-repo reconcile is dump-guarded
 * (the dump is gitignored, so CI without it skips those).
 */

/** Minimal synthetic dump: a chapter-locked detachment, a roster-wide one, an
 *  umbrella (parent-keyword) broadening, and a unique-keyword tag. */
function fixture(): MfmDump {
  return new MfmDump({
    data: {
      faction_keyword: [
        { id: "fk-astartes", localisations: { en: { name: "Adeptus Astartes" } } },
        { id: "fk-iron", localisations: { en: { name: "Iron Hands" } } },
        { id: "fk-asuryani", localisations: { en: { name: "Asuryani" } } },
        { id: "fk-aeldari", localisations: { en: { name: "Aeldari" } } },
      ],
      keyword: [{ id: "kw-battlesuit", localisations: { en: { name: "Battlesuit" } } }],
      publication: [
        { id: "pub-astartes", factionKeywordId: "fk-astartes" },
        { id: "pub-asuryani", factionKeywordId: "fk-asuryani" },
      ],
      detachment: [
        // chapter-locked: owned by Adeptus Astartes, applies to Iron Hands only.
        { id: "d-lock", publicationId: "pub-astartes", detachmentPointsCost: 2, isCombatPatrol: false, localisations: { en: { name: "Hammer of Avernii" } } },
        // roster-wide: owned by Adeptus Astartes, applicability enumerates the roster + a chapter.
        { id: "d-wide", publicationId: "pub-astartes", detachmentPointsCost: 2, isCombatPatrol: false, localisations: { en: { name: "Gladius Task Force" } } },
        // umbrella broadening: owned by Asuryani, applies to Aeldari (the roster).
        { id: "d-umbrella", publicationId: "pub-asuryani", detachmentPointsCost: 0, isCombatPatrol: true, localisations: { en: { name: "Kygharil's Protectors" } } },
        // tagged: owned by Adeptus Astartes, carries a unique mutual-exclusivity keyword.
        { id: "d-tag", publicationId: "pub-astartes", detachmentPointsCost: 2, isCombatPatrol: false, localisations: { en: { name: "Solar Spearhead" } } },
      ],
      detachment_faction_keyword: [
        { detachmentId: "d-lock", factionKeywordId: "fk-iron" },
        { detachmentId: "d-wide", factionKeywordId: "fk-astartes" },
        { detachmentId: "d-wide", factionKeywordId: "fk-iron" },
        { detachmentId: "d-umbrella", factionKeywordId: "fk-aeldari" },
      ],
      detachment_unique_keyword: [{ detachmentId: "d-tag", keywordId: "kw-battlesuit" }],
    },
  });
}

describe("detachment-field derivation (synthetic)", () => {
  const dump = fixture();

  it("locks a detachment to the sub-faction keyword absent from the roster", () => {
    expect(requiredKeywordsForDetachment(dump, "d-lock")).toEqual(["Iron Hands"]);
  });

  it("treats a roster-wide enumeration (ownership keyword present) as no restriction", () => {
    expect(requiredKeywordsForDetachment(dump, "d-wide")).toBeNull();
  });

  it("treats an umbrella/roster keyword as a broadening, not a lock", () => {
    // Owned by Asuryani, applicable to the whole Aeldari roster → requiring "Aeldari"
    // is trivially satisfied, so no restriction is emitted.
    expect(requiredKeywordsForDetachment(dump, "d-umbrella")).toBeNull();
  });

  it("derives a lowercase mutual-exclusivity tag slug from the unique keyword", () => {
    expect(tagsForDetachment(dump, "d-tag")).toEqual(["battlesuit"]);
    expect(tagsForDetachment(dump, "d-lock")).toEqual([]);
  });

  it("collects an unresolved faction-keyword id rather than emitting a null label", () => {
    const d = new MfmDump({
      data: {
        faction_keyword: [{ id: "fk-astartes", localisations: { en: { name: "Adeptus Astartes" } } }],
        publication: [{ id: "pub", factionKeywordId: "fk-astartes" }],
        detachment: [{ id: "d", publicationId: "pub", detachmentPointsCost: 2, isCombatPatrol: false, localisations: { en: { name: "X" } } }],
        detachment_faction_keyword: [{ detachmentId: "d", factionKeywordId: "fk-missing" }],
      },
    });
    const unresolved: string[] = [];
    expect(requiredKeywordsForDetachment(d, "d", unresolved)).toBeNull();
    expect(unresolved).toContain("fk-missing");
  });
});
describe("authoritative detachment field reconciliation", () => {
  it("clears stale source fields while preserving unrelated restrictions", () => {
    const detachment = {
      tags: ["onslaught"],
      restrictions: {
        required_keywords: ["Stale Chapter"],
        excluded_keywords: ["Excluded Unit"],
        notes: "Fabricated restriction note",
      },
    };

    expect(applyAuthoritativeDetachmentFields(detachment, [], [])).toEqual({
      tagsChanged: true,
      requiredKeywordsChanged: true,
    });
    expect(detachment).toEqual({
      tags: [],
      restrictions: {
        required_keywords: [],
        excluded_keywords: ["Excluded Unit"],
        notes: "Fabricated restriction note",
      },
    });
    expect(applyAuthoritativeDetachmentFields(detachment, [], [])).toEqual({
      tagsChanged: false,
      requiredKeywordsChanged: false,
    });
  });
});


describe("detachment-rule id derivation (synthetic)", () => {
  it("gives each dump rule the mirrored id (<name>-<faction>), sorted and de-duplicated", () => {
    const dump = new MfmDump({
      data: {
        faction_keyword: [{ id: "fk", parentFactionKeywordId: null, localisations: { en: { name: "Legiones Daemonica" } } }],
        publication: [{ id: "p", factionKeywordId: "fk", isCombatPatrol: false, isLegends: false, isCoreRules: false, localisations: { en: { name: "Codex" } } }],
        detachment: [{ id: "d", publicationId: "p", localisations: { en: { name: "X" } } }],
        detachment_rule: [
          { id: "r1", detachmentId: "d", displayOrder: 1, localisations: { en: { name: "Warp Rifts" } } },
          { id: "r2", detachmentId: "d", displayOrder: 0, localisations: { en: { name: "Prey on the Weak" } } },
          // apostrophe/diacritic normalization mirrors the authored ability-id form.
          { id: "r3", detachmentId: "d", displayOrder: 2, localisations: { en: { name: "Vulkan’s Quest" } } },
        ],
      },
    });
    expect(ruleIdsForDetachment(dump, "d")).toEqual(["prey-on-the-weak-chaos-daemons", "vulkans-quest-chaos-daemons", "warp-rifts-chaos-daemons"]);
  });

  it("returns an empty list when the detachment has no dump rule", () => {
    const dump = new MfmDump({
      data: { detachment: [{ id: "d", localisations: { en: { name: "X" } } }], detachment_rule: [] },
    });
    expect(ruleIdsForDetachment(dump, "d")).toEqual([]);
  });
});

describe.skipIf(!fs.existsSync(DEFAULT_DUMP_PATH))("detachment-fields over the real dump", () => {
  // Load the dump lazily in beforeAll — never in the describe body, which Vitest
  // executes at collection time regardless of skipIf, before the guard applies.
  let report: DetFieldsReport;
  let byDir: Map<string, DirDetFieldResult>;
  beforeAll(() => {
    report = runDetachmentFields(loadDump());
    byDir = new Map<string, DirDetFieldResult>(report.dirs.map((d) => [d.dir, d]));
  });
  // `sum` reads `report` lazily — only ever called inside it() bodies (post-beforeAll).
  const sum = (f: (d: DirDetFieldResult) => number) => report.dirs.reduce((a, d) => a + f(d), 0);

  it("reconciles mutual-exclusivity tags authoritatively", () => {
    expect(sum((d) => d.tagsChanged.length + d.tagsConfirmed)).toBeGreaterThan(0);
  });

  it("locks chapter-specific detachments in their routed directories", () => {
    expect(byDir.get("iron-hands")?.matched).toBeGreaterThan(0);
    const medusa = JSON.parse(
      fs.readFileSync(path.join(CORE_DIR, "iron-hands", "detachments.json"), "utf8"),
    ).find((d: { id: string }) => d.id === "medusas-wrath") as { restrictions?: { required_keywords?: string[] } };
    expect(medusa.restrictions?.required_keywords).toEqual(["Iron Hands"]);
  });

  it("does not spuriously lock the Aeldari Combat-Patrol detachment to its own roster", () => {
    const aeldari = byDir.get("aeldari");
    expect(aeldari?.reqChanged.some((r) => r.id === "kygharils-protectors" && r.to.length > 0)).not.toBe(true);
  });

  it("only stages dirs it actually changed", () => {
    for (const s of report.staged) expect(s.path).toMatch(/detachments\.json$/);
  });

  it("verifies detachment_rule links against the dump — confirm-heavy, no invented fills", () => {
    // The rule abilities are already authored, so the reconcile confirms the vast
    // majority and never invents a link (a fill only fires when a slug resolves to
    // an authored ability, which none currently need).
    expect(sum((d) => d.ruleConfirmed)).toBeGreaterThan(100);
    expect(sum((d) => d.ruleFilled.length)).toBe(0);
  });

  it("finds every stored rule link matching the dump once the mirror has run", () => {
    // `mfm:mirror` writes the rules the dump prints (a Combat Patrol's army rules ride its
    // detachment); this pass derives the same set, so nothing is left to review.
    expect(report.dirs.flatMap((d) => d.ruleReview)).toEqual([]);
    // Armoured Infantry prints a second rule (an order) beside Squadron Command: both are linked.
    const rec = JSON.parse(
      fs.readFileSync(path.join(CORE_DIR, "astra-militarum", "detachments.json"), "utf8"),
    ).find((d: { id: string }) => d.id === "armoured-infantry") as { detachment_rule_ids?: string[] };
    expect(rec.detachment_rule_ids).toEqual(["squadron-command-astra-militarum", "order-astra-militarum"]);
  });

  it("leaves no detachment whose dump rule lacks an ability record", () => {
    // `mfm:mirror` stubs every rule the dump prints, so the unauthored worklist is empty; an
    // entry here means a detachment the mirror did not see (seeded after it, never re-mirrored).
    expect(report.dirs.flatMap((d) => d.ruleUnauthored)).toEqual([]);
  });
});
