import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { targetRestrictions } from "../src/round5c/compile-conditions.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { designationLabel } from "../src/translate/designations.js";

/** Leaves in source order at the current version of their family. */
function leaves(...items: Array<[string, Record<string, unknown>, string?]>): CompileLeaf[] {
  return items.map(([family, parameters, fragment], index) => {
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: index * 10, end_byte: index * 10 + 5, ...(fragment ? { fragment } : {}) };
  });
}

function mechanicsOf(list: CompileLeaf[]) {
  const result = compileLeaves(list);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, unknown>;
}

/** Leaves on their own wording in `text`, in order, all in one fragment. */
function placed(text: string, fragment: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment };
  });
}

const heal = (): [string, Record<string, unknown>] => ["regain-wounds", { subject: "this-unit", amount: "D3" }];

describe("Round 5C family extensions, eleventh round", () => {
  it("drops \"in any phase\" as a gate, but keeps a named turn", () => {
    const any = mechanicsOf(leaves(["phase-window", { phase: "any", turn: "either" }], heal()));
    expect(JSON.stringify(any)).not.toContain("phase-is");
    expect(any).toEqual(mechanicsOf(leaves(heal())));
    const yours = JSON.stringify(mechanicsOf(leaves(["phase-window", { phase: "any", turn: "your" }], heal())));
    expect(yours).toContain('"player-turn-is"');
    expect(yours).not.toContain("phase-is");
  });

  it("counts twice per battle as two uses a battle", () => {
    const usage = mechanicsOf(leaves(["usage-limit", { frequency: "twice-per-battle", per: "unit" }], heal())).usage;
    expect(usage).toEqual({ frequency: "n-per-battle", count: 2, per: "unit" });
  });

  it("reads \"whose attacks have been resolved this phase\" as the attacks-resolved history, not being selected", () => {
    const text = JSON.stringify(mechanicsOf(leaves(["unit-activity", { activities: ["resolved-attacks-this-phase"], subject: "this-unit", negated: false }], heal())));
    expect(text).toContain('"event":"attacks-resolved"');
    expect(text).toContain('"window":"phase"');
    expect(text).not.toContain('"to":"shoot"');
  });

  it("lets a binding alone be a Stratagem's TARGET, and still refuses two bindings", () => {
    const bound = (to: string) => leaves(["target-binding", { bound_to: to }, "TARGET"])[0]!;
    expect(targetRestrictions([bound("attacked-unit")], [])).toEqual({ count: "one", selects: "unit", bound_to: "attacked-unit" });
    expect(() => targetRestrictions([bound("attacked-unit"), bound("triggering-unit")], [])).toThrow(/bound to more than one unit/u);
  });

  it("reads engaged at an earlier point only for states the DSL can read then", () => {
    expect(normalizeFingerprintParameters("unit-state", { states: ["engaged"], subject: "event-subject", with: "this-unit", at: "phase-start", negated: false }, currentFamilyVersion("unit-state")))
      .toMatchObject({ at: "phase-start" });
    expect(() => normalizeFingerprintParameters("unit-state", { states: ["below-starting-strength"], subject: "this-unit", at: "turn-start", negated: false }, currentFamilyVersion("unit-state")))
      .toThrow(/at reads only/u);
  });
});

describe("leading-unit from the led unit's side", () => {
  it("says this unit is led by a Leader with keywords, negates, and names a selected unit", () => {
    const text = (parameters: Record<string, unknown>) => JSON.stringify(mechanicsOf(leaves(["leading-unit", parameters], heal())));
    expect(text({ subject: "this-unit", attachment: "led", leader_keywords: ["FARSEER"] }))
      .toContain('{"type":"attachment","parameters":{"role":"led","with":{"all_of":["FARSEER"]}}}');
    expect(text({ subject: "this-model", attachment: "leading", negated: true })).toContain('"operator":"not"');
    expect(text({ subject: "selected-unit", attachment: "led" })).toContain('"subject":"selected-unit"');
    expect(() => normalizeFingerprintParameters("leading-unit", { subject: "this-model", attachment: "leading", leader_keywords: ["FARSEER"] }, currentFamilyVersion("leading-unit")))
      .toThrow(/attachment led/u);
  });
});

describe("objective range against one marker", () => {
  it("names a designated marker, and refuses a selected one when nothing selects a marker", () => {
    const designated = JSON.stringify(mechanicsOf(leaves(["unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, objective: "designated", objective_tag: "acquisition" }], heal())));
    expect(designated).toContain('"of":{"objective":{"designated":"acquisition"}}');
    const unselected = compileLeaves(leaves(["unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, objective: "selected" }], heal()));
    expect(unselected.ok ? "" : unselected.errors.join()).toMatch(/selects no objective marker/u);
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, objective: "designated", objective_tag: "not-a-tag" }, currentFamilyVersion("unit-position")))
      .toThrow(/not a registered designation/u);
  });
});

describe("designations each rule prints", () => {
  it("tags a unit with the rule's own designation, and labels it as printed", () => {
    const text = JSON.stringify(mechanicsOf(leaves(["apply-mark", { subject: "this-unit", tag: "wracked-with-agonies" }])));
    expect(text).toContain('"type":"designate"');
    expect(text).toContain('"tag":"wracked-with-agonies"');
    expect(designationLabel("infested-with-snotlings")).toBe("infested with Snotlings");
    expect(designationLabel("vendetta-target")).toBe("a Vendetta target");
    expect(designationLabel("victim", true)).toBe("victims");
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: "wracked" }, currentFamilyVersion("apply-mark"))).toThrow(/not a registered designation/u);
    // Version 1's schema is frozen at the registry it was reviewed with; growing the registry must not drift it.
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: "wracked-with-agonies" }, 1)).toThrow();
    expect(normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: { source: "wracked with agonies" } }, currentFamilyVersion("apply-mark")))
      .toEqual({ subject: "this-unit", tag: { source: "wracked with agonies" } });
  });
});

describe("a unit-filter before moments joined by \"or\"", () => {
  const triggersOf = (text: string, between: string) => {
    const when = `when a friendly WALKER unit is **selected to move**${between}**declares a charge**.`;
    const leaves = placed(when, "WHEN",
      ["a friendly WALKER unit", "unit-filter", { side: "friendly", keywords: ["WALKER"] }],
      ["is **selected to move", "event", { kind: "selected", to: "move" }],
      ["**declares a charge", "event", { kind: "targets-selected", action_kind: "charge" }]);
    const version = currentFamilyVersion("regain-wounds");
    const end = Buffer.byteLength(when);
    const heal: CompileLeaf = { role: familyRole("regain-wounds", version), family_id: "regain-wounds", family_version: version, parameters: { subject: "this-unit", amount: "D3" }, start_byte: end + 1, end_byte: end + 2, fragment: "EFFECT" };
    const result = compileLeaves([...leaves, heal], `${when} ${text}`);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return (result.mechanics as { trigger: Array<{ subject?: unknown }> }).trigger;
  };

  it("gives the alternative moment the same unit", () => {
    const [move, charge] = triggersOf("x", "** or **");
    expect(charge!.subject).toEqual(move!.subject);
    expect(JSON.stringify(charge!.subject)).toContain("WALKER");
  });

  it("leaves a moment joined by other words to its own unit", () => {
    const [, charge] = triggersOf("x", "**, then later **");
    expect(JSON.stringify(charge!.subject ?? null)).not.toContain("WALKER");
  });
});

describe("a bare \"each\" before a unit-filter", () => {
  const compiled = (text: string, ...items: Array<[string, string, Record<string, unknown>]>) => {
    const result = compileLeaves(placed(text, "RAW_TEXT", ...items), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result.mechanics as { effect: Record<string, unknown> };
  };

  it("rolls once per unit in range, and \"that enemy unit\" is each pass's unit", () => {
    const text = "At the end of the Fight phase, roll one D6 for each enemy unit within 6\" of this model: on a 4+, that enemy unit suffers D3 mortal wounds.";
    const { effect } = compiled(text,
      ["At the end of the Fight phase", "event", { kind: "phase-end", phase: "fight", turn: "either" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["for each", "for-each-unit-select", {}],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["on a 4+", "roll-result", { from: 4 }],
      ["that enemy unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }]);
    expect(effect.type).toBe("for-each-unit");
    expect(effect.selector).toEqual({ owner: "enemy", within_inches: 6 });
    expect(JSON.stringify(effect.effect)).toContain('"type":"mortal-wounds","target":"recipient"');
  });

  it("takes the units engaged with this unit, and their test and its modifier are theirs", () => {
    const text = "Each enemy MONSTER unit engaged with your unit makes a Battle-shock roll, with -1 to that Battle-shock roll.";
    const { effect } = compiled(text,
      ["Each", "for-each-unit-select", {}],
      ["enemy MONSTER unit", "unit-filter", { side: "enemy", keywords: ["MONSTER"] }],
      ["engaged with your unit", "unit-state", { states: ["engaged"], subject: "antecedent", with: "this-unit", negated: false }],
      ["makes a Battle-shock roll", "test", { target: "antecedent", test: "battle-shock" }],
      ["with -1 to that Battle-shock roll", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }]);
    expect(effect.selector).toEqual({ owner: "enemy", keywords: ["MONSTER"], engagement_relation: "engaged-with-bearer", reference: "bearer-unit" });
    expect(effect.effect).toEqual({ type: "sequence", steps: [
      { type: "test", target: "recipient", modifier: { test: "battle-shock" } },
      { type: "roll-modifier", target: "recipient", modifier: { roll: "battle-shock", operation: "subtract", value: 1 } },
    ] });
  });

  it("refuses a bare \"each\" with no unit-filter after it", () => {
    const text = "Each time, this unit suffers 1 mortal wound.";
    const result = compileLeaves(placed(text, "RAW_TEXT", ["Each", "for-each-unit-select", {}], ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }]), text);
    expect(result.ok ? "" : result.errors.join()).toMatch(/needs a unit-filter right after it/u);
  });
});

describe("a change to a test another unit takes", () => {
  it("is that unit's roll, past a condition on the change", () => {
    const text = "While an enemy unit is within 6\" of this model, it must take a Desperate Escape test. If that enemy unit is Battle-shocked, subtract 1 from that test.";
    const result = compileLeaves(placed(text, "RAW_TEXT",
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["it must take a Desperate Escape test", "test", { target: "antecedent", test: "desperate-escape" }],
      ["that enemy unit is Battle-shocked", "unit-state", { states: ["battle-shocked"], subject: "antecedent", negated: false }],
      ["subtract 1 from that test", "roll-modifier", { roll: "preceding", operation: "subtract", value: 1 }]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(JSON.stringify(result.mechanics)).toContain('"type":"roll-modifier","target":"recipient","modifier":{"roll":"desperate-escape"');
  });
});

describe("a condition on each unit a filter names", () => {
  it("gates the effect per recipient, and only its own sentence", () => {
    const text = "If a friendly GRAVIS unit is within range of an objective, that unit's melee attacks have +1 A. This unit has +1 Move.";
    const result = compileLeaves(placed(text, "RAW_TEXT",
      ["friendly GRAVIS unit", "unit-filter", { side: "friendly", keywords: ["GRAVIS"] }],
      ["within range of an objective", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "antecedent", negated: false }],
      ["that unit's melee attacks have", "weapon-property-scope", { subject: "antecedent", weapon_type: "melee" }],
      ["+1 A", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }],
      ["This unit has +1 Move", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 1 }]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const steps = (result.mechanics as { effect: { steps: Array<Record<string, unknown>> } }).effect.steps;
    expect(steps[0]).toMatchObject({ type: "conditional", condition: { type: "within", parameters: { subject: "recipient" } }, effect: { target: { owner: "friendly", all_of: ["GRAVIS"] } } });
    expect(steps[1]).toMatchObject({ type: "stat-modifier", target: "this-unit" });
  });
});
