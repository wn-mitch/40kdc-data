import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { createValidator } from "../src/schema-loader.js";

type Row = [string, Record<string, unknown>];
function example() {
  const header: Row[] = [["usage-limit", { frequency: "once-per-turn", per: "model" }], ["optional-use", { who: "this-model" }]];
  const recipient: Row[] = [["unit-filter", { side: "friendly", keywords: ["EXAMPLE"] }], ["aura-range", { inches: 9, of: "this-model" }], ["event", { kind: "targets-selected", owner: "enemy", action_kind: "attack" }]];
  const groups: Row[][] = [
    [["unit-filter", { side: "enemy" }], ["event", { kind: "move-ended", move_types: ["normal", "advance", "fall-back"] }],
      ["unit-position", { subject: "event-subject", kind: "within", inches: 7, of: "matching-unit", of_side: "friendly", of_keywords: ["EXAMPLE"], negated: false }],
      ["unit-position", { subject: "antecedent", kind: "within", inches: 9, of: "this-model", negated: false }],
      ["unit-state", { subject: "antecedent", states: ["engaged"], negated: true }], ["make-move", { subject: "antecedent", move_type: "normal", distance: 4 }]],
    [["phase-window", { phase: "fight", turn: "either" }], ...recipient, ["duration", { endpoint: "end-of-phase" }],
      ["event", { kind: "model-destroyed", attack_type: "melee" }], ["unit-activity", { subject: "antecedent", activities: ["fought-this-phase"], negated: true }],
      ["dice-roll", { dice: "D6" }], ["roll-result", { from: 3 }], ["fight-on-death", { act: "fight", timing: "after-the-attacking-unit-finishes" }]],
    [["phase-window", { phase: "shooting", turn: "opponent" }], ...recipient, ["event", { kind: "attacks-resolved", owner: "enemy" }],
      ["eligibility-permission", { subject: "antecedent", activity: "shoot", allow: true, as_if: "shooting-phase" }], ["attack", { refers: "earlier-permission" }],
      ["characteristic-modifier", { subject: "attack", characteristics: ["BS"], operation: "worsen", value: 1, weapon_type: "all" }],
      ["targeting-restriction", { may: "must-target", kind: "shoot", weapon_type: "ranged", target: "event-subject", by: "antecedent" }]],
  ];
  let text = "";
  const leaves: CompileLeaf[] = [];
  const add = ([family, parameters]: Row) => {
    const version = currentFamilyVersion(family);
    leaves.push({ family_id: family, family_version: version, role: familyRole(family, version), parameters: normalizeFingerprintParameters(family, parameters, version), fragment: "RAW_TEXT", start_byte: text.length, end_byte: text.length + 4 });
    text += "test ";
  };
  header.forEach(add);
  groups.forEach((group, index) => { text += `\n**Example ${index}**\n`; group.forEach(add); });
  const result = compileLeaves(leaves, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}

describe("correlated recipient reactions", () => {
  it("retains three independent reactions under a single parent allowance", () => {
    const mechanics = example();
    expect(mechanics.usage).toEqual({ frequency: "once-per-turn", per: "model" });
    expect(mechanics.effect).toMatchObject({ type: "sequence", steps: [
      { type: "ability-part", trigger: { event: "move-ended", optional: true } },
      { type: "ability-part", trigger: { event: "targets-selected", optional: true } },
      { type: "ability-part", trigger: { event: "targets-selected", optional: true } },
    ] });
    expect(JSON.stringify(mechanics.effect)).not.toContain('"usage"');
    const validator = createValidator();
    expect(validator.validate("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json#/$defs/effect-node", mechanics.effect), JSON.stringify(validator.errors)).toBe(true);
  });

  it("does not grant a friendly movement reaction to the enemy actor", () => {
    expect(example().effect).toMatchObject({ steps: [
      { trigger: { subject: { owner: "enemy" } }, effect: {
        selector: { filter: { owner: "friendly", all_of: ["EXAMPLE"] } },
        effect: { type: "move", target: "selected-unit", modifier: { move_type: "normal", distance: 4 } },
      } }, {}, {},
    ] });
  });

  it("tests the destroyed model's own fight history, not the bearer or enemy", () => {
    expect(example().effect).toMatchObject({ steps: [{}, { effect: {
      trigger: { object: { level: "model", member_of: { event_var: "reaction-recipient" } } },
      duration: "phase", effect: { target: "event-object", modifier: {
        eligibility: { operator: "not", operands: [{ type: "happened", parameters: { subject: "event-object", window: "phase" } }] },
        gate: { threshold: 3 },
      } },
    } }, {}] });
  });

  it("waits for the same enemy's resolution before granting the recipient's ranged response", () => {
    expect(example().effect).toMatchObject({ steps: [{}, {}, { effect: {
      selector: { eligibility: { type: "same-unit", parameters: { subject: "this-unit", as: "event-subject" } } },
      effect: {
        trigger: { event: "attacks-resolved", subject: { selection_var: "reaction-enemy" } },
        effect: { effect: { steps: [
          { target: { event_var: "reaction-recipient" } },
          { condition: { type: "attack-is", parameters: { attack_type: "ranged" } } },
          { effect: { modifier: { target: "event-subject" } } },
        ] } },
      },
    } }] });
  });
});
