import { describe, expect, it } from "vitest";
import { hunterKeywords, mapWeaponKeyword, parseRange, type WeaponRecord } from "../src/mfm/gear-projection.js";
import { reconcileWeaponStats, type CompRow, type OptionRow, type UnitRow } from "../src/mfm/weapon-stats.js";
import type { CoreWeapon } from "../src/mfm/weapon-variants.js";

const GV = { edition: "11th", dataslate: "example" };

function weapon(id: string, profiles: CoreWeapon["profiles"], name = "Example blade"): CoreWeapon {
  return { id, name, type: "melee", profiles, game_version: GV };
}
function minted(id: string, profiles: CoreWeapon["profiles"], ref = `mfm-${id}`, name = "Example blade"): WeaponRecord {
  return { id, name, type: "melee", profiles: profiles as WeaponRecord["profiles"], game_version: GV, external_refs: [{ namespace: "mfm", id: ref }] };
}
const blade = (A: number, S: number, keywords: CoreWeapon["profiles"][number]["keywords"] = []) =>
  [{ name: "Example blade", range: "Melee" as const, stats: { A, WS: 3, S, AP: -1, D: 1 }, keywords }];

describe("mapWeaponKeyword: qualified and Hunter forms", () => {
  it("reads a qualifier as the keywords the target must have, or must not have", () => {
    expect(mapWeaponKeyword("LETHAL HITS: non-MONSTER/VEHICLE")).toEqual([{ keyword_id: "lethal-hits", parameters: { excluded_target_keywords: ["Monster", "Vehicle"] } }]);
    expect(mapWeaponKeyword("SUSTAINED HITS 2: INFANTRY")).toEqual([{ keyword_id: "sustained-hits", parameters: { value: 2, required_target_keywords_any: ["Infantry"] } }]);
    // A negative Anti critically wounds every target without the named keywords.
    expect(mapWeaponKeyword("ANTI-non-MONSTER/VEHICLE 2+")).toEqual([{ keyword_id: "anti", parameters: { threshold: 2, excluded_target_keywords: ["Monster", "Vehicle"] } }]);
  });

  it("splits a Hunter profile's target keyword", () => {
    expect(hunterKeywords("**MONSTER/VEHICLE**")).toEqual(["Monster", "Vehicle"]);
    expect(hunterKeywords(null)).toEqual([]);
  });

  it("keeps a ranged profile printed with range N/A ranged, and refuses other text", () => {
    // Engines treat every range but "Melee" as ranged, so N/A must not collapse to Melee.
    expect(parseRange("N/A", "ranged")).toBe("N/A");
    expect(parseRange('24"', "ranged")).toBe(24);
    expect(parseRange("Melee", "ranged")).toBe("Melee");
    expect(() => parseRange("Varies", "ranged")).toThrow(/unparseable range/);
  });

  it("maps a datasheet-specific keyword to its catalog entry", () => {
    expect(mapWeaponKeyword("BLINDING LIGHT")).toEqual([{ keyword_id: "blinding-light" }]);
  });
});

describe("reconcileWeaponStats", () => {
  const empty = { comps: [] as CompRow[], options: [] as OptionRow[] };

  it("updates a shared weapon in place when every unit's datasheet fields the same line", () => {
    const result = reconcileWeaponStats({
      weapons: [weapon("example-blade", blade(4, 4))],
      units: [{ id: "squad-a", weapon_ids: ["example-blade"] }, { id: "squad-b", weapon_ids: ["example-blade"] }],
      ...empty,
      dumpWeapons: new Map([["squad-a", [minted("example-blade", blade(4, 5))]], ["squad-b", [minted("example-blade", blade(4, 5))]]]),
    });
    expect(result.updated).toEqual(["example-blade"]);
    expect(result.variants).toEqual([]);
    expect(result.weapons[0].profiles[0].stats.S).toBe(5);
    expect(result.weapons[0].external_refs).toEqual([{ namespace: "mfm", id: "mfm-example-blade" }]);
  });

  it("keeps the line most units field and gives the rest a variant, rewiring every reference", () => {
    const comps: CompRow[] = [{ unit_id: "champion", models: [{ default_weapon_ids: ["example-blade"], loadout_variants: [{ name: "x", weapon_ids: ["example-blade"] }] }] }];
    const options: OptionRow[] = [{ unit_id: "champion", replaces: ["example-blade"], replacement_choice: [["example-blade"]] }];
    const units: UnitRow[] = [
      { id: "squad-a", weapon_ids: ["example-blade"] },
      { id: "squad-b", weapon_ids: ["example-blade"] },
      { id: "champion", weapon_ids: ["example-blade"], wargear_budgets: [{ items: ["example-blade"] }], wargear_costs: [{ item_id: "example-blade", cost: 5 }] },
    ];
    const result = reconcileWeaponStats({
      weapons: [weapon("example-blade", blade(4, 4))],
      units, comps, options,
      dumpWeapons: new Map([
        ["squad-a", [minted("example-blade", blade(4, 5))]],
        ["squad-b", [minted("example-blade", blade(4, 5))]],
        ["champion", [minted("example-blade", blade(7, 5), "mfm-champion-blade")]],
      ]),
    });
    expect(result.variants).toEqual(["example-blade-champion"]);
    expect(result.weapons.find((w) => w.id === "example-blade")!.profiles[0].stats.A).toBe(4);
    expect(result.weapons.find((w) => w.id === "example-blade-champion")!.profiles[0].stats.A).toBe(7);
    const champion = result.units.find((u) => u.id === "champion")!;
    expect(champion.weapon_ids).toEqual(["example-blade-champion"]);
    expect(champion.wargear_budgets![0].items).toEqual(["example-blade-champion"]);
    expect(champion.wargear_costs![0].item_id).toBe("example-blade-champion");
    expect(result.comps[0].models![0].default_weapon_ids).toEqual(["example-blade-champion"]);
    expect(result.comps[0].models![0].loadout_variants![0].weapon_ids).toEqual(["example-blade-champion"]);
    expect(result.options[0].replaces).toEqual(["example-blade-champion"]);
    expect(result.options[0].replacement_choice).toEqual([["example-blade-champion"]]);
    expect(result.units.find((u) => u.id === "squad-a")!.weapon_ids).toEqual(["example-blade"]);
  });

  it("keeps the current line on the bare id when one unit's datasheet still fields it", () => {
    const result = reconcileWeaponStats({
      weapons: [weapon("example-blade", blade(4, 4))],
      units: [{ id: "squad-a", weapon_ids: ["example-blade"] }, { id: "squad-b", weapon_ids: ["example-blade"] }, { id: "squad-c", weapon_ids: ["example-blade"] }],
      ...empty,
      dumpWeapons: new Map([
        ["squad-a", [minted("example-blade", blade(4, 4))]],
        ["squad-b", [minted("example-blade", blade(4, 5))]],
        ["squad-c", [minted("example-blade", blade(4, 5))]],
      ]),
    });
    expect(result.updated).toEqual([]);
    expect(result.variants.sort()).toEqual(["example-blade-squad-b", "example-blade-squad-c"]);
  });

  it("leaves the bare id alone when a unit referencing it has no say, and matches a plural item name", () => {
    const result = reconcileWeaponStats({
      weapons: [weapon("example-blade", blade(4, 4), "Example blades")],
      units: [{ id: "squad-a", weapon_ids: ["example-blade"] }, { id: "squad-b", weapon_ids: ["example-blade"] }, { id: "dump-absent", weapon_ids: ["example-blade"] }],
      ...empty,
      dumpWeapons: new Map([
        ["squad-a", [minted("example-blade", blade(4, 5), "mfm-a", "Example blade")]],
        ["squad-b", [minted("example-blade", blade(4, 5), "mfm-b", "Example blade")]],
      ]),
    });
    expect(result.updated).toEqual([]);
    expect(result.weapons.find((w) => w.id === "example-blade")!.profiles[0].stats.S).toBe(4);
    expect(result.variants.sort()).toEqual(["example-blade-squad-a", "example-blade-squad-b"]);
    expect(result.unconfirmed).toEqual(["dump-absent: example-blade"]);
    expect(result.units.find((u) => u.id === "dump-absent")!.weapon_ids).toEqual(["example-blade"]);
  });

  it("carries repo-authored keyword detail onto the dump line and refuses where it has nowhere to go", () => {
    // A rating that depends on battle size: no dump keyword name can print it.
    const rated = { keyword_id: "sustained-hits", parameters: { value: { "strike-force": 2 } } } as never;
    const kept = reconcileWeaponStats({
      weapons: [weapon("example-blade", blade(4, 4, [rated]))],
      units: [{ id: "squad-a", weapon_ids: ["example-blade"] }],
      ...empty,
      dumpWeapons: new Map([["squad-a", [minted("example-blade", blade(4, 5, [{ keyword_id: "sustained-hits", parameters: { value: 1 } }]))]]]),
    });
    expect(kept.weapons[0].profiles[0].keywords).toEqual([rated]);
    expect(kept.weapons[0].profiles[0].stats.S).toBe(5);

    const refused = reconcileWeaponStats({
      weapons: [weapon("example-blade", blade(4, 4, [rated]))],
      units: [{ id: "squad-a", weapon_ids: ["example-blade"] }],
      ...empty,
      dumpWeapons: new Map([["squad-a", [minted("example-blade", blade(4, 5))]]]),
    });
    expect(refused.updated).toEqual([]);
    expect(refused.weapons[0].profiles[0].stats.S).toBe(4);
    expect(refused.refusals[0]).toContain("repo-authored");
  });

  it("takes the dump's target qualifiers over stale repo ones", () => {
    const stale = { keyword_id: "devastating-wounds", parameters: { required_target_keywords_any: ["Monster", "Vehicle"] } };
    const printed = { keyword_id: "devastating-wounds", parameters: { excluded_target_keywords: ["Monster", "Vehicle"] } };
    const result = reconcileWeaponStats({
      weapons: [weapon("example-blade", blade(4, 4, [stale]))],
      units: [{ id: "squad-a", weapon_ids: ["example-blade"] }],
      ...empty,
      dumpWeapons: new Map([["squad-a", [minted("example-blade", blade(4, 4, [printed]))]]]),
    });
    expect(result.refusals).toEqual([]);
    expect(result.weapons[0].profiles[0].keywords).toEqual([printed]);
  });

  it("adds a Hunter profile with its target restriction", () => {
    const hunter = { name: "Hunter", range: "Melee" as const, stats: { A: 3, WS: 3, S: 12, AP: -2, D: 3 },
      keywords: [{ keyword_id: "hunter", parameters: { target_keyword: "Monster" } }, { keyword_id: "hunter", parameters: { target_keyword: "Vehicle" } }],
      target_restrictions: { required_keywords_any: ["Monster", "Vehicle"] } };
    const standard = { ...blade(4, 8)[0], name: "Standard" };
    const result = reconcileWeaponStats({
      weapons: [weapon("example-blade", blade(4, 8))],
      units: [{ id: "squad-a", weapon_ids: ["example-blade"] }],
      ...empty,
      dumpWeapons: new Map([["squad-a", [minted("example-blade", [hunter, standard] as CoreWeapon["profiles"])]]]),
    });
    expect(result.weapons[0].profiles).toHaveLength(2);
    expect(result.weapons[0].profiles[0]).toMatchObject({ name: "Hunter", target_restrictions: { required_keywords_any: ["Monster", "Vehicle"] } });
  });

  it("aligns same-named profiles in order, so each keeps its own repo-authored detail", () => {
    const ranged = { name: "Example blade", range: 18, stats: { A: 4, BS: 2, S: 6, AP: -1, D: 2 }, keywords: [] };
    const qualified = { keyword_id: "sustained-hits", parameters: { value: 1, excluded_target_keywords: ["Monster"] } };
    const melee = blade(8, 10, [qualified])[0];
    const result = reconcileWeaponStats({
      weapons: [weapon("example-blade", [ranged, melee] as CoreWeapon["profiles"])],
      units: [{ id: "squad-a", weapon_ids: ["example-blade"] }],
      ...empty,
      dumpWeapons: new Map([["squad-a", [minted("example-blade", [{ ...ranged, stats: { ...ranged.stats, S: 7 } }, melee] as CoreWeapon["profiles"])]]]),
    });
    expect(result.refusals).toEqual([]);
    expect(result.weapons[0].profiles.map((p) => p.stats.S)).toEqual([7, 10]);
    expect(result.weapons[0].profiles[1].keywords).toEqual([qualified]);
  });

  it("points a unit's bare references at its existing variant when that variant already has the line", () => {
    const result = reconcileWeaponStats({
      weapons: [weapon("example-blade", blade(4, 4)), weapon("example-blade-squad-b", blade(4, 5))],
      units: [{ id: "squad-a", weapon_ids: ["example-blade"] }, { id: "squad-b", weapon_ids: ["example-blade-squad-b", "example-blade"] }],
      comps: [],
      options: [{ unit_id: "squad-b", replacement: ["example-blade"] }],
      dumpWeapons: new Map([["squad-a", [minted("example-blade", blade(4, 4))]], ["squad-b", [minted("example-blade", blade(4, 5))]]]),
    });
    expect(result.variants).toEqual([]);
    expect(result.refusals).toEqual([]);
    expect(result.options[0].replacement).toEqual(["example-blade-squad-b"]);
    // The unit already listed its variant: the bare reference folds into it, not a second copy.
    expect(result.units.find((u) => u.id === "squad-b")!.weapon_ids).toEqual(["example-blade-squad-b"]);
  });
});
