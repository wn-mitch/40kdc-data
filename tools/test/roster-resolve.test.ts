import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { resolveRosterUnit, resolveRosterWargear } from "../src/data/roster-resolve.js";
import type { RosterUnit, RosterWargear } from "../src/import/types.js";

const ds = Dataset.embedded();

function rosterUnit(id: string | null, rawName = "Test Unit"): RosterUnit {
  return {
    ref: { id, raw_name: rawName, resolved: id !== null, candidates: [] },
    model_count: 5,
    points: null,
    is_warlord: false,
    enhancement: null,
    enhancement_points: null,
    wargear: [],
    leader_attachment: null,
  };
}

describe("resolveRosterUnit", () => {
  it("returns the linked UnitView for a resolved roster entry", () => {
    const view = resolveRosterUnit(rosterUnit("intercessor-squad"), ds);
    expect(view).toBeDefined();
    expect(view!.id).toBe("intercessor-squad");
  });

  it("returns undefined for an unresolved (null id) ref", () => {
    expect(resolveRosterUnit(rosterUnit(null), ds)).toBeUndefined();
  });

  it("returns undefined for an id not present in the dataset", () => {
    expect(resolveRosterUnit(rosterUnit("no-such-unit"), ds)).toBeUndefined();
  });
});

describe("resolveRosterWargear", () => {
  it("resolves each resolved entry, drops the unresolved ones", () => {
    const wargear: RosterWargear[] = [
      {
        ref: { id: "bolt-rifle", raw_name: "Bolt rifle", resolved: true, candidates: [] },
        count: 5,
      },
      { ref: { id: null, raw_name: "Mystery gun", resolved: false, candidates: [] }, count: 1 },
      {
        ref: { id: "no-such-weapon", raw_name: "Phantom", resolved: true, candidates: [] },
        count: 2,
      },
    ];
    const resolved = resolveRosterWargear(wargear, ds);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].weapon.id).toBe("bolt-rifle");
    expect(resolved[0].count).toBe(5);
  });
});
