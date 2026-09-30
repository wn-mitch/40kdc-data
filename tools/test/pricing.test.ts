import { describe, it, expect } from "vitest";

import { dataset } from "../src/data/index.js";
import type { Unit } from "../src/generated.js";
import { baseUnitPoints, hostUnitPoints, pointsTierMissing, wargearPoints } from "../src/data/pricing.js";

// World Eaters Chaos Terminators are priced by army ordinal: 175 for your 1st–2nd
// copy, 185 for your 3rd+ at 5 models, and 350/360 for a 6–10 model squad (a
// range tier). The id is shared with Emperor's Children, so resolve the WE copy.
const ct = dataset.units.getInFaction("chaos-terminators", "world-eaters")!.raw;

describe("baseUnitPoints — ordinal bands", () => {
  it("prices the 1st–2nd army copy at the lower band", () => {
    expect(baseUnitPoints(ct, 5, 1)).toBe(175);
    expect(baseUnitPoints(ct, 5, 2)).toBe(175);
    expect(baseUnitPoints(ct, 10, 1)).toBe(350);
  });

  it("prices the 3rd+ army copy at the higher band", () => {
    expect(baseUnitPoints(ct, 5, 3)).toBe(185);
    expect(baseUnitPoints(ct, 10, 3)).toBe(360);
    expect(baseUnitPoints(ct, 5, 7)).toBe(185); // open-ended top band
  });

  it("defaults to the 1st army copy when no ordinal is given", () => {
    expect(baseUnitPoints(ct, 5)).toBe(175);
  });

  it("picks the highest model tier the count reaches, within the band", () => {
    expect(baseUnitPoints(ct, 10, 1)).toBe(350);
    expect(baseUnitPoints(ct, 7, 1)).toBe(350); // inside the 6–10 range tier
    expect(baseUnitPoints(ct, 4, 1)).toBe(175); // below smallest tier → lowest tier
  });

  it("ignores ordinal for an unbanded unit (no unit_count_min)", () => {
    const bz = dataset.units.getAny("khorne-berzerkers")!.raw;
    expect(baseUnitPoints(bz, 10, 1)).toBe(baseUnitPoints(bz, 10, 99));
  });
});

describe("pointsTierMissing — ordinal-aware", () => {
  it("is false for a covered model count + ordinal, true below the smallest tier", () => {
    expect(pointsTierMissing(ct, 5, 1)).toBe(false);
    expect(pointsTierMissing(ct, 5, 3)).toBe(false);
    expect(pointsTierMissing(ct, 4, 1)).toBe(true);
  });
});

// Venatari Custodians are GW range-priced: 3 models @150 for the first two
// copies (160 thereafter), or 4–6 @300 (310 thereafter). The range tiers carry
// models_max=6, so every size in their range prices at the matching tier cost.
const ven = dataset.units.getInFaction("venatari-custodians", "adeptus-custodes")!.raw;

describe("range-priced tiers (models_max)", () => {
  it("prices every size in a range tier at that tier's cost", () => {
    expect(ven.points).toEqual([
      { models: 3, cost: 150, unit_count_min: 1, unit_count_max: 2 },
      { models: 4, models_max: 6, cost: 300, unit_count_min: 1, unit_count_max: 2 },
      { models: 3, cost: 160, unit_count_min: 3, unit_count_max: null },
      { models: 4, models_max: 6, cost: 310, unit_count_min: 3, unit_count_max: null },
    ]);
    expect(baseUnitPoints(ven, 3)).toBe(150);
    expect(baseUnitPoints(ven, 4)).toBe(300);
    expect(baseUnitPoints(ven, 5)).toBe(300);
    expect(baseUnitPoints(ven, 6)).toBe(300);
  });

  it("flags counts outside every tier range (below floor, above ceiling)", () => {
    expect(pointsTierMissing(ven, 2)).toBe(true); // below the 3-model tier
    expect(pointsTierMissing(ven, 3)).toBe(false);
    expect(pointsTierMissing(ven, 4)).toBe(false);
    expect(pointsTierMissing(ven, 6)).toBe(false);
    expect(pointsTierMissing(ven, 7)).toBe(true); // above the 6-model ceiling
  });
});

// A Terminator Assault Squad's storm shields are priced per copy (5 pts each);
// the Victrix Honour Guard's Banner of Macragge is a priced non-weapon wargear
// default (15 pts), and its Blades of Honour carry no cost.
const tas = dataset.units.getInFaction("terminator-assault-squad", "adeptus-astartes")!.raw;
const vhg = dataset.units.getInFaction("victrix-honour-guard", "adeptus-astartes")!.raw;

describe("wargearPoints — per-item MFM surcharge over a loadout", () => {
  it("charges each priced item per copy in the final loadout", () => {
    expect(tas.wargear_costs).toContainEqual({ item_id: "storm-shield", cost: 5 });
    expect(wargearPoints(tas, new Map([["storm-shield", 5]]))).toBe(25); // 5 shields × 5
    expect(wargearPoints(tas, new Map([["storm-shield", 2]]))).toBe(10);
  });

  it("charges a non-weapon wargear default (Banner of Macragge)", () => {
    expect(vhg.wargear_costs).toEqual([{ item_id: "banner-of-macragge", cost: 15 }]);
    expect(wargearPoints(vhg, new Map([["banner-of-macragge", 1]]))).toBe(15);
    // An item without a cost adds nothing.
    expect(wargearPoints(vhg, new Map([["banner-of-macragge", 1], ["blades-of-honour", 1]]))).toBe(15);
  });

  it("is 0 for items with no cost entry and for a unit without wargear_costs", () => {
    expect(wargearPoints(tas, new Map([["storm-bolter", 3]]))).toBe(0);
    expect(wargearPoints(ven, new Map([["kinetic-destroyer", 6]]))).toBe(0);
  });
});

// Vindicare Assassin carries host-army pricing: 110 native, 125 when allied
// into any IMPERIUM army (`allied_points`, host_faction: "imperium"). The
// Exaction Squad prices the other way (90 native, 85 allied) — direction is
// data, not a rule.
const vind = dataset.units.getInFaction("vindicare-assassin", "agents-of-the-imperium")!.raw;
const agents = dataset.factions.get("agents-of-the-imperium")!.raw;
const bloodAngels = dataset.factions.get("blood-angels")!.raw;
const tyranids = dataset.factions.get("tyranids")!.raw;

describe("hostUnitPoints — allied (host-army) pricing", () => {
  it("prices a foreign unit from its host entry when the army owns the host keyword", () => {
    expect(hostUnitPoints(vind, 1, 1, bloodAngels)).toBe(125);
    const exaction = dataset.units.getAny("exaction-squad")!.raw;
    expect(hostUnitPoints(exaction, 11, 1, bloodAngels)).toBe(85);
  });

  it("prices natively in the unit's own army, regardless of matching entries", () => {
    // agents-of-the-imperium itself owns the Imperium keyword — the own-faction
    // guard must win over the keyword match.
    expect(hostUnitPoints(vind, 1, 1, agents)).toBe(110);
  });

  it("falls back to native with no matching host, and with no army context", () => {
    expect(hostUnitPoints(vind, 1, 1, tyranids)).toBe(110);
    expect(hostUnitPoints(vind, 1, 1)).toBe(110);
    expect(hostUnitPoints(vind, 1, 1, null)).toBe(110);
  });

  it("prefers an exact faction-id entry over a keyword entry", () => {
    const unit = {
      id: "u",
      faction_id: "adeptus-astartes",
      points: [{ models: 5, cost: 85 }],
      allied_points: [
        { models: 5, cost: 95, host_faction: "blood-angels" },
        { models: 5, cost: 90, host_faction: "imperium" },
      ],
    } as Unit;
    expect(hostUnitPoints(unit, 5, 1, bloodAngels)).toBe(95);
  });

  it("keeps ordinal-band selection within the host table", () => {
    const unit = {
      id: "u",
      faction_id: "adeptus-astartes",
      points: [
        { models: 5, cost: 85, unit_count_min: 1, unit_count_max: 2 },
        { models: 5, cost: 95, unit_count_min: 3, unit_count_max: null },
      ],
      allied_points: [
        { models: 5, cost: 95, unit_count_min: 1, unit_count_max: 2, host_faction: "blood-angels" },
        { models: 5, cost: 105, unit_count_min: 3, unit_count_max: null, host_faction: "blood-angels" },
      ],
    } as Unit;
    expect(hostUnitPoints(unit, 5, 1, bloodAngels)).toBe(95);
    expect(hostUnitPoints(unit, 5, 3, bloodAngels)).toBe(105);
    expect(baseUnitPoints(unit, 5, 3)).toBe(95);
  });
});
