import { describe, expect, it } from "vitest";

import type { CompileLeaf } from "../src/semantic-authoring/compile-fragments.js";
import { compileReviewedTiming } from "../src/semantic-authoring/compile-reviewed-timing.js";

function leaf(
  family_id: string,
  role: CompileLeaf["role"],
  parameters: Record<string, unknown>,
  start_byte: number,
): CompileLeaf {
  return { family_id, family_version: 1, role, parameters, start_byte, end_byte: start_byte + 1, fragment: "RAW_TEXT" };
}

const existing = {
  ability_id: "fabricated-recipient-rule",
  behavior: "reactive",
  effect: {
    type: "roll-modifier",
    target: "this-model",
    modifier: { roll: "psychic", operation: "add", value: 3, cap: 4 },
  },
  scope: { duration: "permanent" },
};

function reviewedLeaves(states?: string[]): CompileLeaf[] {
  return [
    leaf("unit-filter", "CONDITION", { side: "enemy", keywords: ["WITCH"], level: "model" }, 0),
    leaf("unit-has-ability", "CONDITION", { subject: "event-object", ability: "arcane-ledger" }, 2),
    leaf("event", "EVENT", { kind: "model-destroyed" }, 4),
    leaf("unit-position", "CONDITION", { kind: "within", inches: 7, of: "event-object", subject: "selected-unit", negated: false }, 6),
    leaf("select-unit", "EVENT", { distance: "any", visible: true, count: 2, up_to: true }, 8),
    leaf("unit-filter", "CONDITION", { side: "any", keywords: ["WARDEN"], level: "model", ...(states ? { states } : {}) }, 10),
    leaf("unit-has-ability", "CONDITION", { subject: "antecedent", own: true }, 12),
    leaf("duration", "DURATION", { endpoint: "end-of-turn" }, 14),
    leaf("event", "EVENT", { kind: "used", activity: "manoeuvre", id: "spiral-step" }, 16),
    leaf("roll-modifier", "EFFECT", { roll: "psychic", operation: "add", value: 3 }, 18),
  ];
}

describe("reviewed timing metadata compiler", () => {
  it("lowers a granted model reaction entirely from reviewed leaves", () => {
    const result = compileReviewedTiming(existing, reviewedLeaves());

    expect(result.effect).toEqual({
      type: "ability-part",
      trigger: {
        event: "model-destroyed",
        object: {
          owner: "enemy",
          all_of: ["WITCH"],
          level: "model",
          has_ability: ["arcane-ledger"],
        },
        optional: false,
      },
      effect: {
        type: "select-units",
        selector: {
          filter: {
            owner: "friendly",
            all_of: ["WARDEN"],
            level: "model",
            has_ability: ["fabricated-recipient-rule"],
            within: { range: { inches: 7 }, of: "event-object" },
            visible: { to: "this-model" },
          },
          count: { min: 0, max: 2 },
        },
        effect: {
          type: "ability-grant",
          target: "selected-unit",
          modifier: {
            definition: {
              type: "ability-part",
              trigger: { event: "used", filter: { kind: "manoeuvre", id: "spiral-step" } },
              duration: "turn",
              effect: existing.effect,
            },
          },
        },
      },
    });
    expect(result.scope).toEqual({ duration: "permanent" });
  });

  it("refuses a model filter with multiple positive states instead of dropping them", () => {
    expect(() => compileReviewedTiming(existing, reviewedLeaves(["battle-shocked", "engaged"]))).toThrow(/holds one state/u);
  });
});
