import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";

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
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-independent-pair" });

function effectOf(text: string, ...items: Item[]): Record<string, any> {
  const result = run(text, ...items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect as Record<string, any>;
}

function errorsOf(text: string, ...items: Item[]): string {
  const result = run(text, ...items);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.errors.join(" ");
}

const TEXT = "Select one friendly ALPHA unit within 6 inches of this model and one enemy BRAVO unit visible to this model. Until the end of the phase, weapons equipped by models in that friendly unit have the Fabricated Keyword 1 ability while targeting that enemy unit.";
const FRIENDLY: Item = ["Select one", "select-unit", { distance: "any", visible: false, bind_as: "alpha-unit" }];
const ALPHA: Item = ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }];
const NEAR: Item = ["within 6 inches of this model", "aura-range", { inches: 6, of: "this-model" }];
const ENEMY: Item = ["and one", "select-unit", { distance: "any", visible: false, bind_as: "bravo-unit" }];
const BRAVO: Item = ["enemy BRAVO unit", "unit-filter", { side: "enemy", keywords: ["BRAVO"] }];
const SEEN: Item = ["visible to this model", "visible", { subject: "antecedent", to: "this-model" }];
const DURATION: Item = ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }];
const GRANT: Item = ["weapons equipped by models in that friendly unit have the", "weapon-ability-grant", { subject: "antecedent", weapon_type: "all" }];
const KEYWORD: Item = ["Fabricated Keyword 1", "weapon-ability-keyword", { keyword: "Sustained Hits 1" }];
const TARGETING: Item = ["while targeting that enemy unit", "target-is-selected", {}];
const PAIR: Item[] = [FRIENDLY, ALPHA, NEAR, ENEMY, BRAVO, SEEN, DURATION, GRANT, KEYWORD, TARGETING];

const EXPECTED = {
  type: "select-units",
  selector: { filter: { owner: "friendly", all_of: ["ALPHA"], within: { range: { inches: 6 }, of: "this-model" } }, count: { min: 1, max: 1 }, bind_as: "alpha-unit" },
  effect: {
    type: "designate-target",
    designation: "selected-unit",
    select: { kind: "unit", selector: { filter: { owner: "enemy", all_of: ["BRAVO"] }, count: { min: 1, max: 1 }, eligibility: { type: "matches", parameters: { subject: "selected-unit", filter: { visible: { to: "this-model" } } } }, bind_as: "bravo-unit" } },
    applies: {
      to: "bound-unit-attacks-reference",
      beneficiary: { selection_var: "alpha-unit" },
      reference: { selection_var: "bravo-unit" },
      effect: { type: "weapon-ability-grant", target: { selection_var: "alpha-unit" }, modifier: { keywords: [{ keyword_id: "sustained-hits", parameters: { value: 1 } }] } },
    },
    duration: "phase",
  },
};

describe("Semantic authoring independent selection pair: a friendly recipient and an enemy attack target", () => {
  it("wraps a designation of the enemy unit in the friendly selection and binds both names", () => {
    const effect = effectOf(TEXT, ...PAIR);
    expect(effect).toEqual(EXPECTED);
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(effect), JSON.stringify(validate?.errors)).toBe(true);
  });

  it("takes the roles from the sides, not from the order of the selections", () => {
    const text = "Select one enemy BRAVO unit visible to this model and one friendly ALPHA unit within 6 inches of this model. Until the end of the phase, weapons equipped by models in that friendly unit have the Fabricated Keyword 1 ability while targeting that enemy unit.";
    const effect = effectOf(text,
      ["Select one", "select-unit", { distance: "any", visible: false, bind_as: "bravo-unit" }], BRAVO, SEEN,
      ["and one", "select-unit", { distance: "any", visible: false, bind_as: "alpha-unit" }], ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }], NEAR,
      DURATION, GRANT, KEYWORD, TARGETING);
    expect(effect).toEqual(EXPECTED);
  });

  it("scopes the friendly unit's attack frame the same way (an attack-scope leaf in place of the grant)", () => {
    const text = "Select one friendly ALPHA unit within 6 inches of this model and one enemy BRAVO unit visible to this model. That friendly unit's attacks that target that enemy unit have the Fabricated Keyword 1 ability until the end of the phase.";
    const effect = effectOf(text, FRIENDLY, ALPHA, NEAR, ENEMY, BRAVO, SEEN,
      ["That friendly unit's attacks", "weapon-property-scope", { subject: "antecedent", weapon_type: "all" }],
      ["that target that enemy unit", "target-is-selected", {}],
      ["Fabricated Keyword 1", "weapon-ability-keyword", { keyword: "Sustained Hits 1" }],
      ["until the end of the phase", "duration", { endpoint: "end-of-phase" }]);
    expect(effect.applies?.to ?? effect.effect.applies.to).toBe("bound-unit-attacks-reference");
    expect(JSON.stringify(effect)).not.toContain('"selected-unit","modifier"');
  });

  const refusal = (...items: Item[]) => errorsOf(TEXT, ...items);
  const without = (...families: string[]) => PAIR.filter((item) => !families.includes(item[1]));
  const swap = (from: Item, to: Item) => PAIR.map((item) => item === from ? to : item);

  it("refuses two friendly selections and two enemy selections", () => {
    expect(refusal(...swap(BRAVO, ["enemy BRAVO unit", "unit-filter", { side: "friendly", keywords: ["BRAVO"] }]))).toContain("More than one unit is selected");
    expect(refusal(...swap(ALPHA, ["friendly ALPHA unit", "unit-filter", { side: "enemy", keywords: ["ALPHA"] }]))).toContain("More than one unit is selected");
  });

  it("refuses a model selection beside a unit selection", () => {
    expect(refusal(...swap(ALPHA, ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }]))).toContain("selects units");
  });

  it("refuses two selections when either binds no name, and two that bind the same name", () => {
    expect(refusal(...swap(FRIENDLY, ["Select one", "select-unit", { distance: "any", visible: false }]))).toContain("More than one unit is selected");
    expect(refusal(...swap(ENEMY, ["and one", "select-unit", { distance: "any", visible: false }]))).toContain("More than one unit is selected");
    expect(refusal(...swap(ENEMY, ["and one", "select-unit", { distance: "any", visible: false, bind_as: "alpha-unit" }]))).toContain("bind the same name");
  });

  it("refuses a selection that counts its own units, or names a quantity", () => {
    expect(refusal(...swap(FRIENDLY, ["Select one", "select-unit", { distance: "any", visible: false, bind_as: "alpha-unit", count: 2 }]))).toContain("takes one unit each");
    expect(refusal(...swap(FRIENDLY, ["Select one", "select-unit", { distance: "any", visible: false, bind_as: "alpha-unit", quantity: "any-number" }]))).toContain("takes one unit each");
  });

  it("refuses the pair when no leaf says the attacks target the enemy unit", () => {
    expect(refusal(...without("target-is-selected"))).toContain("needs a target-is-selected leaf");
  });

  it("refuses a target-is-selected leaf that carries its own parameters", () => {
    expect(refusal(...swap(TARGETING, ["while targeting that enemy unit", "target-is-selected", { by: "friendly-unit" }]))).toContain("with no parameters");
    expect(refusal(...swap(TARGETING, ["while targeting that enemy unit", "target-is-selected", { target: "that-unit" }]))).toContain("with no parameters");
  });

  it("refuses an effect on the units that is not a grant or an attack scope", () => {
    const text = `${TEXT} That unit suffers 1 mortal wound.`;
    expect(errorsOf(text, ...PAIR, ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]))
      .toContain("binds only attack grants to the friendly unit");
  });

  it("refuses the pair beside a for-each loop or a battle-round count", () => {
    expect(errorsOf(`Each unit. ${TEXT}`, ["Each", "for-each-unit-select", { scope: "friendly", distance: "any" }], ...PAIR)).toContain("for-each");
    expect(errorsOf(`${TEXT} Up to the current battle round number.`, ...PAIR, ["Up to the current battle round number", "count-by-battle-round", {}])).toContain("battle round");
  });

  it("leaves a single designated selection exactly as it compiled", () => {
    const text = "Select one enemy BRAVO unit visible to this model. Each time a friendly unit makes an attack that targets that unit, add 1 to the Hit roll.";
    expect(effectOf(text,
      ["Select one", "select-unit", { distance: "any", visible: false }], BRAVO, SEEN,
      ["Each time a friendly unit makes an attack that targets that unit", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any", target: "that-unit" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }])).toEqual({
      type: "designate-target",
      designation: "selected-unit",
      select: { kind: "unit", selector: { filter: { owner: "enemy", all_of: ["BRAVO"] }, count: { min: 1, max: 1 }, eligibility: { type: "matches", parameters: { subject: "selected-unit", filter: { visible: { to: "this-model" } } } } } },
      applies: { to: "attackers-of-target", effect: { type: "roll-modifier", target: { owner: "friendly" }, modifier: { roll: "hit", operation: "add", value: 1 } } },
    });
  });

  it("leaves a model and a unit bound by a measured pair as they compiled", () => {
    const text = "Select one friendly ALPHA model. Select one enemy BRAVO unit within 8 inches of that model. That unit suffers 1 mortal wound.";
    const effect = effectOf(text,
      ["Select one friendly", "select-unit", { distance: "any", visible: false, bind_as: "anchor" }],
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["Select one enemy", "select-unit", { distance: "within", inches: 8, visible: false, within_of: "anchor" }],
      ["BRAVO unit", "unit-filter", { side: "enemy", keywords: ["BRAVO"] }],
      ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]);
    expect(effect.selector).toMatchObject({ filter: { owner: "friendly", all_of: ["ALPHA"], level: "model" }, count: { min: 1, max: 1 }, bind_as: "anchor" });
    expect(effect.effect.selector.filter).toMatchObject({ within: { range: { inches: 8 }, of: { selection_var: "anchor" } } });
  });
});
