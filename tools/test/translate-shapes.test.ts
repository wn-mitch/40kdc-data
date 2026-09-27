import { describe, it, expect } from "vitest";

import { describeAbility, describeCondition, type Effect } from "../src/translate/index.js";
import { describeTrigger } from "../src/translate/trigger.js";

/**
 * Describer pins for the three Ability-DSL effect leaves added in 1.0.14
 * (`modifier-immunity`, `stratagem-cost-modifier`, `targeting-permission`).
 *
 * The branches that real data exercises (characteristics immunity, the
 * `increase`/`stratagems-targeting-bearer` stratagem tax, `within-range`
 * targeting gates) are also pinned cross-language by the conformance corpus.
 * These unit tests additionally lock the branches with no current data user
 * (enemy-stratagem/ability immunity, the `exclude` carve-out, `set-to`, and the
 * `closest-*` gates) so they cannot silently rot in the reference describer.
 */
function render(effect: Effect, scope: Record<string, unknown> = { range: "unit", duration: "permanent" }): string {
  return describeAbility({ effect, scope } as Parameters<typeof describeAbility>[0]);
}

describe("rule and turn-start vocabulary", () => {
  it("distinguishes the player's turn from the opponent's turn and the battle round", () => {
    const turn = (t: string) => ({ type: "player-turn-is", parameters: { turn: t } });
    expect(describeTrigger({ event: "turn-started", condition: turn("your-turn") })).toBe("at the start of your turn");
    expect(describeTrigger({ event: "turn-started", condition: turn("opponent-turn") })).toBe(
      "at the start of your opponent's turn",
    );
    expect(describeTrigger({ event: "round-started" })).toBe("at the start of the battle round");
  });

  it("tests whether a rule is active rather than a unit keyword, including negation", () => {
    const condition = { type: "rule-active", parameters: { rule: "acts-of-faith" } };
    expect(describeCondition(condition)).toBe("the Acts of Faith is active");
    expect(describeCondition({ operator: "not", operands: [condition] })).toBe("the Acts of Faith is not active");
    expect(describeCondition({
      type: "rule-active",
      parameters: { rule: "oath-of-moment" },
    })).toBe("the Oath of Moment is active");
    expect(render({ type: "conditional", condition, effect: { type: "no-effect" } })).toContain(
      "While the Acts of Faith is active",
    );
  });
});

describe("modifier-immunity", () => {
  it("ignores modifiers to characteristics", () => {
    expect(render({ type: "modifier-immunity", target: "unit", modifier: { scope: "characteristics" } })).toBe(
      "The unit ignores any modifiers to its characteristics.",
    );
  });

  it("renders an excluded characteristic", () => {
    expect(
      render({ type: "modifier-immunity", target: "self", modifier: { scope: "characteristics", exclude: ["Sv"] } }),
    ).toBe("This model ignores any modifiers to its characteristics (except Save).");
  });

  it("cannot be affected by enemy Stratagems", () => {
    expect(render({ type: "modifier-immunity", target: "self", modifier: { scope: "enemy-stratagems" } })).toBe(
      "This model cannot be affected by enemy Stratagems.",
    );
  });

  it("cannot be affected by enemy abilities", () => {
    expect(render({ type: "modifier-immunity", target: "self", modifier: { scope: "enemy-abilities" } })).toBe(
      "This model cannot be affected by enemy abilities.",
    );
  });
});

describe("stratagem-cost-modifier", () => {
  it("taxes enemy Stratagems targeting an aura (increase)", () => {
    expect(
      render(
        {
          type: "stratagem-cost-modifier",
          target: "enemy-within-aura",
          modifier: { operation: "increase", amount: 1, applies_to: "stratagems-targeting-bearer" },
        },
        { range: "aura-12", duration: "permanent" },
      ),
    ).toBe('Stratagems that target enemy units within 12" cost 1 more CP.');
  });

  it("sets a named Stratagem used by the bearer to a fixed cost (set-to)", () => {
    expect(
      render({
        type: "stratagem-cost-modifier",
        target: "unit",
        modifier: { operation: "set-to", set_to: 0, applies_to: "stratagems-used-by-bearer", stratagem: "command-re-roll" },
      }),
    ).toBe("The Command Re Roll Stratagem used by the unit costs 0CP.");
  });
});

describe("targeting-permission", () => {
  it("ranged, attacker within range (Lone Operative / fog-of-dreams family)", () => {
    expect(
      render({ type: "targeting-permission", target: "self", modifier: { attack_type: "ranged", gate: "within-range", range: 12 } }),
    ).toBe('This model can only be selected as the target of ranged attacks if the attacking unit is within 12".');
  });

  it("any attack, attacker within range", () => {
    expect(
      render({ type: "targeting-permission", target: "unit", modifier: { attack_type: "any", gate: "within-range", range: 18 } }),
    ).toBe('The unit can only be selected as the target of attacks if the attacking unit is within 18".');
  });

  it("closest eligible target gate", () => {
    expect(
      render({ type: "targeting-permission", target: "self", modifier: { attack_type: "any", gate: "closest-eligible" } }),
    ).toBe("This model can only be selected as the target of attacks if it is the closest eligible target.");
  });

  it("closest-or-within-range gate", () => {
    expect(
      render({ type: "targeting-permission", target: "self", modifier: { attack_type: "any", gate: "closest-or-within-range", range: 12 } }),
    ).toBe(
      'This model can only be selected as the target of attacks if it is the closest eligible target or the attacking unit is within 12".',
    );
  });
});
