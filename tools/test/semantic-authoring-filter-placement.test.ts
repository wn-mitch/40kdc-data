import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { retargetMenu } from "../src/semantic-authoring/compile-activation.js";

// Fabricated wording only: the names, keywords and numbers are invented, and the sentence
// structure is what the compiler reads (the punctuation and joining words between leaves).

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((entry) => entry.ability_id === "control-edict-adeptus-mechanicus")!;

type Item = [wording: string, family: string, parameters: Record<string, unknown>];

/** Leaves on their own wording in `text`; a leaf may enclose the leaves after it (`until` ends its span later). */
function placed(text: string, items: Array<Item | [...Item, { until: string }]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, span]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    const end = span ? bytes.indexOf(Buffer.from(span.until, "utf8"), start) + Buffer.byteLength(span.until, "utf8") : start + Buffer.byteLength(wording, "utf8");
    from = start + Buffer.byteLength(wording, "utf8");
    const family_version = currentFamilyVersion(family);
    return { role: familyRole(family, family_version), family_id: family, family_version, parameters, start_byte: start, end_byte: end, fragment: "RAW_TEXT" };
  });
}

function compiled(text: string, items: Parameters<typeof placed>[1]) {
  const result = compileLeaves(placed(text, items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const check = checkEntry(entryWithMechanics(base, result.mechanics));
  expect(check.errors).toEqual([]);
  return { mechanics: result.mechanics as unknown as Record<string, any>, rendered: check.rendered_text! };
}

describe("Semantic authoring unit-filter placement", () => {
  it("gives an ability-modifier's uses to every model the filter after it names", () => {
    const text = "Add 1 to the number of Edicts each GLORB HERALD model from your army can proclaim, as printed on its card.";
    const { mechanics, rendered } = compiled(text, [
      ["Add 1 to the number of Edicts each", "ability-modifier", { subject: "filtered-units", ability: "herald-edicts", aspect: "uses", operation: "add", value: 1 }, { until: "on its card" }],
      ["GLORB HERALD model", "unit-filter", { side: "friendly", keywords: ["GLORB", "HERALD"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
    ]);
    expect(mechanics.effect).toEqual({
      type: "ability-modifier",
      target: { owner: "friendly", all_of: ["GLORB", "HERALD"], level: "model" },
      modifier: { ability: "herald-edicts", aspect: "uses", operation: "add", value: 1 },
    });
    expect(rendered).toContain("friendly GLORB HERALD models");
  });

  it("accepts filtered-units as an ability-modifier subject from version 7 and keeps earlier leaves", () => {
    const filtered = { subject: "filtered-units", ability: "herald-edicts", aspect: "uses", operation: "add", value: 1 };
    expect(normalizeFingerprintParameters("ability-modifier", filtered, 7)).toEqual(filtered);
    expect(() => normalizeFingerprintParameters("ability-modifier", filtered, 6)).toThrow();
    const own = { ...filtered, subject: "this-model" };
    expect(normalizeFingerprintParameters("ability-modifier", own, 7)).toEqual(normalizeFingerprintParameters("ability-modifier", own, 6));
  });

  it("narrows who attacks to the units a designation between the filter and the attack names", () => {
    const text = "While a GLORB unit from your army is under an Edict, each time a model in that unit makes an attack, re-roll a Hit roll of 1.";
    const { mechanics } = compiled(text, [
      ["GLORB unit", "unit-filter", { side: "friendly", keywords: ["GLORB"] }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["under an Edict", "designated-filter", { tag: "under-edict" }],
      ["each time a model in that unit makes an attack", "attack", { direction: "makes", unit: "that-unit", attack_type: "any" }],
      ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }],
    ]);
    // The designation is the attackers' own, not a free-standing condition about no unit in particular.
    expect(mechanics.effect).toEqual({
      type: "re-roll",
      target: { owner: "friendly", all_of: ["GLORB"], designated: "under-edict" },
      modifier: { roll: "hit", subset: "ones" },
    });
  });

  describe("holders a chosen-option-grant names after it", () => {
    const text = "At the start of the first battle round, you can select one Oath listed below. That Oath is active for friendly NECRONS units until the end of the battle. "
      + "**Oath of Fury** This unit's melee attacks have +1 to wound rolls. "
      + "**Oath of Haste** Friendly INFANTRY units have: When this unit is selected to make an advance move, that advance move does not prevent this unit from being eligible to start an action.";
    const leaves = (): Parameters<typeof placed>[1] => [
      ["At the start of the", "turn-start", { turn: "battle-round" }],
      ["first battle round", "battle-round", { min: 1, max: 1 }],
      ["you can", "optional-use", { who: "you" }],
      ["select one Oath listed below", "stance-select-open", { scope: "army", mode: "consumable", min_choices: 1, max_choices: 1 }],
      ["That Oath is active for", "chosen-option-grant", { holder: "antecedent" }],
      ["friendly NECRONS units", "unit-filter", { side: "friendly", keywords: ["NECRONS"] }],
      ["until the end of the battle", "duration", { endpoint: "end-of-battle" }],
      ["Oath of Fury", "named-option", { label: "Oath of Fury", option_id: "oath-of-fury" }],
      ["This unit's melee attacks", "attack", { direction: "makes", unit: "this-unit", attack_type: "melee" }],
      ["have +1 to wound rolls", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
      ["Oath of Haste", "named-option", { label: "Oath of Haste", option_id: "oath-of-haste" }],
      ["Friendly INFANTRY units", "unit-filter", { side: "friendly", keywords: ["INFANTRY"] }],
      ["have:", "ability-record-grant", { subject: "antecedent", printed: "unnamed" }],
      ["When this unit is selected to make an advance move", "event", { kind: "selected", move_types: ["advance"], to: "move" }],
      ["that advance move does not prevent this unit from being eligible to start an action", "eligibility-permission", { subject: "this-unit", activity: "start-action", allow: true, despite: ["advanced"] }],
    ];

    it("gives each option to the filter's units, the printed grant to the holders among its own units, and keeps the grant's own unit", () => {
      const { mechanics } = compiled(text, leaves());
      const options = JSON.stringify(mechanics.effect);
      const [fury, haste] = (findStance(mechanics.effect) as { options: Array<{ name: string; effect: any }> }).options;
      expect(fury!.name).toBe("Oath of Fury");
      expect(JSON.stringify(fury!.effect)).toContain('"target":{"owner":"friendly","all_of":["NECRONS"]}');
      expect(haste!.effect).toMatchObject({ type: "ability-grant", target: { owner: "friendly", all_of: ["NECRONS", "INFANTRY"] } });
      // Inside the granted rule, "this unit" is each unit it is granted to, not the Oath's holders.
      expect(JSON.stringify(haste!.effect.modifier.definition)).not.toContain("NECRONS");
      expect(JSON.stringify(haste!.effect.modifier.definition)).toContain('"target":"this-unit"');
      expect(options).not.toContain('"target":"this-unit","modifier":{"roll"');
    });

    it("narrows only keyword-only friendly filters to the holders, never an aura's or the enemy's units", () => {
      const holder = { owner: "friendly", all_of: ["NECRONS"] };
      const aura = { owner: "friendly", within: { of: "this-unit", range: 6 } };
      const enemy = { owner: "enemy", all_of: ["INFANTRY"] };
      expect(retargetMenu({ type: "x", target: aura }, holder)).toEqual({ type: "x", target: aura });
      expect(retargetMenu({ type: "x", target: enemy }, holder)).toEqual({ type: "x", target: enemy });
      expect(retargetMenu({ type: "x", target: { owner: "friendly" } }, holder)).toEqual({ type: "x", target: holder });
    });
  });
});

function findStance(node: unknown): unknown {
  if (node === null || typeof node !== "object") return undefined;
  if ((node as Record<string, unknown>).type === "stance-select") return node;
  for (const value of Object.values(node)) {
    const found = findStance(value);
    if (found) return found;
  }
  return undefined;
}
