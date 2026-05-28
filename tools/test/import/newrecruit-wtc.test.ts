import { describe, it, expect } from "vitest";
import {
  newRecruitWtcCompactAdapter,
  newRecruitWtcFullAdapter,
} from "../../src/import/newrecruit-wtc.js";

const COMPACT_SAMPLE = `+++++++++++++++++++++++++++++++++++++++++++++++
+ FACTION KEYWORD: Chaos - Chaos Knights
+ DETACHMENT: Houndpack Lance (Marked Prey)
+ TOTAL ARMY POINTS: 2000pts
+
+ WARLORD: Char3: War Dog Executioner
+ ENHANCEMENT: Preyslayer's Mantle (on Batt1: War Dog Karnivore)
+ NUMBER OF UNITS: 4
+ SECONDARY: - Bring It Down: (13x2) - Assassination: 3 Characters
+++++++++++++++++++++++++++++++++++++++++++++++

Char3: 1x War Dog Executioner (130 pts): Houndpack Lance Character, Warlord, Armoured feet, 2x War Dog autocannon, Diabolus heavy stubber
Char1: 1x War Dog Karnivore (165 pts): Houndpack Lance Character, Reaper chaintalon, Slaughterclaw, Havoc multi-launcher
Enhancement: Preyslayer's Mantle (+15 pts)
1x War Dog Karnivore (150 pts): Reaper chaintalon, Slaughterclaw, Havoc multi-launcher
3x Nurglings (40 pts): 3 with Diseased claws and teeth
`;

const FULL_SAMPLE = `+++++++++++++++++++++++++++++++++++++++++++++++
+ FACTION KEYWORD: Chaos - Chaos Knights
+ DETACHMENT: Houndpack Lance (Marked Prey)
+ TOTAL ARMY POINTS: 2000pts
+
+ WARLORD: Char3: War Dog Executioner
+ ENHANCEMENT: Preyslayer's Mantle (on Batt1: War Dog Karnivore)
+ NUMBER OF UNITS: 4
+ SECONDARY: - Bring It Down: (13x2) - Assassination: 3 Characters
+++++++++++++++++++++++++++++++++++++++++++++++

BATTLELINE

Char3: 1x War Dog Executioner (130 pts)
1 with Armoured feet, 2x War Dog autocannon, Diabolus heavy stubber, Houndpack Lance Character, Warlord

Char1: 1x War Dog Karnivore (165 pts)
1 with Reaper chaintalon, Slaughterclaw, Havoc multi-launcher, Houndpack Lance Character
Enhancement: Preyslayer's Mantle (+15 pts)

1x War Dog Karnivore (150 pts)
1 with Reaper chaintalon, Slaughterclaw, Havoc multi-launcher

ALLIED UNITS

3x Nurglings (40 pts)
• 3x Nurgling Swarm
    3 with Diseased claws and teeth
`;

describe("newRecruitWtcCompactAdapter", () => {
  it("matches compact text but rejects full text and JSON", () => {
    expect(newRecruitWtcCompactAdapter.matches(COMPACT_SAMPLE)).toBe(true);
    expect(newRecruitWtcCompactAdapter.matches(FULL_SAMPLE)).toBe(false);
    expect(newRecruitWtcCompactAdapter.matches({ roster: { forces: [] } })).toBe(false);
    expect(newRecruitWtcCompactAdapter.matches("not a wtc list")).toBe(false);
  });

  const parsed = newRecruitWtcCompactAdapter.parse(COMPACT_SAMPLE);

  it("extracts faction, detachment, and inferred battle size", () => {
    expect(parsed.faction_raw_name).toBe("Chaos Knights"); // last segment after " - "
    expect(parsed.detachment_raw_name).toBe("Houndpack Lance"); // parenthetical stripped
    expect(parsed.declared_limit).toBe(2000);
    expect(parsed.total_reported).toBe(2000);
    expect(parsed.battle_size_raw).toContain("Strike Force");
  });

  it("captures units in declaration order with correct points and counts", () => {
    expect(parsed.units.map((u) => u.raw_name)).toEqual([
      "War Dog Executioner",
      "War Dog Karnivore",
      "War Dog Karnivore",
      "Nurglings",
    ]);

    const exec = parsed.units[0];
    expect(exec.points).toBe(130);
    expect(exec.is_warlord).toBe(true);
    expect(exec.is_character).toBe(true);
    expect(exec.model_count).toBe(1);

    const karWarlord = parsed.units[1];
    expect(karWarlord.points).toBe(150); // 165 displayed minus 15 enhancement = 150 base
    expect(karWarlord.enhancement_raw_name).toBe("Preyslayer's Mantle");
    expect(karWarlord.is_character).toBe(true);

    const nurglings = parsed.units[3];
    expect(nurglings.points).toBe(40);
    expect(nurglings.model_count).toBe(3); // "3x Nurglings" — leading count carries through
  });

  it("strips Warlord and detachment-Character markers from the wargear list", () => {
    const exec = parsed.units[0];
    const wargearNames = exec.wargear.map((w) => w.raw_name);
    expect(wargearNames).not.toContain("Warlord");
    expect(wargearNames).not.toContain("Houndpack Lance Character");
    expect(wargearNames).toContain("Armoured feet");
    expect(wargearNames).toContain("Diabolus heavy stubber");

    // Multiplicity preserved
    const autocannon = exec.wargear.find((w) => w.raw_name === "War Dog autocannon");
    expect(autocannon?.count).toBe(2);
  });

  it("sums total_computed across base unit pts + enhancement pts", () => {
    // 130 (exec) + 150 (karnivore-warlord base) + 15 (preyslayer) + 150 (karnivore-plain) + 40 (nurglings)
    expect(parsed.total_computed).toBe(485);
  });

  it("does not leak any prose fields", () => {
    expect(JSON.stringify(parsed)).not.toMatch(/description/i);
  });
});

describe("newRecruitWtcFullAdapter", () => {
  it("matches full text only and disambiguates from compact", () => {
    expect(newRecruitWtcFullAdapter.matches(FULL_SAMPLE)).toBe(true);
    expect(newRecruitWtcFullAdapter.matches(COMPACT_SAMPLE)).toBe(false);
  });

  const parsed = newRecruitWtcFullAdapter.parse(FULL_SAMPLE);

  it("reads section headers without recording them as units", () => {
    expect(parsed.units.map((u) => u.raw_name)).toEqual([
      "War Dog Executioner",
      "War Dog Karnivore",
      "War Dog Karnivore",
      "Nurglings",
    ]);
  });

  it("attaches an Enhancement line to the immediately preceding unit", () => {
    const karWarlord = parsed.units[1];
    expect(karWarlord.enhancement_raw_name).toBe("Preyslayer's Mantle");
    expect(karWarlord.points).toBe(150); // 165 - 15

    const karPlain = parsed.units[2];
    expect(karPlain.enhancement_raw_name).toBeNull();
  });

  it("collapses a `• Nx ModelType` breakdown into model_count + wargear", () => {
    const nurglings = parsed.units[3];
    expect(nurglings.model_count).toBe(3);
    expect(nurglings.wargear).toEqual([{ raw_name: "Diseased claws and teeth", count: 3 }]);
  });

  it("flags multi_force when an ALLIED UNITS section is present", () => {
    expect(parsed.multi_force).toBe(true);
  });
});
