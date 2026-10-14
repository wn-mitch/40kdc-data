import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { prefillFromSource, type PrefillFamily } from "../src/round5c/leaf-prefill.js";
import { previewLeaf } from "../src/round5c/leaf-preview.js";

/**
 * Batch 6 (conditions & trigger events): `event` version 7's twelve new trigger kinds, the new
 * `phase-window` condition (phase-is/player-turn-is outside a trigger), and the new predicate
 * families in `predicate-families.ts`/`predicate-families-2.ts`. Split out of
 * round5c-compile.test.ts per the leaf-family batching brief.
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

/** The compiled entry on a real authored base must validate against the ability schema, lint, and render. */
function rendered(base: Record<string, unknown>, leaves: CompileLeaf[]): string {
  const entry = entryWithMechanics(base, compiled(leaves).mechanics);
  const check = checkEntry(entry);
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

const heal = () => leaf("EFFECT", "regain-wounds", { subject: "this-unit", amount: "1" }, 2);
const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

describe("Round 5C batch-6 event@7 trigger kinds", () => {
  it("compiles the twelve new bare and filtered game-clock/history moments", () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ kind: "battle-started" }, { event: "battle-started" }],
      [{ kind: "deployment-ended" }, { event: "deployment-ended" }],
      [{ kind: "round-ended" }, { event: "round-ended" }],
      [{ kind: "turn-ended" }, { event: "turn-ended" }],
      [{ kind: "turn-ended", turn: "opponent" }, { event: "turn-ended", condition: { type: "player-turn-is", parameters: { turn: "opponent-turn" } } }],
      [{ kind: "turn-ended", turn: "either" }, { event: "turn-ended" }],
      [{ kind: "step-started", step: "battle-shock" }, { event: "step-started", filter: { step: "battle-shock" } }],
      [{ kind: "disembarked" }, { event: "disembarked" }],
      [{ kind: "before-roll", roll: "hit" }, { event: "before-roll", filter: { roll: "hit" } }],
      [{ kind: "damage-allocated" }, { event: "damage-allocated" }],
      [{ kind: "used", activity: "stratagem" }, { event: "used", filter: { kind: "stratagem" } }],
      [{ kind: "state-changed", state: "battle-shocked" }, { event: "state-changed", filter: { state: "battle-shocked" } }],
      [{ kind: "designation-changed", tag: "spotted" }, { event: "designation-changed", filter: { tag: "spotted" } }],
      [{ kind: "designation-resolved", tag: "oath-of-moment-target" }, { event: "designation-resolved", filter: { tag: "oath-of-moment-target" } }],
    ];
    for (const [parameters, expected] of cases) {
      const result = compiled([leaf("EVENT", "event", parameters, 7), heal()]);
      expect(result.mechanics.trigger).toEqual(expected);
      expect(rendered(base(), [leaf("EVENT", "event", parameters, 7), heal()])).toBeTruthy();
    }
  });

  it("rejects a version-7 kind's own filter field spelled outside its closed vocabulary", () => {
    expect(() => normalizeFingerprintParameters("event", { kind: "used", activity: "shopping" }, 7)).toThrow();
    expect(() => normalizeFingerprintParameters("event", { kind: "step-started", step: "morale" }, 7)).toThrow();
    expect(() => normalizeFingerprintParameters("event", { kind: "before-roll" }, 7)).toThrow(/exactly/u);
  });

  it("migrates a version-6 event leaf straight through to version 7 unchanged", () => {
    expect(normalizeFingerprintParameters("event", { kind: "this-model-destroyed" }, 7)).toEqual({ kind: "this-model-destroyed" });
  });
});

describe("Round 5C batch-6 phase-window (outside a trigger)", () => {
  it("compiles phase, turn, or both into phase-is/player-turn-is, ANDed when both are given", () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ phase: "shooting" }, { type: "phase-is", parameters: { phase: "shooting" } }],
      [{ turn: "opponent" }, { type: "player-turn-is", parameters: { turn: "opponent-turn" } }],
      [{ phase: "fight", turn: "your" }, { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "fight" } }, { type: "player-turn-is", parameters: { turn: "your-turn" } }] }],
      [{ phase: "charge", turn: "either" }, { type: "phase-is", parameters: { phase: "charge" } }],
    ];
    for (const [parameters, condition] of cases) {
      const result = compiled([leaf("CONDITION", "phase-window", parameters), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })]);
      expect(result.mechanics.effect).toEqual({ type: "conditional", condition, effect: { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } } });
    }
  });

  it("rejects a phase-window with neither phase nor turn", () => {
    expect(() => normalizeFingerprintParameters("phase-window", {})).toThrow(/needs/u);
  });
});

describe("Round 5C batch-6 predicate families", () => {
  const effect = () => leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" });

  function conditionCase(familyId: string, parameters: Record<string, unknown>, expected: Record<string, unknown>): void {
    const result = compiled([leaf("CONDITION", familyId, parameters), effect()]);
    expect(result.mechanics.effect).toEqual({ type: "conditional", condition: expected, effect: { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } } });
  }

  it("compiles rule-active, unit-owner, unit-has-ability, same-unit", () => {
    conditionCase("rule-active", { rule: "oath-of-moment" }, { type: "rule-active", parameters: { rule: "oath-of-moment" } });
    conditionCase("unit-owner", { owner: "enemy" }, { type: "owned-by", parameters: { owner: "enemy" } });
    conditionCase("unit-owner", { subject: "defender", owner: "friendly", negated: true },
      { operator: "not", operands: [{ type: "owned-by", parameters: { subject: "defender", owner: "friendly" } }] });
    conditionCase("unit-has-ability", { ability: "deep-strike" }, { type: "has-ability", parameters: { ability: "deep-strike" } });
    conditionCase("same-unit", { as: "selected-unit" }, { type: "same-unit", parameters: { as: "selected-unit" } });
  });

  it("compiles model-count and wounds-state with their optional fields", () => {
    conditionCase("model-count", { min: 6 }, { type: "model-count", parameters: { min: 6 } });
    conditionCase("model-count", { keyword: "CHARACTER", max: 3 }, { type: "model-count", parameters: { keyword: "CHARACTER", max: 3 } });
    conditionCase("wounds-state", { kind: "lost" }, { type: "wounds", parameters: { lost: true } });
    conditionCase("wounds-state", { kind: "damaged" }, { type: "wounds", parameters: { damaged: true } });
    conditionCase("wounds-state", { kind: "remaining-at-most", value: 3 }, { type: "wounds", parameters: { remaining_max: 3 } });
  });

  it("rejects model-count with neither min nor max", () => {
    expect(() => normalizeFingerprintParameters("model-count", {})).toThrow(/min, max/u);
  });

  it("compiles history-compare's tally, value, and pool right sides", () => {
    conditionCase("history-compare", { comparison: "greater-or-equal", right_kind: "value", right_value: 3 }, {
      type: "happened-compare",
      parameters: { left: { event: "destroyed", object: { owner: "enemy" }, window: "battle" }, comparison: "greater-or-equal", right: { value: 3 } },
    });
    conditionCase("history-compare", { left_kind: "character", comparison: "greater-than", right_kind: "tally", right_tally_kind: "any" }, {
      type: "happened-compare",
      parameters: {
        left: { event: "destroyed", object: { owner: "enemy", all_of: ["CHARACTER"] }, window: "battle" },
        comparison: "greater-than",
        right: { event: "destroyed", object: { owner: "enemy" }, window: "battle" },
      },
    });
  });

  it("compiles in-region for a territory and a tagged terrain area", () => {
    conditionCase("in-region", { region_kind: "territory", territory: "no-mans-land" }, { type: "in-region", parameters: { region: { territory: "no-mans-land" } } });
    conditionCase("in-region", { region_kind: "terrain-area", terrain_tag: "ruins", wholly: true, models: "every" },
      { type: "in-region", parameters: { region: { terrain_area: { footprint: "ruins" } }, wholly: true, models: "every" } });
  });

  it("compiles controls-objective in count mode and more-than-opponent mode", () => {
    conditionCase("controls-objective", { mode: "count", by: "friendly", count_min: 2 }, { type: "controls", parameters: { by: "friendly", count_min: 2 } });
    conditionCase("controls-objective", { mode: "count", objective_role: "central", home_of: "enemy" },
      { type: "controls", parameters: { objective: { role: "central", home_of: "enemy" } } });
    conditionCase("controls-objective", { mode: "more-than-opponent" }, { type: "controls", parameters: { compare: "more-than-opponent" } });
  });

  it("rejects controls-objective count fields alongside more-than-opponent", () => {
    expect(() => normalizeFingerprintParameters("controls-objective", { mode: "more-than-opponent", count_min: 1 })).toThrow();
  });

  it("compiles attack-filter and attack-compare", () => {
    conditionCase("attack-filter", { attack_type: "ranged" }, { type: "attack-is", parameters: { attack_type: "ranged" } });
    conditionCase("attack-filter", { weapon_keyword: "BLAST", all_target_same_unit: true }, { type: "attack-is", parameters: { weapon_keyword: "BLAST", all_target_same_unit: true } });
    conditionCase("attack-compare", { left_of: "attacker", left_stat: "S", comparison: "greater-than", right_kind: "stat", right_of: "defender", right_stat: "T" },
      { type: "attack-compare", parameters: { left: { of: "attacker", stat: "S" }, comparison: "greater-than", right: { of: "defender", stat: "T" } } });
    conditionCase("attack-compare", { left_of: "attacker", left_stat: "D", comparison: "greater-or-equal", right_kind: "value", right_value: 3 },
      { type: "attack-compare", parameters: { left: { of: "attacker", stat: "D" }, comparison: "greater-or-equal", right: { value: 3 } } });
  });

  it("rejects attack-filter with no filter field at all", () => {
    expect(() => normalizeFingerprintParameters("attack-filter", {})).toThrow(/at least one/u);
  });

  it("compiles visible, designated-filter, battle-round, battle-size, guided, moved-over", () => {
    conditionCase("visible", {}, { type: "visible", parameters: {} });
    conditionCase("visible", { to: "attacker", fully: true, blocked_by: "event-object" }, { type: "visible", parameters: { to: "attacker", fully: true, blocked_by: "event-object" } });
    conditionCase("designated-filter", { tag: "afflicted" }, { type: "designated", parameters: { tag: "afflicted" } });
    conditionCase("designated-filter", { subject: "defender", tag: "spotted", by: "this-model", count_min: 1 },
      { type: "designated", parameters: { subject: "defender", tag: "spotted", by: "this-model", count_min: 1 } });
    conditionCase("battle-round", { min: 3 }, { type: "battle-round", parameters: { min: 3 } });
    conditionCase("battle-round", { min: 1, max: 2 }, { type: "battle-round", parameters: { min: 1, max: 2 } });
    conditionCase("battle-size", { size: "onslaught" }, { type: "battle-size", parameters: { size: "onslaught" } });
    conditionCase("guided", {}, { type: "guided", parameters: {} });
    conditionCase("guided", { subject: "this-unit" }, { type: "guided", parameters: { subject: "this-unit" } });
    conditionCase("moved-over", { by: "this-model" }, { type: "moved-over", parameters: { by: "this-model" } });
    conditionCase("moved-over", { by: "this-model", window: "phase" }, { type: "moved-over", parameters: { by: "this-model", window: "phase" } });
  });

  it("rejects battle-round with neither min nor max", () => {
    expect(() => normalizeFingerprintParameters("battle-round", {})).toThrow(/min, max/u);
  });
});

describe("Round 5C batch-6 army-faction@2 (resolved kebab id)", () => {
  it("compiles a reviewer-resolved faction id, and still refuses a pending quote", () => {
    const resolved = compiled([leaf("CONDITION", "army-faction", { faction: "ultramarines" }, 2), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })]);
    expect(resolved.mechanics.effect).toEqual({
      type: "conditional", condition: { type: "army-faction", parameters: { faction: "ultramarines" } },
      effect: { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } },
    });
    const pending = compileLeaves([leaf("CONDITION", "army-faction", { faction: { source: "Ultramarines" } }, 2), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })]);
    expect(pending.ok).toBe(false);
  });
});

describe("Round 5C batch-6 widened subject vocabulary (unit-keyword@2, unit-state@4, unit-activity@3, unit-position@2)", () => {
  function conditionCase(familyId: string, parameters: Record<string, unknown>, version: number, expected: Record<string, unknown>): void {
    const result = compiled([leaf("CONDITION", familyId, parameters, version), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })]);
    expect(result.mechanics.effect).toEqual({ type: "conditional", condition: expected, effect: { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } } });
  }

  it("compiles unit-keyword@2's new subjects, in addition to the old this-unit/target", () => {
    conditionCase("unit-keyword", { keywords: ["CHARACTER"], subject: "attacker", negated: false }, 2, { type: "has-keyword", parameters: { subject: "attacker", all_of: ["CHARACTER"] } });
    conditionCase("unit-keyword", { keywords: ["CHARACTER"], subject: "event-subject", negated: false }, 2, { type: "has-keyword", parameters: { subject: "event-subject", all_of: ["CHARACTER"] } });
    conditionCase("unit-keyword", { keywords: ["CHARACTER"], subject: "recipient", negated: false }, 2, { type: "has-keyword", parameters: { subject: "recipient", all_of: ["CHARACTER"] } });
    conditionCase("unit-keyword", { keywords: ["CHARACTER"], subject: "selected-unit", negated: false }, 2, { type: "has-keyword", parameters: { subject: "selected-unit", all_of: ["CHARACTER"] } });
    conditionCase("unit-keyword", { keywords: ["CHARACTER"], subject: "this-model", negated: false }, 2, { type: "has-keyword", parameters: { subject: "this-model", all_of: ["CHARACTER"] } });
    // Old this-unit/target still compile the same way as version 1.
    conditionCase("unit-keyword", { keywords: ["CHARACTER"], subject: "this-unit", negated: false }, 2, { type: "has-keyword", parameters: { all_of: ["CHARACTER"] } });
    conditionCase("unit-keyword", { keywords: ["CHARACTER"], subject: "target", negated: false }, 2, { type: "has-keyword", parameters: { subject: "defender", all_of: ["CHARACTER"] } });
  });

  it("compiles unit-state@4's new subjects for both strength and core states", () => {
    conditionCase("unit-state", { states: ["below-half-strength"], subject: "attacker", negated: false }, 4, { type: "strength", parameters: { subject: "attacker", below: "half" } });
    conditionCase("unit-state", { states: ["battle-shocked"], subject: "recipient", negated: false }, 4, { type: "unit-state", parameters: { subject: "recipient", state: "battle-shocked" } });
    conditionCase("unit-state", { states: ["on-battlefield"], subject: "this-model", negated: false }, 4, { type: "unit-state", parameters: { subject: "this-model", state: "on-battlefield" } });
  });

  it("compiles unit-activity@3's new subjects", () => {
    conditionCase("unit-activity", { activity: "charged-this-turn", subject: "selected-unit", negated: false }, 3,
      { type: "happened", parameters: { subject: "selected-unit", event: "move-ended", filter: { move_types: ["charge"] }, window: "turn" } });
  });

  it("compiles unit-position@2's widened objective-range subject and closest-eligible's new to/range", () => {
    conditionCase("unit-position", { kind: "objective-range", controlled_by: "any", subject: "event-subject", negated: false }, 2,
      { type: "within", parameters: { subject: "event-subject", of: { objective: {} }, range: "objective-control" } });
    conditionCase("unit-position", { kind: "closest-eligible", subject: "this-unit", negated: false, to: "selected-unit", range: 9 }, 2,
      { type: "closest", parameters: { among: "eligible-targets", to: "selected-unit", range: { inches: 9 } } });
    // within/beyond still require subject "target"; closest-eligible/objective-range no longer do.
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", inches: 6, subject: "this-unit", negated: false }, 2)).toThrow(/subject must be target/u);
  });

  it("migrates version-1/2/3 leaves of the four widened families straight through unchanged", () => {
    expect(normalizeFingerprintParameters("unit-keyword", { keywords: ["CHARACTER"], subject: "target", negated: false }, 1)).toEqual(
      normalizeFingerprintParameters("unit-keyword", { keywords: ["CHARACTER"], subject: "target", negated: false }, 2),
    );
    expect(normalizeFingerprintParameters("unit-position", { kind: "within", inches: 6, subject: "target", negated: false }, 1)).toEqual(
      normalizeFingerprintParameters("unit-position", { kind: "within", inches: 6, subject: "target", negated: false }, 2),
    );
  });
});

describe("Round 5C batch-6 describer round-trip and prefill", () => {
  it("round-trips leaf parameters to readable describer English", () => {
    const previews: Array<[string, Record<string, unknown>, number, RegExp]> = [
      ["rule-active", { rule: "oath-of-moment" }, 1, /is active/iu],
      ["unit-owner", { owner: "enemy" }, 1, /enemy unit/iu],
      ["model-count", { min: 6 }, 1, /contains 6\+ models/iu],
      ["wounds-state", { kind: "damaged" }, 1, /damaged/iu],
      ["in-region", { region_kind: "territory", territory: "no-mans-land" }, 1, /no.mans.land/iu],
      ["controls-objective", { mode: "more-than-opponent" }, 1, /more objectives than/iu],
      ["attack-filter", { attack_type: "melee" }, 1, /melee/iu],
      ["visible", { fully: true }, 1, /fully visible/iu],
      ["designated-filter", { tag: "spotted" }, 1, /spotted/iu],
      ["battle-round", { min: 3, max: 3 }, 1, /third battle round/iu],
      ["battle-size", { size: "strike-force" }, 1, /strike force/iu],
      ["guided", {}, 1, /guided/iu],
      ["moved-over", { by: "this-model" }, 1, /moved over/iu],
      ["phase-window", { phase: "shooting", turn: "your" }, 1, /shooting phase/iu],
      // destroyedCount() (condition-history.ts) must show a CHARACTER narrowing on either side, not just owner/window.
      ["history-compare", { left_kind: "character", comparison: "greater-than", right_kind: "tally", right_tally_kind: "any" }, 1, /enemy CHARACTER units.*than enemy units/iu],
      // closest's "to" (condition.ts) must show who it is closest to once it is not the default attacker.
      ["unit-position", { kind: "closest-eligible", subject: "this-unit", negated: false, to: "selected-unit" }, 2, /closest eligible target to the selected unit/iu],
    ];
    for (const [family_id, parameters, family_version, expected] of previews) {
      const preview = previewLeaf({ family_id, family_version, parameters });
      expect(preview.problem).toBeNull();
      expect(preview.text).toMatch(expected);
    }
  });

  const family = (id: string, parameterSchema: Record<string, unknown>): PrefillFamily => ({ id, parameterSchema });

  it("reads the regular wording batch-6 leaves prefill from their exact source text", () => {
    expect(prefillFromSource(family("unit-owner", { properties: { owner: { enum: ["friendly", "enemy"] }, negated: { type: "boolean" } } }), "is an enemy unit"))
      .toMatchObject({ owner: "enemy" });
    expect(prefillFromSource(family("battle-size", { properties: { size: { enum: ["incursion", "strike-force", "onslaught"] } } }), "the battle size is Onslaught"))
      .toMatchObject({ size: "onslaught" });
    expect(prefillFromSource(family("wounds-state", { properties: { kind: { enum: ["lost", "damaged", "remaining-at-most"] } } }), "has lost one or more wounds"))
      .toMatchObject({ kind: "lost" });
    expect(prefillFromSource(family("phase-window", { properties: { phase: { enum: ["command", "movement", "shooting", "charge", "fight"] }, turn: { enum: ["your", "opponent", "either"] } } }), "during your opponent's Shooting phase"))
      .toMatchObject({ phase: "shooting", turn: "opponent" });
    const eventFamily = family("event", { properties: { kind: {}, activity: { enum: ["stratagem", "ability", "action", "manoeuvre", "order", "ritual", "dark-pact", "act-of-faith", "doctrine", "contract"] } } });
    expect(prefillFromSource(eventFamily, "each time you use a Stratagem")).toMatchObject({ kind: "used", activity: "stratagem" });
    expect(prefillFromSource(eventFamily, "at the start of the battle")).toMatchObject({ kind: "battle-started" });
  });
});
