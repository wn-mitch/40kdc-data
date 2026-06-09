import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Dataset } from "../../src/data/dataset.js";
import { importRoster } from "../../src/import/import-roster.js";
import type { Roster } from "../../src/import/types.js";

const ds = Dataset.embedded();

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url)), "utf8"),
  );

const unitById = (r: Roster, id: string) => r.units.find((u) => u.ref.id === id);
const unitByRaw = (r: Roster, raw: string) => r.units.find((u) => u.ref.raw_name === raw);

describe("resolve (against embedded grey-knights data)", () => {
  const roster = importRoster(fixture("gk-banishers.payload.json"), { dataset: ds });

  it("resolves faction, detachment, and battle size", () => {
    expect(roster.faction_id).toBe("grey-knights");
    expect(roster.detachments.map((d) => d.ref.id)).toEqual(["banishers"]);
    expect(roster.battle_size).toBe("strike-force");
    expect(roster.points).toEqual({
      declared_limit: 2000,
      detachment_cap: 3,
      total_reported: 585,
      total_computed: 585,
    });
  });

  it("resolves units to their entity ids", () => {
    expect(unitById(roster, "castellan-crowe")).toBeDefined();
    expect(unitById(roster, "grand-master-in-nemesis-dreadknight")).toBeDefined();
    expect(unitById(roster, "purifier-squad")).toBeDefined();
  });

  it("resolves the enhancement scoped to the detachment", () => {
    const gm = unitById(roster, "grand-master-in-nemesis-dreadknight")!;
    expect(gm.is_warlord).toBe(true);
    expect(gm.enhancement?.id).toBe("pyresoul-psychic");
    expect(gm.enhancement?.resolved).toBe(true);
  });

  it("resolves wargear to weapon ids", () => {
    const gm = unitById(roster, "grand-master-in-nemesis-dreadknight")!;
    const ids = gm.wargear.map((w) => w.ref.id);
    expect(ids).toContain("heavy-psycannon");
    expect(ids).toContain("nemesis-daemon-greathammer");
    expect(gm.wargear.every((w) => w.ref.resolved)).toBe(true);
  });

  it("reports clean diagnostics for a fully-resolved list", () => {
    expect(roster.diagnostics.resolved_units).toBe(3);
    expect(roster.diagnostics.unresolved_units).toBe(0);
    expect(roster.diagnostics.unresolved_weapons).toBe(0);
  });

  it("infers a provisional leader attachment", () => {
    // Grand Master can lead a Paladin Squad / Brotherhood Terminator Squad.
    const payload = {
      name: "Leader Test",
      generatedBy: "List Forge",
      roster: {
        name: "Leader Test",
        costs: [{ name: "pts", value: 0 }],
        forces: [
          {
            id: "f1",
            name: "Army Roster",
            selections: [
              {
                id: "u-gm",
                name: "Grand Master",
                type: "model",
                number: 1,
                categories: [
                  { name: "Faction: Grey Knights" },
                  { name: "Character", primary: true },
                ],
              },
              {
                id: "u-paladins",
                name: "Paladin Squad",
                type: "unit",
                number: 1,
                categories: [
                  { name: "Faction: Grey Knights" },
                  { name: "Infantry", primary: true },
                ],
              },
            ],
          },
        ],
      },
    };
    const r = importRoster(payload, { dataset: ds });
    const gm = unitById(r, "grand-master")!;
    expect(gm.leader_attachment).not.toBeNull();
    expect(gm.leader_attachment!.bodyguard_ref.id).toBe("paladin-squad");
    expect(gm.leader_attachment!.provisional).toBe(true);
    expect(r.diagnostics.warnings.some((w) => w.code === "leader-attachment-inferred")).toBe(true);
  });

  it("retains an unresolved unit with candidates and a warning", () => {
    const payload = {
      name: "Miss Test",
      generatedBy: "List Forge",
      roster: {
        name: "Miss Test",
        costs: [{ name: "pts", value: 0 }],
        forces: [
          {
            id: "f1",
            name: "Army Roster",
            selections: [
              {
                id: "u-bogus",
                name: "Definitely Not A Real Unit",
                type: "model",
                number: 1,
                categories: [{ name: "Faction: Grey Knights" }, { name: "Character" }],
              },
            ],
          },
        ],
      },
    };
    const r = importRoster(payload, { dataset: ds });
    const miss = unitByRaw(r, "Definitely Not A Real Unit")!;
    expect(miss.ref.id).toBeNull();
    expect(miss.ref.resolved).toBe(false);
    expect(r.diagnostics.unresolved_units).toBe(1);
    expect(r.diagnostics.warnings.some((w) => w.code === "unit-unresolved")).toBe(true);
  });

  it("flags multi-force lists and resolves the primary faction", () => {
    const r = importRoster(fixture("gk-allied-multiforce.payload.json"), { dataset: ds });
    expect(r.faction_id).toBe("grey-knights");
    expect(r.diagnostics.warnings.some((w) => w.code === "multi-force")).toBe(true);
    expect(r.units.length).toBe(2);
  });
});
