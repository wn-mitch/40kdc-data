import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/index.js";
import { checkboxCaps, checkMfmLoadout, defaultMfmLoadout, type MfmLoadoutRules } from "../src/data/mfm-loadout.js";
import { liftLoadout, refinedRows } from "../src/mfm/loadout-lift.js";
import { partialDump } from "./mfm-fixture.js";

const dataset = Dataset.embedded();
const compositions: readonly { unit_id: string; faction_id: string; loadout?: MfmLoadoutRules }[] = dataset.unitCompositions;
const rulesOf = (factionId: string, unitId: string): MfmLoadoutRules => {
  const composition = compositions
    .find((row) => row.unit_id === unitId && row.faction_id === factionId);
  if (!composition?.loadout) throw new Error(`${factionId}/${unitId} has no lifted loadout`);
  return composition.loadout;
};

/** The default unit with its rows resized and `swaps` applied as [from, to, copies]. */
function unit(rules: MfmLoadoutRules, rows: Record<string, number>, swaps: [string | null, string, number][] = []) {
  const { models, counts } = defaultMfmLoadout(rules);
  for (const [model, n] of Object.entries(rows)) models.set(model, n);
  const resized = new Map<string, number>();
  for (const row of rules.stock) {
    const n = row.model === undefined ? 1 : models.get(row.model) ?? 0;
    const per = row.model === undefined ? 1 : row.models;
    for (const item of row.items) resized.set(item.id, (resized.get(item.id) ?? 0) + (per > 0 ? (item.count / per) * n : 0));
  }
  const out = Object.keys(rows).length > 0 ? resized : counts;
  for (const [from, to, n] of swaps) {
    if (from) {
      // A misspelt id would make the loadout illegal for the wrong reason.
      if ((out.get(from) ?? 0) < n) throw new Error(`the unit has fewer than ${n} ${from}`);
      out.set(from, out.get(from)! - n);
    }
    out.set(to, (out.get(to) ?? 0) + n);
  }
  return { models, counts: out };
}
const legal = (rules: MfmLoadoutRules, built: ReturnType<typeof unit>) => checkMfmLoadout(rules, built.models, built.counts).length === 0;

describe("checkbox options cap their row", () => {
  it("lets one Paladin take the Apothecary's narthecium, not two", () => {
    const rules = rulesOf("grey-knights", "paladin-squad");
    const bolter = "storm-bolter-paladin-squad";
    expect(legal(rules, unit(rules, {}, [[bolter, "apothecarys-narthecium", 1]]))).toBe(true);
    expect(legal(rules, unit(rules, {}, [[bolter, "apothecarys-narthecium", 2]]))).toBe(false);
  });

  it("leaves stepper options to the slots and limits", () => {
    const rules = rulesOf("grey-knights", "paladin-squad");
    expect(legal(rules, unit(rules, { Paladin: 4 }, [["storm-bolter-paladin-squad", "psycannon", 2]]))).toBe(true);
  });

  it("enforces the Catachan Command Squad's no-duplicate footnote", () => {
    const rules = rulesOf("astra-militarum", "catachan-command-squad");
    expect(legal(rules, unit(rules, {}, [["lasgun", "flamer", 1], ["lasgun", "meltagun", 1]]))).toBe(true);
    expect(legal(rules, unit(rules, {}, [["lasgun", "flamer", 2]]))).toBe(false);
  });

  it("counts an item a stepper also offers as uncapped, so the Tankbustas' extra launcha follows its limit", () => {
    const rules = rulesOf("orks", "tankbustas");
    expect(legal(rules, unit(rules, {}, [[null, "busta-rokkit-launcha", 1]]))).toBe(true);
    expect(legal(rules, unit(rules, {}, [[null, "busta-rokkit-launcha", 2]]))).toBe(false);
  });

  it("caps a per-model row on each model: two Carnifexes can both take bio-plasma", () => {
    const rules = rulesOf("tyranids", "carnifexes");
    expect(legal(rules, unit(rules, { Carnifex: 2 }, [[null, "bio-plasma", 2]]))).toBe(true);
    expect(legal(rules, unit(rules, { Carnifex: 2 }, [[null, "bio-plasma", 3]]))).toBe(false);
    expect(legal(rules, unit(rules, {}, [[null, "bio-plasma", 2]]))).toBe(false);
  });
});

describe("checkboxCaps", () => {
  const rules = (options: MfmLoadoutRules["options"], stock: MfmLoadoutRules["stock"] = []): MfmLoadoutRules =>
    ({ stock, templates: [], slots: [], limits: [], uniform: [], options });

  it("drops the cap when any option for the item is a stepper", () => {
    const caps = checkboxCaps(rules([
      { model: "A", id: "gun", input: "checkbox", default: 0 },
      { model: "A", id: "gun", input: "stepper", default: 3 },
      { model: "A", id: "banner", input: "checkbox", default: 0 },
    ], [{ model: "A", models: 3, items: [{ id: "gun", count: 3 }] }]), "A", 3);
    expect([...caps]).toEqual([["banner", 1]]);
  });

  it("counts each checkbox and keeps a dirtier stock default", () => {
    const caps = checkboxCaps(rules([
      { model: "A", id: "gun", input: "checkbox", default: 0 },
      { model: "A", id: "gun", input: "checkbox", default: 0 },
      { model: "A", id: "shield", input: "checkbox", default: 6 },
      { model: "A", id: "fist", input: "stepper", default: 6 },
    ], [{ model: "A", models: 6, items: [{ id: "shield", count: 6 }, { id: "fist", count: 6 }] }]), "A", 6);
    expect(caps.get("gun")).toBe(2);
    expect(caps.get("shield")).toBe(6);
  });

  it("scales a row's checkboxes by its models only when the app lists them model by model", () => {
    const options: MfmLoadoutRules["options"] = [
      { model: "A", id: "claws", input: "checkbox", default: 1 },
      { model: "A", id: "extra", input: "checkbox", default: 0 },
    ];
    const stock = { model: "A", models: 1, items: [{ id: "claws", count: 1 }] };
    expect(checkboxCaps(rules(options, [{ ...stock, individual: true }]), "A", 3).get("extra")).toBe(3);
    // A one-model row of checkboxes is still one widget for the row unless the dump marks it.
    expect(checkboxCaps(rules(options, [stock]), "A", 3).get("extra")).toBe(1);
    // A row the default unit has none of (Broadside Shas'ui) scales too.
    expect(checkboxCaps(rules(options, [{ model: "A", models: 0, items: [], individual: true }]), "A", 2).get("extra")).toBe(2);
  });

  it("lets each of three Broadsides take its own twin smart missile system", () => {
    const rules = rulesOf("tau-empire", "broadside-battlesuits");
    expect(rules.stock.find((row) => row.model === "Broadside Shas’ui")?.individual).toBe(true);
    expect(checkboxCaps(rules, "Broadside Shas’ui", 2).get("twin-smart-missile-system-broadside-battlesuits")).toBe(2);
  });
});

describe("the lifted loadouts", () => {
  it("reads the Havocs' default heavy weapons from the option defaults", () => {
    const { counts } = defaultMfmLoadout(rulesOf("chaos-space-marines", "havocs"));
    expect(counts.get("havoc-autocannon")).toBe(2);
    expect(counts.get("havoc-lascannon")).toBe(2);
  });

  it("keeps Immortals on one gun type", () => {
    const rules = rulesOf("necrons", "immortals");
    expect(legal(rules, unit(rules, {}, [["gauss-blaster", "tesla-carbine", 5]]))).toBe(true);
    expect(legal(rules, unit(rules, {}, [["gauss-blaster", "tesla-carbine", 2]]))).toBe(false);
  });

  it("allows swaps the wargear-option checker refused", () => {
    const breaka = rulesOf("orks", "breaka-boyz");
    expect(legal(breaka, unit(breaka, {}, [["smash-hammer", "rokkit-pistol", 1], ["smash-hammer", "tankhammer", 1]]))).toBe(true);
    const dread = rulesOf("orks", "deff-dread");
    expect(legal(dread, unit(dread, {}, [["skorcha", "big-shoota", 1]]))).toBe(true);
  });

  it("refuses loadouts the wargear-option checker allowed", () => {
    const tyrant = rulesOf("tyranids", "hive-tyrant");
    expect(legal(tyrant, unit(tyrant, {}, [["monstrous-bonesword-and-lash-whip", "stranglethorn-cannon", 1]]))).toBe(true);
    expect(legal(tyrant, unit(tyrant, {}, [
      ["monstrous-bonesword-and-lash-whip", "stranglethorn-cannon", 1],
      ["monstrous-scything-talons", "stranglethorn-cannon", 1],
    ]))).toBe(false);
    const blightlords = rulesOf("death-guard", "blightlord-terminators");
    expect(legal(blightlords, unit(blightlords, {}, [["combi-bolter", "combi-weapon", 1]]))).toBe(false);
    const thunderkyn = rulesOf("leagues-of-votann", "brokhyr-thunderkyn");
    expect(legal(thunderkyn, unit(thunderkyn, {}, [["bolt-cannon", "sp-conversion-beamer", 2]]))).toBe(false);
    expect(legal(thunderkyn, unit(thunderkyn, {}, [["bolt-cannon", "sp-conversion-beamer", 3]]))).toBe(true);
  });

  it("reports an item the unit can carry, in counts no assignment fits, as no assignment", () => {
    const rules = rulesOf("orks", "deff-dread");
    const { models } = defaultMfmLoadout(rules);
    const oneGun = new Map([["dread-klaw", 1], ["extra-klaw", 1]]);
    expect(checkMfmLoadout(rules, models, oneGun).map((v) => v.code)).toEqual(["no-assignment"]);
    const foreign = new Map([["dread-klaw", 1], ["big-shoota", 1], ["skorcha", 1], ["lascannon", 1]]);
    expect(checkMfmLoadout(rules, models, foreign).map((v) => v.code)).toEqual(["unknown-item"]);
  });

  it("accepts every default unit but the Noise Marines, whose dump rows contradict each other", () => {
    const failing = compositions
      .filter((row) => row.loadout)
      .filter((row) => {
        const { models, counts } = defaultMfmLoadout(row.loadout!);
        return [...models.values()].some((n) => n > 0) && checkMfmLoadout(row.loadout!, models, counts).length > 0;
      })
      .map((row) => `${row.faction_id}/${row.unit_id}`);
    expect(failing).toEqual(["emperors-children/noise-marines"]);
  });
});

describe("liftLoadout options", () => {
  const dump = (inputType: string) => partialDump({
    data: {
      miniature: [{ id: "m", datasheetId: "ds", displayOrder: 1, localisations: { en: { name: "Trooper" } } }],
      unit_composition: [{ id: "uc", datasheetId: "ds", isDefault: true, displayOrder: 1, points: 10, referenceGroupingKeywordId: null }],
      unit_composition_miniature: [{ id: "ucm", min: 2, max: 2, unitCompositionId: "uc", miniatureId: "m" }],
      wargear_item: [{ id: "wi", wargearType: "weapon", localisations: { en: { name: "Banner" } } }],
      wargear_option_group: [{ id: "g", displayOrder: 1, datasheetId: "ds", miniatureId: "m", isStaticWargear: false }],
      wargear_option: [{ id: "o", wargearItemId: "wi", wargearOptionGroupId: "g", inputType, defaultValue: 0, points: 0, displayOrder: 1 }],
      base_miniature_loadout: [],
      base_miniature_loadout_wargear_option: [],
      loadout_choice_set: [],
      loadout_choice: [],
      loadout_choice_wargear_item: [],
      limited_wargear_choice_set: [],
      limited_wargear_choice: [],
      limited_wargear_choice_wargear_item: [],
      wargear_limit: [],
      all_model_wargear_choice_set: [],
      all_model_wargear_choice: [],
      all_model_wargear_choice_wargear_item: [],
    },
  });
  const resolve = (name: string) => name.toLowerCase();

  it("records each option's row, item, input and default", () => {
    const result = liftLoadout(dump("checkbox"), "ds", resolve, new Map([["Trooper", 1]]));
    expect("loadout" in result && result.loadout.options).toEqual([{ model: "Trooper", id: "banner", input: "checkbox", default: 0 }]);
  });

  it("refuses an input type it has no reading for", () => {
    expect(() => liftLoadout(dump("dropdown"), "ds", resolve, new Map([["Trooper", 1]]))).toThrow(/dropdown/);
  });
});

describe("liftLoadout model rows", () => {
  const EMPTY = Object.fromEntries([
    "base_miniature_loadout", "base_miniature_loadout_wargear_option", "loadout_choice_set", "loadout_choice",
    "loadout_choice_wargear_item", "limited_wargear_choice_set", "limited_wargear_choice", "limited_wargear_choice_wargear_item",
    "wargear_limit", "all_model_wargear_choice_set", "all_model_wargear_choice", "all_model_wargear_choice_wargear_item",
  ].map((table) => [table, []]));
  /** One datasheet whose miniatures each carry one default item; `max` per miniature in its one composition. */
  const dump = (minis: { name: string; item: string; max: number }[]) => partialDump({
    data: {
      ...EMPTY,
      miniature: minis.map((mini, i) => ({ id: `m${i}`, datasheetId: "ds", displayOrder: i + 1, localisations: { en: { name: mini.name } } })),
      unit_composition: [{ id: "uc", datasheetId: "ds", isDefault: true, displayOrder: 1, points: 10, referenceGroupingKeywordId: null }],
      unit_composition_miniature: minis.map((mini, i) => ({ id: `ucm${i}`, min: mini.max, max: mini.max, unitCompositionId: "uc", miniatureId: `m${i}` })),
      wargear_item: minis.map((mini, i) => ({ id: `wi${i}`, wargearType: "wargear", localisations: { en: { name: mini.item } } })),
      wargear_option_group: minis.map((_, i) => ({ id: `g${i}`, displayOrder: i + 1, datasheetId: "ds", miniatureId: `m${i}`, isStaticWargear: false })),
      wargear_option: minis.map((_, i) => ({ id: `o${i}`, wargearItemId: `wi${i}`, wargearOptionGroupId: `g${i}`, inputType: "checkbox", defaultValue: 1, points: 0, displayOrder: 1 })),
    },
  });
  const resolve = (name: string) => name.toLowerCase().replace(/ /g, "-");
  const rows = (...names: string[]) => new Map(names.map((name) => [name, 1]));

  it("drops the rows of a miniature every composition caps at 0", () => {
    const result = liftLoadout(dump([{ name: "Pink Horror", item: "Coruscating Flames", max: 10 }, { name: "Blue Horror", item: "Blue Flames", max: 0 }]), "ds", resolve, rows("Pink Horror"));
    expect("loadout" in result && result.loadout.options.map((option) => option.model)).toEqual(["Pink Horror"]);
  });

  it("maps a repeated miniature name to the composition rows that name its stock", () => {
    const minis = [{ name: "Veteran", item: "Master Vox", max: 1 }, { name: "Veteran", item: "Regimental Standard", max: 1 }];
    const result = liftLoadout(dump(minis), "ds", resolve, rows("Veteran (Regimental Standard)", "Veteran (Master Vox)"));
    expect("loadout" in result && result.loadout.stock.map((row) => [row.model, row.items[0].id])).toEqual([
      ["Veteran (Master Vox)", "master-vox"],
      ["Veteran (Regimental Standard)", "regimental-standard"],
    ]);
  });

  it("refuses a refinement that is not one row per copy", () => {
    expect(refinedRows("Veteran", [["Vox"], ["Vox"]], new Set(["Veteran (Vox)", "Veteran (Banner)"]))).toBeNull();
    expect(refinedRows("Veteran", [["Vox"], ["Flag"]], new Set(["Veteran (Vox)", "Veteran (Banner)"]))).toBeNull();
    expect(refinedRows("Veteran", [["Vox"]], new Set(["Veteran (Vox)", "Veteran (Vox and Banner)"]))).toBeNull();
    const result = liftLoadout(dump([{ name: "Veteran", item: "Vox", max: 1 }, { name: "Veteran", item: "Vox", max: 1 }]), "ds", resolve, rows("Veteran (Vox)", "Veteran (Banner)"));
    expect("unresolvedModels" in result && result.unresolvedModels).toEqual(["Veteran#1", "Veteran#2"]);
  });

  it("lifts the units whose dump rows the composition names apart or caps at 0", () => {
    for (const [faction, id] of [
      ["astra-militarum", "krieg-command-squad"], ["leagues-of-votann", "brokhyr-iron-master"],
      ["chaos-daemons", "pink-horrors"], ["chaos-daemons", "blue-horrors"],
      ["thousand-sons", "pink-horrors"], ["thousand-sons", "blue-horrors"],
      ["adeptus-astartes", "vanguard-veteran-squad-with-jump-packs"],
    ]) expect(() => rulesOf(faction, id), `${faction}/${id}`).not.toThrow();
    const rules = rulesOf("adeptus-astartes", "vanguard-veteran-squad-with-jump-packs");
    // Combat shields are a unit-wide choice: every model's pistol, or none.
    const pistol = "heavy-bolt-pistol-vanguard-veteran-squad-with-jump-packs";
    expect(legal(rules, unit(rules, {}, [[pistol, "combat-shield", 5]]))).toBe(true);
    expect(legal(rules, unit(rules, {}, [[pistol, "combat-shield", 1]]))).toBe(false);
  });
});
