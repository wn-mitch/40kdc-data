import { describe, expect, it } from "vitest";

import { dataset } from "../src/data/index.js";
import { mfmGroups, unitLoadout } from "../src/data/unit-loadout.js";

const viewOf = (unitId: string, factionId: string) => {
  const unit = dataset.units.getInFaction(unitId, factionId);
  if (!unit) throw new Error(`no ${factionId}/${unitId}`);
  return { unit: unit.raw, view: dataset.loadoutOf(unit.raw) };
};
const codes = (violations: readonly { code: string; id: string }[]) => violations.map((v) => `${v.code}:${v.id}`);

describe("Dataset.loadoutOf", () => {
  it("hands out one view per unit, the same in every game-mode view", () => {
    const { unit, view } = viewOf("khorne-berzerkers", "world-eaters");
    expect(dataset.loadoutOf(unit)).toBe(view);
    expect(dataset.forGameMode("all").loadoutOf(unit)).toBe(view);
    expect(view.source).toBe("mfm");
  });

  it("falls back to authored wargear options for a composition without MFM rules", () => {
    // Every dump-backed composition carries a lifted loadout, so drop Pink Horrors' to reach the fallback.
    const { unit } = viewOf("pink-horrors", "chaos-daemons");
    const composition = { ...(dataset.unitCompositionOf(unit) as object), loadout: undefined };
    const view = unitLoadout(unit, composition, dataset.wargearOptionsOf(unit));
    expect(view.source).toBe("wargear-options");
    expect(view.base(10)?.get("pink-claws")).toBe(10);
  });
});

describe("UnitLoadout.check", () => {
  const { view } = viewOf("khorne-berzerkers", "world-eaters");
  const base = view.base(10)!;

  it("accepts the default and the maximal loadout", () => {
    expect(view.check(10, base)).toEqual([]);
    expect(view.check(10, view.maximal(10)!)).toEqual([]);
  });

  it("reports a size no tier builds, and nothing else", () => {
    expect(codes(view.check(7, base))).toEqual(["invalid-model-count:khorne-berzerkers"]);
  });

  it("reports items outside their bounds, an item the unit cannot carry among them", () => {
    const counts = new Map(base).set("khornate-eviscerator", 3).set("lascannon", 1);
    counts.delete("chainblade-khorne-berzerkers");
    expect(codes(view.check(10, counts))).toEqual([
      "below-min:chainblade-khorne-berzerkers",
      "exceeds-max:khornate-eviscerator",
      "exceeds-max:lascannon",
    ]);
  });

  it("reports a swap conflict when every count is in bounds but no assignment carries them", () => {
    // Two eviscerators each displace a chainblade; keeping all ten chainblades fits no model.
    const counts = new Map(base).set("khornate-eviscerator", 2);
    expect(codes(view.check(10, counts))).toEqual(["swap-conflict:khorne-berzerkers"]);
  });

  it("accepts a loadout legal only on a split other than the bulk one", () => {
    // Eight Voidscarred split 7 + Felarch by default; these specialists need 5 + Felarch + Soul Weaver + Way Seeker.
    const { view: corsairs } = viewOf("corsair-voidscarred", "aeldari");
    const counts = new Map(Object.entries({
      blaster: 1, "channeller-stones": 1, "close-combat-weapon-corsair-voidscarred": 6, executioner: 1, faolchu: 1,
      "neuro-disruptor": 1, "power-sword": 6, "shuriken-pistol": 6, "witch-staff": 1,
    }));
    expect(corsairs.check(8, counts)).toEqual([]);
    // The bulk split has no Way Seeker, so its witch staff ranges down to none.
    expect(corsairs.bounds(8)?.get("witch-staff")).toEqual({ min: 0, max: 1 });
    expect(corsairs.groups(8, counts)?.map((group) => group.model_name)).toContain("Soul Weaver");
  });
});

describe("UnitLoadout.maximal", () => {
  it("takes every special the rules allow: two eviscerators on ten Berzerkers", () => {
    const { view } = viewOf("khorne-berzerkers", "world-eaters");
    const maximal = view.maximal(10)!;
    expect(maximal.get("khornate-eviscerator")).toBe(2);
    expect(maximal.get("icon-of-khorne")).toBe(1);
    expect(view.maximal(7)).toBeNull();
  });
});

describe("UnitLoadout.groups", () => {
  it("lists the leader row first, as the composition does", () => {
    const { view } = viewOf("bloodletters", "chaos-daemons");
    const groups = view.groups(10, view.base(10)!)!;
    expect(groups.map((group) => [group.model_name, group.count])).toEqual([["Bloodreaper", 1], ["Bloodletter", 9]]);
  });

  it("has none for one model or for counts no assignment carries", () => {
    const { view } = viewOf("khorne-berzerkers", "world-eaters");
    expect(view.groups(1, new Map())).toBeNull();
    expect(view.groups(10, new Map([["lascannon", 1]]))).toBeNull();
  });

  it("puts the unit's own wargear in one unnamed group after the models", () => {
    const { view } = viewOf("strike-team", "tau-empire");
    const size = [5, 10].find((n) => view.base(n));
    const base = view.base(size!)!;
    const groups = view.groups(size!, base)!;
    const unnamed = groups.filter((group) => group.model_name === null);
    expect(unnamed).toHaveLength(1);
    expect(groups.at(-1)).toBe(unnamed[0]);
    // Every copy the counts hold sits in some group.
    const placed = new Map<string, number>();
    for (const group of groups) for (const weapon of group.weapons) placed.set(weapon.id, (placed.get(weapon.id) ?? 0) + weapon.count * group.count);
    expect(placed).toEqual(base);
  });
});

describe("mfmGroups", () => {
  it("merges same-named rows carrying the same items into one group, keeping others apart", () => {
    const items = [{ id: "lasgun", count: 1 }];
    const groups = mfmGroups({
      counts: new Map([["lasgun", 3], ["medi-pack", 1]]),
      groups: [
        { model: "Guard#2", count: 2, items },
        { model: "Guard#1", count: 1, items },
        { model: "Guard#3", count: 1, items: [{ id: "medi-pack", count: 1 }] },
      ],
      unit: [],
    }, ["Guard#1", "Guard#2", "Guard#3"]);
    expect(groups).toEqual([
      { model_name: "Guard", count: 3, weapons: items },
      { model_name: "Guard", count: 1, weapons: [{ id: "medi-pack", count: 1 }] },
    ]);
  });
});

describe("UnitLoadout.complete", () => {
  const { view } = viewOf("khorne-berzerkers", "world-eaters");

  it("fills the defaults a list leaves out around its printed swaps", () => {
    const completed = view.complete(10, new Map([["khornate-eviscerator", 2]]))!;
    expect(Object.fromEntries(completed.counts)).toEqual({
      "bolt-pistol-khorne-berzerkers": 10,
      "chainblade-khorne-berzerkers": 8,
      "khornate-eviscerator": 2,
    });
    expect(view.check(10, completed.counts)).toEqual([]);
  });

  it("invents no option the list did not print", () => {
    const completed = view.complete(10, new Map())!;
    expect(completed.counts).toEqual(view.base(10));
  });

  it("finds nothing for a list no legal loadout holds", () => {
    expect(view.complete(10, new Map([["khornate-eviscerator", 3]]))).toBeNull();
  });
});

describe("unitLoadout without a composition", () => {
  it("takes any model count as given and checks the authored options", () => {
    const { unit } = viewOf("khorne-berzerkers", "world-eaters");
    const view = unitLoadout(unit, undefined, []);
    expect(view.source).toBe("wargear-options");
    expect(view.base(3)).not.toBeNull();
  });
});
