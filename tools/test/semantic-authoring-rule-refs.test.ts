import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { parentFaction, resolveDefinitionName, resolveOptionName, resolveWeaponName, resolveRecordName, resolveRuleReferences } from "../src/semantic-authoring/compile-rule-refs.js";

// Reads the repo's own record ids and option ids; no rule prose.

const leaf = (familyId: string, parameters: Record<string, unknown>, role = "EFFECT"): CompileLeaf =>
  ({ role, family_id: familyId, family_version: 1, parameters, start_byte: 0 });

describe("printed rule and ability names resolve to the records that print them", () => {
  it("resolves a printed name to its faction-suffixed record", () => {
    expect(resolveRecordName("necrons", "reanimation-protocols")).toBe("reanimation-protocols-necrons");
    const [activate] = resolveRuleReferences([leaf("ability-activate", { subject: "this-unit", ability: "reanimation-protocols" })], { faction_id: "necrons" });
    expect(activate!.parameters.ability).toBe("reanimation-protocols-necrons");
  });

  it("resolves a printed record name, with or without its leading article", () => {
    expect(resolveRecordName("chaos-daemons", "shadow-of-chaos")).toBe("the-shadow-of-chaos-chaos-daemons");
  });

  it("resolves a doctrine in a chapter to its parent's stance option", () => {
    expect(parentFaction("blood-angels")).toBe("adeptus-astartes");
    expect(resolveOptionName("blood-angels", "tactical-doctrine")).toEqual({ ability_id: "combat-doctrines-adeptus-astartes", option_id: "tactical-doctrine" });
    const [active] = resolveRuleReferences([leaf("rule-active", { rule: "tactical-doctrine" }, "CONDITION")], { faction_id: "blood-angels" });
    expect(active!.parameters.rule).toEqual({ ability_id: "combat-doctrines-adeptus-astartes", option_id: "tactical-doctrine" });
  });

  it("leaves a name nothing prints, or one several records print, as written", () => {
    expect(resolveRecordName("necrons", "no-such-rule-anywhere")).toBeNull();
    const unresolved = leaf("rule-active", { rule: "no-such-rule-anywhere" }, "CONDITION");
    expect(resolveRuleReferences([unresolved], { faction_id: "necrons" })).toEqual([unresolved]);
    // Without a faction there is nothing to resolve against.
    const named = leaf("ability-activate", { subject: "this-unit", ability: "reanimation-protocols" });
    expect(resolveRuleReferences([named])).toEqual([named]);
  });

  it("compiles a resolved option reference as a stance-option condition", () => {
    const compiled = compileLeaves([
      leaf("rule-active", { rule: "devastator-doctrine" }, "CONDITION"),
      { ...leaf("roll-modifier", { roll: "hit", operation: "add", value: 1 }), start_byte: 10 },
    ], undefined, { units: { faction_id: "dark-angels" } });
    expect(JSON.stringify(compiled.ok ? compiled.mechanics : compiled.errors)).toContain('"rule":{"ability_id":"combat-doctrines-adeptus-astartes","option_id":"devastator-doctrine"}');
  });

  it("resolves a doctrine a unit gains to the stance option, keeping its rule kind", () => {
    const [granted] = resolveRuleReferences([leaf("rule-state", { subject: "this-unit", direction: "granted", rule_kind: "faction-rule", rule: "assault-doctrine" })], { faction_id: "blood-angels" });
    expect(granted!.parameters).toMatchObject({ rule_kind: "faction-rule", rule: { ability_id: "combat-doctrines-adeptus-astartes", option_id: "assault-doctrine" } });
  });

  it("resolves an ability a record defines inside itself to a named-ability reference", () => {
    expect(resolveDefinitionName("leagues-of-votann", "fortify-takeover")).toEqual({ ability_id: "prioritised-efficiency-leagues-of-votann", definition_id: "fortify-takeover" });
    const compiled = compileLeaves([
      leaf("rule-active", { rule: "hostile-acquisition" }, "CONDITION"),
      { ...leaf("roll-modifier", { roll: "hit", operation: "add", value: 1 }), start_byte: 10 },
    ], undefined, { units: { faction_id: "leagues-of-votann" } });
    expect(JSON.stringify(compiled.ok ? compiled.mechanics : compiled.errors)).toContain('"rule":{"ability_id":"prioritised-efficiency-leagues-of-votann","definition_id":"hostile-acquisition"}');
  });

  it("resolves a granted weapon's printed name to the faction's weapon id", () => {
    expect(resolveWeaponName("tau-empire", "twin-pulse-blaster")).toBe("twin-pulse-blaster-drone");
    // An id the faction already has stays; "burst-cannon" is both an id and a shared printed name.
    expect(resolveWeaponName("tau-empire", "burst-cannon")).toBe("burst-cannon");
    const [grant] = resolveRuleReferences([leaf("weapon-grant", { subject: "this-unit", weapon_id: "drone-burst-cannon" })], { faction_id: "tau-empire" });
    expect(grant!.parameters.weapon_id).toBe("drone-burst-cannon-drone");
  });
});
