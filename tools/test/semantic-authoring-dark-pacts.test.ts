import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/index.js";

// Fabricated wording; no rules text. A Dark Pact's test outcome, its total, and a change to a bound use's mortal wounds.

type Item = [string, string, Record<string, unknown>];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function mechanics(text: string, ...items: Item[]): any {
  const result = compileLeaves(placed(text, ...items), text, { name: "Probe" });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}

function errors(text: string, ...items: Item[]): string[] {
  const result = compileLeaves(placed(text, ...items), text, { name: "Probe" });
  return result.ok ? [] : result.errors;
}

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

describe("Dark Pact families", () => {
  it("takes passed only on a used Dark Pact, as a boolean", () => {
    expect(normalize("event", { kind: "used", activity: "dark-pact", passed: true })).toMatchObject({ passed: true });
    expect(() => normalize("event", { kind: "used", activity: "ritual", passed: true })).toThrow(/activity is dark-pact/);
    expect(() => normalize("event", { kind: "used", activity: "dark-pact", passed: "yes" })).toThrow(/true or false/);
    // The test is bound by passed; a use binding beside it would name two different events.
    expect(() => normalize("event", { kind: "used", activity: "dark-pact", passed: true, bind_as: "pact" })).toThrow(/no bind_as/);
  });

  it("binds a used Dark Pact or contract, but still refuses other activities' qualifiers", () => {
    expect(normalize("event", { kind: "used", activity: "contract", bind_as: "pact" })).toMatchObject({ bind_as: "pact" });
    expect(() => normalize("event", { kind: "used", activity: "ritual", bind_as: "pact" })).toThrow(/Dark Pact or contract/);
    expect(() => normalize("event", { kind: "used", activity: "contract", source: ["unit"] })).toThrow(/used ability/);
  });

  it("takes passed on made-dark-pact-this-phase alone", () => {
    const base = { activities: ["made-dark-pact-this-phase"], subject: "this-unit", negated: false };
    expect(normalize("unit-activity", { ...base, passed: true })).toMatchObject({ passed: true, activities: ["made-dark-pact-this-phase"] });
    expect(() => normalize("unit-activity", { ...base, activities: ["charged-this-turn"], passed: true })).toThrow(/made-dark-pact-this-phase alone/);
    expect(() => normalize("unit-activity", { ...base, activities: ["made-dark-pact-this-phase", "charged-this-turn"], passed: true })).toThrow(/alone/);
    // Without passed the leaf is unchanged.
    expect(normalize("unit-activity", base)).not.toHaveProperty("passed");
  });

  it("bounds a Dark Pact test total by a 2D6 roll", () => {
    expect(normalize("roll-total", { roll_var: "dark-pact-test", min: 12 })).toEqual({ roll_var: "dark-pact-test", min: 12 });
    expect(() => normalize("roll-total", { roll_var: "dark-pact-test", min: 13 })).toThrow();
    expect(normalize("roll-total", { roll_var: "psychic-test", min: 13 })).toEqual({ roll_var: "psychic-test", min: 13 });
  });

  it("changes mortal wounds only of a bound use, by adding or subtracting", () => {
    const base = { subject: "antecedent", ability: { event: "used", event_var: "pact" }, aspect: "mortal-wounds", operation: "add", value: 1 };
    expect(normalize("ability-modifier", base)).toMatchObject({ aspect: "mortal-wounds", value: 1 });
    expect(() => normalize("ability-modifier", { ...base, ability: "probe-named-rule" })).toThrow(/use a trigger bound/);
    expect(() => normalize("ability-modifier", { ...base, operation: "set" })).toThrow(/use a trigger bound/);
  });
});

describe("Dark Pact compilation", () => {
  const PASS = "Each time this unit makes a pact and does not fail its test, if that test was 8 or more, you gain 1CP.";
  const moment: Item = ["Each time this unit makes a pact and does not fail its test", "event", { kind: "used", activity: "dark-pact", passed: true }];
  const gain: Item = ["you gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }];

  it("lowers a passed Dark Pact to its test's outcome and binds that test for its total", () => {
    const m = mechanics(PASS, moment, ["that test was 8 or more", "roll-total", { roll_var: "dark-pact-test", min: 8 }], gain);
    expect(m.trigger).toEqual({ event: "after-roll", filter: { roll: "dark-pact", result: "success" }, binds_roll_variable: "dark-pact-test" });
    expect(JSON.stringify(m.effect)).toContain('"roll_var":"dark-pact-test"');
    expect(describeAbility({ effect: m.effect, scope: { duration: "permanent" }, trigger: m.trigger } as never))
      .toBe("Each time the unit makes a Dark Pact and passes its Leadership test, if the Dark Pact test result is 8+, you gain 1 CP.");
  });

  it("binds nothing when no total reads the test", () => {
    const text = "Each time this unit makes a pact and does not fail its test, you gain 1CP.";
    expect(mechanics(text, moment, gain).trigger).toEqual({ event: "after-roll", filter: { roll: "dark-pact", result: "success" } });
  });

  it("refuses a Dark Pact test total with no Dark Pact test moment", () => {
    const text = "Each time this unit makes a pact, if that test was 8 or more, you gain 1CP.";
    expect(errors(text, ["Each time this unit makes a pact", "event", { kind: "used", activity: "dark-pact" }],
      ["that test was 8 or more", "roll-total", { roll_var: "dark-pact-test", min: 8 }], gain).join(" ")).toMatch(/Dark Pact moment with that test's outcome/);
  });

  it("reads a passed Dark Pact this phase as that unit's test outcome", () => {
    const text = "At the end of the Fight phase, if this unit made a pact that phase and did not fail its test, this unit suffers 1 mortal wound.";
    const m = mechanics(text,
      ["At the end of the Fight phase", "event", { kind: "phase-end", phase: "fight", turn: "either" }],
      ["if this unit made a pact that phase and did not fail its test", "unit-activity", { activities: ["made-dark-pact-this-phase"], subject: "this-unit", negated: false, passed: true }],
      ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }]);
    expect(m.effect).toMatchObject({ type: "conditional", condition: { type: "happened", parameters: { event: "after-roll", subject: "this-unit", filter: { roll: "dark-pact", result: "success" }, window: "phase" } } });
  });

  it("changes the mortal wounds of the contract use the moment binds", () => {
    const text = "Each time a friendly unit invokes its contract: if it suffers mortal wounds from that contract, add 1 to them.";
    const m = mechanics(text,
      ["friendly unit", "unit-filter", { side: "friendly" }],
      ["invokes its contract", "event", { kind: "used", activity: "contract", bind_as: "pact" }],
      ["it suffers mortal wounds from that contract, add 1 to them", "ability-modifier", { subject: "antecedent", ability: { event: "used", event_var: "pact" }, aspect: "mortal-wounds", operation: "add", value: 1 }]);
    expect(m.trigger).toMatchObject({ event: "used", filter: { kind: "contract" }, binds_event_variable: "pact" });
    expect(JSON.stringify(m.effect)).toContain('"aspect":"mortal-wounds"');
  });
});
