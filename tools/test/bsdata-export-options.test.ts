/**
 * An ability that picks one of several named options lists each option as an Abilities profile
 * of its own after the ability, as BSData does: a choice named by `option_names`, or a stance
 * select whose options carry names. An ability a unit links to a wargear item prints on the
 * item's entry, as BSData's do.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { RAW_DATA } from "../src/data/bundle.generated.js";
import { buildExport, type ExportedDocument } from "../src/bsdata-export/export.js";
import { namedOptions } from "../src/bsdata-export/ability-options.js";
import { children, str, walk, type BsNode } from "../src/bsdata-export/source.js";
import { factionCatalogue } from "./bsdata-export-fixture.js";

const dataset = Dataset.embedded();
/** Exported unit/model entry name → its Abilities profiles, in order. */
let abilityProfiles: Map<string, BsNode[]>;
let documents: ExportedDocument[];

function description(profile: BsNode): string {
  return String(children(profile, "characteristics").find((c) => c.name === "Description")?.$text ?? "");
}

beforeAll(() => {
  abilityProfiles = new Map();
  documents = buildExport({ version: "1.5.1", dataset });
  for (const doc of documents) {
    const kind = Object.keys(doc.document)[0];
    for (const { node, kind: nodeKind } of walk(Object.values(doc.document)[0] as BsNode, kind)) {
      if (nodeKind !== "selectionEntry" || (node.type !== "unit" && node.type !== "model")) continue;
      const profiles = children(node, "profiles").filter((p) => p.typeName === "Abilities");
      if (!abilityProfiles.has(String(node.name))) abilityProfiles.set(String(node.name), profiles);
    }
  }
}, 120_000);

function profilesAfter(unit: string, ability: string): BsNode[] {
  const profiles = abilityProfiles.get(unit);
  expect(profiles, unit).toBeDefined();
  const at = profiles!.findIndex((p) => p.name === ability);
  expect(at, `${unit} has ${ability}`).toBeGreaterThanOrEqual(0);
  return profiles!.slice(at + 1);
}

describe("exported named options", () => {
  it("lists each named choice option after its ability, each described as that option alone", () => {
    const after = profilesAfter("Abaddon the Despoiler", "Warmaster").slice(0, 3);
    expect(after.map((p) => p.name)).toEqual(["Paragon of Hatred", "Mark of Chaos Ascendant", "Lord of the Traitor Legions"]);
    const texts = after.map(description);
    expect(new Set(texts).size).toBe(3);
    // The option keeps the ability's timing: it is still the Command phase's pick.
    for (const text of texts) {
      expect(text).toContain("Command phase");
      expect(text).not.toContain("Select exactly");
    }
  });

  it("lists a stance's options even when one of them makes a choice of its own", () => {
    // Yarrick's Decisive Command picks one of three inside its stance option.
    const after = profilesAfter("Commissar Yarrick", "Hero of Hades Hive").slice(0, 3).map((p) => p.name);
    expect(after).toEqual(["Counterstrategist", "Decisive Command", "Inspiring Hero"]);
  });

  it("lists each named stance option after its ability", () => {
    const after = profilesAfter("Be'lakor", "Shadow Form Abilities").map((p) => p.name);
    expect(after).toEqual(expect.arrayContaining(["Wreathed in Shadows", "Pall of Despair", "Shadow Lord"]));
  });

  it("gives every option profile in the export a description of its own", () => {
    let options = 0;
    for (const ability of dataset.abilities.all) {
      const named = namedOptions(ability.raw as unknown as Record<string, unknown>);
      options += named.length;
      for (const option of named) expect(option.description, `${ability.id} ${option.name}`).not.toBe(ability.describe());
    }
    expect(options).toBeGreaterThan(30);
  });
});

describe("namedOptions", () => {
  const stance = (id: string) => ({ type: "stance-select", mode: "once", options: [
    { id: `${id}-a`, name: `${id} A`, effect: { type: "no-effect" } },
    { id: `${id}-b`, name: `${id} B`, effect: { type: "no-effect" } },
  ] });
  const choice = { type: "choice", options: [{ type: "no-effect" }, { type: "no-effect" }] };
  const base = { ability_id: "fixture", name: "Fixture", ability_type: "unit", scope: { duration: "permanent" } };

  it("names a choice only through option_names of the right length", () => {
    expect(namedOptions({ ...base, effect: choice }).map((o) => o.name)).toEqual([]);
    expect(namedOptions({ ...base, effect: choice, option_names: ["One"] })).toEqual([]);
    expect(namedOptions({ ...base, effect: choice, option_names: ["One", "Two"] }).map((o) => o.name)).toEqual(["One", "Two"]);
  });

  it("names a stance whose option holds an unnamed choice", () => {
    const nested = { ...stance("x"), options: [{ id: "x-a", name: "x A", effect: choice }, { id: "x-b", name: "x B", effect: { type: "no-effect" } }] };
    expect(namedOptions({ ...base, effect: nested }).map((o) => o.name)).toEqual(["x A", "x B"]);
  });

  it("refuses a record with two named menus rather than guess which", () => {
    expect(namedOptions({ ...base, effect: { type: "sequence", steps: [stance("x"), stance("y")] } })).toEqual([]);
    expect(namedOptions({ ...base, effect: { type: "sequence", steps: [stance("x"), choice] }, option_names: ["One", "Two"] })).toEqual([]);
  });
});

/** The unit entry `unitId` defines in `factionId`'s catalogue, and the upgrade entries its links reach. */
function exportedUnit(docs: readonly ExportedDocument[], ds: Dataset, factionId: string, unitId: string): { unit: BsNode; items: BsNode[] } {
  const catalogue = factionCatalogue(docs, factionId)!;
  const shared = children(catalogue, "sharedSelectionEntries");
  const view = ds.units.getInFaction(unitId, factionId)!;
  const unit = shared.find((e) => (e.type === "unit" || e.type === "model") && String(e.name).replace(/['’]/g, "") === view.name.replace(/['’]/g, ""))!;
  expect(unit, unitId).toBeDefined();
  const byId = new Map(shared.map((e) => [str(e, "id")!, e]));
  const items: BsNode[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const record = node as BsNode;
    const target = typeof record.targetId === "string" ? byId.get(record.targetId) : undefined;
    if (target?.type === "upgrade" && !items.includes(target)) items.push(target);
    Object.values(record).forEach(visit);
  };
  visit([unit.entryLinks, unit.selectionEntries, unit.selectionEntryGroups]);
  return { unit, items };
}

const abilityNames = (node: BsNode): string[] => children(node, "profiles").filter((p) => p.typeName === "Abilities").map((p) => String(p.name));

describe("exported wargear abilities", () => {
  it("prints a wargear item's ability on the item entry the unit links, not on the unit", () => {
    const { unit, items } = exportedUnit(documents, dataset, "adepta-sororitas", "battle-sisters-squad");
    const simulacrum = dataset.abilities.get("simulacrum-imperialis-adepta-sororitas")!.name;
    expect(abilityNames(unit)).not.toContain(simulacrum);
    const carriers = items.filter((item) => abilityNames(item).includes(simulacrum));
    // The item takes the printed capitalisation of its ability, as BSData names it.
    expect(carriers.map((item) => item.name)).toEqual(["Simulacrum Imperialis"]);
    // The unit's own abilities stay on the unit.
    expect(abilityNames(unit)).toContain(dataset.abilities.get("defenders-of-the-faith-adepta-sororitas")!.name);
  });

  it("gives an item that prints different abilities on different units an entry per set of abilities", () => {
    const shieldOf = (unitId: string): BsNode => {
      const shields = exportedUnit(documents, dataset, "adeptus-astartes", unitId).items.filter((item) => /^storm shield$/i.test(String(item.name)));
      expect(shields, unitId).toHaveLength(1);
      return shields[0];
    };
    const lieutenant = shieldOf("lieutenant");
    const veterans = shieldOf("deathwatch-veterans");
    expect(str(lieutenant, "id")).not.toBe(str(veterans, "id"));
    expect(abilityNames(lieutenant)).toEqual([dataset.abilities.get("storm-shield-adeptus-astartes")!.name]);
    expect(abilityNames(veterans)).toEqual([dataset.abilities.get("storm-shield-deathwatch")!.name]);
    // Both keep the weapon-free item's name, as BSData's several Storm Shields do.
    expect(lieutenant.name).toBe(veterans.name);
  });

  it("keeps a wargear ability on the unit when no selection offers its item", () => {
    // Battle Sisters can't take a storm shield; the ability it would print has no entry to go on.
    const shield = "storm-shield-adeptus-astartes";
    const ds = new Dataset({
      ...RAW_DATA,
      units: RAW_DATA.units.map((u) =>
        u.id === "battle-sisters-squad" && u.faction_id === "adepta-sororitas" ? { ...u, ability_ids: [...(u.ability_ids ?? []), { id: shield, wargear: "storm-shield" }] } : u),
    } as typeof RAW_DATA);
    const { unit, items } = exportedUnit(buildExport({ version: "1.5.1", dataset: ds }), ds, "adepta-sororitas", "battle-sisters-squad");
    const name = ds.abilities.get(shield)!.name;
    expect(abilityNames(unit)).toContain(name);
    expect(items.some((item) => abilityNames(item).includes(name))).toBe(false);
    // The squad's offered Simulacrum still prints its ability on its item.
    expect(abilityNames(unit)).not.toContain(ds.abilities.get("simulacrum-imperialis-adepta-sororitas")!.name);
  }, 120_000);
});
