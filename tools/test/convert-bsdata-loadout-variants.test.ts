import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { collectPeerGroups, collectSourceNodes, makeEquipmentResolver, prepareFactionProjection, projectBudget, projectUnit } from "../src/convert-bsdata-loadout-variants.js";
import { normModelName } from "../src/convert-bsdata-wargear.js";
import { validateLoadout, type LoadoutModel } from "../src/data/loadout.js";
import type { Unit } from "../src/generated.js";

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

  it("attaches no variants to a model name several composition rows share", () => {
    // Same-named rows each record their own default loadout (a miniature split by default group).
    const group = { constraints: [{ field: "selections", type: "max", value: 1 }], selectionEntries: [model("Boy", "slugga"), model("Boy w/ Shoota", "shoota")] };
    const rows: Record<string, unknown>[] = [
      { name: "Boy", default_weapon_ids: ["slugga"] },
      { name: "Boy", default_weapon_ids: ["shoota"] },
    ];
    expect(projectUnit({ selectionEntryGroups: [group] }, rows, [
      { id: "slugga", external_refs: [{ namespace: "bsdata", id: "slugga" }] },
      { id: "shoota", external_refs: [{ namespace: "bsdata", id: "shoota" }] },
    ], "boyz")).toEqual([]);
    expect(rows.map((row) => row.loadout_variants)).toEqual([undefined, undefined]);
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
        constraints: [{ field: "selections", type: "min", value: 2 }, { field: "selections", type: "max", value: 2 }],
        selectionEntries: [{ id: "claw", name: "Twin lightning claws", type: "upgrade", profiles: [{ typeName: "Melee Weapons" }] }],
      }],
    };
    const rows: Record<string, unknown>[] = [{ name: "Sword Brother", wargear_options: [{ name: "Stock option" }] }];
    const issues = projectUnit({ selectionEntryGroups: [{ selectionEntries: [model("Sword Brother", "sword"), configurable] }] }, rows, [
      { id: "sword", external_refs: [{ namespace: "bsdata", id: "sword" }] },
      { id: "claw", external_refs: [{ namespace: "bsdata", id: "claw" }] },
    ], "sword-brethren");
    expect(issues).toEqual([expect.objectContaining({ variant: "Sword Brother", item: "Melee weapon", reason: "required equipment choice picks more than one item" })]);
    expect(rows[0].loadout_variants).toBeUndefined();
    expect(rows[0].wargear_options).toEqual([{ name: "Stock option" }]);
  });

  it("projects a size-dependent peer cap as a ratio and keeps the committed cap when no form fits", () => {
    const peer = (name: string, modifiers: unknown[], value = 1) => ({
      ...model(name, "gun"),
      id: name,
      constraints: [{ id: `${name}-max`, field: "selections", type: "max", value }],
      modifiers: modifiers.map((m) => ({ field: `${name}-max`, ...(m as object) })),
    });
    const atLeast = (value: number) => [{ childId: "model", field: "selections", scope: "unit", type: "atLeast", value }];
    const lessThan = (value: number) => [{ childId: "model", field: "selections", scope: "unit", type: "lessThan", value }];
    const project = (heavy: Record<string, unknown>, sizes: number[], previous: Record<string, unknown>[] = []) => {
      const rows: Record<string, unknown>[] = [{ name: "Trooper" }];
      const notes: string[] = [];
      projectUnit({ selectionEntryGroups: [{ selectionEntries: [model("Trooper", "gun"), heavy] }] }, rows, refs("gun"), "troopers", [], new Map(), sizes, notes, previous);
      return { variant: (rows[0].loadout_variants as Record<string, unknown>[])[1], budgets: rows[0].loadout_variant_budgets, notes };
    };
    // 1 heavy weapon, 2 at ten models: exactly one per five across 5–10.
    const strike = project(peer("Trooper w/ Heavy", [{ type: "set", value: 2, conditions: atLeast(10) }]), [5, 6, 7, 8, 9, 10]);
    expect(strike.variant).toEqual({ name: "Trooper w/ Heavy", weapon_ids: ["gun"] });
    expect(strike.budgets).toContainEqual({ variant_names: ["Trooper w/ Heavy"], count: 1, per_models: 5, scope: "unit" });
    // 2, 4 at ten, none below five: two per full five models, a stepped ratio.
    const sizes = [3, 4, 5, 6, 7, 8, 9, 10];
    const paladin = project(peer("Trooper w/ Heavy", [{ type: "set", value: 4, conditions: atLeast(10) }, { type: "set", value: 0, conditions: lessThan(5) }], 2), sizes);
    expect(paladin.variant).toEqual({ name: "Trooper w/ Heavy", weapon_ids: ["gun"] });
    expect(paladin.budgets).toContainEqual({ variant_names: ["Trooper w/ Heavy"], count: 2, per_models: 5, scope: "unit", stepped: true });
    // 1, 3 at ten: no flat, ratio or stepped form reproduces 5–10.
    const odd = peer("Trooper w/ Heavy", [{ type: "set", value: 3, conditions: atLeast(10) }]);
    expect(project(odd, sizes.slice(2)).variant).toEqual({ name: "Trooper w/ Heavy", weapon_ids: ["gun"], max_count: 1 });
    const committed = project(odd, sizes.slice(2), [{ name: "Trooper", loadout_variants: [{ name: "Trooper w/ Heavy", weapon_ids: ["gun"], max_count: 2 }] }]);
    expect(committed.variant).toEqual({ name: "Trooper w/ Heavy", weapon_ids: ["gun"], max_count: 2 });
    expect(committed.notes).toEqual(["troopers: Trooper w/ Heavy: size-dependent cap kept at its committed 2"]);
  });

  it("projects an upgrade whose weapon profile is an infoLink", () => {
    const linked = (target: string) => ({
      ...model("Trooper w/ Blade", "gun"),
      selectionEntries: [{
        name: "Heavy blade",
        type: "upgrade",
        constraints: [{ field: "selections", type: "min", value: 1 }, { field: "selections", type: "max", value: 1 }],
        infoLinks: [{ name: "Heavy blade", targetId: target, type: "profile" }],
      }],
    });
    const nodes = new Map([
      ["blade-profile", { id: "blade-profile", typeName: "Melee Weapons" }],
      ["banner-profile", { id: "banner-profile", typeName: "Abilities" }],
    ]);
    const project = (target: string) => {
      const rows: Record<string, unknown>[] = [{ name: "Trooper" }];
      const issues = projectUnit({ selectionEntryGroups: [{ selectionEntries: [model("Trooper", "gun"), linked(target)] }] }, rows, [
        { id: "gun", external_refs: [{ namespace: "bsdata", id: "gun" }] },
        { id: "heavy-blade" },
      ], "troopers", [], nodes);
      return { issues, variants: rows[0].loadout_variants };
    };
    expect(project("blade-profile")).toEqual({
      issues: [],
      variants: [
        { name: "Trooper", weapon_ids: ["gun"], max_count: 2 },
        { name: "Trooper w/ Blade", weapon_ids: ["gun", "heavy-blade"], max_count: 2 },
      ],
    });
    // A non-weapon profile is not equipment.
    expect(project("banner-profile").variants).toEqual([
      { name: "Trooper", weapon_ids: ["gun"], max_count: 2 },
      { name: "Trooper w/ Blade", weapon_ids: ["gun"], max_count: 2 },
    ]);
    // A dangling link falls to the equipment resolver rather than being dropped.
    expect(project("missing-profile").variants?.[1]).toEqual({ name: "Trooper w/ Blade", weapon_ids: ["gun", "heavy-blade"], max_count: 2 });
  });

  it("normalizes both model-loadout suffix forms", () => {
    expect(normModelName("Boy w/ Shoota")).toBe("boy");
    expect(normModelName("Boy with Shoota")).toBe("boy");
  });

  it("retains generated variants on a real non-Boyz composition", () => {
    const compositions = JSON.parse(fs.readFileSync("../data/core/adepta-sororitas/unit-compositions.json", "utf8"));
    const unit = compositions.find((item: { unit_id: string }) => item.unit_id === "battle-sisters-squad");
    const row = unit.models.find((item: { name: string }) => item.name === "Battle Sister");
    // Two fixed peers plus one variant per pick of each defaultless weapon choice.
    expect(row.loadout_variants).toHaveLength(11);
    expect(row.loadout_variant_budgets).toHaveLength(3);
    expect({ name: row.name, min: row.min, max: row.max, default_weapon_ids: row.default_weapon_ids }).toEqual({
      name: "Battle Sister",
      min: 9,
      max: 9,
      default_weapon_ids: ["boltgun", "bolt-pistol", "close-combat-weapon-battle-sisters-squad"],
    });
  });
});

const min = (value: number) => ({ field: "selections", scope: "parent", type: "min", value });
const max = (value: number, scope = "parent") => ({ field: "selections", scope, type: "max", value });
const link = (name: string, targetId: string, constraints: unknown[] = [min(1)]) => ({ name, targetId, type: "selectionEntry", constraints });
const refs = (...ids: string[]) => ids.map((id) => ({ id, external_refs: [{ namespace: "bsdata", id }] }));
const rowModel = (row: Record<string, unknown>, count: number): LoadoutModel => ({ ...row, name: String(row.name), min: count, max: count } as LoadoutModel);

describe("BSData loadout variant projection: equipment choices", () => {
  // Shaped like the 11e Legionaries datasheet: a fixed heavy melee peer whose
  // weapon is an inline upgrade with a shared-profile infoLink, beside a peer
  // whose weapon is a required pick with no default.
  const legionaries = {
    selectionEntryGroups: [{
      selectionEntries: [
        { name: "Legionary w/ boltgun", type: "model", constraints: [max(9)], entryLinks: [link("Bolt pistol", "bolt-pistol"), link("Boltgun", "boltgun")] },
        {
          name: "Legionary w/ heavy melee weapon",
          type: "model",
          constraints: [max(1)],
          entryLinks: [link("Bolt pistol", "bolt-pistol")],
          selectionEntries: [{ name: "Heavy melee weapon", type: "upgrade", constraints: [min(1), max(1)], infoLinks: [{ name: "Heavy melee weapon", targetId: "hmw-profile", type: "profile" }] }],
        },
        {
          name: "Legionary w/ other weapon",
          type: "model",
          constraints: [max(2)],
          entryLinks: [link("Bolt pistol", "bolt-pistol")],
          selectionEntryGroups: [{
            name: "Weapon",
            defaultSelectionEntryId: "none",
            constraints: [max(1), min(1)],
            entryLinks: [{ name: "Meltagun", targetId: "meltagun", type: "selectionEntry" }],
            selectionEntries: [{ name: "Flamer", type: "upgrade", constraints: [max(1, "legionaries-unit")], profiles: [{ typeName: "Ranged Weapons" }] }],
          }],
        },
      ],
    }],
  };
  const equipment = [...refs("bolt-pistol", "boltgun", "meltagun"), { id: "flamer" }, { id: "heavy-melee-weapon" }];
  const profiles = new Map([["hmw-profile", { id: "hmw-profile", typeName: "Melee Weapons" }]]);

  it("splits a defaultless required pick into one variant per choice and keeps the fixed heavy melee weapon", () => {
    const rows: Record<string, unknown>[] = [{ name: "Legionary" }];
    expect(projectUnit(legionaries, rows, equipment, "legionaries", [], profiles)).toEqual([]);
    expect(rows[0].loadout_variants).toEqual([
      { name: "Legionary w/ boltgun", weapon_ids: ["bolt-pistol", "boltgun"], max_count: 9 },
      { name: "Legionary w/ heavy melee weapon", weapon_ids: ["bolt-pistol", "heavy-melee-weapon"], max_count: 1 },
      { name: "Legionary w/ other weapon (Flamer)", weapon_ids: ["bolt-pistol", "flamer"], max_count: 1 },
      { name: "Legionary w/ other weapon (Meltagun)", weapon_ids: ["bolt-pistol", "meltagun"], max_count: 2 },
    ]);
    expect(rows[0].loadout_variant_budgets).toEqual([
      { variant_names: ["Legionary w/ other weapon (Flamer)", "Legionary w/ other weapon (Meltagun)"], count: 2, per_models: 0, scope: "model-row" },
    ]);
  });

  it("pools the split peer's ceiling so the splits cannot field more models than the peer", () => {
    const rows: Record<string, unknown>[] = [{ name: "Legionary", default_weapon_ids: ["bolt-pistol", "boltgun"] }];
    projectUnit(legionaries, rows, equipment, "legionaries", [], profiles);
    const unit = { id: "legionaries", weapon_ids: ["bolt-pistol", "boltgun", "meltagun", "flamer", "heavy-melee-weapon"] } as Unit;
    const models = [rowModel(rows[0], 4)];
    const counts = (entries: Record<string, number>) => new Map(Object.entries({ "bolt-pistol": 4, ...entries }));
    expect(validateLoadout(unit, 4, [], counts({ boltgun: 2, meltagun: 1, flamer: 1 }), models)).toEqual([]);
    // Meltagun ×2 fits its own cap and Flamer ×1 fits its own, but three models
    // would take the one peer that allows two.
    expect(validateLoadout(unit, 4, [], counts({ boltgun: 1, meltagun: 2, flamer: 1 }), models)).not.toEqual([]);
    expect(validateLoadout(unit, 4, [], counts({ boltgun: 2, flamer: 2 }), models)).not.toEqual([]);
  });

  it("expands linked required groups, including a pick among linked groups", () => {
    const groups = new Map([
      ["special", { id: "special", entryLinks: [{ name: "Meltagun", targetId: "meltagun", type: "selectionEntry" }, { name: "Flamer", targetId: "flamer", type: "selectionEntry" }] }],
      ["heavy", { id: "heavy", entryLinks: [{ name: "Heavy bolter", targetId: "heavy-bolter", type: "selectionEntry" }] }],
    ]);
    const unit = {
      selectionEntryGroups: [{
        selectionEntries: [
          { name: "Sister", type: "model", constraints: [max(9)], entryLinks: [link("Boltgun", "boltgun")] },
          { name: "Sister w/ Special Weapon", type: "model", constraints: [max(1)], entryLinks: [{ name: "Special Weapons", targetId: "special", type: "selectionEntryGroup", constraints: [min(1), max(1)] }] },
          {
            name: "Sister w/ Special or Heavy Weapon",
            type: "model",
            constraints: [max(1)],
            selectionEntryGroups: [{
              name: "Weapon",
              constraints: [max(1), min(1)],
              entryLinks: [
                { name: "Special Weapons", targetId: "special", type: "selectionEntryGroup" },
                { name: "Heavy Weapons", targetId: "heavy", type: "selectionEntryGroup" },
              ],
            }],
          },
        ],
      }],
    };
    const rows: Record<string, unknown>[] = [{ name: "Sister" }];
    expect(projectUnit(unit, rows, refs("boltgun", "meltagun", "flamer", "heavy-bolter"), "sisters", [], groups)).toEqual([]);
    expect((rows[0].loadout_variants as { name: string; weapon_ids: string[] }[]).map((variant) => [variant.name, variant.weapon_ids])).toEqual([
      ["Sister", ["boltgun"]],
      ["Sister w/ Special Weapon (Meltagun)", ["meltagun"]],
      ["Sister w/ Special Weapon (Flamer)", ["flamer"]],
      ["Sister w/ Special or Heavy Weapon (Meltagun)", ["meltagun"]],
      ["Sister w/ Special or Heavy Weapon (Flamer)", ["flamer"]],
      ["Sister w/ Special or Heavy Weapon (Heavy bolter)", ["heavy-bolter"]],
    ]);
  });

  it("fixes the required children of an optional wargear container", () => {
    const kan = (name: string, gun: string) => ({
      name,
      type: "model",
      constraints: [max(6)],
      selectionEntryGroups: [{
        name: "Wargear",
        entryLinks: [link("Kan klaw", "kan-klaw", [min(1), max(1)])],
        selectionEntries: [{ name: gun, type: "upgrade", constraints: [min(1), max(1)], profiles: [{ typeName: "Ranged Weapons" }] }],
      }],
    });
    const rows: Record<string, unknown>[] = [{ name: "Killa Kan" }];
    expect(projectUnit({ selectionEntryGroups: [{ selectionEntries: [kan("Killa Kan w/ Kan shoota", "Kan shoota"), kan("Killa Kan w/ Skorcha", "Skorcha")] }] }, rows, [
      ...refs("kan-klaw"), { id: "kan-shoota" }, { id: "skorcha" },
    ], "killa-kans")).toEqual([]);
    expect(rows[0].loadout_variants).toEqual([
      { name: "Killa Kan w/ Kan shoota", weapon_ids: ["kan-shoota", "kan-klaw"], max_count: 6 },
      { name: "Killa Kan w/ Skorcha", weapon_ids: ["skorcha", "kan-klaw"], max_count: 6 },
    ]);
  });

  it("includes the base model beside a nested block of alternatives and keeps a cap no budget form reproduces", () => {
    const unit = {
      selectionEntryGroups: [{
        name: "4-9 Purifiers",
        selectionEntries: [{ name: "Purifier", type: "model", constraints: [min(2), max(9)], entryLinks: [link("Storm bolter", "storm-bolter")] }],
        selectionEntryGroups: [{
          name: "Heavy weapons",
          constraints: [{ id: "heavy-max", ...max(2) }],
          modifiers: [{ field: "heavy-max", type: "set", value: 4, conditions: [{ childId: "model", type: "atLeast", value: 10 }] }],
          selectionEntries: [
            { name: "Purifier w/ incinerator", type: "model", constraints: [max(4)], entryLinks: [link("Incinerator", "incinerator")] },
            { name: "Purifier w/ psycannon", type: "model", constraints: [max(4)], entryLinks: [link("Psycannon", "psycannon")] },
          ],
        }],
      }],
    };
    const rows: Record<string, unknown>[] = [{ name: "Purifier", default_weapon_ids: ["storm-bolter"] }];
    // Two heavy weapons, four at ten models: no ratio jumps by two between 9 and 10.
    expect(projectUnit(unit, rows, refs("storm-bolter", "incinerator", "psycannon"), "purifiers", [], new Map(), [5, 6, 7, 8, 9, 10])).toEqual([]);
    expect(rows[0].loadout_variants).toEqual([
      { name: "Purifier", weapon_ids: ["storm-bolter"], max_count: 9 },
      { name: "Purifier w/ incinerator", weapon_ids: ["incinerator"], max_count: 4 },
      { name: "Purifier w/ psycannon", weapon_ids: ["psycannon"], max_count: 4 },
    ]);
    expect(rows[0].loadout_variant_budgets).toEqual([
      { variant_names: ["Purifier w/ incinerator", "Purifier w/ psycannon"], count: 2, per_models: 0, scope: "model-row" },
    ]);
    const purifiers = { id: "purifiers", weapon_ids: ["storm-bolter", "incinerator", "psycannon"] } as Unit;
    expect(validateLoadout(purifiers, 9, [], new Map([["storm-bolter", 9]]), [rowModel(rows[0], 9)])).toEqual([]);
  });

  it("keeps a group cap off a variant another peer family also declares", () => {
    const unit = {
      selectionEntryGroups: [{
        constraints: [max(9)],
        selectionEntries: [
          { name: "Farstalker", type: "model", constraints: [min(8), max(8)], entryLinks: [link("Rifle", "rifle")] },
          { name: "Farstalker w/ Pech'ra", type: "model", constraints: [max(1)], entryLinks: [link("Rifle", "rifle"), link("Pech'ra", "pechra")] },
        ],
        selectionEntryGroups: [{
          constraints: [max(1), min(1)],
          defaultSelectionEntryId: "plain",
          selectionEntries: [
            { id: "skinner", name: "Farstalker w/ skinner", type: "model", entryLinks: [link("Skinner", "skinner")] },
            { id: "plain", name: "Farstalker", type: "model", entryLinks: [link("Rifle", "rifle")] },
          ],
        }],
      }],
    };
    const rows: Record<string, unknown>[] = [{ name: "Farstalker", default_weapon_ids: ["rifle"] }];
    expect(projectUnit(unit, rows, refs("rifle", "pechra", "skinner"), "farstalkers")).toEqual([]);
    expect((rows[0].loadout_variants as { name: string; max_count?: number }[]).find((variant) => variant.name === "Farstalker")).not.toHaveProperty("max_count");
    expect(rows[0].loadout_variant_budgets).toEqual([
      { variant_names: ["Farstalker w/ Pech'ra"], count: 9, per_models: 0, scope: "model-row" },
      { variant_names: ["Farstalker w/ skinner"], count: 1, per_models: 0, scope: "model-row" },
    ]);
    const farstalkers = { id: "farstalkers", weapon_ids: ["rifle", "pechra", "skinner"] } as Unit;
    // Eight plain models and the default pick of the special slot.
    expect(validateLoadout(farstalkers, 9, [], new Map([["rifle", 9]]), [rowModel(rows[0], 9)])).toEqual([]);
  });

  it("caps the variants carrying an equipment entry by its structured per-size count limit", () => {
    const over = (models: number, count: number) => ({
      type: "and",
      conditions: [
        { childId: "model", field: "selections", scope: "unit", type: "lessThan", value: models },
        { childId: "eviscerator", field: "selections", scope: "unit", type: "greaterThan", value: count },
      ],
    });
    // Shaped like the 11e Khornate eviscerator entry: the display text is an
    // error string, the limit itself is structured conditions.
    const nodes = new Map([["eviscerator", {
      id: "eviscerator",
      modifiers: [{ field: "error", type: "add", value: "Max 1 per 5 models", conditionGroups: [{ type: "or", conditionGroups: [over(20, 3), over(15, 2), over(10, 1)] }] }],
    }]]);
    const peer = (name: string, extra: string) => ({ name, type: "model", constraints: [max(4)], entryLinks: [link("Eviscerator", "eviscerator"), link(extra, extra)] });
    const unit = { selectionEntryGroups: [{ selectionEntries: [
      { name: "Berzerker", type: "model", constraints: [max(19)], entryLinks: [link("Chainblade", "chainblade")] },
      peer("Berzerker w/ eviscerator", "pistol"),
      peer("Berzerker w/ eviscerator and plasma", "plasma"),
    ] }] };
    const rows: Record<string, unknown>[] = [{ name: "Berzerker", default_weapon_ids: ["chainblade"] }];
    const sizes = Array.from({ length: 11 }, (_, i) => i + 10);
    expect(projectUnit(unit, rows, refs("chainblade", "eviscerator", "pistol", "plasma"), "berzerkers", [], nodes, sizes)).toEqual([]);
    expect(rows[0].loadout_variant_budgets).toEqual([
      { variant_names: ["Berzerker w/ eviscerator", "Berzerker w/ eviscerator and plasma"], count: 1, per_models: 5, scope: "unit" },
    ]);
    const berzerkers = { id: "berzerkers", weapon_ids: ["chainblade", "eviscerator", "pistol", "plasma"] } as Unit;
    const models = [rowModel(rows[0], 10)];
    expect(validateLoadout(berzerkers, 10, [], new Map([["chainblade", 8], ["eviscerator", 2], ["pistol", 1], ["plasma", 1]]), models)).toEqual([]);
    expect(validateLoadout(berzerkers, 10, [], new Map([["chainblade", 7], ["eviscerator", 3], ["pistol", 2], ["plasma", 1]]), models)).not.toEqual([]);
  });

  it("pools peers whose caps the source lowers per selection of each other, at their per-size ratio", () => {
    const special = (id: string, other: string) => ({
      id,
      name: `Reaver with ${id}`,
      type: "model",
      constraints: [{ id: `${id}-max`, ...max(1) }],
      entryLinks: [link(id, id)],
      modifiers: [
        { field: `${id}-max`, type: "decrement", value: 1, repeats: [{ childId: other, field: "selections", scope: "unit", value: 1, repeats: 1 }] },
        { field: `${id}-max`, type: "increment", value: 1, conditions: [{ childId: "model", field: "selections", scope: "unit", type: "equalTo", value: 6 }] },
      ],
    });
    const unit = { selectionEntryGroups: [{ selectionEntries: [
      { name: "Reaver", type: "model", constraints: [max(6)], entryLinks: [link("Rifle", "rifle")] },
      special("blaster", "lance"),
      special("lance", "blaster"),
    ] }] };
    const rows: Record<string, unknown>[] = [{ name: "Reaver", default_weapon_ids: ["rifle"] }];
    expect(projectUnit(unit, rows, refs("rifle", "blaster", "lance"), "reavers", [], new Map(), [3, 4, 5, 6])).toEqual([]);
    expect(rows[0].loadout_variant_budgets).toEqual(expect.arrayContaining([
      { variant_names: ["Reaver with blaster"], count: 1, per_models: 3, scope: "unit" },
      { variant_names: ["Reaver with blaster", "Reaver with lance"], count: 1, per_models: 3, scope: "unit" },
    ]));
    const reavers = { id: "reavers", weapon_ids: ["rifle", "blaster", "lance"] } as Unit;
    expect(validateLoadout(reavers, 5, [], new Map([["rifle", 3], ["blaster", 1], ["lance", 1]]), [rowModel(rows[0], 5)])).not.toEqual([]);
    expect(validateLoadout(reavers, 6, [], new Map([["rifle", 4], ["blaster", 1], ["lance", 1]]), [rowModel(rows[0], 6)])).toEqual([]);
  });

  it("projects the committed Legionary heavy melee weapon and every other-weapon choice", () => {
    const compositions = JSON.parse(fs.readFileSync("../data/core/chaos-space-marines/unit-compositions.json", "utf8"));
    const row = compositions.find((item: { unit_id: string }) => item.unit_id === "legionaries")
      .models.find((item: { name: string }) => item.name === "Legionary");
    const variants = new Map<string, string[]>(row.loadout_variants.map((variant: { name: string; weapon_ids: string[] }) => [variant.name, variant.weapon_ids]));
    expect(variants.get("Legionary w/ heavy melee weapon")).toContain("heavy-melee-weapon");
    expect(variants.has("Legionary w/ other weapon")).toBe(false);
    expect(variants.get("Legionary w/ other weapon (Lascannon)")).toContain("lascannon-legionaries");
  });
});
