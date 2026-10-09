import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";
import { createValidator } from "../src/schema-loader.js";

/**
 * Exclusive target modes, each-target eligibility in RESTRICTIONS, and the Stratagem refusal of
 * "other". Wording is fabricated; the leaves are placed on their wording by `placed`.
 */

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment: string];

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
/** Whether a core Stratagem record with these target_restrictions is valid (only the target is under test). */
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
const DURATION: Item = ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }, "EFFECT"];
const ELIGIBLE: Item = ["is eligible to shoot and charge after falling back", "act-after-move", { subject: "antecedent", moves: ["fall-back"], acts: ["shoot", "charge"] }, "EFFECT"];
const first = { stratagem_target: "first" };
const notSame = (as: unknown) => ({ operator: "not", operands: [{ type: "same-unit", parameters: { as } }] });

describe("Round 5C Stratagem target modes (\"or\" between targets, \"Alternatively\" paid mode)", () => {
  const modal = "Movement phase. Up to two ALPHA units from your army, or one BETA unit from your army. Until the end of the turn, your unit is eligible to shoot and charge after falling back.";
  const modes: Item[] = [
    WINDOW,
    ["Up to two", "stratagem-target", { count: "up-to", count_max: 2 }, "TARGET"],
    ["ALPHA units from your army", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
    ["one", "stratagem-target", { count: "one" }, "TARGET"],
    ["BETA unit from your army", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
    DURATION,
  ];

  it("gives each mode its own targets, and a target's distinctness check stays within its mode", () => {
    const { target } = compiled(modal, ...modes, ELIGIBLE);
    expect(target).toEqual([
      { name: "first", mode: "a", count: "up-to", count_max: 2, side: "your-army", selects: "unit", required_keywords: ["ALPHA"] },
      { name: "second", mode: "b", count: "one", side: "your-army", selects: "unit", required_keywords: ["BETA"] },
    ]);
    expect(targetValid(target)).toBe(true);
  });

  it("refuses a third mode, and an optional extra target inside a mode", () => {
    const three = "Movement phase. One ALPHA unit, or one BETA unit, or one GAMMA unit. Until the end of the turn, your unit is eligible to shoot and charge after falling back.";
    expect(refused(three, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["GAMMA unit", "unit-filter", { side: "friendly", keywords: ["GAMMA"] }, "TARGET"],
      ELIGIBLE,
    )).toMatch(/more than two target modes/u);
    const optional = "Movement phase. One ALPHA unit from your army, or you can target one BETA unit from your army. Until the end of the turn, your unit is eligible to shoot and charge after falling back.";
    expect(refused(optional, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit from your army", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["you can", "optional-use", { who: "you" }, "TARGET"],
      ["target one", "stratagem-target", { count: "one" }, "TARGET"],
      ["BETA unit from your army", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      ELIGIBLE,
    )).toMatch(/optional extra target cannot sit in a target mode/u);
  });

  it("does not read \"one or more\" in the uncovered text between two targets as a mode", () => {
    const text = "Movement phase. One ALPHA unit from your army that is not within Engagement Range of one or more enemy units, and one BETA unit from your army. Until the end of the turn, your unit is eligible to shoot and charge after falling back.";
    const { target } = compiled(text, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit from your army", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["that is not within Engagement Range", "unit-state", { states: ["engaged"], subject: "this-unit", negated: true }, "TARGET"],
      ["and one", "stratagem-target", { count: "one" }, "TARGET"],
      ["BETA unit from your army", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      DURATION, ELIGIBLE);
    expect(target.map((item: Record<string, unknown>) => item.mode)).toEqual([undefined, undefined]);
  });

  it("consumes a paid mode's spend and \"instead\" into mode_cost, not an effect", () => {
    const text = "Movement phase. One ALPHA unit from your army. Alternatively, you can spend 2YP and target up to two BETA units from your army instead. Until the end of the turn, your unit is eligible to shoot and charge after falling back.";
    const { target, mechanics } = compiled(text, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit from your army", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["you can", "optional-use", { who: "you" }, "TARGET"],
      ["spend 2YP", "resource-spend", { pool: "yp-pool", amount: 2 }, "TARGET"],
      ["target up to two", "stratagem-target", { count: "up-to", count_max: 2 }, "TARGET"],
      ["BETA units from your army", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      ["instead", "instead", {}, "TARGET"],
      DURATION, ELIGIBLE);
    expect(target).toEqual([
      { name: "first", mode: "a", count: "one", side: "your-army", selects: "unit", required_keywords: ["ALPHA"] },
      { name: "second", mode: "b", mode_cost: { label: "yp-pool", amount: 2 }, count: "up-to", count_max: 2, side: "your-army", selects: "unit", required_keywords: ["BETA"] },
    ]);
    expect(targetValid(target)).toBe(true);
    expect(JSON.stringify(mechanics)).not.toContain("resource-spend");
    expect(mechanics).not.toHaveProperty("optional", true);
  });

  it("refuses a plural back-reference after modes, and reads an among-filter every across both modes", () => {
    const plural = "Movement phase. Up to two ALPHA units from your army, or one BETA unit from your army. Those units are eligible to shoot and charge after falling back.";
    expect(refused(plural, ...modes.slice(0, 5), ["Those units are eligible to shoot and charge after falling back", "act-after-move", { subject: "antecedent", moves: ["fall-back"], acts: ["shoot", "charge"] }, "EFFECT"]))
      .toMatch(/several of the Stratagem's targets/u);
    const every = "Movement phase. Up to two ALPHA units from your army, or one BETA unit from your army. Those units are eligible to shoot and charge after falling back.";
    const { mechanics } = compiled(every, ...modes.slice(0, 5),
      ["Those units", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "every" }, "EFFECT"],
      ["are eligible to shoot and charge after falling back", "act-after-move", { subject: "antecedent", moves: ["fall-back"], acts: ["shoot", "charge"] }, "EFFECT"]);
    expect(JSON.stringify(mechanics.effect)).toContain("\"first\"");
    expect(JSON.stringify(mechanics.effect)).toContain("\"second\"");
  });

  it("does not read a bare \"your unit\" as the first target when modes exist", () => {
    const bare = "Movement phase. Up to two ALPHA units from your army, or one BETA unit from your army. Until the end of the turn, your unit is eligible to shoot and charge after falling back.";
    expect(refused(bare, ...modes.slice(0, 5),
      ["your unit", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "one" }, "EFFECT"], ELIGIBLE)).toMatch(/names one target but matches 2/u);
  });

  it("refuses \"other\" on a Stratagem target, which has no bearer", () => {
    const text = "Movement phase. One ALPHA unit from your army, and one other BETA unit from your army. Until the end of the turn, your unit is eligible to shoot and charge after falling back.";
    expect(refused(text, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit from your army", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["other BETA unit from your army", "unit-filter", { side: "friendly", keywords: ["BETA"], other: true }, "TARGET"],
      ELIGIBLE)).toMatch(/has no bearer/u);
  });

  it("applies an each-target eligibility in RESTRICTIONS to every target named before it", () => {
    const text = "Movement phase. One ALPHA unit from your army and one BETA unit from your army. Each unit targeted with this Stratagem is not within Engagement Range of enemy units. Until the end of the turn, your unit is eligible to shoot and charge after falling back.";
    const items: Item[] = [
      WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit from your army", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["BETA unit from your army", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      ["Each unit targeted with this Stratagem is not within Engagement Range", "unit-state", { states: ["engaged"], subject: "each-target", negated: true }, "RESTRICTIONS"],
      DURATION, ELIGIBLE,
    ];
    const { target } = compiled(text, ...items);
    const engaged = { operator: "not", operands: [{ type: "unit-state", parameters: { state: "engaged" } }] };
    expect(target[0].eligibility).toEqual(engaged);
    expect(target[1].eligibility).toEqual({ operator: "and", operands: [engaged, notSame(first)] });
    expect(targetValid(target)).toBe(true);
    // The same condition with negated false would require engagement; it must not compile to the same eligibility.
    const flipped = items.map((item) => item[0].startsWith("Each unit") ? [item[0], item[1], { states: ["engaged"], subject: "each-target", negated: false }, item[3]] as Item : item);
    expect(compiled(text, ...flipped).target[0].eligibility).not.toEqual(engaged);
  });

  it("refuses an each-target condition on a Stratagem with one target", () => {
    const text = "Movement phase. One ALPHA unit from your army. Each unit targeted with this Stratagem is not within Engagement Range of enemy units. Until the end of the turn, your unit is eligible to shoot and charge after falling back.";
    expect(refused(text, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit from your army", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["Each unit targeted with this Stratagem is not within Engagement Range", "unit-state", { states: ["engaged"], subject: "each-target", negated: true }, "RESTRICTIONS"],
      DURATION, ELIGIBLE)).toMatch(/several targets/u);
  });
});

describe("Stratagem target_restrictions modes in the schema", () => {
  const first = { name: "first", count: "one", side: "your-army", selects: "unit", required_keywords: ["ALPHA"] };
  const second = { name: "second", count: "one", side: "your-army", selects: "unit", required_keywords: ["BETA"] };
  it("accepts two modes, each target carrying its mode, with a cost on mode b", () => {
    expect(targetValid([{ ...first, mode: "a" }, { ...second, mode: "b", mode_cost: { label: "yp-pool", amount: 2 } }])).toBe(true);
  });
  it("refuses a mixed array, a single mode, a mode_cost without a mode, and an unknown mode", () => {
    expect(targetValid([{ ...first, mode: "a" }, second])).toBe(false);
    expect(targetValid([{ ...first, mode: "a" }, { ...second, mode: "a" }])).toBe(false);
    expect(targetValid([first, { ...second, mode_cost: { label: "yp-pool", amount: 2 } }])).toBe(false);
    expect(targetValid([{ ...first, mode: "a" }, { ...second, mode: "c" }])).toBe(false);
  });
});
