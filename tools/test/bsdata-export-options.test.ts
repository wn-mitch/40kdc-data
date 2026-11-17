/**
 * An ability that picks one of several named options lists each option as an Abilities profile
 * of its own after the ability, as BSData does: a choice named by `option_names`, or a stance
 * select whose options carry names.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { buildExport } from "../src/bsdata-export/export.js";
import { namedOptions } from "../src/bsdata-export/ability-options.js";
import { children, walk, type BsNode } from "../src/bsdata-export/source.js";

const dataset = Dataset.embedded();
/** Exported unit/model entry name → its Abilities profiles, in order. */
let abilityProfiles: Map<string, BsNode[]>;

function description(profile: BsNode): string {
  return String(children(profile, "characteristics").find((c) => c.name === "Description")?.$text ?? "");
}

beforeAll(() => {
  abilityProfiles = new Map();
  for (const doc of buildExport({ version: "1.5.1", dataset })) {
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
    const after = profilesAfter("Be’lakor", "Shadow Form Abilities").map((p) => p.name);
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
