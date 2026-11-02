import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { CONFLICTING_DURATIONS, NO_ROLL_AFTER_ADVANCE, NO_ROLL_PLUS_SIX } from "../src/semantic-authoring/compile-durations.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/index.js";

/** A registered designation, so a designate-target compiles (compile-wrappers.ts designationIdFor). */
const FIXTURE_RULE_NAME = "A Trap Well Laid";

/**
 * Several printed durations in one ability (compile-durations.ts). The fixtures under
 * test/fixtures/semantic-authoring-durations are stored leaves of workbench records with their wording
 * masked; each pins a reading or refusal named in its test. Every other case is fabricated wording
 * written for this file.
 */

const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/semantic-authoring-durations/", import.meta.url));

type Fixture = { id: number; source_text: string; leaves: CompileLeaf[]; edits: string | null; baseline_mechanics?: unknown };

function fixture(id: number): Fixture {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}${id}.json`, "utf8")) as Fixture;
}

function compileFixture(id: number) {
  const { leaves, source_text } = fixture(id);
  return compileLeaves(leaves, source_text, { name: FIXTURE_RULE_NAME });
}

function mechanicsOf(id: number): Record<string, any> {
  const result = compileFixture(id);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const DURATION_PHASE = { endpoint: "end-of-phase" };
const DURATION_TURN = { endpoint: "end-of-turn" };
const MOVE_SIX = { subject: "this-unit", characteristics: ["M"], operation: "add", value: 6, weapon_type: "all" };
const ASSAULT = { subject: "this-unit", keyword: "Assault", weapon_type: "ranged" };

it("keeps expiry after resolution distinct from a duration during resolution", () => {
  const compileDuration = (endpoint: string) => {
    const result = compileLeaves(placed("Wait. Gain Assault.",
      ["Wait.", "duration", { endpoint }],
      ["Gain Assault.", "weapon-ability-grant", ASSAULT]), undefined, { name: FIXTURE_RULE_NAME });
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result.mechanics.scope?.duration;
  };
  expect(compileDuration("end-of-this-use")).toBe("resolution");
  expect(compileDuration("after-this-use")).toBe("after-resolving");
});

describe("bound durations on the stored records", () => {
  it("3746: the no-roll's +6 folds into it (one move, not two), the grant lasts the turn", () => {
    const mechanics = mechanicsOf(3746);
    const [noRoll, grant] = mechanics.effect.steps;
    expect(noRoll).toMatchObject({ type: "ability-part", duration: "phase", effect: { type: "move-modifier", modifier: { advance: "fixed-6" } } });
    expect(grant).toMatchObject({ type: "ability-part", duration: "turn", effect: { type: "weapon-ability-grant" } });
    expect(JSON.stringify(mechanics.effect)).not.toContain('"stat":"M"');
    expect(mechanics.trigger.event).toBe("move-started");
    expect(mechanics.scope.duration).toBe("permanent");
  });

  it("3746 with its first stored leaves (move-ended, no-roll on this unit, +6 on the antecedent) refuses: the +6 is on another unit than the no-roll", () => {
    const { leaves, source_text } = fixture(3746);
    const stored = leaves.map((leaf) => (leaf.family_id === "event" ? { ...leaf, parameters: { ...leaf.parameters, kind: "move-ended" } }
      : leaf.family_id === "no-advance-roll" ? { ...leaf, parameters: { subject: "this-unit" } } : leaf));
    const result = compileLeaves(stored, source_text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(NO_ROLL_PLUS_SIX);
  });

  it("1185 with its stored leaves (an Advance already happened) refuses: the no-roll cannot follow the Advance", () => {
    const { leaves, source_text } = fixture(1185);
    const stored = leaves.map((leaf) => (leaf.family_id === "event" ? { ...leaf, role: "CONDITION", family_id: "unit-activity", parameters: { activities: ["advanced-this-turn"], subject: "this-unit" } } : leaf));
    const result = compileLeaves(stored, source_text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(NO_ROLL_AFTER_ADVANCE);
  });

  it("1185: the window part carries the moment and the phase, and the turn part has no trigger", () => {
    const mechanics = mechanicsOf(1185);
    const [window, turn] = mechanics.effect.steps;
    expect(window).toMatchObject({ type: "ability-part", duration: "phase", trigger: { event: "move-started", filter: { move_types: ["advance"] } } });
    expect(window.trigger.subject).toBeUndefined();
    expect(JSON.stringify(window.effect)).toContain('"advance":"fixed-6"');
    expect(turn).toMatchObject({ type: "ability-part", duration: "turn" });
    expect(turn.trigger).toBeUndefined();
    expect(mechanics.trigger).toBeNull();
    expect(mechanics.scope.duration).toBe("permanent");
  });

  it("70: the no-roll takes the phase from its folded +6, under the penitent gate", () => {
    const mechanics = mechanicsOf(70);
    const [turn, gate] = mechanics.effect.steps;
    expect(turn).toMatchObject({ type: "ability-part", duration: "turn", effect: { type: "permission" } });
    expect(gate.type).toBe("conditional");
    expect(gate.effect).toMatchObject({ type: "ability-part", duration: "phase", effect: { type: "move-modifier" } });
    expect(mechanics.trigger.event).toBe("move-started");
  });

  it("6323: the strength lasts the turn, the armour penetration the phase, behind the Righteous gate", () => {
    const [strength, gated] = mechanicsOf(6323).effect.steps;
    expect(strength).toMatchObject({ type: "ability-part", duration: "turn", effect: { type: "stat-modifier" } });
    expect(gated.type).toBe("conditional");
    expect(gated.condition).toMatchObject({ type: "rule-active" });
    expect(gated.effect).toMatchObject({ type: "ability-part", duration: "phase" });
  });

  it("9605: the nested parts validate against the DSL effect schema, and the suppression lasts to the next turn", () => {
    const mechanics = mechanicsOf(9605);
    const validate = createValidator().compile({ $ref: "https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json#/$defs/effect-node" });
    expect(validate(mechanics.effect), JSON.stringify(validate.errors?.slice(0, 2))).toBe(true);
    expect(JSON.stringify(mechanics.effect)).toContain('"duration":"until-start-next-turn"');
    expect(mechanics.scope.duration).toBe("permanent");
  });

  it("4194: refused — the selection cannot carry past the attacks-resolved moment, else the pinned test follows the assailed mark", () => {
    const result = compileFixture(4194);
    expect(result.ok).toBe(false);
    // The selection-across-moment guard (compile-selection-moment.ts) fires first; without it the tag-order refusal would.
    const errors = result.ok ? [] : result.errors;
    expect(errors.some((error) => error.startsWith("A hit-by-attacks at byte") || error === "A tag tested after it is applied in the same part; the compiler does not order them.")).toBe(true);
  });

  it("8879 and 994: a set-up moment beside another moment is refused", () => {
    for (const id of [8879, 994]) {
      const result = compileFixture(id);
      expect(result.ok, `av ${id}`).toBe(false);
      expect(result.ok ? [] : result.errors, `av ${id}`).toContain("A set-up moment next to another moment has no reading yet.");
    }
  });

  it("1596 and 2540: the Strategic Reserves set-up is folded away before the check, so they still compile", () => {
    for (const id of [1596, 2540]) expect(compileFixture(id).ok, `av ${id}`).toBe(true);
  });

  it("3620: one moment (use-window, then set-up) is not refused", () => {
    expect(compileFixture(3620).ok).toBe(true);
  });

  it("a single-duration record keeps its canonical baseline mechanics", () => {
    for (const id of [3620, 1596, 2540]) {
      const { baseline_mechanics } = fixture(id);
      expect(mechanicsOf(id), `av ${id}`).toEqual(baseline_mechanics);
    }
  });
});

describe("bound durations on fabricated sentences", () => {
  it("X until A and Y until B: each effect takes the duration of its own clause", () => {
    const text = "Until the end of the phase, add 6 to Move and until the end of the turn, grant ASSAULT.";
    const leaves = placed(text,
      ["Until the end of the phase", "duration", DURATION_PHASE],
      ["add 6 to Move", "characteristic-modifier", MOVE_SIX],
      ["until the end of the turn", "duration", DURATION_TURN],
      ["grant ASSAULT", "weapon-ability-grant", ASSAULT]);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(true);
    const mechanics = result.ok ? (result.mechanics as any) : null;
    expect(mechanics.effect.steps).toEqual([
      { type: "ability-part", duration: "phase", effect: expect.objectContaining({ type: "stat-modifier" }) },
      { type: "ability-part", duration: "turn", effect: expect.objectContaining({ type: "weapon-ability-grant" }) },
    ]);
    expect(mechanics.scope.duration).toBe("permanent");
  });

  it("R1: two durations in one clause refuse", () => {
    const text = "Until the end of the phase, your unit is not eligible to charge until the end of the turn.";
    const leaves = placed(text,
      ["Until the end of the phase", "duration", DURATION_PHASE],
      ["is not eligible to charge", "eligibility-permission", { subject: "this-unit", activity: "declare-charge", allow: false }],
      ["until the end of the turn", "duration", DURATION_TURN]);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("Conflicting durations.");
  });

  it("R2: two durations in a sentence, with an effect in a clause that prints none, refuse", () => {
    const text = "Until the end of the phase, add 6 to Move and until the end of the turn, grant ASSAULT and subtract 1 from Toughness.";
    const leaves = placed(text,
      ["Until the end of the phase", "duration", DURATION_PHASE],
      ["add 6 to Move", "characteristic-modifier", MOVE_SIX],
      ["until the end of the turn", "duration", DURATION_TURN],
      ["grant ASSAULT", "weapon-ability-grant", ASSAULT],
      ["subtract 1 from Toughness", "characteristic-modifier", { subject: "this-unit", characteristics: ["T"], operation: "subtract", value: 1, weapon_type: "all" }]);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("Conflicting durations.");
  });

  it("sentence fallback: one sentence duration covers both clauses that print none", () => {
    const text = "Until the end of the phase, add 6 to Move and grant ASSAULT.";
    const leaves = placed(text,
      ["Until the end of the phase", "duration", DURATION_PHASE],
      ["add 6 to Move", "characteristic-modifier", MOVE_SIX],
      ["grant ASSAULT", "weapon-ability-grant", ASSAULT]);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(true);
    expect(result.ok ? (result.mechanics as any).scope.duration : null).toBe("phase");
  });

  it("R4: a folded \"instead\" effect with a different duration from its no-roll refuses", () => {
    const text = "Until the end of the phase, do not make an Advance roll. Instead, until the end of the turn, add 6 to Move.";
    const leaves = placed(text,
      ["Until the end of the phase", "duration", DURATION_PHASE],
      ["do not make an Advance roll", "no-advance-roll", { subject: "this-unit" }],
      ["Instead", "instead", {}],
      ["until the end of the turn", "duration", DURATION_TURN],
      ["add 6 to Move", "characteristic-modifier", MOVE_SIX]);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("Conflicting durations.");
  });

  it("R6: a window in one part with a later moment (after an effect) is two parts, each with its own duration", () => {
    const text = "Until the end of the phase, when your unit Advances, add 6 to Move, and when your unit ends an Advance, until the end of the turn, grant ASSAULT.";
    const leaves = placed(text,
      ["Until the end of the phase", "duration", DURATION_PHASE],
      ["when your unit Advances", "event", { kind: "move-started", move_types: ["advance"] }],
      ["add 6 to Move", "characteristic-modifier", MOVE_SIX],
      ["when your unit ends an Advance", "event", { kind: "move-ended", owner: "friendly", move_types: ["advance"] }],
      ["until the end of the turn", "duration", DURATION_TURN],
      ["grant ASSAULT", "weapon-ability-grant", ASSAULT]);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(true);
    const steps = result.ok ? (result.mechanics.effect as unknown as { steps: Array<Record<string, any>> }).steps : [];
    expect(steps[0]).toMatchObject({ type: "ability-part", duration: "phase", trigger: { event: "move-started" } });
    expect(steps[1]).toMatchObject({ type: "ability-part", trigger: { event: "move-ended" }, effect: { type: "ability-part", duration: "turn" } });
  });

  it("R3: a set-up moment beside another moment, scoping a set-up effect, refuses", () => {
    // ", or" keeps two moments; ", when" after a step would make the step the set-up moment's window (compile-step-window.ts).
    const text = "When the step starts, or when your unit is set up, it can be set up anywhere.";
    const leaves = placed(text,
      ["When the step starts", "event", { kind: "step-started", step: "reinforcements", turn: "either" }],
      ["when your unit is set up", "event", { kind: "set-up", owner: "friendly" }],
      ["it can be set up anywhere", "set-up", { subject: "antecedent", to: "battlefield", min_enemy_distance: 6 }]);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("A set-up moment next to another moment has no reading yet.");
  });

  it("a set-up moment that is only a trigger beside another moment still compiles", () => {
    const text = "When the step starts, or when your unit is set up, add 6 to Move.";
    const leaves = placed(text,
      ["When the step starts", "event", { kind: "step-started", step: "reinforcements", turn: "either" }],
      ["when your unit is set up", "event", { kind: "set-up", owner: "friendly" }],
      ["add 6 to Move", "characteristic-modifier", MOVE_SIX]);
    expect(compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME }).ok).toBe(true);
  });

  it("3545, 8334, 8554, 10074: set-up triggers beside another moment keep their canonical baseline mechanics", () => {
    for (const id of [3545, 8334, 8554, 10074]) {
      const { baseline_mechanics } = fixture(id);
      expect(mechanicsOf(id), `av ${id}`).toEqual(baseline_mechanics);
    }
  });
});

describe("a no-roll and its add-6 fold into one move", () => {
  it("in one sentence without an instead, the +6 is the no-roll's fixed 6 (one move), under the sentence's duration", () => {
    const text = "Until the end of the phase, do not make an Advance roll, and add 6 to Move.";
    const leaves = placed(text,
      ["Until the end of the phase", "duration", DURATION_PHASE],
      ["do not make an Advance roll", "no-advance-roll", { subject: "this-unit" }],
      ["add 6 to Move", "characteristic-modifier", MOVE_SIX]);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(true);
    const mechanics = result.ok ? (result.mechanics as any) : null;
    expect(mechanics.effect).toEqual({ type: "move-modifier", target: "this-unit", modifier: { advance: "fixed-6" } });
    expect(mechanics.scope.duration).toBe("phase");
  });
});

type Base = { text: string; items: Array<[string, string, Record<string, unknown>]> };

/**
 * Records of each structure the duration split must keep refusing (fabricated wording). Each
 * compiles alone to the node named in `shape`; `withTail` then appends two durations.
 */
const BASES: Record<string, Base & { shape: Record<string, unknown> }> = {
  rolls: {
    text: "Each time a model in this unit is destroyed by a melee attack, if that model has not fought this phase, roll one D6. On a 2+, it can fight after the attacking unit has finished its attacks.",
    items: [
      ["Each time a model in this unit is destroyed by a melee attack", "event", { kind: "model-destroyed" }],
      ["if that model has not fought this phase", "unit-activity", { activities: ["fought-this-phase"], subject: "event-subject", negated: true }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2 }],
      ["it can fight after the attacking unit has finished its attacks", "fight-on-death", { act: "fight", timing: "after-the-attacking-unit-finishes" }],
    ],
    shape: { type: "act-on-death", modifier: expect.objectContaining({ gate: expect.objectContaining({ dice: "D6", threshold: 2 }) }) },
  },
  aura: {
    text: "While an enemy unit is within 6\" of this model, worsen the Leadership of models in that unit by 1.",
    items: [
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["worsen the Leadership of models in that unit by 1", "characteristic-modifier", { subject: "antecedent", characteristics: ["Ld"], operation: "worsen", value: 1, weapon_type: "all" }],
    ],
    shape: { type: "aura", modifier: expect.objectContaining({ range: { inches: 6 } }) },
  },
  leader: {
    text: "If a FIXTURE PRIEST model with the Leader ability can be attached to a FIXTURE SQUAD unit, it can be attached to this unit instead. If a FIXTURE PRIEST model is attached to this unit when battle formations are declared, that model gains the Scouts 6\" ability.",
    items: [
      ["a FIXTURE PRIEST model", "unit-filter", { side: "friendly", keywords: ["FIXTURE PRIEST"] }],
      ["with the Leader ability", "unit-has-ability", { subject: "antecedent", ability: "leader" }],
      ["can be attached to a", "leading-unit", { subject: "antecedent", attachment: "can-attach", object: "following-filter" }],
      ["FIXTURE SQUAD unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE SQUAD"] }],
      ["it can be attached to this unit", "army-construction", { rule: "attachment", subject: "antecedent", object: "this-unit" }],
      ["instead", "instead", {}],
      ["a FIXTURE PRIEST model is attached to this unit", "leader-target", { leader_keywords: ["FIXTURE PRIEST"] }],
      ["when battle formations are declared", "event", { kind: "battle-formations-declared" }],
      ["that model gains the Scouts 6\" ability", "core-ability-grant", { subject: "this-model", ability: "scouts", value: 6 }],
    ],
    shape: { type: "sequence", steps: [expect.objectContaining({ type: "army-rule", modifier: expect.objectContaining({ rule: "attachment" }) }), expect.objectContaining({ type: "ability-part" })] },
  },
  "for-each": {
    text: "At the start of the Fight phase, each enemy unit engaged with this unit takes a Nerve test, with -1 to that Nerve test.",
    items: [
      ["At the start of the Fight phase", "event", { kind: "phase-start", phase: "fight", turn: "either" }],
      ["each", "for-each-unit-select", {}],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["engaged with this unit", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false, with: "this-unit" }],
      ["takes a Nerve test", "test", { target: "antecedent", test: "battle-shock" }],
      ["with -1 to that Nerve test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }],
    ],
    shape: { type: "for-each-unit", selector: { filter: { owner: "enemy", engaged_with: "this-unit" } }, effect: { type: "test", target: "recipient", modifier: { test: "battle-shock", modifier: -1 } } },
  },
  designation: {
    text: "In your Shooting phase, when this unit is selected to shoot, you can select one visible enemy unit. This unit's ranged attacks that target that unit have [DEVASTATING WOUNDS].",
    items: [
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["when this unit is selected to shoot", "event", { kind: "selected-to-shoot" }],
      ["you can", "optional-use", { who: "you" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["visible enemy unit", "unit-filter", { side: "enemy", visible: true }],
      ["This unit's ranged attacks", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
      ["that target that unit", "target-is-selected", {}],
      ["DEVASTATING WOUNDS", "weapon-ability-keyword", { keyword: "Devastating Wounds" }],
    ],
    shape: { type: "conditional", effect: expect.objectContaining({ type: "designate-target", applies: expect.objectContaining({ to: "attackers-of-target" }) }) },
  },
  "usage-limit": {
    text: "WHEN: The Battle-shock step of your Command phase, just before you take a Nerve test for a friendly unit. TARGET: That unit. EFFECT: That unit passes that Nerve test automatically. RESTRICTIONS: You can use this Stratagem once per battle.",
    items: [
      ["The Battle-shock step of your Command phase", "event", { kind: "step-started", step: "battle-shock", turn: "your" }],
      ["just before you take a Nerve test for a", "event", { kind: "before-roll", roll: "battle-shock" }],
      ["friendly unit", "unit-filter", { side: "friendly" }],
      ["That unit", "triggering-target", { selects: "unit", keywords: [], match: "all" }],
      ["passes that Nerve test automatically", "roll-auto-result", { roll: "battle-shock", outcome: "auto-pass" }],
      ["You can use this Stratagem once per battle", "usage-limit", { frequency: "once-per-battle", per: "army" }],
    ],
    shape: { type: "roll-result", modifier: { roll: "battle-shock", result: "pass" } },
  },
};

/** `base` with `tail` appended to its wording and `items` placed in the tail. */
function withTail(base: Base, tail: string, items: Array<[string, string, Record<string, unknown>]>): { leaves: CompileLeaf[]; text: string } {
  const text = base.text + tail;
  return { leaves: placed(text, ...base.items, ...items), text };
}

const TWO_DURATIONS: Array<[string, string, Record<string, unknown>]> = [
  ["Until the end of the phase", "duration", DURATION_PHASE],
  ["Until the end of the turn", "duration", DURATION_TURN],
];
const TWO_DURATIONS_TAIL = " Until the end of the phase. Until the end of the turn.";

describe("kept refusals when an ability prints two durations", () => {
  // Each base compiles on its own; the appended durations make the split path run, and the refusal must hold.
  it.each(["rolls", "aura", "leader", "for-each", "designation"])("a %s record refuses", (label) => {
    const base = BASES[label]!;
    const alone = compileLeaves(placed(base.text, ...base.items), base.text, { name: FIXTURE_RULE_NAME });
    if (!alone.ok) throw new Error(alone.errors.join("; "));
    expect(alone.mechanics.effect).toMatchObject(base.shape);
    const { leaves, text } = withTail(base, TWO_DURATIONS_TAIL, TWO_DURATIONS);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(CONFLICTING_DURATIONS);
  });

  it("a usage-limited record refuses with the usage message", () => {
    const base = BASES["usage-limit"]!;
    const alone = compileLeaves(placed(base.text, ...base.items), base.text, { name: FIXTURE_RULE_NAME });
    if (!alone.ok) throw new Error(alone.errors.join("; "));
    expect(alone.mechanics.effect).toMatchObject(base.shape);
    expect(alone.mechanics.usage).toMatchObject({ frequency: "n-per-battle", count: 1 });
    const { leaves, text } = withTail(base, TWO_DURATIONS_TAIL, TWO_DURATIONS);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok ? [] : result.errors).toContain("A usage limit in an ability with several durations has no reading yet.");
  });

  it("a rules bundle refuses with two durations, and compiles with none", () => {
    const bundle: Array<[string, string, Record<string, unknown>]> = [["Bundle", "rules-bundle-marker", {}]];
    const alone = withTail(BASES.rolls!, " Bundle.", bundle);
    expect(compileLeaves(alone.leaves, alone.text, { name: FIXTURE_RULE_NAME }).ok).toBe(true);
    const { leaves, text } = withTail(BASES.rolls!, " Bundle. Until the end of the phase. Until the end of the turn.", [...bundle, ...TWO_DURATIONS]);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok ? [] : result.errors).toContain(CONFLICTING_DURATIONS);
  });

  it("an optional spend read as this use refuses with two durations", () => {
    const spend: Array<[string, string, Record<string, unknown>]> = [
      ["Used", "event", { kind: "used" }],
      ["Spend it", "resource-spend", { pool: "yp-pool", amount: 1 }],
      ["Optional read", "optional-cost-paid", { window: "use", pool: "yp-pool" }],
      ["You can use this", "optional-use", { who: "this-unit" }],
    ];
    const { leaves, text } = withTail(BASES.rolls!, " Used. Spend it. Optional read. You can use this." + TWO_DURATIONS_TAIL, [...spend, ...TWO_DURATIONS]);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok ? [] : result.errors).toContain(CONFLICTING_DURATIONS);
  });
});

describe("a bound duration renders as its own clause", () => {
  it("3746: the folded phase part and the turn part each name their lifetime in the describer", () => {
    const mechanics = mechanicsOf(3746);
    const text = describeAbility({ effect: mechanics.effect, scope: mechanics.scope, trigger: mechanics.trigger } as never);
    expect(text).toContain("-> Until the end of the phase: the triggering unit does not make an Advance roll; add 6\" to its Move characteristic instead.");
    expect(text).not.toContain("Move characteristic.");
    expect(text).toContain("Until the end of the turn: ranged weapons equipped by the triggering unit gain [ASSAULT].");
  });
});

describe("a duration printed in a later part with a moment of its own", () => {
  // Fabricated wording with the shape of an enhancement that buffs a chosen weapon before the battle and again when fighting.
  const text = "Before the battle, pick one melee weapon of the bearer; add 1 to the Attacks characteristic of that weapon. Also, each time the bearer is chosen to fight, it can use this Enhancement. If it does, while resolving those attacks, add 1 to the Damage characteristic of that weapon.";
  const leaves = () => placed(text,
    ["Before the battle", "event", { kind: "battle-started" }],
    ["pick one melee weapon of the bearer", "select-weapon", { target: "this-model", bind_as: "selected-weapon", count: 1, weapon_type: "melee" }],
    ["add 1 to the Attacks characteristic of that weapon", "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "add", value: 1, weapon: "antecedent" }],
    ["each time the bearer is chosen to fight", "event", { kind: "selected", to: "fight", subject: "this-model" }],
    ["it can use this Enhancement", "optional-use", { who: "this-model" }],
    ["while resolving those attacks", "duration", { endpoint: "end-of-attack-sequence" }],
    ["add 1 to the Damage characteristic of that weapon", "characteristic-modifier", { subject: "this-model", characteristics: ["D"], operation: "add", value: 1, weapon: "antecedent" }]);

  it("bounds only that part, not the earlier part's lasting effect", () => {
    const result = compileLeaves(leaves(), text, { name: FIXTURE_RULE_NAME });
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.scope?.duration).toBe("permanent");
    const parts = (result.mechanics.effect as { steps: Array<Record<string, unknown>> }).steps;
    expect(parts.map((part) => part.duration)).toEqual([undefined, "attack-sequence"]);
  });
});
