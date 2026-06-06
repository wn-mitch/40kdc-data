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

// Real NewRecruit full exports mix compact-style lines into the full layout:
// single-model units arrive as one `Unit (pts): wargear` line, and model-type
// bullets may inline their loadout after a colon. A World Eaters tournament
// list in this shape previously lost all seven of its single-line units.
const MIXED_FULL_SAMPLE = `+++++++++++++++++++++++++++++++++++++++++++++++
+ FACTION KEYWORD: Chaos - World Eaters
+ DETACHMENT: Possessed Slaughterband (Brazen Fury)
+ TOTAL ARMY POINTS: 2000pts
+
+ WARLORD: Char1: Angron
+ ENHANCEMENT: 
+ NUMBER OF UNITS: 14
+ SECONDARY: - Bring It Down: (2x2) + (1x4) - Assassination: 5 Characters
+++++++++++++++++++++++++++++++++++++++++++++++

Char1: 1x Angron (340 pts): Warlord, Samni'arius and Spinegrinder
Char2: 1x Khârn the Betrayer (100 pts): Gorechild, Plasma pistol
Char3: 1x Slaughterbound (100 pts): Lacerator and daemonic claw
Char4: 1x Slaughterbound (100 pts): Lacerator and daemonic claw
Char5: 1x Slaughterbound (100 pts): Lacerator and daemonic claw

6x Eightbound (270 pts)
• 1x Eightbound Champion: Chainblades
• 5x Eightbound: 5 with Chainblades
3x Eightbound (135 pts)
• 1x Eightbound Champion: Chainblades
• 2x Eightbound: 2 with Chainblades
3x Eightbound (135 pts)
• 1x Eightbound Champion: Chainblades
• 2x Eightbound: 2 with Chainblades
3x Exalted Eightbound (140 pts)
• 1x Exalted Eightbound Champion: Chainblades
• 2x Exalted Eightbound: 2 with Chainblades
3x Exalted Eightbound (140 pts)
• 1x Exalted Eightbound Champion: Chainblades
• 2x Exalted Eightbound: 2 with Chainblades
8x Goremongers (75 pts)
• 1x Blood Herald: Autopistol, Chainblade, Close combat weapon
• 7x Goremonger: 7 with Autopistol, Chainblade, Close combat weapon
10x Jakhals (65 pts)
• 8x Jakhal
    6 with Autopistol, Chainblades
    1 with Icon of Khorne, Autopistol, Chainblades
    1 with Autopistol, Mauler chainblade
• 1x Jakhal Pack Leader: Autopistol, Chainblades
• 1x Dishonoured: Skullsmasher and mangler
1x Maulerfiend (150 pts): Maulerfiend fists, Lasher tendrils
1x Maulerfiend (150 pts): Maulerfiend fists, Lasher tendrils
`;

describe("newRecruitWtcFullAdapter with mixed compact-style lines", () => {
  it("matches as full format", () => {
    expect(newRecruitWtcFullAdapter.matches(MIXED_FULL_SAMPLE)).toBe(true);
  });

  const parsed = newRecruitWtcFullAdapter.parse(MIXED_FULL_SAMPLE);

  it("keeps every unit, including single-line characters and vehicles", () => {
    expect(parsed.units).toHaveLength(14);
    const names = parsed.units.map((u) => u.raw_name);
    expect(names.filter((n) => n === "Slaughterbound")).toHaveLength(3);
    expect(names.filter((n) => n === "Maulerfiend")).toHaveLength(2);
    expect(names).toContain("Angron");
    expect(names).toContain("Khârn the Betrayer");
  });

  it("classifies single-line characters and strips the Warlord marker", () => {
    const angron = parsed.units.find((u) => u.raw_name === "Angron");
    expect(angron?.is_character).toBe(true);
    expect(angron?.is_warlord).toBe(true);
    expect(angron?.points).toBe(340);
    expect(angron?.wargear).toEqual([
      { raw_name: "Samni'arius and Spinegrinder", count: 1 },
    ]);
  });

  it("captures inline loadouts on model-type bullets", () => {
    const bigEightbound = parsed.units.find(
      (u) => u.raw_name === "Eightbound" && u.model_count === 6,
    );
    expect(bigEightbound?.wargear).toEqual([{ raw_name: "Chainblades", count: 6 }]);

    const goremongers = parsed.units.find((u) => u.raw_name === "Goremongers");
    expect(goremongers?.model_count).toBe(8);
    expect(goremongers?.wargear).toEqual([
      { raw_name: "Autopistol", count: 8 },
      { raw_name: "Chainblade", count: 8 },
      { raw_name: "Close combat weapon", count: 8 },
    ]);
  });

  it("still handles plain breakdowns with indented `N with` continuations", () => {
    const jakhals = parsed.units.find((u) => u.raw_name === "Jakhals");
    expect(jakhals?.model_count).toBe(10);
    const byName = Object.fromEntries(
      (jakhals?.wargear ?? []).map((w) => [w.raw_name, w.count]),
    );
    expect(byName["Autopistol"]).toBe(9); // 6 + 1 icon-bearer + 1 mauler + pack leader
    expect(byName["Chainblades"]).toBe(8); // 6 + 1 icon-bearer + pack leader
    expect(byName["Mauler chainblade"]).toBe(1);
    expect(byName["Skullsmasher and mangler"]).toBe(1);
  });

  it("computes the full 2000-point total", () => {
    expect(parsed.total_computed).toBe(2000);
  });
});
