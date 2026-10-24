import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { sentenceSegments } from "../src/semantic-authoring/compile-segments.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";

/**
 * Effects on the units a filter names while they carry a designation, a menu those units hold
 * ("that unit has the effect of your chosen Hex"), and the parts a record with a deployment-time
 * menu splits into. Every text here is fabricated wording, not rules text.
 */

type Item = [string, string, Record<string, unknown>, number?];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, pinned]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = pinned ?? currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function mechanicsOf(text: string, ...items: Item[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, any>;
}

const ajv = createValidator();
const effectOk = ajv.getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
const MARKED = { owner: "enemy", designated: "afflicted" };

const persistent: Item[] = [
  ["Until the end of the battle", "duration", { endpoint: "end-of-battle" }],
  ["enemy unit", "unit-filter", { side: "enemy" }],
  ["Marked", "designated-filter", { tag: "afflicted" }],
  ["subtract 1 from the Toughness characteristic of models in that unit", "characteristic-modifier", { subject: "antecedent", characteristics: ["T"], operation: "subtract", value: 1, weapon_type: "all" }],
];

describe("an effect on the units a filter names while they carry a designation", () => {
  it("narrows the filter by the designation instead of refusing the filter", () => {
    const text = "Until the end of the battle, while an enemy unit is Marked, subtract 1 from the Toughness characteristic of models in that unit.";
    const mechanics = mechanicsOf(text, ...persistent);
    expect(mechanics.effect).toEqual({ type: "stat-modifier", target: MARKED, modifier: { stat: "T", operation: "subtract", value: 1 } });
    expect(mechanics.scope).toEqual({ duration: "battle" });
  });
});

describe("a menu the units of a filter hold", () => {
  const text = "At the start of the battle, select one of the Hexes below. Until the end of the battle, while an enemy unit is Marked, "
    + "subtract 1 from the Toughness characteristic of models in that unit, and that unit has the effect of your chosen Hex. "
    + "Hex of Rust: Each time a model in this unit makes a ranged attack, enemy units have the benefit of cover against the attack. "
    + "Hex of Lead: Worsen the Move characteristic of models in this unit by 1.";
  const items: Item[] = [
    ["At the start of the battle", "event", { kind: "battle-formations-declared" }],
    ["select one of the Hexes below", "choice-open", { choice_label: "hex", min_choices: 1, max_choices: 1 }],
    ...persistent,
    ["that unit has the effect of your chosen Hex", "chosen-option-grant", { holder: "antecedent" }],
    ["Hex of Rust", "named-option", { label: "Hex of Rust" }],
    ["Each time a model in this unit makes a ranged attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
    ["enemy units have the benefit of cover against the attack", "core-ability-grant", { subject: "target", ability: "benefit-of-cover" }],
    ["Hex of Lead", "named-option", { label: "Hex of Lead" }],
    ["Worsen the Move characteristic of models in this unit by 1", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "worsen", value: 1, weapon_type: "all" }],
  ];

  it("gives every option to the designated units, and keeps the sentence that grants them out of the options", () => {
    const effect = mechanicsOf(text, ...items).effect;
    expect(effectOk(effect), JSON.stringify(effectOk.errors)).toBe(true);
    const [choice, toughness] = effect.steps;
    // The leading sentence is not a third option, and its own effect stays beside the menu.
    expect(choice.options).toHaveLength(2);
    expect(toughness).toEqual({ type: "stat-modifier", target: MARKED, modifier: { stat: "T", operation: "subtract", value: 1 } });
    // Before the holder bound to the filter, each option stayed on the record's own unit.
    expect(choice.options[1]).toEqual({ type: "stat-modifier", target: MARKED, modifier: { stat: "M", operation: "worsen", value: 1 } });
    // An option's own attacks are the holder's: the attack-type gate names them as the attacker.
    expect(choice.options[0]).toEqual({
      type: "conditional",
      condition: { operator: "and", operands: [{ type: "attack-is", parameters: { attack_type: "ranged" } }, { type: "matches", parameters: { filter: MARKED, subject: "attacker" } }] },
      effect: { type: "ability-grant", target: "defender", modifier: { ability: "benefit-of-cover" } },
    });
  });
});

describe("a record with an aura and a deployment-time menu", () => {
  const text = "While an enemy unit is within 6\" of this model, it is Marked.\n**Hexes**\n"
    + "During the Declare Battle Formations step, select one of the Hexes below. Until the end of the battle, while an enemy unit is Marked, "
    + "subtract 1 from the Toughness characteristic of models in that unit, and that unit has the effect of your chosen Hex.\n"
    + "**Hex of Rust**\nEach time a model in this unit makes a ranged attack, enemy units have the benefit of cover against the attack.\n"
    + "**Hex of Lead**\nWorsen the Move characteristic of models in this unit by 1.";
  const leaves = placed(text,
    ["enemy unit", "unit-filter", { side: "enemy" }],
    ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
    ["it is Marked", "apply-mark", { subject: "antecedent", tag: "afflicted" }],
    ["During the Declare Battle Formations step", "event", { kind: "battle-formations-declared" }],
    ["select one of the Hexes below", "choice-open", { choice_label: "hex", min_choices: 1, max_choices: 1 }],
    ...persistent,
    ["that unit has the effect of your chosen Hex", "chosen-option-grant", { holder: "antecedent" }],
    ["Hex of Rust", "named-option", { label: "Hex of Rust" }],
    ["Each time a model in this unit makes a ranged attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
    ["enemy units have the benefit of cover against the attack", "core-ability-grant", { subject: "target", ability: "benefit-of-cover" }],
    ["Hex of Lead", "named-option", { label: "Hex of Lead" }],
    ["Worsen the Move characteristic of models in this unit by 1", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "worsen", value: 1, weapon_type: "all" }],
  );

  it("splits at the deployment moment past a bold heading, and not at an option's own moment", () => {
    const parts = sentenceSegments(leaves, text);
    expect(parts?.map((part) => part.map((leaf) => leaf.family_id)[0])).toEqual(["unit-filter", "event"]);
    expect(parts![1]!.some((leaf) => leaf.family_id === "attack")).toBe(true);
  });

  it("compiles the aura and the menu as two parts", () => {
    const result = compileLeaves(leaves, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const [aura, menu] = (result.mechanics.effect as Record<string, any>).steps;
    expect(aura.type).toBe("aura");
    expect(menu).toMatchObject({ type: "ability-part", trigger: { event: "battle-formations-declared" }, duration: "battle" });
    expect(menu.effect.steps[0].options).toHaveLength(2);
  });
});

describe("core-ability-grant@5", () => {
  it("names the attack's target as the recipient and keeps earlier subjects", () => {
    expect(normalizeFingerprintParameters("core-ability-grant", { subject: "target", ability: "benefit-of-cover" }, 5)).toEqual({ subject: "target", ability: "benefit-of-cover" });
    expect(() => normalizeFingerprintParameters("core-ability-grant", { subject: "target", ability: "benefit-of-cover" }, 4)).toThrow();
    expect(normalizeFingerprintParameters("core-ability-grant", { subject: "this-unit", ability: "stealth" }, 5))
      .toEqual(normalizeFingerprintParameters("core-ability-grant", { subject: "this-unit", ability: "stealth" }, 4));
  });
});
