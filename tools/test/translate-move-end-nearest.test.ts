import { describe, it, expect } from "vitest";

import { describeAbility, type Effect } from "../src/translate/index.js";

/**
 * Describer pins for the move-end nearest shapes: a make-move's ends_nearest, a bonus's waiver
 * (either end legal), a bonus's ends_when proviso, and the engaged permission bound to the
 * nearest-end unit. Each phrase pins one branch so a wording change is a visible diff.
 */
function render(effect: Effect): string {
  return describeAbility({ effect, scope: { duration: "permanent" } } as Parameters<typeof describeAbility>[0]);
}

const nearest = { of: { owner: "enemy" } };

describe("move-end nearest describer", () => {
  it("says a make-move must end as close as possible to the closest unit it names", () => {
    const text = render({ type: "move", target: "this-unit", modifier: { move_type: "normal", distance: "D6", ends_nearest: nearest } } as Effect);
    expect(text).toContain("it must end that move as close as possible to the closest enemy unit");
  });

  it("says either end is legal when the waiver applies", () => {
    const text = render({
      type: "move-modifier", target: "this-unit",
      modifier: { applies_to_moves: ["pile-in", "consolidation"], ends_nearest: { ...nearest, waives: "closest-enemy-model" } },
    } as Effect);
    expect(text).toContain("either closer to the closest enemy model or as close as possible to the closest enemy unit");
  });

  it("states the bonus proviso and the end the bonus move must take", () => {
    const text = render({
      type: "move-modifier", target: "this-unit",
      modifier: {
        applies_to_moves: ["consolidation"], distance_bonus: 3,
        ends_when: { type: "unit-state", parameters: { state: "engaged", subject: "this-unit" } },
      },
    } as Effect);
    expect(text).toContain("the extra distance applies only if");
    expect(text).toContain("and must end it there");
  });

  it("binds a make-move's engagement to the enemy unit its move ends nearest", () => {
    const text = render({
      type: "move", target: "this-unit",
      modifier: { move_type: "normal", distance: 6, ends_nearest: { of: { owner: "enemy" } }, allow_engagement: true, engaged_with: "nearest-move-end" },
    } as Effect);
    expect(text).toContain("it can end that move within Engagement Range of that enemy unit");
    expect(text).not.toContain("enemy units");
  });

  it("keeps the untargeted engagement wording when the move has no engaged_with binding", () => {
    const text = render({
      type: "move", target: "this-unit",
      modifier: { move_type: "normal", distance: 6, allow_engagement: true },
    } as Effect);
    expect(text).toContain("it can end that move within Engagement Range of enemy units");
  });
});
