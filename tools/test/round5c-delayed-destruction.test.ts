import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { describeAbility } from "../src/translate/index.js";
import { describeHappened } from "../src/translate/condition-history.js";
import { FIRST_TIME_ERROR, NAMED_MODEL_ERROR, NESTED_MOMENT_ERROR } from "../src/round5c/compile-delayed-destruction.js";
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

  it("T2 pin: the same wording authored as an effect is not lowered to a happened condition (the leaf must be relabelled)", () => {
    // A bare phase-end with destroy-models is a legitimate removal, so the compiler cannot refuse it.
    // What must not happen is the compiler inventing the destruction condition from an effect leaf.
    const text = "At the end of a phase in which this model is destroyed, roll one D6: On a 2+, set this model back up.";
    const mechanics = mechanicsOf(placed(text,
      ["At the end of a phase", "event", PHASE_END],
      ["in which this model is destroyed", "destroy-models", { target: "this-model" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(mechanics.trigger).toEqual({ event: "phase-ended" });
    expect(JSON.stringify(mechanics)).not.toContain('"happened"');
    expect(JSON.stringify(mechanics.effect)).toContain("destroy-models");
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

  it("T6c: a 'first time' destruction with a 'then' gap and no usage limit is refused on the part path, not compiled silently", () => {
    // Without the usage limit the part path would fire on every destruction (753 as drafted).
    const text = "The first time this model is destroyed, remove it from play, then, at the end of the phase, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["remove it from play", "destroy-models", { target: "this-model" }],
      ["at the end of the phase", "event", PHASE_END],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(FIRST_TIME_ERROR);
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

  it("T3 gate: the set-up runs only inside the leadership success conditional; the test itself is ungated", () => {
    const mechanics = mechanicsOf(leaves(), text);
    const steps = mechanics.effect.steps as Array<Record<string, any>>;
    expect(steps.map((step) => step.type)).toEqual(["test", "conditional"]);
    const gate = steps[1]!;
    expect(gate.condition).toEqual({ type: "roll-result", parameters: { roll: "leadership", result: "success" } });
    expect(gate.effect.type).toBe("set-up");
    expect(JSON.stringify(steps[0])).not.toContain("set-up");
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
    const thenText = "When the bearer is destroyed, then take a Leadership test for the bearer at the end of the phase. If that test is passed, set the bearer back up.";
    const result = compileLeaves(placed(thenText,
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
    const text = "When this model is destroyed, remove it from play, then, at the end of the phase, roll one D6: On a 2+, set this model back up.";
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

  it("reads the negated condition as this model was not destroyed, never as the destruction", () => {
    const negated = describeHappened({ event: "model-destroyed", object: "this-model", window: "phase", count_min: 1 }, true);
    expect(negated).toContain("this model was not destroyed");
    expect(negated).not.toContain("this model was destroyed");
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

// Fabricated wording for the Wave 10 follow-up records: a destruction of this model or of a named model, then the phase end.
/** The dice roll and its result band that follow the phase-end moment in the follow-up shapes. */
const PHASE_END_ROLL = [
  ["roll one D6", "dice-roll", { dice: "D6" }],
  ["On a 2+", "roll-result", { from: 2, to: 6 }],
] as Array<[string, string, Record<string, unknown>]>;

describe("Delayed destruction follow-up: a named model's destruction is refused, not a trigger list", () => {

  it("T1 (81 shape): a model-destroyed moment, then the phase end, with no usage limit is refused as NAMED_MODEL_ERROR", () => {
    const text = "When a model in this unit is destroyed, at the end of the phase, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      ["a model in this unit is destroyed", "event", { kind: "model-destroyed" }],
      ["at the end of the phase", "event", PHASE_END],
      ...PHASE_END_ROLL,
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(NAMED_MODEL_ERROR);
  });

  it("T1b: the same named destruction with a first-time usage limit is still refused (the destruction is not this model's)", () => {
    const text = "The first time a model in this unit is destroyed, at the end of the phase, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      [...FIRST_TIME],
      ["a model in this unit is destroyed", "event", { kind: "model-destroyed" }],
      ["at the end of the phase", "event", PHASE_END],
      ...PHASE_END_ROLL,
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(NAMED_MODEL_ERROR);
  });

  it("T1c: a named destruction joined to the phase end by 'or' keeps the trigger list (a genuine alternative)", () => {
    const text = "At the end of the phase or when a model in this unit is destroyed, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      ["At the end of the phase", "event", PHASE_END],
      ["when a model in this unit is destroyed", "event", { kind: "model-destroyed" }],
      ...PHASE_END_ROLL,
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.ok ? result.mechanics.trigger : null)).toBe(true);
  });

  it("T14 (SE part path): a named destruction, then a sequence, then the phase end is refused as NAMED_MODEL_ERROR", () => {
    const text = "When a model in this unit is destroyed, then at the end of the phase, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      ["a model in this unit is destroyed", "event", { kind: "model-destroyed" }],
      ["at the end of the phase", "event", PHASE_END],
      ...PHASE_END_ROLL,
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(NAMED_MODEL_ERROR);
  });

  it("T13: 'The first time this model is destroyed, or at the end of the phase' with no usage keeps the trigger list, with no first-time error", () => {
    const text = "The first time this model is destroyed, or at the end of the phase, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["at the end of the phase", "event", PHASE_END],
      ...PHASE_END_ROLL,
      ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", min_enemy_distance: 1 }],
    ), text);
    expect(result.ok ? [] : result.errors).not.toContain(FIRST_TIME_ERROR);
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.ok ? result.mechanics.trigger : null)).toBe(true);
  });
});

describe("Delayed destruction follow-up: the 753 part path and the 1643 / 3644 / 7586 leaves", () => {
  const SET_UP = ["set this model back up", "set-up", { subject: "this-model", to: "battlefield", placement: "closest-to-destruction", min_enemy_distance: 1 }] as [string, string, Record<string, unknown>];

  it("T3 (753 with a usage limit): the usage is on the entry, destroy-models sits in the first part, the set-up in the second", () => {
    const text = "The first time this model is destroyed, remove it from play, then, at the end of the phase, roll one D6: On a 2+, set this model back up, with D6 wounds remaining.";
    const mechanics = mechanicsOf(placed(text,
      [...FIRST_TIME],
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["remove it from play", "destroy-models", { target: "this-model" }],
      ["at the end of the phase", "event", PHASE_END],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      SET_UP,
      ["with D6 wounds remaining", "wounds-remaining", { value: "D6" }],
    ), text);
    expect(mechanics.usage).toEqual({ frequency: "first-this-battle", per: "model" });
    const parts = mechanics.effect.steps as Array<Record<string, any>>;
    expect(parts.map((part) => part.trigger.event)).toEqual(["model-destroyed", "phase-ended"]);
    expect(JSON.stringify(parts[0])).toContain("destroy-models");
    expect(JSON.stringify(parts[1])).toContain("set-up");
    expect(JSON.stringify(parts[1])).toContain('"wounds_remaining":"D6"');
  });

  it("T4 (1643 shape, D3 wounds): lowers to one phase-ended trigger with the happened condition, the usage, and the D3 wounds", () => {
    const text = "The first time this model is destroyed, roll one D6 at the end of the phase. On a 2+, set this model back up on the battlefield as close as possible to where it was destroyed and not within Engagement Range of any enemy units, with D3 wounds remaining.";
    const mechanics = mechanicsOf(placed(text,
      [...FIRST_TIME],
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["at the end of the phase", "event", PHASE_END],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up on the battlefield as close as possible to where it was destroyed", "set-up", { subject: "this-model", to: "battlefield", placement: "closest-to-destruction", min_enemy_distance: 1 }],
      ["not within Engagement Range of any enemy units", "unit-state", { states: ["engaged"], subject: "antecedent", negated: true }],
      ["with D3 wounds remaining", "wounds-remaining", { value: "D3" }],
    ), text);
    expect(mechanics.trigger).toEqual({ event: "phase-ended", condition: { type: "happened", parameters: DESTROYED_IN_PHASE } });
    expect(mechanics.usage).toEqual({ frequency: "first-this-battle", per: "model" });
    expect(JSON.stringify(mechanics.effect)).toContain('"wounds_remaining":"D3"');
  });

  it("T12 (3644 / 7586 shape, full wounds): the set-up carries wounds_remaining 'full', not D3", () => {
    const text = "The first time this model is destroyed, roll one D6 at the end of the phase. On a 2+, set this model back up on the battlefield as close as possible to where it was destroyed and not within Engagement Range of any enemy units, with its full wounds remaining.";
    const mechanics = mechanicsOf(placed(text,
      [...FIRST_TIME],
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["at the end of the phase", "event", PHASE_END],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up on the battlefield as close as possible to where it was destroyed", "set-up", { subject: "this-model", to: "battlefield", placement: "closest-to-destruction", min_enemy_distance: 1 }],
      ["not within Engagement Range of any enemy units", "unit-state", { states: ["engaged"], subject: "antecedent", negated: true }],
      ["with its full wounds remaining", "wounds-remaining", { value: "full" }],
    ), text);
    expect(JSON.stringify(mechanics.effect)).toContain('"wounds_remaining":"full"');
    expect(JSON.stringify(mechanics.effect)).not.toContain('"wounds_remaining":"D3"');
  });

  it("T5 (10357 shape): the destruction is this-model-destroyed, the phase end lowers, and no destroy-models effect remains", () => {
    const text = "At the end of a phase in which this model is destroyed, roll one D6: On a 2+, set this model back up on the battlefield as close as possible to where it was destroyed, unengaged, with 3 wounds remaining.";
    const mechanics = mechanicsOf(placed(text,
      ["At the end of a phase", "event", PHASE_END],
      ["in which this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2, to: 6 }],
      ["set this model back up on the battlefield as close as possible to where it was destroyed", "set-up", { subject: "this-model", to: "battlefield", placement: "closest-to-destruction", min_enemy_distance: 1 }],
      ["unengaged", "unit-state", { states: ["engaged"], subject: "antecedent", negated: true }],
      ["with 3 wounds remaining", "wounds-remaining", { value: 3 }],
    ), text);
    expect(mechanics.trigger).toEqual({ event: "phase-ended", condition: { type: "happened", parameters: DESTROYED_IN_PHASE } });
    expect(JSON.stringify(mechanics)).not.toContain("destroy-models");
  });

  it("T7 (1028 shape, SF): an each-time moment nested with a phase end stays refused with the nested-moment text", () => {
    const text = "Each time this model is destroyed, at the end of the phase, roll one D6: On a 2+, set this model back up.";
    const result = compileLeaves(placed(text,
      ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
      ["at the end of the phase", "event", PHASE_END],
      ...PHASE_END_ROLL,
      SET_UP,
    ), text);
    expect(result.ok ? [] : result.errors).toContain(NESTED_MOMENT_ERROR);
  });
});
