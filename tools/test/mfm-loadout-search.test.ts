import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/index.js";
import { checkMfmLoadout, type MfmLoadoutRules } from "../src/data/mfm-loadout.js";
import { mfmWeaponBounds } from "../src/data/mfm-loadout-bounds.js";
import { mfmAssignment, mfmConfigurations } from "../src/data/mfm-loadout-search.js";
import {
  MFM_CANDIDATES_TRUNCATED,
  mfmBaseLoadout,
  mfmRows,
  mfmUnitBaseLoadout,
  mfmUnitBounds,
  mfmUnitCandidates,
  mfmUnitViolations,
  type MfmComposition,
} from "../src/data/mfm-loadout-unit.js";

// Every game mode's units, as the conformance corpus pins them.
const dataset = Dataset.embedded().forGameMode("all");
type Composition = MfmComposition & { unit_id: string; faction_id: string };
const compositions = (dataset.unitCompositions as readonly Composition[]).filter((row) => row.loadout);
const compositionOf = (factionId: string, unitId: string): Composition & { loadout: MfmLoadoutRules } => {
  const found = compositions.find((row) => row.faction_id === factionId && row.unit_id === unitId);
  if (!found?.loadout) throw new Error(`${factionId}/${unitId} has no lifted loadout`);
  return found as Composition & { loadout: MfmLoadoutRules };
};
const rowsOf = (factionId: string, unitId: string, n: number) => {
  const rows = mfmRows(compositionOf(factionId, unitId), n);
  return rows && Object.fromEntries(rows);
};

/** Each unit's default size and its largest buildable size. */
function sizesOf(composition: Composition): number[] {
  const tiers = composition.tiers && composition.tiers.length > 0 ? composition.tiers.map((tier) => tier.models) : [composition.models];
  const totals = tiers.flatMap((tier) => [tier.reduce((sum, model) => sum + model.min, 0), tier.reduce((sum, model) => sum + model.max, 0)]);
  return [...new Set([Math.min(...totals), Math.max(...totals)])].filter((n) => n > 0);
}

describe("mfmRows", () => {
  it("takes a tier's fixed rows rather than growing the first row that varies", () => {
    expect(rowsOf("astra-militarum", "cadian-shock-troops", 20)).toEqual({ "Shock Trooper Sergeant": 2, "Shock Trooper": 18 });
    expect(rowsOf("orks", "boyz", 20)).toEqual({ Nob: 2, Boy: 18 });
  });

  it("refuses a count between discrete squad sizes", () => {
    expect(rowsOf("astra-militarum", "cadian-shock-troops", 15)).toBeNull();
    expect(rowsOf("adeptus-astartes", "terminator-squad", 7)).toBeNull();
  });

  it("grows the row with the most default models, not a specialist row declared first", () => {
    expect(rowsOf("aeldari", "corsair-voidscarred", 7)).toEqual({
      "Corsair Voidscarred": 6, "Shade Runner": 0, "Soul Weaver": 0, "Voidscarred Felarch": 1, "Way Seeker": 0,
    });
    expect(rowsOf("chaos-space-marines", "accursed-cultists", 10)?.Mutant).toBeGreaterThan(5);
  });

  it("keeps a default specialist and grows the larger row, whatever their order", () => {
    // Fabricated: an optional specialist (0-1, one by default) sorted before a bulk row (4-9).
    const composition: MfmComposition = {
      models: [{ name: "Adept", min: 0, max: 1 }, { name: "Trooper", min: 4, max: 9 }],
      loadout: {
        stock: [{ model: "Adept", models: 1, items: [] }, { model: "Trooper", models: 4, items: [] }],
        templates: [], slots: [], limits: [], options: [], uniform: [],
      },
    };
    expect(Object.fromEntries(mfmRows(composition, 8)!)).toEqual({ Adept: 1, Trooper: 7 });
    expect(Object.fromEntries(mfmRows(composition, 10)!)).toEqual({ Adept: 1, Trooper: 9 });
    expect(Object.fromEntries(mfmRows(composition, 4)!)).toEqual({ Adept: 0, Trooper: 4 });
    // With no Adept by default, both rows have room; the larger one grows.
    const without = { ...composition, loadout: { ...composition.loadout!, stock: [{ model: "Adept", models: 0, items: [] }, { model: "Trooper", models: 4, items: [] }] } };
    expect(Object.fromEntries(mfmRows(without, 5)!)).toEqual({ Adept: 0, Trooper: 5 });
    expect(Object.fromEntries(mfmRows(without, 10)!)).toEqual({ Adept: 1, Trooper: 9 });
  });

  it("reads name#k rows as the k-th composition row and a plain name as all of them", () => {
    const command = rowsOf("astra-militarum", "cadian-command-squad", 5)!;
    expect(Object.keys(command).sort()).toEqual([
      "Cadian Commander", "Cadian Veteran Guardsman#1", "Cadian Veteran Guardsman#2", "Cadian Veteran Guardsman#3", "Cadian Veteran Guardsman#4",
    ]);
    expect(Object.values(command).reduce((sum, n) => sum + n, 0)).toBe(5);
    // Three composition rows named Navis Armsman (1, 1 and 7 models) are one loadout row of 9.
    expect(rowsOf("agents-of-the-imperium", "imperial-navy-breachers", 10)).toEqual({ "Navis Armsman": 9, "Navis Sergeant-at-Arms": 1 });
    expect(rowsOf("agents-of-the-imperium", "imperial-navy-breachers", 11)).toBeNull();
  });
});

describe("mfmBaseLoadout", () => {
  it("scales the default per model when the dump's template drops an item the slots need", () => {
    // The dump's added Purifier carries no nemesis force weapon, but every Purifier slot pairs one
    // with the storm bolter.
    const base = mfmUnitBaseLoadout(compositionOf("grey-knights", "purifier-squad"), 7)!;
    expect(base.legal).toBe(true);
    expect(base.counts.get("nemesis-force-weapon-purifier-squad")).toBe(7);
  });

  it("adds a template per model when the default copies do not split evenly", () => {
    const composition = compositionOf("agents-of-the-imperium", "voidsmen-at-arms");
    const rows = mfmRows(composition, 6)!;
    const base = mfmBaseLoadout(composition.loadout, rows)!;
    expect(base.legal).toBe(true);
    expect(base.counts.get("voidsman-rotor-cannon")).toBe(1);
  });

  it("reports the Noise Marines' default, one model bare, as legal", () => {
    const base = mfmUnitBaseLoadout(compositionOf("emperors-children", "noise-marines"), 6)!;
    expect(base.legal).toBe(true);
    expect(base.counts.get("sonic-blaster")).toBe(5);
  });
});

describe("mfmWeaponBounds", () => {
  it("couples items through the models that carry them", () => {
    const bounds = mfmUnitBounds(compositionOf("astra-militarum", "cadian-shock-troops"), 20)!;
    expect(bounds.get("lasgun")).toEqual({ min: 14, max: 18 });
    expect(bounds.get("plasma-gun")).toEqual({ min: 0, max: 2 });
  });

  it("searches a Commander whose single model has tens of thousands of bundles", () => {
    expect(mfmUnitBounds(compositionOf("tau-empire", "commander-in-coldstar-battlesuit"), 1)?.size).toBeGreaterThan(0);
  });

  it("matches every configuration's extremes wherever the configurations can be listed", () => {
    let compared = 0;
    for (const composition of compositions) {
      for (const n of sizesOf(composition)) {
        const rows = mfmRows(composition, n);
        if (!rows) continue;
        const { configurations, truncated } = mfmConfigurations(composition.loadout!, rows, 2000);
        if (truncated) continue;
        compared++;
        const bounds = mfmWeaponBounds(composition.loadout!, rows);
        const name = `${composition.faction_id}/${composition.unit_id}@${n}`;
        if (configurations.length === 0) {
          expect(bounds, name).toBeNull();
          continue;
        }
        for (const [id, bound] of bounds!) {
          const copies = configurations.map((configuration) => configuration.counts.get(id) ?? 0);
          expect({ id, min: Math.min(...copies), max: Math.max(...copies) }, name).toEqual({ id, ...bound });
        }
      }
    }
    // Most units' sizes list in full; a regression that stops listing them would compare few.
    expect(compared).toBeGreaterThan(1000);
  }, 60_000);
});

describe("the search and the checker agree", () => {
  it("lists only configurations the checker accepts, and places each on the unit's models", () => {
    for (const composition of compositions) {
      for (const n of sizesOf(composition)) {
        const rows = mfmRows(composition, n);
        if (!rows) continue;
        const name = `${composition.faction_id}/${composition.unit_id}@${n}`;
        const base = mfmBaseLoadout(composition.loadout!, rows)!;
        const placed = mfmAssignment(composition.loadout!, rows, base.counts);
        expect(placed !== null, name).toBe(base.legal);
        for (const configuration of mfmConfigurations(composition.loadout!, rows, 8).configurations) {
          expect(checkMfmLoadout(composition.loadout!, rows, configuration.counts), name).toEqual([]);
          const carried = new Map<string, number>();
          for (const group of configuration.groups) for (const item of group.items) carried.set(item.id, (carried.get(item.id) ?? 0) + item.count * group.count);
          for (const item of configuration.unit) carried.set(item.id, (carried.get(item.id) ?? 0) + item.count);
          expect(carried, name).toEqual(configuration.counts);
          const models = new Map<string, number>();
          for (const group of configuration.groups) models.set(group.model, (models.get(group.model) ?? 0) + group.count);
          expect(models, name).toEqual(new Map([...rows].filter(([, k]) => k > 0)));
        }
      }
    }
  }, 60_000);

  it("places exactly the conformance checks the checker accepts", () => {
    // The checker decides each case independently of the search's pruning, so a prune that cut a
    // legal configuration fails here.
    const cases = JSON.parse(readFileSync(join(__dirname, "../../conformance/mfm_loadout/checks.json"), "utf8")) as {
      name: string;
      args: { unitId: string; factionId: string; models: Record<string, number>; counts: Record<string, number> };
      expected: { code: string }[] | null;
    }[];
    let placed = 0;
    for (const c of cases) {
      if (c.expected === null || c.expected.some((v) => v.code === "too-many-options")) continue;
      const rules = compositionOf(c.args.factionId, c.args.unitId).loadout;
      const found = mfmAssignment(rules, new Map(Object.entries(c.args.models)), new Map(Object.entries(c.args.counts)));
      expect(found !== null, c.name).toBe(c.expected.length === 0);
      if (found) placed++;
    }
    expect(placed).toBeGreaterThan(1000);
  });

  it("finds no assignment for counts the checker refuses", () => {
    const composition = compositionOf("astra-militarum", "catachan-command-squad");
    const rows = mfmRows(composition, 5)!;
    const base = mfmBaseLoadout(composition.loadout, rows)!.counts;
    const twoFlamers = new Map(base).set("lasgun", base.get("lasgun")! - 2).set("flamer", 2);
    expect(checkMfmLoadout(composition.loadout, rows, twoFlamers)).not.toEqual([]);
    expect(mfmAssignment(composition.loadout, rows, twoFlamers)).toBeNull();
  });
});

describe("mfmUnitCandidates", () => {
  const boyz = compositionOf("orks", "boyz");

  it("cuts the list at its limit and marks the cut", () => {
    const candidates = mfmUnitCandidates(boyz, 10, 3);
    expect(candidates).toHaveLength(4);
    expect(candidates[3]).toBe(MFM_CANDIDATES_TRUNCATED);
    expect(new Set(candidates).size).toBe(4);
    expect(mfmUnitCandidates(boyz, 10, 0)).toEqual([MFM_CANDIDATES_TRUNCATED]);
    expect(mfmUnitCandidates(boyz, 15, 3)).toEqual([]);
  });

  it("writes each group's models and per-model items, then the unit's counts", () => {
    const [first] = mfmUnitCandidates(boyz, 10, 1);
    const [witness, counts] = first.split(" => ");
    expect(witness).toMatch(/^(?:[^×;]+×\d+\[[a-z0-9-]+:\d+(?:,[a-z0-9-]+:\d+)*\])(?:; [^×;]+×\d+\[[a-z0-9-]+:\d+(?:,[a-z0-9-]+:\d+)*\])*$/);
    const ids = counts.split(",").map((pair) => pair.split(":")[0]);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("mfmUnitViolations", () => {
  it("reports a size no tier builds", () => {
    expect(mfmUnitViolations(compositionOf("orks", "boyz"), 15, new Map())?.map((v) => v.code)).toEqual(["invalid-model-count"]);
  });
});
