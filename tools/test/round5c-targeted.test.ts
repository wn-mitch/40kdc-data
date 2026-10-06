import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { describeCondition } from "../src/translate/condition.js";

/** Leaves on their own wording in `text`, in order; a fragment name in the list switches fragment. */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>] | string>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  let fragment: string | undefined;
  const out: CompileLeaf[] = [];
  for (const item of items) {
    if (typeof item === "string") { fragment = item; continue; }
    const [wording, family, parameters] = item;
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    out.push({ role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, ...(fragment ? { fragment } : {}) });
  }
  return out;
}

function compiled(list: CompileLeaf[], text: string) {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));
const hasShot = { kind: "attacks-resolved", action_kind: "shoot" };
const move = (distance: number, lead = "Your"): [string, string, Record<string, unknown>] => [`${lead} unit can make a Normal move of up to ${distance}"`, "make-move", { subject: "this-unit", move_type: "normal", distance }];

describe("Round 5C past targeting", () => {
  it("checks targeted's own parameters", () => {
    expect(normalize("targeted", { subject: "antecedent", object: "following-filter", window: "event" })).toEqual({ subject: "antecedent", object: "following-filter", window: "event" });
    expect(normalize("targeted", { subject: "event-subject", object: "this-unit", window: "phase", attack_type: "ranged" })).toMatchObject({ attack_type: "ranged" });
    expect(() => normalize("targeted", { subject: "this-unit", object: "this-unit", window: "phase" })).toThrow(/does not target itself/u);
    expect(() => normalize("targeted", { subject: "this-model", object: "this-unit", window: "phase" })).toThrow(/does not target itself/u);
    expect(() => normalize("targeted", { subject: "event-subject", object: "this-unit", window: "turn" })).toThrow();
    expect(() => normalize("targeted", { subject: "event-subject", object: "this-unit" })).toThrow(/exactly/u);
  });

  it("keeps the older target-is-selected, hit-by-attacks and unit-activity leaves as they were", () => {
    expect(normalize("target-is-selected", {})).toEqual({});
    expect(() => normalize("target-is-selected", { by: "event-subject" })).toThrow(/together/u);
    expect(() => normalize("target-is-selected", { by: "this-unit", target: "this-unit" })).toThrow(/itself/u);
    expect(normalize("hit-by-attacks", { subject: "target" })).toEqual({ subject: "target" });
    expect(() => normalize("hit-by-attacks", { subject: "target", by: "following-filter" })).toThrow(/window phase/u);
    expect(() => normalize("unit-activity", { activities: ["made-attacks-targeting-this-phase"], subject: "this-unit", negated: false })).toThrow(/not this unit/u);
    expect(normalize("unit-activity", { activities: ["made-attacks-targeting-this-phase", "fought-this-phase"], subject: "selected-unit", negated: true }).activities)
      .toEqual(["fought-this-phase", "made-attacks-targeting-this-phase"]);
  });

  it("makes the unit an enemy targeted a Stratagem's target, bound to the attacked unit", () => {
    const text = "Your opponent's Shooting phase, when an enemy unit that targeted a friendly unengaged GROX unit has shot.\nThat GROX unit.\nYour unit can make a Normal move of up to 3\".";
    const result = compiled(placed(text,
      "WHEN",
      ["Your opponent's Shooting phase", "use-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: [] }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["that targeted a", "targeted", { subject: "antecedent", object: "following-filter", window: "event" }],
      ["friendly unengaged GROX unit", "unit-filter", { side: "friendly", keywords: ["GROX"], states: ["unengaged"] }],
      ["has shot", "event", hasShot],
      "TARGET",
      ["That GROX unit", "triggering-target", { selects: "unit", keywords: ["GROX"], match: "all" }],
      "EFFECT",
      move(3),
    ), text);
    const mechanics = result.mechanics as Record<string, any>;
    expect(mechanics.trigger).toMatchObject({ event: "attacks-resolved", subject: { owner: "enemy" }, filter: { kind: "shoot" } });
    // The enemy that shot targeted the Stratagem's own unit in that shooting, not merely some GROX unit.
    expect(mechanics.effect.condition).toEqual({ type: "happened", parameters: { event: "targets-selected", subject: "event-subject", object: "this-unit", filter: { kind: "attack" }, window: "event" } });
    expect(result.core?.target_restrictions).toEqual({
      count: "one", selects: "unit", required_keywords: ["GROX"], bound_to: "attacked-unit",
      eligibility: { operator: "not", operands: [{ type: "unit-state", parameters: { state: "engaged" } }] },
    });
  });

  it("keeps the targeted unit-filter as the object when no Stratagem target names it", () => {
    const text = "When an enemy unit has shot, if that unit targeted a friendly GROX unit this phase, your unit can make a Normal move of up to 3\".";
    const mechanics = compiled(placed(text,
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["has shot", "event", hasShot],
      ["if that unit targeted a", "targeted", { subject: "antecedent", object: "following-filter", window: "phase", attack_type: "ranged" }],
      ["friendly GROX unit", "unit-filter", { side: "friendly", keywords: ["GROX"] }],
      move(3, "your"),
    ), text).mechanics as Record<string, any>;
    expect(mechanics.effect.condition).toEqual({ type: "happened", parameters: {
      event: "targets-selected", subject: "event-subject", object: { owner: "friendly", all_of: ["GROX"] }, filter: { kind: "attack", attack_type: "ranged" }, window: "phase",
    } });
  });

  it("refuses a following-filter object with no unit-filter after it", () => {
    const text = "When an enemy unit has shot, if that unit targeted a unit, your unit can make a Normal move of up to 3\".";
    const result = compileLeaves(placed(text,
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["has shot", "event", hasShot],
      ["if that unit targeted a", "targeted", { subject: "antecedent", object: "following-filter", window: "event" }],
      move(3, "your"),
    ), text);
    expect(result.ok ? "" : result.errors.join()).toMatch(/no unit-filter follows it/u);
  });

  it("reads \"that unit targeted this unit\" after a moment as the triggering unit targeting this one", () => {
    const text = "When an enemy unit has shot, if that unit targeted this unit, your unit can make a Normal move of up to 3\".";
    const mechanics = compiled(placed(text,
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["has shot", "event", hasShot],
      ["if that unit targeted this unit", "targeted", { subject: "antecedent", object: "this-unit", window: "event" }],
      move(3, "your"),
    ), text).mechanics as Record<string, any>;
    expect(mechanics.effect.condition.parameters).toMatchObject({ subject: "event-subject", object: "this-unit", window: "event" });
  });

  it("selects only a unit that attacked this unit this phase", () => {
    const text = "Select one enemy unit that made attacks that targeted your unit this phase. That unit gets -1 to Hit rolls.";
    const mechanics = compiled(placed(text,
      ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["that made attacks that targeted your unit this phase", "unit-activity", { activities: ["made-attacks-targeting-this-phase"], subject: "antecedent", negated: false }],
      ["That unit gets -1 to Hit rolls", "roll-modifier", { roll: "hit", operation: "subtract", value: 1, subject: "antecedent" }],
    ), text).mechanics as Record<string, any>;
    expect(mechanics.effect.selector.eligibility).toEqual({ type: "happened", parameters: { event: "targets-selected", subject: "selected-unit", object: "this-unit", filter: { kind: "attack" }, window: "phase" } });
  });

  it("reads \"selected as the target of one or more attacks this phase\" as any unit targeting the subject", () => {
    const text = "While this unit was selected as the target of one or more attacks this phase, your unit can make a Normal move of up to 3\".";
    const mechanics = compiled(placed(text,
      ["this unit was selected as the target of one or more attacks this phase", "unit-activity", { activities: ["targeted-by-attacks-this-phase"], subject: "this-unit", negated: false }],
      move(3, "your"),
    ), text).mechanics as Record<string, any>;
    expect(mechanics.effect.condition).toEqual({ type: "happened", parameters: { event: "targets-selected", subject: { owner: "any" }, object: "this-unit", filter: { kind: "attack" }, window: "phase" } });
  });

  it("reads a hit this phase by the units of the unit-filter after it, and leaves the moment's own hit alone", () => {
    const text = "Each time this model makes a ranged attack that targets a unit that was hit by one or more Psychic Attacks made by a friendly ZEPHYR model this phase, add 1 to the Wound roll.";
    const list = (extra: Record<string, unknown>) => placed(text,
      ["Each time this model makes a ranged attack", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" }],
      ["that targets a unit", "unit-filter", { side: "enemy" }],
      ["that was hit by one or more", "hit-by-attacks", { subject: "target", ...extra }],
      ["Psychic Attacks", "attack-filter", { attack_type: "psychic" }],
      ["friendly ZEPHYR model", "unit-filter", { side: "friendly", keywords: ["ZEPHYR"], level: "model" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    );
    const hit = JSON.stringify(compiled(list({ window: "phase", by: "following-filter" }), text).mechanics);
    expect(hit).toContain(JSON.stringify({ type: "happened", parameters: {
      event: "after-roll", subject: { owner: "friendly", all_of: ["ZEPHYR"], level: "model" }, object: "defender", filter: { roll: "hit", result: "success", attack_type: "psychic" }, window: "phase",
    } }));
    // Without window phase the attacks are the moment's own, and a unit-filter after them names no attacker.
    const own = compileLeaves(list({}), text);
    expect(JSON.stringify(own.ok ? own.mechanics : own.errors)).not.toContain('"window":"phase"');
  });

  it("reads a named selection as the moment's selection, and still resolves the bare one with a select-unit", () => {
    const text = "Each time an enemy unit declares a charge, if this unit is selected as a target of that charge, subtract 2 from the Charge roll.";
    const mechanics = compiled(placed(text,
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["declares a charge", "event", { kind: "targets-selected", action_kind: "charge" }],
      ["this unit is selected as a target of that charge", "target-is-selected", { by: "antecedent", target: "this-unit" }],
      ["subtract 2 from the Charge roll", "roll-modifier", { roll: "charge", operation: "subtract", value: 2 }],
    ), text).mechanics as Record<string, any>;
    expect(mechanics.effect.condition).toEqual({ type: "happened", parameters: { event: "targets-selected", subject: "event-subject", object: "this-unit", window: "event" } });
    const bare = compileLeaves(placed(text, ["this unit is selected as a target of that charge", "target-is-selected", {}], ["subtract 2 from the Charge roll", "roll-modifier", { roll: "charge", operation: "subtract", value: 2 }]), text);
    expect(bare.ok ? "" : bare.errors.join()).toMatch(/select-unit/u);
  });

  it("tells ranged-only targeting apart in English", () => {
    const base = { event: "targets-selected", subject: "event-subject", object: "this-unit", filter: { kind: "attack" }, window: "event" };
    const all = describeCondition({ type: "happened", parameters: base } as never);
    const ranged = describeCondition({ type: "happened", parameters: { ...base, filter: { kind: "attack", attack_type: "ranged" } } } as never);
    expect(all).toBe("the triggering unit has selected the unit as a target");
    expect(ranged).toBe("the triggering unit has selected the unit as a target of its ranged attacks");
  });
});
