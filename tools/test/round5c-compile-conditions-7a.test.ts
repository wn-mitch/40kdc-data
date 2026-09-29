import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { previewLeaf } from "../src/round5c/leaf-preview.js";

/**
 * Batch 7a: event@8's six new trigger kinds, duration@3's seven new endpoints, usage-limit@2's
 * three new frequencies, the mission/composition predicate families (model-profile, loadout,
 * eligible, resource, operation-markers, engagement-fronts, destroyed-while-on-objective,
 * destroyed-in-tagged-terrain), and the two behavior flags aura.range_cap/counts_as_move.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>, familyVersion = 1): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: familyVersion, parameters, start_byte: offset };
}

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

function rendered(base: Record<string, unknown>, leaves: CompileLeaf[]): string {
  const entry = entryWithMechanics(base, compiled(leaves).mechanics);
  const check = checkEntry(entry);
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

const heal = () => leaf("EFFECT", "regain-wounds", { subject: "this-unit", amount: "1" }, 2);
const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

describe("Round 5C batch-7a event@8 trigger kinds", () => {
  it("compiles the six new trigger kinds", () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ kind: "after-roll", roll: "hit" }, { event: "after-roll", filter: { roll: "hit" } }],
      [{ kind: "battle-formations-declared" }, { event: "battle-formations-declared" }],
      [{ kind: "marker-removed", marker: "Contamination" }, { event: "marker-removed", filter: { marker: "Contamination" } }],
      [{ kind: "objective-gained" }, { event: "objective-gained" }],
      [{ kind: "resource-gained", pool: "cp" }, { event: "resource-gained", filter: { pool: "cp" } }],
      [{ kind: "resource-spent", pool: "flux" }, { event: "resource-spent", filter: { pool: "flux" } }],
    ];
    for (const [parameters, expected] of cases) {
      const result = compiled([leaf("EVENT", "event", parameters, 8), heal()]);
      expect(result.mechanics.trigger).toEqual(expected);
      expect(rendered(base(), [leaf("EVENT", "event", parameters, 8), heal()])).toBeTruthy();
    }
  });

  it("migrates a version-7 event leaf straight through to version 8", () => {
    expect(normalizeFingerprintParameters("event", { kind: "disembarked" }, 8)).toEqual({ kind: "disembarked" });
  });
});

describe("Round 5C batch-7a duration@3 endpoints", () => {
  it("compiles all seven new endpoints to their scope.duration value", () => {
    const cases: Array<[string, string]> = [
      ["end-of-attack-sequence", "attack-sequence"],
      ["end-of-this-use", "resolution"],
      ["start-of-next-shooting-phase", "until-next-shooting-phase"],
      ["end-of-your-next-turn", "until-end-of-your-next-turn"],
      ["end-of-opponents-next-turn", "until-end-of-opponent-next-turn"],
      ["this-unit-has-shot", "until-this-unit-has-shot"],
      ["control-lost", "control-lost"],
    ];
    for (const [endpoint, scopeDuration] of cases) {
      const result = compiled([leaf("DURATION", "duration", { endpoint }, 3), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })]);
      expect(result.mechanics.scope).toEqual({ duration: scopeDuration });
    }
  });
});

describe("Round 5C batch-7a usage-limit@2 frequencies", () => {
  it("accepts the three new frequencies and passes them through to usage", () => {
    for (const frequency of ["once-per-command-phase", "first-this-battle", "first-time-this-phase"]) {
      const result = compiled([
        leaf("RESTRICTION", "usage-limit", { frequency, per: "any" }, 2),
        leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" }),
      ]);
      expect(result.mechanics.usage).toEqual({ frequency });
    }
  });
});

describe("Round 5C batch-7a mission/composition predicates", () => {
  const effect = () => leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" });
  function conditionCase(familyId: string, parameters: Record<string, unknown>, expected: Record<string, unknown>): void {
    const result = compiled([leaf("CONDITION", familyId, parameters), effect()]);
    expect(result.mechanics.effect).toEqual({ type: "conditional", condition: expected, effect: { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } } });
  }

  it("compiles model-profile, loadout, eligible, resource", () => {
    conditionCase("model-profile", { profile: "szarekh" }, { type: "model-profile", parameters: { profile: "szarekh" } });
    conditionCase("loadout", { uniform: "ranged" }, { type: "loadout", parameters: { uniform: "ranged" } });
    conditionCase("loadout", { model_keyword: "GUN DRONE", uniform: "melee" }, { type: "loadout", parameters: { model_keyword: "GUN DRONE", uniform: "melee" } });
    conditionCase("eligible", { to: "shoot" }, { type: "eligible", parameters: { to: "shoot" } });
    conditionCase("eligible", { to: "be-selected", source_ability_id: "auspex-scan", at: "opponents-previous-turn-end" },
      { type: "eligible", parameters: { to: "be-selected", source_ability: { ability_id: "auspex-scan" }, at: "opponents-previous-turn-end" } });
    conditionCase("resource", { pool: "cp", at_least: 3 }, { type: "resource", parameters: { pool: "cp", at_least: 3 } });
    conditionCase("resource", { pool: "cp", below_max: true, source_ability_id: "auspex-scan" },
      { type: "resource", parameters: { pool: "cp", below_max: true, source_ability: { ability_id: "auspex-scan" } } });
  });

  it("rejects resource with none of at_least/at_most/below_max", () => {
    expect(() => normalizeFingerprintParameters("resource", { pool: "cp" })).toThrow(/at_least, at_most, or below_max/u);
  });

  it("compiles the four mission-card board predicates", () => {
    conditionCase("operation-markers", { side: "friendly", count_min: 2 }, { type: "operation-markers", parameters: { side: "friendly", count_min: 2 } });
    conditionCase("operation-markers", { friendly_unit_in_same_terrain_area: true, no_enemy_in_terrain_area: true },
      { type: "operation-markers", parameters: { friendly_unit_in_same_terrain_area: true, no_enemy_in_terrain_area: true } });
    conditionCase("engagement-fronts", { count_min: 2 }, { type: "engagement-fronts", parameters: { count_min: 2 } });
    conditionCase("destroyed-while-on-objective", { count_min: 1, destroyer_on_objective: true }, { type: "destroyed-while-on-objective", parameters: { count_min: 1, destroyer_on_objective: true } });
    conditionCase("destroyed-in-tagged-terrain", { tag: "toxic", at_start_of_turn: true }, { type: "destroyed-in-tagged-terrain", parameters: { tag: "toxic", at_start_of_turn: true } });
  });
});

describe("Round 5C batch-7a behavior flags", () => {
  it("compiles aura-range@2's range_cap_inches and make-move@2's counts_as_move", () => {
    const grant = leaf("EFFECT", "fights-first", { subject: "this-model" });
    const withCap = compiled([leaf("CONDITION", "aura-range", { side: "friendly", inches: 6, range_cap_inches: 12 }, 2), grant]);
    expect(withCap.mechanics.effect).toMatchObject({ type: "aura", modifier: { range: 6, range_cap: 12 } });

    const move = compiled([leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", counts_as_move: "advance" }, 2)]);
    expect(move.mechanics.effect).toEqual({ type: "move", target: "this-unit", modifier: { move_type: "normal", counts_as_move: "advance" } });
  });

  it("migrates aura-range@1 and make-move@1 leaves straight through", () => {
    expect(normalizeFingerprintParameters("aura-range", { side: "enemy", inches: 6 }, 2)).toEqual({ side: "enemy", inches: 6 });
    expect(normalizeFingerprintParameters("make-move", { subject: "this-unit", move_type: "normal" }, 2)).toEqual({ subject: "this-unit", move_type: "normal" });
  });
});

describe("Round 5C batch-7a describer round-trip", () => {
  it("round-trips leaf parameters to readable describer English", () => {
    const previews: Array<[string, Record<string, unknown>, number, RegExp]> = [
      ["model-profile", { profile: "szarekh" }, 1, /Szarekh model/iu],
      ["loadout", { uniform: "ranged" }, 1, /ranged weapons/iu],
      ["eligible", { to: "shoot" }, 1, /eligible to shoot/iu],
      ["resource", { pool: "cp", at_least: 3 }, 1, /3\+ cp/iu],
      ["operation-markers", { count_min: 2 }, 1, /operation markers/iu],
      ["engagement-fronts", { count_min: 2 }, 1, /engaged on 2\+ fronts/iu],
      ["destroyed-while-on-objective", { count_min: 1 }, 1, /enemy units destroyed/iu],
      ["destroyed-in-tagged-terrain", { tag: "toxic" }, 1, /toxic terrain/iu],
    ];
    for (const [family_id, parameters, family_version, expected] of previews) {
      const preview = previewLeaf({ family_id, family_version, parameters });
      expect(preview.problem).toBeNull();
      expect(preview.text).toMatch(expected);
    }
  });
});
