import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/index.js";

/**
 * Several printed durations in one ability (compile-durations.ts). The fixtures under
 * test/fixtures/round5c-durations are the stored leaves of eleven ability versions, with fabricated
 * wording that keeps the gaps' punctuation and connectives, and with the Wave 10 leaf re-authorings
 * applied. The synthetic cases below are fabricated wording written for this file.
 */

const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/round5c-durations/", import.meta.url));

type Fixture = { id: number; source_text: string; leaves: CompileLeaf[]; edits: string | null; baseline_mechanics?: unknown };

function fixture(id: number): Fixture {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}${id}.json`, "utf8")) as Fixture;
}

function compileFixture(id: number) {
  const { leaves, source_text } = fixture(id);
  return compileLeaves(leaves, source_text);
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

describe("bound durations on the stored records", () => {
  it("3746: the no-roll is bare, the modifier lasts the phase, the grant lasts the turn", () => {
    const mechanics = mechanicsOf(3746);
    const [noRoll, modifier, grant] = mechanics.effect.steps;
    expect(noRoll.type).toBe("move-modifier");
    expect(noRoll.duration).toBeUndefined();
    expect(modifier).toMatchObject({ type: "ability-part", duration: "phase", effect: { type: "stat-modifier" } });
    expect(grant).toMatchObject({ type: "ability-part", duration: "turn", effect: { type: "weapon-ability-grant" } });
    expect(mechanics.trigger.event).toBe("move-started");
    expect(mechanics.scope.duration).toBe("permanent");
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

  it("4194: refused, because the pinned test follows the assailed mark in the same part", () => {
    const result = compileFixture(4194);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("A tag tested after it is applied in the same part; the compiler does not order them.");
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

  it("a single-duration record compiles to exactly its pre-change output", () => {
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
    const result = compileLeaves(leaves, text);
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
    const result = compileLeaves(leaves, text);
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
    const result = compileLeaves(leaves, text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("Conflicting durations.");
  });

  it("sentence fallback: one sentence duration covers both clauses that print none", () => {
    const text = "Until the end of the phase, add 6 to Move and grant ASSAULT.";
    const leaves = placed(text,
      ["Until the end of the phase", "duration", DURATION_PHASE],
      ["add 6 to Move", "characteristic-modifier", MOVE_SIX],
      ["grant ASSAULT", "weapon-ability-grant", ASSAULT]);
    const result = compileLeaves(leaves, text);
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
    const result = compileLeaves(leaves, text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("Conflicting durations.");
  });

  it("R6: a window in one part with a later moment (after an effect) refuses", () => {
    const text = "Until the end of the phase, when your unit Advances, add 6 to Move, and when your unit ends an Advance, until the end of the turn, grant ASSAULT.";
    const leaves = placed(text,
      ["Until the end of the phase", "duration", DURATION_PHASE],
      ["when your unit Advances", "event", { kind: "move-started", move_types: ["advance"] }],
      ["add 6 to Move", "characteristic-modifier", MOVE_SIX],
      ["when your unit ends an Advance", "event", { kind: "move-ended", owner: "friendly", move_types: ["advance"] }],
      ["until the end of the turn", "duration", DURATION_TURN],
      ["grant ASSAULT", "weapon-ability-grant", ASSAULT]);
    const result = compileLeaves(leaves, text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("A moment with a window in a compound ability has no reading yet.");
  });

  it("R3: a set-up moment beside another moment, scoping a set-up effect, refuses", () => {
    const text = "When the step starts, when your unit is set up, it can be set up anywhere.";
    const leaves = placed(text,
      ["When the step starts", "event", { kind: "step-started", step: "reinforcements", turn: "either" }],
      ["when your unit is set up", "event", { kind: "set-up", owner: "friendly" }],
      ["it can be set up anywhere", "set-up", { subject: "antecedent", to: "battlefield", min_enemy_distance: 6 }]);
    const result = compileLeaves(leaves, text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("A set-up moment next to another moment has no reading yet.");
  });

  it("a set-up moment that is only a trigger beside another moment still compiles", () => {
    const text = "When the step starts, or when your unit is set up, add 6 to Move.";
    const leaves = placed(text,
      ["When the step starts", "event", { kind: "step-started", step: "reinforcements", turn: "either" }],
      ["when your unit is set up", "event", { kind: "set-up", owner: "friendly" }],
      ["add 6 to Move", "characteristic-modifier", MOVE_SIX]);
    expect(compileLeaves(leaves, text).ok).toBe(true);
  });

  it("3545, 8334, 8554, 10074: set-up triggers beside another moment keep their pre-change output", () => {
    for (const id of [3545, 8334, 8554, 10074]) {
      const { baseline_mechanics } = fixture(id);
      expect(mechanicsOf(id), `av ${id}`).toEqual(baseline_mechanics);
    }
  });
});

describe("a bound duration renders as its own clause", () => {
  it("3746: the phase and turn parts each name their lifetime in the describer", () => {
    const mechanics = mechanicsOf(3746);
    const text = describeAbility({ effect: mechanics.effect, scope: mechanics.scope, trigger: mechanics.trigger } as never);
    expect(text).toContain("Until the end of the phase: add 6 to the unit's Move characteristic.");
    expect(text).toContain("Until the end of the turn: ranged weapons equipped by models in this unit gain [ASSAULT].");
  });
});
