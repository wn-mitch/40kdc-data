/**
 * Yellowscribe army data (`export/yellowscribe-army.ts`) and share-token rosters
 * (`share/to-roster.ts`), which feed the TTS army-code worker.
 */
import { readdirSync, readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { resolveRosterUnit } from "../src/data/roster-resolve.js";
import { yellowscribeArmy, type YellowscribeUnit } from "../src/export/yellowscribe-army.js";
import { tryImportRoster } from "../src/import/import-roster.js";
import type { Roster, RosterUnit } from "../src/import/types.js";
import { decodeShareToken, encodeShareToken, rosterToShareList } from "../src/share/index.js";
import { shareListToRoster } from "../src/share/to-roster.js";

const ds = Dataset.embedded();
const ROSTERS = new URL("../../conformance/roster/", import.meta.url);

/** Every conformance roster input that imports. */
const corpus: [string, Roster][] = readdirSync(ROSTERS).flatMap((dir) => {
  const input = readdirSync(new URL(`${dir}/`, ROSTERS)).find((f) => f.startsWith("input."));
  if (!input) return [];
  const result = tryImportRoster(readFileSync(new URL(`${dir}/${input}`, ROSTERS), "utf8"), { dataset: ds });
  return result.ok ? [[dir, result.roster] as [string, Roster]] : [];
});

/** Per weapon id, the total a roster unit carries (groups when present, else the flat list). */
function rosterWeaponTotals(unit: RosterUnit): Map<string, number> {
  const totals = new Map<string, number>();
  const add = (id: string | null, n: number): void => {
    if (id !== null && ds.weapons.getAny(id)) totals.set(id, (totals.get(id) ?? 0) + n);
  };
  if (unit.loadout_groups && unit.loadout_groups.length > 0) for (const g of unit.loadout_groups) for (const w of g.wargear) add(w.ref.id, w.count * g.count);
  else for (const w of unit.wargear) add(w.ref.id, w.count);
  return totals;
}

/** Per weapon profile name, the total a converted unit carries across its stacks. */
function armyWeaponTotals(unit: YellowscribeUnit): Map<string, number> {
  const totals = new Map<string, number>();
  for (const model of Object.values(unit.models.models)) for (const w of model.weapons) totals.set(w.name, (totals.get(w.name) ?? 0) + w.number * model.number);
  return totals;
}

/** Checks the invariants the TTS mod relies on, and that no model or weapon is lost. */
function expectFaithful(roster: Roster): void {
  const army = yellowscribeArmy(roster, ds);
  expect(army.order).toEqual(Object.keys(army.units));
  expect(new Set(army.order).size).toBe(army.order.length);
  const kept = roster.units.filter((u) => !army.skipped.includes(u.ref.raw_name));
  expect(kept.length).toBe(army.order.length);
  kept.forEach((rosterUnit, i) => {
    const unit = army.units[army.order[i]!]!;
    expect(unit.uuid).toMatch(/^[0-9a-f]{8}$/);
    expect(unit.models.totalNumberOfModels).toBe(Math.max(rosterUnit.model_count, 1));
    expect(unit.isSingleModel).toBe(unit.models.totalNumberOfModels === 1);
    for (const [key, model] of Object.entries(unit.models.models)) {
      expect(key).toMatch(new RegExp(`^${unit.uuid}[0-9a-f]{8}$`));
      expect(model.number).toBeGreaterThan(0);
      for (const w of model.weapons) expect(unit.weapons[w.name], `${unit.name}: ${w.name}`).toBeDefined();
      for (const a of model.abilities) expect(unit.abilities[a]).toBeDefined();
    }
    expect(Object.keys(unit.modelProfiles).length).toBeGreaterThan(0);
    // Every weapon the roster carries reaches the models once per profile, at the same total.
    const carried = armyWeaponTotals(unit);
    let expected = 0;
    const factionId = resolveRosterUnit(rosterUnit, ds, roster.faction_id)!.factionId;
    for (const [id, total] of rosterWeaponTotals(rosterUnit)) {
      const weapon = ds.weapons.getInFaction(id, factionId) ?? ds.weapons.getAny(id)!;
      expected += total * weapon.raw.profiles.length;
    }
    expect([...carried.values()].reduce((a, b) => a + b, 0)).toBe(expected);
  });
}

describe("Yellowscribe army data", () => {
  it.each(corpus)("keeps every model and weapon of %s", (_, roster) => expectFaithful(roster));

  it("spreads flat wargear across the models, splitting out one model per leftover item", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ds.units.all.filter((u) => u.weapons.length > 0).map((u) => `${u.factionId}/${u.id}`)),
        fc.integer({ min: 1, max: 20 }),
        fc.array(fc.integer({ min: 0, max: 25 }), { minLength: 1, maxLength: 4 }),
        (key, modelCount, counts) => {
          const [factionId, unitId] = key.split("/") as [string, string];
          const view = ds.units.getInFaction(unitId, factionId)!;
          const weapons = view.weapons.slice(0, counts.length);
          const unit: RosterUnit = {
            ref: { id: view.id, raw_name: view.name, resolved: true, candidates: [] },
            model_count: modelCount,
            points: null,
            is_warlord: false,
            enhancement: null,
            enhancement_points: null,
            wargear: weapons.map((w, i) => ({ ref: { id: w.id, raw_name: w.name, resolved: true, candidates: [] }, count: counts[i]! })).filter((w) => w.count > 0),
            leader_attachment: null,
          };
          const roster = { ...corpus[0]![1], faction_id: view.factionId, units: [unit] };
          expectFaithful(roster);
          const converted = Object.values(yellowscribeArmy(roster, ds).units)[0]!;
          // No stack carries a weapon it cannot evenly hold: every stack is one model or has the base share only.
          const stacks = Object.values(converted.models.models);
          expect(stacks.filter((s) => s.number > 1).length).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("collapses core and faction abilities, keeps ratings, and gates wargear abilities on the wargear", () => {
    const crawler = shareListToRoster({ name: "x", factionId: "death-guard", detachmentIds: [], battleSize: "strike-force", disposition: null, units: [{ datasheetId: "plagueburst-crawler", modelCount: 1, isWarlord: true, enhancementId: null, allyFactionId: null, allyRuleId: null, attachedToOrdinal: null, grants: [], loadout: [["plagueburst-mortar", 1], ["heavy-slugger", 1]] }] }, ds);
    const unit = Object.values(yellowscribeArmy(crawler, ds).units)[0]!;
    expect(unit.abilities.Core?.desc).toBe("Deadly Demise D3, Damaged 4");
    expect(unit.abilities.Faction?.desc).toBe(ds.abilities.get("nurgles-gift-death-guard")!.name);
    expect(unit.abilities["Deadly Demise D3"]).toBeUndefined();
    expect(unit.keywords).toContain("Warlord");
    expect(unit.modelProfiles["Plagueburst Crawler"]).toMatchObject({ m: expect.stringMatching(/"$/), sv: expect.stringMatching(/\+$/) });

    const letters = (loadout: [string, number][]): YellowscribeUnit =>
      Object.values(yellowscribeArmy(shareListToRoster({ name: "x", factionId: "chaos-daemons", detachmentIds: [], battleSize: "strike-force", disposition: null, units: [{ datasheetId: "bloodletters", modelCount: 10, isWarlord: false, enhancementId: null, allyFactionId: null, allyRuleId: null, attachedToOrdinal: null, grants: [], loadout }] }, ds), ds).units)[0]!;
    expect(letters([["hellblade", 10]]).abilities["Daemonic Icon"]).toBeUndefined();
    expect(letters([["hellblade", 10], ["daemonic-icon", 1]]).abilities["Daemonic Icon"]?.desc).toBe(ds.abilities.get("daemonic-icon-chaos-daemons")!.describe());
  });

  it("names each profile of a multi-profile weapon and keeps a ranged and melee weapon of one name apart", () => {
    const roster = corpus.find(([dir]) => dir === "sm-gw-app-exact-groups")![1];
    const unit = Object.values(yellowscribeArmy(roster, ds).units).find((u) => u.name === "Intercessor Squad")!;
    expect(Object.keys(unit.weapons)).toEqual(expect.arrayContaining(["Bolt Rifle - Focused Fire", "Bolt Rifle - Saturation"]));
    expect(unit.weapons["Knives and Fists"]).toMatchObject({ range: "Melee", abilities: "-", shortAbilities: "-" });
  });

  it("adds a unit's enhancement as an ability", () => {
    const [, roster] = corpus.find(([, r]) => r.units.some((u) => u.enhancement?.id))!;
    const army = yellowscribeArmy(roster, ds);
    const unit = roster.units.find((u) => u.enhancement?.id)!;
    const enhancement = ds.enhancements.get(unit.enhancement!.id!)!;
    expect(Object.values(army.units).some((u) => u.abilities[enhancement.name] !== undefined)).toBe(true);
  });

  it("lists units that don't resolve instead of emitting them", () => {
    const roster = corpus[0]![1];
    const ghost: RosterUnit = { ...roster.units[0]!, ref: { id: null, raw_name: "Ghost Squad", resolved: false, candidates: [] } };
    const army = yellowscribeArmy({ ...roster, units: [ghost, ...roster.units] }, ds);
    expect(army.skipped).toEqual(["Ghost Squad"]);
    expect(army.order.length).toBe(yellowscribeArmy(roster, ds).order.length);
  });
});

describe("share-token rosters", () => {
  it.each(corpus)("round-trips %s through a share token", (_, roster) => {
    const list = rosterToShareList(roster);
    const decoded = decodeShareToken(encodeShareToken(list));
    if (!decoded.ok) throw new Error(decoded.reason);
    const again = rosterToShareList(shareListToRoster(decoded.list, ds));
    const { units, ...header } = again;
    const { units: wantUnits, ...wantHeader } = list;
    expect(header).toEqual(wantHeader);
    expect(units.length).toBe(wantUnits.length);
    units.forEach((u, i) => {
      const want = wantUnits[i]!;
      expect({ ...u, loadout: [] }).toEqual({ ...want, loadout: [] });
      // The resolver may add a datasheet's implied default; it never drops or changes a token entry.
      const got = new Map(u.loadout);
      for (const [id, count] of want.loadout) expect(got.get(id), `${u.datasheetId}: ${id}`).toBe(count);
    });
  });
});
