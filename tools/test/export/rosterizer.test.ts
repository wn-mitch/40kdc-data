/**
 * Rosterizer serializer unit tests. Asserts the emitted JSON envelope shape
 * (rulebook + snapshot Asset tree) and the importer round-trip.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Dataset } from "../../src/data/dataset.js";
import { exportRoster } from "../../src/export/index.js";
import { importRoster } from "../../src/import/import-roster.js";
import { rosterizerSerializer } from "../../src/export/rosterizer.js";

const ds = Dataset.embedded();

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url)), "utf8"),
  );

const seed = importRoster(fixture("gk-banishers.rosterizer.payload.json"), {
  dataset: ds,
});

describe("rosterizerSerializer", () => {
  it("emits a Rosterizer envelope with rulebook and snapshot", () => {
    const out = JSON.parse(rosterizerSerializer.serialize(seed)) as Record<string, unknown>;
    expect(out).toHaveProperty("rulebook");
    expect(out).toHaveProperty("snapshot");
    const snapshot = out.snapshot as Record<string, unknown>;
    expect(snapshot.item).toBe("Roster§Roster");
  });

  it("emits a Faction Asset whose item key is Faction§<Name>", () => {
    const out = JSON.parse(rosterizerSerializer.serialize(seed)) as { snapshot: {
      assets: { included: { item: string }[] };
    } };
    const items = out.snapshot.assets.included.map((a) => a.item);
    expect(items).toContain("Faction§Grey Knights");
    expect(items).toContain("Detachment§Banishers");
    expect(items.some((i) => i.startsWith("Battle Size§Strike Force"))).toBe(true);
  });

  it("emits each unit with quantity = model_count and a Points stat", () => {
    interface UnitAsset {
      item: string;
      name?: string;
      quantity?: number;
      stats?: { Points?: { value: number } };
      assets?: { included?: { item: string; quantity?: number }[]; traits?: { item: string }[] };
    }
    const out = JSON.parse(rosterizerSerializer.serialize(seed)) as { snapshot: {
      assets: { included: UnitAsset[] };
    } };
    const purifiers = out.snapshot.assets.included.find(
      (a) => a.item === "Unit§Purifier Squad",
    );
    expect(purifiers).toBeDefined();
    expect(purifiers!.quantity).toBe(10);
    expect(purifiers!.stats?.Points?.value).toBe(250);
    const halberd = purifiers!.assets?.included?.find(
      (w) => w.item === "Weapon§Nemesis force halberd",
    );
    expect(halberd?.quantity).toBe(10);
  });

  it("emits the Warlord trait under assets.traits on the warlord unit", () => {
    interface UnitAsset {
      item: string;
      assets?: { traits?: { item: string }[] };
    }
    const out = JSON.parse(rosterizerSerializer.serialize(seed)) as { snapshot: {
      assets: { included: UnitAsset[] };
    } };
    const gm = out.snapshot.assets.included.find((a) =>
      a.item.startsWith("Unit§Grand Master"),
    );
    expect(gm).toBeDefined();
    const traits = gm!.assets?.traits?.map((t) => t.item) ?? [];
    expect(traits).toContain("Trait§Warlord");
  });

  it("emits the Enhancement as an included Asset with a Points stat", () => {
    interface UnitAsset {
      item: string;
      assets?: { included?: { item: string; stats?: { Points?: { value: number } } }[] };
    }
    const out = JSON.parse(rosterizerSerializer.serialize(seed)) as { snapshot: {
      assets: { included: UnitAsset[] };
    } };
    const gm = out.snapshot.assets.included.find((a) =>
      a.item.startsWith("Unit§Grand Master"),
    );
    const enh = gm!.assets?.included?.find((c) => c.item.startsWith("Enhancement§"));
    expect(enh?.item).toBe("Enhancement§Pyresoul (Psychic)");
    expect(enh?.stats?.Points?.value).toBe(20);
  });

  it("never emits prose fields (text, description, rules)", () => {
    const out = rosterizerSerializer.serialize(seed);
    expect(out).not.toMatch(/"text"/);
    expect(out).not.toMatch(/"description"/);
    expect(out).not.toMatch(/"rules"/);
  });

  it("registers under exportRoster(roster, \"rosterizer\")", () => {
    const direct = rosterizerSerializer.serialize(seed);
    const dispatched = exportRoster(seed, "rosterizer");
    expect(dispatched).toBe(direct);
  });

  it("round-trips: export → import → same resolved Roster (modulo source/diagnostics)", () => {
    const json = exportRoster(seed, "rosterizer");
    const reparsed = importRoster(JSON.parse(json), { dataset: ds });
    expect(reparsed.source.format).toBe("rosterizer");
    expect(reparsed.faction_id).toBe(seed.faction_id);
    expect(reparsed.detachment_id).toBe(seed.detachment_id);
    expect(reparsed.battle_size).toBe(seed.battle_size);
    expect(reparsed.units.map((u) => u.ref.id)).toEqual(seed.units.map((u) => u.ref.id));
    expect(reparsed.units.map((u) => u.model_count)).toEqual(seed.units.map((u) => u.model_count));
    expect(reparsed.units.map((u) => u.is_warlord)).toEqual(seed.units.map((u) => u.is_warlord));
    expect(reparsed.units.map((u) => u.points)).toEqual(seed.units.map((u) => u.points));
    expect(reparsed.units.map((u) => u.enhancement?.id ?? null)).toEqual(
      seed.units.map((u) => u.enhancement?.id ?? null),
    );
    expect(
      reparsed.units.map((u) => u.wargear.map((w) => [w.ref.id, w.count])),
    ).toEqual(seed.units.map((u) => u.wargear.map((w) => [w.ref.id, w.count])));
  });
});
