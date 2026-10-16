import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { createValidator } from "../src/schema-loader.js";

// Wave 10 per-unit-count timing: count-scale timing "on-apply" (fabricated wording only).

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

describe("Round 5C count-scale timing: a count taken once when a lasting rule applies", () => {
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
