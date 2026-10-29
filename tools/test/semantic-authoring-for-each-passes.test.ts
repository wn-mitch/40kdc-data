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

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-glade-claim", name: "Glade Claim" });

const TEXT = "At the end of your Command phase, if a friendly SPRITE unit is controlling an objective, that objective is secured. Until you lose control of that objective, while an enemy unit is within range of that objective, that enemy unit is Spotted.";
const MOMENT: Item = ["At the end of your Command phase", "event", { kind: "phase-end", phase: "command", turn: "your" }];
const FRIENDLY_PASS: Item = ["a", "for-each-unit-select", { scope: "friendly", distance: "any" }];
const SPRITES: Item = ["friendly SPRITE unit", "unit-filter", { side: "friendly", keywords: ["SPRITE"] }];
const CONTROLS: Item = ["controlling an objective", "controls-objective", { mode: "count", count_min: 1 }];
const SECURED: Item = ["objective is secured", "sticky-objective", { subject: "recipient" }];
const UNTIL: Item = ["Until you lose control of that objective", "duration", { endpoint: "control-lost" }];
const ENEMY_PASS: Item = ["an", "for-each-unit-select", { scope: "enemy", distance: "any" }];
const ENEMY: Item = ["enemy unit", "unit-filter", { side: "enemy" }];
const IN_RANGE: Item = ["within range of that objective", "unit-position", { kind: "objective-range", controlled_by: "you", subject: "recipient", negated: false, objective: "designated", objective_tag: "secured" }];
const SPOTTED: Item = ["that enemy unit is Spotted", "apply-mark", { subject: "antecedent", tag: "spotted" }];

describe("two for-each-unit-select passes in separate sentences", () => {
  it("compile as the record plus a later part, and the secured markers are tagged for the second pass", () => {
    const result = run(TEXT, MOMENT, FRIENDLY_PASS, SPRITES, CONTROLS, SECURED, UNTIL, ENEMY_PASS, ENEMY, IN_RANGE, SPOTTED);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("sequence");
    const [first, part] = effect.steps;
    expect(JSON.stringify(first)).toContain('"type":"designate","target":"recipient","modifier":{"subject":{"objective":{"controlled_by_unit":"recipient"}},"tag":"secured"}');
    expect(part).toMatchObject({ type: "ability-part", duration: "control-lost", effect: { type: "for-each-unit", selector: { filter: { owner: "enemy" } } } });
    expect(JSON.stringify(part.effect)).toContain('"designated":"secured"');
    expect(result.mechanics.trigger).toMatchObject({ event: "phase-ended" });
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(effect), JSON.stringify(validate?.errors)).toBe(true);
    expect(describeAbility(result.mechanics as never)).toContain("Until you no longer control that objective marker");
  });

  it("refuses two passes in one sentence, and a second pass reading secured markers the first never secures", () => {
    const one = "At the end of your Command phase, a friendly SPRITE unit and an enemy unit are Spotted.";
    const same = run(one, MOMENT, FRIENDLY_PASS, SPRITES, ENEMY_PASS, ENEMY, ["are Spotted", "apply-mark", { subject: "antecedent", tag: "spotted" }]);
    expect(same.ok ? "" : same.errors.join(" ")).toContain("two for-each-unit-select passes");
    const unsecured = "At the end of your Command phase, if a friendly SPRITE unit is controlling an objective, that unit is Spotted. Until you lose control of that objective, while an enemy unit is within range of that objective, that enemy unit is Spotted.";
    const none = run(unsecured, MOMENT, FRIENDLY_PASS, SPRITES, CONTROLS, ["that unit is Spotted", "apply-mark", { subject: "antecedent", tag: "spotted" }], UNTIL, ENEMY_PASS, ENEMY, IN_RANGE, SPOTTED);
    expect(none.ok ? "" : none.errors.join(" ")).toContain("the first pass secures none");
  });
});

describe("Semantic authoring a loop in a later part, after a selection", () => {
  const text = "After this model has finished making its attacks, select one enemy unit. Until the end of the battle, that enemy unit is marked. At the start of each Command phase, roll one D6 for each marked enemy unit on the battlefield: on a 4+, that enemy unit suffers D3 mortal wounds.";
  const items: Item[] = [
    ["After this model has finished making its attacks", "event", { kind: "attacks-resolved", subject: "this-model" }],
    ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["Until the end of the battle", "duration", { endpoint: "end-of-battle" }],
    ["that enemy unit is marked", "apply-mark", { subject: "antecedent", tag: "poisoned" }],
    ["At the start of each Command phase", "event", { kind: "phase-start", phase: "command", turn: "either" }],
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["for each", "for-each-unit-select", {}],
    ["marked enemy unit", "unit-filter", { side: "enemy", designated: "poisoned" }],
    ["on the battlefield", "unit-state", { states: ["on-battlefield"], subject: "antecedent", negated: false }],
    ["on a 4+", "roll-result", { from: 4 }],
    ["that enemy unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }],
  ];

  it("selects in the first part and rolls once for each marked unit on the battlefield in the later part", () => {
    const result = run(text, ...items);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const steps = (result.mechanics.effect as { steps: Array<Record<string, any>> }).steps;
    expect(steps[0]!.effect).toMatchObject({ type: "select-units", effect: { type: "designate", target: "selected-unit", modifier: { tag: "poisoned" } } });
    expect(steps[1]!.effect).toEqual({
      type: "for-each-unit",
      selector: { filter: { owner: "enemy", state: "on-battlefield", designated: "poisoned" } },
      effect: { type: "dice-gated", dice: "D6", threshold: 4, comparison: "gte", on_success: { type: "mortal-wounds", target: "recipient", modifier: { count: "D3" } }, on_fail: null },
    });
  });

  it("still refuses a selection and a loop in the same part", () => {
    const oneSentence = "At the start of each Command phase, select one enemy unit and roll one D6 for each marked enemy unit: on a 4+, that enemy unit suffers D3 mortal wounds.";
    const result = run(oneSentence, items[4]!, ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }], items[5]!, items[6]!, items[7]!, items[9]!, items[10]!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/also loops with for-each-unit-select/u);
  });
});

describe("Semantic authoring a selection made in each pass of a loop over models", () => {
  const text = "Each time this unit ends a move, for each model in this unit that is within 3\" of one or more enemy units, select one of those enemy units. That model in this unit is destroyed, then roll one D6: on a 2+, that enemy unit suffers D3 mortal wounds.";
  const items: Item[] = [
    ["Each time this unit ends a move", "event", { kind: "move-ended", subject: "this-unit" }],
    ["for each", "for-each-unit-select", {}],
    ["model", "unit-filter", { side: "friendly", level: "model" }],
    ["in this unit", "membership", { relation: "in", of: "this-unit" }],
    ["that is within 3\" of one or more enemy units", "unit-position", { kind: "within", inches: 3, of: "matching-unit", of_side: "enemy", subject: "antecedent", negated: false }],
    ["select one of those enemy units", "select-unit", { scope: "enemy", distance: "within", inches: 3, visible: false }],
    ["That model in this unit is destroyed", "destroy-models", { recipient: "antecedent", count: "1" }],
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["on a 2+", "roll-result", { from: 2 }],
    ["that enemy unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "antecedent", count: "D3" }],
  ];

  // Hunts: the loop and the selection were refused as two bindings, and "roll one D6 … for each model" was read as one
  // die per model; "that model" bound to the selected unit and "that enemy unit" to each pass's model.
  it("loops over the unit's models near an enemy, selecting from each model and destroying that model", () => {
    const result = run(text, ...items);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toEqual({
      type: "for-each-unit",
      selector: { filter: { owner: "friendly", level: "model", member_of: "this-unit", within: { range: { inches: 3 }, of: { owner: "enemy" } } } },
      effect: {
        type: "select-units",
        selector: { filter: { owner: "enemy", within: { range: { inches: 3 }, of: "recipient" } }, count: { min: 1, max: 1 } },
        effect: { type: "sequence", steps: [
          { type: "destroy-models", target: "recipient", modifier: { count: 1 } },
          { type: "dice-gated", dice: "D6", threshold: 2, comparison: "gte", on_success: { type: "mortal-wounds", target: "selected-unit", modifier: { count: "D3" } }, on_fail: null },
        ] },
      },
    });
    expect(describeAbility(result.mechanics as never)).toContain("For each friendly model in the unit within 3\" of an enemy unit:\n    -> Select one enemy unit within 3\" of that model:\n      -> Destroy that model.");
  });

  it("refuses a loop over models with no unit they are in", () => {
    const result = run(text, ...items.filter(([, family]) => family !== "membership"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/for-each over models needs the unit they are in/u);
  });
});
