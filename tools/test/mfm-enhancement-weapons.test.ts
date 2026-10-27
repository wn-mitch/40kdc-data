import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { MfmDump, type MfmDumpInit } from "../src/mfm/loader.js";
import { DRONE_WARGEAR_ITEMS, mintDroneWeapons, mintEnhancementWeapons, type WeaponMintResult } from "../src/mfm/enhancement-weapons.js";
import type { MintContext, WeaponRecord } from "../src/mfm/gear-projection.js";
import { CONFIRMED } from "../src/mfm/wargear.js";
import { CORE_DIR } from "../src/mfm/repo-files.js";

// Dump rows for the six enhancements that link to a wargear-item profile, and the four drone
// wargear items. Names and numbers only (tools/test/fixtures/mfm-gear-subset.json).
const FIXTURE = fileURLToPath(new URL("./fixtures/mfm-gear-subset.json", import.meta.url));
const fixturePayload = (): MfmDumpInit => JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as MfmDumpInit;

const hasWeaponsFile = (dir: string): boolean => dir !== "deathwatch";

function mint(payload: MfmDumpInit = fixturePayload()): { ctx: MintContext; enhancements: WeaponMintResult; drones: WeaponMintResult } {
  const ctx: MintContext = { dump: new MfmDump(payload), gv: { ...CONFIRMED }, warnings: [] };
  return { ctx, enhancements: mintEnhancementWeapons(ctx, { hasWeaponsFile }), drones: mintDroneWeapons(ctx) };
}

const byId = (result: WeaponMintResult, id: string) => result.minted.find((minted) => minted.weapon.id === id);

describe("enhancement weapons minted from the dump's linked wargear profile", () => {
  const { enhancements } = mint();

  it("mints 9134's weapon under a detachment-scoped id, not the same-named repo entity", () => {
    // The repo entity `eadbanger` has the same name and A 1, D 1. The dump profile is A 2, D 3.
    const minted = byId({ minted: enhancements.minted, refusals: [] }, "eadbanger-wurrband");
    expect(minted?.dir).toBe("orks");
    expect(minted?.weapon.profiles[0]).toEqual({
      name: "'Eadbanger",
      range: 24,
      stats: { A: 2, S: 6, AP: -3, D: 3, BS: 4 },
      keywords: [{ keyword_id: "psychic" }, { keyword_id: "hazardous" }, { keyword_id: "precision" }],
    });
    expect(byId({ minted: enhancements.minted, refusals: [] }, "eadbanger")).toBeUndefined();
  });

  it("mints 9114 with its printed Lethal Hits qualifier as a target exclusion", () => {
    expect(enhancements.refusals.find((r) => r.source === "Da Gobshot Thunderbuss")).toBeUndefined();
    const minted = byId({ minted: enhancements.minted, refusals: [] }, "da-gobshot-thunderbuss-brute-bosses");
    expect(minted?.weapon.profiles[0].keywords).toEqual([
      { keyword_id: "lethal-hits", parameters: { excluded_target_keywords: ["Monster", "Vehicle"] } },
      { keyword_id: "rapid-fire", parameters: { value: 6 } },
    ]);
  });

  it("mints 9118 with its printed Blast rating", () => {
    expect(enhancements.refusals.find((r) => r.source === "Da Krunch")).toBeUndefined();
    const minted = byId({ minted: enhancements.minted, refusals: [] }, "da-krunch-wurrband");
    expect(minted?.weapon.profiles[0].keywords).toContainEqual({ keyword_id: "blast", parameters: { value: 3 } });
  });

  it("mints a melee profile with WS and no BS", () => {
    const weapon = byId({ minted: enhancements.minted, refusals: [] }, "imperiums-sword-assault-brethren")?.weapon as WeaponRecord;
    expect(weapon.type).toBe("melee");
    expect(weapon.profiles[0]!.range).toBe("Melee");
    expect(weapon.profiles[0]!.stats.WS).toBe(2);
    expect(weapon.profiles[0]!.stats.BS).toBeUndefined();
    expect(weapon.profiles[0]!.stats).toEqual({ A: 6, WS: 2, S: 7, AP: -3, D: 3 });
  });

  it("files the Deathwatch enhancement's weapon under adeptus-astartes", () => {
    const minted = byId({ minted: enhancements.minted, refusals: [] }, "the-thief-of-secrets-black-spear-task-force");
    expect(minted?.dir).toBe("adeptus-astartes");
    expect(minted?.source).toBe("The Thief of Secrets");
  });

  it("mints TL-4ø9 under its detachment id in adeptus-mechanicus", () => {
    const minted = byId({ minted: enhancements.minted, refusals: [] }, "tl-4-9-lords-of-the-forge");
    expect(minted?.dir).toBe("adeptus-mechanicus");
    expect(minted?.weapon.profiles[0]!.stats).toEqual({ A: 3, BS: 2, S: 11, AP: -2, D: "D3+2" });
  });

  it("refuses an enhancement whose linked item carries another name (modifier-style link)", () => {
    const payload = fixturePayload();
    const item = payload.data.wargear_item!.find((row) => (row.localisations as any).en.name === "The Thief of Secrets")!;
    (item.localisations as any).en.name = "Thief";
    const result = mintEnhancementWeapons({ dump: new MfmDump(payload), gv: { ...CONFIRMED }, warnings: [] }, { hasWeaponsFile });
    expect(result.minted.some((m) => m.source === "The Thief of Secrets")).toBe(false);
    expect(result.refusals.find((r) => r.source === "The Thief of Secrets")?.reason).toContain("not the enhancement's name");
  });
});

describe("drone weapons minted from the wargear profile", () => {
  const { drones } = mint();

  it("mints one -drone weapon per drone wargear item, all under tau-empire", () => {
    expect(drones.refusals).toEqual([]);
    expect(drones.minted.map((m) => m.weapon.id).sort()).toEqual([
      "drone-burst-cannon-drone",
      "missile-pod-drone",
      "twin-pulse-blaster-drone",
      "twin-pulse-carbine-drone",
    ]);
    expect(new Set(drones.minted.map((m) => m.dir))).toEqual(new Set(["tau-empire"]));
    expect(DRONE_WARGEAR_ITEMS).toHaveLength(4);
  });

  it("carries the dump profile, so Gun Drone hits on 5+ (not the repo's BS 4+ twin-pulse-carbine)", () => {
    const weapon = byId(drones, "twin-pulse-carbine-drone")!.weapon;
    expect(weapon.profiles[0]).toEqual({
      name: "Twin pulse carbine",
      range: 20,
      stats: { A: 2, BS: 5, S: 5, AP: 0, D: 1 },
      keywords: [{ keyword_id: "twin-linked" }, { keyword_id: "assault" }],
    });
  });

  it("mints a drone item whose profile carries a rated keyword with the rating", () => {
    const payload = fixturePayload();
    const profile = payload.data.wargear_item_profile!.find((row) => (row.localisations as any).en.name === "Missile pod")!;
    const link = payload.data.wargear_item_profile_wargear_ability!.find((row) => row.wargearItemProfileId === profile.id);
    expect(link).toBeUndefined(); // the fixture's Missile pod has no keyword links
    const abilities = payload.data.wargear_ability!;
    const blast = { id: "fixture-blast-3", localisations: { en: { name: "BLAST 3" } } } as any;
    abilities.push(blast);
    payload.data.wargear_item_profile_wargear_ability!.push({ id: "fixture-link", displayOrder: 0, wargearItemProfileId: profile.id, wargearAbilityId: blast.id } as any);
    const result = mintDroneWeapons({ dump: new MfmDump(payload), gv: { ...CONFIRMED }, warnings: [] });
    expect(result.refusals.find((r) => r.source === "Missile Drone")).toBeUndefined();
    const drone = result.minted.find((m) => m.source === "Missile Drone");
    expect(drone?.weapon.profiles[0].keywords).toEqual([{ keyword_id: "blast", parameters: { value: 3 } }]);
  });
});

describe("drone weapon entities in the repo match the dump profile", () => {
  // Each entity is the one the drone's weapon-grant names. The expected values are the dump's profile values.
  const expected: Record<string, Record<string, unknown>> = {
    "twin-pulse-carbine-drone": { name: "Twin pulse carbine", range: 20, A: 2, BS: 5, S: 5, AP: 0, D: 1 },
    "missile-pod-drone": { name: "Missile pod", range: 30, A: 2, BS: 5, S: 7, AP: -1, D: 2 },
    "twin-pulse-blaster-drone": { name: "Twin pulse blaster", range: 10, A: 2, BS: 5, S: 6, AP: -1, D: 1 },
    "drone-burst-cannon-drone": { name: "Drone burst cannon", range: 18, A: 4, BS: 5, S: 5, AP: 0, D: 1 },
  };

  it("holds the dump's name, range, characteristics and keywords for each *-drone entity", () => {
    const weapons = JSON.parse(fs.readFileSync(`${CORE_DIR}/tau-empire/weapons.json`, "utf8")) as WeaponRecord[];
    const { drones } = mint();
    for (const [id, want] of Object.entries(expected)) {
      const weapon = weapons.find((w) => w.id === id);
      expect(weapon, id).toBeDefined();
      const profile = weapon!.profiles[0]!;
      expect({ name: profile.name, range: profile.range, A: profile.stats.A, BS: profile.stats.BS, S: profile.stats.S, AP: profile.stats.AP, D: profile.stats.D }, id).toEqual(want);
      expect(profile, id).toEqual(byId(drones, id)!.weapon.profiles[0]);
    }
  });
});
