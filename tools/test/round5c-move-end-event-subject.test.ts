import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { untiledRuns } from "../src/round5c/leaves.js";
import type { AbilityCoverage } from "../src/round5c/coverage.js";
import { describeAbility, type Effect } from "../src/translate/index.js";

/**
 * The move-end follow-up: a move-end nearest the enemy unit the trigger names (move-end-nearest
 * version 3, to: event-subject), an engaged condition on a this-model subject (unit-state version
 * 15), and the glue word "but". Every leaf is fabricated wording; each case pins one binding, one
 * version boundary, or one refusal.
 */

/** A leaf of the family at the given version; its bytes are set by inSentences. */
function leaf(familyId: string, parameters: Record<string, unknown>, familyVersion = currentFamilyVersion(familyId)): CompileLeaf {
  return { role: familyRole(familyId, familyVersion), family_id: familyId, family_version: familyVersion, parameters, start_byte: 0 };
}

/**
 * Leaves placed in sentences of fabricated wording. Each leaf's bytes are its own phrase, so the
 * compiler reads the sentence stops (. ; :) between sentences as the source does.
 */
function inSentences(sentences: Array<Array<[CompileLeaf, string]>>): { leaves: CompileLeaf[]; sourceText: string } {
  const leaves: CompileLeaf[] = [];
  let source = "";
  for (const sentence of sentences) {
    sentence.forEach(([item, phrase], index) => {
      if (index > 0) source += " ";
      const start = Buffer.byteLength(source);
      source += phrase;
      leaves.push({ ...item, start_byte: start, end_byte: start + Buffer.byteLength(phrase) });
    });
    source += ". ";
  }
  return { leaves, sourceText: source };
}

function run(sentences: Array<Array<[CompileLeaf, string]>>) {
  const { leaves, sourceText } = inSentences(sentences);
  return compileLeaves(leaves, sourceText);
}
function compiled(sentences: Array<Array<[CompileLeaf, string]>>): string {
  const result = run(sentences);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return JSON.stringify({ mechanics: result.mechanics, core: result.core });
}
function refused(sentences: Array<Array<[CompileLeaf, string]>>): string {
  const result = run(sentences);
  if (result.ok) throw new Error("expected a refusal");
  return result.errors.join("; ");
}

describe("move-end-nearest version 3: the enemy unit the trigger names", () => {
  const current = () => currentFamilyVersion("move-end-nearest");
  const mustEndAtEnemy = () => leaf("move-end-nearest", { to: "event-subject" }, 3);
  const move = () => leaf("make-move", { subject: "this-unit", move_type: "normal", distance: 6 });

  it("is version 3 and widens version 2 without changing what version 2 accepted", () => {
    expect(current()).toBe(3);
    const accepted: Array<Record<string, unknown>> = [
      { to: "following-filter" },
      { to: "following-filter", instead_of: "closest-enemy-unit" },
      { to: "closest-objective-marker" },
      { to: "closest-objective-marker", per: "unit" },
      { to: "selected-objective", per: "model", instead_of: "closest-enemy-unit" },
    ];
    for (const parameters of accepted) {
      expect(normalizeFingerprintParameters("move-end-nearest", parameters, current())).toEqual(normalizeFingerprintParameters("move-end-nearest", parameters, 2));
    }
  });

  it("accepts to: event-subject alone, and version 2 still refuses it", () => {
    expect(normalizeFingerprintParameters("move-end-nearest", { to: "event-subject" }, current())).toEqual({ to: "event-subject" });
    expect(() => normalizeFingerprintParameters("move-end-nearest", { to: "event-subject" }, 2)).toThrow();
  });

  it("refuses a per-model form and an instead_of with the enemy unit the trigger names", () => {
    expect(() => normalizeFingerprintParameters("move-end-nearest", { to: "event-subject", per: "model" }, current())).toThrow(/no per-model form/u);
    expect(() => normalizeFingerprintParameters("move-end-nearest", { to: "event-subject", per: "unit" }, current())).toThrow(/no per-model form/u);
    expect(() => normalizeFingerprintParameters("move-end-nearest", { to: "event-subject", instead_of: "closest-enemy-unit" }, current())).toThrow(/instead_of/u);
  });

  it("ends a make-move as ends_nearest of the event subject, with no unit-filter", () => {
    const text = compiled([[[move(), "this unit can make a Normal move of up to 6 inches"], [mustEndAtEnemy(), "it must end that move as close as possible to that enemy unit"]]]);
    expect(text).toContain('"ends_nearest":{"of":"event-subject"}');
    expect(text).not.toContain("waives");
    expect(text).not.toContain('"per"');
  });

  it("refuses a second move-end on the same make-move", () => {
    expect(refused([[[move(), "this unit can make a Normal move"], [mustEndAtEnemy(), "it must end that move as close as possible to that enemy unit"], [mustEndAtEnemy(), "it must end that move as close as possible to that enemy unit"]]])).toMatch(/second one has no DSL form/u);
  });

  it("keeps the version 2 following-filter binding: the filter after the leaf names the unit", () => {
    const text = compiled([[
      [move(), "this unit can make a Normal move"],
      [leaf("move-end-nearest", { to: "following-filter" }, 2), "it must end that move as close as possible to the closest enemy unit"],
      [leaf("unit-filter", { side: "enemy", excluded_keywords: ["AIRCRAFT"] }), "enemy unit that is not an AIRCRAFT"],
      [leaf("eligibility-permission", { subject: "this-unit", activity: "move", allow: true, despite: ["engaged"], engaged_with_move_end: true }, 4), "and can move while engaged"],
    ]]);
    expect(text).toContain('"ends_nearest":{"of":{"owner":"enemy","none_of":["AIRCRAFT"]}}');
    expect(text).toContain('"engaged_with":"nearest-move-end"');
  });

  it("keeps the version 2 refusal of a following-filter nearest with no unit-filter after it", () => {
    expect(refused([[[move(), "this unit can make a Normal move"], [leaf("move-end-nearest", { to: "following-filter" }, 2), "it must end that move as close as possible to the closest enemy unit"]]])).toMatch(/needs a unit-filter right after it/u);
  });
});

describe("unit-state version 15: a this-model subject can be engaged", () => {
  const current = () => currentFamilyVersion("unit-state");
  const engagedThisModel = { states: ["engaged"], subject: "this-model", negated: false };

  it("accepts an engaged this-model condition only from version 15", () => {
    expect(current()).toBeGreaterThanOrEqual(15);
    expect(normalizeFingerprintParameters("unit-state", engagedThisModel, 15)).toEqual(engagedThisModel);
    expect(normalizeFingerprintParameters("unit-state", engagedThisModel, current())).toEqual(engagedThisModel);
    expect(() => normalizeFingerprintParameters("unit-state", engagedThisModel, 14)).toThrow(/only being on the battlefield/u);
  });

  it("returns the version 14 result for every input that version 15 does not change", () => {
    const accepted: Array<Record<string, unknown>> = [
      { states: ["engaged"], subject: "this-unit", negated: false },
      { states: ["engaged"], subject: "this-unit", negated: true },
      { states: ["battle-shocked"], subject: "this-unit", negated: false },
      { states: ["on-battlefield"], subject: "this-model", negated: false },
      { states: ["engaged"], subject: "antecedent", negated: false, with: "event-subject" },
      { states: ["engaged"], subject: "antecedent", negated: false, with: "event-subject", at: "phase-start" },
      { states: ["engaged"], subject: "event-subject", negated: false },
      { states: ["embarked"], subject: "this-model", negated: false },
    ];
    for (const parameters of accepted) {
      expect(normalizeFingerprintParameters("unit-state", parameters, current())).toEqual(normalizeFingerprintParameters("unit-state", parameters, 14));
    }
  });

  it("refuses every other this-model state, and a negated, qualified or dated this-model engagement", () => {
    expect(() => normalizeFingerprintParameters("unit-state", { states: ["battle-shocked"], subject: "this-model", negated: false }, current())).toThrow(/only being on the battlefield/u);
    expect(() => normalizeFingerprintParameters("unit-state", { states: ["engaged", "on-battlefield"], subject: "this-model", negated: false }, current())).toThrow(/only being on the battlefield/u);
    expect(() => normalizeFingerprintParameters("unit-state", { ...engagedThisModel, negated: true }, current())).toThrow(/not negated/u);
    expect(() => normalizeFingerprintParameters("unit-state", { ...engagedThisModel, with: "event-subject" }, current())).toThrow(/takes no with/u);
    expect(() => normalizeFingerprintParameters("unit-state", { ...engagedThisModel, at: "phase-start" }, current())).toThrow(/takes no at/u);
  });
});

describe("the engaged cannot-end (2301, 4041 shape): a model subject", () => {
  const selection = () => leaf("event", { kind: "selected", move_types: ["normal", "advance", "fall-back"] });
  const throughTerrain = (passthrough: string) => leaf("move-through", { subject: "this-model", passthrough }, 3);
  const engagedModel = () => leaf("unit-state", { states: ["engaged"], subject: "this-model", negated: false }, 15);
  const cannotEnd = () => leaf("move-must-end", { match: "all", polarity: "cannot" }, 4);

  it("compiles the restriction as no_end_in_engagement on the passthrough's model", () => {
    const text = compiled([[
      [selection(), "when this model is selected to make a Normal, Advance or Fall Back move"],
      [throughTerrain("non-titanic-models"), "this model can move over non-Titanic models"],
      [throughTerrain("terrain-le-4"), "and terrain features 4 inches or lower"],
      [leaf("eligibility-permission", { subject: "this-model", activity: "move", allow: true, despite: ["engaged"] }, 4), "and can move while engaged"],
      [cannotEnd(), "but this model cannot end that move"],
      [engagedModel(), "within Engagement Range of them"],
    ]]);
    expect(text).toContain('"no_end_in_engagement":true');
    expect(text).toMatch(/"target":"this-model","modifier":\{[^}]*"no_end_in_engagement":true/u);
  });

  it("refuses the same restriction with no move-through or permission for this model in its sentence", () => {
    expect(refused([[[selection(), "when this model is selected to make a Normal move"], [cannotEnd(), "this model cannot end that move"], [engagedModel(), "within Engagement Range of them"]]])).toMatch(/covers this model only with a move-through or move permission/u);
  });
});

describe("the glue word but", () => {
  const coverage = (text: string) => ({ uncovered: [{ start_byte: 0, end_byte: text.length, fragment: "f", text }] }) as unknown as AbilityCoverage;

  it("treats a bare connective run as glue, so it is not an untiled run", () => {
    expect(untiledRuns(coverage(", but if it does, "))).toEqual([]);
    expect(untiledRuns(coverage(", but "))).toEqual([]);
  });

  it("still counts a run with real words as untiled", () => {
    expect(untiledRuns(coverage("but cannot end that move"))).toHaveLength(1);
  });
});

describe("describer: a move-end nearest the enemy unit the trigger names", () => {
  it("says the move must end as close as possible to that enemy unit", () => {
    const text = describeAbility({ effect: { type: "move", target: "this-unit", modifier: { move_type: "normal", distance: 6, ends_nearest: { of: "event-subject" } } } as Effect, scope: { duration: "permanent" } } as Parameters<typeof describeAbility>[0]);
    expect(text).toContain("it must end that move as close as possible to that enemy unit");
    expect(text).not.toContain("closest event-subject");
  });
});

describe("the mandatory end at the enemy unit the trigger names (2511 shape)", () => {
  const useWindow = () => leaf("use-window", { your_phases: [], opponent_phases: ["movement"], either_phases: [] });
  const enemyMoveEnded = (moves: string[]) => leaf("event", { kind: "move-ended", owner: "enemy", move_types: moves });
  const stratagemTarget = () => leaf("stratagem-target", { count: "one" });
  const alternatives = () => leaf("unit-filter", {
    side: "friendly",
    alternatives: [{ keywords: ["HERETIC ASTARTES", "VEHICLE"] }, { keywords: ["VASHTORR THE ARKIFANE"] }],
  });
  const ownedByFriendly = () => leaf("unit-owner", { owner: "friendly" });
  const within8OfEnemy = () => leaf("unit-position", { kind: "within", inches: 8, of: "event-subject", subject: "this-unit", negated: false });
  const notEngaged = () => leaf("unit-state", { states: ["engaged"], subject: "this-unit", negated: true });
  const move = () => leaf("make-move", { subject: "this-unit", move_type: "normal", distance: 6 });
  const endAtEnemy = () => leaf("move-end-nearest", { to: "event-subject" }, 3);

  it("compiles with the unit-filter's two alternatives and the end on the make-move", () => {
    const text = compiled([
      [
        [useWindow(), "in your opponent's Movement phase"],
        [enemyMoveEnded(["normal", "advance", "fall-back"]), "after an enemy unit ends a Normal, Advance or Fall Back move"],
        [stratagemTarget(), "select one unit"],
        [alternatives(), "HERETIC ASTARTES VEHICLE or VASHTORR THE ARKIFANE unit"],
        [ownedByFriendly(), "from your army"],
        [within8OfEnemy(), "within 8\" of that enemy unit"],
        [notEngaged(), "that is not engaged"],
      ],
      [
        [move(), "this unit can make a Normal move of up to 6\""],
        [endAtEnemy(), "it must end that move as close as possible to that enemy unit"],
      ],
    ]);
    expect(text).toContain('"ends_nearest":{"of":"event-subject"}');
    expect(text).toContain("HERETIC ASTARTES");
    expect(text).toContain("VASHTORR THE ARKIFANE");
  });
});

describe("the start-of-phase engaged condition on the mortal-wound roll (4339 shape)", () => {
  const destroyers = () => leaf("unit-filter", { side: "friendly", any_keywords: ["DESTROYER CULT", "FLAYED ONES"] });
  const startedEngaged = () => leaf("unit-state", { states: ["engaged"], subject: "antecedent", with: "event-subject", negated: false, at: "phase-start" });
  const roll = () => leaf("dice-roll", { dice: "D6" });
  const band = (from: number, to: number) => leaf("roll-result", { from, to });
  const wounds = (count: number | string) => leaf("mortal-wounds", { recipient: "event-subject", count });
  const move = () => leaf("make-move", { subject: "this-unit", move_type: "normal" });
  const endAtEnemy = () => leaf("move-end-nearest", { to: "event-subject" }, 3);

  it("keeps the phase-start qualifier on the condition and ends the move at the enemy unit", () => {
    const text = compiled([
      [
        [leaf("use-window", { your_phases: [], opponent_phases: ["movement"], either_phases: [] }), "in your opponent's Movement phase"],
        [leaf("event", { kind: "move-ended", owner: "enemy", move_types: ["fall-back"] }), "after an enemy unit ends a Fall Back move"],
        [leaf("stratagem-target", { count: "one" }), "select one unit"],
        [destroyers(), "DESTROYER CULT or FLAYED ONES unit from your army"],
        [leaf("unit-owner", { owner: "friendly" }), "that unit"],
        [startedEngaged(), "that started the phase within Engagement Range of that enemy unit"],
      ],
      [[roll(), "roll one D6"], [band(2, 5), "on a 2-5"], [wounds("D3"), "that enemy unit suffers D3 mortal wounds"]],
      [[band(6, 6), "on a 6"], [wounds(3), "that enemy unit suffers 3 mortal wounds"]],
      [[move(), "this unit can make a Normal move"], [endAtEnemy(), "it must end that move as close as possible to that enemy unit"]],
    ]);
    expect(text).toContain('"at":"phase-start"');
    expect(text).toContain('"with":"event-subject"');
    expect(text).toContain('"ends_nearest":{"of":"event-subject"}');
  });
});
