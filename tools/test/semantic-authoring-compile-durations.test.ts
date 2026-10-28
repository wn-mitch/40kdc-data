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
 * test/fixtures/semantic-authoring-durations are the stored leaves of eleven ability versions, with fabricated
 * wording that keeps the gaps' punctuation and connectives, and with the Wave 10 leaf re-authorings
 * applied. The synthetic cases below are fabricated wording written for this file.
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
    const text = "When the step starts, when your unit is set up, it can be set up anywhere.";
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

/** The fixture's leaves, then `tail` appended to its wording with `items` placed in it: two durations in an effectless sentence. */
function withTail(id: number, tail: string, items: Array<[string, string, Record<string, unknown>]>): { leaves: CompileLeaf[]; text: string } {
  const { leaves, source_text } = fixture(id);
  const offset = Buffer.byteLength(source_text, "utf8");
  const extra = placed(tail, ...items).map((leaf) => ({ ...leaf, start_byte: leaf.start_byte + offset, end_byte: leaf.end_byte === undefined ? undefined : leaf.end_byte + offset }));
  return { leaves: [...leaves, ...extra], text: source_text + tail };
}

const TWO_DURATIONS: Array<[string, string, Record<string, unknown>]> = [
  ["Until the end of the phase", "duration", DURATION_PHASE],
  ["Until the end of the turn", "duration", DURATION_TURN],
];
const TWO_DURATIONS_TAIL = " Until the end of the phase. Until the end of the turn.";

describe("kept refusals when an ability prints two durations", () => {
  // Each base record compiles on its own; the appended durations make the split path run, and the refusal must hold.
  it.each([
    [7, "rolls"],
    [41, "aura"],
    [6239, "leader"],
    [10099, "for-each"],
    [10118, "designation (selected attacks)"],
  ])("av %i (%s) refuses", (id) => {
    const base = compileFixture(id);
    expect(base.ok, `av ${id} alone`).toBe(true);
    const { leaves, text } = withTail(id, TWO_DURATIONS_TAIL, TWO_DURATIONS);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(CONFLICTING_DURATIONS);
  });

  it("av 6228 (usage limit) refuses with the usage message", () => {
    const { leaves, text } = withTail(6228, TWO_DURATIONS_TAIL, TWO_DURATIONS);
    const result = compileLeaves(leaves, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok ? [] : result.errors).toContain("A usage limit in an ability with several durations has no reading yet.");
  });

  it("a rules bundle refuses with two durations, and compiles with none", () => {
    const bundle: Array<[string, string, Record<string, unknown>]> = [["Bundle", "rules-bundle-marker", {}]];
    const alone = withTail(7, " Bundle.", bundle);
    expect(compileLeaves(alone.leaves, alone.text, { name: FIXTURE_RULE_NAME }).ok).toBe(true);
    const { leaves, text } = withTail(7, " Bundle. Until the end of the phase. Until the end of the turn.", [...bundle, ...TWO_DURATIONS]);
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
    const { leaves, text } = withTail(7, " Used. Spend it. Optional read. You can use this." + TWO_DURATIONS_TAIL, [...spend, ...TWO_DURATIONS]);
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
