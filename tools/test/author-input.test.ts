import { describe, expect, it } from "vitest";
import { resolveSource } from "../src/author-input.js";

// A fake archive index reproducing the real "Simulacrum Imperialis" collision:
// the same ability name on a Sororitas (AS) and an Agents (AoI) "Sanctifiers"
// datasheet, with different rules. The join must pick by faction.
const archive = {
  factionCode: (kebab: string) => ({ "adepta sororitas": "AS", "agents of the imperium": "AoI" })[kebab.replace(/-/g, " ")],
  datasheetsFor: (unitName: string, code: string) =>
    unitName.toLowerCase() === "sanctifiers" ? [`ds-${code}`] : [],
  ruleFor: (dsId: string, abilityName: string) => {
    if (abilityName.toLowerCase() !== "simulacrum imperialis") return undefined;
    if (dsId === "ds-AS") return { src_type: "Other", parameter: null, phases: ["Command"], description: "gain Miracle dice" };
    if (dsId === "ds-AoI") return { src_type: "Wargear", parameter: null, phases: ["Command"], description: "Improve Leadership by 1" };
    return undefined;
  },
};

describe("resolveSource (datasheet+faction join)", () => {
  it("picks the faction-correct rule when an ability name collides across factions", () => {
    const sororitas = resolveSource(archive, "AS", ["Sanctifiers"], "Simulacrum Imperialis");
    expect(sororitas.src?.description).toBe("gain Miracle dice");
    const agents = resolveSource(archive, "AoI", ["Sanctifiers"], "Simulacrum Imperialis");
    expect(agents.src?.description).toBe("Improve Leadership by 1");
  });

  it("reports a reason when the ability has no unit_ids to chain through", () => {
    const r = resolveSource(archive, "AS", [], "Some Faction Rule");
    expect(r.src).toBeUndefined();
    expect(r.reason).toMatch(/no unit_ids/);
  });

  it("reports a reason when no faction code maps", () => {
    expect(resolveSource(archive, undefined, ["Sanctifiers"], "X").reason).toMatch(/no archive faction code/);
  });

  it("reports a reason when the unit has no matching datasheet", () => {
    expect(resolveSource(archive, "AS", ["Nonexistent Unit"], "X").reason).toMatch(/no matching ability/);
  });
});
