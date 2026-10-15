import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { designation } from "../src/round5c/compile-wrappers.js";

// Fabricated wording throughout: "stowed within a Hauler" stands for a unit embarked within a Transport.

/** Leaves on their own wording in `text`, in order, all in one fragment (or none). */
function placed(text: string, fragment: string | undefined, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, ...(fragment ? { fragment } : {}) };
  });
}

function compiled(text: string, fragment: string | undefined, ...items: Array<[string, string, Record<string, unknown>]>) {
  return compileLeaves(placed(text, fragment, ...items), text);
}

function mechanicsOf(text: string, fragment: string | undefined, ...items: Array<[string, string, Record<string, unknown>]>): Record<string, any> {
  const result = compiled(text, fragment, ...items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));
const EMBARKED = { states: ["embarked"], subject: "this-unit", negated: false };

describe("unit-state embarked (wave 10)", () => {
  it("compiles an embarked gate on the subject, under negation when negated", () => {
    const text = "While this model is stowed within a Hauler, add 1 to the Hit roll for this model.";
    const gate = (negated: boolean) => mechanicsOf(text, "RAW_TEXT",
      ["While this model is stowed within a Hauler", "unit-state", { states: ["embarked"], subject: "this-model", negated }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]).effect.condition;
    expect(gate(false)).toEqual({ type: "unit-state", parameters: { subject: "this-model", state: "embarked" } });
    expect(gate(true)).toEqual({ operator: "not", operands: [{ type: "unit-state", parameters: { subject: "this-model", state: "embarked" } }] });
  });

  it("compiles this unit (the default subject) with no subject parameter", () => {
    const text = "While this unit is stowed within a Hauler, add 1 to the Hit roll for this unit.";
    const condition = mechanicsOf(text, "RAW_TEXT",
      ["While this unit is stowed within a Hauler", "unit-state", EMBARKED],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]).effect.condition;
    expect(condition).toEqual({ type: "unit-state", parameters: { state: "embarked" } });
  });

  it("keeps carrying-units on its own form: the units embarked in the subject", () => {
    const text = "While a Hauler carries units, add 1 to the Hit roll for this unit.";
    const condition = mechanicsOf(text, "RAW_TEXT",
      ["While a Hauler carries units", "unit-state", { states: ["carrying-units"], subject: "this-unit", negated: false }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]).effect.condition;
    expect(condition).toEqual({ type: "unit-state", parameters: { subject: { embarked_in: "this-unit" }, state: "embarked" } });
  });

  it("refuses an earlier point, a with, another state, and a subject it does not name", () => {
    expect(() => normalize("unit-state", { ...EMBARKED, at: "phase-start" })).toThrow(/no earlier point/);
    expect(() => normalize("unit-state", { ...EMBARKED, with: "this-unit" })).toThrow(/takes no with/);
    expect(() => normalize("unit-state", { ...EMBARKED, states: ["embarked", "engaged"] })).toThrow(/other states/);
    expect(() => normalize("unit-state", { ...EMBARKED, subject: "bearer-transport" })).toThrow(/this-unit, this-model or target/);
    expect(() => normalize("unit-state", { ...EMBARKED, subject: "attacker" })).toThrow(/this-unit, this-model or target/);
    expect(normalize("unit-state", { ...EMBARKED, subject: "this-model" })).toMatchObject({ states: ["embarked"], subject: "this-model" });
  });
});

describe("bearer-transport as a subject (wave 10)", () => {
  const BATTLE = "At the start of the battle, your Hauler has the Pathfinder 9 ability.";

  it("grants a valued ability to the Transport, not to the unit", () => {
    const mech = mechanicsOf(BATTLE, undefined, ["your Hauler has the Pathfinder 9 ability", "core-ability-grant", { subject: "bearer-transport", ability: "scouts", value: 9 }]);
    expect(mech.effect).toMatchObject({ type: "ability-grant", target: "bearer-transport", modifier: { ability: "scouts", value: 9 } });
  });

  it("keeps the Transport as the target when a leader is attached (the unit-widening must not reach it)", () => {
    const text = "Attached Leader. Your Hauler has the Pathfinder 9 ability.";
    const mech = mechanicsOf(text, undefined,
      ["Attached Leader", "leading-unit", { attachment: "leading" }],
      ["Your Hauler has the Pathfinder 9 ability", "core-ability-grant", { subject: "bearer-transport", ability: "scouts", value: 9 }]);
    expect(mech.effect.effect).toMatchObject({ type: "ability-grant", target: "bearer-transport" });
    const unitText = "Attached Leader. This unit has the Pathfinder 9 ability.";
    const unit = mechanicsOf(unitText, undefined,
      ["Attached Leader", "leading-unit", { attachment: "leading" }],
      ["This unit has the Pathfinder 9 ability", "core-ability-grant", { subject: "this-unit", ability: "scouts", value: 9 }]);
    expect(unit.effect.effect).toMatchObject({ target: "this-unit" });
  });

  it("states a characteristic change and an invulnerable save on the Transport", () => {
    const text = "Its Hauler has M increased by 2 and a 5+ invulnerable save.";
    const mech = mechanicsOf(text, undefined,
      ["Its Hauler has M increased by 2", "characteristic-modifier", { subject: "bearer-transport", characteristics: ["M"], operation: "add", value: 2 }],
      ["a 5+ invulnerable save", "invulnerable-save", { subject: "bearer-transport", threshold: 5 }]);
    expect(JSON.stringify(mech.effect)).toContain('{"type":"stat-modifier","target":"bearer-transport","modifier":{"stat":"M","operation":"add","value":2}}');
    expect(JSON.stringify(mech.effect)).toContain('{"type":"invulnerable-save","target":"bearer-transport","modifier":{"invuln_sv":5}}');
  });

  it("states a negated keyword condition on the Transport", () => {
    const text = "While its Hauler is not a WALKER unit, add 2 to the M characteristic of this model.";
    const mech = mechanicsOf(text, undefined,
      ["While its Hauler is not a WALKER unit", "unit-keyword", { keywords: ["WALKER"], subject: "bearer-transport", negated: true }],
      ["add 2 to the M characteristic of this model", "characteristic-modifier", { subject: "this-model", characteristics: ["M"], operation: "add", value: 2 }]);
    expect(mech.effect.condition).toEqual({ operator: "not", operands: [{ type: "has-keyword", parameters: { subject: "bearer-transport", all_of: ["WALKER"] } }] });
  });

  it("refuses a Stratagem that names the bearer's Transport: a Stratagem has no bearer", () => {
    const text = "Fight phase. Its Hauler has M increased by 2.";
    const result = compiled(text, "stratagem-fragment",
      ["Fight phase", "use-window", { phases: [], your_phases: [], opponent_phases: [], either_phases: ["fight"] }],
      ["Its Hauler has M increased by 2", "characteristic-modifier", { subject: "bearer-transport", characteristics: ["M"], operation: "add", value: 2 }]);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/no bearer/);
  });

  it("refuses an objective range only for the Transport; other unit-position kinds reject it", () => {
    expect(() => normalize("unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "bearer-transport", negated: false })).toThrow(/only for kind objective-range/);
    expect(normalize("unit-position", { kind: "objective-range", controlled_by: "you", subject: "bearer-transport", negated: false })).toMatchObject({ subject: "bearer-transport" });
  });
});

describe("select-unit within_origin (wave 10)", () => {
  const SELECT = "Movement phase. Select one friendly unit within 6\" of its Hauler. That unit has a 5+ invulnerable save.";
  const selectWith = (parameters: Record<string, unknown>) => compiled(SELECT, undefined,
    ["Movement phase", "phase-window", { phase: "movement", turn: "your" }],
    ["Select one friendly unit within 6\" of its Hauler", "select-unit", parameters],
    ["That unit has a 5+ invulnerable save", "invulnerable-save", { subject: "antecedent", threshold: 5 }]);

  it("measures the distance from the bearer's Transport: reference beside within_inches", () => {
    const result = selectWith({ scope: "friendly", distance: "within", inches: 6, visible: false, within_origin: "bearer-transport" });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok && result.mechanics)).toContain('"within_inches":6,"reference":"bearer-transport"');
  });

  it("does not emit a reference without within_origin", () => {
    const result = selectWith({ scope: "friendly", distance: "within", inches: 6, visible: false });
    expect(JSON.stringify(result.ok && result.mechanics)).not.toContain("bearer-transport");
  });

  it("refuses a within_origin with no distance, with within_of, or with no inches", () => {
    expect(() => normalize("select-unit", { scope: "friendly", distance: "any", visible: false, within_origin: "bearer-transport" })).toThrow(/needs distance within/);
    expect(() => normalize("select-unit", { scope: "friendly", distance: "within", inches: 6, visible: false, within_origin: "bearer-transport", within_of: "anchor" })).toThrow(/name two origins/);
    expect(() => normalize("select-unit", { scope: "friendly", distance: "within", visible: false, within_origin: "bearer-transport" })).toThrow(/needs inches/);
    expect(() => selectWith({ scope: "friendly", distance: "any", visible: false, within_origin: "bearer-transport" })).toThrow(/needs a within distance/);
  });

  it("refuses a designated selection measured from the Transport (designate-target has no origin field)", () => {
    const text = "Shooting phase. Select one enemy unit within 6\" of its Hauler. Each time this unit makes an attack that targets that unit, you can re-roll the Hit roll.";
    const [select, attack] = placed(text, undefined,
      ["Select one enemy unit within 6\" of its Hauler", "select-unit", { scope: "enemy", distance: "within", inches: 6, visible: false, within_origin: "bearer-transport" }],
      ["Each time this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }]);
    expect(() => designation(select!, [attack!], {}, undefined)).toThrow(/bearer's Transport/);
  });
});

describe("embarked-permission folds into the designation before it (wave 10)", () => {
  const DESIGNATE = "At the start of the battle, select one enemy unit to be this unit's quarry.";
  const PERMIT = "This ability can be used even if this unit is stowed within a Hauler.";
  const ATTACK = "Each time this unit makes an attack that targets its quarry, you can re-roll the Hit roll.";
  const base = (...extra: Array<[string, string, Record<string, unknown>]>) => [
    ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["to be this unit's quarry", "persistent-designation-open", { designation: "prey", scope: "enemy-unit", timing: "start-of-first-battle-round", beneficiary: "this-unit" }],
    ...extra,
  ] as Array<[string, string, Record<string, unknown>]>;
  const attack: [string, string, Record<string, unknown>] = ["Each time this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }];
  const permit: [string, string, Record<string, unknown>] = ["This ability can be used even if this unit is stowed within a Hauler", "embarked-permission", { subject: "this-unit" }];
  const rerollRule: [string, string, Record<string, unknown>] = ["you can re-roll the Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all" }];
  const tagged: [string, string, Record<string, unknown>] = ["that targets its quarry", "designated-filter", { subject: "defender", tag: "prey" }];

  it("sets allow_while_embarked on the designation and drops the leaf", () => {
    const text = [DESIGNATE, PERMIT, ATTACK].join(" ");
    const result = compiled(text, "RAW_TEXT", ...base(permit, attack, tagged, rerollRule));
    expect(result.ok).toBe(true);
    const mech = result.ok ? JSON.stringify(result.mechanics) : "";
    expect(mech).toContain('"allow_while_embarked":true');
    expect(mech).not.toContain("embarked-permission");
  });

  it("leaves the designation unflagged when the leaf is absent", () => {
    const text = [DESIGNATE, ATTACK].join(" ");
    const result = compiled(text, "RAW_TEXT", ...base(attack, tagged, rerollRule));
    expect(JSON.stringify(result.ok && result.mechanics)).not.toContain("allow_while_embarked");
  });

  it("still finds the designation past an attack and a reroll between them", () => {
    const text = [DESIGNATE, ATTACK, "Its re-rolls apply.", PERMIT].join(" ");
    const result = compiled(text, "RAW_TEXT", ...base(attack, tagged, rerollRule, permit));
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok && result.mechanics)).toContain('"allow_while_embarked":true');
  });

  it("refuses when no designation precedes it in the same fragment", () => {
    const text = [DESIGNATE, PERMIT].join(" ");
    const list = [...placed(text, "A", ...base()), ...placed(text, "B", permit)];
    const result = compileLeaves(list, text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/persistent designation before it/);
  });
});

describe("objective marker range: the Transport OR the unit (wave 10)", () => {
  const CONTROL = "Movement phase. This unit (or any Hauler it is stowed within) is within range of that objective marker.";
  const UNIT = ["This unit", "unit-position", { kind: "objective-range", controlled_by: "you", subject: "this-unit", negated: false }] as [string, string, Record<string, unknown>];
  const HAULER = ["any Hauler it is stowed within", "unit-position", { kind: "objective-range", controlled_by: "you", subject: "bearer-transport", negated: false }] as [string, string, Record<string, unknown>];
  const STICKY = ["is within range of that objective marker", "sticky-objective", { subject: "this-unit" }] as [string, string, Record<string, unknown>];

  it("folds adjacent unit-position leaves into one OR", () => {
    const condition = mechanicsOf(CONTROL, "RAW_TEXT", UNIT, HAULER, STICKY).effect.condition;
    expect(condition.operator).toBe("or");
    expect(condition.operands).toEqual([
      { type: "within", parameters: { of: { objective: { controlled_by: "friendly" } }, range: "objective-control" } },
      { type: "within", parameters: { subject: "bearer-transport", of: { objective: { controlled_by: "friendly" } }, range: "objective-control" } },
    ]);
  });

  it("stacks them as AND when another leaf sits between them", () => {
    const TRANSPORT_KEYWORD = ["(or", "unit-keyword", { keywords: ["HAULER"], subject: "bearer-transport", negated: false }] as [string, string, Record<string, unknown>];
    const condition = mechanicsOf(CONTROL, "RAW_TEXT", UNIT, TRANSPORT_KEYWORD, HAULER, STICKY).effect.condition;
    expect(condition.operator).toBe("and");
  });

  it("refuses a within distance from the Transport: the bearer-transport subject is objective-range only", () => {
    expect(() => normalize("unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "bearer-transport", negated: false })).toThrow();
  });
});

describe("family registry (wave 10)", () => {
  it("registers embarked-permission as a current CONDITION family", () => {
    expect(familyRole("embarked-permission", currentFamilyVersion("embarked-permission"))).toBe("CONDITION");
  });

  it("normalizes an embarked-permission leaf so a reviewer can save one", () => {
    expect(normalize("embarked-permission", { subject: "this-unit" })).toEqual({ subject: "this-unit" });
    expect(() => normalize("embarked-permission", { subject: "this-model" })).toThrow(/this-unit/);
    expect(() => normalize("embarked-permission", { subject: "this-unit", within: 6 })).toThrow(/no parameter within/);
  });

  it("keeps the wave-10 versions above the previous current ones", () => {
    expect(currentFamilyVersion("unit-state")).toBeGreaterThanOrEqual(13);
    expect(currentFamilyVersion("select-unit")).toBeGreaterThanOrEqual(5);
  });
});
