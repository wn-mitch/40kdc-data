import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { previewLeaf } from "../src/semantic-authoring/leaf-preview.js";

/**
 * Batch 7a: event's six trigger kinds, duration's seven endpoints, usage-limit's
 * three frequencies, the mission/composition predicate families (model-profile, loadout,
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
function leaf(role: string, familyId: string, parameters: Record<string, unknown>): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: currentFamilyVersion(familyId), parameters: normalizeFingerprintParameters(familyId, parameters), start_byte: offset };
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

const heal = () => leaf("EFFECT", "regain-wounds", { subject: "this-unit", amount: "1" });
const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

describe("Semantic authoring batch-7a event trigger kinds", () => {
  it("compiles the six trigger kinds", () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ kind: "after-roll", roll: "hit" }, { event: "after-roll", filter: { roll: "hit" } }],
      [{ kind: "battle-formations-declared" }, { event: "battle-formations-declared" }],
      [{ kind: "marker-removed", marker: "Contamination" }, { event: "marker-removed", filter: { marker: "Contamination" } }],
      [{ kind: "objective-gained" }, { event: "objective-gained" }],
      [{ kind: "resource-gained", pool: "cp" }, { event: "resource-gained", filter: { pool: "cp" } }],
      [{ kind: "resource-spent", pool: "flux" }, { event: "resource-spent", filter: { pool: "flux" } }],
    ];
    for (const [parameters, expected] of cases) {
      const result = compiled([leaf("EVENT", "event", parameters), heal()]);
      expect(result.mechanics.trigger).toEqual(expected);
      expect(rendered(base(), [leaf("EVENT", "event", parameters), heal()])).toBeTruthy();
    }
  });
});

describe("Semantic authoring batch-7a duration endpoints", () => {
  it("compiles all seven endpoints to their scope.duration value", () => {
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
      const result = compiled([leaf("DURATION", "duration", { endpoint }), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" })]);
      expect(result.mechanics.scope).toEqual({ duration: scopeDuration });
    }
  });
});

describe("Semantic authoring batch-7a usage-limit frequencies", () => {
  it("accepts the three frequencies and passes them through to usage", () => {
    for (const frequency of ["once-per-command-phase", "first-this-battle", "first-time-this-phase"]) {
      const result = compiled([
        leaf("RESTRICTION", "usage-limit", { frequency, per: "any" }),
        leaf("EFFECT", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }),
      ]);
      expect(result.mechanics.usage).toEqual({ frequency });
    }
  });
});

describe("usage-limit first-time-this-turn", () => {
  it("passes the turn frequency through", () => {
    const result = compiled([
      leaf("RESTRICTION", "usage-limit", { frequency: "first-time-this-turn", per: "any" }),
      leaf("EFFECT", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }),
    ]);
    expect(result.mechanics.usage).toEqual({ frequency: "first-time-this-turn" });
  });

  it("renders the turn frequency as its own phrase, not the phase one", () => {
    const text = rendered(base(), [
      leaf("RESTRICTION", "usage-limit", { frequency: "first-time-this-turn", per: "any" }),
      leaf("EFFECT", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }),
    ]);
    expect(text).toMatch(/first time each turn/u);
    expect(text).not.toMatch(/each phase/u);
  });
});

describe("Semantic authoring batch-7a mission/composition predicates", () => {
  const effect = () => leaf("EFFECT", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" });
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
    conditionCase("resource", { pool: "cp", at_least: 3 }, { type: "resource", parameters: { pool: "cp", count: { min: 3 } } });
    conditionCase("resource", { pool: "cp", below_max: true, source_ability_id: "auspex-scan" },
      { type: "resource", parameters: { pool: "cp", below_max: true, source_ability: { ability_id: "auspex-scan" } } });
  });

  it("rejects resource with none of at_least/at_most/below_max", () => {
    expect(() => normalizeFingerprintParameters("resource", { pool: "cp" })).toThrow(/at_least, at_most, or below_max/u);
  });

  it("compiles the four mission-card board predicates", () => {
    conditionCase("operation-markers", { side: "friendly", count_min: 2 }, { type: "operation-markers", parameters: { side: "friendly", count: { min: 2 } } });
    conditionCase("operation-markers", { friendly_unit_in_same_terrain_area: true, no_enemy_in_terrain_area: true },
      { type: "operation-markers", parameters: { friendly_unit_in_same_terrain_area: true, no_enemy_in_terrain_area: true } });
    conditionCase("engagement-fronts", { count_min: 2 }, { type: "engagement-fronts", parameters: { count: { min: 2 } } });
    conditionCase("destroyed-while-on-objective", { count_min: 1, destroyer_on_objective: true }, { type: "destroyed-while-on-objective", parameters: { count: { min: 1 }, destroyer_on_objective: true } });
    conditionCase("destroyed-in-tagged-terrain", { tag: "toxic", at_start_of_turn: true }, { type: "destroyed-in-tagged-terrain", parameters: { tag: "toxic", at_start_of_turn: true } });
  });
});

describe("Semantic authoring batch-7a behavior flags", () => {
  it("compiles aura-range's range_cap_inches and make-move's counts_as_move", () => {
    const grant = leaf("EFFECT", "fights-first", { subject: "this-model" });
    const withCap = compiled([leaf("CONDITION", "aura-range", { side: "friendly", inches: 6, range_cap_inches: 12 }), grant]);
    // The DSL's range_cap is a whole number of inches (effect.schema.json aura-effect), not a range-ref.
    expect(withCap.mechanics.effect).toMatchObject({ type: "aura", modifier: { range: { inches: 6 }, range_cap: { inches: 12 } } });

    const move = compiled([leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", counts_as_move: "advance" })]);
    expect(move.mechanics.effect).toEqual({ type: "move", target: "this-unit", modifier: { move_type: "normal", counts_as_move: "advance" } });
  });
});

describe("Semantic authoring batch-7a describer round-trip", () => {
  it("round-trips leaf parameters to readable describer English", () => {
    const previews: Array<[string, Record<string, unknown>, RegExp]> = [
      ["model-profile", { profile: "szarekh" }, /Szarekh model/iu],
      ["loadout", { uniform: "ranged" }, /ranged weapons/iu],
      ["eligible", { to: "shoot" }, /eligible to shoot/iu],
      ["resource", { pool: "cp", at_least: 3 }, /3 or more cp/iu],
      ["operation-markers", { count_min: 2 }, /operation markers/iu],
      ["engagement-fronts", { count_min: 2 }, /engaged on 2 or more fronts/iu],
      ["destroyed-while-on-objective", { count_min: 1 }, /enemy units destroyed/iu],
      ["destroyed-in-tagged-terrain", { tag: "toxic" }, /toxic terrain/iu],
    ];
    for (const [family_id, parameters, expected] of previews) {
      const preview = previewLeaf({ family_id, family_version: currentFamilyVersion(family_id), parameters });
      expect(preview.problem).toBeNull();
      expect(preview.text).toMatch(expected);
    }
  });
});

// leaf-coverage.ts's collectLiterals fix (this round) exposed predicate:roll-result as a real,
// previously-hidden gap: the "roll-result" family id already names dice-families.ts's band
// (on-a-4+) family, so this new one is "roll-outcome" — the condition.schema.json predicate,
// `{type: "roll-result", parameters: {roll, result, source?}}`, distinct from the roll-result
// EFFECT (roll-auto-result/critical-hit-threshold's output shape) the coverage sweep used to
// conflate it with.
describe("Semantic authoring roll-outcome predicate (closes the roll-result coverage gap)", () => {
  const effect = () => leaf("EFFECT", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" });

  it("compiles roll, result and an optional source binding", () => {
    const bare = compiled([leaf("CONDITION", "roll-outcome", { roll: "wound", result: "critical" }), effect()]);
    expect(bare.mechanics.effect).toEqual({
      type: "conditional",
      condition: { type: "roll-result", parameters: { roll: "wound", result: "critical" } },
      effect: { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } },
    });

    const bound = compiled([leaf("CONDITION", "roll-outcome", { roll: "hit", result: "success", source: "the-shot" }), effect()]);
    expect(bound.mechanics.effect).toMatchObject({
      condition: { type: "roll-result", parameters: { roll: "hit", result: "success", source: { event_var: "the-shot" } } },
    });

    const negated = compiled([leaf("CONDITION", "roll-outcome", { roll: "save", result: "failure", negated: true }), effect()]);
    expect(negated.mechanics.effect).toMatchObject({
      condition: { operator: "not", operands: [{ type: "roll-result", parameters: { roll: "save", result: "failure" } }] },
    });
  });

  // Pins crack-shot-tau-empire's authored condition exactly: the one real record with this shape.
  it("reproduces crack-shot-tau-empire's roll-result condition exactly", () => {
    const authoredAbility = authored("tau-empire", "crack-shot-tau-empire");
    const authoredCondition = (authoredAbility.effect as Record<string, unknown>).effect as Record<string, unknown>;
    expect((authoredCondition.condition as Record<string, unknown>)).toEqual({ type: "roll-result", parameters: { roll: "wound", result: "critical" } });

    const result = compiled([leaf("CONDITION", "roll-outcome", { roll: "wound", result: "critical" }),
      leaf("EFFECT", "characteristic-modifier", { subject: "this-unit", characteristics: ["AP"], operation: "improve", value: 1, weapon_type: "ranged" })]);
    expect((result.mechanics.effect as Record<string, unknown>).condition).toEqual(authoredCondition.condition);
  });

  it("rejects a leaf missing roll or result, and an unknown result", () => {
    expect(() => normalizeFingerprintParameters("roll-outcome", { roll: "wound" })).toThrow();
    expect(() => normalizeFingerprintParameters("roll-outcome", { roll: "wound", result: "fumble" })).toThrow();
  });

  it("renders readable describer English", () => {
    const preview = previewLeaf({ family_id: "roll-outcome", family_version: currentFamilyVersion("roll-outcome"), parameters: { roll: "wound", result: "critical" } });
    expect(preview.problem).toBeNull();
    expect(preview.text?.length ?? 0).toBeGreaterThan(0);
  });
});
