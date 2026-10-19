import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order, all in RAW_TEXT (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const shocked: Item = ["this unit is shaken", "battle-shock-state", { recipient: "this-unit", set: true }];
const reaction = (): Item[] => [
  ["enemy unit", "unit-filter", { side: "enemy" }],
  ["makes a retreat", "event", { kind: "move-ended", move_types: ["fall-back"] }],
  ["that enemy unit must take a test", "test", { target: "antecedent", test: "leadership" }],
];
const phaseStart: Item = ["Start of the opposing Movement phase", "event", { kind: "phase-start", phase: "movement", turn: "opponent" }];
const offer: Item = ["you can use this", "optional-use", { who: "you" }];

const compiled = (text: string, ...items: Item[]) => {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as { effect: Record<string, any> };
};
const refusal = (text: string, ...items: Item[]) => {
  const result = compileLeaves(placed(text, ...items), text);
  return result.ok ? null : result.errors.join("; ");
};

describe("a later moment under the use the first moment offers", () => {
  const ifYouDo = "Start of the opposing Movement phase, you can use this. If you do: this unit is shaken. When an enemy unit makes a retreat, that enemy unit must take a test.";

  it("nests in the entry part for the phase, instead of standing as a sibling part", () => {
    const { effect } = compiled(ifYouDo, phaseStart, offer, shocked, ...reaction());
    expect(effect.type).toBe("ability-part");
    expect(effect.trigger).toMatchObject({ event: "phase-started", optional: true });
    const [first, nested] = effect.effect.steps;
    expect(first.type).toBe("state-change");
    expect(nested).toMatchObject({ type: "ability-part", duration: "phase", trigger: { event: "move-ended", filter: { move_types: ["fall-back"] } } });
    // The nested moment is not a second offer of the use.
    expect(nested.trigger.optional).toBeUndefined();
  });

  it("keeps the moment a sibling part when 'if you do' is not printed between the use and the moment", () => {
    const text = "Start of the opposing Movement phase, you can use this. Then this unit is shaken. When an enemy unit makes a retreat, that enemy unit must take a test.";
    const { effect } = compiled(text, phaseStart, offer, shocked, ...reaction());
    expect(effect.type).toBe("sequence");
    expect(effect.steps.map((step: Record<string, any>) => step.type)).toEqual(["ability-part", "ability-part"]);
    expect(JSON.stringify(effect.steps[0])).not.toContain("move-ended");
  });

  it("keeps the moment a sibling part when the first moment is not the start of a phase", () => {
    const text = "When this unit is chosen to shoot, you can use this. If you do: this unit is shaken. When an enemy unit makes a retreat, that enemy unit must take a test.";
    const { effect } = compiled(text, ["When this unit is chosen to shoot", "event", { kind: "selected", to: "shoot", subject: "this-unit" }], offer, shocked, ...reaction());
    expect(effect.type).toBe("sequence");
    expect(JSON.stringify(effect)).not.toContain('"duration":"phase"');
  });

  it("does not move a moment that comes before the use into the use", () => {
    const text = "Start of the opposing Movement phase, this unit is shaken. If you do: you can use this. When an enemy unit makes a retreat, that enemy unit must take a test.";
    const { effect } = compiled(text, phaseStart, shocked, offer, ...reaction());
    expect(JSON.stringify(effect)).not.toContain('"duration":"phase"');
    expect(refusal(text, phaseStart, shocked, offer, ...reaction())).toBeNull();
  });
});
