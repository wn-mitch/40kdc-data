import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { describeAbility } from "../src/translate/index.js";
import { NESTED_MOMENT_ERROR } from "../src/round5c/compile-delayed-destruction.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

const DESTROYED_IN_PHASE = {
  event: "model-destroyed", object: "this-model", window: "phase", count_min: 1,
};
const PHASE_END = { kind: "phase-end", phase: "any", turn: "either" };
const FIRST_TIME = ["The first time", "usage-limit", { frequency: "first-this-battle", per: "model" }] as const;

// Fabricated wording: a model that returns once, at the end of a phase, after it is destroyed.
describe("Delayed destruction: a leading pair lowers to the phase that holds it", () => {
  it("S1: destroyed first, then at the end of the phase, with a usage limit and a wounds set-up", () => {
    const text = "The first time this model is destroyed, at the end of the phase, roll one D6: On a 2+, set this model back up, with 2 wounds remaining.";
    const mechanics = mechanicsOf(placed(text,
      [...FIRST_TIME],
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["at the end of the phase", "event", PHASE_END],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
      ["with 2 wounds remaining", "wounds-remaining", { value: 2 }],
    ), text);
    expect(mechanics.trigger).toEqual({ event: "phase-ended", condition: { type: "happened", parameters: DESTROYED_IN_PHASE } });
    expect(mechanics.usage).toEqual({ frequency: "first-this-battle", per: "model" });
    expect(JSON.stringify(mechanics.effect)).toContain('"wounds_remaining":2');
    expect(JSON.stringify(mechanics.effect)).not.toContain("ability-part");
  });

  it("S5: a phase in which this model is destroyed, with no usage limit, and no dice gate on the trigger", () => {
    const text = "At the end of a phase in which this model is destroyed, roll one D6: On a 2+, set this model back up, with 3 wounds remaining.";
    const mechanics = mechanicsOf(placed(text,
      ["At the end of a phase", "event", PHASE_END],
      ["in which this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
      ["with 3 wounds remaining", "wounds-remaining", { value: 3 }],
    ), text);
    expect(mechanics.trigger).toEqual({ event: "phase-ended", condition: { type: "happened", parameters: DESTROYED_IN_PHASE } });
    expect(mechanics.usage).toBeUndefined();
    expect(JSON.stringify(mechanics.trigger)).not.toContain("roll");
  });

  it("T2: a destruction authored as this-model-destroyed leaves no destroy-models effect", () => {
    const text = "At the end of a phase in which this model is destroyed, roll one D6: On a 2+, set this model back up, unengaged with 3 wounds remaining.";
    const mechanics = mechanicsOf(placed(text,
      ["At the end of a phase", "event", PHASE_END],
      ["in which this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
      ["with 3 wounds remaining", "wounds-remaining", { value: 3 }],
    ), text);
    expect(JSON.stringify(mechanics)).not.toContain("destroy-models");
  });

  it("T2 pin: the same wording authored as an effect is refused, not lowered", () => {
    const text = "At the end of a phase in which this model is destroyed, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      ["At the end of a phase", "event", PHASE_END],
      ["in which this model is destroyed", "destroy-models", { target: "this-model" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(result.ok && JSON.stringify(result.mechanics).includes('"type":"phase-ended"') ? "lowered" : "not lowered").toBe("not lowered");
  });
});

describe("Delayed destruction: refusals", () => {
  it("T6: a destruction joined to the phase-end by 'and' is refused, not compiled as a trigger list", () => {
    const text = "The first time this model is destroyed, and at the end of the phase, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      [...FIRST_TIME],
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["at the end of the phase", "event", PHASE_END],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(NESTED_MOMENT_ERROR);
  });

  it("T6b: a 'first time' pair with no usage limit is refused: the once-only property would be lost", () => {
    const text = "The first time this model is destroyed, at the end of the phase, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["at the end of the phase", "event", PHASE_END],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(NESTED_MOMENT_ERROR);
  });

  it("T6c: a delayed destruction with a 'then' gap and a 'first time' with no usage is the part path, not refused", () => {
    // The part path keeps today's behaviour (S2): no new error for a "then" gap.
    const text = "The first time this model is destroyed, remove it from play, then, at the end of the phase, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["remove it from play", "destroy-models", { target: "this-model" }],
      ["at the end of the phase", "event", PHASE_END],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(result.ok).toBe(true);
  });

  it("T6d: a leading pair joined by 'or' keeps the trigger list (a genuine alternative)", () => {
    const text = "At the end of the phase or when this model is destroyed, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      ["At the end of the phase", "event", PHASE_END],
      ["when this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.ok ? result.mechanics.trigger : null)).toBe(true);
  });

  it("T6b-out: a leading pair with no destruction keeps today's trigger list, with no error (narrow scope)", () => {
    const text = "When this unit is selected to fight, at the end of the phase, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      ["When this unit is selected to fight", "event", { kind: "selected", to: "fight" }],
      ["at the end of the phase", "event", PHASE_END],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.ok ? result.mechanics.trigger : null)).toBe(true);
  });
});

describe("Delayed destruction: a destruction, a Leadership test, and a phase-end (S3)", () => {
  const text = "The first time the bearer is destroyed, take a Leadership test for the bearer at the end of the phase. If that test is passed, set the bearer back up, with 2 wounds remaining.";
  const leaves = () => placed(text,
    [...FIRST_TIME],
    ["the bearer is destroyed", "event", { kind: "this-model-destroyed" }],
    ["take a Leadership test for the bearer", "test", { target: "this-model", test: "leadership" }],
    ["at the end of the phase", "event", PHASE_END],
    ["If that test is passed", "roll-outcome", { roll: "leadership", result: "success" }],
    ["set the bearer back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ["with 2 wounds remaining", "wounds-remaining", { value: 2 }],
  );

  it("T3: the trigger is the phase-end with the destruction condition; no ability-part on the destruction", () => {
    const mechanics = mechanicsOf(leaves(), text);
    expect(mechanics.trigger).toEqual({ event: "phase-ended", condition: { type: "happened", parameters: DESTROYED_IN_PHASE } });
    expect(JSON.stringify(mechanics)).not.toContain("ability-part");
    expect(JSON.stringify(mechanics.effect)).toContain('"type":"test"');
  });

  it("T3b: the entry's usage is the only usage, and it limits the whole ability", () => {
    const mechanics = mechanicsOf(leaves(), text);
    expect(mechanics.usage).toEqual({ frequency: "first-this-battle", per: "model" });
    expect(JSON.stringify(mechanics.effect).match(/"usage"/gu)).toBeNull();
  });

  it("T3c: without the usage limit, the pair is refused", () => {
    const result = compileLeaves(leaves().filter((leaf) => leaf.family_id !== "usage-limit"), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(NESTED_MOMENT_ERROR);
  });

  it("T3d: a 'then' in the gap keeps the part path (no lowering, no error)", () => {
    const thenText = "The first time the bearer is destroyed, then take a Leadership test for the bearer at the end of the phase. If that test is passed, set the bearer back up.";
    const result = compileLeaves(placed(thenText,
      [...FIRST_TIME],
      ["the bearer is destroyed", "event", { kind: "this-model-destroyed" }],
      ["take a Leadership test for the bearer", "test", { target: "this-model", test: "leadership" }],
      ["at the end of the phase", "event", PHASE_END],
      ["If that test is passed", "roll-outcome", { roll: "leadership", result: "success" }],
      ["set the bearer back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), thenText);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).toContain("ability-part");
  });
});

describe("Delayed destruction: parts that keep today's compile", () => {
  it("T5: a destruction, then a removal and the phase-end: two parts, as before", () => {
    const text = "The first time this model is destroyed, remove it from play, then, at the end of the phase, roll one D6: On a 2+, set this model back up.";
    const mechanics = mechanicsOf(placed(text,
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["remove it from play", "destroy-models", { target: "this-model" }],
      ["at the end of the phase", "event", PHASE_END],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    const parts = mechanics.effect.steps as Array<Record<string, any>>;
    expect(parts.map((part) => part.trigger.event)).toEqual(["model-destroyed", "phase-ended"]);
    expect(parts[1]!.trigger.condition).toBeUndefined();
  });

  it("T5b: with the usage limit before the first effect, the usage is on the entry, not on either part", () => {
    const text = "The first time this model is destroyed, remove it from play, then, at the end of the phase, roll one D6: On a 2+, set this model back up.";
    const mechanics = mechanicsOf(placed(text,
      [...FIRST_TIME],
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["remove it from play", "destroy-models", { target: "this-model" }],
      ["at the end of the phase", "event", PHASE_END],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(mechanics.usage).toEqual({ frequency: "first-this-battle", per: "model" });
    const parts = mechanics.effect.steps as Array<Record<string, any>>;
    expect(parts.every((part) => part.usage === undefined)).toBe(true);
  });
});

/** Every set-up node in a compiled tree, with its modifier (where `arrives` and `to` are read). */
function setUpsOf(node: unknown): Array<Record<string, any>> {
  if (Array.isArray(node)) return node.flatMap(setUpsOf);
  if (node === null || typeof node !== "object") return [];
  const record = node as Record<string, any>;
  const own = record.type === "set-up" ? [record.modifier ?? record] : [];
  return [...own, ...Object.values(record).flatMap(setUpsOf)];
}

describe("Reserves arrival binds to the set-up it follows in its own sentence (1339)", () => {
  it("T4: the arrival lands on the battlefield set-up, not on the step that places the unit in reserves", () => {
    const text = "Remove this unit from the battlefield. In the Reinforcements step of your next Movement phase, set this unit up anywhere on the battlefield.";
    const mechanics = mechanicsOf(placed(text,
      ["Remove this unit from the battlefield", "set-up", { subject: "this-unit", to: "strategic-reserves", from: "battlefield" }],
      ["In the Reinforcements step of your next Movement phase", "reserves-arrival", {}],
      ["set this unit up anywhere on the battlefield", "set-up", { subject: "this-unit", to: "battlefield" }],
    ), text);
    const setUps = setUpsOf(mechanics.effect);
    const reserves = setUps.find((item) => item.to === "strategic-reserves");
    const battlefield = setUps.find((item) => item.to === "battlefield");
    expect(reserves?.arrives).toBeUndefined();
    expect(battlefield?.arrives).toBe("next-movement-phase");
  });

  // Synthetic sentence layout: the arrival binds by its sentence, then by the earlier set-up it shares.
  // Each set-up is told apart by its min_enemy_distance, which is read back from the compiled tree.
  const picked = (text: string, items: Array<[string, string, Record<string, unknown>]>) => {
    const mechanics = mechanicsOf(placed(text, ...items), text);
    return setUpsOf(mechanics.effect).filter((item) => item.arrives !== undefined).map((item) => item.min_enemy_distance);
  };
  const setUp = (wording: string, distance: number): [string, string, Record<string, unknown>] => [wording, "set-up", { subject: "this-unit", to: "battlefield", min_enemy_distance: distance }];
  const arrival: [string, string, Record<string, unknown>] = ["Reinforcements step", "reserves-arrival", {}];

  it("T4b: an earlier set-up in the arrival's sentence wins over a following one", () => {
    const text = "Set this unit up here, then Reinforcements step arrives, and set this unit up again.";
    expect(picked(text, [setUp("Set this unit up here", 1), arrival, setUp("set this unit up again", 2)])).toEqual([1]);
  });

  it("T4b: with no earlier set-up in its sentence, the following set-up in that sentence wins", () => {
    const text = "Set this unit up here. Reinforcements step arrives, then set this unit up on the battlefield.";
    expect(picked(text, [setUp("Set this unit up here", 1), arrival, setUp("set this unit up on the battlefield", 2)])).toEqual([2]);
  });

  it("T4b: with no set-up in its sentence, the nearest earlier set-up anywhere wins", () => {
    const text = "Set this unit up here. Reinforcements step arrives.";
    expect(picked(text, [setUp("Set this unit up here", 1), arrival])).toEqual([1]);
  });
});

describe("Delayed destruction: the describer names this model, not any model of the unit", () => {
  it("reads the lowered trigger as this model's destruction in the phase", () => {
    const text = "The first time this model is destroyed, at the end of the phase, roll one D6: On a 2+, set this model back up, with 2 wounds remaining.";
    const mechanics = mechanicsOf(placed(text,
      [...FIRST_TIME],
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["at the end of the phase", "event", PHASE_END],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
      ["with 2 wounds remaining", "wounds-remaining", { value: 2 }],
    ), text);
    const english = describeAbility(mechanics as Parameters<typeof describeAbility>[0]);
    expect(english).toContain("if this model was destroyed this phase");
    expect(english).not.toContain("models destroyed");
  });
});

// Fabricated wording: the destruction-then-phase-end shapes not covered above.
describe("Delayed destruction: further leading and mid-ability shapes", () => {
  it("S4: a destruction then the end of the phase, with a once-per-battle-per-army usage and no 'first time'", () => {
    const text = "When this model is destroyed, at the end of the phase, roll one D6: On a 2+, set this model back up, with 2 wounds remaining.";
    const mechanics = mechanicsOf(placed(text,
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["at the end of the phase", "event", PHASE_END],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
      ["with 2 wounds remaining", "wounds-remaining", { value: 2 }],
    ), text);
    expect(mechanics.trigger).toEqual({ event: "phase-ended", condition: { type: "happened", parameters: DESTROYED_IN_PHASE } });
    expect(JSON.stringify(mechanics.effect)).not.toContain("ability-part");
  });

  it("S3 with the roll before the phase-end: the destruction, a roll, and the end of the phase lower to one phase-end", () => {
    const text = "The first time the bearer is destroyed, roll one D6 at the end of the phase: On a 2+, set the bearer back up, with 2 wounds remaining.";
    const mechanics = mechanicsOf(placed(text,
      [...FIRST_TIME],
      ["the bearer is destroyed", "event", { kind: "this-model-destroyed" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["at the end of the phase", "event", PHASE_END],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set the bearer back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
      ["with 2 wounds remaining", "wounds-remaining", { value: 2 }],
    ), text);
    expect(mechanics.trigger).toEqual({ event: "phase-ended", condition: { type: "happened", parameters: DESTROYED_IN_PHASE } });
    expect(JSON.stringify(mechanics.effect)).not.toContain("ability-part");
    expect(mechanics.usage).toEqual({ frequency: "first-this-battle", per: "model" });
  });

  it("refuses 'each time' with a destruction and an end of the phase: the phase condition would count one destruction per phase", () => {
    const text = "Each time this model is destroyed, at the end of the phase, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["at the end of the phase", "event", PHASE_END],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(NESTED_MOMENT_ERROR);
  });
});
