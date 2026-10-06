import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";
import { createValidator } from "../src/schema-loader.js";

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment: string];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment };
  });
}

function compiled(text: string, ...items: Item[]): { mechanics: Record<string, any>; target: any } {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return { mechanics: result.mechanics as unknown as Record<string, any>, target: result.core?.target_restrictions };
}

function refused(text: string, ...items: Item[]): string {
  const result = compileLeaves(placed(text, ...items), text);
  if (result.ok) throw new Error("compiled, but should refuse");
  return result.errors.join("; ");
}

const ajv = createValidator();
const stratagemOk = ajv.getSchema("https://40kdc.dev/schemas/core/stratagem.schema.json")!;
const effectOk = ajv.getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
/** A core Stratagem record around compiled target_restrictions (only the target is under test). */
function targetValid(target: unknown): boolean {
  const record = {
    id: "fabricated-stratagem", name: "Fabricated Stratagem", faction_id: "fabricated", cp_cost: 1, category: "battle-tactic",
    phases: ["movement"], game_version: { edition: "11th", dataslate: "2026-q3" }, target_restrictions: target,
  };
  const ok = stratagemOk(record) as boolean;
  const errors = (stratagemOk.errors ?? []).filter((error) => error.instancePath.startsWith("/target_restrictions"));
  return ok || errors.length === 0;
}

const WINDOW: Item = ["Movement phase", "use-window", { your_phases: ["movement"], opponent_phases: [], either_phases: [] }, "WHEN"];
const first = { stratagem_target: "first" };
const second = { stratagem_target: "second" };
/** Stratagem targets are distinct units: a later target is not the same unit as an earlier one. */
const notSame = (as: unknown) => ({ operator: "not", operands: [{ type: "same-unit", parameters: { as } }] });

describe("Round 5C Stratagems with several targets: groups (A) and naming one (B)", () => {
  const text = "Movement phase. One ALPHA VEHICLE unit, and one friendly BETA unit within 6\" of that VEHICLE unit. Until the end of the turn, your VEHICLE unit is eligible to shoot and charge after falling back.";
  const groups: Item[] = [
    WINDOW,
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["ALPHA VEHICLE unit", "unit-filter", { side: "friendly", keywords: ["ALPHA", "VEHICLE"] }, "TARGET"],
    ["one", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
    ["within 6\" of that VEHICLE unit", "unit-position", { kind: "within", inches: 6, of: "antecedent", subject: "this-unit", negated: false }, "TARGET"],
    ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }, "EFFECT"],
  ];
  const vehicle: Item = ["your VEHICLE unit", "unit-filter", { side: "friendly", keywords: ["VEHICLE"], among: "stratagem-targets", targets: "one" }, "EFFECT"];
  const eligible: Item = ["is eligible to shoot and charge after falling back", "act-after-move", { subject: "antecedent", moves: ["fall-back"], acts: ["shoot", "charge"] }, "EFFECT"];

  it("names each target, measures the later one from the earlier one, and binds the effect to the keyword it names", () => {
    const { mechanics, target } = compiled(text, ...groups, vehicle, eligible);
    expect(target).toEqual([
      { name: "first", count: "one", side: "your-army", selects: "unit", required_keywords: ["ALPHA", "VEHICLE"] },
      { name: "second", count: "one", side: "your-army", selects: "unit", required_keywords: ["BETA"], eligibility: { operator: "and", operands: [
        { type: "within", parameters: { of: first, range: { inches: 6 } } },
        notSame(first),
      ] } },
    ]);
    expect(targetValid(target)).toBe(true);
    expect(JSON.stringify(mechanics.effect)).toContain(JSON.stringify(first));
    expect(JSON.stringify(mechanics.effect)).not.toContain("second");
    expect(effectOk(mechanics.effect)).toBe(true);
    expect(mechanics.scope).toEqual({ duration: "turn" });
  });

  it("binds a bare back-reference to the last target when nothing nearer names one", () => {
    const { mechanics } = compiled(text, ...groups, ["is eligible to shoot and charge after falling back", "act-after-move", { subject: "antecedent", moves: ["fall-back"], acts: ["shoot", "charge"] }, "EFFECT"]);
    expect(JSON.stringify(mechanics.effect)).toContain(JSON.stringify(second));
    expect(JSON.stringify(mechanics.effect)).not.toContain("\"first\"");
  });

  it("refuses this unit once there are several targets, and a filter that matches no target or more than one", () => {
    expect(refused(text, ...groups, ["is eligible to shoot and charge after falling back", "act-after-move", { subject: "this-unit", moves: ["fall-back"], acts: ["shoot", "charge"] }, "EFFECT"])).toMatch(/several targets/u);
    const vehicles = "Movement phase. One ALPHA VEHICLE unit, and one friendly BETA VEHICLE unit within 6\" of that VEHICLE unit. Until the end of the turn, your VEHICLE unit is eligible to shoot and charge after falling back.";
    const betaVehicle: Item = ["friendly BETA VEHICLE unit", "unit-filter", { side: "friendly", keywords: ["BETA", "VEHICLE"] }, "TARGET"];
    expect(refused(vehicles, ...groups.slice(0, 4), betaVehicle, groups[5]!, groups[6]!, vehicle, eligible)).toMatch(/names one target but matches 2/u);
    const enemy: Item = ["your VEHICLE unit", "unit-filter", { side: "enemy", keywords: ["VEHICLE"], among: "stratagem-targets", targets: "one" }, "EFFECT"];
    expect(refused(text, ...groups, enemy, eligible)).toMatch(/matches none/u);
  });

  it("reads a bare \"your unit\" that fits several targets as the first target", () => {
    const bare = "Movement phase. One ALPHA VEHICLE unit, and one friendly BETA unit within 6\" of that VEHICLE unit. Until the end of the turn, your unit is eligible to shoot and charge after falling back.";
    const yourUnit: Item = ["your unit", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "one" }, "EFFECT"];
    const { mechanics } = compiled(bare, ...groups, yourUnit, eligible);
    expect(JSON.stringify(mechanics.effect)).toContain(JSON.stringify(first));
    expect(JSON.stringify(mechanics.effect)).not.toContain("second");
  });

  it("refuses a bare \"your unit\" whose matches leave out the first target", () => {
    const enemyFirst = "Shooting phase. One enemy unit, and one friendly ALPHA unit and one friendly BETA unit within 6\" of it. Until the end of the turn, your unit is eligible to shoot and charge after falling back.";
    expect(refused(enemyFirst,
      ["Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["enemy unit", "unit-filter", { side: "enemy" }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      ["within 6\" of it", "unit-position", { kind: "within", inches: 6, of: "antecedent", subject: "this-unit", negated: false }, "TARGET"],
      ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }, "EFFECT"],
      ["your unit", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "one" }, "EFFECT"],
      eligible)).toMatch(/names one target but matches 2 \(second, third\)/u);
  });

  it("refuses an among-filter in a record with one target, and inside TARGET", () => {
    const single = "Movement phase. One ALPHA VEHICLE unit. Your VEHICLE unit is eligible to shoot and charge after falling back.";
    expect(refused(single, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA VEHICLE unit", "unit-filter", { side: "friendly", keywords: ["ALPHA", "VEHICLE"] }, "TARGET"],
      ["Your VEHICLE unit", "unit-filter", { side: "friendly", keywords: ["VEHICLE"], among: "stratagem-targets", targets: "one" }, "EFFECT"],
      eligible)).toMatch(/names one target/u);
    const inTarget = "Movement phase. One ALPHA VEHICLE unit, and one friendly BETA unit within 6\" of your VEHICLE unit. Until the end of the turn, your VEHICLE unit is eligible to shoot and charge after falling back.";
    expect(refused(inTarget, ...groups.slice(0, 5),
      ["within 6\" of", "unit-position", { kind: "within", inches: 6, of: "following-filter", subject: "this-unit", negated: false }, "TARGET"],
      ["your VEHICLE unit", "unit-filter", { side: "friendly", keywords: ["VEHICLE"], among: "stratagem-targets", targets: "one" }, "TARGET"],
      groups[6]!, vehicle, eligible)).toMatch(/cannot sit in TARGET/u);
  });

  it("keeps one target's output unchanged: a single object, no name", () => {
    const single = "Movement phase. One ALPHA VEHICLE unit. It is eligible to shoot and charge after falling back.";
    const { target, mechanics } = compiled(single, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA VEHICLE unit", "unit-filter", { side: "friendly", keywords: ["ALPHA", "VEHICLE"] }, "TARGET"],
      ["is eligible to shoot and charge after falling back", "act-after-move", { subject: "antecedent", moves: ["fall-back"], acts: ["shoot", "charge"] }, "EFFECT"]);
    expect(target).toEqual({ count: "one", side: "your-army", selects: "unit", required_keywords: ["ALPHA", "VEHICLE"] });
    expect(JSON.stringify(mechanics.effect)).not.toContain("stratagem_target");
  });
});

describe("Round 5C Stratagems with several targets: every and any (C), exactly N (D)", () => {
  const two = "Movement phase. Two friendly GAMMA units. Until the end of the phase, both of those units have the Feel No Pain 5+ ability.";
  const twoGroups: Item[] = [
    WINDOW,
    ["Two", "stratagem-target", { count: "exactly", count_exact: 2 }, "TARGET"],
    ["friendly GAMMA units", "unit-filter", { side: "friendly", keywords: ["GAMMA"] }, "TARGET"],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
  ];

  it("makes exactly two targets with the same restrictions, and fans an effect on both out to each", () => {
    const { target, mechanics } = compiled(two, ...twoGroups,
      ["both of those units", "unit-filter", { side: "any", among: "stratagem-targets", targets: "every" }, "EFFECT"],
      ["have the Feel No Pain 5+ ability", "feel-no-pain", { subject: "antecedent", threshold: 5, against: "all" }, "EFFECT"]);
    expect(target).toEqual([
      { name: "first", count: "one", side: "your-army", selects: "unit", required_keywords: ["GAMMA"] },
      { name: "second", count: "one", side: "your-army", selects: "unit", required_keywords: ["GAMMA"], eligibility: notSame(first) },
    ]);
    expect(targetValid(target)).toBe(true);
    expect(mechanics.effect).toEqual({ type: "sequence", steps: [
      { type: "feel-no-pain", target: first, modifier: { threshold: 5 } },
      { type: "feel-no-pain", target: second, modifier: { threshold: 5 } },
    ] });
    expect(effectOk(mechanics.effect)).toBe(true);
  });

  it("refuses one target named among two that carry the same keywords, and a back-reference to the pair as one unit", () => {
    expect(refused(two, ...twoGroups,
      ["both of those units", "unit-filter", { side: "friendly", keywords: ["GAMMA"], among: "stratagem-targets", targets: "one" }, "EFFECT"],
      ["have the Feel No Pain 5+ ability", "feel-no-pain", { subject: "antecedent", threshold: 5, against: "all" }, "EFFECT"])).toMatch(/matches 2/u);
    const third = "Movement phase. Two friendly GAMMA units and one enemy unit within 12\" of it. Until the end of the phase, that enemy unit has the Feel No Pain 5+ ability.";
    expect(refused(third, ...twoGroups.slice(0, 3),
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["enemy unit", "unit-filter", { side: "enemy" }, "TARGET"],
      ["within 12\" of it", "unit-position", { kind: "within", inches: 12, of: "antecedent", subject: "this-unit", negated: false }, "TARGET"],
      twoGroups[3]!,
      ["has the Feel No Pain 5+ ability", "feel-no-pain", { subject: "antecedent", threshold: 5, against: "all" }, "EFFECT"])).toMatch(/group of 2 targets/u);
  });

  it("fans an attack made by any one of the targets out to one effect per target", () => {
    const text = "Movement phase. Two friendly GAMMA units. Until the end of the phase, each time a model in one of those units makes a ranged attack, re-roll a Hit roll of 1.";
    const { mechanics } = compiled(text, ...twoGroups,
      ["one of those units", "unit-filter", { side: "any", among: "stratagem-targets", targets: "any" }, "EFFECT"],
      ["makes a ranged attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "ranged" }, "EFFECT"],
      ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }, "EFFECT"]);
    const steps = (JSON.stringify(mechanics.effect).match(/"re-roll"/gu) ?? []).length;
    expect(steps).toBe(2);
    expect(JSON.stringify(mechanics.effect)).toContain(JSON.stringify(first));
    expect(JSON.stringify(mechanics.effect)).toContain(JSON.stringify(second));
    expect(effectOk(mechanics.effect)).toBe(true);
  });

  it("reads a condition on every target as all of them", () => {
    const text = "Movement phase. Two friendly GAMMA units. Until the end of the phase, each time an enemy model makes an attack, if the attacker is visible to both of those units, subtract 1 from the Hit roll.";
    const { mechanics } = compiled(text, ...twoGroups,
      ["makes an attack", "attack", { direction: "makes", unit: "enemy-unit", attack_type: "any" }, "EFFECT"],
      ["the attacker is visible to", "visible", { subject: "attacker", to: "following-filter" }, "EFFECT"],
      ["both of those units", "unit-filter", { side: "any", among: "stratagem-targets", targets: "every" }, "EFFECT"],
      ["subtract 1 from the Hit roll", "roll-modifier", { roll: "hit", operation: "subtract", value: 1 }, "EFFECT"]);
    expect(JSON.stringify(mechanics.effect)).toContain(JSON.stringify({ operator: "and", operands: [
      { type: "visible", parameters: { subject: "attacker", to: first } },
      { type: "visible", parameters: { subject: "attacker", to: second } },
    ] }));
    expect(effectOk(mechanics.effect)).toBe(true);
  });
});

describe("Round 5C Stratagems with several targets: an optional gated target (E), a shared qualifier (F)", () => {
  const text = "Movement phase. One friendly ALPHA unit. If that unit is BATTLELINE, you can also target one friendly BETA unit within 6\" of it. Until the end of the phase, those units have the Feel No Pain 6+ ability.";
  const head: Item[] = [
    WINDOW,
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
  ];
  const gate: Item = ["that unit is BATTLELINE", "unit-keyword", { keywords: ["BATTLELINE"], subject: "antecedent", negated: false }, "TARGET"];
  const rest: Item[] = [
    ["target one", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
    ["within 6\" of it", "unit-position", { kind: "within", inches: 6, of: "antecedent", subject: "this-unit", negated: false }, "TARGET"],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
    ["those units", "unit-filter", { side: "any", among: "stratagem-targets", targets: "every" }, "EFFECT"],
    ["have the Feel No Pain 6+ ability", "feel-no-pain", { subject: "antecedent", threshold: 6, against: "all" }, "EFFECT"],
  ];
  const youCan: Item = ["you can", "optional-use", { who: "you" }, "TARGET"];

  it("makes the later target optional, gated on the earlier one, and leaves the Stratagem's own use alone", () => {
    const { target, mechanics } = compiled(text, ...head, gate, youCan, ...rest);
    expect(target).toEqual([
      { name: "first", count: "one", side: "your-army", selects: "unit", required_keywords: ["ALPHA"] },
      { name: "second", count: "up-to", count_max: 1, side: "your-army", selects: "unit", required_keywords: ["BETA"], eligibility: { operator: "and", operands: [
        { type: "has-keyword", parameters: { subject: first, all_of: ["BATTLELINE"] } },
        { type: "within", parameters: { of: first, range: { inches: 6 } } },
        notSame(first),
      ] } },
    ]);
    expect(targetValid(target)).toBe(true);
    // Up to one is the least an up-to target can be: zero is no target at all.
    expect(targetValid([target[0], { ...target[1], count_max: 0 }])).toBe(false);
    expect(mechanics.behavior).toBe("activated");
    expect(mechanics.trigger).toBeNull();
    expect((mechanics.effect as { steps: unknown[] }).steps).toHaveLength(2);
  });

  it("refuses a gate that is not about the earlier target, and a TARGET \"you can\" that no target follows", () => {
    expect(refused(text, ...head, [gate[0], gate[1], { ...gate[2], subject: "this-unit" }, gate[3]], youCan, ...rest)).toMatch(/subject antecedent/u);
    const late = "Movement phase. One friendly ALPHA unit. If that unit is BATTLELINE, also target one friendly BETA unit within 6\" of it, you can. Until the end of the phase, those units have the Feel No Pain 6+ ability.";
    expect(refused(late, ...head, gate, ...rest.slice(0, 3), ["you can", "optional-use", { who: "you" }, "TARGET"], ...rest.slice(3))).toMatch(/right before the later target/u);
  });

  it("copies a trailing clause with plural agreement into every target named before it", () => {
    const shared = "Movement phase. One ALPHA unit and one BETA unit from your army that have not been selected to shoot this phase. Until the end of the phase, those units have the Feel No Pain 6+ ability.";
    const { target } = compiled(shared, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      ["that have not been selected to shoot this phase", "unit-activity", { activities: ["selected-to-shoot-this-phase"], subject: "each-target", negated: true }, "TARGET"],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
      ["those units", "unit-filter", { side: "any", among: "stratagem-targets", targets: "every" }, "EFFECT"],
      ["have the Feel No Pain 6+ ability", "feel-no-pain", { subject: "antecedent", threshold: 6, against: "all" }, "EFFECT"]);
    expect(target).toHaveLength(2);
    expect(target[1].eligibility).toEqual({ operator: "and", operands: [target[0].eligibility, notSame(first)] });
    expect(JSON.stringify(target[0].eligibility)).toContain(JSON.stringify({ event: "selected", filter: { to: "shoot" }, window: "phase" }));
    expect(JSON.stringify(target[0].eligibility)).toContain("\"not\"");
    expect(targetValid(target)).toBe(true);
  });

  it("refuses each-target with one target", () => {
    const one = "Movement phase. One ALPHA unit that has not been selected to shoot this phase. It has the Feel No Pain 6+ ability.";
    expect(refused(one, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["that has not been selected to shoot this phase", "unit-activity", { activities: ["selected-to-shoot-this-phase"], subject: "each-target", negated: true }, "TARGET"],
      ["has the Feel No Pain 6+ ability", "feel-no-pain", { subject: "antecedent", threshold: 6, against: "all" }, "EFFECT"])).toMatch(/several targets/u);
  });
});

describe("Round 5C Stratagems with several targets: plural back-references", () => {
  it("refuses \"those units\" drafted as a bare back-reference instead of an among-filter", () => {
    const text = "Movement phase. One ALPHA unit and one BETA unit. Until the end of the phase, those units have the Feel No Pain 6+ ability.";
    expect(refused(text, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
      ["those units have the Feel No Pain 6+ ability", "feel-no-pain", { subject: "antecedent", threshold: 6, against: "all" }, "EFFECT"])).toMatch(/several of the Stratagem's targets/u);
  });
});

describe("Round 5C Stratagems with several targets: the target in focus", () => {
  it("binds \"that enemy unit\" to the last target, an enemy one, for a test it must take", () => {
    const text = "Shooting phase. One ALPHA unit and one enemy unit within 12\" of it. That enemy unit must take a Battle-shock test.";
    const { mechanics, target } = compiled(text,
      ["Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["enemy unit", "unit-filter", { side: "enemy" }, "TARGET"],
      ["within 12\" of it", "unit-position", { kind: "within", inches: 12, of: "antecedent", subject: "this-unit", negated: false }, "TARGET"],
      ["That enemy unit must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }, "EFFECT"]);
    expect(target[1]).toEqual({ name: "second", count: "one", side: "enemy", selects: "unit", eligibility: { type: "within", parameters: { of: first, range: { inches: 12 } } } });
    expect(mechanics.effect).toMatchObject({ type: "test", target: second });
    expect(effectOk(mechanics.effect)).toBe(true);
  });
});

describe("Round 5C Stratagems with several targets: a target with alternatives, and alternative ways to target", () => {
  const text = "Movement phase. One ALPHA or BETA unit, and one friendly ALPHA unit within 6\" of it. Until the end of the turn, your ALPHA units are eligible to shoot and charge after falling back.";
  const head: Item[] = [
    WINDOW,
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["ALPHA or BETA unit", "unit-filter", { side: "friendly", alternatives: [{ keywords: ["ALPHA"] }, { keywords: ["BETA"] }] }, "TARGET"],
    ["one", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
    ["within 6\" of it", "unit-position", { kind: "within", inches: 6, of: "antecedent", subject: "this-unit", negated: false }, "TARGET"],
    ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }, "EFFECT"],
  ];
  const eligible: Item = ["are eligible to shoot and charge after falling back", "act-after-move", { subject: "antecedent", moves: ["fall-back"], acts: ["shoot", "charge"] }, "EFFECT"];

  it("covers the first target only when it was selected as the alternative that has the keywords", () => {
    const { mechanics } = compiled(text, ...head, ["your ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"], among: "stratagem-targets", targets: "every" }, "EFFECT"], eligible);
    // Shoot and charge, each for the first target (gated) and the second.
    const steps = (mechanics.effect as { steps: Array<Record<string, unknown>> }).steps;
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatchObject({ type: "conditional", condition: { type: "has-keyword", parameters: { subject: first, all_of: ["ALPHA"] } } });
    expect(JSON.stringify(steps[0])).toContain(JSON.stringify(first));
    expect(steps[1]).toMatchObject({ type: "permission", target: second });
    expect(steps[2]).toMatchObject({ type: "conditional", effect: { target: first, modifier: { activity: "declare-charge" } } });
    expect(effectOk(mechanics.effect)).toBe(true);
  });

  it("refuses one target named by keywords only some of its alternatives have", () => {
    expect(refused(text, ...head, ["your ALPHA units", "unit-filter", { side: "friendly", keywords: ["BETA"], among: "stratagem-targets", targets: "one" }, "EFFECT"], eligible)).toMatch(/only in some of its alternatives/u);
  });

  it("refuses a target leaf after \"or\": another way to target, not a second target", () => {
    const or = "Movement phase. One friendly ALPHA unit, or one friendly BETA unit. Until the end of the turn, it is eligible to shoot and charge after falling back.";
    expect(refused(or, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }, "EFFECT"],
      ["is eligible to shoot and charge after falling back", "act-after-move", { subject: "antecedent", moves: ["fall-back"], acts: ["shoot", "charge"] }, "EFFECT"])).toMatch(/follows "or"/u);
  });
});

describe("Round 5C Stratagems with several targets: anaphors in a later target's conditions", () => {
  it("reads \"that X unit\" as a later target's condition subject as the earlier target", () => {
    const text = "Shooting phase. One friendly ALPHA unit, and one friendly BETA unit within 6\" of that ALPHA unit. Until the end of the phase, your ALPHA unit has the Feel No Pain 4+ ability.";
    const { target } = compiled(text,
      ["Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      // The distance drafted from the earlier unit's side: that ALPHA unit is within 6" of the candidate.
      ["within 6\" of that ALPHA unit", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false }, "TARGET"],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
      ["your ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"], among: "stratagem-targets", targets: "one" }, "EFFECT"],
      ["has the Feel No Pain 4+ ability", "feel-no-pain", { subject: "antecedent", threshold: 4, against: "all" }, "EFFECT"]);
    expect(target[1].eligibility).toEqual({ operator: "and", operands: [
      { type: "within", parameters: { subject: first, of: "this-unit", range: { inches: 6 } } },
      notSame(first),
    ] });
    expect(targetValid(target)).toBe(true);
  });
});

describe("Round 5C Stratagems with several targets: a unit named only inside a target's eligibility", () => {
  const text = "Fight phase, just after an enemy unit has selected its targets. One ALPHA unit from your army within 6\" of a friendly BETA unit that was selected as the target of one or more of the attacking unit's attacks. Until the end of the phase, models in your BETA unit have a 5+ invulnerable save.";
  const when: Item[] = [
    ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }, "WHEN"],
    ["just after an enemy unit has selected its targets", "event", { kind: "enemy-selected-targets" }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
    ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
    ["within 6\" of", "unit-position", { kind: "within", inches: 6, of: "following-filter", subject: "this-unit", negated: false }, "TARGET"],
    ["friendly BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
  ];
  const binding: Item = ["that was selected as the target of one or more of the attacking unit's attacks", "target-binding", { bound_to: "attacked-unit" }, "TARGET"];
  const effect: Item[] = [
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
    ["your BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"], among: "stratagem-targets", targets: "one" }, "EFFECT"],
    ["have a 5+ invulnerable save", "invulnerable-save", { subject: "antecedent", threshold: 5 }, "EFFECT"],
  ];

  it("makes the attacked unit a bound target the distance is measured from, and the effect's recipient", () => {
    const { target, mechanics } = compiled(text, ...when, binding, ...effect);
    expect(target).toEqual([
      { name: "first", count: "one", side: "your-army", selects: "unit", required_keywords: ["ALPHA"], eligibility: { operator: "and", operands: [
        { type: "owned-by", parameters: { owner: "friendly" } },
        { type: "within", parameters: { of: second, range: { inches: 6 } } },
      ] } },
      { name: "second", count: "one", side: "your-army", selects: "unit", required_keywords: ["BETA"], bound_to: "attacked-unit", eligibility: notSame(first) },
    ]);
    expect(targetValid(target)).toBe(true);
    expect(mechanics.effect).toMatchObject({ type: "invulnerable-save", target: second });
    expect(effectOk(mechanics.effect)).toBe(true);
    // The moment's attacked unit is the bound target.
    expect(mechanics.trigger).toMatchObject({ event: "targets-selected", object: second });
  });

  it("keeps a distance to a filtered unit with no binding a check on the one target", () => {
    const loose = "Fight phase, just after an enemy unit has selected its targets. One ALPHA unit from your army within 6\" of a friendly BETA unit. Until the end of the phase, models in it have a 5+ invulnerable save.";
    const result = compileLeaves(placed(loose, ...when,
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
      ["have a 5+ invulnerable save", "invulnerable-save", { subject: "antecedent", threshold: 5 }, "EFFECT"]), loose);
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.core?.target_restrictions)).toBe(false);
  });
});

describe("Round 5C Stratagems with several targets: the attacked unit and a second friendly unit", () => {
  it("binds the moment and a bare \"your unit\" to the first, attacked target", () => {
    const text = "Fight phase, just after an enemy unit has selected its targets. One ALPHA unit from your army that was selected as the target of one or more of the attacking unit's attacks, and one friendly BETA unit within 6\" of that ALPHA unit. Until the end of the phase, your unit has the Feel No Pain 4+ ability.";
    const { target, mechanics } = compiled(text,
      ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }, "WHEN"],
      ["just after an enemy unit has selected its targets", "event", { kind: "enemy-selected-targets" }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
      ["that was selected as the target of one or more of the attacking unit's attacks", "target-binding", { bound_to: "attacked-unit" }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      ["within 6\" of that ALPHA unit", "unit-position", { kind: "within", inches: 6, of: "antecedent", subject: "this-unit", negated: false }, "TARGET"],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
      ["your unit", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "one" }, "EFFECT"],
      ["has the Feel No Pain 4+ ability", "feel-no-pain", { subject: "antecedent", threshold: 4, against: "all" }, "EFFECT"]);
    expect(target[0]).toMatchObject({ name: "first", bound_to: "attacked-unit" });
    expect(target[1]).toMatchObject({ name: "second", eligibility: { operator: "and", operands: [{ type: "within", parameters: { of: first } }, notSame(first)] } });
    expect(mechanics.effect).toMatchObject({ type: "feel-no-pain", target: first });
    expect(mechanics.trigger).toMatchObject({ event: "targets-selected", object: first });
    expect(targetValid(target)).toBe(true);
  });
});
