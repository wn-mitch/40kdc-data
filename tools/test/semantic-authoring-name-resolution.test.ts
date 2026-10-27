import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { parentFaction, resolveDefinitionName, resolveOptionName, resolveWeaponName, resolveRecordName, resolveRuleReferences } from "../src/semantic-authoring/compile-rule-refs.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Printed rule, ability, weapon and unit names resolve to stable ids.
// Reads the repo's own record ids and option ids; no rule prose.

const refLeaf = (familyId: string, parameters: Record<string, unknown>, role = "EFFECT"): CompileLeaf =>
  ({ role, family_id: familyId, family_version: 1, parameters, start_byte: 0 });

describe("printed rule and ability names resolve to the records that print them", () => {
  it("resolves a printed name to its faction-suffixed record", () => {
    expect(resolveRecordName("necrons", "reanimation-protocols")).toBe("reanimation-protocols-necrons");
    const [activate] = resolveRuleReferences([refLeaf("ability-activate", { subject: "this-unit", ability: "reanimation-protocols" })], { faction_id: "necrons" }); // mfm:mirror keep — the bare name under test
    expect(activate!.parameters.ability).toBe("reanimation-protocols-necrons");
  });

  it("resolves the ability an ability-modifier changes, and leaves a non-id reference as written", () => {
    const leaf = refLeaf("ability-modifier", { subject: "this-unit", ability: "voice-of-command", aspect: "range", operation: "set", value: 24 }); // mfm:mirror keep — the bare name under test
    const [modifier] = resolveRuleReferences([leaf], { faction_id: "astra-militarum" });
    expect(modifier!.parameters.ability).toBe("voice-of-command-astra-militarum");
    const byEvent = refLeaf("ability-modifier", { subject: "this-unit", ability: { event: "used" }, aspect: "uses", operation: "add", value: 1 });
    expect(resolveRuleReferences([byEvent], { faction_id: "astra-militarum" })).toEqual([byEvent]);
  });

  it("resolves a printed record name, with or without its leading article", () => {
    expect(resolveRecordName("chaos-daemons", "shadow-of-chaos")).toBe("the-shadow-of-chaos-chaos-daemons");
  });

  it("resolves a doctrine in a chapter to its parent's stance option", () => {
    expect(parentFaction("blood-angels")).toBe("adeptus-astartes");
    expect(resolveOptionName("blood-angels", "tactical-doctrine")).toEqual({ ability_id: "combat-doctrines-adeptus-astartes", option_id: "tactical-doctrine" });
    const [active] = resolveRuleReferences([refLeaf("rule-active", { rule: "tactical-doctrine" }, "CONDITION")], { faction_id: "blood-angels" });
    expect(active!.parameters.rule).toEqual({ ability_id: "combat-doctrines-adeptus-astartes", option_id: "tactical-doctrine" });
  });

  it("leaves a name nothing prints, or one several records print, as written", () => {
    expect(resolveRecordName("necrons", "no-such-rule-anywhere")).toBeNull();
    const unresolved = refLeaf("rule-active", { rule: "no-such-rule-anywhere" }, "CONDITION");
    expect(resolveRuleReferences([unresolved], { faction_id: "necrons" })).toEqual([unresolved]);
    // Without a faction there is nothing to resolve against.
    const named = refLeaf("ability-activate", { subject: "this-unit", ability: "reanimation-protocols" }); // mfm:mirror keep — the bare name under test
    expect(resolveRuleReferences([named])).toEqual([named]);
  });

  it("compiles a resolved option reference as a stance-option condition", () => {
    const compiled = compileLeaves([
      refLeaf("rule-active", { rule: "devastator-doctrine" }, "CONDITION"),
      { ...refLeaf("roll-modifier", { roll: "hit", operation: "add", value: 1 }), start_byte: 10 },
    ], undefined, { units: { faction_id: "dark-angels" } });
    expect(JSON.stringify(compiled.ok ? compiled.mechanics : compiled.errors)).toContain('"rule":{"ability_id":"combat-doctrines-adeptus-astartes","option_id":"devastator-doctrine"}');
  });

  it("resolves a doctrine a unit gains to the stance option, keeping its rule kind", () => {
    const [granted] = resolveRuleReferences([refLeaf("rule-state", { subject: "this-unit", direction: "granted", rule_kind: "faction-rule", rule: "assault-doctrine" })], { faction_id: "blood-angels" });
    expect(granted!.parameters).toMatchObject({ rule_kind: "faction-rule", rule: { ability_id: "combat-doctrines-adeptus-astartes", option_id: "assault-doctrine" } });
  });

  it("resolves an ability a record defines inside itself to a named-ability reference", () => {
    expect(resolveDefinitionName("leagues-of-votann", "fortify-takeover")).toEqual({ ability_id: "prioritised-efficiency-leagues-of-votann", definition_id: "fortify-takeover" });
    const compiled = compileLeaves([
      refLeaf("rule-active", { rule: "hostile-acquisition" }, "CONDITION"),
      { ...refLeaf("roll-modifier", { roll: "hit", operation: "add", value: 1 }), start_byte: 10 },
    ], undefined, { units: { faction_id: "leagues-of-votann" } });
    expect(JSON.stringify(compiled.ok ? compiled.mechanics : compiled.errors)).toContain('"rule":{"ability_id":"prioritised-efficiency-leagues-of-votann","definition_id":"hostile-acquisition"}');
  });

  it("resolves a granted weapon's printed name to the faction's weapon id", () => {
    expect(resolveWeaponName("tau-empire", "twin-pulse-blaster")).toBe("twin-pulse-blaster-drone");
    // An id the faction already has stays; "burst-cannon" is both an id and a shared printed name.
    expect(resolveWeaponName("tau-empire", "burst-cannon")).toBe("burst-cannon");
    const [grant] = resolveRuleReferences([refLeaf("weapon-grant", { subject: "this-unit", weapon_id: "drone-burst-cannon" })], { faction_id: "tau-empire" });
    expect(grant!.parameters.weapon_id).toBe("drone-burst-cannon-drone");
  });
});

const UNIT_NAMES = ["Alpha Scouts", "Beta Walkers"];
const UNITS = [
  { id: "beta-walkers", name: "Beta Walkers" },
  { id: "alpha-scouts", name: "Alpha Scouts" },
];
const UNIT_IDS = ["alpha-scouts", "beta-walkers"];

function leaf(family: string, parameters: Record<string, unknown>, fragment: string, index: number): CompileLeaf {
  const version = currentFamilyVersion(family);
  return {
    role: familyRole(family, version),
    family_id: family,
    family_version: version,
    parameters,
    start_byte: index * 10,
    end_byte: index * 10 + 5,
    fragment,
  };
}

function abilityLeaves(names: string[] = UNIT_NAMES, narrowing: Record<string, unknown>[] = []): CompileLeaf[] {
  return [
    leaf("use-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: [] }, "WHEN", 0),
    leaf("unit-filter", { side: "enemy" }, "WHEN", 1),
    leaf("event", { kind: "enemy-selected-targets" }, "WHEN", 2),
    leaf("unit-filter", { side: "friendly", unit_names: names }, "WHEN", 3),
    ...narrowing.map((parameters, index) => leaf("unit-filter", parameters, "WHEN", 4 + index)),
    leaf("triggering-target", { selects: "unit", keywords: [], match: "all", unit_names: UNIT_NAMES }, "TARGET", 4 + narrowing.length),
    leaf("characteristic-modifier", { subject: "this-unit", characteristics: ["Sv"], operation: "improve", value: 1, weapon_type: "all" }, "EFFECT", 5 + narrowing.length),
  ];
}

function compileWith(units: Array<{ id: string; name: string }>, leaves = abilityLeaves()) {
  return compileLeaves(leaves, undefined, { units: { faction_id: "example-faction", units } });
}

describe("Semantic authoring exact unit identities", () => {
  it("resolves reviewed own-faction names to stable IDs in the trigger and core target eligibility", () => {
    const result = compileWith(UNITS);
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    if (!result.ok) return;

    expect(result.mechanics.trigger).toMatchObject({
      subject: { owner: "enemy" },
      object: { owner: "friendly", level: "unit", unit_ids: UNIT_IDS },
    });
    expect(result.core?.target_restrictions).toMatchObject({
      count: "one",
      selects: "unit",
      bound_to: "attacked-unit",
      eligibility: {
        type: "matches",
        parameters: { subject: "this-unit", filter: { level: "unit", unit_ids: UNIT_IDS } },
      },
    });
    expect(JSON.stringify(result)).not.toContain("ALPHA SCOUTS");
    expect(JSON.stringify(result)).not.toContain("BETA WALKERS");
  });

  it("retains exact identities through stacked narrowing and intersects two identity filters", () => {
    const result = compileWith(UNITS, abilityLeaves(UNIT_NAMES, [
      { side: "friendly", unit_names: ["Alpha Scouts"] },
      { side: "friendly", excluded_keywords: ["EXAMPLE"] },
    ]));
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    if (!result.ok) return;

    expect(result.mechanics.trigger).toMatchObject({
      object: { owner: "friendly", level: "unit", unit_ids: ["alpha-scouts"], none_of: ["EXAMPLE"] },
    });
  });

  it("refuses stacked filters whose exact unit identities are disjoint", () => {
    const result = compileWith(UNITS, abilityLeaves(["Alpha Scouts"], [
      { side: "friendly", unit_names: ["Beta Walkers"] },
    ]));
    expect(result.ok ? "" : result.errors.join("; ")).toMatch(/stacked unit-filters name disjoint unit identities/iu);
  });

  it("normalizes exact names without treating them as model profiles", () => {
    expect(normalizeFingerprintParameters("unit-filter", { side: "friendly", unit_names: [" Beta   Walkers ", "**Alpha Scouts**"] }, currentFamilyVersion("unit-filter")))
      .toEqual({ side: "friendly", unit_names: UNIT_NAMES });
    expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", level: "model", unit_names: UNIT_NAMES }, currentFamilyVersion("unit-filter")))
      .toThrow(/identifies units, not models/u);
  });

  it("fails closed when an own-faction name is missing or ambiguous", () => {
    const missing = compileWith([UNITS[0]!]);
    expect(missing.ok ? "" : missing.errors.join("; ")).toMatch(/Alpha Scouts.*0 datasheets/u);

    const ambiguous = compileWith([...UNITS, { id: "alpha-scouts-alt", name: "Alpha Scouts" }]);
    expect(ambiguous.ok ? "" : ambiguous.errors.join("; ")).toMatch(/Alpha Scouts.*2 datasheets/u);
  });
});
