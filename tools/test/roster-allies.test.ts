import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { emptyRawData } from "../src/data/types.js";
import { allyKeywordLimitViolations, allyPoolViolations, type AllyMember } from "../src/data/roster-allies.js";
import { validateRosterCore, type NormRoster } from "../src/data/roster-resolve.js";
import type { AlliedRule } from "../src/generated.js";

const GV = { edition: "11th", dataslate: "launch" };

describe("allied rules that replace Faction keywords", () => {
  const embedded = Dataset.embedded();
  const template = embedded.units.getInFaction("legionaries", "chaos-space-marines")!.raw;
  const faction = embedded.factions.get("chaos-space-marines")!.raw;
  const detachment = embedded.detachments.getInFaction("veterans-of-the-long-war", "chaos-space-marines")!;
  const build = (replaces: boolean): Dataset => {
    const raw = emptyRawData();
    raw.factions = [
      { ...faction, id: "example-host", name: "Example Host", keywords: ["Example Alliance", "Example Host"] },
      { ...faction, id: "example-guest", name: "Example Guest", keywords: ["Example Alliance", "Example Guest"] },
    ];
    raw.units = [
      { ...template, id: "example-lord", name: "Example Lord", faction_id: "example-host", faction_keywords: ["Example Host"] },
      { ...template, id: "example-guest-squad", name: "Example Guest Squad", faction_id: "example-guest", faction_keywords: ["Example Guest"] },
    ];
    raw.detachments = [
      {
        ...detachment,
        id: "example-host-detachment",
        faction_id: "example-host",
        restrictions: { required_keywords: ["Example Host"] },
      },
    ];
    raw.alliedRules = [
      {
        id: "example-guest-pool",
        name: "Example Guest Pool",
        army_keywords_any: ["Example Host"],
        source_faction_id: "example-guest",
        source_datasheet_ids: ["example-guest-squad"],
        ...(replaces ? { replaces_faction_keywords: true } : {}),
        game_version: GV,
      },
    ];
    return new Dataset(raw);
  };
  const spec: NormRoster = {
    factionId: "example-host",
    battleSize: "strike-force",
    forceDisposition: null,
    detachmentIds: ["example-host-detachment"],
    units: ["example-lord", "example-guest-squad"].map((unitId, i) => ({
      unitId,
      modelCount: 1,
      isWarlord: i === 0,
      enhancementId: null,
      leaderBodyguardId: null,
      counts: new Map<string, number>(),
    })),
  };
  const restricted = (ds: Dataset) =>
    validateRosterCore(spec, ds)
      .army.filter((v) => v.code === "detachment-restriction-required")
      .map((v) => v.id);

  it("gives the included unit the army's Faction keywords", () => {
    expect(restricted(build(true))).toEqual([]);
  });

  it("leaves the unit its own Faction keywords without the flag", () => {
    expect(restricted(build(false))).toEqual(["example-guest-squad"]);
  });
});

describe("allyKeywordLimitViolations", () => {
  const rule = (extra: Partial<AlliedRule>): AlliedRule => ({ id: "example-pool", name: "Example Pool", game_version: GV, ...extra });
  const codes = (r: AlliedRule, members: string[][]) =>
    allyKeywordLimitViolations(r, members.map((m) => new Set(m)), "strike-force").map((v) => `${v.code}:${v.id}`);
  const retinue = rule({
    keyword_limits: [
      {
        keyword: "Retinue",
        battle_size: "strike-force",
        max_count: 1,
        exemptions: [{ donor_keywords: ["Seer"], receiver_keywords: ["Acolytes"] }],
      },
    ],
  });

  it("exempts one receiver per donor", () => {
    expect(codes(retinue, [["Seer"], ["Retinue", "Acolytes"], ["Retinue"]])).toEqual([]);
    expect(codes(retinue, [["Seer"], ["Retinue", "Acolytes"], ["Retinue", "Acolytes"], ["Retinue"]])).toEqual([
      "ally-keyword-limit-exceeded:example-pool:Retinue",
    ]);
  });

  it("exempts nothing without a donor, and matches keywords case-insensitively", () => {
    expect(codes(retinue, [["retinue", "acolytes"], ["Retinue"]])).toEqual(["ally-keyword-limit-exceeded:example-pool:Retinue"]);
    expect(codes(retinue, [["seer"], ["retinue", "ACOLYTES"], ["Retinue"]])).toEqual([]);
  });

  it("treats exclusive limits as alternatives at any battle size", () => {
    const knights = rule({
      keyword_limits_exclusive: true,
      keyword_limits: [
        { keyword: "Titanic", battle_size: "incursion", max_count: 1 },
        { keyword: "Armiger", battle_size: "incursion", max_count: 3 },
      ],
    });
    expect(codes(knights, [["Armiger"], ["Armiger"]])).toEqual([]);
    expect(codes(knights, [["Titanic"], ["Armiger"]])).toEqual(["ally-keyword-limits-exclusive:example-pool"]);
    expect(codes({ ...knights, keyword_limits_exclusive: false }, [["Titanic"], ["Armiger"]])).toEqual([]);
  });
});

describe("allyPoolViolations", () => {
  const rule = (extra: Partial<AlliedRule>): AlliedRule => ({ id: "example-pool", name: "Example Pool", game_version: GV, ...extra });
  const member = (index: number, keywords: string[], extra: Partial<AllyMember> = {}): AllyMember => ({
    unitId: `example-unit-${index}`,
    index,
    cost: 100,
    isWarlord: false,
    hasEnhancement: false,
    battleline: false,
    keywords: new Set(keywords),
    ...extra,
  });
  const codes = (r: AlliedRule, members: AllyMember[], exempt: string[] = []) =>
    allyPoolViolations(r, members, "strike-force", new Set(exempt)).map((v) => `${v.unitIndex ?? "army"}|${v.code}:${v.id}`);

  it("caps the members' combined cost at the battle size's limit", () => {
    const capped = rule({ points_limits: [{ battle_size: "strike-force", max_points: 200 }] });
    expect(codes(capped, [member(0, []), member(1, [])])).toEqual([]);
    expect(codes(capped, [member(0, []), member(1, [], { cost: 101 })])).toEqual(["army|ally-points-over-limit:example-pool"]);
    expect(allyPoolViolations(capped, [member(0, [], { cost: 500 })], "incursion", new Set())).toEqual([]);
  });

  it("locks Warlord and Enhancements, lifting the Warlord lock for a detachment-named datasheet", () => {
    const locked = rule({ cannot_be_warlord: true, cannot_take_enhancements: true });
    const lord = member(2, [], { isWarlord: true, hasEnhancement: true });
    expect(codes(locked, [lord])).toEqual([
      "2|ally-cannot-be-warlord:example-unit-2",
      "2|ally-cannot-take-enhancements:example-unit-2",
    ]);
    expect(codes(locked, [lord], ["example-unit-2"])).toEqual(["2|ally-cannot-take-enhancements:example-unit-2"]);
  });

  it("lets non-Battleline units of a ratio keyword at most match its Battleline units", () => {
    const pact = rule({ battleline_ratio_keywords: ["Khorne", "Nurgle"] });
    const line = member(0, ["Khorne"], { battleline: true });
    expect(codes(pact, [line, member(1, ["khorne"])])).toEqual([]);
    expect(codes(pact, [line, member(1, ["Khorne"]), member(2, ["KHORNE"])])).toEqual([
      "army|ally-battleline-ratio-exceeded:example-pool:Khorne",
    ]);
    // A Battleline unit of another keyword does not cover a Nurgle unit.
    expect(codes(pact, [line, member(1, ["Nurgle"])])).toEqual(["army|ally-battleline-ratio-exceeded:example-pool:Nurgle"]);
  });
});
