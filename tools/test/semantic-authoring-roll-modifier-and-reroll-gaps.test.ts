import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { familyExtension } from "../src/semantic-authoring/families/index.js";
import { createValidator } from "../src/schema-loader.js";

/** The family versions the extensions under test create. */
const ROLL_MODIFIER_AND_REROLL_GAPS_VERSIONS: ReadonlySet<string> = new Set(["roll-modifier@10"]);

type Item = [string, string, Record<string, unknown>];

/** The version of `family` this file's extension defines, found by its extension (later ones may sit above it). */
function extendedVersion(family: string): number {
  for (let version = currentFamilyVersion(family); version > 1; version -= 1) {
    const extension = familyExtension(family, version);
    if (extension !== undefined && ROLL_MODIFIER_AND_REROLL_GAPS_VERSIONS.has(`${extension.family}@${extension.version}`)) return version;
  }
  throw new Error(`The extension of ${family} is not registered.`);
}

/** Leaves placed by their wording in `text`, in order, each at its family's current version (fabricated wording). */
function compile(text: string, items: Item[]) {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  const leaves: CompileLeaf[] = items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
  return compileLeaves(leaves, text);
}

const DEMISE_TEXT = "Set the threshold of Deadly Demise to 4+. Add 1 to the Deadly Demise roll if it is a BEACON unit.";
const demiseItems = (modifier: Record<string, unknown>): Item[] => [
  ["Set the threshold of Deadly Demise to 4+", "ability-modifier", { subject: "this-unit", ability: "deadly-demise", aspect: "threshold", operation: "set", value: 4 }],
  ["Add 1 to the Deadly Demise roll", "roll-modifier", modifier],
  ["if it is a BEACON unit", "unit-keyword", { keywords: ["BEACON"], subject: "this-unit", negated: false }],
];
const demiseLeaf = { roll: "deadly-demise", operation: "add", value: 1 };

describe("roll-modifier roll deadly-demise", () => {
  it("is accepted at the extension's version and refused at the one before", () => {
    const version = extendedVersion("roll-modifier");
    expect(normalizeFingerprintParameters("roll-modifier", demiseLeaf, version)).toEqual(demiseLeaf);
    expect(() => normalizeFingerprintParameters("roll-modifier", demiseLeaf, version - 1)).toThrow();
    expect(normalizeFingerprintParameters("roll-modifier", demiseLeaf, currentFamilyVersion("roll-modifier"))).toEqual(demiseLeaf);
  });

  it("keeps every roll and form the previous version accepted", () => {
    const version = extendedVersion("roll-modifier");
    const accepted: Record<string, unknown>[] = [
      ...["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage", "hazard", "psychic", "desperate-escape"]
        .map((roll) => ({ roll, operation: "add", value: 1 })),
      { roll: "hit", operation: "subtract", value: 1, weapon_type: "melee" },
      { rolls: ["advance", "charge"], operation: "add", value: 1 },
      { roll: "preceding", operation: "add", value: 1 },
      { roll: { ability: "fizzle-rite" }, operation: "add", value: 1 },
      { roll: "charge", operation: "subtract", value: 2, subject: "event-subject" },
    ];
    for (const leaf of accepted) expect(normalizeFingerprintParameters("roll-modifier", leaf, version), JSON.stringify(leaf)).toEqual(leaf);
  });

  it("refuses a weapon scope, a rolls list, or a missing operation beside the Deadly Demise roll", () => {
    const version = currentFamilyVersion("roll-modifier");
    expect(() => normalizeFingerprintParameters("roll-modifier", { ...demiseLeaf, weapon_type: "melee" }, version)).toThrow(/weapon/u);
    expect(() => normalizeFingerprintParameters("roll-modifier", { ...demiseLeaf, rolls: ["hit", "wound"] }, version)).toThrow();
    expect(() => normalizeFingerprintParameters("roll-modifier", { roll: "deadly-demise", value: 1 }, version)).toThrow();
    expect(() => normalizeFingerprintParameters("roll-modifier", { ...demiseLeaf, roll: "deadly-demise-d3" }, version)).toThrow();
  });

  it("lowers a conditional bonus on the roll after the threshold, and the DSL validates it", () => {
    const result = compile(DEMISE_TEXT, demiseItems(demiseLeaf));
    if (!result.ok) throw new Error(result.errors.join("; "));
    const mechanics = result.mechanics as unknown as Record<string, any>;
    const json = JSON.stringify(mechanics);
    expect(json).toContain('"roll":"deadly-demise"');
    expect(json).toContain('"operation":"add"');
    expect(json).toContain("BEACON");
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
    const effects: Record<string, any>[] = [];
    const walk = (node: any): void => {
      if (node === null || typeof node !== "object") return;
      if (node.type === "roll-modifier") effects.push(node);
      Object.values(node).forEach(walk);
    };
    walk(mechanics);
    expect(effects).toHaveLength(1);
    expect(effects[0]!.modifier).toMatchObject({ roll: "deadly-demise", operation: "add", value: 1 });
    expect(validate(effects[0])).toBe(true);
  });

  it("still refuses the preceding-roll form when no roll comes before it", () => {
    const result = compile(DEMISE_TEXT, demiseItems({ roll: "preceding", operation: "add", value: 1 }));
    expect(result.ok).toBe(false);
  });
});
