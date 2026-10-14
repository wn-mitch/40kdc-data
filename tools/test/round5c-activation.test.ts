import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/index.js";

/**
 * Activating the options of an option-bearing rule (families/abilities.ts, compile-activation.ts):
 * which options become active, for whom, whether they replace or join the active option, the
 * earlier pick a `chosen` activation names, and the menu holder and stance flags beside them.
 * Every text here is fabricated wording, not rules text.
 */

function placed(text: string, ...items: Array<[string, string, Record<string, unknown>, number?]>): CompileLeaf[] {
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

function effectOf(text: string, ...items: Array<[string, string, Record<string, unknown>, number?]>): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect as Record<string, any>;
}

function errorsOf(text: string, ...items: Array<[string, string, Record<string, unknown>, number?]>): string[] {
  const result = compileLeaves(placed(text, ...items), text);
  return result.ok ? [] : result.errors;
}

const AA = "ability-activate";
const normalize = (parameters: Record<string, unknown>) => normalizeFingerprintParameters(AA, parameters, currentFamilyVersion(AA));
const render = (effect: unknown) => describeAbility({ effect, scope: { duration: "permanent" } } as Parameters<typeof describeAbility>[0]);
const ajv = createValidator();
const effectOk = ajv.getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;

describe("ability-activate option forms", () => {
  it("takes one option form, sorts listed options, and widens the subject", () => {
    expect(normalize({ subject: "antecedent", ability: "rite-x", options: ["zeal", "aegis"] })).toEqual({ subject: "antecedent", ability: "rite-x", options: ["aegis", "zeal"] });
    for (const subject of ["selected-unit", "recipient"]) expect(normalize({ subject, ability: "rite-x", all_options: true }).subject).toBe(subject);
    expect(() => normalize({ subject: "event-object", ability: "rite-x", all_options: true })).toThrow();
    expect(() => normalize({ subject: "this-unit", ability: "rite-x", option: "zeal", options: ["aegis", "zeal"] })).toThrow(/one option form/u);
    expect(() => normalize({ subject: "this-unit", ability: "rite-x", chosen: true, all_options: true })).toThrow(/one option form/u);
    expect(() => normalize({ subject: "this-unit", ability: "rite-x", options: ["zeal"] })).toThrow();
    expect(() => normalize({ subject: "this-unit", ability: "rite-x", options: ["zeal", "zeal"] })).toThrow();
  });

  it("drops exclusive, and lets additive qualify only an activation that could leave options out", () => {
    // Replacing is this version's default, so a leaf still saying exclusive is on the wrong version.
    expect(() => normalize({ subject: "this-unit", ability: "rite-x", option: "zeal", exclusive: true })).toThrow(/exclusive/u);
    expect(normalize({ subject: "this-unit", ability: "rite-x", option: "zeal", additive: true }).additive).toBe(true);
    expect(() => normalize({ subject: "this-unit", ability: "rite-x", additive: true })).toThrow(/additive/u);
    expect(() => normalize({ subject: "this-unit", ability: "rite-x", all_options: true, additive: true })).toThrow(/additive/u);
  });

  it("picks fewer options than it picks from", () => {
    expect(normalize({ subject: "this-unit", ability: "rite-x", choose: { count: 1, from: ["zeal", "aegis"] } }).choose).toEqual({ count: 1, from: ["aegis", "zeal"] });
    expect(() => normalize({ subject: "this-unit", ability: "rite-x", choose: { count: 2, from: ["zeal", "aegis"] } })).toThrow(/fewer/u);
    expect(() => normalize({ subject: "this-unit", ability: "rite-x", choose: { count: 0 } })).toThrow();
    expect(() => normalize({ subject: "this-unit", ability: "rite-x", choose: { count: 1, by: "roll" } })).toThrow();
  });
});

describe("ability-activate lowering", () => {
  const text = "The Aegis Rite and the Zeal Rite are both active for this unit.";
  const wording = "The Aegis Rite and the Zeal Rite are both active for this unit";

  it("replaces the active option by default, keeps it with additive, and never excludes under all_options", () => {
    expect(effectOf(text, [wording, AA, { subject: "this-unit", ability: "rite-x", options: ["aegis", "zeal"] }])).toEqual({
      type: "ability-activate", target: "this-unit", modifier: { ability: "rite-x", options: ["aegis", "zeal"], exclusive: true },
    });
    expect(effectOf(text, [wording, AA, { subject: "this-unit", ability: "rite-x", option: "zeal", additive: true }]).modifier).toEqual({ ability: "rite-x", option: "zeal" });
    expect(effectOf(text, [wording, AA, { subject: "this-unit", ability: "rite-x", all_options: true }]).modifier).toEqual({ ability: "rite-x", all_options: true });
    // With no option form the ability resolves now: nothing to replace.
    expect(effectOf(text, [wording, AA, { subject: "this-unit", ability: "rite-x" }]).modifier).toEqual({ ability: "rite-x" });
  });

  it("keeps version 1's additive default", () => {
    expect(effectOf(text, [wording, AA, { subject: "this-unit", ability: "rite-x", option: "zeal" }, 1]).modifier).toEqual({ ability: "rite-x", option: "zeal" });
  });

  it("lowers choose to the player's pick, narrowed and counted", () => {
    expect(effectOf(text, [wording, AA, { subject: "this-unit", ability: "rite-x", choose: { count: 1, from: ["aegis", "zeal"] } }]).modifier).toEqual({
      ability: "rite-x", select: { by: "player", from: ["aegis", "zeal"] }, exclusive: true,
    });
    expect(effectOf(text, [wording, AA, { subject: "this-unit", ability: "rite-x", choose: { count: 2 }, additive: true }]).modifier).toEqual({
      ability: "rite-x", select: { by: "player", count: 2 },
    });
  });

  it("activates for the selected unit an anaphor points back to", () => {
    const selectText = "You can select one friendly WARDEN unit. The Aegis Rite and the Zeal Rite are both active for that unit.";
    const node = effectOf(selectText,
      ["You can", "optional-use", { who: "you" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["friendly WARDEN unit", "unit-filter", { side: "friendly", keywords: ["WARDEN"] }],
      ["The Aegis Rite and the Zeal Rite are both active for that unit", AA, { subject: "antecedent", ability: "rite-x", options: ["aegis", "zeal"] }]);
    expect(node.type).toBe("select-units");
    expect(node.effect).toEqual({ type: "ability-activate", target: "selected-unit", modifier: { ability: "rite-x", options: ["aegis", "zeal"], exclusive: true } });
  });
});

describe("the earlier pick a chosen activation names", () => {
  it("folds an optionless choice-open into the activation instead of opening a menu", () => {
    const text = "Select one Rite. Until the end of the battle, this unit has that Rite as well as any other.";
    const node = effectOf(text,
      ["Select one Rite", "choice-open", { choice_label: "Rite", min_choices: 1, max_choices: 1 }],
      ["this unit has that Rite as well as any other", AA, { subject: "this-unit", ability: "rite-x", chosen: true, additive: true }]);
    expect(node).toEqual({ type: "ability-activate", target: "this-unit", modifier: { ability: "rite-x", select: { by: "player" } } });
    const two = effectOf(text.replace("one", "two"),
      ["Select two Rite", "choice-open", { choice_label: "Rite", min_choices: 2, max_choices: 2 }],
      ["this unit has that Rite as well as any other", AA, { subject: "this-unit", ability: "rite-x", chosen: true }]);
    expect(two.modifier).toEqual({ ability: "rite-x", select: { by: "player", count: 2 }, exclusive: true });
  });

  it("reads an optionless dice pool as a pick by roll", () => {
    const text = "Roll the Fury dice and use them to activate one Fury. That Fury is active for this unit as well as any other.";
    const node = effectOf(text,
      ["Roll the Fury dice and use them to activate one Fury", "dice-pool-allocation-open", { pool_count: 8, pool_die: "D6", max_activations: 1 }],
      ["That Fury is active for this unit as well as any other", AA, { subject: "this-unit", ability: "fury-x", chosen: true, additive: true }]);
    expect(node.modifier).toEqual({ ability: "fury-x", select: { by: "roll" } });
  });

  it("refuses a chosen activation with nothing picked, or a pick that is really a menu", () => {
    const bare = "That Rite is active for this unit.";
    expect(errorsOf(bare, ["That Rite is active for this unit", AA, { subject: "this-unit", ability: "rite-x", chosen: true }]).join(" ")).toMatch(/picked earlier/u);
    const menu = "That Rite is active for this unit. Select one: Aegis. Add 1 to saves. Zeal. Add 1 to hits.";
    expect(errorsOf(menu,
      ["That Rite is active for this unit", AA, { subject: "this-unit", ability: "rite-x", chosen: true }],
      ["Select one", "choice-open", { min_choices: 1, max_choices: 1 }]).join(" ")).toMatch(/picked earlier/u);
  });

  it("refuses a choose activation whose earlier pick disagrees with it", () => {
    const text = "Select two Rites. One of the Aegis or Zeal Rites is active for this unit.";
    expect(errorsOf(text,
      ["Select two Rites", "choice-open", { choice_label: "Rite", min_choices: 2, max_choices: 2 }],
      ["One of the Aegis or Zeal Rites is active for this unit", AA, { subject: "this-unit", ability: "rite-x", choose: { count: 1, from: ["aegis", "zeal"] } }]).join(" ")).toMatch(/picks 2/u);
  });
});

describe("menu holders and stance flags", () => {
  const menuText = "You can select one friendly WARDEN unit. Select one of the rules below. That unit has that rule. Aegis: this unit has a 5+ invulnerable save. Zeal: this unit has the Stealth ability.";
  const menu = (holder: string) => effectOf(menuText,
    ["You can", "optional-use", { who: "you" }],
    ["select one", "select-unit", { distance: "any", visible: false }],
    ["friendly WARDEN unit", "unit-filter", { side: "friendly", keywords: ["WARDEN"] }],
    ["Select one of the rules below", "choice-open", { min_choices: 1, max_choices: 1 }],
    ["That unit has that rule", "chosen-option-grant", { holder }],
    ["Aegis", "named-option", { label: "Aegis" }],
    ["this unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }],
    ["Zeal", "named-option", { label: "Zeal" }],
    ["this unit has the Stealth ability", "core-ability-grant", { subject: "this-unit", ability: "stealth" }]);

  it("gives a menu's options to the unit its holder points back to", () => {
    const targets = (node: unknown): unknown[] => JSON.stringify(node).match(/"target":"[a-z-]+"/gu) ?? [];
    expect(targets(menu("antecedent"))).toEqual(['"target":"selected-unit"', '"target":"selected-unit"']);
    expect(targets(menu("this-unit"))).toEqual(['"target":"this-unit"', '"target":"this-unit"']);
  });

  it("lets a menu option select its own unit for an activation", () => {
    const text = "Select one of the abilities below. Aegis: this model has a 5+ invulnerable save. Zeal: you can select one friendly WARDEN unit; the Aegis Rite and the Zeal Rite are both active for that unit.";
    const node = effectOf(text,
      ["Select one of the abilities below", "choice-open", { min_choices: 1, max_choices: 1 }],
      ["Aegis", "named-option", { label: "Aegis" }],
      ["this model has a 5+ invulnerable save", "invulnerable-save", { subject: "this-model", threshold: 5 }],
      ["Zeal", "named-option", { label: "Zeal" }],
      ["you can", "optional-use", { who: "you" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["friendly WARDEN unit", "unit-filter", { side: "friendly", keywords: ["WARDEN"] }],
      ["the Aegis Rite and the Zeal Rite are both active for that unit", AA, { subject: "antecedent", ability: "rite-x", options: ["aegis", "zeal"] }]);
    expect(node.type).toBe("choice");
    expect(JSON.stringify(node.options[1])).toContain('"target":"selected-unit"');
  });

  it("marks an additive stance pick and a shared allowance over some options", () => {
    const text = "Select one Rite to be active for this unit as well as any other. Aegis. Add 1 to saves. Zeal. Add 1 to hits.";
    const node = effectOf(text,
      ["Select one Rite to be active for this unit as well as any other", "stance-select-open", { scope: "unit", mode: "re-selectable", additive: true }],
      ["Aegis", "named-option", { label: "Aegis" }],
      ["Add 1 to saves", "roll-modifier", { roll: "save", operation: "add", value: 1 }],
      ["Zeal", "named-option", { label: "Zeal" }],
      ["Add 1 to hits", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(node.type).toBe("stance-select");
    expect(node.additive).toBe(true);
    const capacity = effectOf("You can select the Aegis or Zeal Rite one additional time per battle.",
      ["You can select the Aegis or Zeal Rite one additional time per battle", "stance-selection-capacity",
        normalizeFingerprintParameters("stance-selection-capacity",
          { stance_id: "rite-x", additional_selections: 1, allocation: "choose-one-option", option_ids: ["zeal", "aegis"] },
          currentFamilyVersion("stance-selection-capacity"))]);
    expect(capacity.modifier).toEqual({ stance_id: "rite-x", additional_selections: 1, allocation: "choose-one-option", option_ids: ["aegis", "zeal"] });
    expect(() => normalizeFingerprintParameters("stance-selection-capacity",
      { stance_id: "rite-x", additional_selections: 1, allocation: "fixed-option", option_id: "zeal", option_ids: ["aegis", "zeal"] },
      currentFamilyVersion("stance-selection-capacity"))).toThrow(/option_ids/u);
  });
});

describe("DSL schema and describer for activations", () => {
  const activate = (modifier: Record<string, unknown>) => ({ type: "ability-activate", target: "this-unit", modifier: { ability: "rite-x", ...modifier } });

  it("accepts each option form alone and rejects two together", () => {
    for (const modifier of [{ options: ["aegis", "zeal"], exclusive: true }, { all_options: true }, { select: { by: "player", count: 2, from: ["aegis", "zeal", "ward"] }, exclusive: true }]) {
      expect(effectOk(activate(modifier))).toBe(true);
    }
    expect(effectOk(activate({ option: "zeal", options: ["aegis", "zeal"] }))).toBe(false);
    expect(effectOk(activate({ select: { by: "player" }, all_options: true }))).toBe(false);
    expect(effectOk(activate({ all_options: true, exclusive: true }))).toBe(false);
    expect(effectOk(activate({ select: { by: "player", count: 1 } }))).toBe(false);
    const capacity = (modifier: Record<string, unknown>) => ({ type: "stance-selection-capacity", modifier: { stance_id: "rite-x", additional_selections: 1, ...modifier } });
    expect(effectOk(capacity({ allocation: "choose-one-option", option_ids: ["aegis", "zeal"] }))).toBe(true);
    expect(effectOk(capacity({ allocation: "fixed-option", option_id: "zeal", option_ids: ["aegis", "zeal"] }))).toBe(false);
  });

  it("says which options are active and whether they replace or join the others", () => {
    expect(render(activate({ options: ["aegis", "zeal"], exclusive: true }))).toBe("The Aegis and Zeal options of Rite X are active for the unit (and no other option is).");
    expect(render(activate({ options: ["aegis", "zeal"] }))).toBe("The Aegis and Zeal options of Rite X are active for the unit.");
    expect(render(activate({ all_options: true }))).toBe("Every option of Rite X is active for the unit.");
    expect(render(activate({ select: { by: "player", from: ["aegis", "zeal"] }, exclusive: true }))).toBe("Select one of the Aegis or Zeal options of Rite X for the unit, in place of any already active.");
    expect(render(activate({ select: { by: "player", count: 2 } }))).toBe("Select 2 options of Rite X for the unit, in addition to any already active.");
    expect(render(activate({ select: { by: "roll" }, exclusive: true }))).toBe("Make a new Rite X roll and activate one result it allows for the unit, in place of any already active.");
    expect(render({ type: "stance-selection-capacity", modifier: { stance_id: "rite-x", additional_selections: 1, allocation: "choose-one-option", option_ids: ["aegis", "zeal"] } }))
      .toBe("You can select Aegis or Zeal one additional time per battle, shared between them.");
    const stance = { type: "stance-select", mode: "re-selectable", options: [{ name: "Aegis", effect: activate({}) }, { name: "Zeal", effect: activate({}) }] };
    expect(render({ ...stance, additive: true })).toContain("select one (in addition to any already active):");
    expect(render(stance)).not.toContain("in addition");
  });
});
