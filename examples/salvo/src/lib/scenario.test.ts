import { describe, expect, it } from "vitest";
import { Dataset } from "@alpaca-software/40kdc-data";

import { parseDesignations, scenarioContext } from "./scenario.js";

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
});
