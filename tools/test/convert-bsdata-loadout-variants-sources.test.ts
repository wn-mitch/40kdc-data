import { describe, expect, it } from "vitest";
import { makeEquipmentResolver, projectUnit } from "../src/convert-bsdata-loadout-variants.js";
import { variantBudgetCap, type LoadoutVariantBudget } from "../src/data/loadout.js";

type Node = Record<string, unknown>;

const limit = (type: "min" | "max", value: number) => ({ id: `${type}-${value}`, field: "selections", scope: "parent", type, value });
const gunLink = { name: "Gun", targetId: "gun", type: "selectionEntry", constraints: [limit("min", 1)] };
const trooper = (name: string, max: number, extra: Node[] = []): Node =>
  ({ name, type: "model", constraints: [limit("max", max)], entryLinks: [gunLink], selectionEntries: extra });
const gun = { id: "gun", external_refs: [{ namespace: "bsdata", id: "gun" }], profiles: [{}] };

function project(unit: Node, rows: Node[], equipment: Node[], nodes: Map<string, Node> = new Map()): Node[] {
  expect(projectUnit(unit, rows, equipment, "troopers", [], nodes)).toEqual([]);
  return rows;
}

describe("BSData variant sources", () => {
  it("projects a peer placed by a link to a shared model", () => {
    const shared = { id: "shared-trooper", name: "Trooper", type: "model", entryLinks: [gunLink] };
    const unit = {
      selectionEntryGroups: [{
        selectionEntries: [{ ...trooper("Trooper w/ Flamer", 2), entryLinks: [{ ...gunLink, name: "Flamer", targetId: "flamer" }] }],
        entryLinks: [{ id: "link", name: "Trooper", targetId: "shared-trooper", type: "selectionEntry", constraints: [limit("max", 9)] }],
      }],
    };
    const flamer = { id: "flamer", external_refs: [{ namespace: "bsdata", id: "flamer" }], profiles: [{}] };
    const [row] = project(unit, [{ name: "Trooper" }], [gun, flamer], new Map([["shared-trooper", shared]]));
    expect(row.loadout_variants).toEqual([
      { name: "Trooper w/ Flamer", weapon_ids: ["flamer"], max_count: 2 },
      { name: "Trooper", weapon_ids: ["gun"], max_count: 9 },
    ]);
  });

  it("keeps an ability-profile upgrade that resolves to repo wargear", () => {
    const vox = { name: "Vox-caster", type: "upgrade", constraints: [limit("min", 1), limit("max", 1)], profiles: [{ typeName: "Abilities" }] };
    const unit = { selectionEntryGroups: [{ selectionEntries: [trooper("Trooper", 9), trooper("Trooper w/ Vox", 1, [vox])] }] };
    const [row] = project(unit, [{ name: "Trooper" }], [gun, { id: "vox-caster" }]);
    expect(row.loadout_variants).toContainEqual({ name: "Trooper w/ Vox", weapon_ids: ["gun", "vox-caster"], max_count: 1 });
  });

  it("charges a team of required peers once per member", () => {
    const team = {
      name: "Weapons Team",
      type: "upgrade",
      constraints: [limit("max", 1)],
      selectionEntries: [
        { ...trooper("Trooper w/ Launcher", 1), constraints: [limit("min", 1), limit("max", 1)] },
        { ...trooper("Trooper w/ Pistol", 1), constraints: [limit("min", 1), limit("max", 1)] },
      ],
    };
    const unit = { selectionEntryGroups: [{ selectionEntries: [trooper("Trooper", 9), team] }] };
    const [row] = project(unit, [{ name: "Trooper", min: 9, max: 9 }], [gun]);
    expect(row.loadout_variant_budgets).toContainEqual(
      { variant_names: ["Trooper w/ Launcher", "Trooper w/ Pistol"], count: 2, per_models: 0, scope: "model-row" },
    );
  });

  it("scales a variant capped differently in each fixed-size tier block", () => {
    const block = (size: number, vox: number): Node =>
      ({ name: `${size} Troopers`, constraints: [limit("min", size), limit("max", size)], selectionEntries: [trooper("Trooper", size), trooper("Trooper w/ Vox", vox)] });
    const unit = { selectionEntryGroups: [block(9, 1), block(18, 2)] };
    const [row] = project(unit, [{ name: "Trooper", min: 9, max: 18 }], [gun]);
    const budgets = ((row.loadout_variant_budgets ?? []) as LoadoutVariantBudget[])
      .filter((budget) => budget.variant_names?.includes("Trooper w/ Vox"));
    const cap = (rowCount: number) => Math.min(...budgets.map((budget) => variantBudgetCap(budget, rowCount, rowCount)));
    expect([cap(9), cap(18)]).toEqual([1, 2]);
  });

  it("reads combined BSData names and per-unit renames as their MFM item", () => {
    const resolveCombined = makeEquipmentResolver([{ id: "transonic-razor-and-chordclaw" }], "sicarian-ruststalkers");
    expect(resolveCombined({ name: "Transonic razor & chordclaw" })).toBe("transonic-razor-and-chordclaw");
    const resolveRenamed = makeEquipmentResolver([{ id: "blaster" }], "corsair-voidscarred");
    expect(resolveRenamed({ name: "Corsair blaster" })).toBe("blaster");
    expect(makeEquipmentResolver([{ id: "blaster" }], "other-unit")({ name: "Corsair blaster" })).toBeUndefined();
  });
});
