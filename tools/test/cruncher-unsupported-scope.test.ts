import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { effectScope } from "../src/cruncher/unsupported-scope.js";

describe("cruncher unsupported scope of granted abilities", () => {
  it("places a grant of the published Reanimation Protocols record in the encounter layer", () => {
    // The id the data grants; the published record must still carry it, so a rename breaks this test.
    const id = "reanimation-protocols-necrons";
    const necrons = JSON.parse(readFileSync(new URL("../../data/enrichment/necrons/abilities.json", import.meta.url), "utf8")) as { ability_id: string }[];
    expect(necrons.some((record) => record.ability_id === id)).toBe(true);
    expect(effectScope({ type: "ability-grant", target: "this-unit", modifier: { ability: id } })).toBe("encounter-layer");
  });

  it("keeps an unknown granted ability unresolved", () => {
    expect(effectScope({ type: "ability-grant", target: "this-unit", modifier: { ability: "fabricated-rule" } })).toBe("unresolved");
  });
});
