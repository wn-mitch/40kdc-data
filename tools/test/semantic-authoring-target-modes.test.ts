import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";

/**
 * Exclusive target modes, each-target eligibility in RESTRICTIONS, and the Stratagem refusal of
 * "other". Wording is fabricated; the leaves are placed on their wording by `placed`.
 */

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment: string, mode?: "overlap"];

/** Leaves on their own wording in `text`, in order. An `overlap` item may sit inside the span before it. */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  let anchor = 0;
  return items.map(([wording, family, parameters, fragment, mode]) => {
    const overlap = mode === "overlap";
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), overlap ? anchor : from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    const end = start + Buffer.byteLength(wording, "utf8");
    if (!overlap) { from = end; anchor = start; }
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: end, fragment };
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

describe("Semantic authoring Stratagem target modes (\"or\" between targets, \"Alternatively\" paid mode)", () => {
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
    const engaged = { operator: "not", operands: [{ type: "matches", parameters: { filter: { state: "engaged" } } }] };
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

  // Hunts: "You cannot target a unit that …" on a one-target Stratagem lowered to a defender gate on the effect.
  it("applies a target condition in RESTRICTIONS to the one target's eligibility, not to the effect", () => {
    const text = "Movement phase. One ALPHA unit from your army. Until the end of the turn, your unit is eligible to shoot and charge after falling back. You cannot target a unit that is within Engagement Range of enemy units.";
    const { target, mechanics } = compiled(text, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit from your army", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      DURATION, ELIGIBLE,
      ["You cannot target a unit that is within Engagement Range", "unit-state", { states: ["engaged"], subject: "target", negated: true }, "RESTRICTIONS"]);
    expect(target.eligibility).toEqual({ operator: "not", operands: [{ type: "matches", parameters: { filter: { state: "engaged" } } }] });
    expect(JSON.stringify(mechanics)).not.toContain("defender");
    expect(targetValid(target)).toBe(true);
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

describe("Semantic authoring Stratagem target modes: a target after \"or\" needs its own stratagem-target leaf", () => {
  const WINDOW_MOVE: Item = ["Movement phase", "use-window", { your_phases: ["movement"], opponent_phases: [], either_phases: [] }, "WHEN"];

  it("refuses a second target filter that follows \"or\" with no selector for its mode", () => {
    const text = "Movement phase. One ALPHA unit, or up to two BETA units.";
    expect(refused(text, WINDOW_MOVE,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["BETA units", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"])).toMatch(/has no stratagem-target leaf/u);
  });

  it("refuses the same gap after \"Alternatively\"", () => {
    const text = "Movement phase. One ALPHA unit. Alternatively, you can target one BETA unit.";
    expect(refused(text, WINDOW_MOVE,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"])).toMatch(/has no stratagem-target leaf/u);
  });

  it("keeps adjacent alternatives in one target", () => {
    const text = "Movement phase. One ALPHA INFANTRY or ALPHA MOUNTED unit from your army. Until the end of the turn, your unit is eligible to shoot and charge after falling back.";
    const { target } = compiled(text, WINDOW_MOVE,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA INFANTRY", "unit-filter", { side: "friendly", keywords: ["ALPHA", "INFANTRY"] }, "TARGET"],
      ["ALPHA MOUNTED unit", "unit-filter", { side: "friendly", keywords: ["ALPHA", "MOUNTED"] }, "TARGET"],
      DURATION, ELIGIBLE);
    expect(Array.isArray(target)).toBe(false);
    expect(JSON.stringify(target)).toContain("INFANTRY");
    expect(JSON.stringify(target)).toContain("MOUNTED");
  });

  it("still AND-merges two target filters whose gap says \"one or more\", which is not a mode", () => {
    const text = "Movement phase. One ALPHA unit that has one or more BETA units. Until the end of the turn, your unit is eligible to shoot and charge after falling back.";
    const { target } = compiled(text, WINDOW_MOVE,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["BETA units", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
      DURATION, ELIGIBLE);
    expect(Array.isArray(target)).toBe(false);
    expect(JSON.stringify(target)).toContain("BETA");
    expect(JSON.stringify(target)).toContain("ALPHA");
  });
});

// Targeting restriction by an among-attacker: the names and keywords are invented. The sentence structure is what
// the compiler reads: a use window, two named targets, an attacker among-filter, an attack, a
// restriction whose by and target are antecedents, and an enemy among-filter inside the restriction.

const ATTACKER_TEXT = "Start of your Shooting phase. Two ALPHA units from your army that have not been selected to shoot this phase, and one enemy unit. "
  + "Until the end of the phase, each time a model in either of your units makes an attack, it can only target that enemy unit (and only if it is an eligible target for that attack).";

const WHEN: Item = ["Start of your Shooting phase.", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"];
const TWO: Item = ["Two", "stratagem-target", { count: "exactly", count_exact: 2 }, "TARGET"];
const ALPHA: Item = ["ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"];
const OWNER: Item = ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"];
const NOT_SELECTED: Item = ["that have not been selected to shoot this phase", "unit-activity", { activities: ["selected-to-shoot-this-phase"], subject: "each-target", negated: true }, "TARGET"];
const ONE: Item = ["one", "stratagem-target", { count: "one" }, "TARGET"];
const ENEMY: Item = ["enemy unit", "unit-filter", { side: "enemy" }, "TARGET"];
const UNTIL: Item = ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"];
const EITHER: Item = ["either of your units", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "any" }, "RESTRICTIONS"];
const MAKES: Item = ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }, "RESTRICTIONS"];
const RESTRICTION = (by: string, target: string): Item => ["it can only target that enemy unit (and only if it is an eligible target for that attack)", "targeting-restriction", { by, target, may: "must-target", kind: "attack", weapon_type: "all" }, "RESTRICTIONS"];
const THAT_ENEMY: Item = ["that enemy unit", "unit-filter", { side: "enemy", among: "stratagem-targets", targets: "one" }, "RESTRICTIONS", "overlap"];

const effectOk = ajv.getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;

const second = { stratagem_target: "second" };
const third = { stratagem_target: "third" };

describe("Semantic authoring targeting restriction by an among-attacker and a named enemy target", () => {
  it("binds the restriction's by to each attacker and its target to the enemy (per-attacker sequence)", () => {
    const { mechanics } = compiled(ATTACKER_TEXT, WHEN, TWO, ALPHA, OWNER, NOT_SELECTED, ONE, ENEMY, UNTIL, EITHER, MAKES, RESTRICTION("antecedent", "antecedent"), THAT_ENEMY);
    expect(mechanics.effect.type).toBe("sequence");
    const restrictions = mechanics.effect.steps.filter((step: { type: string }) => step.type === "targeting");
    expect(restrictions).toEqual([
      { type: "targeting", target: first, modifier: { by: first, may: "must-target", kind: "attack", target: third } },
      { type: "targeting", target: second, modifier: { by: second, may: "must-target", kind: "attack", target: third } },
    ]);
    expect(effectOk(mechanics.effect)).toBe(true);
  });

  it("does not take the enemy target as by, even when the enemy filter sits inside the restriction", () => {
    const { mechanics } = compiled(ATTACKER_TEXT, WHEN, TWO, ALPHA, OWNER, NOT_SELECTED, ONE, ENEMY, UNTIL, EITHER, MAKES, RESTRICTION("antecedent", "antecedent"), THAT_ENEMY);
    const json = JSON.stringify(mechanics.effect);
    expect(json).not.toContain('"by":{"stratagem_target":"third"}');
    expect(json).not.toContain("event-subject");
  });

  it("refuses an antecedent by with no among-filter naming the attacker before it", () => {
    const message = refused(ATTACKER_TEXT, WHEN, TWO, ALPHA, OWNER, NOT_SELECTED, ONE, ENEMY, UNTIL, MAKES, RESTRICTION("antecedent", "antecedent"), THAT_ENEMY);
    expect(message).toContain("no among-filter names the attacker");
  });

  it("refuses an enemy among-filter in a restriction whose target is not antecedent", () => {
    const message = refused(ATTACKER_TEXT, WHEN, TWO, ALPHA, OWNER, NOT_SELECTED, ONE, ENEMY, UNTIL, EITHER, MAKES, RESTRICTION("antecedent", "selected-unit"), THAT_ENEMY);
    expect(message).toContain("whose target is not antecedent");
  });

});

describe("Semantic authoring each-target conditions count targets, not target groups", () => {
  it("still refuses an each-target condition when only one target precedes it", () => {
    const text = "Start of your Shooting phase. One ALPHA unit that has not been selected to shoot this phase, and one enemy unit.";
    const message = refused(text,
      ["Start of your Shooting phase.", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["that has not been selected to shoot this phase", "unit-activity", { activities: ["selected-to-shoot-this-phase"], subject: "each-target", negated: true }, "TARGET"],
      ["one enemy unit", "stratagem-target", { count: "one" }, "TARGET"],
      ["enemy unit", "unit-filter", { side: "enemy" }, "TARGET", "overlap"],
    );
    expect(message).toContain("each target follows only one target");
  });
});
