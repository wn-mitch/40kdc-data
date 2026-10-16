import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { foldAbilityUseRefresh } from "../src/round5c/compile-ability-use-refresh.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

type Node = Record<string, unknown>;
function fixture(per: "model" | "army", sources: string[]): CompileLeaf[] {
  const rows: Array<[string, string, Node]> = [
    ["WHEN", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["command", "movement", "shooting", "charge", "fight"] }],
    ["WHEN", "unit-filter", { side: "friendly", level: "model", keywords: ["EXAMPLE"] }],
    ["WHEN", "event", { kind: "used", activity: "ability", source: sources, usage: { frequency: "n-per-battle", count: 1 }, bind_as: "used-ability" }],
    ["WHEN", "usage-limit", { frequency: "once-per-battle" }],
    ["TARGET", "triggering-target", { selects: "model", keywords: ["EXAMPLE"], match: "all" }],
    ["EFFECT", "usage-limit", { frequency: "once-per-battle" }],
    ["EFFECT", "ability-modifier", { subject: "this-model", ability: { event: "used", event_var: "used-ability" }, aspect: "uses", operation: "add", value: 1, not_same: "phase" }],
    ["EFFECT", "duration", { endpoint: "end-of-battle" }],
    ["RESTRICTIONS", "usage-limit", { frequency: "once-per-battle", per }],
  ];
  return rows.map(([fragment, family_id, parameters], index) => {
    const family_version = currentFamilyVersion(family_id);
    return { fragment, family_id, family_version, role: familyRole(family_id, family_version), parameters: normalizeFingerprintParameters(family_id, parameters, family_version), start_byte: index * 10, end_byte: index * 10 + 4 };
  });
}
function effects(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(effects);
  if (value === null || typeof value !== "object") return [];
  const node = value as Node;
  return [...(node.type === "ability-modifier" ? [node] : []), ...Object.values(node).flatMap(effects)];
}

describe("exact used-ability additional allowance", () => {
  it.each(["model", "army"] as const)("preserves the parent's per-%s limit and bound ability identity", (per) => {
    const sources = per === "model" ? ["unit"] : ["unit", "enhancement"];
    const result = compileLeaves(fixture(per, sources));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.trigger).toMatchObject({ event: "used", binds_event_variable: "used-ability", filter: { kind: "ability", source: sources, usage: { frequency: "n-per-battle", count: 1 } } });
    expect(result.mechanics.usage).toMatchObject({ frequency: "n-per-battle", count: 1, per });
    expect(effects(result.mechanics.effect)).toContainEqual(expect.objectContaining({ modifier: expect.objectContaining({ ability: { event: "used", event_var: "used-ability" }, aspect: "uses", operation: "add", value: 1, not_same: "phase" }) }));
  });

  it("keeps the Warlord as a designation on the actual model, not a static keyword", () => {
    const leaves = fixture("army", ["unit", "enhancement"]);
    const actor = leaves.find((leaf) => leaf.family_id === "unit-filter")!;
    actor.parameters.designated = "warlord";
    const result = compileLeaves(leaves);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.trigger).toMatchObject({
      subject: { owner: "friendly", level: "model", all_of: ["EXAMPLE"], designated: "warlord" },
    });
    expect(result.core?.target_restrictions).toMatchObject({ required_keywords: ["EXAMPLE"], selects: "model", bound_to: "triggering-unit" });
  });

  it("does not consume a granting restriction or a quote without the qualified actual event", () => {
    const leaves = fixture("model", ["unit"]);
    expect(foldAbilityUseRefresh(leaves).filter((leaf) => leaf.family_id === "usage-limit").map((leaf) => leaf.fragment)).toEqual(["RESTRICTIONS"]);
    expect(() => foldAbilityUseRefresh(leaves.filter((leaf) => leaf.family_id !== "event"))).toThrow();
  });
});
