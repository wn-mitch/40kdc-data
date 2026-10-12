import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

// Fabricated wording only. The compiler reads the punctuation and joining words between leaves,
// so each shape keeps the structure of a record with invented words.

type Piece = [wording: string, family: string, parameters: Record<string, unknown>];

/** Leaves at the byte offsets of their wording in `text`, in order. */
function placed(text: string, pieces: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return pieces.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function mechanicsOf(text: string, pieces: Piece[]): Record<string, any> {
  const result = compileLeaves(placed(text, pieces), text);
  if (!result.ok) throw new Error(`expected a compiled record, got: ${result.errors.join(" | ")}`);
  return result.mechanics;
}

function errorsOf(text: string, pieces: Piece[]): string[] {
  const result = compileLeaves(placed(text, pieces), text);
  return result.ok ? [] : result.errors;
}

const stat = (characteristic: string, value: number): Record<string, unknown> => ({ subject: "this-unit", characteristics: [characteristic], operation: "add", value });
const keyword = (word: string, subject = "this-unit"): Record<string, unknown> => ({ keywords: [word], subject, negated: false });
const hasKeyword = (word: string) => ({ type: "has-keyword", parameters: { all_of: [word] } });
const notShocked = { operator: "not", operands: [{ type: "unit-state", parameters: { state: "battle-shocked" } }] };
const shockedState: Record<string, unknown> = { states: ["battle-shocked"], subject: "this-unit", negated: true };

describe("an If-led sentence gates its own sentence only (compile-instead-scope.ts sentenceIfGates)", () => {
  it("scopes each If-led list item's condition to its own item", () => {
    const text = "While this unit is calm: If this unit has KEYA, this unit has +1 OC. If this unit has KEYB, this unit has +3 OC.";
    const mechanics = mechanicsOf(text, [
      ["While this unit is calm", "unit-state", shockedState],
      ["If this unit has KEYA", "unit-keyword", keyword("KEYA")],
      ["this unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
      ["If this unit has KEYB", "unit-keyword", keyword("KEYB")],
      ["this unit has +3 OC", "characteristic-modifier", stat("OC", 3)],
    ]);
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: notShocked, effect: { type: "sequence", steps: [
      { type: "conditional", condition: hasKeyword("KEYA"), effect: { type: "stat-modifier", modifier: { value: 1 } } },
      { type: "conditional", condition: hasKeyword("KEYB"), effect: { type: "stat-modifier", modifier: { value: 3 } } },
    ] } });
  });

  it("stops an If-led condition at its sentence when a later sentence opens a moment", () => {
    const text = "At the start of the phase. If it is a KEYA unit, it has +1 OC. When this unit is set up, if it is a KEYB unit it has +2 OC.";
    const mechanics = mechanicsOf(text, [
      ["At the start of the phase", "event", { kind: "phase-start", phase: "any" }],
      ["If it is a KEYA unit", "unit-keyword", keyword("KEYA", "antecedent")],
      ["it has +1 OC", "characteristic-modifier", stat("OC", 1)],
      ["When this unit is set up", "event", { kind: "set-up" }],
      ["if it is a KEYB unit", "unit-keyword", keyword("KEYB", "antecedent")],
      ["it has +2 OC", "characteristic-modifier", stat("OC", 2)],
    ]);
    const steps = mechanics.effect.steps as Array<Record<string, any>>;
    expect(steps[0]).toMatchObject({ type: "ability-part", effect: { type: "conditional", condition: hasKeyword("KEYA") } });
    expect(steps[1]).toMatchObject({ type: "ability-part", trigger: { event: "set-up" }, effect: { type: "conditional", condition: hasKeyword("KEYB") } });
  });

  it("keeps the ability-wide gate when the next sentence only continues the first", () => {
    const text = "If this unit has KEYA, this unit has +1 OC. This unit has +3 M.";
    const mechanics = mechanicsOf(text, [
      ["If this unit has KEYA", "unit-keyword", keyword("KEYA")],
      ["this unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
      ["This unit has +3 M", "characteristic-modifier", stat("M", 3)],
    ]);
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: hasKeyword("KEYA"), effect: { type: "sequence" } });
  });

  it("keeps the gate on a colon-introduced list", () => {
    const text = "If this unit has KEYA, this unit gets these:\n■ If this unit has KEYB, this unit has +1 OC.";
    const mechanics = mechanicsOf(text, [
      ["If this unit has KEYA", "unit-keyword", keyword("KEYA")],
      ["this unit gets these", "characteristic-modifier", stat("OC", 2)],
      ["If this unit has KEYB", "unit-keyword", keyword("KEYB")],
      ["this unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
    ]);
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: hasKeyword("KEYA") });
  });
});

describe("a roll's pre-roll conditions gate every result band (compile-roll-gates.ts)", () => {
  const rolled: Piece[] = [
    ["This unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
    ["If this unit has KEYA", "unit-keyword", keyword("KEYA")],
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["On a 1-4", "roll-result", { from: 1, to: 4 }],
    ["this unit has -2 M", "characteristic-modifier", { ...stat("M", 2), operation: "subtract" }],
    ["On a 5-6", "roll-result", { from: 5, to: 6 }],
    ["this unit has -3 M", "characteristic-modifier", { ...stat("M", 3), operation: "subtract" }],
  ];
  const outcomes = (text: string, pieces: Piece[]) => mechanicsOf(text, pieces).effect.steps[1].outcomes as Array<Record<string, any>>;

  it("gates the band after a full stop by the conditions before the roll", () => {
    const text = "This unit has +1 OC. If this unit has KEYA, roll one D6: On a 1-4, this unit has -2 M. On a 5-6, this unit has -3 M.";
    const [low, high] = outcomes(text, rolled);
    expect(low!.effect).toMatchObject({ type: "conditional", condition: hasKeyword("KEYA") });
    expect(high!.effect).toMatchObject({ type: "conditional", condition: hasKeyword("KEYA"), effect: { type: "stat-modifier", modifier: { value: 3 } } });
  });

  it("leaves a condition printed after the roll with its own band", () => {
    const text = "This unit has +1 OC. Roll one D6: On a 1-4, if this unit has KEYB, this unit has -2 M. On a 5-6, this unit has -3 M.";
    const [low, high] = outcomes(text, [rolled[0]!, ["Roll one D6", "dice-roll", { dice: "D6" }], rolled[3]!, ["if this unit has KEYB", "unit-keyword", keyword("KEYB")], rolled[4]!, rolled[5]!, rolled[6]!]);
    expect(low!.effect).toMatchObject({ type: "conditional", condition: hasKeyword("KEYB") });
    expect(high!.effect).toMatchObject({ type: "stat-modifier", modifier: { value: 3 } });
  });

  it("does not carry a roll's conditions to the bands of a later roll", () => {
    const text = "This unit has +1 OC. If this unit has KEYA, roll one D6: On a 1-4, this unit has -2 M. When this unit is set up, roll one D6: On a 5-6, this unit has -3 M.";
    const result = mechanicsOf(text, [
      rolled[0]!, rolled[1]!, rolled[2]!, rolled[3]!, rolled[4]!,
      ["When this unit is set up", "event", { kind: "set-up" }],
      ["roll one D6", "dice-roll", { dice: "D6" }], rolled[5]!, rolled[6]!,
    ]);
    const later = JSON.stringify(result.effect.steps.at(-1));
    expect(later).toContain("-3".replace("-", "")); // the second roll's band compiled
    expect(later).not.toContain("KEYA");
  });
});

describe("a standing grant sentence is its own part (compile-segments.ts standingGrant)", () => {
  const text = "When a friendly KEYA unit is selected to move, that move does not stop that unit from charging. Friendly KEYA units have the following ability:\n**Zeal:** this unit has +1 OC.";
  const pieces: Piece[] = [
    ["friendly KEYA unit", "unit-filter", { side: "friendly", keywords: ["KEYA"] }],
    ["selected to move", "event", { kind: "selected", to: "move" }],
    ["that move does not stop that unit from charging", "eligibility-permission", { subject: "antecedent", activity: "declare-charge", allow: true }],
    ["Friendly KEYA units", "unit-filter", { side: "friendly", keywords: ["KEYA"] }],
    ["have the following ability", "ability-record-grant", { subject: "antecedent", printed: "one" }],
    ["Zeal", "granted-ability-name", { label: "Zeal" }],
    ["this unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
  ];

  it("keeps the grant out of the earlier sentence's moment", () => {
    const mechanics = mechanicsOf(text, pieces);
    expect(mechanics.trigger).toBeNull();
    expect(mechanics.effect.steps[0]).toMatchObject({ type: "ability-part", trigger: { event: "selected" }, effect: { type: "permission" } });
    expect(mechanics.effect.steps[1]).toMatchObject({ type: "ability-grant", target: { owner: "friendly", all_of: ["KEYA"] } });
    expect(mechanics.effect.steps[1].trigger).toBeUndefined();
  });

  it("leaves a grant with no earlier moment as the record's own", () => {
    const bare = "Friendly KEYA units have the following ability:\n**Zeal:** this unit has +1 OC.";
    const mechanics = mechanicsOf(bare, pieces.slice(3));
    expect(mechanics.effect).toMatchObject({ type: "ability-grant" });
  });
});

describe("an Or: choice between keyword grants keeps each option's own condition (compile-weapon-keywords.ts)", () => {
  const text = "This unit's attacks:Have [LETHAL HITS], if this unit is calm. Or: have [SUSTAINED HITS 1], if this unit is rattled.";
  const frame = { subject: "this-unit", weapon_type: "all" };
  const pieces: Piece[] = [
    ["This unit's attacks", "weapon-ability-grant", frame],
    ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
    ["if this unit is calm", "unit-state", { states: ["battle-shocked"], subject: "this-unit", negated: true }],
    ["Or", "instead", { choice: true }],
    ["have", "weapon-ability-grant", frame],
    ["SUSTAINED HITS 1", "weapon-ability-keyword", { keyword: "Sustained Hits 1" }],
    ["if this unit is rattled", "unit-state", { states: ["battle-shocked"], subject: "this-unit", negated: false }],
  ];
  const rattled = { type: "unit-state", parameters: { state: "battle-shocked" } };

  it("gates the first option by its own trailing condition and the second by its own", () => {
    const options = mechanicsOf(text, pieces).effect.options as Array<Record<string, any>>;
    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({ type: "conditional", condition: { operator: "not", operands: [rattled] }, effect: { modifier: { abilities: ["Lethal Hits"] } } });
    expect(options[1]).toMatchObject({ type: "conditional", condition: rattled, effect: { modifier: { abilities: ["Sustained Hits 1"] } } });
  });

  it("still refuses a keyword run with no frame to grant it", () => {
    const frameless = pieces.filter((piece) => piece[0] !== "have");
    expect(errorsOf(text, frameless)).toEqual(["A weapon-ability-keyword leaf has no weapon-ability-grant frame saying which weapons gain it."]);
  });
});

describe("a phase end after a destruction nests under it (compile-nested-moment.ts, compile-delayed-destruction.ts)", () => {
  const roll: Piece[] = [
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["on a 2+", "roll-result", { from: 2 }],
    ["set this model back up on the battlefield", "set-up", { subject: "this-model", to: "battlefield" }],
  ];
  const text = "The first time this model is destroyed, remove it from play. Then, at the end of the phase, roll one D6: on a 2+, set this model back up on the battlefield.";
  const head: Piece[] = [
    ["The first time", "usage-limit", { frequency: "first-this-battle", per: "model" }],
    ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
    ["remove it from play", "destroy-models", { recipient: "this-model", count: "1", remove_from_play: true }],
    ["at the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }],
    ...roll,
  ];

  it("nests the end of that phase in the destruction's part", () => {
    const mechanics = mechanicsOf(text, head);
    expect(mechanics.usage).toEqual({ frequency: "first-this-battle", per: "model" });
    expect(mechanics.effect).toMatchObject({ type: "ability-part", trigger: { event: "model-destroyed" }, effect: { type: "sequence", steps: [
      { type: "destroy-models" },
      { type: "ability-part", trigger: { event: "phase-ended" }, duration: "phase", effect: { type: "dice-gated" } },
    ] } });
  });

  it("refuses a first-time destruction with no usage limit", () => {
    const errors = errorsOf(text, head.filter((piece) => piece[1] !== "usage-limit"));
    expect(errors).toEqual(["A \"first time\" limit with no usage limit has no DSL form; the ability would fire on every destruction."]);
  });

  it("keeps a phase end that names its phase as a sibling part", () => {
    const named = text.replace("at the end of the phase", "at the end of your Fight phase");
    const pieces = head.map((piece): Piece => piece[0] === "at the end of the phase" ? ["at the end of your Fight phase", "event", { kind: "phase-end", phase: "fight", turn: "your" }] : piece);
    const steps = mechanicsOf(named, pieces).effect.steps as Array<Record<string, any>>;
    expect(steps.map((step) => step.trigger.event)).toEqual(["model-destroyed", "phase-ended"]);
  });

  it("nests a named model's destruction followed by the end of the phase in the same sentence", () => {
    const named = "The first time a model in this unit is destroyed, roll one D6 at the end of the phase. On a 2+, set this model back up on the battlefield.";
    const pieces: Piece[] = [
      ["The first time", "usage-limit", { frequency: "first-this-battle", per: "model" }],
      ["a model in this unit is destroyed", "event", { kind: "model-destroyed" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["at the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }],
      ["On a 2+", "roll-result", { from: 2 }],
      ["set this model back up on the battlefield", "set-up", { subject: "this-model", to: "battlefield" }],
    ];
    const mechanics = mechanicsOf(named, pieces);
    expect(mechanics.trigger).toMatchObject({ event: "model-destroyed" });
    expect(mechanics.effect).toMatchObject({ type: "ability-part", trigger: { event: "phase-ended" }, duration: "phase", effect: { type: "dice-gated" } });
  });

  it("still refuses a named model's repeated destruction followed by the end of the phase", () => {
    const named = "Each time a model in this unit is destroyed, roll one D6 at the end of the phase. On a 2+, set this model back up on the battlefield.";
    const errors = errorsOf(named, [
      ["a model in this unit is destroyed", "event", { kind: "model-destroyed" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["at the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }],
      ["On a 2+", "roll-result", { from: 2 }],
      ["set this model back up on the battlefield", "set-up", { subject: "this-model", to: "battlefield" }],
    ]);
    expect(errors.join(" ")).toContain("has no DSL form");
  });
});
