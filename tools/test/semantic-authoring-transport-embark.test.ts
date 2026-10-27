import { describe, expect, it } from "vitest";
import { createValidator } from "../src/schema-loader.js";
import { refuseDestinationMismatch } from "../src/semantic-authoring/compile-transport-embark.js";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { extensionVersionPairs } from "../src/semantic-authoring/families/index.js";
import { describeCondition } from "../src/translate/index.js";

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

// semantic-authoring-transport-embark
{
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

describe("Semantic authoring transport eligibility: the eligible parameters", () => {
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

describe("Semantic authoring transport eligibility: compiling the Transport target", () => {
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

  it("refuses embark-within on the outer unit of a bound selection pair, before the inner select", () => {
    // An embark eligibility that is not a candidate of the inner selection has no reading (compile-pair-eligibility.ts).
    const text = "Select one friendly ALPHA unit that it is able to embark within. Select one friendly TRANSPORT within 6\" of that unit. That unit suffers 1 mortal wound.";
    const items: Item[] = [
      ["Select one friendly", "select-unit", { distance: "any", visible: false, bind_as: "first" }, "EFFECT"],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "EFFECT"],
      ["that it is able to embark within", "eligible", { subject: "antecedent", to: "embark-within", transport: "this-unit" }, "EFFECT"],
      ["Select one friendly", "select-unit", { distance: "within", inches: 6, visible: false, within_of: "first" }, "EFFECT"],
      ["TRANSPORT", "unit-filter", { side: "friendly", keywords: ["TRANSPORT"] }, "EFFECT"],
      ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }, "EFFECT"],
    ];
    expect(refused(text, ...items)).toMatch(/not bound with it yet/u);
  });
});

describe("Semantic authoring transport eligibility: a unit selected to embark within the ability's own unit", () => {
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

describe("Semantic authoring transport eligibility: describing the predicate", () => {
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

describe("Semantic authoring transport eligibility: the DSL condition schema", () => {
  const conditionOk = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/condition.schema.json")!;
  const eligible = (parameters: Record<string, unknown>) => ({ type: "eligible", parameters });

  it("requires transport for embark-within and forbids it for other values", () => {
    expect(conditionOk(eligible({ subject: "this-unit", to: "embark-within", transport: "ability-unit" }))).toBe(true);
    expect(conditionOk(eligible({ subject: "this-unit", to: "embark-within" }))).toBe(false);
    expect(conditionOk(eligible({ subject: "this-unit", to: "fight", transport: "this-unit" }))).toBe(false);
    expect(conditionOk(eligible({ subject: "this-unit", to: "fight" }))).toBe(true);
  });
});
}

// semantic-authoring-transport-embark-followup
{
/** The compiled mechanics as JSON text. */
function compiled(text: string, ...items: Item[]): string {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return JSON.stringify(result.mechanics);
}

/** Every permission node in a compiled tree, as its target and modifier. */
function permissions(json: string): Array<{ target: unknown; modifier: Record<string, unknown> }> {
  const found: Array<{ target: unknown; modifier: Record<string, unknown> }> = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.type === "permission") found.push({ target: record.target, modifier: record.modifier as Record<string, unknown> });
    Object.values(record).forEach(walk);
  };
  walk(JSON.parse(json));
  return found;
}

const WINDOW: Item = ["Fight phase", "phase-window", { phase: "fight", turn: "either" }, "WHEN"];
const DURATION: Item = ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }, "EFFECT"];
const TEXT = "Fight phase. One ALPHA unit, and one friendly TRANSPORT that it is able to embark within. Until the end of the turn, one friendly ALPHA unit can embark within it.";
/** Two targets: an ALPHA unit, and a friendly TRANSPORT the ALPHA unit is able to embark within. */
const TWO_TARGETS: Item[] = [
  WINDOW,
  ["One", "stratagem-target", { count: "one" }, "TARGET"],
  ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
  ["one", "stratagem-target", { count: "one" }, "TARGET"],
  ["friendly TRANSPORT", "unit-filter", { side: "friendly", keywords: ["TRANSPORT"] }, "TARGET"],
  ["that it is able to embark within", "eligible", { subject: "antecedent", to: "embark-within", transport: "this-unit" }, "TARGET"],
  DURATION,
  ["one friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"], among: "stratagem-targets", targets: "one" }, "EFFECT"],
];

describe("Semantic authoring embark destination: the eligibility-permission into parameter", () => {
  it("accepts into only with activity embark, and only its four values", () => {
    const base = { subject: "this-unit", activity: "embark", allow: true };
    expect(normalizeFingerprintParameters("eligibility-permission", { ...base, into: "this-unit" }, currentFamilyVersion("eligibility-permission")))
      .toEqual({ ...base, into: "this-unit" });
    expect(() => normalizeFingerprintParameters("eligibility-permission", { subject: "this-unit", activity: "shoot", allow: true, into: "this-unit" }, currentFamilyVersion("eligibility-permission")))
      .toThrow(/applies only to activity: embark/u);
    expect(() => normalizeFingerprintParameters("eligibility-permission", { ...base, into: "selected-unit" }, currentFamilyVersion("eligibility-permission")))
      .toThrow(/eligibility-permission.into must be one of/u);
  });

  it("leaves every permission the previous version accepted as it was", () => {
    const current = currentFamilyVersion("eligibility-permission");
    const previous = [
      { subject: "this-unit", activity: "embark", allow: true },
      { subject: "this-model", activity: "shoot", allow: false, despite: ["engaged"] },
      { subject: "this-unit", activity: "embark", allow: true, engaged_with_move_end: true, despite: ["engaged"] },
    ];
    for (const params of previous) {
      expect(normalizeFingerprintParameters("eligibility-permission", params, current))
        .toEqual(normalizeFingerprintParameters("eligibility-permission", params, current - 1));
    }
  });
});

describe("Semantic authoring embark destination: an embark permission with a destination", () => {
  it("binds the subject to the first target and the destination to the Transport target", () => {
    const [permission] = permissions(compiled(TEXT, ...TWO_TARGETS.slice(0, 6), DURATION, ["can embark within it", "eligibility-permission", { subject: "antecedent", activity: "embark", allow: true, into: "antecedent" }, "EFFECT"]));
    expect(permission!.target).toEqual({ stratagem_target: "first" });
    expect(permission!.modifier.into).toEqual({ stratagem_target: "second" });
  });

  it("refuses a single-target embark whose destination is the embarking unit itself", () => {
    const text = "Fight phase. One friendly ALPHA unit. Until the end of the turn, it can embark within it.";
    const items: Item[] = [
      WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      DURATION,
      ["it can embark within it", "eligibility-permission", { subject: "antecedent", activity: "embark", allow: true, into: "antecedent" }, "EFFECT"],
    ];
    expect(refused(text, ...items)).toMatch(/embarking unit itself|names no Transport|antecedent/u);
  });

  it("places the subject within the unit-filter that follows the permission, which the fold consumes", () => {
    const text = "Your model can embark within an ASTRA MILITARUM TRANSPORT model.";
    const items: Item[] = [
      ["can embark within an", "eligibility-permission", { subject: "this-unit", activity: "embark", allow: true, into: "following-filter" }, "EFFECT"],
      ["ASTRA MILITARUM TRANSPORT model", "unit-filter", { side: "friendly", keywords: ["ASTRA MILITARUM", "TRANSPORT"], level: "model" }, "EFFECT"],
    ];
    const [permission] = permissions(compiled(text, ...items));
    expect(JSON.stringify(permission!.modifier.into)).toContain("TRANSPORT");
    expect(permission!.target).toBe("this-unit");
  });

  it("refuses a following-filter destination when no unit-filter follows the permission", () => {
    const items: Item[] = [
      ["can embark within a TRANSPORT", "eligibility-permission", { subject: "this-unit", activity: "embark", allow: true, into: "following-filter" }, "EFFECT"],
    ];
    expect(refused("Your model can embark within a TRANSPORT.", ...items)).toMatch(/none follows in its clause/u);
  });
});

describe("Semantic authoring embark destination: the pairing of destination and eligibility", () => {
  // Two targets: the first is an ALPHA unit, the second a friendly TRANSPORT that the eligibility names as its candidate.
  const text = "One ALPHA unit, and one friendly TRANSPORT that it is able to embark within. Until the end of the turn, one ALPHA unit can embark within that TRANSPORT.";
  const eligible: Item = ["that it is able to embark within", "eligible", { subject: "stratagem-target:first", to: "embark-within", transport: "this-unit" }, "TARGET"];
  const targets: Item[] = [
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
    ["one", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly TRANSPORT", "unit-filter", { side: "friendly", keywords: ["TRANSPORT"] }, "TARGET"],
  ];
  const permission = (subject: string, into: string): Item => ["can embark within that TRANSPORT", "eligibility-permission", { subject, activity: "embark", allow: true, into }, "EFFECT"];
  const check = (...items: Item[]) => refuseDestinationMismatch(placed(text, ...items), text);

  it("accepts a destination in the group of the Transport the eligibility names", () => {
    expect(() => check(...targets, eligible, permission("stratagem-target:first", "stratagem-target:second"))).not.toThrow();
  });

  it("refuses a destination in another target than the eligibility's Transport", () => {
    expect(() => check(...targets, eligible, permission("stratagem-target:second", "stratagem-target:first"))).toThrow(/names a different Transport/u);
  });

  it("refuses a permission whose subject and destination are the same unit", () => {
    expect(() => check(...targets, eligible, permission("stratagem-target:second", "stratagem-target:second"))).toThrow(/embarking unit itself/u);
  });

  it("pairs this-unit with an ability-unit eligibility, and refuses it with a this-unit one", () => {
    const ownText = "Fight phase. This unit is able to embark within this unit, and can embark within this unit.";
    const own: Item = ["is able to embark within this unit", "eligible", { subject: "selected-unit", to: "embark-within", transport: "ability-unit" }, "EFFECT"];
    const ownPermission: Item = ["can embark within this unit", "eligibility-permission", { subject: "selected-unit", activity: "embark", allow: true, into: "this-unit" }, "EFFECT"];
    expect(() => refuseDestinationMismatch(placed(ownText, own, ownPermission), ownText)).not.toThrow();
    const wrong: Item = ["is able to embark within this unit", "eligible", { subject: "selected-unit", to: "embark-within", transport: "this-unit" }, "EFFECT"];
    expect(() => refuseDestinationMismatch(placed(ownText, wrong, ownPermission), ownText)).toThrow(/names this unit as its Transport/u);
  });

  it("leaves a permission with no embark-within eligibility to name its destination alone", () => {
    const soloText = "Fight phase. That unit can embark within this unit.";
    const solo: Item = ["can embark within this unit", "eligibility-permission", { subject: "selected-unit", activity: "embark", allow: true, into: "this-unit" }, "EFFECT"];
    expect(() => refuseDestinationMismatch(placed(soloText, solo), soloText)).not.toThrow();
  });
});

describe("Semantic authoring embark destination: an among-filter names the subject, the Transport stays the destination", () => {
  it("binds the subject to the unit the among-filter names and the destination to the Transport it measures to", () => {
    const text = "Fight phase. One ALPHA unit, and one friendly TRANSPORT that it is able to embark within. Until the end of the turn, one friendly ALPHA unit wholly within 6\" of that TRANSPORT can embark within it.";
    const items: Item[] = [
      ...TWO_TARGETS.slice(0, 6),
      DURATION,
      ["one friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"], among: "stratagem-targets", targets: "one" }, "EFFECT"],
      ["wholly within 6\" of", "unit-position", { kind: "within", inches: 6, of: "following-filter", subject: "antecedent", negated: false, wholly: true }, "EFFECT"],
      ["that TRANSPORT", "unit-filter", { side: "friendly", keywords: ["TRANSPORT"], among: "stratagem-targets", targets: "one" }, "EFFECT"],
      ["can embark within it", "eligibility-permission", { subject: "antecedent", activity: "embark", allow: true, into: "antecedent" }, "EFFECT"],
    ];
    const json = compiled(text, ...items);
    const [permission] = permissions(json);
    expect(permission!.target).toEqual({ stratagem_target: "first" });
    expect(permission!.modifier.into).toEqual({ stratagem_target: "second" });
  });
});

describe("Semantic authoring embark destination: a bound selection pair whose inner unit embarks within a Transport", () => {
  // Fabricated wording. The outer unit is selected first; the inner is a Transport the outer is measured to, which the outer is able to embark within.
  const text = "Select one friendly ALPHA unit within 9\" of the bearer. Select one friendly TRANSPORT wholly within 6\" of that unit that it is able to embark within. That ALPHA unit can embark within that TRANSPORT.";
  const outer: Item = ["Select one friendly", "select-unit", { distance: "within", inches: 9, visible: false, bind_as: "outer" }, "EFFECT"];
  const alpha: Item = ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "EFFECT"];
  const inner: Item = ["Select one friendly", "select-unit", { distance: "any", visible: false, within_of: "outer", bind_as: "inner" }, "EFFECT"];
  const transport: Item = ["TRANSPORT", "unit-filter", { side: "friendly", keywords: ["TRANSPORT"] }, "EFFECT"];
  const candidate: Item[] = [
    ["wholly within 6\" of that unit", "unit-position", { kind: "within", inches: 6, wholly: true, subject: "this-unit", of: "antecedent", negated: false }, "EFFECT"],
    ["that it is able to embark within", "eligible", { subject: "antecedent", to: "embark-within", transport: "this-unit" }, "EFFECT"],
  ];
  const permission = (subject: string, into: string): Item => ["That ALPHA unit can embark within that TRANSPORT", "eligibility-permission", { subject, activity: "embark", allow: true, into }, "EFFECT"];

  it("puts the candidate conditions on the inner selection, the 6\" once, and no distance on the inner select", () => {
    const json = compiled(text, outer, alpha, inner, transport, ...candidate, permission("antecedent", "selection"));
    const [outerSelect] = [JSON.parse(json).effect];
    const innerSelect = outerSelect.effect;
    expect(innerSelect.selector.eligibility.operands).toContainEqual({ type: "eligible", parameters: { subject: { selection_var: "outer" }, to: "embark-within", transport: "this-unit" } });
    expect(innerSelect.selector).not.toHaveProperty("within");
    expect(json.match(/"inches":6/gu)).toHaveLength(1);
  });

  it("binds the permission's subject to the outer unit and its destination to the inner Transport", () => {
    const [permissionNode] = permissions(compiled(text, outer, alpha, inner, transport, ...candidate, permission("antecedent", "selection")));
    expect(permissionNode!.target).toEqual({ selection_var: "outer" });
    expect(permissionNode!.modifier.into).toEqual({ selection_var: "inner" });
  });

  it("refuses an embark permission in the pair that names the bearer rather than the outer unit", () => {
    const bearer: Item = ["This unit can embark within that TRANSPORT", "eligibility-permission", { subject: "this-unit", activity: "embark", allow: true, into: "selection" }, "EFFECT"];
    const bearerText = text.replace("That ALPHA unit can embark within that TRANSPORT", "This unit can embark within that TRANSPORT");
    expect(refused(bearerText, outer, alpha, inner, transport, ...candidate, bearer)).toMatch(/not bound with it yet/u);
  });

  it("refuses into: selection when the inner selection has no name to refer to", () => {
    const unnamed: Item = ["Select one friendly", "select-unit", { distance: "any", visible: false, within_of: "outer" }, "EFFECT"];
    expect(refused(text, outer, alpha, unnamed, transport, ...candidate, permission("antecedent", "selection"))).toMatch(/needs the inner selection bound by a name/u);
  });

  it("refuses into: selection with no pair of selections to name", () => {
    expect(refused(text, outer, alpha, permission("antecedent", "selection"))).toMatch(/takes its destination from the inner selection of a bound pair/u);
  });
});

describe("Semantic authoring embark destination: a permission whose destination is this unit", () => {
  it("compiles the ability's own Transport as the destination of a selected unit", () => {
    const text = "Charge phase. Select one friendly ADEPTUS ASTARTES unit that is able to embark within this unit. That unit can embark within this unit.";
    const items: Item[] = [
      ["Select one friendly", "select-unit", { distance: "any", visible: false }, "EFFECT"],
      ["ADEPTUS ASTARTES unit", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES"] }, "EFFECT"],
      ["that is able to embark within this unit", "eligible", { subject: "selected-unit", to: "embark-within", transport: "ability-unit" }, "EFFECT"],
      ["That unit can embark within this unit", "eligibility-permission", { subject: "selected-unit", activity: "embark", allow: true, into: "this-unit" }, "EFFECT"],
    ];
    const [permissionNode] = permissions(compiled(text, ...items));
    expect(permissionNode!.modifier.into).toBe("this-unit");
  });
});

describe("Semantic authoring embark destination: transport capacity with a stray embark filter", () => {
  const text = "Movement phase. This model can embark within an ASTRA MILITARUM TRANSPORT model as if it were an INFANTRY model. If it does, it takes up the space of 7 models.";
  const capacity: Item = ["takes up the space of 7 models", "transport-capacity", { shape: "fixed-model-spaces", subject_kind: "single-model", spaces_per_model: 7, transport_eligibility_kind: "embark-as-keyword", transport_eligibility_keyword: "INFANTRY" }, "EFFECT"];
  const permission: Item = ["can embark within an", "eligibility-permission", { subject: "this-model", activity: "embark", allow: true, into: "following-filter" }, "EFFECT"];
  const filter: Item = ["ASTRA MILITARUM TRANSPORT model", "unit-filter", { side: "friendly", keywords: ["ASTRA MILITARUM", "TRANSPORT"], level: "model" }, "EFFECT"];

  it("compiles the qualifier with its INFANTRY keyword, and no separate unit-filter for it", () => {
    expect(compiled(text, permission, filter, capacity)).toContain("embark_as_keyword");
  });

  it("refuses a separate INFANTRY unit-filter inside the qualifier's span", () => {
    const stray: Item = ["as if it were an INFANTRY model", "unit-filter", { side: "friendly", keywords: ["INFANTRY"], level: "model" }, "EFFECT"];
    expect(refused(text, permission, filter, stray, capacity)).toMatch(/needs a select-unit or attack right before it/u);
  });
});

describe("Semantic authoring embark destination: the bound pair of the enhancement shape (8359 fabricated)", () => {
  // Fabricated wording with the record's shape: a once-per-turn enhancement, a unit hit by the attacks it is measured to, and the Transport it embarks within.
  const text = "Once per turn, in your opponent's Shooting phase, just after an enemy unit has shot, you can select one friendly ALPHA unit within 9\" of the bearer that was hit by one or more of those attacks, then select one friendly TRANSPORT wholly within 6\" of that unit that it is able to embark within. That ALPHA unit can embark within that TRANSPORT.";
  const items: Item[] = [
    ["Once", "usage-limit", { frequency: "once-per-turn" }, "WHEN"],
    ["per turn", "usage-scope", { per: "model" }, "WHEN"],
    ["in your opponent's Shooting phase", "phase-window", { phase: "shooting", turn: "opponent" }, "WHEN"],
    ["just after an enemy unit has shot", "event", { kind: "enemy-has-shot" }, "WHEN"],
    ["you can select one friendly", "select-unit", { distance: "within", inches: 9, visible: false, bind_as: "outer" }, "EFFECT"],
    ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "EFFECT"],
    ["that was hit by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }, "EFFECT"],
    ["then select one friendly", "select-unit", { distance: "any", visible: false, within_of: "outer", bind_as: "inner" }, "EFFECT"],
    ["TRANSPORT", "unit-filter", { side: "friendly", keywords: ["TRANSPORT"] }, "EFFECT"],
    ["wholly within 6\" of that unit", "unit-position", { kind: "within", inches: 6, wholly: true, subject: "this-unit", of: "antecedent", negated: false }, "EFFECT"],
    ["that it is able to embark within", "eligible", { subject: "antecedent", to: "embark-within", transport: "this-unit" }, "EFFECT"],
    ["That ALPHA unit can embark within that TRANSPORT", "eligibility-permission", { subject: "antecedent", activity: "embark", allow: true, into: "selection" }, "EFFECT"],
  ];

  it("compiles the outer gate, the inner candidates, and the permission between the two selections, once per model", () => {
    const json = compiled(text, ...items);
    const parsed = JSON.parse(json) as { usage: unknown; effect: { effect: { selector: { bind_as: string; eligibility: unknown }; effect: { selector: { bind_as: string; eligibility: { operands: unknown[] } }; effect: unknown } } } };
    expect(parsed.usage).toEqual({ frequency: "once-per-turn", per: "model" });
    expect(parsed.effect.effect.selector.bind_as).toBe("outer");
    expect(parsed.effect.effect.selector.eligibility).toBeDefined();
    expect(parsed.effect.effect.effect).toBeDefined();
    expect(parsed.effect.effect.effect).toMatchObject({ type: "select-units" });
    const [permissionNode] = permissions(json);
    expect(permissionNode!.target).toEqual({ selection_var: "outer" });
    expect(permissionNode!.modifier.into).toEqual({ selection_var: "inner" });
  });
});
}
