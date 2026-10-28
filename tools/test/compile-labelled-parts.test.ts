import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { placed } from "./semantic-authoring-connective-fixture.js";

// A standing state rule followed by a bold-labelled once-per-battle rule that grants the state. Wording is fabricated.

const body = (lineBreak: string) => "Friendly Fixture units with this ability can:Re‑roll **advance rolls.**Become **worked up**, as stated in other rules. While a unit is **worked up**:That unit has 5+ **InSv**.That unit’s ranged attacks have [ASSAULT].When that unit is selected to make an **advance move**, that **advance move** does not prevent that unit from being **eligible to declare a charge**."
  + `${lineBreak}**Fixture Cry (Once per battle, per army): **At the start of the Command phase, you can use this ability. If you do, friendly Fixture units with the **Fixture Shout! **ability are** worked up** until the end of the next turn.`;
const leaves = (text: string) => placed(text,
  ["Re‑roll **advance rolls", "reroll", { roll: "advance", subset: "all", weapon_type: "all" }],
  ["While a unit is **worked up", "unit-mark", { mark: "riled-up", subject: "this-unit", negated: false }],
  ["That unit has 5+ **InSv", "invulnerable-save", { subject: "antecedent", threshold: 5 }],
  ["That unit’s ranged attacks have", "weapon-ability-grant", { subject: "antecedent", weapon_type: "ranged" }],
  ["ASSAULT", "weapon-ability-keyword", { keyword: "Assault" }],
  ["When that unit is selected to make an **advance move", "event", { kind: "selected", move_types: ["advance"], to: "move", subject: "antecedent" }],
  ["that **advance move** does not prevent that unit from being **eligible to declare a charge", "eligibility-permission", { subject: "antecedent", activity: "declare-charge", allow: true, despite: ["advanced"] }],
  ["Once per battle, per army", "usage-limit", { frequency: "once-per-battle", per: "army" }],
  ["At the start of the Command phase", "event", { kind: "phase-start", phase: "command", turn: "either" }],
  ["you can use this ability", "optional-use", { who: "you" }],
  ["friendly Fixture units", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }],
  ["with the **Fixture Shout! **ability", "unit-has-ability", { subject: "antecedent", own: true, negated: false }],
  ["are** worked up", "apply-mark", { subject: "antecedent", tag: "riled-up" }],
  ["until the end of the next turn", "duration", { endpoint: "end-of-next-turn" }],
);
const RILED = { type: "matches", parameters: { filter: { designated: "riled-up" } } };

describe("a bold-labelled rule after a standing state rule", () => {
  for (const [name, lineBreak] of [["a newline", "\n"], ["a bare carriage return", "\r"]] as const) {
    it(`starts its own part after ${name}: its use, duration and gate stay its own`, () => {
      const text = body(lineBreak);
      const result = compileLeaves(leaves(text), text, { abilityId: "fixture-shout" });
      if (!result.ok) throw new Error(result.errors.join("; "));
      const [state, cry] = (result.mechanics.effect as { steps: Array<Record<string, any>> }).steps;
      expect(result.mechanics.scope).toEqual({ duration: "permanent" });
      // The state rule: the re-roll before the colon is ungated; every item after "While … worked up:" is gated.
      expect(state!.steps[0]).toEqual({ type: "re-roll", target: "this-unit", modifier: { roll: "advance", result_scope: "any-result" } });
      expect(state!.steps.slice(1, 3).map((step: Record<string, unknown>) => step.condition)).toEqual([RILED, RILED]);
      const advance = state!.steps[3];
      expect(advance.trigger.optional).toBeUndefined();
      expect(advance.effect.condition).toEqual(RILED);
      // The labelled rule: the player's choice, once per battle, lasting until the end of the next turn, and not gated by the state.
      expect(cry).toMatchObject({ type: "ability-part", trigger: { event: "phase-started", optional: true }, duration: "until-end-of-next-turn", usage: { frequency: "n-per-battle", count: 1, per: "army" } });
      expect(cry!.effect).toEqual({ type: "designate", target: { owner: "friendly", all_of: ["FIXTURE"], has_ability: ["fixture-shout"] }, modifier: { tag: "riled-up" } });
    });
  }
});

describe("duration version 6: end-of-next-turn", () => {
  it("is accepted and earlier endpoints are unchanged", () => {
    const version = currentFamilyVersion("duration");
    expect(version).toBeGreaterThanOrEqual(6);
    expect(normalizeFingerprintParameters("duration", { endpoint: "end-of-next-turn" }, version)).toEqual({ endpoint: "end-of-next-turn" });
    expect(normalizeFingerprintParameters("duration", { endpoint: "end-of-your-next-turn" }, version)).toEqual({ endpoint: "end-of-your-next-turn" });
    expect(() => normalizeFingerprintParameters("duration", { endpoint: "end-of-next-turn" }, 5)).toThrow();
  });
});
