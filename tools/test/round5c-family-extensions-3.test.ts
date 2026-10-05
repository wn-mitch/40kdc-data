import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/round5c/compile.js";
import type { CompileLeaf } from "../src/round5c/compile-fragments.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { mapToLatest } from "../src/round5c/family-versions.js";

// Fabricated wording only; no GW rule prose.

let at = 0;
function leaf(family_id: string, parameters: Record<string, unknown>, fragment?: string): CompileLeaf {
  const family_version = currentFamilyVersion(family_id);
  at += 10;
  return {
    role: familyRole(family_id, family_version), family_id, family_version, start_byte: at,
    parameters: normalizeFingerprintParameters(family_id, parameters, family_version), ...(fragment ? { fragment } : {}),
  };
}
const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
}
function compiled(leaves: CompileLeaf[]): Record<string, unknown> {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, unknown>;
}
const errors = (leaves: CompileLeaf[]) => {
  const result = compileLeaves(leaves);
  return result.ok ? [] : result.errors;
};
const first = (tree: unknown, type: string) => nodes(tree, (node) => node.type === type)[0];

const friendly = (keywords: string[], extra: Record<string, unknown> = {}) => leaf("unit-filter", { side: "friendly", keywords, ...extra });
const aura = () => leaf("aura-range", { inches: 6, of: "this-model" });

describe("Round 5C family extensions, third round", () => {
  it("keeps every earlier leaf of a widened family, which moves across unchanged", () => {
    for (const [family, parameters] of [
      ["core-ability-grant", { subject: "this-unit", ability: "scouts", value: 6 }],
      ["invulnerable-save", { subject: "this-model", threshold: 4 }],
      ["ability-record-grant", { subject: "this-unit", ability: "some-ability" }],
      ["event", { kind: "unit-destroyed" }],
      ["mortal-wounds", { recipient: "target", count: "D3" }],
      ["set-up", { subject: "this-unit", to: "battlefield", from: "strategic-reserves" }],
      ["characteristic-modifier", { subject: "this-unit", characteristics: ["S"], operation: "add", value: 1, weapon_type: "melee" }],
      ["characteristic-set", { subject: "this-model", characteristic: "M", value: 7 }],
      ["feel-no-pain", { subject: "this-unit", threshold: 5, against: "all" }],
    ] as const) {
      const version = currentFamilyVersion(family);
      expect(normalizeFingerprintParameters(family, parameters, version - 1), family).toEqual(normalizeFingerprintParameters(family, parameters, version));
      expect(mapToLatest(family, version - 1, parameters), family).toEqual({ family, version, parameters: normalizeFingerprintParameters(family, parameters, version) });
    }
  });

  describe("'that unit' after an aura is the unit the aura reaches", () => {
    it("binds an effect, mortal wounds and a condition to the aura's recipient, not the record's own unit", () => {
      const mechanics = compiled([
        friendly(["INFANTRY"]), aura(),
        leaf("unit-state", { states: ["battle-shocked"], subject: "antecedent", negated: true }),
        leaf("feel-no-pain", { subject: "antecedent", threshold: 5, against: "all" }),
      ]);
      expect(first(mechanics, "aura")).toMatchObject({ target: "friendly-within-aura", modifier: { range: 6, eligible: { required_keywords: ["INFANTRY"] } } });
      expect(first(mechanics, "feel-no-pain")).toMatchObject({ target: "recipient" });
      expect(JSON.stringify(mechanics)).toContain('"subject":"recipient"');
      const wounds = compiled([friendly(["INFANTRY"]), aura(), leaf("mortal-wounds", { recipient: "antecedent", count: "1" })]);
      expect(first(wounds, "mortal-wounds")).toMatchObject({ target: "recipient" });
    });

    it("still binds to the record's own unit without an aura, and refuses a family that cannot name the recipient", () => {
      expect(first(compiled([leaf("feel-no-pain", { subject: "antecedent", threshold: 5, against: "all" })]), "feel-no-pain")).toMatchObject({ target: "this-unit" });
      expect(errors([friendly(["INFANTRY"]), aura(), leaf("set-up", { subject: "antecedent", to: "strategic-reserves", from: "battlefield" })]).join(" "))
        .toMatch(/points back to the recipient/u);
    });

    it("leaves a selection first: 'that unit' after a selection inside an aura is the selected unit", () => {
      const mechanics = compiled([
        friendly(["INFANTRY"]), aura(),
        leaf("select-unit", { distance: "any", visible: false }), leaf("unit-filter", { side: "enemy" }),
        leaf("mortal-wounds", { recipient: "antecedent", count: "1" }),
      ]);
      expect(first(mechanics, "mortal-wounds")).toMatchObject({ target: "selected-unit" });
    });
  });

  describe("a unit-filter right before an effect names every unit it matches", () => {
    it("grants an ability to every friendly unit with the keywords, past a 'from your army'", () => {
      const mechanics = compiled([
        friendly(["ADEPTUS ASTARTES", "INFANTRY"]), leaf("unit-owner", { owner: "friendly" }),
        leaf("core-ability-grant", { subject: "antecedent", ability: "scouts", value: 6 }),
      ]);
      expect(first(mechanics, "ability-grant")).toMatchObject({ target: { owner: "friendly", all_of: ["ADEPTUS ASTARTES", "INFANTRY"] }, modifier: { ability: "scouts", value: 6 } });
      // The "from your army" is the filter's own wording, not a gate on this unit.
      expect(JSON.stringify(mechanics)).not.toContain("owned-by");
    });

    it("names models for a model-level filter, and keeps a filter after a selection on the selection", () => {
      const mechanics = compiled([friendly(["PSYKER"], { level: "model" }), leaf("invulnerable-save", { subject: "antecedent", threshold: 4 })]);
      expect(first(mechanics, "invulnerable-save")).toMatchObject({ target: { owner: "friendly", all_of: ["PSYKER"], level: "model" } });
      const selected = compiled([
        leaf("select-unit", { distance: "any", visible: false }), friendly(["INFANTRY"]),
        leaf("mortal-wounds", { recipient: "antecedent", count: "1" }),
      ]);
      expect(first(selected, "mortal-wounds")).toMatchObject({ target: "selected-unit" });
    });

    it("gives every property of an attack scope to the filter's units: \"Friendly X units' melee attacks have +1 A, +1 S and [LETHAL HITS]\"", () => {
      const mechanics = compiled([
        friendly(["WORLD EATERS"]), leaf("weapon-property-scope", { subject: "antecedent", weapon_type: "melee" }),
        leaf("characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }),
        leaf("characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 1 }),
        leaf("weapon-ability-keyword", { keyword: "Lethal Hits" }),
      ]);
      const text = JSON.stringify(mechanics);
      expect(text).not.toContain("filtered-units");
      expect(text.match(/"target":\{"owner":"friendly","all_of":\["WORLD EATERS"\]\}/gu)).toHaveLength(3);
    });

    it("refuses a filter and a 'from your army' that name different sides, and a family that cannot take a filter", () => {
      expect(errors([friendly(["INFANTRY"]), leaf("unit-owner", { owner: "enemy" }), leaf("feel-no-pain", { subject: "antecedent", threshold: 5, against: "all" })]).join(" "))
        .toMatch(/different sides/u);
      // A family that cannot take a filter's units refuses it.
      expect(errors([friendly(["INFANTRY"]), leaf("targeting-restriction", { subject: "antecedent", may: "cannot-target", kind: "shoot", weapon_type: "all" })]).join(" "))
        .toMatch(/cannot name|unit-filter needs/u);
    });
  });

  it("binds 'it' in an ability grant and an invulnerable save, and gives Lone Operative a range", () => {
    expect(normalize("core-ability-grant", { subject: "antecedent", ability: "stealth" })).toEqual({ subject: "antecedent", ability: "stealth" });
    expect(normalize("invulnerable-save", { subject: "antecedent", threshold: 4 })).toEqual({ subject: "antecedent", threshold: 4 });
    expect(normalize("core-ability-grant", { subject: "this-model", ability: "lone-operative", value: 9 })).toEqual({ subject: "this-model", ability: "lone-operative", value: 9 });
    expect(() => normalize("core-ability-grant", { subject: "this-model", ability: "lone-operative", value: "9\"" })).toThrow(/range in inches/u);
    expect(() => normalize("core-ability-grant", { subject: "this-model", ability: "stealth", value: 9 })).toThrow();
  });

  it("names who destroyed a unit and whose unit it was, and selects a unit to attack", () => {
    const mechanics = compiled([
      leaf("event", { kind: "unit-destroyed", by: "this-unit", object_owner: "enemy" }),
      leaf("regain-wounds", { subject: "this-unit", amount: "1" }),
    ]);
    expect(JSON.stringify(mechanics)).toContain('"event":"destroyed","subject":"this-unit","object":{"owner":"enemy"}');
    expect(() => normalize("event", { kind: "phase-start", phase: "fight", turn: "your", by: "this-unit" })).toThrow(/unit-destroyed only/u);
    const attack = compiled([leaf("event", { kind: "selected", to: "attack" }), leaf("regain-wounds", { subject: "this-unit", amount: "1" })]);
    expect(JSON.stringify(attack)).toContain('"filter":{"to":"attack"}');
  });

  it("limits a characteristic change to one named weapon or to the subject's models with keywords", () => {
    const named = compiled([leaf("characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "add", value: 1, weapon_type: "melee", weapon_name: "Force Sword" })]);
    expect(first(named, "stat-modifier")).toMatchObject({ target: "this-model", modifier: { stat: "A", weapon_type: "melee", weapon_name: "force sword" } });
    expect(() => normalize("characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "add", value: 1, weapon_type: "all", weapon_name: "force sword" })).toThrow(/melee or ranged/u);
    const models = compiled([leaf("characteristic-modifier", { subject: "this-unit", characteristics: ["T"], operation: "add", value: 1, weapon_type: "all", model_keywords: ["CHARACTER"] })]);
    expect(first(models, "stat-modifier")).toMatchObject({ target: { level: "model", member_of: "this-unit", all_of: ["CHARACTER"] } });
    expect(() => normalize("feel-no-pain", { subject: "this-model", threshold: 5, against: "all", model_keywords: ["CHARACTER"] })).toThrow(/models of a unit/u);
    const set = compiled([leaf("characteristic-set", { subject: "this-model", characteristic: "D", value: 2, weapon_type: "melee", weapon_name: "flail" })]);
    expect(first(set, "stat-modifier")).toMatchObject({ modifier: { stat: "D", operation: "set", value: 2, weapon_name: "flail" } });
  });

  it("inflicts any dice amount of mortal wounds, and sets a unit up near where it was destroyed beyond the Reserves limits", () => {
    expect(normalize("mortal-wounds", { recipient: "target", count: "2d3" })).toEqual({ recipient: "target", count: "2D3" });
    expect(normalize("mortal-wounds", { recipient: "target", count: "D3+1" })).toEqual({ recipient: "target", count: "D3+1" });
    expect(normalize("mortal-wounds", { recipient: "target", count: "D3" })).toEqual({ recipient: "target", count: "D3" });
    expect(() => normalize("mortal-wounds", { recipient: "target", count: "D4" })).toThrow();
    expect(() => normalize("mortal-wounds", { recipient: "nobody", count: "2D3" })).toThrow();
    const wounds = compiled([leaf("mortal-wounds", { recipient: "this-unit", count: "D3+1" })]);
    expect(first(wounds, "mortal-wounds")).toMatchObject({ modifier: { count: "D3+1" } });
    const setUp = compiled([leaf("set-up", { subject: "this-unit", to: "strategic-reserves", from: "battlefield", placement: "closest-to-destruction", ignore_limits: true })]);
    expect(first(setUp, "set-up")).toMatchObject({ modifier: { to: "strategic-reserves", placement: "closest-to-destruction", ignore_limits: true } });
    expect(() => normalize("set-up", { subject: "this-unit", to: "battlefield", ignore_limits: false })).toThrow(/true or absent/u);
  });
});

describe("Round 5C family extensions, third round: rolls and printed keywords", () => {
  const band = (from: number) => leaf("roll-result", { from });
  it("folds '+N to that roll' into the ability's own dice, so the band reads the changed result", () => {
    const mechanics = compiled([
      leaf("dice-roll", { dice: "D6" }), leaf("roll-modifier", { roll: "preceding", operation: "add", value: 1 }),
      band(4), leaf("mortal-wounds", { recipient: "this-unit", count: "1" }),
    ]);
    expect(first(mechanics, "dice-gated")).toMatchObject({ dice: "D6+1", threshold: 4 });
    expect(first(mechanics, "roll-modifier")).toBeUndefined();
    // A band only the changed roll can reach is no longer beyond the die.
    expect(errors([leaf("dice-roll", { dice: "D6" }), leaf("roll-modifier", { roll: "preceding", operation: "add", value: 1 }), band(7), leaf("mortal-wounds", { recipient: "this-unit", count: "1" })])).toEqual([]);
  });

  it("names the roll a test or roll event made, and refuses with no roll before it or a subtraction from dice", () => {
    // A condition between them keeps the change its own effect, naming the test's roll.
    const test = compiled([
      leaf("test", { target: "this-unit", test: "battle-shock" }),
      leaf("unit-state", { states: ["below-starting-strength"], subject: "this-unit", negated: false }),
      leaf("roll-modifier", { roll: "preceding", operation: "subtract", value: 1 }),
    ]);
    expect(first(test, "roll-modifier")).toMatchObject({ modifier: { roll: "battle-shock", operation: "subtract", value: 1 } });
    // Right after the test, the change is that test's own modifier.
    const folded = compiled([leaf("test", { target: "this-unit", test: "battle-shock" }), leaf("roll-modifier", { roll: "preceding", operation: "subtract", value: 1 })]);
    expect(first(folded, "test")).toMatchObject({ modifier: { test: "battle-shock", modifier: -1 } });
    expect(first(folded, "roll-modifier")).toBeUndefined();
    expect(errors([leaf("roll-modifier", { roll: "preceding", operation: "add", value: 1 })]).join(" ")).toMatch(/no roll or test comes before it/u);
    expect(errors([leaf("dice-roll", { dice: "D6" }), leaf("roll-modifier", { roll: "preceding", operation: "subtract", value: 1 }), band(4), leaf("mortal-wounds", { recipient: "this-unit", count: "1" })]).join(" "))
      .toMatch(/Only adding/u);
  });

  it("accepts keywords printed with accented capitals and keeps their spelling", () => {
    expect(normalize("bearer-eligibility", { keywords: ["KÂHL"], match: "all", excluded_keywords: [] })).toEqual({ keywords: ["KÂHL"], match: "all", excluded_keywords: [] });
    expect(normalize("unit-keyword", { keywords: ["KÂHL"], subject: "this-unit", negated: false })).toMatchObject({ keywords: ["KÂHL"] });
    expect(() => normalize("bearer-eligibility", { keywords: ["KÂHL", "KAHL"], match: "all", excluded_keywords: [] })).toThrow(/with and without accents/u);
    expect(() => normalize("bearer-eligibility", { keywords: ["kâhl!"], match: "all", excluded_keywords: [] })).toThrow();
  });
});

describe("Round 5C family extensions, third round: unit history", () => {
  it("reads disembarking, an Ingress move and being set up this turn as history, and keeps earlier activities", () => {
    const condition = (activities: string[]) => compiled([
      leaf("unit-activity", { activities, subject: "this-unit", negated: false }), leaf("regain-wounds", { subject: "this-unit", amount: "1" }),
    ]);
    const text = JSON.stringify(condition(["disembarked-this-turn"]));
    expect(text).toContain('"event":"disembarked","window":"turn"');
    expect(text).not.toContain('"filter":{}');
    expect(JSON.stringify(condition(["made-ingress-move-this-turn", "advanced-this-turn"]))).toContain('"move_types":["ingress"]');
    expect(JSON.stringify(condition(["set-up-this-turn"]))).toContain('"event":"set-up","window":"turn"');
    expect(() => normalize("unit-activity", { activities: ["set-up-this-turn", "set-up-this-turn"], subject: "this-unit", negated: false })).toThrow(/twice/u);
  });
});

describe("Round 5C family extensions, third round: an aura's recipient acting", () => {
  it("names the aura's recipient as the unit whose moment fires the trigger", () => {
    const mechanics = compiled([
      friendly(["WAR DOG"]), aura(),
      leaf("event", { kind: "attacks-resolved", action_kind: "attack", subject: "antecedent" }),
      leaf("reroll", { roll: "wound", subset: "ones", weapon_type: "all" }),
    ]);
    expect(JSON.stringify(mechanics)).toContain('"event":"attacks-resolved","subject":"recipient"');
  });
});
