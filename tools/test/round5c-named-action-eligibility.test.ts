import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";

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
          selector_count: 1,
          excludes_keyword: ["TITANIC"],
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
          selector_count: 1,
          requires: [{ type: "happened", parameters: { event: "after-roll", object: "selected-unit", filter: { roll: "hit", result: "success", by: { event_var: "triggering-shooter" } }, window: "event" } }],
        },
      }],
    });
  });

  it("refuses an enemy select-unit, two select-units, and a leaf that repeats a flag", () => {
    const menu = () => leaf("EVENT", "menu-action", { action_id: "a", label: "A", cost_amount: 1, binds_event_variable: "triggering-enemy", eligibility_engaged_with_bound_at_phase_start: true, duration: "immediate" }, "D", 2);
    const trigger = () => leaf("EVENT", "event", { kind: "move-ended", owner: "enemy", move_types: ["fall-back"] }, "D", 9);
    const effect = () => leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6+1" }, "D");
    expect(compileLeaves([opener(), menu(), trigger(), leaf("EVENT", "select-unit", { scope: "enemy", distance: "any", visible: false }, "D"), effect()]).ok).toBe(false);
    expect(compileLeaves([opener(), menu(), trigger(), leaf("EVENT", "select-unit", { distance: "any", visible: false }, "D"), leaf("EVENT", "select-unit", { distance: "any", visible: false }, "D"), effect()]).ok).toBe(false);
    expect(compileLeaves([opener(), menu(), trigger(), leaf("EVENT", "select-unit", { distance: "any", visible: false }, "D"), leaf("CONDITION", "unit-state", bound, "D", 14), effect()]).ok).toBe(false);
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
});
