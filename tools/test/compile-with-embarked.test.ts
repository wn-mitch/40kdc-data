import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { placed } from "./semantic-authoring-connective-fixture.js";

// "That unit (and any units embarked within that unit): A. B.": both effects reach the embarked units too. Wording is fabricated.

const text = "In your Movement phase, you can select one friendly Fixture Bikers unit. Its bikes are refuelled. That unit (and any units embarked within that unit):Is no longer **battle-shocked**.Is **worked up** until the start of your next turn.";
const items = (widen: boolean): Array<readonly [string, string, Record<string, unknown>]> => [
  ["In your Movement phase", "phase-window", { phase: "movement", turn: "your" }],
  ["you can", "optional-use", { who: "you" }],
  ["select one", "select-unit", { distance: "any", visible: false }],
  ["friendly Fixture Bikers unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE BIKERS"] }],
  ["Its bikes are refuelled", "apply-mark", { subject: "selected-unit", tag: "empowered" }],
  ...(widen ? [["(and any units embarked within that unit)", "with-embarked-units", {}] as const] : []),
  ["Is no longer **battle-shocked", "battle-shock-state", { recipient: "selected-unit", set: false }],
  ["Is **worked up", "apply-mark", { subject: "selected-unit", tag: "riled-up" }],
  ["until the start of your next turn", "duration", { endpoint: "start-of-next-turn" }],
];
const steps = (widen: boolean): Array<Record<string, unknown>> => {
  const result = compileLeaves(placed(text, ...items(widen)), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const select = (result.mechanics.effect as Record<string, any>).effect;
  return select.effect.steps;
};
const EMBARKED = { owner: "friendly", embarked_in: "selected-unit" };

describe("with-embarked-units", () => {
  it("widens each effect after it to the embarked units, and none before it", () => {
    const [mark, shock, riled] = steps(true) as Array<Record<string, any>>;
    expect(mark).toEqual({ type: "designate", target: "selected-unit", modifier: { tag: "empowered" } });
    expect(shock!.steps.map((step: Record<string, unknown>) => step.target)).toEqual(["selected-unit", EMBARKED]);
    expect(riled!.steps).toEqual([
      { type: "designate", target: "selected-unit", modifier: { tag: "riled-up" } },
      { type: "designate", target: EMBARKED, modifier: { tag: "riled-up" } },
    ]);
  });

  it("leaves every effect on its own unit without it", () => {
    expect(steps(false).map((step) => step.target)).toEqual(["selected-unit", "selected-unit", "selected-unit"]);
  });
});
