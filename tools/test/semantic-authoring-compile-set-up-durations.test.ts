import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { placed, type Item } from "./semantic-authoring-connective-fixture.js";

/**
 * One printed duration in an ability with a set-up (compile-durations.ts): the set-up is the effect's own, the
 * moment's window, or one alternative moment, never a second moment the duration has to choose between. All wording
 * is fabricated for this file.
 */

const FIXTURE_RULE_NAME = "A Trap Well Laid";
const DURATION_PHASE = { endpoint: "end-of-phase" };
const DURATION_TURN = { endpoint: "end-of-turn" };
const STRATAGEM_TARGET = (keywords: string[]) => ({ count: "one", side: "your-army", selects: "unit", keywords, match: "all", excluded_keywords: [] });

/** Fabricated records with one printed duration and a set-up, by the reading each pins. */
const SET_UP_RECORDS: Record<string, { text: string; items: Item[] }> = {
  "reserves denial": {
    text: "WHEN: Start of your opponent's Reinforcements step.\nTARGET: One FIXTURE INFANTRY unit from your army.\nEFFECT: Until the end of the phase, enemy units that are set up on the battlefield from Strategic Reserves cannot be set up within 12\" of your unit.",
    items: [
      ["Start of your opponent's Reinforcements step", "event", { kind: "step-started", step: "reinforcements", turn: "opponent" }],
      ["One FIXTURE INFANTRY unit from your army", "stratagem-target", STRATAGEM_TARGET(["FIXTURE INFANTRY"])],
      ["Until the end of the phase", "duration", DURATION_PHASE],
      ["enemy units that are set up on the battlefield from Strategic Reserves", "event", { kind: "set-up", owner: "enemy", from: "strategic-reserves" }],
      ["cannot be set up", "set-up", { subject: "antecedent", to: "battlefield", allow: false }],
      ["within 12\" of your unit", "unit-position", { kind: "within", inches: 12, of: "this-unit", subject: "antecedent", negated: false }],
    ],
  },
  "ambush marker": {
    text: "WHEN: Your opponent's Movement phase.\nTARGET: One FIXTURE BATTLELINE unit from your army in Cult Ambush.\nEFFECT: Until the end of the phase, when setting your unit up using a Cult Ambush marker, set your unit up anywhere on the battlefield wholly within 6\" of that marker.",
    items: [
      ["Your opponent's Movement phase", "use-window", { your_phases: [], opponent_phases: ["movement"], either_phases: [] }],
      ["One", "stratagem-target", { count: "one" }],
      ["FIXTURE BATTLELINE unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE BATTLELINE"] }],
      ["in Cult Ambush", "unit-filter", { side: "friendly", held_in: "cult-ambush" }],
      ["Until the end of the phase", "duration", DURATION_PHASE],
      ["when setting your unit up using a Cult Ambush marker", "event", { kind: "set-up" }],
      ["set your unit up anywhere on the battlefield wholly within 6\" of that marker", "set-up", { subject: "this-unit", to: "battlefield", via: "cult-ambush-marker", marker_inches: 6, marker_wholly: true }],
    ],
  },
  "set up in a step": {
    text: "WHEN: Reinforcements step of your opponent's Movement phase, just after an enemy unit is set up on the battlefield from Reserves.\nTARGET: One FIXTURE unit from your army within 12\" of that enemy unit.\nEFFECT: Your unit can make a Normal move of up to 6\".",
    items: [
      ["Reinforcements step of your opponent's Movement phase", "event", { kind: "step-started", step: "reinforcements", turn: "opponent" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["is set up on the battlefield from Reserves", "event", { kind: "set-up" }],
      ["One FIXTURE unit from your army", "stratagem-target", STRATAGEM_TARGET(["FIXTURE"])],
      ["within 12\" of that enemy unit", "unit-position", { kind: "within", inches: 12, of: "event-subject", subject: "this-unit", negated: false }],
      ["Your unit can make a Normal move of up to 6\"", "make-move", { subject: "this-unit", move_type: "normal", distance: 6 }],
    ],
  },
  "set-up among alternatives": {
    text: "WHEN: Your Movement phase or your Charge phase, just after a FIXTURE unit from your army is selected to make a Normal, Advance or Fall Back move, is set up on the battlefield, or declares a charge.\nTARGET: That unit.\nEFFECT: Until the end of the turn, enemy units cannot use the Fire Overwatch Stratagem to shoot at your unit.",
    items: [
      ["Your Movement phase or your Charge phase", "use-window", { your_phases: ["movement", "charge"], opponent_phases: [], either_phases: [] }],
      ["FIXTURE unit from your army", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }],
      ["is selected to make a Normal, Advance or Fall Back move", "event", { kind: "selected", owner: "friendly", move_types: ["normal", "advance", "fall-back"], to: "move" }],
      ["is set up on the battlefield", "event", { kind: "set-up", owner: "friendly" }],
      ["declares a charge", "event", { kind: "targets-selected", owner: "friendly", action_kind: "charge" }],
      ["That unit", "triggering-target", { selects: "unit", keywords: [], match: "all" }],
      ["Until the end of the turn", "duration", DURATION_TURN],
      ["enemy units cannot use the Fire Overwatch Stratagem to shoot at your unit", "targeting-restriction", { may: "cannot-target", kind: "stratagem", weapon_type: "all", target: "this-unit", by: "enemy-units", stratagem: "fire-overwatch" }],
    ],
  },
  "set-up or move in a phase": {
    text: "In your opponent's Movement phase, each time an enemy unit is set up or ends a Normal, Advance or Fall Back move within 8\" of this model, any units embarked within it can disembark.",
    items: [
      ["In your opponent's Movement phase", "phase-window", { phase: "movement", turn: "opponent" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["is set up", "event", { kind: "set-up" }],
      ["ends a Normal, Advance or Fall Back move", "event", { kind: "move-ended", move_types: ["normal", "advance", "fall-back"] }],
      ["within 8\" of this model", "unit-position", { kind: "within", inches: 8, of: "this-model", subject: "event-subject", negated: false }],
      ["any units embarked within it can disembark", "eligibility-permission", { subject: "this-unit", activity: "disembark", allow: true }],
    ],
  },
};

function setUpMechanics(name: string): Record<string, any> {
  const { text, items } = SET_UP_RECORDS[name]!;
  const result = compileLeaves(placed(text, ...items), text, { name: FIXTURE_RULE_NAME });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

describe("one printed duration beside a set-up", () => {
  it("reserves denial: the Strategic Reserves set-up is the effect's own, not a second moment, so the phase bounds it", () => {
    const mechanics = setUpMechanics("reserves denial");
    expect(mechanics.trigger).toMatchObject({ event: "step-started", filter: { step: "reinforcements" }, condition: { parameters: { turn: "opponent-turn" } } });
    expect(mechanics.effect).toEqual({ type: "set-up", target: { owner: "enemy" }, modifier: { to: "battlefield", from: "strategic-reserves", allow: false, near: [{ of: "this-unit", range: { inches: 12 } }] } });
    expect(mechanics.scope.duration).toBe("phase");
  });

  it("ambush marker: a use window, then one set-up moment, is one moment with the phase as its lifetime", () => {
    const mechanics = setUpMechanics("ambush marker");
    expect(mechanics.trigger).toEqual({ event: "set-up" });
    expect(mechanics.effect).toMatchObject({ type: "set-up", target: "this-unit", modifier: { via: "cult-ambush", marker_range: { range: { inches: 6 }, wholly: true } } });
    expect(mechanics.scope.duration).toBe("phase");
  });

  it("set up in a step: the step is the set-up's window, not a moment beside it", () => {
    const { trigger, effect } = setUpMechanics("set up in a step");
    expect(Array.isArray(trigger)).toBe(false);
    expect(trigger).toMatchObject({ event: "set-up", subject: { owner: "enemy" } });
    expect(JSON.stringify(trigger.condition)).toContain('"step":"reinforcements"');
    expect(effect).toMatchObject({ type: "conditional", condition: { parameters: { filter: { within: { of: "event-subject", range: { inches: 12 } } } } }, effect: { type: "move" } });
  });

  it("set-up among alternatives: each moment stays an alternative trigger, and the effect lasts the turn", () => {
    const { trigger, scope, effect } = setUpMechanics("set-up among alternatives");
    expect(trigger.map((moment: Record<string, unknown>) => moment.event)).toEqual(["selected", "set-up", "targets-selected"]);
    expect(trigger[0].subject).toEqual({ owner: "friendly", all_of: ["FIXTURE"] });
    expect(scope.duration).toBe("turn");
    expect(effect).toMatchObject({ type: "targeting", modifier: { may: "cannot-target", stratagem: "fire-overwatch", target: "this-unit" } });
  });

  it("set-up or move in a phase: both moments are the enemy unit's, within range, in the opponent's Movement phase", () => {
    const { trigger, effect } = setUpMechanics("set-up or move in a phase");
    expect(trigger).toEqual([
      { event: "set-up", subject: { owner: "enemy" } },
      { event: "move-ended", filter: { move_types: ["normal", "advance", "fall-back"] }, subject: { owner: "enemy" } },
    ]);
    const gate = JSON.stringify(effect.condition);
    expect(gate).toContain('"phase":"movement"');
    expect(gate).toContain('"turn":"opponent-turn"');
    expect(gate).toContain('"subject":"event-subject","filter":{"within":{"of":"this-model","range":{"inches":8}}}');
    expect(effect.effect).toMatchObject({ type: "permission", modifier: { activity: "disembark", allow: true } });
  });
});
