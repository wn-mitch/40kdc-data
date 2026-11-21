/**
 * Weapon profiles in the BSData export read as BSData printed them: every
 * keyword condition the dataset records survives into the Keywords column, and
 * each profile of a multi-profile weapon names its weapon.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { buildExport } from "../src/bsdata-export/export.js";
import { keywordLabel, weaponProfileName } from "../src/bsdata-export/items.js";
import { children, walk, type BsNode } from "../src/bsdata-export/source.js";

const dataset = Dataset.embedded();
const WEAPON_TYPES = new Set(["Ranged Weapons", "Melee Weapons"]);

/** Exported entries that carry weapon profiles: entry name → its weapon profiles. */
let weaponEntries: Map<string, BsNode[]>;

function keywordsOf(profile: BsNode): string {
  const keywords = children(profile, "characteristics").find((c) => c.name === "Keywords");
  return String(keywords?.$text ?? "");
}

beforeAll(() => {
  weaponEntries = new Map();
  for (const doc of buildExport({ version: "1.5.1", dataset })) {
    const kind = Object.keys(doc.document)[0];
    for (const { node, kind: nodeKind } of walk(Object.values(doc.document)[0] as BsNode, kind)) {
      if (nodeKind !== "selectionEntry") continue;
      const profiles = children(node, "profiles").filter((p) => WEAPON_TYPES.has(String(p.typeName)));
      if (profiles.length > 0 && !weaponEntries.has(String(node.name))) weaponEntries.set(String(node.name), profiles);
    }
  }
}, 120_000);

describe("keywordLabel", () => {
  it.each([
    ["Lethal Hits", undefined, "Lethal Hits"],
    ["Rapid Fire", { value: 2 }, "Rapid Fire 2"],
    ["Anti", { target_keyword: "Infantry", threshold: 4 }, "Anti-Infantry 4+"],
    ["Hunter", { target_keyword: "Monster" }, "Hunter: Monster"],
    ["Devastating Wounds", { required_target_keywords_any: ["Psyker"] }, "Devastating Wounds: Psyker"],
    ["Devastating Wounds", { required_target_keywords_any: ["Monster", "Vehicle"] }, "Devastating Wounds: Monster/Vehicle"],
    ["Lethal Hits", { excluded_target_keywords: ["Monster", "Vehicle"] }, "Lethal Hits: non-Monster/Vehicle"],
    ["Sustained Hits", { value: 1, excluded_target_keywords: ["Monster", "Vehicle"] }, "Sustained Hits 1: non-Monster/Vehicle"],
    ["Sustained Hits", { value: 2, required_target_keywords_any: ["Monster", "Vehicle"] }, "Sustained Hits 2: Monster/Vehicle"],
    ["Anti", { threshold: 3, excluded_target_keywords: ["Monster", "Vehicle"] }, "Anti-non-Monster/Vehicle 3+"],
  ])("%s %j → %s", (name, parameters, expected) => {
    expect(keywordLabel(name, parameters as Record<string, unknown> | undefined)).toBe(expected);
  });

  it("keeps every parameter of every dataset weapon keyword", () => {
    const dropped: string[] = [];
    for (const weapon of dataset.weapons.all) {
      weapon.raw.profiles.forEach((_, index) => {
        for (const { keyword, parameters } of weapon.keywordsAt(index)) {
          if (!parameters) continue;
          const label = keywordLabel(keyword.name, parameters);
          const parts = Object.values(parameters).flatMap((v) => (Array.isArray(v) ? v : [v]));
          const missing = parts.filter((v) => v !== null && v !== undefined && !label.includes(String(v)));
          if (missing.length > 0) dropped.push(`${weapon.id} ${label} lacks ${missing.join(", ")}`);
        }
      });
    }
    expect(dropped.slice(0, 10)).toEqual([]);
  });
});

describe("exported weapon profiles", () => {
  it("print a conditional keyword with its condition", () => {
    const greatblade = weaponEntries.get("Executioner greatblade") ?? weaponEntries.get("Executioner Greatblade");
    expect(greatblade).toBeDefined();
    expect(keywordsOf(greatblade![0])).toContain("Devastating Wounds: Psyker");
  });

  it("name the weapon on each profile of a multi-profile weapon", () => {
    let checked = 0;
    const bare: string[] = [];
    for (const weapon of dataset.weapons.all) {
      if (weapon.raw.profiles.length < 2) continue;
      const exported = weaponEntries.get(weapon.name);
      if (!exported || exported.length !== weapon.raw.profiles.length) continue;
      checked++;
      for (const p of exported) {
        const name = String(p.name);
        if (!name.startsWith("➤ ") || !name.toLowerCase().includes(weapon.name.toLowerCase())) bare.push(`${weapon.id}: ${name}`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(bare.slice(0, 10)).toEqual([]);
  });

  it("leave a one-profile weapon's profile name as it is", () => {
    expect(weaponProfileName("Bolt pistol", "Bolt pistol", 1)).toBe("Bolt pistol");
    expect(weaponProfileName("Eradication ray", "Focused", 2)).toBe("➤ Eradication ray - Focused");
    expect(weaponProfileName("Plasma gun", "Plasma gun - supercharge", 2)).toBe("➤ Plasma gun - supercharge");
  });
});
