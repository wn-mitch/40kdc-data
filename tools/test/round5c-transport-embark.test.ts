import { describe, expect, it } from "vitest";

import { describeCondition } from "../src/translate/index.js";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { extensionVersionPairs } from "../src/round5c/family-extensions.js";
import { createValidator } from "../src/schema-loader.js";

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment: string];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
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

function refused(text: string, ...items: Item[]): string {
  const result = compileLeaves(placed(text, ...items), text);
  if (result.ok) throw new Error("compiled, but should refuse");
  return result.errors.join("; ");
}

/** The compiled mechanics and the Stratagem target restrictions, as JSON text. */
function compiled(text: string, ...items: Item[]): { effect: string; target: string } {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return { effect: JSON.stringify(result.mechanics), target: JSON.stringify(result.core?.target_restrictions ?? null) };
}

const WINDOW: Item = ["Movement phase", "use-window", { your_phases: ["movement"], opponent_phases: [], either_phases: [] }, "WHEN"];
const DURATION: Item = ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }, "EFFECT"];
/** Two targets: an ALPHA unit, and a friendly TRANSPORT that the first target is able to embark within. */
const TEXT = "Movement phase. One ALPHA unit, and one friendly TRANSPORT that it is able to embark within. Until the end of the turn, one friendly ALPHA unit is eligible to shoot after falling back, and can embark.";
const ALPHA_EFFECT: Item[] = [
  DURATION,
  ["one friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"], among: "stratagem-targets", targets: "one" }, "EFFECT"],
  ["is eligible to shoot after falling back", "act-after-move", { subject: "antecedent", moves: ["fall-back"], acts: ["shoot"] }, "EFFECT"],
];
const TWO_TARGETS: Item[] = [
  WINDOW,
  ["One", "stratagem-target", { count: "one" }, "TARGET"],
  ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
  ["one", "stratagem-target", { count: "one" }, "TARGET"],
  ["friendly TRANSPORT", "unit-filter", { side: "friendly", keywords: ["TRANSPORT"] }, "TARGET"],
  ["that it is able to embark within", "eligible", { subject: "antecedent", to: "embark-within", transport: "this-unit" }, "TARGET"],
  ...ALPHA_EFFECT,
];

describe("Round 5C transport eligibility: the eligible parameters", () => {
  it("names the Transport and refuses a Transport it cannot name", () => {
    expect(() => normalizeFingerprintParameters("eligible", { subject: "this-unit", to: "embark-within" }, 3)).toThrow(/names the Transport/u);
    expect(() => normalizeFingerprintParameters("eligible", { subject: "this-unit", to: "embark-within", transport: "selected-unit" }, 3)).toThrow(/eligible.transport must be one of/u);
    expect(() => normalizeFingerprintParameters("eligible", { subject: "this-unit", to: "fight", transport: "this-unit" }, 3)).toThrow(/applies only to to: embark-within/u);
  });

  it("refuses a model subject, an at, and a source ability on embark-within", () => {
    expect(() => normalizeFingerprintParameters("eligible", { subject: "this-model", to: "embark-within", transport: "this-unit" }, 3)).toThrow(/names units, not models/u);
    expect(() => normalizeFingerprintParameters("eligible", { subject: "this-unit", to: "embark-within", transport: "this-unit", at: "now" }, 3)).toThrow(/takes no at/u);
    expect(() => normalizeFingerprintParameters("eligible", { subject: "this-unit", to: "embark-within", transport: "this-unit", source_ability_id: "x-y" }, 3)).toThrow(/takes no at/u);
  });

  it("accepts an earlier leaf's unit and this-unit or ability-unit as the Transport", () => {
    expect(normalizeFingerprintParameters("eligible", { subject: "antecedent", to: "embark-within", transport: "this-unit" }, 3))
      .toEqual({ subject: "antecedent", to: "embark-within", transport: "this-unit" });
    expect(normalizeFingerprintParameters("eligible", { subject: "this-unit", to: "embark-within", transport: "ability-unit" }, 3))
      .toEqual({ subject: "this-unit", to: "embark-within", transport: "ability-unit" });
  });

  it("leaves a version 2 eligible leaf as it was", () => {
    expect(normalizeFingerprintParameters("eligible", { subject: "this-unit", to: "fight" }, 3))
      .toEqual(normalizeFingerprintParameters("eligible", { subject: "this-unit", to: "fight" }, 2));
  });

  it("migrates eligible from version 2 to version 3 by identity", () => {
    expect(currentFamilyVersion("eligible")).toBe(3);
    expect(extensionVersionPairs()).toContainEqual({ family: "eligible", from: 2, to: 3 });
  });
});

describe("Round 5C transport eligibility: compiling the Transport target", () => {
  it("binds the subject to the first target and names the Transport as the candidate", () => {
    const { target } = compiled(TEXT, ...TWO_TARGETS);
    const [, second] = JSON.parse(target) as Record<string, any>[];
    expect(second!.eligibility.operands).toContainEqual({ type: "eligible", parameters: { subject: { stratagem_target: "first" }, to: "embark-within", transport: "this-unit" } });
  });

  it("negates the predicate when the text says the unit is not able to embark within", () => {
    const text = TEXT.replace("that it is able to embark within", "that it is not able to embark within");
    const items = TWO_TARGETS.map((item): Item => item[1] === "eligible" ? ["that it is not able to embark within", item[1], { ...item[2], negated: true }, item[3]] : item);
    const { target } = compiled(text, ...items);
    expect(target).toContain('"operator":"not"');
    expect(target).toContain('"to":"embark-within"');
  });

  it("compiles the two-target shape with a neutral effect on the first target, the Transport target kept", () => {
    const text = "Movement phase. One friendly INFANTRY unit that is eligible to fight, and one friendly TRANSPORT within 6\" of it that it is able to embark within. Until the end of the turn, one friendly INFANTRY unit can embark within it.";
    const items: Item[] = [
      WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly INFANTRY unit", "unit-filter", { side: "friendly", keywords: ["INFANTRY"] }, "TARGET"],
      ["that is eligible to fight", "eligible", { subject: "this-unit", to: "fight" }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly TRANSPORT", "unit-filter", { side: "friendly", keywords: ["TRANSPORT"] }, "TARGET"],
      ["within 6\" of it", "unit-position", { kind: "within", inches: 6, of: "antecedent", subject: "this-unit", negated: false, wholly: true }, "TARGET"],
      ["that it is able to embark within", "eligible", { subject: "antecedent", to: "embark-within", transport: "this-unit" }, "TARGET"],
      DURATION,
      ["one friendly INFANTRY unit", "unit-filter", { side: "friendly", keywords: ["INFANTRY"], among: "stratagem-targets", targets: "one" }, "EFFECT"],
      ["can embark within it", "make-move", { subject: "antecedent", move_type: "normal" }, "EFFECT"],
    ];
    const { target } = compiled(text, ...items);
    expect(target).toContain('"stratagem_target":"first"');
    expect(target).toContain('"to":"embark-within"');
  });

  it("refuses a proximity whose anchor is a later target, rather than measuring the unit to itself", () => {
    const text = "Movement phase. One ALPHA unit wholly within 6\" of a friendly TRANSPORT, and one friendly TRANSPORT that it is able to embark within. Until the end of the turn, one friendly ALPHA unit is eligible to shoot after falling back.";
    const items: Item[] = [
      WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["wholly within 6\" of a friendly TRANSPORT", "unit-position", { kind: "within", inches: 6, of: "antecedent", subject: "this-unit", negated: false, wholly: true }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly TRANSPORT", "unit-filter", { side: "friendly", keywords: ["TRANSPORT"] }, "TARGET"],
      ["that it is able to embark within", "eligible", { subject: "antecedent", to: "embark-within", transport: "this-unit" }, "TARGET"],
      ...ALPHA_EFFECT,
    ];
    expect(refused(text, ...items)).toMatch(/measures a unit to itself/u);
  });

  it("still refuses an effect on this unit once there are several targets", () => {
    expect(refused(TEXT, ...TWO_TARGETS.slice(0, 6), DURATION, ["is eligible to shoot after falling back", "act-after-move", { subject: "this-unit", moves: ["fall-back"], acts: ["shoot"] }, "EFFECT"]))
      .toMatch(/several targets/u);
  });

  it("refuses an embark that follows a Transport the subject is able to embark within", () => {
    const embark: Item = ["can embark", "eligibility-permission", { subject: "antecedent", activity: "embark", allow: true }, "EFFECT"];
    expect(refused(TEXT, ...TWO_TARGETS.slice(0, 6), ...ALPHA_EFFECT.slice(0, 2), embark)).toMatch(/no destination for an embark/u);
    const move: Item = ["can embark", "make-move", { subject: "antecedent", move_type: "embark" }, "EFFECT"];
    expect(refused(TEXT, ...TWO_TARGETS.slice(0, 6), ...ALPHA_EFFECT.slice(0, 2), move)).toMatch(/no destination for an embark/u);
  });

  it("refuses an antecedent subject with no earlier unit, rather than binding it to the Transport itself", () => {
    const text = "Movement phase. One TRANSPORT that it is able to embark within. Until the end of the turn, it can shoot.";
    const items: Item[] = [
      WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["TRANSPORT", "unit-filter", { side: "friendly", keywords: ["TRANSPORT"] }, "TARGET"],
      ["that it is able to embark within", "eligible", { subject: "antecedent", to: "embark-within", transport: "this-unit" }, "TARGET"],
      DURATION,
      ["it can shoot", "act-after-move", { subject: "antecedent", moves: ["fall-back"], acts: ["shoot"] }, "EFFECT"],
    ];
    expect(refused(text, ...items)).toMatch(/names the Transport as the unit able to embark within itself/u);
  });

  it("refuses an antecedent subject that a unit-filter right before it binds to the Transport's own units", () => {
    const text = "Movement phase. One TRANSPORT that it is able to embark within. Until the end of the turn, it can shoot.";
    const items: Item[] = [
      WINDOW,
      ["One TRANSPORT", "unit-filter", { side: "friendly", keywords: ["TRANSPORT"] }, "WHEN"],
      ["that it is able to embark within", "eligible", { subject: "antecedent", to: "embark-within", transport: "this-unit" }, "WHEN"],
      DURATION,
    ];
    expect(refused(text, ...items)).toMatch(/names the Transport as the unit able to embark within itself/u);
  });

  it("refuses embark-within inside a bound selection pair, whose eligibility is not bound with it yet", () => {
    const text = "Select one friendly ALPHA unit. Select one friendly TRANSPORT within 6\" of that unit that it is able to embark within. That unit suffers 1 mortal wound.";
    const items: Item[] = [
      ["Select one friendly", "select-unit", { distance: "any", visible: false, bind_as: "first" }, "EFFECT"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "EFFECT"],
      ["Select one friendly", "select-unit", { distance: "within", inches: 6, visible: false, within_of: "first" }, "EFFECT"],
      ["TRANSPORT", "unit-filter", { side: "friendly", keywords: ["TRANSPORT"] }, "EFFECT"],
      ["that it is able to embark within", "eligible", { subject: "antecedent", to: "embark-within", transport: "this-unit" }, "EFFECT"],
      ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }, "EFFECT"],
    ];
    expect(refused(text, ...items)).toMatch(/not bound with it yet/u);
  });
});

describe("Round 5C transport eligibility: a unit selected to embark within the ability's own unit", () => {
  const text = "Charge phase, opponent's turn. Once per turn, after an enemy unit has selected its charge targets, you can select one friendly ADEPTUS ASTARTES unit that was one of those charge targets and is able to embark within this unit. That unit can embark within this unit.";
  const selection: Item[] = [
    ["Charge phase", "phase-window", { phase: "charge", turn: "opponent" }, "WHEN"],
    ["enemy unit", "unit-filter", { side: "enemy" }, "WHEN"],
    ["selected its charge targets", "event", { kind: "targets-selected", action_kind: "charge" }, "WHEN"],
    ["you can select one", "select-unit", { distance: "any", visible: false }, "EFFECT"],
    ["ADEPTUS ASTARTES unit", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES"] }, "EFFECT"],
    ["that was one of those charge targets", "target-is-selected", { by: "event-subject", target: "this-unit" }, "EFFECT"],
    ["is able to embark within this unit", "eligible", { subject: "this-unit", to: "embark-within", transport: "ability-unit" }, "EFFECT"],
  ];

  it("binds a selected unit's embark-within eligibility to the selection (a single select-unit, no pair)", () => {
    const text = "Select one friendly ALPHA unit that is able to embark within this unit. That unit suffers 1 mortal wound.";
    const items: Item[] = [
      ["Select one friendly", "select-unit", { distance: "any", visible: false }, "EFFECT"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "EFFECT"],
      ["that is able to embark within this unit", "eligible", { subject: "antecedent", to: "embark-within", transport: "ability-unit" }, "EFFECT"],
      ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }, "EFFECT"],
    ];
    const { effect } = compiled(text, ...items);
    expect(effect).toContain('"subject":"selected-unit","to":"embark-within","transport":"ability-unit"');
  });

  it("compiles the candidate's embark-within condition against the ability's own unit", () => {
    const { effect } = compiled(text, ...selection, ["That unit can embark within this unit", "make-move", { subject: "antecedent", move_type: "normal" }, "EFFECT"]);
    expect(effect).toContain('"to":"embark-within","transport":"ability-unit"');
  });

  it("refuses the embark itself until the DSL can name its destination", () => {
    expect(refused(text, ...selection, ["That unit can embark within this unit", "make-move", { subject: "antecedent", move_type: "embark" }, "EFFECT"]))
      .toMatch(/no destination for an embark/u);
  });
});

describe("Round 5C transport eligibility: describing the predicate", () => {
  it("reads the subject as able to embark within the named Transport", () => {
    expect(describeCondition({ type: "eligible", parameters: { subject: "this-unit", to: "embark-within", transport: "ability-unit" } } as never))
      .toContain("is able to embark within");
    expect(describeCondition({ type: "eligible", parameters: { subject: "this-unit", to: "embark-within", transport: "ability-unit" } } as never))
      .toBe("the unit is able to embark within this unit");
  });

  it("negates it with the not operator", () => {
    const condition = { operator: "not", operands: [{ type: "eligible", parameters: { subject: "this-unit", to: "embark-within", transport: "this-unit" } }] };
    expect(describeCondition(condition as never)).toContain("is not able to embark within");
  });
});

describe("Round 5C transport eligibility: the DSL condition schema", () => {
  const conditionOk = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/condition.schema.json")!;
  const eligible = (parameters: Record<string, unknown>) => ({ type: "eligible", parameters });

  it("requires transport for embark-within and forbids it for other values", () => {
    expect(conditionOk(eligible({ subject: "this-unit", to: "embark-within", transport: "ability-unit" }))).toBe(true);
    expect(conditionOk(eligible({ subject: "this-unit", to: "embark-within" }))).toBe(false);
    expect(conditionOk(eligible({ subject: "this-unit", to: "fight", transport: "this-unit" }))).toBe(false);
    expect(conditionOk(eligible({ subject: "this-unit", to: "fight" }))).toBe(true);
  });
});
