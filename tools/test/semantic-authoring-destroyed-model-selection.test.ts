import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/index.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-thorn-volley", name: "Thorn Volley" });

const TEXT = "Until the end of the phase, melee weapons equipped by models in your unit have the [LETHAL HITS] ability. If one or more enemy models are destroyed as the result of attacks made by those weapons this phase, select one of those destroyed models; that destroyed model's unit must take a Battle-shock test.";
const HEAD: Item[] = [
  ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
  ["melee weapons equipped by models in your unit have the", "weapon-ability-grant", { subject: "this-unit", weapon_type: "melee" }],
  ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
  ["one or more enemy models", "unit-filter", { side: "enemy", level: "model" }],
  ["are destroyed as the result of", "unit-activity", { activities: ["destroyed-models-by-triggering-attacks"], negated: false, named: "before", container: "none", destroyer: "this-unit" }],
  ["attacks made by those weapons this phase", "event", { kind: "attacks-resolved", subject: "this-unit", attack_type: "melee" }],
  ["select one", "select-unit", { scope: "enemy", distance: "any", visible: false }],
];
const AMONG: Item = ["of those destroyed models", "destroyed-model-selection", { destroyer: "this-unit" }];
const TEST: Item = ["must take a Battle-shock test", "test", { target: "selected-unit", test: "battle-shock" }];

describe("a selection among the destroyed models' units", () => {
  it("selects one unit that lost a model to the triggering attacks, which takes the test", () => {
    const result = run(TEXT, ...HEAD, AMONG, TEST);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const part = (result.mechanics.effect as Record<string, any>).steps[1];
    expect(part).toMatchObject({ type: "ability-part", trigger: { event: "attacks-resolved" } });
    // The destruction gate restates the selection's own requirement, so it is not kept beside it.
    expect(part.effect).toEqual({ type: "select-units", selector: { filter: { owner: "enemy" }, count: { min: 1, max: 1 },
      eligibility: { type: "happened", parameters: { event: "model-destroyed", object: { level: "model", member_of: "selected-unit" }, filter: { by: "this-unit" }, window: "event" } } },
      effect: { type: "test", target: "selected-unit", modifier: { test: "battle-shock" } } });
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(result.mechanics.effect), JSON.stringify(validate?.errors)).toBe(true);
    expect(describeAbility(result.mechanics as never)).toContain("Select one enemy unit that lost 1+ models to the just-resolved attacks: that unit must take a Battle-shock test.");
  });

  it("selects once after the gated attacks resolve: the per-attack gate's target conditions limit the selected unit", () => {
    const text = "Until the end of the phase, each time a model in your unit makes a ranged attack that targets an enemy unit within 6\" that is also within range of an objective marker, add 1 to the Wound roll. If one or more enemy models are destroyed as the result of those attacks, select one of those destroyed models; that destroyed model's unit must take a Battle-shock test.";
    const result = run(text,
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["model in your unit makes a ranged attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\"", "unit-position", { kind: "within", inches: 6, of: "attacker", subject: "target", negated: false }],
      ["within range of an objective marker", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "target", negated: false }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
      ["one or more enemy models", "unit-filter", { side: "enemy", level: "model" }],
      ["are destroyed as the result of", "unit-activity", { activities: ["destroyed-models-by-triggering-attacks"], negated: false, named: "before", container: "none", destroyer: "this-unit" }],
      ["those attacks", "event", { kind: "attacks-resolved", subject: "this-unit", attack_type: "ranged" }],
      ["select one", "select-unit", { scope: "enemy", distance: "any", visible: false }], AMONG, TEST);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const [gated, part] = (result.mechanics.effect as Record<string, any>).steps;
    // The Wound roll changes per attack, under the gate; the selection is made once, outside it.
    expect(gated).toMatchObject({ type: "conditional", effect: { type: "roll-modifier" } });
    expect(part).toMatchObject({ type: "ability-part", trigger: { event: "attacks-resolved", filter: { attack_type: "ranged" } } });
    expect(part.effect.selector.eligibility.operands.slice(1)).toEqual([
      { type: "matches", parameters: { subject: "selected-unit", filter: { within: { of: "this-unit", range: { inches: 6 } } } } },
      { type: "matches", parameters: { subject: "selected-unit", filter: { within: { of: { objective: {} }, range: "objective-control" } } } },
    ]);
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(result.mechanics.effect), JSON.stringify(validate?.errors)).toBe(true);
  });

  it("refuses a destroyed-model-selection with no select-unit before it", () => {
    const lone = run("If one of those destroyed models is near, its unit must take a Battle-shock test.", ["of those destroyed models", "destroyed-model-selection", { destroyer: "this-unit" }], ["must take a Battle-shock test", "test", { target: "this-unit", test: "battle-shock" }]);
    expect(lone.ok ? "" : lone.errors.join(" ")).toContain("limits the select-unit right before it");
  });
});
