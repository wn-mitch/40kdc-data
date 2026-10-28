import { describe, expect, it } from "vitest";
import { Dataset } from "@alpaca-software/40kdc-data";

import { needToggles, parseDesignations, scenarioContext, withConditionFact } from "./scenario.js";

describe("scenario", () => {
  it("parses declared designations, blank meaning none", () => {
    expect(parseDesignations(" Spotted, focus-of-hatred ,")).toEqual(["Spotted", "focus-of-hatred"]);
    expect(parseDesignations("")).toEqual([]);
  });

  it("spreads only the fields the player set", () => {
    expect(scenarioContext({ battleRound: 2, targetStrength: undefined, targetDesignations: [] }))
      .toEqual({ battleRound: 2, targetDesignations: [] });
  });

  it("resolves a gated ability once the field is declared", () => {
    // Executioner gives its unit +1 to hit with ranged attacks against a target that is not below Half-strength.
    const ability = Dataset.embedded().abilities.getInFaction("executioner-adeptus-astartes", "adeptus-astartes")!;
    const source = { kind: "ability" as const, abilityId: ability.id, abilityKind: "unit" as const };
    const unset = ability.describeBuffs(source, { phase: "shooting" }, "attacker");
    expect(unset.applied).toHaveLength(0);
    expect(unset.unsupported.map((fragment) => fragment.reason)).toContain('conditional: cannot evaluate condition "and" against current context');
    expect(ability.describeBuffs(source, { phase: "shooting", ...scenarioContext({ targetStrength: "below-starting" }) }, "attacker").applied).toHaveLength(1);
    expect(ability.describeBuffs(source, { phase: "shooting", ...scenarioContext({ targetStrength: "below-half" }) }, "attacker").applied).toHaveLength(0);
  });

  it("answers an undecided condition from a generated toggle", () => {
    const ds = Dataset.embedded();
    const ability = ds.abilities.getInFaction("executioner-adeptus-astartes", "adeptus-astartes")!;
    const unit = ds.units.all.find((u) => u.abilities.some((a) => a.id === ability.id))!;
    const input = { unitId: unit.id, factionId: unit.factionId };
    const { needs } = ds.stackableBuffsFor(input, { phase: "shooting" });
    const toggles = needToggles(needs);
    const toggle = toggles.find((t) => t.abilities.includes(ability.name))!;
    expect(toggle.side).toBe("attacker");
    expect(toggle.label.toLowerCase()).toContain("half");
    // One toggle per condition, however many abilities ask it.
    expect(new Set(toggles.map((t) => t.key)).size).toBe(toggles.length);

    const levers = (scenario: Parameters<typeof scenarioContext>[0]) =>
      ds.stackableBuffsFor(input, { phase: "shooting", ...scenarioContext(scenario) });
    const yes = levers(withConditionFact({}, toggle.key, true));
    const no = levers(withConditionFact({}, toggle.key, false));
    expect(yes.needs.some((n) => n.key === toggle.key)).toBe(false);
    expect(no.needs.some((n) => n.key === toggle.key)).toBe(false);
    // The leaf sits under a "not": exactly one answer gives Executioner a lever.
    const has = (r: typeof yes) => r.buffs.some((lever) => lever.source.kind === "ability" && lever.source.abilityId === ability.id);
    expect(Number(has(yes)) + Number(has(no))).toBe(1);
  });

  it("drops the facts map when its last answer is cleared", () => {
    const set = withConditionFact({ battleRound: 2 }, "attacker:{}", true);
    expect(set).toEqual({ battleRound: 2, conditionFacts: { "attacker:{}": true } });
    expect(withConditionFact(set, "attacker:{}", undefined)).toEqual({ battleRound: 2 });
  });
});
