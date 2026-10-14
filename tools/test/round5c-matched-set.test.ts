import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/round5c/compile.js";
import { bindMatchedPools } from "../src/round5c/compile-matched-set.js";
import type { CompileLeaf } from "../src/round5c/compile-fragments.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

// Fabricated wording only: the sets are "those ALPHA units" style references, not rules prose.
let at = 0;
function leaf(family_id: string, parameters: Record<string, unknown>): CompileLeaf {
  const family_version = currentFamilyVersion(family_id);
  at += 10;
  return { role: familyRole(family_id, family_version), family_id, family_version, parameters: normalizeFingerprintParameters(family_id, parameters, family_version), start_byte: at };
}

/** "within N of this model, a friendly ALPHA BRAVO unit" (or ALPHA alone): the set a later leaf names. */
const poolSource = (keywords: string[] = ["ALPHA", "BRAVO"], inches = 6) =>
  leaf("unit-position", { kind: "within", inches, subject: "this-model", of: "matching-unit", of_side: "friendly", of_keywords: keywords, negated: false });
const selectFriendly = () => leaf("select-unit", { scope: "friendly", distance: "any", visible: false });
const those = (keywords: string[] = ["BRAVO"]) => leaf("unit-filter", { side: "friendly", keywords, among: "matched-units" });
const mortal = () => leaf("mortal-wounds", { recipient: "antecedent", count: "1" });

describe("Round 5C matched sets (those X units)", () => {
  it("select-one-of-those (9762 shape) selects with the pool's keywords and range, as an authored select does", () => {
    const pointing = compileLeaves([poolSource(["THOUSAND SONS", "VEHICLE"]), selectFriendly(), those(["VEHICLE"]), mortal()]);
    const authored = compileLeaves([poolSource(["THOUSAND SONS", "VEHICLE"]), leaf("select-unit", { scope: "friendly", distance: "within", inches: 6, visible: false }), leaf("unit-filter", { side: "friendly", keywords: ["THOUSAND SONS", "VEHICLE"] }), mortal()]);
    expect(pointing.ok).toBe(true);
    expect(pointing).toEqual(authored);
    const selector = (pointing as { mechanics: { effect: { effect: { selector: Record<string, unknown> } } } }).mechanics.effect.effect.selector;
    expect(selector.filter).toEqual({ owner: "friendly", all_of: ["THOUSAND SONS", "VEHICLE"], within: { range: { inches: 6 }, of: "this-model" } });
    expect(selector).not.toHaveProperty("reference");
    expect(selector.count).toEqual({ min: 1, max: 1 });
  });

  it("targets only those enemy units (9073 shape): the target is the pool, not every enemy unit", () => {
    const pool = leaf("unit-position", { kind: "within", inches: 6, subject: "this-unit", of: "matching-unit", of_side: "enemy", negated: false });
    const restriction = leaf("targeting-restriction", { may: "target", kind: "charge", weapon_type: "all", by: "this-unit", target: "matched-units" });
    const result = compileLeaves([pool, restriction]);
    expect(result.ok).toBe(true);
    const modifier = (result as unknown as { mechanics: { effect: { effect: { target: unknown; modifier: Record<string, unknown> } } } }).mechanics.effect.effect;
    expect(modifier.target).toBe("this-unit");
    expect(modifier.modifier.kind).toBe("charge");
    expect(modifier.modifier.may).toBe("target");
    expect(modifier.modifier.target).toEqual({ owner: "enemy", within: { range: { inches: 6 }, of: "this-unit" } });
  });

  it("must select one of those units as the charge's target (10249 shape): must-target on the same pool", () => {
    const build = (may: string) => [
      leaf("unit-position", { kind: "within", inches: 6, subject: "this-unit", of: "matching-unit", of_side: "enemy", negated: false }),
      leaf("targeting-restriction", { may, kind: "charge", weapon_type: "all", by: "this-unit", target: "matched-units" }),
    ];
    const must = compileLeaves(build("must-target"));
    expect(must.ok).toBe(true);
    const modifier = (must as unknown as { mechanics: { effect: { effect: { modifier: Record<string, unknown> } } } }).mechanics.effect.effect.modifier;
    expect(modifier.may).toBe("must-target");
    expect(modifier.target).toEqual({ owner: "enemy", within: { range: { inches: 6 }, of: "this-unit" } });
    // A "may only target" restriction is a different rule: the same pool with may target.
    expect(JSON.stringify(compileLeaves(build("target")))).not.toEqual(JSON.stringify(must));
  });

  it("makes the attacker one of those units (8166 shape): the pool, not this unit", () => {
    const result = compileLeaves([
      leaf("unit-position", { kind: "within", inches: 3, subject: "this-model", of: "matching-unit", of_side: "friendly", of_keywords: ["DEATH GUARD", "VEHICLE"], negated: false }),
      leaf("unit-filter", { side: "friendly", keywords: ["VEHICLE"], among: "matched-units" }),
      leaf("attack", { direction: "makes", unit: "friendly-unit", attack_type: "ranged" }),
      leaf("reroll", { roll: "hit", subset: "all", weapon_type: "all" }),
    ]);
    expect(result.ok).toBe(true);
    const target = (result as unknown as { mechanics: { effect: { effect: { target: unknown } } } }).mechanics.effect.effect.target;
    expect(target).toEqual({ owner: "friendly", all_of: ["DEATH GUARD", "VEHICLE"], within: { range: { inches: 3 }, of: "this-model" } });
  });

  it("refuses a matched set with no earlier unit-position (3712 and 9047 shapes name the message)", () => {
    const engaged = leaf("unit-state", { states: ["engaged"], subject: "this-unit", negated: false });
    const result = compileLeaves([engaged, selectFriendly(), those(), mortal()]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("matched-units");
  });

  it("does not take an aura-range as the set (9047 shape)", () => {
    const aura = { role: "CONDITION", family_id: "aura-range", family_version: 1, parameters: { inches: 3, side: "friendly" }, start_byte: 1 } as unknown as CompileLeaf;
    expect(() => bindMatchedPools([aura, selectFriendly(), those()])).toThrow(/matched-units/);
  });

  it("refuses two earlier unit-positions as ambiguous", () => {
    const result = compileLeaves([poolSource(["ALPHA"]), poolSource(["BRAVO"]), selectFriendly(), those(), mortal()]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toMatch(/ambiguous/);
  });

  it("refuses a consumer keyword the pool does not have", () => {
    const result = compileLeaves([poolSource(["ALPHA", "BRAVO"]), selectFriendly(), those(["CHARLIE"]), mortal()]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("keyword");
  });

  it("refuses a pool that is not a plain within distance from this model or unit", () => {
    const cases: Array<Record<string, unknown>> = [
      { kind: "beyond", inches: 6, subject: "this-model", of: "matching-unit", of_side: "friendly", of_keywords: ["ALPHA"], negated: false },
      { kind: "within", inches: 6, subject: "this-model", of: "matching-unit", of_side: "friendly", of_keywords: ["ALPHA"], negated: true },
    ];
    for (const parameters of cases) {
      const result = compileLeaves([leaf("unit-position", parameters), selectFriendly(), those(["ALPHA"]), mortal()]);
      expect(result.ok, JSON.stringify(parameters)).toBe(false);
    }
    // Named-range and weapon-distance pools are not valid family leaves for a matching unit, so the pass sees them unnormalized.
    const raw = (extra: Record<string, unknown>) => ({ role: "CONDITION", family_id: "unit-position", family_version: 1, start_byte: 1, parameters: { kind: "within", inches: 6, subject: "this-model", of: "matching-unit", of_side: "friendly", of_keywords: ["ALPHA"], negated: false, ...extra } }) as unknown as CompileLeaf;
    for (const extra of [{ range_ref: "contagion" }, { weapon_range: "half" }, { distance: "half-weapon" }]) {
      expect(() => bindMatchedPools([raw(extra), selectFriendly(), those(["ALPHA"])]), JSON.stringify(extra)).toThrow(/matched-units/);
    }
  });

  it("refuses a select on the other side, and a friendly filter before a non-makes attack", () => {
    const enemySelect = compileLeaves([poolSource(), leaf("select-unit", { scope: "enemy", distance: "any", visible: false }), those(["BRAVO"]), mortal()]);
    expect(enemySelect.ok).toBe(false);
    const targeted = compileLeaves([poolSource(), those(["ALPHA"]), leaf("attack", { direction: "targeted", unit: "friendly-unit", attack_type: "ranged" }), mortal()]);
    expect(targeted.ok).toBe(false);
  });

  it("refuses a matched set followed by an effect, with no select or attack (not a listed shape)", () => {
    const result = compileLeaves([poolSource(), those(["ALPHA"]), leaf("mortal-wounds", { recipient: "this-unit", count: "1" })]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("matched-units");
  });

  it("refuses a matched set stacked with a same-side exclusion rather than merging it", () => {
    const exclusion = leaf("unit-filter", { side: "friendly", excluded_keywords: ["DAMNED"] });
    const result = compileLeaves([poolSource(), selectFriendly(), those(["ALPHA"]), exclusion, mortal()]);
    expect(result.ok).toBe(false);
  });

  it("keeps the pool's wholly on the targeting pool and refuses it on a selection", () => {
    const wholly = leaf("unit-position", { kind: "within", inches: 6, subject: "this-unit", of: "matching-unit", of_side: "enemy", wholly: true, negated: false });
    const restriction = compileLeaves([wholly, leaf("targeting-restriction", { may: "target", kind: "charge", weapon_type: "all", by: "this-unit", target: "matched-units" })]);
    expect(JSON.stringify(restriction)).toContain("\"wholly\":true");
    const select = compileLeaves([leaf("unit-position", { kind: "within", inches: 6, subject: "this-model", of: "matching-unit", of_side: "friendly", of_keywords: ["ALPHA"], wholly: true, negated: false }), selectFriendly(), those(["ALPHA"]), mortal()]);
    expect(select.ok).toBe(false);
  });

  it("carries the source's excluded keywords into the selection as the pool's none_of", () => {
    const source = leaf("unit-position", { kind: "within", inches: 6, subject: "this-model", of: "matching-unit", of_side: "friendly", of_keywords: ["ALPHA"], of_excluded_keywords: ["DAMNED"], negated: false });
    const result = compileLeaves([source, selectFriendly(), those(["ALPHA"]), mortal()]);
    expect(result.ok).toBe(true);
    const selector = (result as { mechanics: { effect: { effect: { selector: Record<string, unknown> } } } }).mechanics.effect.effect.selector;
    expect(selector.filter).toMatchObject({ none_of: ["DAMNED"], all_of: ["ALPHA"] });
  });

  it("registers the matched-set widenings (unit-filter from 11, targeting-restriction from 4, attack from 6)", () => {
    // Lower bounds: later widenings stack on these versions.
    expect(currentFamilyVersion("unit-filter")).toBeGreaterThanOrEqual(11);
    expect(currentFamilyVersion("targeting-restriction")).toBeGreaterThanOrEqual(4);
    expect(currentFamilyVersion("attack")).toBeGreaterThanOrEqual(6);
  });

  it("the unit-filter version refuses matched-units with side any or with targets", () => {
    const version = currentFamilyVersion("unit-filter");
    expect(() => normalizeFingerprintParameters("unit-filter", { side: "any", keywords: ["ALPHA"], among: "matched-units" }, version)).toThrow(/matched-units/);
    expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", keywords: ["ALPHA"], among: "matched-units", targets: "one" }, version)).toThrow(/targets/);
  });
});
