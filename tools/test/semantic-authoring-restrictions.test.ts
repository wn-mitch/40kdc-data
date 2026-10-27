import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "../src/semantic-authoring/contracts.js";
import { coreCheckErrors } from "../src/semantic-authoring/core-checks.js";
import { prefillFromSource } from "../src/semantic-authoring/leaf-prefill.js";

// Fabricated records and wording only.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

let offset = 0;
function leaf(role: string, family_id: string, parameters: Record<string, unknown>): CompileLeaf {
  offset += 10;
  return { role, family_id, family_version: currentFamilyVersion(family_id), parameters, start_byte: offset };
}
const grant = () => leaf("EFFECT", "fights-first", { subject: "this-unit" });

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

function dataRoot(stratagems: unknown[], enhancements: unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), "semantic-authoring-core-"));
  roots.push(root);
  mkdirSync(join(root, "core", "fixture"), { recursive: true });
  writeFileSync(join(root, "core", "fixture", "stratagems.json"), JSON.stringify(stratagems));
  writeFileSync(join(root, "core", "fixture", "enhancements.json"), JSON.stringify(enhancements));
  return root;
}

describe("Semantic authoring restrictions", () => {
  it("writes how often into usage, and nothing else", () => {
    expect(compiled([leaf("RESTRICTION", "usage-limit", { frequency: "once-per-battle", per: "any" }), grant()]).mechanics.usage).toEqual({ frequency: "n-per-battle", count: 1 });
    expect(compiled([leaf("RESTRICTION", "usage-limit", { frequency: "once-per-turn", per: "unit" }), grant()]).mechanics.usage).toEqual({ frequency: "once-per-turn", per: "unit" });
    // Without a usage leaf the authored usage is kept, so the key is absent rather than null.
    expect("usage" in compiled([grant()]).mechanics).toBe(false);
    const two = compileLeaves([leaf("RESTRICTION", "usage-limit", { frequency: "once-per-turn", per: "any" }), leaf("RESTRICTION", "usage-limit", { frequency: "once-per-phase", per: "any" }), grant()]);
    expect(two.ok ? [] : two.errors).toContain("More than one usage limit; the entry has one usage.");
  });

  it.each(["phase", "turn", "battle round", "battle"])("reuses the same once-per-%s qualifier across independently scoped allowances", (period) => {
    const family = REVIEWED_FAMILY_REGISTRY.find((item) => item.id === "usage-limit" && !item.deprecated)!;
    const parameters = normalizeFingerprintParameters("usage-limit", prefillFromSource(family, `Once per ${period}`), family.version);
    for (const per of ["army", "unit", "model"]) {
      const result = compiled([
        leaf("RESTRICTION", "usage-limit", parameters),
        leaf("RESTRICTION", "usage-scope", { per }),
        grant(),
      ]);
      expect(result.mechanics.usage).toEqual({
        frequency: period === "battle" ? "n-per-battle" : `once-per-${period.replace(" ", "-")}`,
        ...(period === "battle" ? { count: 1 } : {}),
        per,
      });
    }
  });

  it("does not guess an allowance owner from a frequency qualifier alone", () => {
    const result = compileLeaves([leaf("RESTRICTION", "usage-limit", { frequency: "once-per-phase" }), grant()]);
    expect(result.ok ? [] : result.errors).toContain("Usage frequency needs a reviewed usage scope.");
  });

  it("refuses an owner without a frequency and conflicting owner qualifications", () => {
    const orphan = compileLeaves([leaf("RESTRICTION", "usage-scope", { per: "model" }), grant()]);
    expect(orphan.ok ? [] : orphan.errors).toContain("Usage scope has no frequency.");
    const conflict = compileLeaves([
      leaf("RESTRICTION", "usage-limit", { frequency: "once-per-phase", per: "model" }),
      leaf("RESTRICTION", "usage-scope", { per: "army" }),
      grant(),
    ]);
    expect(conflict.ok ? [] : conflict.errors).toContain("Conflicting usage scopes.");
  });

  it("turns a choice into an optional trigger, or an activated ability without one", () => {
    const withEvent = compiled([leaf("RESTRICTION", "optional-use", { who: "you" }), leaf("EVENT", "event", { kind: "charge" }), grant()]);
    expect(withEvent.mechanics).toMatchObject({ behavior: "reactive", trigger: { event: "move-ended", filter: { move_types: ["charge"] }, optional: true } });
    expect(compiled([leaf("RESTRICTION", "optional-use", { who: "this-model" }), grant()]).mechanics).toMatchObject({ behavior: "activated", trigger: null });
  });

  it("checks a stratagem's phases against core, where each phase has its own owner", () => {
    const window = (parameters: Record<string, unknown>) => compiled([leaf("RESTRICTION", "use-window", parameters), grant()]).checks;
    const root = dataRoot([
      { id: "shielded", ability_id: "shielded", phases: ["shooting", "fight"], player_turn: "either" },
      { id: "volley", ability_id: "volley", phases: ["shooting"], player_turn: "your-turn" },
    ], []);
    // Opponent's Shooting or either Fight: core can only say "either" for the pair.
    expect(coreCheckErrors(root, "shielded", window({ your_phases: [], opponent_phases: ["shooting"], either_phases: ["fight"] }))).toEqual([]);
    expect(coreCheckErrors(root, "volley", window({ your_phases: ["shooting"], opponent_phases: [], either_phases: [] }))).toEqual([]);
    expect(coreCheckErrors(root, "volley", window({ your_phases: ["movement"], opponent_phases: [], either_phases: [] })))
      .toEqual(["WHEN reads as movement in your-turn, but core says shooting in your-turn."]);
    expect(coreCheckErrors(root, "missing", window({ your_phases: ["movement"], opponent_phases: [], either_phases: [] }))[0]).toMatch(/no core stratagem/u);
    expect(() => normalizeFingerprintParameters("use-window", { your_phases: ["fight"], opponent_phases: [], either_phases: ["fight"] }, 1)).toThrow(/two owners/u);
  });

  it("checks an enhancement's bearers against core, allowing the faction keyword core adds", () => {
    const bearers = (keywords: string[], match: string) => compiled([leaf("RESTRICTION", "bearer-eligibility", { keywords, match }), grant()]).checks;
    const root = dataRoot([], [
      { id: "relic", ability_id: "relic", keyword_restrictions: ["Hive Faction", "Hierophant"] },
      { id: "choice", ability_id: "choice", keyword_restriction_groups: [["Hive Faction", "Warden"], ["Hive Faction", "Oracle"]] },
    ]);
    expect(coreCheckErrors(root, "relic", bearers(["HIEROPHANT"], "all"))).toEqual([]);
    expect(coreCheckErrors(root, "choice", bearers(["WARDEN", "ORACLE"], "any"))).toEqual([]);
    expect(coreCheckErrors(root, "choice", bearers(["WARDEN"], "any"))[0]).toMatch(/core allows HIVE FACTION \+ WARDEN or HIVE FACTION \+ ORACLE/u);
    expect(coreCheckErrors(root, "relic", bearers(["ORACLE"], "all"))[0]).toMatch(/core requires/u);
  });

  it("accepts a bearer spelled differently from core when both admit the same units, and only then", () => {
    const bearers = (keywords: string[], match: string) => compiled([leaf("RESTRICTION", "bearer-eligibility", { keywords, match }), grant()]).checks;
    const root = dataRoot([], [
      { id: "node", ability_id: "node", keyword_restriction_groups: [["Clan Forge"], ["Loremaster"]] },
      { id: "blade", ability_id: "blade", keyword_restrictions: ["Hive Faction", "Gilded Warden"] },
    ]);
    writeFileSync(join(root, "core", "fixture", "units.json"), JSON.stringify([
      { id: "forge-smith", name: "Clan Forge Smith", keywords: ["Character", "Clan Forge", "Smith"], faction_keywords: ["Hive Faction"] },
      { id: "forge-walkers", name: "Clan Forge Walkers", keywords: ["Clan Forge", "Walker"], faction_keywords: ["Hive Faction"] },
      { id: "loremaster", name: "Loremaster", keywords: ["Character", "Loremaster"], faction_keywords: ["Hive Faction"] },
      { id: "gilded-warden", name: "Gilded Warden", keywords: ["Character", "Champion", "Warden's Blades"], faction_keywords: ["Hive Faction"] },
      { id: "champion", name: "Champion", keywords: ["Character", "Champion"], faction_keywords: ["Hive Faction"] },
    ]));
    // SMITH and CLAN FORGE admit different units (Clan Forge Walkers), so only the same set passes.
    expect(coreCheckErrors(root, "node", bearers(["SMITH", "LOREMASTER"], "any"))[0]).toMatch(/core allows/u);
    // The datasheet-scoped core group names the unit; the printed keywords pick out the same one.
    expect(coreCheckErrors(root, "blade", bearers(["CHAMPION", "WARDEN'S BLADES"], "all"))).toEqual([]);
    expect(coreCheckErrors(root, "blade", bearers(["CHAMPION"], "all"))[0]).toMatch(/core requires/u);
  });

  it("admits a datasheet group's own unit, not another that carries its name as a keyword", () => {
    const bearers = (keywords: string[], anyOf: string[]) => compiled([leaf("RESTRICTION", "bearer-eligibility", { keywords, match: "all", any_keywords: anyOf }), grant()]).checks;
    const root = dataRoot([], [
      { id: "hat", ability_id: "hat", keyword_restriction_groups: [["Infantry", "Boss"], ["Infantry", "Tinkerer"]], datasheet_restriction_groups: [{ unit_id: "tinkerer" }] },
      // The former reading: the datasheet's name as a keyword group, which also admits the walker.
      { id: "old-hat", ability_id: "old-hat", keyword_restriction_groups: [["Tinkerer"], ["Infantry", "Boss"], ["Infantry", "Tinkerer"]] },
      { id: "solo", ability_id: "solo", datasheet_restriction_groups: [{ unit_id: "tinkerer", keywords: ["Hive Faction"] }] },
    ]);
    writeFileSync(join(root, "core", "fixture", "units.json"), JSON.stringify([
      { id: "tinkerer", name: "Tinkerer", keywords: ["Character", "Infantry", "Tinkerer"], faction_keywords: ["Hive Faction"] },
      { id: "tinkerer-walker", name: "Tinkerer Walker", keywords: ["Character", "Vehicle", "Tinkerer"], faction_keywords: ["Hive Faction"] },
      { id: "boss", name: "Boss", keywords: ["Character", "Infantry", "Boss"], faction_keywords: ["Hive Faction"] },
    ]));
    // "Tinkerer/Boss Infantry model only".
    expect(coreCheckErrors(root, "hat", bearers(["INFANTRY"], ["TINKERER", "BOSS"]))).toEqual([]);
    expect(coreCheckErrors(root, "old-hat", bearers(["INFANTRY"], ["TINKERER", "BOSS"]))[0]).toMatch(/core/u);
    // "Tinkerer model only" names the datasheet; the walker's TINKERER keyword does not make it one.
    const tinkerer = compiled([leaf("RESTRICTION", "bearer-eligibility", { keywords: ["TINKERER", "INFANTRY"], match: "all" }), grant()]).checks;
    expect(coreCheckErrors(root, "solo", tinkerer)).toEqual([]);
    const anyTinkerer = compiled([leaf("RESTRICTION", "bearer-eligibility", { keywords: ["TINKERER"], match: "all" }), grant()]).checks;
    expect(coreCheckErrors(root, "solo", anyTinkerer)[0]).toMatch(/core allows .*the tinkerer datasheet/u);
  });

  it("turns stratagem moments into their trigger events", () => {
    const trigger = (kind: string) => compiled([leaf("EVENT", "event", { kind }), grant()]).mechanics.trigger;
    expect(trigger("enemy-selected-targets")).toEqual({ event: "targets-selected", filter: { kind: "attack" }, subject: { owner: "enemy" }, object: "this-unit" });
    expect(trigger("enemy-ended-move")).toEqual({ event: "move-ended", subject: { owner: "enemy" } });
    expect(trigger("enemy-has-shot")).toEqual({ event: "attacks-resolved", filter: { kind: "shoot" }, subject: { owner: "enemy" } });
    // Any enemy charge declared, as the authored data spells it, not only one that targets this unit.
    expect(trigger("enemy-declared-charge")).toEqual({ event: "targets-selected", filter: { kind: "charge" }, subject: { owner: "enemy" } });
    expect(trigger("selected-to-fight")).toEqual({ event: "selected", filter: { to: "fight" } });
  });

  it("compiles a stratagem TARGET to core target_restrictions, qualifiers included, leaving the effect alone", () => {
    const inTarget = (item: CompileLeaf): CompileLeaf => ({ ...item, fragment: "TARGET" });
    const result = compiled([
      inTarget(leaf("RESTRICTION", "stratagem-target", { count: "one", side: "your-army", selects: "unit", keywords: ["INFANTRY", "WARDENS"], match: "all", excluded_keywords: ["TITANIC"] })),
      inTarget(leaf("CONDITION", "unit-activity", { activities: ["selected-to-shoot-this-phase"], subject: "this-unit", negated: true })),
      inTarget(leaf("CONDITION", "unit-state", { states: ["engaged"], subject: "this-unit", negated: true })),
      { ...grant(), fragment: "EFFECT" },
    ]);
    expect(result.core).toEqual({ target_restrictions: {
      count: "one", side: "your-army", selects: "unit", required_keywords: ["INFANTRY", "WARDENS"], excluded_keywords: ["TITANIC"],
      eligibility: { operator: "and", operands: [
        { operator: "not", operands: [{ type: "happened", parameters: { event: "selected", filter: { to: "shoot" }, window: "phase" } }] },
        { operator: "not", operands: [{ type: "matches", parameters: { filter: { state: "engaged" } } }] },
      ] },
    } });
    // The qualifiers say who can be picked, not when the effect applies.
    expect(result.mechanics.effect).toEqual({ type: "ability-grant", target: "this-unit", modifier: { ability: "fights-first" } });
  });

  it("lowers the Warlord in a TARGET's keywords to the warlord field, keeping the keywords it carries", () => {
    const target = (parameters: Record<string, unknown>) => compileLeaves([
      { ...leaf("RESTRICTION", "stratagem-target", { count: "one", side: "your-army", selects: "model", match: "all", excluded_keywords: [], ...parameters }), fragment: "TARGET" },
      { ...grant(), fragment: "EFFECT" },
    ]);
    const lowered = (parameters: Record<string, unknown>) => {
      const result = target(parameters);
      if (!result.ok) throw new Error(result.errors.join("; "));
      return result.core?.target_restrictions;
    };
    // "Your WARDENS WARLORD", whether the leaf lists the Warlord apart or in the same bolded phrase.
    const expected = { count: "one", side: "your-army", selects: "model", warlord: true, required_keywords: ["WARDENS"] };
    expect(lowered({ keywords: ["WARDENS", "WARLORD"] })).toEqual(expected);
    expect(lowered({ keywords: ["WARDENS WARLORD"] })).toEqual(expected);
    expect(lowered({ keywords: ["WARLORD"] })).toEqual({ count: "one", side: "your-army", selects: "model", warlord: true });
    // A keyword that only begins with the word is a keyword.
    expect(lowered({ keywords: ["WARLORD TITAN"] })).toEqual({ count: "one", side: "your-army", selects: "model", required_keywords: ["WARLORD TITAN"] });
    // The Warlord as one alternative, an exclusion or an enemy has no core form.
    expect(target({ keywords: ["WARDENS", "WARLORD"], match: "any" }).ok).toBe(false);
    expect(target({ keywords: ["WARDENS"], excluded_keywords: ["WARLORD"] }).ok).toBe(false);
    expect(target({ keywords: ["WARLORD"], side: "enemy" }).ok).toBe(false);
  });

  it("binds \"that X unit\" to the WHEN moment, narrowing the trigger to its keywords", () => {
    const result = compiled([
      leaf("EVENT", "event", { kind: "selected-to-shoot" }),
      { ...leaf("RESTRICTION", "triggering-target", { selects: "unit", keywords: ["WARDENS"], match: "all" }), fragment: "TARGET" },
      grant(),
    ]);
    expect(result.core?.target_restrictions).toEqual({ count: "one", selects: "unit", required_keywords: ["WARDENS"], bound_to: "triggering-unit" });
    // The moment's unit is this unit, so "that WARDENS unit" is a keyword condition on it, not any WARDENS unit.
    expect(result.mechanics.trigger).toEqual({ event: "selected", filter: { to: "shoot" }, condition: { type: "matches", parameters: { filter: { all_of: ["WARDENS"] } } } });
    const attacked = compiled([
      { ...leaf("RESTRICTION", "stratagem-target", { count: "one", side: "your-army", selects: "unit", keywords: ["WARDENS", "ORACLES"], match: "any", excluded_keywords: [] }), fragment: "TARGET" },
      { ...leaf("RESTRICTION", "target-binding", { bound_to: "attacked-unit" }), fragment: "TARGET" },
      grant(),
    ]);
    expect(attacked.core?.target_restrictions).toEqual({ count: "one", side: "your-army", selects: "unit", required_keywords_any: ["WARDENS", "ORACLES"], bound_to: "attacked-unit" });
  });

  it("reads a TARGET, a trigger's subject and an attack's target from one unit-filter leaf", () => {
    const filter = (parameters: Record<string, unknown>) => leaf("CONDITION", "unit-filter", parameters);
    const target = compiled([
      { ...leaf("RESTRICTION", "stratagem-target", { count: "one" }), fragment: "TARGET" },
      { ...filter({ side: "friendly", keywords: ["INFANTRY"], any_keywords: ["ORACLES", "WARDENS"], states: ["unengaged"] }), fragment: "TARGET" },
      { ...grant(), fragment: "EFFECT" },
    ]);
    expect(target.core).toEqual({ target_restrictions: {
      count: "one", side: "your-army", selects: "unit", required_keywords: ["INFANTRY"],
      eligibility: { operator: "and", operands: [
        { type: "matches", parameters: { filter: { any_of: ["ORACLES", "WARDENS"] } } },
        { type: "matches", parameters: { filter: { not_states: ["engaged"] } } },
      ] },
    } });
    // "each time a friendly WARDENS unit" + an event with no owner: the trigger's subject.
    expect(compiled([filter({ side: "friendly", keywords: ["WARDENS"] }), leaf("EVENT", "event", { kind: "enemy-has-shot" }), grant()]).mechanics.trigger)
      .toMatchObject({ event: "attacks-resolved", subject: { owner: "friendly", all_of: ["WARDENS"] } });
    // After an attack, the attack's target: a gate on the defender.
    const attack = compiled([
      leaf("EVENT", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }),
      filter({ side: "enemy", keywords: ["VEHICLE"] }),
      leaf("EFFECT", "roll-modifier", { roll: "hit", operation: "add", value: 1 }),
    ]);
    expect(attack.mechanics.effect).toMatchObject({ type: "conditional", condition: { type: "matches", parameters: { subject: "defender", filter: { all_of: ["VEHICLE"] } } } });
    // "One ADEPTUS CUSTODES model": the who leaf's noun says model.
    expect(compiled([
      { ...leaf("RESTRICTION", "stratagem-target", { count: "one" }), fragment: "TARGET" },
      { ...filter({ side: "friendly", keywords: ["CHARACTER"], level: "model" }), fragment: "TARGET" },
      { ...grant(), fragment: "EFFECT" },
    ]).core).toMatchObject({ target_restrictions: { selects: "model", required_keywords: ["CHARACTER"] } });
    // A side-less TARGET leaf needs its unit-filter.
    expect(compileLeaves([{ ...leaf("RESTRICTION", "stratagem-target", { count: "one" }), fragment: "TARGET" }, grant()]).ok).toBe(false);
  });

  it("refuses a TARGET without exactly one target leaf", () => {
    const result = compileLeaves([{ ...leaf("CONDITION", "unit-activity", { activities: ["fought-this-phase"], subject: "this-unit", negated: true }), fragment: "TARGET" }, grant()]);
    expect(result.ok ? [] : result.errors).toEqual(["A stratagem TARGET needs exactly one target leaf; found 0."]);
  });

  it("ends an effect at the start of your next turn or Command phase", () => {
    expect(compiled([grant(), leaf("DURATION", "duration", { endpoint: "start-of-next-command-phase" })]).mechanics.scope).toEqual({ duration: "until-next-command-phase" });
    expect(compiled([grant(), leaf("DURATION", "duration", { endpoint: "start-of-next-turn" })]).mechanics.scope).toEqual({ duration: "until-start-next-turn" });
  });
});
