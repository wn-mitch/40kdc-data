import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/round5c/compile.js";
import type { CompileLeaf } from "../src/round5c/compile-fragments.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

let at = 0;
function leaf(family_id: string, parameters: Record<string, unknown>, fragment?: string): CompileLeaf {
  const family_version = currentFamilyVersion(family_id);
  at += 10;
  return {
    role: familyRole(family_id, family_version), family_id, family_version,
    parameters: normalizeFingerprintParameters(family_id, parameters, family_version), start_byte: at, ...(fragment ? { fragment } : {}),
  };
}

/** Fabricated rule ids: the tests pin binding and lowering, not any rule's wording. */
const SUPPRESSED_ABILITY = { subject: "antecedent", direction: "suppressed", rule_kind: "ability", rule: "sample-suppressed-rule" };
const GRANTED_RULE = { subject: "antecedent", direction: "granted", rule_kind: "faction-rule", rule: "sample-granted-rule" };
const filterDeathleaper = () => leaf("unit-filter", { side: "friendly", keywords: ["SAMPLE-ALPHA"] });

describe("Round 5C rule-state subject bound to a filtered set or an aura's recipient", () => {
  it("binds a suppression's 'loses that rule' to the filtered units (SS-B, the unit filter then the suppression)", () => {
    const result = compileLeaves([filterDeathleaper(), leaf("rule-state", SUPPRESSED_ABILITY)]);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('"target":{"owner":"friendly","all_of":["SAMPLE-ALPHA"]}');
    expect(JSON.stringify(result)).not.toContain("antecedent");
  });

  it("binds a suppression on model-level filtered units to the same shape (SS-B, the 8448 span)", () => {
    const models = leaf("unit-filter", { side: "friendly", keywords: ["SAMPLE-BRAVO"], level: "model" });
    const result = compileLeaves([models, leaf("rule-state", { ...SUPPRESSED_ABILITY, rule: "sample-bravo-rule" })]);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('"all_of":["SAMPLE-BRAVO"],"level":"model"');
  });

  it("keeps refusing a granted rule-state on an aura's recipient: a region or range-based count is its mechanic, not a grant", () => {
    const aura = [filterDeathleaper(), leaf("aura-range", { inches: 9, of: "this-model" })];
    expect(compileLeaves([...aura, leaf("rule-state", GRANTED_RULE)])).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/points back to the recipient, which its subject cannot name\./u)],
    });
  });

  it("compiles an aura's 'that unit is within your army's named region' as a counts-as with the region", () => {
    const aura = [filterDeathleaper(), leaf("aura-range", { inches: 6, of: "this-model" })];
    const result = compileLeaves([...aura, leaf("counts-as", { subject: "antecedent", region: { region_id: "the-shadow-of-chaos", owner_faction: "chaos-daemons" } })]);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('"type":"counts-as","target":"recipient","modifier":{"in_region":{"rule_region":{"region_id":"the-shadow-of-chaos","owner_faction":"chaos-daemons"}}}');
  });

  it("PARTIAL (5802): binds a unit-position's 'that unit is within 9 of this unit' subject to the filtered units; the counts-as leaf is pending the named-range-reference mechanism", () => {
    const stratagem = [
      leaf("use-window", { your_phases: ["command"], opponent_phases: [], either_phases: [] }, "WHEN"),
      leaf("stratagem-target", { count: "one", side: "your-army", selects: "unit", keywords: ["SAMPLE-ALPHA"], match: "all", excluded_keywords: [] }, "TARGET"),
      leaf("duration", { endpoint: "end-of-turn" }, "EFFECT"),
      leaf("unit-filter", { side: "friendly", keywords: ["SAMPLE-BETA"] }, "EFFECT"),
      leaf("unit-position", { kind: "within", inches: 9, of: "this-unit", subject: "antecedent", negated: false }, "EFFECT"),
      leaf("characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" }, "EFFECT"),
    ];
    const result = compileLeaves(stratagem);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('"condition":{"type":"within","parameters":{"subject":"recipient","of":"this-unit","range":{"inches":9}}}');
  });

  it("pins the authored 5828 shape: a suppression of a named ability on a filtered set lasts permanently", () => {
    const result = compileLeaves([filterDeathleaper(), leaf("rule-state", SUPPRESSED_ABILITY)]);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('"scope":{"duration":"permanent"}');
    expect(JSON.stringify(result)).toContain('"rule":"sample-suppressed-rule"');
  });

  it("refuses a model-level aura with no 'of': its range has no measuring point (the frozen refusal, not a default)", () => {
    const modelAura = [leaf("unit-filter", { side: "friendly", keywords: ["SAMPLE-ALPHA"], level: "model" }), leaf("aura-range", { inches: 6 })];
    expect(compileLeaves([...modelAura, leaf("characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" })])).toMatchObject({
      ok: false,
      errors: ["A model-level aura must say what its range is measured from."],
    });
  });

  it("compiles a unit-level aura with no 'of': the unit-level aura does not read 'of', so it is not refused", () => {
    const unitAura = [filterDeathleaper(), leaf("aura-range", { inches: 6 })];
    expect(compileLeaves([...unitAura, leaf("characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" })])).toMatchObject({ ok: true });
  });

  it("keeps refusing a Stratagem's rule-state subject that no earlier leaf introduces", () => {
    const inEffect = leaf("rule-state", SUPPRESSED_ABILITY, "EFFECT");
    expect(compileLeaves([inEffect])).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/points back to an earlier unit \(antecedent\), but no earlier leaf selects a unit, targets a Stratagem or names a unit's moment\./u)],
    });
  });

  it("keeps refusing a rule-state subject bound to an event object, which a rule-state cannot name", () => {
    const damage = leaf("event", { kind: "damage-allocated" });
    expect(compileLeaves([damage, leaf("rule-state", SUPPRESSED_ABILITY)])).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/points back to the event-object, which its subject cannot name\./u)],
    });
  });

  it("does not claim a unit-filter after a rule-state as the rule-state's recipient (postfix stays off)", () => {
    // The filter has no select-unit or attack before it, so it is refused as a dangling filter rather than taken as the recipient.
    const select = leaf("select-unit", { scope: "enemy", distance: "any", visible: false });
    expect(compileLeaves([select, leaf("rule-state", SUPPRESSED_ABILITY, "EFFECT"), filterDeathleaper()])).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/A unit-filter needs a select-unit or attack right before it/u)],
    });
  });

  it("refuses an aura with no side or unit-filter before it", () => {
    expect(compileLeaves([leaf("aura-range", { inches: 9 }), leaf("characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" })])).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/An aura-range without a side needs a unit-filter right before it\./u)],
    });
  });
});
