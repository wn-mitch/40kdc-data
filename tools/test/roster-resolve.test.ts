import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import {
  resolveAttachedLeader,
  resolveAttachmentPartners,
  resolveRosterUnit,
  resolveRosterWargear,
} from "../src/data/roster-resolve.js";
import type { Roster, RosterUnit, RosterWargear } from "../src/import/types.js";

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

function rosterOf(units: RosterUnit[]): Roster {
  return {
    name: "Test Roster",
    source: { format: "listforge", generated_by: null },
    faction_id: "adepta-sororitas",
    detachment_id: null,
    battle_size: null,
    points: { declared_limit: null, total_reported: null, total_computed: 0 },
    units,
    game_version: { edition: "11th", dataslate: "pre-launch-provisional" },
    diagnostics: {
      resolved_units: units.length,
      unresolved_units: 0,
      resolved_weapons: 0,
      unresolved_weapons: 0,
      warnings: [],
    },
  };
}

function leaderUnit(leaderId: string, bodyguardId: string): RosterUnit {
  const u = rosterUnit(leaderId);
  u.leader_attachment = {
    bodyguard_ref: { id: bodyguardId, raw_name: bodyguardId, resolved: true, candidates: [] },
    provisional: true,
  };
  return u;
}

describe("resolveAttachedLeader", () => {
  it("finds the leader attached to a given body unit", () => {
    const roster = rosterOf([
      rosterUnit("battle-sisters-squad"),
      leaderUnit("palatine", "battle-sisters-squad"),
    ]);
    const leader = resolveAttachedLeader(roster, "battle-sisters-squad");
    expect(leader?.ref.id).toBe("palatine");
  });

  it("returns undefined when no leader is attached to the body unit", () => {
    const roster = rosterOf([
      rosterUnit("battle-sisters-squad"),
      leaderUnit("palatine", "dominion-squad"),
    ]);
    expect(resolveAttachedLeader(roster, "battle-sisters-squad")).toBeUndefined();
  });

  it("returns undefined for a roster with no attachments at all", () => {
    const roster = rosterOf([rosterUnit("battle-sisters-squad"), rosterUnit("palatine")]);
    expect(resolveAttachedLeader(roster, "battle-sisters-squad")).toBeUndefined();
  });
});

describe("resolveAttachmentPartners", () => {
  const roster = rosterOf([
    rosterUnit("battle-sisters-squad"),
    leaderUnit("palatine", "battle-sisters-squad"),
  ]);

  it("finds the partner from the bodyguard's end (the attached leader)", () => {
    const partners = resolveAttachmentPartners(roster, "battle-sisters-squad").map((u) => u.ref.id);
    expect(partners).toEqual(["palatine"]);
  });

  it("finds the partner from the leader's end (the bodyguard it joined)", () => {
    const partners = resolveAttachmentPartners(roster, "palatine").map((u) => u.ref.id);
    expect(partners).toEqual(["battle-sisters-squad"]);
  });

  it("returns an empty array when the unit is in no attachment", () => {
    const lone = rosterOf([rosterUnit("battle-sisters-squad"), rosterUnit("palatine")]);
    expect(resolveAttachmentPartners(lone, "battle-sisters-squad")).toEqual([]);
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
