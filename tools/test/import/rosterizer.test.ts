/**
 * Rosterizer adapter unit tests.
 *
 * Rosterizer (https://rosterizer.com) stores a roster as a recursive `Asset`
 * tree where every entity is keyed by `Classification§Designation`. The
 * adapter walks `assets.included` / `assets.traits` and lifts the structural
 * facts (item key, quantity, points stat) into a {@link ParsedRoster}. Prose
 * fields are never read.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Dataset } from "../../src/data/dataset.js";
import { importRoster } from "../../src/import/import-roster.js";
import { rosterizerAdapter } from "../../src/import/rosterizer.js";

const ds = Dataset.embedded();

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url)), "utf8"),
  );

const PAYLOAD = "gk-banishers.rosterizer.payload.json";

describe("rosterizerAdapter.matches", () => {
  it("recognises a Rosterizer envelope (rulebook + snapshot)", () => {
    expect(rosterizerAdapter.matches(fixture(PAYLOAD))).toBe(true);
  });

  it("rejects payloads with no rulebook field", () => {
    expect(rosterizerAdapter.matches({ snapshot: { item: "Roster§Roster" } })).toBe(false);
  });

  it("rejects payloads with no snapshot or history", () => {
    expect(rosterizerAdapter.matches({ rulebook: {} })).toBe(false);
  });

  it("accepts a history-only envelope (no top-level snapshot)", () => {
    const payload = {
      rulebook: { name: "x" },
      history: { present: { roster: { item: "Roster§Roster" } } },
    };
    expect(rosterizerAdapter.matches(payload)).toBe(true);
  });

  it("does not match a BattleScribe-shaped payload", () => {
    expect(
      rosterizerAdapter.matches({ name: "x", roster: { forces: [] } }),
    ).toBe(false);
  });
});

describe("rosterizerAdapter.parse", () => {
  const parsed = rosterizerAdapter.parse(fixture(PAYLOAD));

  it("extracts faction, detachment, and battle size from Classification§Designation children", () => {
    expect(parsed.faction_raw_name).toBe("Grey Knights");
    expect(parsed.detachment_raw_names).toEqual(["Banishers"]);
    expect(parsed.battle_size_raw).toContain("Strike Force");
    expect(parsed.declared_limit).toBe(2000);
  });

  it("reads roster-level points from snapshot.stats.Points.value", () => {
    expect(parsed.total_reported).toBe(585);
    // total_computed sums every unit's base + enhancement points: 90 + 225 + 20 + 250
    expect(parsed.total_computed).toBe(585);
  });

  it("extracts units with quantity as model_count", () => {
    const names = parsed.units.map((u) => u.raw_name);
    expect(names).toContain("Castellan Crowe");
    expect(names).toContain("Grand Master in Nemesis Dreadknight");
    expect(names).toContain("Purifier Squad");

    const squad = parsed.units.find((u) => u.raw_name === "Purifier Squad")!;
    expect(squad.model_count).toBe(10);

    const crowe = parsed.units.find((u) => u.raw_name === "Castellan Crowe")!;
    expect(crowe.model_count).toBe(1);
    expect(crowe.points).toBe(90);
  });

  it("flags the Warlord trait on its host unit", () => {
    const gm = parsed.units.find((u) => u.raw_name.startsWith("Grand Master"))!;
    expect(gm.is_warlord).toBe(true);
    expect(gm.is_character).toBe(true);
  });

  it("lifts the Enhancement asset into enhancement_raw_name + points", () => {
    const gm = parsed.units.find((u) => u.raw_name.startsWith("Grand Master"))!;
    expect(gm.enhancement_raw_name).toBe("Pyresoul (Psychic)");
    expect(gm.enhancement_points).toBe(20);
  });

  it("collects wargear with per-weapon counts", () => {
    const squad = parsed.units.find((u) => u.raw_name === "Purifier Squad")!;
    expect(squad.wargear).toHaveLength(1);
    expect(squad.wargear[0].raw_name).toBe("Nemesis force halberd");
    expect(squad.wargear[0].count).toBe(10);

    const gm = parsed.units.find((u) => u.raw_name.startsWith("Grand Master"))!;
    const weapons = gm.wargear.map((w) => w.raw_name);
    expect(weapons).toContain("Heavy psycannon");
    expect(weapons).toContain("Nemesis daemon greathammer");
    // The enhancement is not a weapon.
    expect(weapons).not.toContain("Pyresoul (Psychic)");
  });

  it("does not leak prose fields (text/description) into the parsed output", () => {
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("CANARY_TEXT_SHOULD_NOT_APPEAR");
    expect(serialized).not.toContain("CANARY_DESCRIPTION_SHOULD_NOT_APPEAR");
  });
});

describe("rosterizer resolution against the embedded dataset", () => {
  const roster = importRoster(fixture(PAYLOAD), { dataset: ds });

  it("stamps source.format as rosterizer", () => {
    expect(roster.source.format).toBe("rosterizer");
  });

  it("resolves faction and detachment", () => {
    expect(roster.faction_id).toBe("grey-knights");
    expect(roster.detachments.map((d) => d.ref.id)).toEqual(["banishers"]);
    expect(roster.battle_size).toBe("strike-force");
  });

  it("resolves units to 40kdc entity ids", () => {
    const ids = roster.units.map((u) => u.ref.id);
    expect(ids).toContain("castellan-crowe");
    expect(ids).toContain("grand-master-in-nemesis-dreadknight");
    expect(ids).toContain("purifier-squad");
  });

  it("preserves the warlord flag and resolves the enhancement", () => {
    const gm = roster.units.find((u) => u.ref.id === "grand-master-in-nemesis-dreadknight")!;
    expect(gm.is_warlord).toBe(true);
    expect(gm.enhancement?.id).toBe("pyresoul-psychic");
    expect(gm.enhancement_points).toBe(20);
  });

  it("preserves wargear counts after resolution", () => {
    const squad = roster.units.find((u) => u.ref.id === "purifier-squad")!;
    expect(squad.wargear).toHaveLength(1);
    expect(squad.wargear[0].count).toBe(10);
  });
});
