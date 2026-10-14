import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { coreCheckErrors } from "../src/round5c/core-checks.js";

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
  const root = mkdtempSync(join(tmpdir(), "round5c-core-"));
  roots.push(root);
  mkdirSync(join(root, "core", "fixture"), { recursive: true });
  writeFileSync(join(root, "core", "fixture", "stratagems.json"), JSON.stringify(stratagems));
  writeFileSync(join(root, "core", "fixture", "enhancements.json"), JSON.stringify(enhancements));
  return root;
}

describe("Round 5C restrictions", () => {
  it("writes how often into usage, and nothing else", () => {
    expect(compiled([leaf("RESTRICTION", "usage-limit", { frequency: "once-per-battle", per: "any" }), grant()]).mechanics.usage).toEqual({ frequency: "n-per-battle", count: 1 });
    expect(compiled([leaf("RESTRICTION", "usage-limit", { frequency: "once-per-turn", per: "unit" }), grant()]).mechanics.usage).toEqual({ frequency: "once-per-turn", per: "unit" });
    // Without a usage leaf the authored usage is kept, so the key is absent rather than null.
    expect("usage" in compiled([grant()]).mechanics).toBe(false);
    const two = compileLeaves([leaf("RESTRICTION", "usage-limit", { frequency: "once-per-turn", per: "any" }), leaf("RESTRICTION", "usage-limit", { frequency: "once-per-phase", per: "any" }), grant()]);
    expect(two.ok ? [] : two.errors).toContain("More than one usage limit; the entry has one usage.");
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
      inTarget(leaf("CONDITION", "unit-activity", { activity: "selected-to-shoot-this-phase", subject: "this-unit", negated: true })),
      inTarget(leaf("CONDITION", "unit-state", { states: ["engaged"], subject: "this-unit", negated: true })),
      { ...grant(), fragment: "EFFECT" },
    ]);
    expect(result.core).toEqual({ target_restrictions: {
      count: "one", side: "your-army", selects: "unit", required_keywords: ["INFANTRY", "WARDENS"], excluded_keywords: ["TITANIC"],
      eligibility: { operator: "and", operands: [
        { operator: "not", operands: [{ type: "happened", parameters: { event: "selected", filter: { to: "shoot" }, window: "phase" } }] },
        { operator: "not", operands: [{ type: "unit-state", parameters: { state: "engaged" } }] },
      ] },
    } });
    // The qualifiers say who can be picked, not when the effect applies.
    expect(result.mechanics.effect).toEqual({ type: "ability-grant", target: "this-unit", modifier: { ability: "fights-first" } });
  });

  it("binds \"that X unit\" to the WHEN moment, narrowing the trigger to its keywords", () => {
    const result = compiled([
      leaf("EVENT", "event", { kind: "selected-to-shoot" }),
      { ...leaf("RESTRICTION", "triggering-target", { selects: "unit", keywords: ["WARDENS"], match: "all" }), fragment: "TARGET" },
      grant(),
    ]);
    expect(result.core?.target_restrictions).toEqual({ count: "one", selects: "unit", required_keywords: ["WARDENS"], bound_to: "triggering-unit" });
    // The moment's unit is this unit, so "that WARDENS unit" is a keyword condition on it, not any WARDENS unit.
    expect(result.mechanics.trigger).toEqual({ event: "selected", filter: { to: "shoot" }, condition: { type: "has-keyword", parameters: { all_of: ["WARDENS"] } } });
    const attacked = compiled([
      { ...leaf("RESTRICTION", "stratagem-target", { count: "one", side: "your-army", selects: "unit", keywords: ["WARDENS", "ORACLES"], match: "any", excluded_keywords: [] }), fragment: "TARGET" },
      { ...leaf("RESTRICTION", "target-binding", { bound_to: "attacked-unit" }), fragment: "TARGET" },
      grant(),
    ]);
    expect(attacked.core?.target_restrictions).toEqual({ count: "one", side: "your-army", selects: "unit", required_keywords_any: ["WARDENS", "ORACLES"], bound_to: "attacked-unit" });
  });

  it("refuses a TARGET without exactly one target leaf", () => {
    const result = compileLeaves([{ ...leaf("CONDITION", "unit-activity", { activity: "fought-this-phase", subject: "this-unit", negated: true }), fragment: "TARGET" }, grant()]);
    expect(result.ok ? [] : result.errors).toEqual(["A stratagem TARGET needs exactly one target leaf; found 0."]);
  });

  it("ends an effect at the start of your next turn or Command phase", () => {
    expect(compiled([grant(), leaf("DURATION", "duration", { endpoint: "start-of-next-command-phase" })]).mechanics.scope).toEqual({ duration: "until-next-command-phase" });
    expect(compiled([grant(), leaf("DURATION", "duration", { endpoint: "start-of-next-turn" })]).mechanics.scope).toEqual({ duration: "until-start-next-turn" });
  });
});
