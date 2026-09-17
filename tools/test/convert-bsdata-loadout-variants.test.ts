import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { collectPeerGroups, collectSourceNodes, makeEquipmentResolver, prepareFactionProjection, projectBudget, projectUnit } from "../src/convert-bsdata-loadout-variants.js";
import { normModelName } from "../src/convert-bsdata-wargear.js";

const model = (name: string, targetId: string) => ({ name, type: "model", constraints: [{ field: "selections", type: "max", value: 2 }], entryLinks: [{ name: targetId === "missing" ? "Missing" : "Gun", targetId, type: "selectionEntry", constraints: [{ field: "selections", type: "min", value: 1 }] }] });

describe("BSData loadout variant projection", () => {
  it("indexes units stored in shared catalogue containers", () => {
    const shared = { id: "shared-unit", name: "Shared unit", type: "unit" };
    const nodes = collectSourceNodes([{ catalogue: { id: "catalogue", sharedSelectionEntries: [shared] } }]);
    expect(nodes.get("shared-unit")).toBe(shared);
  });

  it("rejects composition model types that are not loadout peers", () => {
    const sergeant = { ...model("Sergeant", "a"), constraints: [{ field: "selections", type: "min", value: 1 }] };
    const trooper = { ...model("Trooper", "b"), constraints: [{ field: "selections", type: "min", value: 4 }] };
    const unit = { selectionEntryGroups: [{ selectionEntries: [sergeant, trooper] }] };
    expect(collectPeerGroups(unit)).toEqual([]);
  });

  it("extracts direct model peers and resolves exact ids before unit-aware names", () => {
    const unit = { selectionEntryGroups: [{ selectionEntries: [model("Trooper", "exact"), model("Trooper w/ Gun", "missing")] }] };
    expect(collectPeerGroups(unit)).toHaveLength(1);
    const resolve = makeEquipmentResolver([{ id: "gun-unit", name: "Gun" }, { id: "other", external_refs: [{ namespace: "bsdata", id: "exact" }] }], "unit");
    expect(resolve({ name: "Gun", targetId: "exact" })).toBe("other");
    expect(resolve({ name: "Gun", targetId: "missing" })).toBe("gun-unit");
  });

  it("prefers the owning unit when an exact BSData id is shared", () => {
    const entities = [
      { id: "gun-other-unit", external_refs: [{ namespace: "bsdata", id: "shared" }] },
      { id: "gun-own-unit", external_refs: [{ namespace: "bsdata", id: "shared" }] },
    ];
    const resolve = makeEquipmentResolver(entities, "own-unit", ["other-unit", "own-unit"]);
    expect(resolve({ name: "Gun", targetId: "shared" })).toBe("gun-own-unit");
  });

  it("withholds an incomplete peer family instead of projecting its resolvable members", () => {
    const group = { constraints: [{ field: "selections", type: "max", value: 1 }], modifiers: [{ type: "increment", value: 1, conditions: [{ childId: "model", type: "atLeast", value: 20 }] }], selectionEntries: [model("Boy", "gun"), model("Boy w/ Missing", "missing")] };
    const rows: Record<string, unknown>[] = [{ name: "Boy" }];
    const issues = projectUnit({ selectionEntryGroups: [group] }, rows, [{ id: "gun", external_refs: [{ namespace: "bsdata", id: "gun" }] }], "boyz");
    expect(issues).toHaveLength(1);
    expect(rows[0].loadout_variants).toBeUndefined();
    expect(projectBudget(group, ["A", "B"])).toEqual({ variant_names: ["A", "B"], count: 1, per_models: 10, scope: "unit" });
  });

  it("projects complete Ork alternatives with their shared scaling budget", () => {
    const group = { constraints: [{ field: "selections", type: "max", value: 1 }], modifiers: [{ type: "increment", value: 1, conditions: [{ childId: "model", type: "atLeast", value: 20 }] }], selectionEntries: [model("Boy", "slugga"), model("Boy w/ Shoota", "shoota")] };
    const rows: Record<string, unknown>[] = [{ name: "Boy" }];
    expect(projectUnit({ selectionEntryGroups: [group] }, rows, [
      { id: "slugga", external_refs: [{ namespace: "bsdata", id: "slugga" }] },
      { id: "shoota", external_refs: [{ namespace: "bsdata", id: "shoota" }] },
    ], "boyz")).toEqual([]);
    expect(rows[0].loadout_variants).toEqual([
      { name: "Boy", weapon_ids: ["slugga"], max_count: 2 },
      { name: "Boy w/ Shoota", weapon_ids: ["shoota"], max_count: 2 },
    ]);
    expect(rows[0].loadout_variant_budgets).toEqual([{ variant_names: ["Boy", "Boy w/ Shoota"], count: 1, per_models: 10, scope: "unit" }]);
  });

  it("keeps the current projection untouched when an incomplete source peer is found", () => {
    const existing = [{ unit_id: "boyz", models: [{ name: "Boy", loadout_variants: [{ name: "Current", weapon_ids: ["gun"] }] }] }];
    const source = new Map([
      ["source-boyz", { selectionEntryGroups: [{ selectionEntries: [model("Boy", "gun"), model("Boy w/ Missing", "missing")] }] }],
    ]);
    const units = [{ id: "boyz", external_refs: [{ namespace: "bsdata", id: "source-boyz" }] }];

    const projection = prepareFactionProjection(
      units,
      existing,
      [{ id: "gun", external_refs: [{ namespace: "bsdata", id: "gun" }] }],
      source,
    );

    expect(projection.issues).toHaveLength(1);
    expect(existing[0].models[0].loadout_variants).toEqual([{ name: "Current", weapon_ids: ["gun"] }]);
  });

  it("projects fixed inline weapon profiles", () => {
    const inline = (name: string, id: string) => ({
      name,
      type: "model",
      selectionEntries: [{ id, name: "Blade", type: "upgrade", profiles: [{ typeName: "Melee Weapons" }] }],
    });
    const rows: Record<string, unknown>[] = [{ name: "Trooper" }];
    const issues = projectUnit(
      { selectionEntryGroups: [{ selectionEntries: [inline("Trooper", "blade-a"), inline("Trooper w/ Blade", "blade-b")] }] },
      rows,
      [
        { id: "blade-a", external_refs: [{ namespace: "bsdata", id: "blade-a" }] },
        { id: "blade-b", external_refs: [{ namespace: "bsdata", id: "blade-b" }] },
      ],
      "troopers",
    );
    expect(issues).toEqual([]);
    expect(rows[0].loadout_variants).toEqual([
      { name: "Trooper", weapon_ids: ["blade-a"] },
      { name: "Trooper w/ Blade", weapon_ids: ["blade-b"] },
    ]);
  });

  it("retains every copy of source-fixed equipment", () => {
    const paired = (name: string, targetId: string) => ({
      name,
      type: "model",
      entryLinks: [{ name: "Pistol", targetId, type: "selectionEntry", constraints: [
        { field: "selections", type: "min", value: 2 },
        { field: "selections", type: "max", value: 2 },
      ] }],
    });
    const rows: Record<string, unknown>[] = [{ name: "Seraphim" }];
    expect(projectUnit({ selectionEntryGroups: [{ selectionEntries: [paired("Seraphim", "pistol"), paired("Seraphim w/ Hand Flamer", "flamer")] }] }, rows, [
      { id: "pistol", external_refs: [{ namespace: "bsdata", id: "pistol" }] },
      { id: "flamer", external_refs: [{ namespace: "bsdata", id: "flamer" }] },
    ], "seraphim")).toEqual([]);
    expect(rows[0].loadout_variants).toEqual([
      { name: "Seraphim", weapon_ids: ["pistol", "pistol"] },
      { name: "Seraphim w/ Hand Flamer", weapon_ids: ["flamer", "flamer"] },
    ]);
  });

  it("includes a default-selected inline weapon node itself", () => {
    const defaulted = (name: string, id: string) => ({
      name,
      type: "model",
      selectionEntryGroups: [{
        constraints: [{ field: "selections", type: "min", value: 1 }],
        defaultSelectionEntryId: id,
        selectionEntries: [{ id, name: "Blade", type: "upgrade", profiles: [{ typeName: "Melee Weapons" }] }],
      }],
    });
    const rows: Record<string, unknown>[] = [{ name: "Trooper" }];
    expect(projectUnit({ selectionEntryGroups: [{ selectionEntries: [defaulted("Trooper", "blade-a"), defaulted("Trooper w/ Blade", "blade-b")] }] }, rows, [
      { id: "blade-a", external_refs: [{ namespace: "bsdata", id: "blade-a" }] },
      { id: "blade-b", external_refs: [{ namespace: "bsdata", id: "blade-b" }] },
    ], "troopers")).toEqual([]);
    expect(rows[0].loadout_variants).toEqual([
      { name: "Trooper", weapon_ids: ["blade-a"] },
      { name: "Trooper w/ Blade", weapon_ids: ["blade-b"] },
    ]);
  });

  it("includes a default-selected linked weapon node itself", () => {
    const defaulted = (name: string, id: string) => ({
      name,
      type: "model",
      selectionEntryGroups: [{
        constraints: [{ field: "selections", type: "min", value: 1 }],
        defaultSelectionEntryId: id,
        entryLinks: [{ id, name: "Bolt pistol", targetId: id, type: "selectionEntry" }],
      }],
    });
    const rows: Record<string, unknown>[] = [{ name: "Trooper" }];
    expect(projectUnit({ selectionEntryGroups: [{ selectionEntries: [defaulted("Trooper", "pistol-a"), defaulted("Trooper w/ Pistol", "pistol-b")] }] }, rows, [
      { id: "pistol-a", external_refs: [{ namespace: "bsdata", id: "pistol-a" }] },
      { id: "pistol-b", external_refs: [{ namespace: "bsdata", id: "pistol-b" }] },
    ], "troopers")).toEqual([]);
    expect(rows[0].loadout_variants).toEqual([
      { name: "Trooper", weapon_ids: ["pistol-a"] },
      { name: "Trooper w/ Pistol", weapon_ids: ["pistol-b"] },
    ]);
  });

  it("withholds a configurable peer family and preserves item-level projection space", () => {
    const configurable = {
      name: "Sword Brother",
      type: "model",
      entryLinks: [{ name: "Chainsword", targetId: "sword", type: "selectionEntry" }],
      selectionEntryGroups: [{
        name: "Melee weapon",
        constraints: [{ field: "selections", type: "min", value: 1 }, { field: "selections", type: "max", value: 1 }],
        selectionEntries: [{ id: "claw", name: "Twin lightning claws", type: "upgrade", profiles: [{ typeName: "Melee Weapons" }] }],
      }],
    };
    const rows: Record<string, unknown>[] = [{ name: "Sword Brother", wargear_options: [{ name: "Stock option" }] }];
    const issues = projectUnit({ selectionEntryGroups: [{ selectionEntries: [model("Sword Brother", "sword"), configurable] }] }, rows, [
      { id: "sword", external_refs: [{ namespace: "bsdata", id: "sword" }] },
      { id: "claw", external_refs: [{ namespace: "bsdata", id: "claw" }] },
    ], "sword-brethren");
    expect(issues).toEqual([expect.objectContaining({ variant: "Sword Brother", item: "Melee weapon", reason: "required equipment choice has no default selection" })]);
    expect(rows[0].loadout_variants).toBeUndefined();
    expect(rows[0].wargear_options).toEqual([{ name: "Stock option" }]);
  });

  it("does not freeze a peer cap modified by source conditions", () => {
    const conditional = {
      ...model("Trooper", "gun"),
      constraints: [{ id: "conditional-max", field: "selections", type: "max", value: 2 }],
      modifiers: [{ field: "conditional-max", type: "set", value: 4, conditions: [{ childId: "model", type: "atLeast", value: 10 }] }],
    };
    const rows: Record<string, unknown>[] = [{ name: "Trooper" }];
    expect(projectUnit({ selectionEntryGroups: [{ selectionEntries: [conditional, model("Trooper w/ Blade", "blade")] }] }, rows, [
      { id: "gun", external_refs: [{ namespace: "bsdata", id: "gun" }] },
      { id: "blade", external_refs: [{ namespace: "bsdata", id: "blade" }] },
    ], "troopers")).toEqual([]);
    expect(rows[0].loadout_variants).toEqual([
      { name: "Trooper", weapon_ids: ["gun"] },
      { name: "Trooper w/ Blade", weapon_ids: ["blade"], max_count: 2 },
    ]);
  });

  it("normalizes both model-loadout suffix forms", () => {
    expect(normModelName("Boy w/ Shoota")).toBe("boy");
    expect(normModelName("Boy with Shoota")).toBe("boy");
  });

  it("retains generated variants on a real non-Boyz composition", () => {
    const compositions = JSON.parse(fs.readFileSync("../data/core/adepta-sororitas/unit-compositions.json", "utf8"));
    const unit = compositions.find((item: { unit_id: string }) => item.unit_id === "battle-sisters-squad");
    const row = unit.models.find((item: { name: string }) => item.name === "Battle Sister");
    expect(row.loadout_variants).toHaveLength(4);
    expect(row.loadout_variant_budgets).toHaveLength(1);
    expect({ name: row.name, min: row.min, max: row.max, default_weapon_ids: row.default_weapon_ids }).toEqual({
      name: "Battle Sister",
      min: 9,
      max: 9,
      default_weapon_ids: ["boltgun", "bolt-pistol", "close-combat-weapon-battle-sisters-squad"],
    });
  });
});
