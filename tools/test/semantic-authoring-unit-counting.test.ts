import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createValidator } from "../src/schema-loader.js";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";

/** Leaves on their own wording in `text`, in order. Every leaf shares one fragment, as in one rule. */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

// semantic-authoring-per-unit-count
{
// Wave 10 per-unit-count authoring shapes (P1 to P3). Fabricated wording only; each test
// builds the leaves a drafter authors for one record shape and pins what compiles.

function resultOf(list: CompileLeaf[], text: string) {
  return compileLeaves(list, text);
}

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = resultOf(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(list: CompileLeaf[], text: string): string {
  const result = resultOf(list, text);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics.effect)}`);
  return result.errors.join("; ");
}

describe("Semantic authoring per-unit-count P1: a penalty scaled per 10 models in the bearer's unit", () => {
  const text = "When this unit is selected to fight, that enemy unit makes a battle-shock roll, with -1 from that battle-shock roll for every 10 models in this unit.";
  const fight = ["When this unit is selected to fight", "event", { kind: "selected", to: "fight" }] as [string, string, Record<string, unknown>];

  it("is one test leaf whose scaling parameters emit the test's own scaling block, with no field key", () => {
    const list = placed(text, fight,
      ["that enemy unit makes a battle-shock roll, with -1 from that battle-shock roll for every 10 models in this unit", "test",
        { target: "antecedent", test: "battle-shock", modifier: -1, scaling_per: 10, scaling_of: "models-in-bearer-unit", scaling_round: "down" }]);
    const effect = mechanicsOf(list, text).effect;
    // The antecedent lowers to the trigger's subject (event-subject), the same reference the record's trigger gives.
    expect(effect).toEqual({ type: "test", target: "event-subject", modifier: { test: "battle-shock", modifier: -1 }, scaling: { per: 10, of: "models-in-bearer-unit", round: "down" } });
    expect(effect.scaling).not.toHaveProperty("field");
  });

  it("refuses a count-scale onto a test that already scales its own penalty", () => {
    const list = placed(text, fight,
      ["that enemy unit makes a battle-shock roll, with -1 from that battle-shock roll", "test",
        { target: "antecedent", test: "battle-shock", modifier: -1, scaling_per: 10, scaling_of: "models-in-bearer-unit", scaling_round: "down" }],
      ["for every 10", "count-scale", { per: 10 }],
      ["models", "unit-filter", { side: "friendly", level: "model" }],
      ["in this unit", "membership", { relation: "in", of: "this-unit" }]);
    expect(errorsOf(list, text)).toMatch(/cannot also take a count-scale/u);
  });
});

describe("Semantic authoring per-unit-count P2: a second bonus per 5 models in or embarked in the bearer", () => {
  it("scales only the second bonus, by models in or embarked within the bearer, with no timing", () => {
    const text = "Add 1 to the Strength characteristic of this model. Add 1 to the Strength characteristic of this model for every 5 models in this unit (or embarked within this model).";
    const list = placed(text,
      ["Add 1 to the Strength characteristic of this model.", "characteristic-modifier", { subject: "this-model", characteristics: ["S"], operation: "add", value: 1, weapon_type: "all" }],
      ["Add 1 to the Strength characteristic of this model", "characteristic-modifier", { subject: "this-model", characteristics: ["S"], operation: "add", value: 1, weapon_type: "all" }],
      ["for every 5", "count-scale", { per: 5 }],
      ["models", "unit-filter", { side: "friendly", level: "model" }],
      ["in this unit (or embarked within this model)", "membership", { relation: "in-or-embarked-in", of: "this-unit" }]);
    const effect = mechanicsOf(list, text).effect;
    expect(effect.type).toBe("sequence");
    const [flat, scaled] = effect.steps;
    expect(flat.scaling).toBeUndefined();
    expect(scaled.scaling).toEqual({ per: 5, of: "models-in-or-embarked-in-bearer" });
  });
});

describe("Semantic authoring per-unit-count P3: one D6 per model of the moved unit", () => {
  // The bearer is the moved unit ("this unit makes a Normal, Advance or Fall Back move"). The "that unit"
  // form of the same rule is pinned below.
  const text = "Each time this unit makes a Normal, Advance or Fall Back move, roll one D6 for each model in this unit: for each 1, this unit suffers 1 mortal wound.";
  const list = placed(text,
    ["Each time this unit makes a Normal, Advance or Fall Back move", "event", { kind: "move-ended", move_types: ["normal", "advance", "fall-back"], subject: "this-unit" }],
    ["roll one D6 for each model in this unit", "dice-roll", { dice: "D6", per_model: "target" }],
    ["for each 1", "roll-result", { from: 1, to: 1 }],
    ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }]);

  it("rolls one die per moving model, and each 1 is a mortal wound on the moved unit", () => {
    const effect = mechanicsOf(list, text).effect;
    expect(effect.type).toBe("mortal-wounds");
    expect(effect.target).toBe("this-unit");
    expect(effect.modifier).toMatchObject({ count: 1, per: "success", roll: { dice: 1, per_model: "this-unit", comparison: "lte", threshold: 1 } });
  });

  it("compiles when the mover is the event subject: the recipient is the antecedent, the count is the mover's models", () => {
    const other = "Each time that unit makes a Normal, Advance or Fall Back move, roll one D6 for each model in that unit: for each 1, that unit suffers 1 mortal wound.";
    const leaves = placed(other,
      ["Each time that unit makes a Normal, Advance or Fall Back move", "event", { kind: "move-ended", move_types: ["normal", "advance", "fall-back"], subject: "antecedent" }],
      ["roll one D6 for each model in that unit", "dice-roll", { dice: "D6", per_model: "target" }],
      ["for each 1", "roll-result", { from: 1, to: 1 }],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "antecedent", count: "1" }]);
    const effect = mechanicsOf(leaves, other).effect;
    expect(effect.target).toBe("event-subject");
    expect(effect.modifier).toMatchObject({ count: 1, per: "success", roll: { dice: 1, per_model: "event-subject", comparison: "lte", threshold: 1 } });
  });

  it("refuses recipient that-unit with an event-subject mover, which names a selection that does not exist", () => {
    const other = "Each time that unit makes a Normal, Advance or Fall Back move, roll one D6 for each model in that unit: for each 1, that unit suffers 1 mortal wound.";
    const leaves = placed(other,
      ["Each time that unit makes a Normal, Advance or Fall Back move", "event", { kind: "move-ended", move_types: ["normal", "advance", "fall-back"], subject: "antecedent" }],
      ["roll one D6 for each model in that unit", "dice-roll", { dice: "D6", per_model: "target" }],
      ["for each 1", "roll-result", { from: 1, to: 1 }],
      ["that unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]);
    expect(errorsOf(leaves, other)).toMatch(/names "that unit", but no select-unit leaf/u);
  });
});
}

// semantic-authoring-count-by-battle-round
{
/** A registered designation, so a designate-target compiles (compile-wrappers.ts designationIdFor). */
const FIXTURE_RULE_NAME = "A Trap Well Laid";

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

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { name: FIXTURE_RULE_NAME,  abilityId: "fabricated-battle-round" });

function errorsOf(text: string, ...items: Item[]): string {
  const result = run(text, ...items);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.errors.join(" ");
}

const TEXT = "Select a number of friendly ALPHA units equal to or less than the current battle round number. Those units must take a Battle-shock test.";
const SELECT: Item = ["Select a number of", "select-unit", { scope: "friendly", distance: "any", visible: false }];
const FILTER: Item = ["friendly ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }];
const ROUND: Item = ["equal to or less than the current battle round number", "count-by-battle-round", {}];
const SIZE: Item = ["equal to or less than", "count-by-battle-size", { incursion: 1, "strike-force": 2, onslaught: 3 }];
const EFFECT: Item = ["Those units must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }];

describe("Semantic authoring count by battle round: the family", () => {
  it("takes no parameters at its one version", () => {
    expect(normalizeFingerprintParameters("count-by-battle-round", {}, currentFamilyVersion("count-by-battle-round"))).toEqual({});
    expect(() => normalizeFingerprintParameters("count-by-battle-round", { max: 3 }, currentFamilyVersion("count-by-battle-round"))).toThrow();
    expect(familyRole("count-by-battle-round", currentFamilyVersion("count-by-battle-round"))).toBe("RESTRICTION");
  });

  it("leaves count-by-battle-size's parameters as they were", () => {
    const size = { incursion: 1, "strike-force": 2, onslaught: 3 };
    expect(normalizeFingerprintParameters("count-by-battle-size", size, currentFamilyVersion("count-by-battle-size"))).toEqual(size);
  });
});

describe("Semantic authoring count by battle round: compiling the selection's cap", () => {
  it("caps the selection at the battle round number and validates against the DSL", () => {
    const result = run(TEXT, SELECT, FILTER, ROUND, EFFECT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("select-units");
    expect(effect.selector.count).toEqual({ min: 0, max: { count_of: "battle-round" } });
    expect(effect.selector).not.toHaveProperty("max_count");
    expect(effect.selector.filter).toEqual({ owner: "friendly", all_of: ["ALPHA"] });
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(effect), JSON.stringify(validate?.errors)).toBe(true);
  });

  it("keeps a plain battle-size selection compiling to its per-size cap", () => {
    const text = "Select a number of friendly ALPHA units equal to or less than the battle size limit. Those units must take a Battle-shock test.";
    const result = run(text, SELECT, FILTER, ["equal to or less than the battle size limit", "count-by-battle-size", { incursion: 1, "strike-force": 2, onslaught: 3 }], EFFECT);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.mechanics.effect as Record<string, any>).selector.count).toEqual({ min: 0, max: { incursion: 1, "strike-force": 2, onslaught: 3 } });
  });

  it("refuses both a battle-size and a battle-round count", () => {
    const text = "Select a number of friendly ALPHA units equal to the battle size limit or equal to or less than the current battle round number. Those units must take a Battle-shock test.";
    expect(errorsOf(text, SELECT, FILTER, ["equal to the battle size limit", ...SIZE.slice(1) as [string, Record<string, unknown>]], ROUND, EFFECT)).toContain("not both");
  });

  it("refuses a round count with no unit selection", () => {
    expect(errorsOf("Those units must take a Battle-shock test, equal to the current battle round number.", EFFECT, ["equal to the current battle round number", "count-by-battle-round", {}]))
      .toContain("needs the unit selection it limits");
  });

  it("refuses a round count on a selection that names its own count", () => {
    const own: Item = ["Select a number of", "select-unit", { scope: "friendly", distance: "any", visible: false, count: 2 }];
    expect(() => run(TEXT, own, FILTER, ROUND, EFFECT)).toThrow(/names its own count/u);
  });
});

describe("Semantic authoring count by battle round: shapes that would drop the cap are refused", () => {
  const ATTACK_TEXT = "Select a number of enemy ALPHA units equal to or less than the current battle round number. Each time a friendly unit makes an attack that targets that unit, add 1 to the Hit roll.";
  const DESIGNATION: Item[] = [
    ["Select a number of", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["enemy ALPHA units", "unit-filter", { side: "enemy", keywords: ["ALPHA"] }],
    ["Each time a friendly unit makes an attack that targets that unit", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any", target: "that-unit" }],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
  ];
  const withCount = (items: Item[], count: Item) => [...items.slice(0, 2), count, ...items.slice(2)];

  it("compiles the designation without a count, so the refusals below are the count's own", () => {
    expect(run(ATTACK_TEXT, ...DESIGNATION).ok).toBe(true);
  });

  const MESSAGE = "is carried only by a plain single selection";
  it.each([
    ["round", ROUND],
    ["size", ["equal to or less than the current battle round number", "count-by-battle-size", { incursion: 1, "strike-force": 2, onslaught: 3 }] as Item],
  ])("refuses a %s count with a designated selection", (_name, count) => {
    expect(errorsOf(ATTACK_TEXT, ...withCount(DESIGNATION, count))).toContain(MESSAGE);
  });

  const PART_TEXT = "Those units must take a Battle-shock test, and each time this unit fights, select a number of friendly ALPHA units equal to or less than the current battle round number, those units must take a Battle-shock test.";
  const PART: Item[] = [
    ["Those units must take a Battle-shock test", "test", { target: "this-unit", test: "battle-shock" }],
    ["each time this unit fights", "event", { kind: "move-ended", subject: "this-unit" }],
    ["select a number of", "select-unit", { scope: "friendly", distance: "any", visible: false }],
    FILTER,
  ];
  it.each([["round", ROUND], ["size", ["equal to or less than the current battle round number", "count-by-battle-size", { incursion: 1, "strike-force": 2, onslaught: 3 }] as Item]])(
    "refuses a %s count on a selection inside a compound part", (_name, count) => {
      const items: Item[] = [...PART, count, ["those units must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }]];
      expect(errorsOf(PART_TEXT, ...items)).toContain(MESSAGE);
    });

  it.each([["round", ROUND], ["size", ["equal to or less than the current battle round number", "count-by-battle-size", { incursion: 1, "strike-force": 2, onslaught: 3 }] as Item]])(
    "refuses a %s count beside a for-each loop", (_name, count) => {
      const text = "Each friendly unit and a number of units equal to or less than the current battle round number. Those units must take a Battle-shock test.";
      const items: Item[] = [
        ["Each friendly", "for-each-unit-select", { scope: "friendly", distance: "any" }],
        ["a number of", "select-unit", { scope: "friendly", distance: "any", visible: false }],
        ["equal to or less than the current battle round number", ...count.slice(1) as [string, Record<string, unknown>]],
        EFFECT,
      ];
      expect(errorsOf(text, ...items)).toContain(MESSAGE);
    });

  it("compiles the same part when it carries no count, so the refusal is the count's own", () => {
    const text = PART_TEXT.replace(" equal to or less than the current battle round number", "");
    const items: Item[] = [...PART, ["those units must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }]];
    expect(run(text, ...items).ok).toBe(true);
  });

  it("refuses a round count beside a bound pair", () => {
    const text = "Select one friendly ALPHA model. Select a number of enemy BRAVO units equal to or less than the current battle round number within 8 inches of that model. Those units must take a Battle-shock test.";
    const items: Item[] = [
      ["Select one friendly", "select-unit", { distance: "any", visible: false, bind_as: "anchor" }],
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["Select a number of enemy", "select-unit", { distance: "within", inches: 8, visible: false, within_of: "anchor" }],
      ["BRAVO units", "unit-filter", { side: "enemy", keywords: ["BRAVO"] }],
      ["equal to or less than the current battle round number", "count-by-battle-round", {}],
      EFFECT,
    ];
    expect(errorsOf(text, ...items)).toContain("not bound with it yet");
  });
});
}

// semantic-authoring-count-timing
{
// Wave 10 per-unit-count timing: count-scale timing "on-apply" (fabricated wording only).

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(list: CompileLeaf[], text: string): string {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics.effect)}`);
  return result.errors.join("; ");
}

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((item) => item.ability_id === "control-edict-adeptus-mechanicus")!;

/** The rendered text of a compiled list, after the entry validates against the ability schema. */
function rendered(list: CompileLeaf[], text: string): string {
  const check = checkEntry(entryWithMechanics(base, mechanicsOf(list, text) as never));
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

const PHASE_START = ["At the start of the Fight phase", "event", { kind: "phase-start", phase: "fight", turn: "your" }] as [string, string, Record<string, unknown>];
const UNTIL_PHASE_END = ["until the end of the phase", "duration", { endpoint: "end-of-phase" }] as [string, string, Record<string, unknown>];
const FIGHT = ["When this unit is selected to fight", "event", { kind: "selected", to: "fight" }] as [string, string, Record<string, unknown>];

/** The 6664 shape: a bonus that starts at a phase start and lasts, scaled by enemies in range. */
const LASTING = "At the start of the Fight phase, until the end of the phase, this model's melee weapons have +2 A for every 5 enemy models within 6\" of this model.";
function lasting(timing: Record<string, unknown>): CompileLeaf[] {
  return placed(LASTING, PHASE_START, UNTIL_PHASE_END,
    ["this model's melee weapons have +2 A", "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "add", value: 2, weapon_type: "melee" }],
    ["for every 5", "count-scale", { per: 5, ...timing }],
    ["enemy models", "unit-filter", { side: "enemy", level: "model" }],
    ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }]);
}

describe("Semantic authoring count-scale timing: a count taken once when a lasting rule applies", () => {
  it("fixes an on-apply count and marks the scaling evaluated on apply", () => {
    const effect = mechanicsOf(lasting({ timing: "on-apply" }), LASTING).effect;
    expect(effect.type).toBe("stat-modifier");
    expect(effect.scaling).toEqual({ per: 5, of: "enemy-models-in-range", within: { inches: 6 }, evaluated: "on-apply" });
  });

  it("keeps a live count with no evaluated key: timing live is the same leaf as no timing", () => {
    expect(mechanicsOf(lasting({ timing: "live" }), LASTING).effect.scaling).toEqual({ per: 5, of: "enemy-models-in-range", within: { inches: 6 } });
    expect(mechanicsOf(lasting({}), LASTING).effect.scaling).toEqual({ per: 5, of: "enemy-models-in-range", within: { inches: 6 } });
    expect(normalizeFingerprintParameters("count-scale", { per: 5, timing: "live" }, currentFamilyVersion("count-scale")))
      .toEqual(normalizeFingerprintParameters("count-scale", { per: 5 }, currentFamilyVersion("count-scale")));
  });

  it("scales a selected unit's bonus by enemy units in range, capped, from the selection moment", () => {
    const text = "When this unit is selected to fight, this model's melee attacks have +1 A for each enemy unit within 6\" of this model (to a maximum of +3 A).";
    const list = placed(text, FIGHT,
      ["this model's melee attacks have", "weapon-property-scope", { subject: "this-model", weapon_type: "melee" }],
      ["+1 A", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }],
      ["for each", "count-scale", { per: 1, timing: "on-apply" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["to a maximum of +3 A", "scale-cap", { max: 3 }]);
    expect(mechanicsOf(list, text).effect.scaling).toEqual({ per: 1, of: "enemy-units-in-range", within: { inches: 6 }, max_value: 3, evaluated: "on-apply" });
  });

  it("refuses an on-apply count in a rule with no duration and no triggering moment", () => {
    const text = "This model's melee attacks have +1 A for each enemy unit within 6\" of this model.";
    const list = placed(text,
      ["This model's melee attacks have", "weapon-property-scope", { subject: "this-model", weapon_type: "melee" }],
      ["+1 A", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }],
      ["for each", "count-scale", { per: 1, timing: "on-apply" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }]);
    expect(errorsOf(list, text)).toMatch(/needs a rule that lasts/u);
  });

  it("refuses an on-apply count on an effect that is not a lasting modifier", () => {
    const text = "At the start of the Fight phase, until the end of the phase, that enemy unit suffers 1 mortal wound for every 5 enemy models within 6\" of this model.";
    const list = placed(text, PHASE_START, UNTIL_PHASE_END,
      ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
      ["for every 5", "count-scale", { per: 5, timing: "on-apply" }],
      ["enemy models", "unit-filter", { side: "enemy", level: "model" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }]);
    expect(errorsOf(list, text)).toMatch(/is for a lasting modifier/u);
  });

  it("refuses an on-apply count whose counted set holds a later event, by name", () => {
    const text = "At the start of the Fight phase, until the end of the phase, this model's melee weapons have +2 A for every 5 enemy units that Advanced this turn within 6\" of this model.";
    const list = placed(text, PHASE_START, UNTIL_PHASE_END,
      ["this model's melee weapons have +2 A", "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "add", value: 2, weapon_type: "melee" }],
      ["for every 5", "count-scale", { per: 5, timing: "on-apply" }],
      ["enemy units", "unit-filter", { side: "enemy" }],
      ["that Advanced this turn", "unit-activity", { activities: ["advanced-this-turn"], subject: "antecedent", negated: false }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }]);
    expect(errorsOf(list, text)).toMatch(/An on-apply count cannot count a later event\./u);
  });

  it("refuses an on-apply count that adds the size of an added unit", () => {
    const text = "You can add one new ALPHA unit to your army and set it up anywhere on the battlefield. That unit contains 1 model for each model in this unit.";
    const list = placed(text, ["You can", "optional-use", { who: "you" }],
      ["add one new ALPHA unit to your army", "add-unit", { source: "datasheet", count: "1", datasheet: "alpha-unit" }],
      ["set it up anywhere on the battlefield", "set-up", { subject: "antecedent", to: "battlefield" }],
      ["contains 1 model", "unit-size", { models: 1 }],
      ["for each", "count-scale", { per: 1, timing: "on-apply" }],
      ["model", "unit-filter", { side: "any", level: "model" }],
      ["in this unit", "membership", { relation: "in", of: "this-unit" }]);
    expect(errorsOf(list, text)).toMatch(/does not scale the size of an added unit/u);
  });

  it("refuses on-apply with following-items, timing outside the enum, and timing on version 1", () => {
    const version = currentFamilyVersion("count-scale");
    expect(() => normalizeFingerprintParameters("count-scale", { per: 1, counts: "following-items", timing: "on-apply" }, version)).toThrow(/following-items/u);
    expect(() => normalizeFingerprintParameters("count-scale", { per: 5, timing: "later" }, version)).toThrow(/count-scale\.timing/u);
    expect(() => normalizeFingerprintParameters("count-scale", { per: 5, timing: "on-apply" }, 1)).toThrow();
  });

  it("validates the evaluated key on a scaling block in the DSL schema", () => {
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate).toBeDefined();
    const scaled = (evaluated: unknown) => ({
      type: "stat-modifier", target: "this-model",
      modifier: { stat: "A", operation: "add", value: 2 },
      scaling: { per: 5, of: "enemy-models-in-range", within: { inches: 6 }, evaluated },
    });
    expect(validate!(scaled("on-apply"))).toBe(true);
    expect(validate!(scaled("live"))).toBe(true);
    expect(validate!(scaled("later"))).toBe(false);
  });

  it("describes an on-apply scaling as counted when the rule applies, and a live one without it", () => {
    expect(rendered(lasting({ timing: "on-apply" }), LASTING)).toMatch(/for every 5 enemy models within 6" \(counted when the rule applies\)/u);
    expect(rendered(lasting({ timing: "live" }), LASTING)).not.toMatch(/counted when the rule applies/u);
  });
});
}
