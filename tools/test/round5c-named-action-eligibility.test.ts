import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

/**
 * Menu-action eligibility from ordinary leaves in source order (compile-containers.ts,
 * menuActionHead). Wording is fabricated: "Tactical Dash", "Sharp Shot" and their units.
 */

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>, fragment: string, version = 1): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: version, parameters, start_byte: offset, end_byte: offset + 5, fragment };
}

const opener = () => leaf("EFFECT", "resource-action-menu-open", { menu_id: "m", pool_id: "p" }, "A");
const bound = { states: ["engaged"], subject: "selected-unit", with: "event-subject", at: "phase-start", negated: false };

describe("menu-action eligibility in source order", () => {
  it("reads a trigger, then a select-unit, its unit-filter, and a bound engagement", () => {
    const result = compileLeaves([
      opener(),
      leaf("EVENT", "menu-action", { action_id: "tactical-dash", label: "Tactical Dash", cost_amount: 1, binds_event_variable: "triggering-enemy", duration: "immediate" }, "B", 2),
      leaf("EVENT", "event", { kind: "move-ended", owner: "enemy", move_types: ["fall-back"] }, "B", 9),
      leaf("EVENT", "select-unit", { distance: "any", visible: true }, "B"),
      leaf("CONDITION", "unit-filter", { side: "friendly", excluded_keywords: ["TITANIC"] }, "B"),
      leaf("CONDITION", "unit-state", bound, "B", 14),
      leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6+1" }, "B"),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mechanics.effect).toMatchObject({
      actions: [{
        id: "tactical-dash",
        when: { event: "move-ended", subject: { owner: "enemy" }, binds_event_variable: "triggering-enemy" },
        eligibility: {
          filter: { none_of: ["TITANIC"] },
          count: { min: 1, max: 1 },
          requires: [{ type: "unit-state", parameters: { subject: "selected-unit", state: "engaged", with: { event_var: "triggering-enemy" }, at: "phase-start" } }],
        },
      }],
    });
  });

  it("reads a bound hit from the moment's attacks as a happened after-roll requirement", () => {
    const result = compileLeaves([
      opener(),
      leaf("EVENT", "menu-action", { action_id: "sharp-shot", label: "Sharp Shot", cost_amount: 1, binds_event_variable: "triggering-shooter", duration: "immediate" }, "C", 2),
      leaf("EVENT", "event", { kind: "attacks-resolved", owner: "enemy", action_kind: "shoot" }, "C", 9),
      leaf("EVENT", "select-unit", { distance: "any", visible: true }, "C"),
      leaf("CONDITION", "unit-filter", { side: "friendly" }, "C"),
      leaf("CONDITION", "hit-by-attacks", { subject: "selected-unit" }, "C"),
      leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6+1" }, "C"),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mechanics.effect).toMatchObject({
      actions: [{
        id: "sharp-shot",
        eligibility: {
          count: { min: 1, max: 1 },
          requires: [{ type: "happened", parameters: { event: "after-roll", object: "selected-unit", filter: { roll: "hit", result: "success", by: { event_var: "triggering-shooter" } }, window: "event" } }],
        },
      }],
    });
  });

  it("refuses an enemy select-unit, two select-units, a count other than one, an extra filter key, and a leaf that repeats a flag", () => {
    const menu = (extra: Record<string, unknown> = {}) => leaf("EVENT", "menu-action", { action_id: "a", label: "A", cost_amount: 1, binds_event_variable: "triggering-enemy", duration: "immediate", ...extra }, "D", 2);
    const trigger = () => leaf("EVENT", "event", { kind: "move-ended", owner: "enemy", move_types: ["fall-back"] }, "D", 9);
    const effect = () => leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6+1" }, "D");
    const select = (parameters: Record<string, unknown> = {}) => leaf("EVENT", "select-unit", { scope: "friendly", distance: "any", visible: false, ...parameters }, "D");
    const errorsOf = (leaves: CompileLeaf[]) => {
      const result = compileLeaves(leaves);
      return result.ok ? [] : result.errors;
    };
    expect(errorsOf([opener(), menu(), trigger(), select({ scope: "enemy" }), effect()])).toEqual([expect.stringContaining("selects a friendly unit")]);
    expect(errorsOf([opener(), menu(), trigger(), select(), select(), effect()])).toEqual([expect.stringContaining("selects one unit: give it one select-unit.")]);
    expect(errorsOf([opener(), menu(), trigger(), select({ count: 2 }), effect()])).toEqual([expect.stringContaining("selects one unit.")]);
    expect(errorsOf([opener(), menu(), trigger(), select({ filter: { battle_shocked: true } }), effect()])).toEqual([expect.stringContaining("the DSL holds no battle_shocked for it")]);
    expect(errorsOf([opener(), menu({ eligibility_engaged_with_bound_at_phase_start: true }), trigger(), select(), leaf("CONDITION", "unit-state", bound, "D", 14), effect()]))
      .toEqual([expect.stringContaining("states a bound requirement both as a leaf and as a flag")]);
  });

  it("reads the attacks-resolved phase and turn of Fade Back into the trigger's condition, never into eligibility", () => {
    const result = compileLeaves([
      opener(),
      leaf("EVENT", "menu-action", { action_id: "fade-back", label: "Fade Back", cost_amount: 1, binds_event_variable: "triggering-shooter", duration: "immediate" }, "C", 2),
      leaf("EVENT", "event", { kind: "attacks-resolved", owner: "enemy", action_kind: "shoot", phase: "shooting", turn: "opponent" }, "C", currentFamilyVersion("event")),
      leaf("EVENT", "select-unit", { distance: "any", visible: true }, "C"),
      leaf("CONDITION", "unit-filter", { side: "friendly", excluded_keywords: ["TITANIC"] }, "C"),
      leaf("CONDITION", "hit-by-attacks", { subject: "selected-unit" }, "C"),
      leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6+1" }, "C"),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [action] = (result.mechanics.effect as { actions: Array<Record<string, unknown>> }).actions;
    expect(action!.when).toEqual({
      event: "attacks-resolved",
      filter: { kind: "shoot" },
      subject: { owner: "enemy" },
      binds_event_variable: "triggering-shooter",
      condition: {
        operator: "and",
        operands: [{ type: "phase-is", parameters: { phase: "shooting" } }, { type: "player-turn-is", parameters: { turn: "opponent-turn" } }],
      },
    });
    expect(action!.eligibility).toEqual({
      filter: { none_of: ["TITANIC"] },
      count: { min: 1, max: 1 },
      requires: [{ type: "happened", parameters: { event: "after-roll", object: "selected-unit", filter: { roll: "hit", result: "success", by: { event_var: "triggering-shooter" } }, window: "event" } }],
    });
  });

  it("refuses a phase or turn on an owned moment other than attacks-resolved", () => {
    const result = compileLeaves([
      opener(),
      leaf("EVENT", "menu-action", { action_id: "c", label: "C", cost_amount: 1, binds_event_variable: "triggering-enemy", duration: "immediate" }, "C", 2),
      leaf("EVENT", "event", { kind: "move-ended", owner: "enemy", move_types: ["fall-back"], phase: "movement" }, "C", currentFamilyVersion("event")),
      leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6+1" }, "C"),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([expect.stringContaining("Only an attacks-resolved moment names its phase and turn")]);
  });

  it("does not read a unit-state that is not the bound engagement as eligibility", () => {
    const result = compileLeaves([
      opener(),
      leaf("EVENT", "menu-action", { action_id: "b", label: "B", cost_amount: 1, binds_event_variable: "triggering-enemy", duration: "immediate" }, "E", 2),
      leaf("EVENT", "event", { kind: "move-ended", owner: "enemy", move_types: ["fall-back"] }, "E", 9),
      leaf("CONDITION", "unit-state", { ...bound, states: ["battle-shocked"] }, "E", 14),
      leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6+1" }, "E"),
    ]);
    expect(result.ok).toBe(false);
  });
  it("accepts phase and turn on attacks-resolved only, at the current event version and not at 18", () => {
    const current = currentFamilyVersion("event");
    const moment = { kind: "attacks-resolved", owner: "enemy", action_kind: "shoot", phase: "shooting", turn: "opponent" };
    expect(normalizeFingerprintParameters("event", moment, current)).toMatchObject({ kind: "attacks-resolved", phase: "shooting", turn: "opponent" });
    expect(() => normalizeFingerprintParameters("event", { kind: "move-ended", owner: "enemy", phase: "movement" }, current)).toThrow();
    expect(() => normalizeFingerprintParameters("event", { ...moment, phase: "any-phase" }, current)).toThrow();
    expect(() => normalizeFingerprintParameters("event", moment, 18)).toThrow();
  });
});
