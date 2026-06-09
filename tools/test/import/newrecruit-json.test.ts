import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { newRecruitJsonAdapter } from "../../src/import/newrecruit-json.js";
import { listForgeAdapter } from "../../src/import/listforge.js";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url)), "utf8"),
  );

describe("newRecruitJsonAdapter.parse", () => {
  const payload = fixture("chaos-knights-houndpack.newrecruit.payload.json");
  const parsed = newRecruitJsonAdapter.parse(payload);

  it("recognises a NewRecruit payload via xmlns or generatedBy URL", () => {
    expect(newRecruitJsonAdapter.matches(payload)).toBe(true);
    expect(newRecruitJsonAdapter.matches({ not: "a roster" })).toBe(false);
    // A bare BattleScribe payload without the NewRecruit signature is not ours.
    expect(newRecruitJsonAdapter.matches(fixture("gk-banishers.payload.json"))).toBe(false);
    // ListForge keeps its own payloads — NewRecruit does not poach them.
    expect(listForgeAdapter.matches(fixture("gk-banishers.payload.json"))).toBe(true);
  });

  it("takes the primary faction from catalogueName, not the first Faction: X", () => {
    expect(parsed.faction_raw_name).toBe("Chaos Knights");
    expect(parsed.detachment_raw_names).toEqual(["Houndpack Lance"]);
    expect(parsed.battle_size_raw).toContain("Strike Force");
    expect(parsed.declared_limit).toBe(2000);
  });

  it("flags multi-force when allied units carry a second Faction: X", () => {
    expect(parsed.multi_force).toBe(true);
  });

  it("sums the computed total across every cost line (including the enhancement)", () => {
    expect(parsed.total_reported).toBe(485);
    // 150 (karnivore-warlord) + 15 (preyslayer) + 150 (karnivore-plain) + 130 (exec) + 40 (nurglings)
    expect(parsed.total_computed).toBe(485);
  });

  it("extracts units with model counts and points", () => {
    const names = parsed.units.map((u) => u.raw_name);
    expect(names).toEqual([
      "War Dog Karnivore",
      "War Dog Karnivore",
      "War Dog Executioner",
      "Nurglings",
    ]);

    const nurglings = parsed.units.find((u) => u.raw_name === "Nurglings")!;
    expect(nurglings.model_count).toBe(3); // 3 Nurgling Swarm sub-models
    expect(nurglings.points).toBe(40);
  });

  it("flags the warlord and attaches the enhancement to the right unit", () => {
    const karnivoreWarlord = parsed.units.find(
      (u) => u.raw_name === "War Dog Karnivore" && u.enhancement_raw_name !== null,
    )!;
    expect(karnivoreWarlord.enhancement_raw_name).toBe("Preyslayer's Mantle");
    // The warlord marker is on the Executioner in this fixture, not the Karnivore.
    expect(karnivoreWarlord.is_warlord).toBe(false);
    expect(karnivoreWarlord.is_character).toBe(true);
    expect(karnivoreWarlord.points).toBe(150); // base only — the enhancement is its own cost line

    const exec = parsed.units.find((u) => u.raw_name === "War Dog Executioner")!;
    expect(exec.is_warlord).toBe(true);
    expect(exec.is_character).toBe(true);
  });

  it("collects wargear with counts and does not treat markers/enhancements as weapons", () => {
    const exec = parsed.units.find((u) => u.raw_name === "War Dog Executioner")!;
    const wargear = exec.wargear.map((w) => `${w.count}x ${w.raw_name}`);
    expect(wargear).toContain("1x Armoured feet");
    expect(wargear).toContain("2x War Dog autocannon"); // multiplicity carried through
    expect(wargear).toContain("1x Diabolus heavy stubber");
    expect(exec.wargear.map((w) => w.raw_name)).not.toContain("Warlord");
    expect(exec.wargear.map((w) => w.raw_name)).not.toContain("Houndpack Lance Character");

    const karnivoreWarlord = parsed.units.find(
      (u) => u.raw_name === "War Dog Karnivore" && u.enhancement_raw_name !== null,
    )!;
    expect(karnivoreWarlord.wargear.map((w) => w.raw_name)).not.toContain("Preyslayer's Mantle");
  });

  it("collapses multi-model unit wargear onto the parent unit", () => {
    const nurglings = parsed.units.find((u) => u.raw_name === "Nurglings")!;
    const weapons = nurglings.wargear.map((w) => `${w.count}x ${w.raw_name}`);
    expect(weapons).toEqual(["3x Diseased claws and teeth"]);
  });

  it("does not leak any rules/prose fields into the parsed output", () => {
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toMatch(/description/i);
    expect(serialized).not.toMatch(/\$text/);
    expect(serialized).not.toMatch(/profile/i);
  });
});
