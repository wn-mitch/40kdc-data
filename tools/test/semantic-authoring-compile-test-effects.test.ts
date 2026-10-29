import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { trailingTestCondition } from "../src/semantic-authoring/compile-preceding-roll.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";

/**
 * Batch 7b, effects half: test, test-exemption, destruction-rule, datasheet-swap,
 * characteristic-resolution, borrow-weapons, select-weapon.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: 1, parameters, start_byte: offset };
}

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

function rendered(base: Record<string, unknown>, leaves: CompileLeaf[]): string {
  const entry = entryWithMechanics(base, compiled(leaves).mechanics);
  const check = checkEntry(entry);
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

describe("Semantic authoring test-family compiler", () => {
  const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("compiles a bare battle-shock test against a fixed target, the most common authored shape", () => {
    expect(compiled([leaf("EFFECT", "test", { target: "this-unit", test: "battle-shock" })]).mechanics.effect)
      .toEqual({ type: "test", target: "this-unit", modifier: { test: "battle-shock" } });
    // "selected-unit" is a legal fixed target too, but (like any effect naming it) needs an
    // accompanying select-unit leaf, the same rule every other family's target follows.
    expect(compiled([
      leaf("EVENT", "select-unit", { scope: "enemy", distance: "any", visible: false }),
      leaf("EFFECT", "test", { target: "selected-unit", test: "battle-shock" }),
    ]).mechanics.effect).toEqual({ type: "select-units", selector: { filter: { owner: "enemy" }, count: { min: 1, max: 1 } }, effect: { type: "test", target: "selected-unit", modifier: { test: "battle-shock" } } });
    expect(rendered(base(), [leaf("EFFECT", "test", { target: "this-unit", test: "battle-shock" })]).length).toBeGreaterThan(0);
  });

  it("compiles an enemy-within filter target, engagement and inches ranges, matching disease-of-mirth-chaos-daemons' shape", () => {
    expect(compiled([leaf("EFFECT", "test", { target: "enemy", range: "engagement", test: "battle-shock" })]).mechanics.effect)
      .toEqual({ type: "test", target: { owner: "enemy", within: { range: "engagement", of: "this-model" } }, modifier: { test: "battle-shock" } });
    expect(compiled([leaf("EFFECT", "test", { target: "enemy", range: "inches", within_inches: 6, test: "battle-shock" })]).mechanics.effect)
      .toEqual({ type: "test", target: { owner: "enemy", within: { range: { inches: 6 }, of: "this-model" } }, modifier: { test: "battle-shock" } });
  });

  it("folds require/exclude keywords and a modifier/count/per, matching repulsed-by-weakness's shape", () => {
    expect(compiled([leaf("EFFECT", "test", {
      target: "enemy", range: "engagement", exclude_keywords: ["MONSTER", "VEHICLE"], test: "desperate-escape", per: "model",
    })]).mechanics.effect).toEqual({
      type: "test", target: { owner: "enemy", within: { range: "engagement", of: "this-model" }, none_of: ["MONSTER", "VEHICLE"] }, modifier: { test: "desperate-escape", per: "model" },
    });
    expect(compiled([leaf("EFFECT", "test", { target: "this-unit", test: "battle-shock", modifier: -1 })]).mechanics.effect)
      .toMatchObject({ modifier: { test: "battle-shock", modifier: -1 } });
  });

  it("compiles test-exemption with its window", () => {
    expect(compiled([leaf("EFFECT", "test-exemption", { target: "this-unit", test: "battle-shock", window: "phase" })]).mechanics.effect)
      .toEqual({ type: "test-exemption", target: "this-unit", modifier: { test: "battle-shock", window: "phase" } });
    expect(rendered(base(), [leaf("EFFECT", "test-exemption", { target: "this-unit", test: "battle-shock", window: "phase" })]).length).toBeGreaterThan(0);
  });

  it("refuses range/within_inches/of on a fixed (non-filtered) target", () => {
    expect(() => normalizeFingerprintParameters("test", { target: "this-unit", test: "battle-shock", range: "engagement" }, 1)).toThrow();
  });

  it("names a friendly-keyword filter, not a fixed role, as its own within.of", () => {
    expect(compiled([leaf("EFFECT", "test", {
      target: "enemy", range: "inches", within_inches: 12, of_owner: "friendly", of_keywords: ["HERETIC ASTARTES"], test: "battle-shock", modifier: -1,
    })]).mechanics.effect).toEqual({
      type: "test",
      target: { owner: "enemy", within: { range: { inches: 12 }, of: { owner: "friendly", all_of: ["HERETIC ASTARTES"] } } },
      modifier: { test: "battle-shock", modifier: -1 },
    });
  });

  it("reproduces powers-of-da-waaagh-orks' test node exactly (nested under for-each-unit; target here is its own \"selected-unit\" binding, not this family's, so pinned as this-unit)", () => {
    const entries = JSON.parse(readFileSync(join(dataRoot, "orks", "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
    const entry = entries.find((item) => item.ability_id === "powers-of-da-waaagh-orks")!;
    const find = (node: unknown, kind: string): Record<string, unknown> | undefined => {
      if (Array.isArray(node)) { for (const item of node) { const hit = find(item, kind); if (hit) return hit; } return undefined; }
      if (node === null || typeof node !== "object") return undefined;
      const record = node as Record<string, unknown>;
      if (record.type === kind) return record;
      for (const value of Object.values(record)) { const hit = find(value, kind); if (hit) return hit; }
      return undefined;
    };
    const real = find(entry.effect, "test")!;
    const compiledNode = compiled([leaf("EFFECT", "test", {
      target: "this-unit", test: "battle-shock", modifier: -1, scaling_per: 10, scaling_of: "models-in-bearer-unit", scaling_round: "down",
    })]).mechanics.effect as Record<string, unknown>;
    expect(compiledNode.modifier).toEqual(real.modifier);
    expect(compiledNode.scaling).toEqual(real.scaling);
  });

  it("refuses of and of_owner together, and of_keywords without of_owner", () => {
    expect(() => normalizeFingerprintParameters("test", { target: "enemy", range: "inches", within_inches: 6, of: "this-model", of_owner: "friendly", test: "battle-shock" }, 2)).toThrow();
    expect(() => normalizeFingerprintParameters("test", { target: "enemy", range: "inches", within_inches: 6, of_keywords: ["X"], test: "battle-shock" }, 2)).toThrow();
  });

  it("reproduces using-sir-hekhtur-imperial-knights' destruction-rule step exactly (the ability's third sequence step)", () => {
    const entry = authored("imperial-knights", "using-sir-hekhtur-imperial-knights");
    const steps = (entry.effect as { steps: unknown[] }).steps;
    expect(compiled([leaf("EFFECT", "destruction-rule", { target: "this-unit", also: "this-model" })]).mechanics.effect).toEqual(steps.at(-1));
    expect(rendered(base(), [leaf("EFFECT", "destruction-rule", { target: "this-unit", also: "this-model" })]).length).toBeGreaterThan(0);
  });

  it("compiles datasheet-swap", () => {
    expect(compiled([leaf("EFFECT", "datasheet-swap", { target: "this-unit", datasheet: "possessed-chaos-space-marines" })]).mechanics.effect)
      .toEqual({ type: "datasheet-swap", target: "this-unit", modifier: { datasheet: "possessed-chaos-space-marines" } });
    expect(rendered(base(), [leaf("EFFECT", "datasheet-swap", { target: "this-unit", datasheet: "possessed-chaos-space-marines" })]).length).toBeGreaterThan(0);
  });

  it("compiles characteristic-resolution, tie required only for the majority rule", () => {
    expect(compiled([leaf("EFFECT", "characteristic-resolution", { target: "this-unit", stat: "T", rule: "majority", tie: "highest" })]).mechanics.effect)
      .toEqual({ type: "characteristic-resolution", target: "this-unit", modifier: { stat: "T", rule: "majority", tie: "highest" } });
    expect(compiled([leaf("EFFECT", "characteristic-resolution", { target: "this-unit", stat: "AP", rule: "highest", applies_to: "wound-roll" })]).mechanics.effect)
      .toEqual({ type: "characteristic-resolution", target: "this-unit", modifier: { stat: "AP", rule: "highest", applies_to: "wound-roll" } });
    expect(() => normalizeFingerprintParameters("characteristic-resolution", { target: "this-unit", stat: "T", rule: "highest", tie: "highest" }, 1)).toThrow();
    expect(rendered(base(), [leaf("EFFECT", "characteristic-resolution", { target: "this-unit", stat: "T", rule: "majority", tie: "highest" })]).length).toBeGreaterThan(0);
  });

  it("compiles borrow-weapons (Firing Deck)", () => {
    expect(compiled([leaf("EFFECT", "borrow-weapons", { target: "this-unit", max_models: 2, weapon_type: "ranged" })]).mechanics.effect)
      .toEqual({ type: "borrow-weapons", target: "this-unit", modifier: { max_models: 2, weapons: { type: "ranged" } } });
    expect(rendered(base(), [leaf("EFFECT", "borrow-weapons", { target: "this-unit", max_models: 2 })]).length).toBeGreaterThan(0);
  });

  it("compiles select-weapon binding a name", () => {
    expect(compiled([leaf("EFFECT", "select-weapon", { target: "this-unit", bind_as: "chosen_weapon", weapon_type: "melee" })]).mechanics.effect)
      .toEqual({ type: "select-weapon", target: "this-unit", modifier: { bind_as: "chosen_weapon", weapons: { type: "melee" } } });
    expect(rendered(base(), [leaf("EFFECT", "select-weapon", { target: "this-unit", bind_as: "chosen_weapon" })]).length).toBeGreaterThan(0);
  });
});

/**
 * A condition trailing a change to the test just taken ("must take a test, subtracting 1 from that
 * test if X"). Wording is fabricated. Each test pins a defect it would let through: the whole test
 * gated on the condition, a change folded into the test unconditionally, or a refusal lost.
 */
type Item = [string, string, Record<string, unknown>];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const TEST_TAKEN: Item = ["This unit must take a Battle-shock test", "test", { target: "this-unit", test: "battle-shock" }];
const SUBTRACT_TEST: Item = ["subtracting 1 from that test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }];
const INFANTRY: Item = ["if this unit is an INFANTRY unit", "unit-keyword", { keywords: ["INFANTRY"], subject: "this-unit", negated: false }];
const CHARGE_CHANGE: Item = ["Subtract 1 from charge rolls", "roll-modifier", { roll: "charge", operation: "subtract", value: 1 }];

describe("Semantic authoring trailing condition on a change to the test just taken", () => {
  it("splits an engaged-gated Desperate Escape test in two, the -1 gated on Battle-shock (7523 shape)", () => {
    const text = "If this unit is Engaged, it must take a Desperate Escape test with -1 to those hazard rolls if that enemy unit is Battle-shocked.";
    const result = compileLeaves(placed(text,
      ["If this unit is Engaged", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false }],
      ["it must take a Desperate Escape test", "test", { target: "this-unit", test: "desperate-escape" }],
      ["with -1 to those hazard rolls", "roll-modifier", { roll: "hazard", operation: "subtract", value: 1 }],
      ["if that enemy unit is Battle-shocked", "unit-state", { states: ["battle-shocked"], subject: "this-unit", negated: false }],
    ), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toEqual({
      type: "conditional",
      condition: { type: "matches", parameters: { filter: { state: "engaged" } } },
      effect: {
        type: "sequence",
        steps: [
          { type: "conditional", condition: { type: "matches", parameters: { filter: { state: "battle-shocked" } } }, effect: { type: "test", target: "this-unit", modifier: { test: "desperate-escape", modifier: -1 } } },
          { type: "conditional", condition: { operator: "not", operands: [{ type: "matches", parameters: { filter: { state: "battle-shocked" } } }] }, effect: { type: "test", target: "this-unit", modifier: { test: "desperate-escape" } } },
        ],
      },
    });
  });

  it("gates each enemy unit's test on Below Half-strength, the -1 on that side only (6119 shape, test on the recipient)", () => {
    const text = "At the start of the Fight phase, each enemy unit within Engagement Range of this model must take a Battle-shock test, subtracting 1 from that test if that enemy unit is Below Half-strength.";
    const result = compileLeaves(placed(text,
      ["At the start of the Fight phase", "event", { kind: "phase-start", phase: "fight" }],
      ["each", "for-each-unit-select", {}],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within Engagement Range of this model", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false, with: "this-model" }],
      ["must take a Battle-shock test", "test", { target: "recipient", test: "battle-shock" }],
      ["subtracting 1 from that test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }],
      ["if that enemy unit is Below Half-strength", "unit-state", { states: ["below-half-strength"], subject: "antecedent", negated: false }],
    ), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toMatchObject({
      type: "for-each-unit",
      selector: { filter: { owner: "enemy", engaged_with: "this-model" } },
      effect: {
        type: "sequence",
        steps: [
          { type: "conditional", condition: { type: "strength", parameters: { subject: "recipient", below: "half" } }, effect: { type: "test", target: "recipient", modifier: { test: "battle-shock", modifier: -1 } } },
          { type: "conditional", condition: { operator: "not", operands: [{ type: "strength", parameters: { subject: "recipient", below: "half" } }] }, effect: { type: "test", target: "recipient", modifier: { test: "battle-shock" } } },
        ],
      },
    });
  });

  it("keeps a change to another roll as a plain conditional beside the test (no test split)", () => {
    // Baseline captured before the change: the trailing condition gates the change, which is the clause gate.
    const text = "This unit must take a Battle-shock test. Subtract 1 from charge rolls if this unit is an INFANTRY unit.";
    const result = compileLeaves(placed(text, TEST_TAKEN, CHARGE_CHANGE, INFANTRY), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toEqual({
      type: "sequence",
      steps: [
        { type: "test", target: "this-unit", modifier: { test: "battle-shock" } },
        { type: "conditional", condition: { type: "matches", parameters: { filter: { all_of: ["INFANTRY"] } } }, effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "charge", operation: "subtract", value: 1 } } },
      ],
    });
  });

  it("keeps a change with no test before it as a plain conditional change (no test to split)", () => {
    const text = "Subtract 1 from charge rolls if this unit is an INFANTRY unit.";
    const result = compileLeaves(placed(text, CHARGE_CHANGE, INFANTRY), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toEqual({
      type: "conditional",
      condition: { type: "matches", parameters: { filter: { all_of: ["INFANTRY"] } } },
      effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "charge", operation: "subtract", value: 1 } },
    });
  });

  it("refuses a comma between the change and its trailing condition", () => {
    const text = "This unit must take a Battle-shock test, subtracting 1 from that test, if this unit is an INFANTRY unit.";
    const result = compileLeaves(placed(text, TEST_TAKEN, SUBTRACT_TEST, INFANTRY), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join("; ")).toContain("no DSL shape");
  });

  it("refuses a trailing condition of two leaves with no break between them", () => {
    const text = "This unit must take a Battle-shock test, subtracting 1 from that test if this unit is an INFANTRY unit and a VEHICLE.";
    const result = compileLeaves(placed(text, TEST_TAKEN, SUBTRACT_TEST, INFANTRY,
      ["and a VEHICLE", "unit-keyword", { keywords: ["VEHICLE"], subject: "this-unit", negated: false }]), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join("; ")).toContain("no DSL shape");
  });

  it("does not attach a condition after a sentence break: the existing whole-ability gate stays (baseline captured before the change)", () => {
    const text = "This unit must take a Battle-shock test, subtracting 1 from that test. If this unit is an INFANTRY unit.";
    const result = compileLeaves(placed(text, TEST_TAKEN, SUBTRACT_TEST, ["If this unit is an INFANTRY unit", "unit-keyword", { keywords: ["INFANTRY"], subject: "this-unit", negated: false }]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toEqual({
      type: "conditional",
      condition: { type: "matches", parameters: { filter: { all_of: ["INFANTRY"] } } },
      effect: { type: "test", target: "this-unit", modifier: { test: "battle-shock", modifier: -1 } },
    });
  });

  it("splits a test inside an aura, the -1 gated on the strength condition (3532 shape: the fold reaches the aura's effect)", () => {
    const text = "Aura text: enemy units within 6\" must take a Battle-shock test, subtracting 1 from that test if that unit is Below Half-strength.";
    const result = compileLeaves(placed(text,
      ["enemy units", "unit-filter", { side: "enemy" }],
      ["within 6\"", "aura-range", { inches: 6, of: "this-model" }],
      ["must take a Battle-shock test", "test", { target: "recipient", test: "battle-shock" }],
      ["subtracting 1 from that test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }],
      ["if that unit is Below Half-strength", "unit-state", { states: ["below-half-strength"], subject: "antecedent", negated: false }],
    ), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toMatchObject({
      type: "aura",
      modifier: {
        effect: {
          type: "sequence",
          steps: [
            { type: "conditional", condition: { type: "strength", parameters: { subject: "recipient", below: "half" } }, effect: { type: "test", target: "recipient", modifier: { test: "battle-shock", modifier: -1 } } },
            { type: "conditional", condition: { operator: "not", operands: [{ type: "strength", parameters: { subject: "recipient", below: "half" } }] }, effect: { type: "test", target: "recipient", modifier: { test: "battle-shock" } } },
          ],
        },
      },
    });
  });

  it("keeps the leading gate on a test that a sentence gates, as a conjunction on both halves (8168 shape)", () => {
    const text = "Each enemy unit below Starting Strength must take a Battle-shock test, subtracting 1 from that test if that unit is a PSYKER unit.";
    const result = compileLeaves(placed(text,
      ["Each enemy unit", "unit-filter", { side: "enemy" }],
      ["below Starting Strength", "unit-state", { states: ["below-starting-strength"], subject: "antecedent", negated: false }],
      ["must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }],
      ["subtracting 1 from that test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }],
      ["if that unit is a PSYKER unit", "unit-keyword", { keywords: ["PSYKER"], subject: "antecedent", negated: false }],
    ), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const psyker = { type: "matches", parameters: { filter: { all_of: ["PSYKER"] } } };
    const below = { type: "strength", parameters: { subject: "recipient", below: "starting" } };
    expect(JSON.stringify(result.mechanics.effect)).not.toContain('"roll-modifier"');
    expect(result.mechanics.effect).toMatchObject({
      type: "sequence",
      steps: [
        { type: "conditional", condition: { operator: "and", operands: [below, { operator: "and", operands: [below, psyker] }] }, effect: { type: "test", target: { owner: "enemy" }, modifier: { test: "battle-shock", modifier: -1 } } },
        { type: "conditional", condition: { operator: "and", operands: [below, { operator: "not", operands: [{ operator: "and", operands: [below, psyker] }] }] }, effect: { type: "test", target: { owner: "enemy" }, modifier: { test: "battle-shock" } } },
      ],
    });
  });

  it("folds a change after a sentence break into the test as before, the condition gating the whole test (no split)", () => {
    const text = "This unit must take a Battle-shock test. Subtracting 1 from that test if this unit is an INFANTRY unit.";
    const result = compileLeaves(placed(text, TEST_TAKEN, ["Subtracting 1 from that test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }], INFANTRY), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toEqual({
      type: "conditional",
      condition: { type: "matches", parameters: { filter: { all_of: ["INFANTRY"] } } },
      effect: { type: "test", target: "this-unit", modifier: { test: "battle-shock", modifier: -1 } },
    });
  });

  it("splits a negated pair of keywords as the neither reading: -1 when not IMPERIUM and not CHAOS (10356 shape)", () => {
    const text = "This unit must take a Battle-shock test, subtracting 1 from that test if it is a non-IMPERIUM/CHAOS unit.";
    const result = compileLeaves(placed(text, TEST_TAKEN, SUBTRACT_TEST,
      ["if it is a non-IMPERIUM/CHAOS unit", "unit-keyword", { keywords: ["IMPERIUM", "CHAOS"], subject: "this-unit", negated: true }]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const neither = { operator: "and", operands: [
      { operator: "not", operands: [{ type: "matches", parameters: { filter: { all_of: ["IMPERIUM"] } } }] },
      { operator: "not", operands: [{ type: "matches", parameters: { filter: { all_of: ["CHAOS"] } } }] },
    ] };
    expect(result.mechanics.effect).toEqual({
      type: "sequence",
      steps: [
        { type: "conditional", condition: neither, effect: { type: "test", target: "this-unit", modifier: { test: "battle-shock", modifier: -1 } } },
        { type: "conditional", condition: { operator: "not", operands: [neither] }, effect: { type: "test", target: "this-unit", modifier: { test: "battle-shock" } } },
      ],
    });
  });

  it("splits a test on a selected unit by a trailing keyword condition on the unit taking it (6277 shape)", () => {
    const text = "Select one enemy unit. That unit must take a Battle-shock test, subtracting 2 from that test if it is a CHAOS unit.";
    const result = compileLeaves(placed(text,
      ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["That unit must take a Battle-shock test", "test", { target: "selected-unit", test: "battle-shock" }],
      ["subtracting 2 from that test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 2 }],
      ["if it is a CHAOS unit", "unit-keyword", { keywords: ["CHAOS"], subject: "antecedent", negated: false }],
    ), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toMatchObject({
      type: "select-units",
      effect: {
        type: "sequence",
        steps: [
          { type: "conditional", condition: { type: "matches", parameters: { subject: "selected-unit", filter: { all_of: ["CHAOS"] } } }, effect: { type: "test", target: "selected-unit", modifier: { test: "battle-shock", modifier: -2 } } },
          { type: "conditional", condition: { operator: "not", operands: [{ type: "matches", parameters: { subject: "selected-unit", filter: { all_of: ["CHAOS"] } } }] }, effect: { type: "test", target: "selected-unit", modifier: { test: "battle-shock" } } },
        ],
      },
    });
  });

  it("reads a change against the test right before it: only a change to that test's roll, with no modifier yet, can attach", () => {
    const text = "This unit must take a Battle-shock test, subtracting 1 from that test if this unit is an INFANTRY unit.";
    const leaves = placed(text, TEST_TAKEN, SUBTRACT_TEST, INFANTRY);
    expect(trailingTestCondition(leaves, 1, text)).toBe("attach");
    expect(trailingTestCondition(leaves, 1, undefined)).toBeNull();
    expect(trailingTestCondition([leaves[0]!, { ...leaves[1]!, parameters: { ...leaves[1]!.parameters, roll: "preceding" } }, leaves[2]!], 1, text)).toBeNull();
    expect(trailingTestCondition([leaves[0]!, { ...leaves[1]!, parameters: { ...leaves[1]!.parameters, roll: "charge" } }, leaves[2]!], 1, text)).toBeNull();
    expect(trailingTestCondition([{ ...leaves[0]!, parameters: { ...leaves[0]!.parameters, modifier: -1 } }, leaves[1]!, leaves[2]!], 1, text)).toBeNull();
    expect(trailingTestCondition([leaves[1]!, leaves[1]!], 1, text)).toBeNull();
  });
});
