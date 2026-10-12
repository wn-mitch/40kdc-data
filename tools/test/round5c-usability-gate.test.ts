import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment: string];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment };
  });
}

const TARGET: Item[] = [
  ["One", "stratagem-target", { count: "one" }, "TARGET"],
  ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
];
const GATE: Item = ["You cannot use this Stratagem during the first battle round", "battle-round", { min: 2 }, "RESTRICTIONS"];

const run = (text: string, items: Item[]) => {
  const result = compileLeaves(placed(text, items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as { effect: Record<string, any>; trigger: Record<string, any> | null };
};

describe("a Stratagem's battle-round restriction is when it can be used", () => {
  const withMoment = "End of the opposing Movement phase. One ALPHA unit. This unit is shaken. You cannot use this Stratagem during the first battle round.";
  const moment: Item = ["End of the opposing Movement phase", "event", { kind: "phase-end", phase: "movement", turn: "opponent" }, "WHEN"];

  it("joins the WHEN moment's condition instead of wrapping the effect", () => {
    const { effect, trigger } = run(withMoment, [moment, ...TARGET, ["This unit is shaken", "battle-shock-state", { recipient: "this-unit", set: true }, "EFFECT"], GATE]);
    expect(trigger).toEqual({
      event: "phase-ended",
      condition: { operator: "and", operands: [
        { type: "phase-is", parameters: { phase: "movement" } },
        { type: "player-turn-is", parameters: { turn: "opponent-turn" } },
        { type: "battle-round", parameters: { min: 2 } },
      ] },
    });
    expect(effect.type).toBe("state-change");
  });

  it("starts a condition of its own on a moment that tests nothing else", () => {
    const text = "At the start of the battle. One ALPHA unit. This unit is shaken. You cannot use this Stratagem during the first battle round.";
    const { trigger } = run(text, [["At the start of the battle", "event", { kind: "battle-started" }, "WHEN"], ...TARGET, ["This unit is shaken", "battle-shock-state", { recipient: "this-unit", set: true }, "EFFECT"], GATE]);
    expect(trigger).toEqual({ event: "battle-started", condition: { type: "battle-round", parameters: { min: 2 } } });
  });

  it("stays a condition on the effect when the Stratagem has no moment to hold it", () => {
    const text = "Your Movement phase. One ALPHA unit. This unit is shaken. You cannot use this Stratagem during the first battle round.";
    const { effect, trigger } = run(text, [["Your Movement phase", "use-window", { your_phases: ["movement"], opponent_phases: [], either_phases: [] }, "WHEN"], ...TARGET, ["This unit is shaken", "battle-shock-state", { recipient: "this-unit", set: true }, "EFFECT"], GATE]);
    expect(trigger).toBeNull();
    expect(effect).toMatchObject({ type: "conditional", condition: { type: "battle-round", parameters: { min: 2 } } });
  });

  it("leaves a battle-round test inside the effect text on the effect", () => {
    const text = "End of the opposing Movement phase. One ALPHA unit. If it is after the first battle round, this unit is shaken.";
    const { effect, trigger } = run(text, [moment, ...TARGET, ["after the first battle round", "battle-round", { min: 2 }, "EFFECT"], ["this unit is shaken", "battle-shock-state", { recipient: "this-unit", set: true }, "EFFECT"]]);
    expect(JSON.stringify(trigger)).not.toContain("battle-round");
    expect(effect).toMatchObject({ type: "conditional", condition: { type: "battle-round" } });
  });
});
