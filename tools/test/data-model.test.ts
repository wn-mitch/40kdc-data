import { describe, it, expect } from "vitest";

import {
  abilities,
  Dataset,
  dataset,
  emptyRawData,
  factions,
  normalizeName,
  units,
  weapons,
} from "../src/data/index.js";
import { RAW_DATA } from "../src/data/bundle.generated.js";

describe("normalizeName", () => {
  it("strips diacritics via NFD", () => {
    expect(normalizeName("Khârn the Betrayer")).toBe("kharn the betrayer");
    expect(normalizeName("Brôkhyr")).toBe("brokhyr");
    expect(normalizeName("Ûthar")).toBe("uthar");
  });

  it("removes apostrophe and quote variants", () => {
    expect(normalizeName("Be’lakor")).toBe("belakor");
    expect(normalizeName("Kor’sarro Khan")).toBe("korsarro khan");
    expect(normalizeName("Aetaos'rau'keres")).toBe("aetaosraukeres");
  });

  it("collapses whitespace and hyphens, then trims", () => {
    expect(normalizeName("Brôkhyr Iron-master")).toBe("brokhyr iron master");
    expect(normalizeName("  the   betrayer  ")).toBe("the betrayer");
  });

  it("is idempotent on already-normalized input", () => {
    expect(normalizeName(normalizeName("Khârn the Betrayer"))).toBe("kharn the betrayer");
  });
});

describe("Collection.find / findAll", () => {
  it("matches by exact id", () => {
    expect(units.find("kharn-the-betrayer")?.id).toBe("kharn-the-betrayer");
  });

  it("matches by exact normalized name", () => {
    expect(units.find("Khârn the Betrayer")?.id).toBe("kharn-the-betrayer");
  });

  it("falls back to a normalized-name substring", () => {
    expect(units.find("Betrayer")?.id).toBe("kharn-the-betrayer");
  });

  it("returns undefined on a miss", () => {
    expect(units.find("definitely-not-a-real-unit")).toBeUndefined();
    expect(units.find("")).toBeUndefined();
  });

  it("findAll surfaces every match for a shared name", () => {
    const all = units.findAll("Ministorum Priest");
    expect(all.length).toBe(3);
    expect(new Set(all.map((u) => u.faction?.id))).toEqual(
      new Set(["adepta-sororitas", "agents-of-the-imperium", "astra-militarum"]),
    );
  });

  it("byFaction disambiguates a unit shared across factions", () => {
    for (const f of ["adepta-sororitas", "agents-of-the-imperium", "astra-militarum"]) {
      expect(units.byFaction(f).some((u) => u.id === "ministorum-priest")).toBe(true);
    }
  });

  it("getInFaction returns the requested faction's copy of a shared chassis", () => {
    // `chaos-land-raider` exists under several Chaos factions; faction-blind
    // `get` returns whichever was registered first, so a consumer that knows
    // the faction must scope by it. (Regression guard for the World Eaters
    // "pick a unit" collision.)
    for (const f of ["chaos-space-marines", "death-guard", "world-eaters"]) {
      const u = units.getInFaction("chaos-land-raider", f);
      expect(u, `chaos-land-raider in ${f}`).toBeDefined();
      expect(u!.id).toBe("chaos-land-raider");
      expect(u!.raw.faction_id).toBe(f);
    }
  });

  it("getInFaction returns undefined when the id is absent from the faction", () => {
    expect(units.getInFaction("chaos-land-raider", "adepta-sororitas")).toBeUndefined();
  });
});

describe("internationalization (diacritic- and punctuation-insensitive lookup)", () => {
  // [ascii query, exact-as-printed query, expected id]
  const cases: [string, string, string][] = [
    ["Kharn the Betrayer", "Khârn the Betrayer", "kharn-the-betrayer"],
    ["Belakor", "Be’lakor", "belakor"],
    ["Korsarro Khan", "Kor’sarro Khan", "korsarro-khan"],
    ["Brokhyr Iron-master", "Brôkhyr Iron-master", "brokhyr-iron-master"],
    ["Uthar the Destined", "Ûthar the Destined", "uthar-the-destined"],
  ];

  for (const [ascii, exact, id] of cases) {
    it(`resolves "${ascii}" and "${exact}" → ${id}`, () => {
      expect(units.find(ascii)?.id).toBe(id);
      expect(units.find(exact)?.id).toBe(id);
    });
  }

  it("is case-insensitive", () => {
    expect(units.find("KHÂRN THE BETRAYER")?.id).toBe("kharn-the-betrayer");
    expect(units.find("be'LAKOR")?.id).toBe("belakor");
  });

  it("does not over-collapse genuinely distinct names", () => {
    expect(normalizeName("Khârn")).not.toBe(normalizeName("Kâhl"));
    // an exact unique name must not pull in unrelated entities
    expect(units.findAll("Khârn the Betrayer").map((u) => u.id)).toEqual(["kharn-the-betrayer"]);
  });
});

describe("Kharn proof (the headline one-liner)", () => {
  const kharn = units.find("Kharn");

  it("resolves and links faction / weapons / abilities", () => {
    expect(kharn).toBeDefined();
    expect(kharn!.faction?.id).toBe("world-eaters");
    expect(kharn!.weapons.length).toBe(2);
    expect(kharn!.abilities.map((a) => a.id).sort()).toEqual(
      ["berzerker-frenzy", "leader", "legendary-killer", "the-betrayer"],
    );
  });

  it("filters abilities by phase", () => {
    const shooting = kharn!.abilities.filter((a) => a.phases.includes("shooting"));
    expect(shooting.map((a) => a.id)).toEqual(["berzerker-frenzy"]);
  });
});

describe("AbilityView.phases (joined via phase-mappings)", () => {
  it("unions phases across a mapping", () => {
    expect(abilities.get("deadly-demise-d3")?.phases.sort()).toEqual(["fight", "shooting"]);
  });

  it("is empty for an ability with no phase-mapping", () => {
    expect(abilities.get("leader")?.phases).toEqual([]);
  });
});

describe("reverse links", () => {
  it("AbilityView.units lists units that have the ability", () => {
    expect(abilities.get("berzerker-frenzy")?.units.map((u) => u.id)).toContain(
      "kharn-the-betrayer",
    );
  });

  it("WeaponView.units lists carriers", () => {
    const kharn = units.find("Kharn")!;
    const weapon = kharn.weapons[0];
    expect(weapon.units.some((u) => u.id === "kharn-the-betrayer")).toBe(true);
  });

  it("FactionView links units / weapons", () => {
    const we = factions.find("World Eaters")!;
    expect(we.units.length).toBeGreaterThan(0);
    expect(we.weapons.length).toBeGreaterThan(0);
  });
});

describe("leadersAttachableTo", () => {
  it("lists leaders whose attachment data covers the body unit, sorted by name", () => {
    const leaders = dataset.leadersAttachableTo("battle-sisters-squad");
    expect(leaders.map((l) => l.id)).toContain("palatine");
    const names = leaders.map((l) => l.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("returns an empty array for a leader unit (nothing attaches to it)", () => {
    expect(dataset.leadersAttachableTo("palatine")).toEqual([]);
  });

  it("returns an empty array for an unknown unit id", () => {
    expect(dataset.leadersAttachableTo("no-such-unit")).toEqual([]);
  });
});

describe("bodyguardsAttachableFrom", () => {
  it("lists the body units a leader can join, sorted by name", () => {
    const bodies = dataset.bodyguardsAttachableFrom("palatine");
    expect(bodies.map((b) => b.id)).toContain("battle-sisters-squad");
    const names = bodies.map((b) => b.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("is the inverse of leadersAttachableTo", () => {
    // palatine → battle-sisters-squad, and battle-sisters-squad → palatine.
    expect(dataset.bodyguardsAttachableFrom("palatine").map((b) => b.id)).toContain(
      "battle-sisters-squad",
    );
    expect(dataset.leadersAttachableTo("battle-sisters-squad").map((l) => l.id)).toContain(
      "palatine",
    );
  });

  it("returns an empty array for a non-leader unit", () => {
    expect(dataset.bodyguardsAttachableFrom("battle-sisters-squad")).toEqual([]);
  });

  it("returns an empty array for an unknown unit id", () => {
    expect(dataset.bodyguardsAttachableFrom("no-such-unit")).toEqual([]);
  });
});

describe("edge cases", () => {
  it("a Space Marine successor faction resolves without throwing (units may be inherited)", () => {
    const ultra = factions.get("ultramarines");
    expect(ultra).toBeDefined();
    expect(() => ultra!.units).not.toThrow();
  });

  it("skips dangling link ids rather than throwing", () => {
    const ds = new Dataset({
      ...emptyRawData(),
      units: [
        {
          id: "ghost",
          name: "Ghost",
          faction_id: "nowhere",
          profiles: [{ M: 1, T: 1, W: 1, Sv: 1, Ld: 1, OC: 1 } as never],
          weapon_ids: ["missing-weapon"],
          ability_ids: ["missing-ability"],
          game_version: { edition: "11th", dataslate: "test" },
        } as never,
      ],
    });
    const ghost = ds.units.get("ghost")!;
    expect(ghost.weapons).toEqual([]);
    expect(ghost.abilities).toEqual([]);
    expect(ghost.faction).toBeUndefined();
  });
});

describe("collection integrity", () => {
  it("exposes the embedded data", () => {
    expect(units.size).toBeGreaterThan(1000);
    expect(factions.size).toBe(35);
    expect(weapons.size).toBeGreaterThan(0);
    expect(abilities.size).toBeGreaterThan(0);
  });

  it("deduplicates abilities by id (no duplicate ids in .all)", () => {
    const ids = abilities.all.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("folds shared _core abilities into the collection", () => {
    expect(abilities.get("benefit-of-cover")).toBeDefined();
  });

  it("is iterable", () => {
    const collected = [...factions];
    expect(collected.length).toBe(factions.size);
  });

  it("ability dedupe reduced the raw count (core abilities copied per faction)", () => {
    expect(abilities.size).toBeLessThan(RAW_DATA.abilities.length);
  });
});

function emptyRaw() {
  return {
    units: [],
    weapons: [],
    weaponKeywords: [],
    factions: [],
    abilities: [],
    phaseMappings: [],
    detachments: [],
    stratagems: [],
    enhancements: [],
    leaderAttachments: [],
    unitCompositions: [],
    wargearOptions: [],
    gameVersions: [],
    missions: [],
    missionMatchups: [],
    secondaryCards: [],
    deploymentPatterns: [],
    forceDispositions: [],
    resourcePools: [],
    timingFlags: [],
    interactionFlags: [],
  };
}
