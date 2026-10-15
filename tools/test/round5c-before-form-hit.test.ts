import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { bindBeforeFormHits } from "../src/round5c/compile-weapon-qualified.js";
import { foldUnitFilters } from "../src/round5c/compile-unit-filters.js";
import { wrapForEachUnit } from "../src/round5c/compile-wrappers.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/index.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

const DOOMWEAVER_HIT = "scored a hit against an";

/** The "Each time … shot" selection shape (S1 and S2): a select in a later part, hit by its attacks. */
describe("a selection's hit eligibility (S1, S2)", () => {
  it("keeps the eligibility when the select sits in a later part of a compound ability", () => {
    const text = "Add 1 to the Hit roll for this unit. After this model has shot, select one enemy unit hit by one or more of those attacks made with its Doomweaver. Until the end of the phase, that enemy unit is pinned.";
    const mechanics = mechanicsOf(placed(text,
      ["Add 1 to the Hit roll for this unit", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "this-unit" }],
      ["After this model has shot", "event", { kind: "after-shooting" }],
      ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["hit by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }],
      ["made with its Doomweaver", "attack-filter", { weapon_name: "Doomweaver" }],
      ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }]), text);
    expect(JSON.stringify(mechanics)).toContain('"type":"select-units","selector":{"owner":"enemy","count":1,"eligibility":{"type":"happened","parameters":{"event":"after-roll","subject":"event-subject","object":"this-unit","filter":{"roll":"hit","result":"success","weapon_name":"Doomweaver"},"window":"event"}}}');
  });

  it("names the candidate as this-unit, not the selected unit", () => {
    const text = "In your Shooting phase, after this model has shot, select one enemy unit hit by one or more of those attacks made with its Doomweaver. Until the end of the phase, that enemy unit is pinned.";
    const mechanics = mechanicsOf(placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["after this model has shot", "event", { kind: "after-shooting" }],
      ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["hit by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }],
      ["made with its Doomweaver", "attack-filter", { weapon_name: "Doomweaver" }],
      ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }]), text);
    const eligibility = JSON.stringify(mechanics).match(/"eligibility":\{"type":"happened".*?"window":"event"\}/u)?.[0];
    expect(eligibility).toContain('"object":"this-unit"');
    expect(eligibility).not.toContain("selected-unit");
  });

  it("names the candidate this-unit on a designation's select too", () => {
    const text = "Pick one enemy unit hit by one or more of those attacks made with its Doomweaver. Whenever a model in this unit attacks that unit, re-roll the hit.";
    const mechanics = mechanicsOf(placed(text,
      ["Pick one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["hit by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }],
      ["made with its Doomweaver", "attack-filter", { weapon_name: "Doomweaver" }],
      ["Whenever a model in this unit attacks", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["that unit", "target-is-selected", {}],
      ["re-roll the hit", "reroll", { roll: "hit", subset: "all" }]), text);
    expect(mechanics.effect.type).toBe("designate-target");
    expect(mechanics.effect.select.eligibility).toEqual({ type: "happened", parameters: { event: "after-roll", subject: "event-subject", object: "this-unit", filter: { roll: "hit", result: "success", weapon_name: "Doomweaver" }, window: "event" } });
  });

  it("refuses a pair of selections whose eligibility no single select owns", () => {
    const text = "Select one friendly model, then select one enemy unit within 6\" of it hit by one or more of those attacks made with its Doomweaver. Until the end of the phase, that enemy unit is pinned.";
    const result = compileLeaves(placed(text,
      ["Select one friendly model", "select-unit", { scope: "friendly", distance: "any", visible: false, target_kind: "model", bind_as: "bearer" }],
      ["select one enemy unit within 6\" of it", "select-unit", { scope: "enemy", distance: "within", within_of: "bearer", visible: false }],
      ["hit by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }],
      ["made with its Doomweaver", "attack-filter", { weapon_name: "Doomweaver" }],
      ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }]), text);
    expect(result.ok).toBe(false);
    // The bound-pair check in compile.ts refuses any eligibility on a pair before the pair branch is reached.
    expect(result.errors.join(" ")).toMatch(/not bound with it yet/u);
  });

  it("refuses a persistent designation's select when its eligibility has no field to sit in", () => {
    const text = "At the start of the battle, select one enemy unit hit by one or more of those attacks made with its Doomweaver to be this model's quarry. Each time this model makes an attack that targets its quarry, you can re-roll the Hit roll.";
    const result = compileLeaves(placed(text,
      ["At the start of the battle", "phase-window", { phase: "start-of-battle", turn: "none" }],
      ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["hit by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }],
      ["made with its Doomweaver", "attack-filter", { weapon_name: "Doomweaver" }],
      ["to be this model's quarry", "persistent-designation-open", { designation: "prey", scope: "enemy-unit", timing: "start-of-first-battle-round", beneficiary: "this-model" }],
      ["Each time this model makes an attack", "attack", { direction: "makes", unit: "this-model", attack_type: "any" }],
      ["that targets its quarry", "designated-filter", { subject: "defender", tag: "prey" }],
      ["you can re-roll the Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all" }]), text);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/persistent designation's select has no eligibility field/u);
  });
});

/** The before-form hit (B): "one or more of those attacks … scored a hit against an enemy unit, … that enemy unit …". */
describe("a before-form hit binds the unit it hit (B)", () => {
  const text = "In your Shooting phase, after this model has shot, one or more of those attacks made with its Doomweaver scored a hit against an enemy unit. Until the start of your next turn, that enemy unit is pinned. While a unit is pinned, subtract 2 from that unit's Move characteristic.";
  const leaves = (): CompileLeaf[] => placed(text,
    ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["after this model has shot", "event", { kind: "after-shooting" }],
    ["one or more of those attacks made with its Doomweaver", "attack-filter", { weapon_name: "Doomweaver" }],
    [DOOMWEAVER_HIT, "hit-by-attacks", { object: "following-filter" }],
    ["enemy unit", "unit-filter", { side: "enemy" }],
    ["Until the start of your next turn", "duration", { endpoint: "start-of-next-turn" }],
    ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }],
    ["While a unit is pinned", "designated-filter", { tag: "pinned" }],
    ["subtract 2 from that unit's Move characteristic", "characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "subtract", value: 2, weapon_type: "all" }]);

  it("compiles to a for-each over the enemy units, gated on the hit with the attack filter", () => {
    const mechanics = mechanicsOf(leaves(), text);
    const forEach = mechanics.effect.effect;
    expect(forEach.type).toBe("for-each-unit");
    expect(forEach.selector.owner).toBe("enemy");
    expect(forEach.selector.eligibility).toEqual({ type: "happened", parameters: { event: "after-roll", subject: "event-subject", object: "this-unit", filter: { roll: "hit", result: "success", weapon_name: "Doomweaver" }, window: "event" } });
    expect(forEach.effect.steps[0]).toEqual({ type: "designate", target: "recipient", modifier: { tag: "pinned" } });
    expect(forEach.effect.steps[1].condition).toEqual({ type: "designated", parameters: { subject: "recipient", tag: "pinned" } });
    expect(mechanics.scope).toEqual({ duration: "until-start-next-turn" });
    expect(mechanics.trigger).toEqual({ event: "attacks-resolved", filter: { kind: "shoot" } });
    // The synthesized quantifier's hit key is internal: it never reaches the output.
    expect(JSON.stringify(mechanics)).not.toContain('"hit":');
  });

  it("validates against the DSL and describes the per-unit pass", () => {
    const mechanics = mechanicsOf(leaves(), text);
    const validate = createValidator().compile({ $ref: "https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json#/$defs/effect-node" });
    expect(validate(mechanics.effect), JSON.stringify(validate.errors?.slice(0, 2))).toBe(true);
    const described = describeAbility({ effect: mechanics.effect, scope: mechanics.scope, trigger: mechanics.trigger } as never);
    expect(described).toMatch(/For each enemy unit that was hit by an attack .*Doomweaver/u);
  });

  it("binds a Charge roll-modifier to the recipient only when it names the antecedent", () => {
    const charged = `${text} Subtract 2 from Charge rolls made for it.`;
    const roll = (parameters: Record<string, unknown>) => mechanicsOf(placed(charged,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["after this model has shot", "event", { kind: "after-shooting" }],
      ["one or more of those attacks made with its Doomweaver", "attack-filter", { weapon_name: "Doomweaver" }],
      [DOOMWEAVER_HIT, "hit-by-attacks", { object: "following-filter" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["Until the start of your next turn", "duration", { endpoint: "start-of-next-turn" }],
      ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }],
      ["While a unit is pinned", "designated-filter", { tag: "pinned" }],
      ["subtract 2 from that unit's Move characteristic", "characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "subtract", value: 2, weapon_type: "all" }],
      ["Subtract 2 from Charge rolls made for it", "roll-modifier", { roll: "charge", operation: "subtract", value: 2, ...parameters }],
    ), charged);
    const lastStep = (mechanics: Record<string, any>) => mechanics.effect.effect.effect.steps.at(-1);
    expect(lastStep(roll({ subject: "antecedent" }))).toEqual({ type: "roll-modifier", target: "recipient", modifier: { roll: "charge", operation: "subtract", value: 2 } });
    // Without the antecedent the modifier belongs to the bearer's unit, which the loop does not iterate: it runs once, after the loop.
    const unbound = roll({}).effect.effect;
    expect(unbound.type).toBe("sequence");
    expect(unbound.steps.at(-1)).toMatchObject({ type: "roll-modifier", target: "this-unit" });
    expect(unbound.steps[0].type).toBe("for-each-unit");
  });

  it("refuses a before-form hit with no unit-filter after it", () => {
    const without = leaves().filter((leaf) => leaf.family_id !== "unit-filter");
    const result = compileLeaves(without, text);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/before-form/u);
  });

  it("refuses a before-form hit with window phase", () => {
    const phased = leaves().map((leaf) => leaf.family_id === "hit-by-attacks" ? { ...leaf, parameters: { ...leaf.parameters, window: "phase" } } : leaf);
    const result = compileLeaves(phased, text);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/before-form/u);
  });

  it("refuses a that-unit anaphor in another part, which the binder cannot reach", () => {
    const split = leaves().map((leaf) => leaf.family_id === "characteristic-modifier" ? { ...leaf, fragment: "OTHER" } : leaf);
    const result = compileLeaves(split, text);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/characteristic-modifier at byte \d+ is in another part/u);
  });

  it("leaves a before-form hit with no that-unit anaphor exactly as the leading fold left it", () => {
    // Golden captured on the tree before the binder: no antecedent after the hit, so the binder does not touch it.
    const plain = "Each time this model makes a ranged attack, if one or more of those attacks made with its Gloomhound cannon scored a hit against an enemy unit, add 1 to the Wound roll.";
    const result = compileLeaves(placed(plain,
      ["Each time this model makes a ranged attack", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" }],
      ["one or more of those attacks made with its Gloomhound cannon", "attack-filter", { weapon_name: "Gloomhound cannon" }],
      ["scored a hit against an", "hit-by-attacks", { object: "following-filter" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), plain);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok ? result.mechanics : null)).toBe(`{"effect":{"type":"conditional","condition":{"operator":"and","operands":[{"type":"attack-is","parameters":{"attack_type":"ranged"}},{"type":"happened","parameters":{"event":"after-roll","subject":"event-subject","object":{"owner":"enemy"},"filter":{"roll":"hit","result":"success","weapon_name":"Gloomhound cannon"},"window":"event"}}]},"effect":{"type":"roll-modifier","target":"this-model","modifier":{"roll":"wound","operation":"add","value":1}}},"scope":{"duration":"permanent"},"behavior":"passive","trigger":null}`);
  });

  it("folds a for-each that carries a hit without losing its scope, filter or hit", () => {
    const quantifier: CompileLeaf = { role: "EVENT", family_id: "for-each-unit-select", family_version: currentFamilyVersion("for-each-unit-select"), parameters: { hit: { hit_filter: { weapon_name: "Doomweaver" } } }, start_byte: 0, end_byte: 5, fragment: "RAW_TEXT" };
    const unit: CompileLeaf = { role: "CONDITION", family_id: "unit-filter", family_version: currentFamilyVersion("unit-filter"), parameters: { side: "enemy" }, start_byte: 6, end_byte: 12, fragment: "RAW_TEXT" };
    const folded = foldUnitFilters([quantifier, unit], "Each enemy unit");
    expect(folded).toHaveLength(1);
    expect(folded[0]!.parameters).toMatchObject({ scope: "enemy", hit: { hit_filter: { weapon_name: "Doomweaver" } } });
    expect(folded[0]!.parameters.filter).toBeDefined();
  });

  it("refuses a hit that names a target or a key the per-unit pass cannot hold", () => {
    const body = { type: "sequence", steps: [] };
    const quantifier = (parameters: Record<string, unknown>): CompileLeaf => ({ role: "EVENT", family_id: "for-each-unit-select", family_version: currentFamilyVersion("for-each-unit-select"), parameters: { scope: "enemy", filter: {}, ...parameters }, start_byte: 0, end_byte: 1, fragment: "RAW_TEXT" });
    expect(() => wrapForEachUnit(quantifier({ hit: { subject: "event-subject" } }), body)).toThrow(/only its attack-filter/u);
    expect(() => wrapForEachUnit(quantifier({ including: "target", hit: {} }), body)).toThrow(/cannot gate on a hit/u);
  });

  it("refuses a before-form hit's per-unit pass that shares a record with an army composition", () => {
    const army: CompileLeaf = { role: "CONDITION", family_id: "army-construction", family_version: currentFamilyVersion("army-construction"), parameters: { rule: "composition", max: 500, measure: "points" }, start_byte: 0, end_byte: 1, fragment: "RAW_TEXT" };
    const bound = leaves();
    expect(() => bindBeforeFormHits([...bound, army], text)).toThrow(/cannot share a record/u);
  });
});

/** A hit's unit named by a for-each whose selector keeps its keywords, with the hit gate in its eligibility (the 7154 shape). */
describe("a keyworded before-form hit", () => {
  it("keeps the keywords on the selector and the hit in its eligibility", () => {
    const text = "Each time this model makes a ranged attack, if one or more of those attacks made with its Ember cannon scored a hit against an enemy INFANTRY unit, until the end of the phase, that enemy unit is pinned, and add 1 to Charge rolls made for it.";
    const mechanics = mechanicsOf(placed(text,
      ["Each time this model makes a ranged attack", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" }],
      ["one or more of those attacks made with its Ember cannon", "attack-filter", { weapon_name: "Ember cannon" }],
      [DOOMWEAVER_HIT, "hit-by-attacks", { object: "following-filter" }],
      ["enemy INFANTRY unit", "unit-filter", { side: "enemy", keywords: ["INFANTRY"] }],
      ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }],
      ["add 1 to Charge rolls made for it", "roll-modifier", { roll: "charge", operation: "add", value: 1, subject: "antecedent" }]), text);
    const selector = JSON.stringify(mechanics).match(/"type":"for-each-unit","selector":\{.*?"eligibility"/u)?.[0] ?? "";
    expect(selector).toContain('"keywords":["INFANTRY"]');
    expect(JSON.stringify(mechanics)).toContain('"weapon_name":"Ember cannon"');
  });
});

/** The per-unit pass and its hit gate, checked on fabricated wording (the 4314, 7268 and 7235 shapes). */
describe("before-form hit guards and shapes", () => {
  it("refuses a before-form pass whose count-scale shares the record", () => {
    const text = "In your Shooting phase, after this model has shot, one or more of those attacks made with its Doomweaver scored a hit against an enemy unit, that enemy unit is pinned.";
    const count: CompileLeaf = { role: "CONDITION", family_id: "count-scale", family_version: currentFamilyVersion("count-scale"), parameters: {}, start_byte: 0, end_byte: 1, fragment: "RAW_TEXT" };
    expect(() => bindBeforeFormHits([...placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["one or more of those attacks made with its Doomweaver", "attack-filter", { weapon_name: "Doomweaver" }],
      [DOOMWEAVER_HIT, "hit-by-attacks", { object: "following-filter" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }]), count], text)).toThrow(/cannot share a record/u);
  });

  it("refuses an anaphor that follows a second unit-filter in the same part", () => {
    const text = "In your Shooting phase, after this model has shot, one or more of those attacks made with its Doomweaver scored a hit against an enemy unit, that enemy unit is pinned. If an enemy INFANTRY unit is hit, that unit must take a Battle-shock test.";
    const result = compileLeaves(placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["one or more of those attacks made with its Doomweaver", "attack-filter", { weapon_name: "Doomweaver" }],
      [DOOMWEAVER_HIT, "hit-by-attacks", { object: "following-filter" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }],
      ["enemy INFANTRY unit", "unit-filter", { side: "enemy", keywords: ["INFANTRY"] }],
      ["that unit must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }]), text);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/followed by another unit-filter in its part/u);
  });

  it("gives a hit's window to the selection's eligibility (the 4314 shape)", () => {
    const text = "Choose one enemy unit struck by one or more of the attacks from your squad this phase. Until the end of the phase, lower that unit’s Move characteristic by 2.";
    const mechanics = mechanicsOf(placed(text,
      ["Choose one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["struck by one or more of the attacks from your squad this phase", "hit-by-attacks", { subject: "selected-unit", window: "phase" }],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["lower that unit’s Move characteristic by 2", "characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "subtract", value: 2, weapon_type: "all" }]), text);
    expect(mechanics.effect.selector.eligibility).toEqual({ type: "happened", parameters: { event: "after-roll", subject: "event-subject", object: "this-unit", filter: { roll: "hit", result: "success" }, window: "phase" } });
  });

  it("names the candidate this-unit on a designation whose attacker gate is per attack (the 7268 shape)", () => {
    const text = "In your Shooting phase, after this model has shot, choose one enemy unit that was struck by one or more of those attacks. Until the end of the phase, each time a model that left this VEHICLE this turn makes an attack that targets that enemy unit, you can re-roll the Hit roll.";
    const mechanics = mechanicsOf(placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["after this model has shot", "event", { kind: "after-shooting" }],
      ["choose one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["that was struck by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["a model", "unit-filter", { side: "friendly", level: "model" }],
      ["that left this VEHICLE this turn", "unit-activity", { activities: ["disembarked-from-this-transport-this-turn"], subject: "antecedent", negated: false }],
      ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["that targets that enemy unit", "target-is-selected", {}],
      ["you can re-roll the Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all" }]), text);
    expect(mechanics.effect.effect.select.eligibility.parameters.object).toBe("this-unit");
    expect(JSON.stringify(mechanics)).not.toContain("selected-unit\",\"filter");
  });
});

describe("a hit eligibility over two unbound selections", () => {
  it("is refused as two selections, since no single select owns the eligibility", () => {
    const text = "Select one enemy unit, then select one friendly unit hit by one or more of those attacks made with its Doomweaver. Until the end of the phase, that enemy unit is pinned.";
    const result = compileLeaves(placed(text,
      ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["select one friendly unit", "select-unit", { scope: "friendly", distance: "any", visible: false }],
      ["hit by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }],
      ["made with its Doomweaver", "attack-filter", { weapon_name: "Doomweaver" }],
      ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }]), text);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/More than one unit is selected/u);
  });
});
