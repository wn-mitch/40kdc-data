import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/effect.js";
import { placed } from "./semantic-authoring-connective-fixture.js";

// "That unit cannot be selected as part of the X rule": a selection by one named ability.
// Wording and the rule id are fabricated.

const FAMILY = "targeting-restriction";
const BAR = { target: "this-unit", may: "cannot-target", kind: "ability", weapon_type: "all", ability: "fixture-rule-test-faction" };
const normalize = (parameters: Record<string, unknown>) => normalizeFingerprintParameters(FAMILY, parameters, currentFamilyVersion(FAMILY));

describe("targeting-restriction version 5: kind ability", () => {
  it("is version 5 and accepts a named ability on the target form, and kind ability alone", () => {
    expect(currentFamilyVersion(FAMILY)).toBe(5);
    expect(normalize(BAR)).toEqual(BAR);
    const { ability: _ability, ...bare } = BAR;
    expect(normalize(bare)).toEqual(bare);
  });

  it("still normalizes earlier leaves unchanged", () => {
    const stratagem = { target: "this-unit", may: "cannot-target", kind: "stratagem", weapon_type: "all", stratagem: "fixture-stratagem" };
    expect(normalize(stratagem)).toEqual(stratagem);
    const subject = { subject: "this-unit", may: "cannot-target", kind: "shoot", weapon_type: "all" };
    expect(normalize(subject)).toEqual(subject);
  });

  it("refuses an ability on another kind, without a target, with a Stratagem, or not as an id", () => {
    expect(() => normalize({ ...BAR, kind: "stratagem" })).toThrow(/kind ability only/);
    const { target: _target, ...noTarget } = BAR;
    expect(() => normalize({ ...noTarget, subject: "this-unit" })).toThrow(/needs target/);
    expect(() => normalize({ ...BAR, stratagem: "fixture-stratagem" })).toThrow(/names no Stratagem/);
    expect(() => normalize({ ...BAR, ability: "Fixture Rule" })).toThrow(/kebab-case/);
  });
});

describe("a named-ability bar through compileLeaves and the describer", () => {
  const text = "Fixture enhancement. That unit cannot be picked by the Fixture Rule.";

  it("lowers to a targeting effect that names the ability, and the DSL schema accepts it", () => {
    const result = compileLeaves(placed(text, ["That unit cannot be picked by the Fixture Rule", FAMILY, BAR]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = { type: "targeting", target: "this-unit", modifier: { may: "cannot-target", kind: "ability", target: "this-unit", ability: "fixture-rule-test-faction" } };
    expect(result.mechanics.effect).toEqual(effect);
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
    expect(validate(effect)).toBe(true);
    expect(validate({ ...effect, modifier: { ...effect.modifier, kind: "stratagem" } })).toBe(false);
  });

  it("renders as a selection the ability cannot make, and with a named selector as a targeting", () => {
    const render = (modifier: Record<string, unknown>) =>
      describeAbility({ ability_id: "x", name: "x", scope: { duration: "permanent" }, effect: { type: "targeting", target: "this-unit", modifier } } as never);
    expect(render({ may: "cannot-target", kind: "ability", target: "this-unit", ability: "fixture-rule-test-faction" })).toBe("The unit cannot be selected by the Fixture Rule Test Faction ability.");
    expect(render({ by: { owner: "enemy" }, may: "cannot-target", kind: "ability", target: "this-unit", ability: "fixture-rule-test-faction" })).toBe(
      "Enemy units cannot target the unit with the Fixture Rule Test Faction ability.",
    );
    // Without a named ability the generic kind phrase is unchanged.
    expect(render({ by: { owner: "enemy" }, may: "cannot-target", kind: "ability", target: "this-unit" })).toBe("Enemy units cannot target the unit with abilities.");
  });
});
