import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/index.js";

// Fabricated wording and identities; no rules text.

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

const TEXT = "Each time the bearer attempts a Ritual, just before rolling its Psychic test, the bearer can use this Enhancement. If it does, the bearer suffers D3 mortal wounds; if it survives, add 1 to that Psychic test for each of those mortal wounds.";

const ATTEMPT: Item = ["Each time the bearer attempts a Ritual", "event", { kind: "used", activity: "ritual" }];
const TEST: Item = ["just before rolling its Psychic test", "event", { kind: "before-roll", roll: "psychic" }];
const USE: Item = ["the bearer can use this Enhancement", "optional-use", { who: "this-model" }];
const WOUNDS = (count = "D3"): Item => [`the bearer suffers ${count} mortal wounds`, "mortal-wounds", { recipient: "this-model", count }];
const SURVIVES: Item = ["it survives", "unit-state", { states: ["on-battlefield"], subject: "this-model", negated: false }];
const BONUS: Item = ["add 1 to that Psychic test for each of those mortal wounds", "roll-modifier", { roll: "psychic", operation: "add", value: "that-many" }];

function compiled(items: Item[], text = TEXT) {
  const result = compileLeaves(placed(text, ...items), text, {});
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as any;
}

describe("a Ritual's Psychic test as one moment (compile-ritual-test.ts)", () => {
  it("folds the attempt into the test, which names the same Ritual", () => {
    const mechanics = compiled([ATTEMPT, TEST, USE, WOUNDS(), SURVIVES, BONUS]);
    expect(mechanics.trigger).toEqual({
      event: "before-roll", filter: { roll: "psychic" }, binds_event_variable: "ritual-test", optional: true,
      condition: { type: "happened", parameters: { event: "used", subject: "event-subject", filter: { kind: "ritual", same_rule_as: { event_var: "ritual-test" } }, window: "event" } },
    });
  });

  it("keeps two moments the text sets apart by more than a comma", () => {
    const text = TEXT.replace("a Ritual, just before", "a Ritual, or just before");
    expect(Array.isArray(compiled([ATTEMPT, TEST, USE, WOUNDS(), SURVIVES, BONUS], text).trigger)).toBe(true);
  });

  it("keeps an attempt with a qualifier of its own, or a test already bound, as its own moment", () => {
    const qualified: Item = [ATTEMPT[0], "event", { kind: "used", activity: "ritual", subject: "selected-unit" }];
    expect(Array.isArray(compiled([qualified, TEST, USE, WOUNDS(), SURVIVES, BONUS]).trigger)).toBe(true);
    const bound: Item = [TEST[0], "event", { kind: "before-roll", roll: "psychic", bind_as: "own-test" }];
    expect(Array.isArray(compiled([ATTEMPT, bound, USE, WOUNDS(), SURVIVES, BONUS]).trigger)).toBe(true);
  });
});

describe("a roll's bonus of \"that many\" mortal wounds (compile-that-many.ts)", () => {
  it("rolls the wounds once and adds that roll, under its condition, to the test", () => {
    const mechanics = compiled([ATTEMPT, TEST, USE, WOUNDS(), SURVIVES, BONUS]);
    expect(mechanics.effect).toEqual({ type: "roll", dice: "D3", roll_var: "that-many", effect: { type: "sequence", steps: [
      { type: "mortal-wounds", target: "this-model", modifier: { count: { roll_var: "that-many" } } },
      { type: "conditional", condition: { type: "matches", parameters: { subject: "this-model", filter: { state: "on-battlefield" } } },
        effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "psychic", operation: "add", value: { roll_var: "that-many" } } } },
    ] } });
    expect(describeAbility({ id: "sample", name: "Sample", ...mechanics })).toContain("add the result of that roll to the unit's Psychic rolls");
  });

  it("takes a fixed count as that number", () => {
    const mechanics = compiled([ATTEMPT, TEST, USE, WOUNDS("2"), SURVIVES, BONUS], TEXT.replace("D3 mortal", "2 mortal"));
    expect(JSON.stringify(mechanics)).not.toContain("roll_var");
    expect(mechanics.effect.steps[1].effect.modifier.value).toBe(2);
  });

  it("refuses a bonus with no mortal wounds before it in its sentence", () => {
    const text = TEXT.replace("mortal wounds; if it survives", "mortal wounds. If it survives");
    const result = compileLeaves(placed(text, ATTEMPT, TEST, USE, WOUNDS(), SURVIVES, BONUS), text, {});
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/roll-modifier of "that many" needs the mortal wounds/u);
  });

  it("adds that many only", () => {
    const version = currentFamilyVersion("roll-modifier");
    expect(() => normalizeFingerprintParameters("roll-modifier", { roll: "psychic", operation: "subtract", value: "that-many" }, version)).toThrow(/needs operation add/u);
    expect(() => normalizeFingerprintParameters("roll-modifier", { roll: "psychic", operation: "add", value: "that-many", cap: 2 }, version)).toThrow(/no cap or rolls/u);
  });
});
