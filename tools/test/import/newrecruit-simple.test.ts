import { describe, it, expect } from "vitest";
import { newRecruitSimpleAdapter } from "../../src/import/newrecruit-simple.js";

const SAMPLE = `Chaos - Chaos Knights - Dog Kill God? - [2000 pts]

# ++ Army Roster ++ [2000 pts]
## Configuration
Battle Size: Strike Force (2000 Point limit)
Detachment: Houndpack Lance
Show/Hide Options: Nurgle Daemons are visible

## Battleline [1855 pts]
War Dog Karnivore [165 pts]: Houndpack Lance Character, Preyslayer's Mantle [15 pts], Reaper chaintalon, Slaughterclaw, Havoc multi-launcher
War Dog Karnivore [150 pts]: Reaper chaintalon, Slaughterclaw, Havoc multi-launcher
War Dog Executioner [130 pts]: Houndpack Lance Character, Warlord, Armoured feet, 2x War Dog autocannon, Diabolus heavy stubber

## Allied Units [145 pts]
Nurglings [40 pts]:
• 3x Nurgling Swarm: Diseased claws and teeth
Beasts of Nurgle [65 pts]:
• 1x Beast of Nurgle [65 pts]: Putrid appendages
`;

describe("newRecruitSimpleAdapter", () => {
  it("matches simple text only", () => {
    expect(newRecruitSimpleAdapter.matches(SAMPLE)).toBe(true);
    expect(newRecruitSimpleAdapter.matches("+ FACTION KEYWORD: …")).toBe(false);
    expect(newRecruitSimpleAdapter.matches({ roster: { forces: [] } })).toBe(false);
  });

  const parsed = newRecruitSimpleAdapter.parse(SAMPLE);

  it("extracts name, faction, and declared limit from the first line", () => {
    expect(parsed.name).toBe("Dog Kill God?");
    expect(parsed.faction_raw_name).toBe("Chaos Knights");
    expect(parsed.declared_limit).toBe(2000);
    expect(parsed.total_reported).toBe(2000); // from `# ++ Army Roster ++ [2000 pts]`
  });

  it("reads battle size and detachment from the Configuration section", () => {
    expect(parsed.battle_size_raw).toBe("Strike Force (2000 Point limit)");
    expect(parsed.detachment_raw_name).toBe("Houndpack Lance");
  });

  it("captures units in declaration order", () => {
    expect(parsed.units.map((u) => u.raw_name)).toEqual([
      "War Dog Karnivore",
      "War Dog Karnivore",
      "War Dog Executioner",
      "Nurglings",
      "Beasts of Nurgle",
    ]);
  });

  it("recognises the inline Name [N pts] enhancement and subtracts its cost from unit points", () => {
    const karWarlord = parsed.units[0];
    expect(karWarlord.enhancement_raw_name).toBe("Preyslayer's Mantle");
    expect(karWarlord.points).toBe(150); // 165 displayed minus 15 enhancement
    expect(karWarlord.is_character).toBe(true);
    expect(karWarlord.is_warlord).toBe(false);
    expect(karWarlord.wargear.map((w) => w.raw_name)).not.toContain("Preyslayer's Mantle");
  });

  it("strips Warlord and detachment Character markers from wargear", () => {
    const exec = parsed.units[2];
    expect(exec.is_warlord).toBe(true);
    expect(exec.is_character).toBe(true);
    const names = exec.wargear.map((w) => w.raw_name);
    expect(names).not.toContain("Warlord");
    expect(names).not.toContain("Houndpack Lance Character");
    const autocannon = exec.wargear.find((w) => w.raw_name === "War Dog autocannon");
    expect(autocannon?.count).toBe(2);
  });

  it("expands a `• Nx ModelType` breakdown into model_count + per-model wargear", () => {
    const nurglings = parsed.units[3];
    expect(nurglings.model_count).toBe(3);
    expect(nurglings.wargear).toEqual([{ raw_name: "Diseased claws and teeth", count: 3 }]);

    const beasts = parsed.units[4];
    expect(beasts.model_count).toBe(1);
    expect(beasts.wargear).toEqual([{ raw_name: "Putrid appendages", count: 1 }]);
  });

  it("flags multi_force when an `Allied Units` section is present", () => {
    expect(parsed.multi_force).toBe(true);
  });

  it("sums total_computed including enhancement pts", () => {
    // 150 (kar-warlord base) + 15 (preyslayer) + 150 + 130 + 40 + 65 = 550
    expect(parsed.total_computed).toBe(550);
  });

  it("does not leak any prose fields", () => {
    expect(JSON.stringify(parsed)).not.toMatch(/description/i);
  });
});
