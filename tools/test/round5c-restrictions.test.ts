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
    expect(withEvent.mechanics).toMatchObject({ behavior: "reactive", trigger: { event: "charge-move", optional: true } });
    expect(compiled([leaf("RESTRICTION", "optional-use", { who: "bearer" }), grant()]).mechanics).toMatchObject({ behavior: "activated", trigger: null });
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

  it("ends an effect at the start of your next turn or Command phase", () => {
    expect(compiled([grant(), leaf("DURATION", "duration", { endpoint: "start-of-next-command-phase" })]).mechanics.scope).toEqual({ range: "unit", duration: "until-next-command-phase" });
    expect(compiled([grant(), leaf("DURATION", "duration", { endpoint: "start-of-next-turn" })]).mechanics.scope).toEqual({ range: "unit", duration: "until-start-next-turn" });
  });
});
