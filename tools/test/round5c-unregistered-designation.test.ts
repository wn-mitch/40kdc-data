import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { describeAbility, describeCondition } from "../src/translate/index.js";

/** Normalized leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT",
    };
  });
}

function errorsOf(list: CompileLeaf[], text: string): string[] {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics)}`);
  return result.errors;
}

function compiled(list: CompileLeaf[], text: string): string {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return JSON.stringify(result.mechanics);
}

// Designation ids that the registry holds but the describer printed as "marked as <id>" before wave 10.
describe("describer: designation terms for the wave-10 ids", () => {
  it("prints a designation check as its printed term, not as an internal tag", () => {
    expect(describeCondition({ type: "designated", parameters: { tag: "shaken" } } as never)).toBe("the unit is shaken");
    expect(describeCondition({ type: "designated", parameters: { subject: "defender", tag: "overlapping-fire" } } as never))
      .toBe("the target unit is caught in overlapping fire");
  });

  it("prints a designation as its printed term on the effect", () => {
    const describe = (tag: string) => describeAbility({ effect: { type: "designate", target: "this-unit", modifier: { tag } }, scope: { duration: "permanent" } } as never);
    expect(describe("shaken")).toBe("The unit is shaken.");
    expect(describe("nulled")).toBe("The unit is nulled.");
    expect(describe("mutated")).toBe("The unit is mutated.");
    expect(describe("overlapping-fire")).toBe("The unit is caught in overlapping fire.");
  });
});

// "While a unit is shaken, subtract 2 from ... made for it": the check names the second Stratagem target.
describe("a designation check on a named Stratagem target", () => {
  const text = "Your Movement phase. One ALPHA unit. One BRAVO unit. While a unit is shaken, subtract 2 from the Move characteristic of that unit and subtract 2 from Advance and Charge rolls made for it.";
  const leaves = (roll: Record<string, unknown> = { subject: "antecedent", operation: "subtract", value: 2, rolls: ["advance", "charge"] }) => placed(text,
    ["Your Movement phase", "use-window", { your_phases: ["movement"], opponent_phases: [], either_phases: [] }],
    ["One", "stratagem-target", { count: "one" }],
    ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
    ["One", "stratagem-target", { count: "one" }],
    ["BRAVO unit", "unit-filter", { side: "friendly", keywords: ["BRAVO"] }],
    ["While a unit is shaken", "designated-filter", { tag: "shaken" }],
    ["subtract 2 from the Move characteristic of that unit", "characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "subtract", value: 2, weapon_type: "all" }],
    ["subtract 2 from Advance and Charge rolls made for it", "roll-modifier", roll]);

  it("binds the check to the second target, the unit the effects change", () => {
    const out = compiled(leaves(), text);
    expect(out).toContain('"condition":{"type":"designated","parameters":{"subject":{"stratagem_target":"second"},"tag":"shaken"}}');
    expect(out).toContain('"stat":"M","operation":"subtract","value":2');
    expect(out.match(/"target":\{"stratagem_target":"second"\}/gu)?.length).toBe(3);
  });

  it("refuses a roll change whose subject is this unit when the Stratagem has two targets", () => {
    const errors = errorsOf(leaves({ operation: "subtract", value: 2, rolls: ["advance", "charge"] }), text);
    expect(errors.join(" ")).toMatch(/names this unit, but the Stratagem has several targets/u);
  });
});

// "While a unit is nulled ... Ceaseless Vigilance": the printed grant form of a named ability.
describe("a printed grant whose body carries a designation check", () => {
  const text = "Advance move. One ALPHA unit. Until the end of the turn, that unit has the following ability: Iron Vigil: While this unit is nulled, its melee attacks have +1 A.";
  const head: Array<[string, string, Record<string, unknown>]> = [
    ["Advance move", "make-move", { subject: "this-unit", move_type: "advance" }],
    ["One", "stratagem-target", { count: "one" }],
    ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
  ];
  const body: Array<[string, string, Record<string, unknown>]> = [
    ["While this unit is nulled", "designated-filter", { tag: "nulled" }],
    ["its melee attacks have +1 A", "characteristic-modifier", { subject: "this-unit", characteristics: ["A"], operation: "add", value: 1, weapon_type: "melee" }],
  ];

  it("compiles the grant with the nulled check inside the granted ability", () => {
    const out = compiled(placed(text, ...head,
      ["that unit has the following ability", "ability-record-grant", { subject: "antecedent", printed: "one" }],
      ["Iron Vigil", "granted-ability-name", { label: "Iron Vigil" }],
      ...body), text);
    expect(out).toContain('"ability":"iron-vigil"');
    expect(out).toContain('"condition":{"type":"designated","parameters":{"tag":"nulled"}}');
  });

  it("refuses the printed grant when no granted-ability-name follows it", () => {
    const errors = errorsOf(placed(text, ...head,
      ["that unit has the following ability", "ability-record-grant", { subject: "antecedent", printed: "one" }],
      ...body), text);
    expect(errors.join(" ")).toMatch(/needs exactly one granted-ability-name/u);
  });
});

// "While an enemy unit is caught in overlapping fire ... that target it with a ranged attack": the attack names the attacker.
describe("an attack on a designated defender", () => {
  const text = "Shooting phase. While an enemy unit is caught in overlapping fire, models in that ALPHA unit that target that enemy unit with a ranged attack have +1 to the Hit roll.";
  const attack: [string, string, Record<string, unknown>] = ["that target that enemy unit with a ranged attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "ranged", target: "that-unit" }];
  const phase: [string, string, Record<string, unknown>] = ["Shooting phase", "phase-window", { phase: "shooting", turn: "your" }];
  const check: [string, string, Record<string, unknown>] = ["While an enemy unit is caught in overlapping fire", "designated-filter", { tag: "overlapping-fire" }];
  const hit: [string, string, Record<string, unknown>] = ["+1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }];

  it("gates the hit roll on the defender's designation and a ranged attack", () => {
    const out = compiled(placed(text, phase, check, attack, hit), text);
    expect(out).toContain('"condition":{"operator":"and","operands":[{"operator":"and","operands":[{"type":"phase-is","parameters":{"phase":"shooting"}},{"type":"player-turn-is","parameters":{"turn":"your-turn"}}]},{"type":"designated","parameters":{"subject":"defender","tag":"overlapping-fire"}},{"type":"attack-is","parameters":{"attack_type":"ranged"}}]}');
  });

  it("refuses an attack on that unit when no designation or selection names it", () => {
    const errors = errorsOf(placed(text, phase, attack, hit), text);
    expect(errors.join(" ")).toMatch(/targets 'that unit', but no designation or selection before it names the unit/u);
  });

  it("scopes the hit roll to the attacker only when a unit filter sits before the attack", () => {
    // Keeping the attacker's unit filter in front of the attack narrows the roll to that unit's models.
    const scoped = compiled(placed(text, phase, check, ["models in that ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }], attack, hit), text);
    expect(scoped).toContain('"target":{"owner":"friendly","all_of":["ALPHA"]}');
    const unscoped = compiled(placed(text, phase, check, attack, hit), text);
    expect(unscoped).toContain('"target":{"owner":"friendly"}');
  });
});

// "That enemy unit is marked ... subtract 2 from Charge rolls made for it": a roll change on the marked unit
// targets that unit, not the bearer's unit. The shape a Stratagem's marked unit takes when it has one target.
describe("a roll change on the unit a mark was applied to", () => {
  const text = "Your Shooting phase. Select one enemy unit. That enemy unit is aflame. While a unit is aflame, subtract 2 from Charge rolls made for it.";
  const leaves = (roll: Record<string, unknown>) => placed(text,
    ["Your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["That enemy unit is aflame", "apply-mark", { subject: "antecedent", tag: "aflame" }],
    ["While a unit is aflame", "designated-filter", { tag: "aflame" }],
    ["subtract 2 from Charge rolls made for it", "roll-modifier", roll]);

  it("applies the roll change to the marked unit", () => {
    const out = compiled(leaves({ subject: "antecedent", roll: "charge", operation: "subtract", value: 2 }), text);
    expect(out).toContain('"type":"roll-modifier","target":"selected-unit","modifier":{"roll":"charge","operation":"subtract","value":2}');
    expect(out).not.toContain('"type":"roll-modifier","target":"this-unit"');
  });

  it("keeps the bearer's unit as the target when the roll change names no subject", () => {
    const out = compiled(leaves({ roll: "charge", operation: "subtract", value: 2 }), text);
    expect(out).toContain('"type":"roll-modifier","target":"this-unit"');
  });
});

// "each unit struck by X suffers D3 mortal wounds" after a for-each: the check names each iterated unit. No
// lowering binds that yet, so the record is refused rather than checking the bearer's unit.
describe("a designation check on each unit a for-each passes", () => {
  const text = "Shooting phase. Roll one D6 for each enemy unit within 3\" of this model. On a 5+, the unit being rolled for is struck by spores. After resolving all of this model's attacks, each unit struck by spores suffers D3 mortal wounds.";
  const leaves = (): CompileLeaf[] => placed(text,
    ["Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["Roll one D6", "dice-roll", { dice: "D6" }],
    ["for each", "for-each-unit-select", {}],
    ["enemy unit", "unit-filter", { side: "enemy" }],
    ["within 3\" of this model", "unit-position", { kind: "within", inches: 3, of: "this-model", subject: "antecedent", negated: false }],
    ["the unit being rolled for is struck by spores", "apply-mark", { subject: "antecedent", tag: "struck-by-spores" }],
    ["After resolving all of this model's attacks", "event", { kind: "attacks-resolved" }],
    ["each", "for-each-unit-select", {}],
    ["unit", "unit-filter", { side: "any" }],
    ["struck by spores", "designated-filter", { tag: "struck-by-spores" }],
    ["suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }]);

  it("refuses the record rather than checking the bearer's unit", () => {
    const errors = errorsOf(leaves(), text);
    expect(errors.join(" ")).toMatch(/designation check on each unit a for-each passes has no DSL shape yet/u);
  });
});

// "One enemy unit hit by those attacks" on a Stratagem target: no lowering takes the hit into the target, so the
// qualifier would be dropped. The record is refused.
describe("a hit-by qualifier on a Stratagem target", () => {
  const text = "Your Shooting phase. One ALPHA unit. One enemy unit hit by one or more of those attacks has +1 to Hit rolls.";
  it("refuses the record rather than dropping the hit qualifier", () => {
    const list = placed(text,
      ["Your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["One", "stratagem-target", { count: "one" }],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["hit by one or more of those attacks", "hit-by-attacks", { subject: "antecedent" }],
    ).map((leaf) => (leaf.family_id === "hit-by-attacks" ? { ...leaf, fragment: "TARGET" } : leaf));
    expect(errorsOf(list, text).join(" ")).toMatch(/hit-by-attacks qualifier on a Stratagem target has no DSL shape yet/u);
  });

  // "just after an enemy unit has shot ... One ALPHA unit that was hit by one or more of those attacks": the window is
  // the attack moment, so the reactive trigger already carries the hit and the record compiles.
  it("compiles when the window is an enemy-has-shot moment", () => {
    const reactive = "Your opponent's Shooting phase, just after an enemy unit has shot. One ALPHA unit from your army that was hit by one or more of those attacks. Your unit can make a Normal move of up to D6\".";
    const list = placed(reactive,
      ["Your opponent's Shooting phase", "use-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: [] }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["has shot", "event", { kind: "enemy-has-shot" }],
      ["One", "stratagem-target", { count: "one" }],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["was hit by one or more of those attacks", "hit-by-attacks", { subject: "antecedent" }],
      ["Your unit can make a Normal move of up to D6", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
    ).map((leaf, i) => ({ ...leaf, fragment: ["WHEN", "WHEN", "WHEN", "TARGET", "TARGET", "TARGET", "EFFECT"][i] as CompileLeaf["fragment"] }));
    expect(compiled(list, reactive)).toContain('"event":"attacks-resolved"');
  });
});
