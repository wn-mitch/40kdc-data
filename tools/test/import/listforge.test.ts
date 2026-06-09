import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listForgeAdapter } from "../../src/import/listforge.js";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url)), "utf8"),
  );

describe("listForgeAdapter.parse", () => {
  const parsed = listForgeAdapter.parse(fixture("gk-banishers.payload.json"));

  it("recognises a ListForge payload", () => {
    expect(listForgeAdapter.matches(fixture("gk-banishers.payload.json"))).toBe(true);
    expect(listForgeAdapter.matches({ not: "a roster" })).toBe(false);
  });

  it("extracts faction, detachment, and battle size", () => {
    expect(parsed.faction_raw_name).toBe("Grey Knights");
    expect(parsed.detachment_raw_names).toEqual(["Banishers"]);
    expect(parsed.battle_size_raw).toContain("Strike Force");
    expect(parsed.declared_limit).toBe(2000);
  });

  it("sums the computed total across all cost lines", () => {
    expect(parsed.total_reported).toBe(585);
    expect(parsed.total_computed).toBe(585); // 90 + 225 + 20 + 250
  });

  it("extracts units with model counts and points", () => {
    const names = parsed.units.map((u) => u.raw_name);
    expect(names).toContain("Castellan Crowe");
    expect(names).toContain("Grand Master in Nemesis Dreadknight");
    expect(names).toContain("Purifier Squad");

    const squad = parsed.units.find((u) => u.raw_name === "Purifier Squad")!;
    expect(squad.model_count).toBe(10); // 1 Knight of the Flame + 9 Purifiers
  });

  it("flags the warlord and the enhancement", () => {
    const gm = parsed.units.find((u) => u.raw_name.startsWith("Grand Master"))!;
    expect(gm.is_warlord).toBe(true);
    expect(gm.enhancement_raw_name).toBe("Pyresoul (Psychic)");
    expect(gm.is_character).toBe(true);
  });

  it("collects wargear names without treating the enhancement as a weapon", () => {
    const gm = parsed.units.find((u) => u.raw_name.startsWith("Grand Master"))!;
    const weapons = gm.wargear.map((w) => w.raw_name);
    expect(weapons).toContain("Heavy psycannon");
    expect(weapons).toContain("Nemesis daemon greathammer");
    expect(weapons).not.toContain("Pyresoul (Psychic)");
    expect(weapons).not.toContain("Warlord");
  });

  it("does not leak any rules/prose fields into the parsed output", () => {
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toMatch(/description/i);
    expect(serialized).not.toMatch(/\$text/);
  });
});
