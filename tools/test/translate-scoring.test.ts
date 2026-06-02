import { describe, it, expect } from "vitest";

import {
  describeTrigger,
  describeAward,
  describeCondition,
  describeScoringCard,
  type ScoringTrigger,
  type ScoringAward,
  type Condition,
} from "../src/translate/index.js";
import { Dataset } from "../src/data/dataset.js";

describe("describeTrigger", () => {
  it("end-of-phase with a round window", () => {
    const t: ScoringTrigger = {
      timing: "end-of-phase",
      phase: "command",
      player_turn: "your-turn",
      battle_round: { min: 2 },
    };
    expect(describeTrigger(t)).toBe("End of your Command phase (round 2+)");
  });

  it("end-of-turn with a max-only window", () => {
    expect(
      describeTrigger({ timing: "end-of-turn", battle_round: { max: 2 } }),
    ).toBe("End of your turn (rounds 1-2)");
  });

  it("end-of-battle ignores turn", () => {
    expect(describeTrigger({ timing: "end-of-battle" })).toBe("End of the battle");
  });
});

describe("describeCondition", () => {
  it("controls-objective with a role", () => {
    const c: Condition = {
      type: "controls-objective",
      parameters: { objective_role: "central", count_min: 1 },
    };
    expect(describeCondition(c)).toBe("you control 1+ central objectives");
  });

  it("objective-majority", () => {
    expect(
      describeCondition({ type: "objective-majority", parameters: { relative_to: "opponent" } }),
    ).toBe("you hold more objectives than the opponent");
  });

  it("compound and", () => {
    const c: Condition = {
      operator: "and",
      operands: [
        { type: "terrain-has-tag", parameters: { tag: "mined" } },
        { type: "units-destroyed", parameters: { side: "enemy", window: "this-turn", count_min: 1 } },
      ],
    };
    expect(describeCondition(c)).toBe(
      "terrain tagged mined and 1+ enemy units destroyed this turn",
    );
  });

  it("destroyed-in-tagged-terrain (start of turn)", () => {
    expect(
      describeCondition({
        type: "destroyed-in-tagged-terrain",
        parameters: { tag: "mined", at_start_of_turn: true, count_min: 1 },
      }),
    ).toBe("1+ enemy units destroyed that started the turn in mined terrain");
  });

  it("destroyed-in-tagged-terrain (moment of kill)", () => {
    expect(
      describeCondition({
        type: "destroyed-in-tagged-terrain",
        parameters: { tag: "marked", count_min: 2 },
      }),
    ).toBe("2+ enemy units destroyed while in marked terrain");
  });
});

describe("describeAward", () => {
  it("flat vp with a when clause", () => {
    const a: ScoringAward = {
      trigger: { timing: "end-of-turn", player_turn: "your-turn", battle_round: { max: 2 } },
      when: { type: "objective-majority", parameters: { relative_to: "opponent" } },
      vp: 2,
    };
    expect(describeAward(a)).toBe(
      "End of your turn (rounds 1-2): 2 VP when you hold more objectives than the opponent",
    );
  });

  it("vp_per, cumulative bonus row", () => {
    const a: ScoringAward = {
      trigger: { timing: "end-of-phase", phase: "command", player_turn: "your-turn", battle_round: { min: 2 } },
      vp_per: 2,
      per: "controlled-central-objective-at-end-of-command-phase",
      cumulative: true,
      when: { type: "controls-objective", parameters: { objective_role: "central", count_min: 1 } },
    };
    expect(describeAward(a)).toBe(
      "+ End of your Command phase (round 2+): 2 VP per controlled central objective at end of command phase when you control 1+ central objectives",
    );
  });
});

describe("describeScoringCard against the embedded dataset", () => {
  const ds = Dataset.embedded();

  it("translates ground-control's awards", () => {
    const card = ds.missionCards.get("ground-control");
    expect(card).toBeDefined();
    expect(describeScoringCard(card!)).toEqual([
      "End of your turn (rounds 1-2): 2 VP when you hold more objectives than the opponent",
      "End of your Command phase (round 2+): 3 VP per controlled objective at end of command phase",
      "+ End of your Command phase (round 2+): 2 VP per controlled central objective at end of command phase when you control 1+ central objectives",
    ]);
  });

  it("every primary card translates to one line per award, no [unknown] fallbacks", () => {
    const primaries = ds.missionCards.all.filter((c) => c.card_type === "primary");
    expect(primaries.length).toBe(25);
    for (const card of primaries) {
      const lines = describeScoringCard(card);
      expect(lines.length).toBe(card.awards?.length ?? 0);
      for (const line of lines) {
        // ASCII-only output, no unresolved condition types.
        expect(line).toMatch(/^[\x20-\x7e]*$/);
        expect(line).not.toContain("unknown");
      }
    }
  });
});
