import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";

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

function compile(text: string, pieces: Piece[]) {
  return compileLeaves(placed(text, pieces), text);
}

function mechanicsOf(text: string, pieces: Piece[]): Record<string, any> {
  const result = compile(text, pieces);
  if (!result.ok) throw new Error(`expected a compiled record, got: ${result.errors.join(" | ")}`);
  return result.mechanics;
}

function errorsOf(text: string, pieces: Piece[]): string[] {
  const result = compile(text, pieces);
  return result.ok ? [] : result.errors;
}

const stat = (characteristic: string, value: number): Record<string, unknown> => ({ subject: "this-unit", characteristics: [characteristic], operation: "add", value });
const keyword = (word: string, negated = false): Record<string, unknown> => ({ keywords: [word], subject: "this-unit", negated });
const KEYWORD_NODE = (word: string) => ({ type: "matches", parameters: { filter: { all_of: [word] } } });

describe("a restoration instead replaces a restoration effect of the other family (compile.ts, SS-1)", () => {
  const text = "Recover up to 3 lost wounds to one model or, if it is a DAEMONETTES unit, return up to D3+3 destroyed models instead.";
  const pieces: Piece[] = [
    ["Recover up to 3 lost wounds to one model", "regain-wounds", { subject: "this-unit", amount: "3", per: "model" }],
    ["if it is a DAEMONETTES unit", "unit-keyword", keyword("DAEMONETTES")],
    ["return up to D3+3 destroyed models", "return-models", { subject: "this-unit", count: "D3+3" }],
    ["instead", "instead", {}],
  ];

  it("gates the regain not the keyword and the return on it", () => {
    const daemonettes = KEYWORD_NODE("DAEMONETTES");
    const mechanics = mechanicsOf(text, pieces);
    expect(mechanics.effect).toMatchObject({ type: "sequence", steps: [
      { condition: { operator: "not", operands: [daemonettes] }, effect: { type: "heal" } },
      { condition: daemonettes, effect: { type: "return-models" } },
    ] });
  });

  it("refuses a restoration replacement with no condition in its clause", () => {
    // Separate sentences: a same-sentence instead with no condition is caught by the group path first.
    const bare = "Recover up to 3 lost wounds to one model. Return up to D3+3 destroyed models instead.";
    const unconditional: Piece[] = [pieces[0]!, ["Return up to D3+3 destroyed models", "return-models", { subject: "this-unit", count: "D3+3" }], pieces[3]!];
    expect(errorsOf(bare, unconditional)).toContain('"Instead" needs a condition in its clause saying when return-models is replaced.');
  });

  it("refuses two restoration candidates in one sentence rather than binding one silently", () => {
    const two = "Recover 2 lost wounds to one model and 3 lost wounds to another or, if it is a DAEMONETTES unit, return 3 models instead.";
    const errors = errorsOf(two, [
      ["Recover 2 lost wounds to one model", "regain-wounds", { subject: "this-unit", amount: "2", per: "model" }],
      ["3 lost wounds to another", "regain-wounds", { subject: "this-unit", amount: "3", per: "model" }],
      ["if it is a DAEMONETTES unit", "unit-keyword", keyword("DAEMONETTES")],
      ["return 3 models", "return-models", { subject: "this-unit", count: "3" }],
      ["instead", "instead", {}],
    ]);
    expect(errors).toContain('"Instead" cannot tell which of 2 earlier effects it replaces.');
  });

  it("keeps the refusal when the other family is not a restoration pair", () => {
    const statText = "Add 1 to Move or, if it is a DAEMONETTES unit, return up to D3 destroyed models instead.";
    const errors = errorsOf(statText, [
      ["Add 1 to Move", "characteristic-modifier", stat("M", 1)],
      ["if it is a DAEMONETTES unit", "unit-keyword", keyword("DAEMONETTES")],
      ["return up to D3 destroyed models", "return-models", { subject: "this-unit", count: "D3" }],
      ["instead", "instead", {}],
    ]);
    expect(errors).toEqual(['"Instead" has no earlier return-models effect to replace.']);
  });
});

describe("a restoration instead in a later sentence replaces the default sentence before it (compile.ts, SS-2)", () => {
  it("gates the default return not the keyword and the regain on it", () => {
    const text = "Return up to 1 destroyed model to your unit. If your unit is a MONSTER unit, one model regains up to D3+1 lost wounds instead.";
    const mechanics = mechanicsOf(text, [
      ["Return up to 1 destroyed model to your unit", "return-models", { subject: "this-unit", count: "1" }],
      ["If your unit is a MONSTER unit", "unit-keyword", keyword("MONSTER")],
      ["one model regains up to D3+1 lost wounds", "regain-wounds", { subject: "this-unit", amount: "D3+1", per: "model" }],
      ["instead", "instead", {}],
    ]);
    const monster = KEYWORD_NODE("MONSTER");
    expect(mechanics.effect).toMatchObject({ type: "sequence", steps: [
      { condition: { operator: "not", operands: [monster] }, effect: { type: "return-models" } },
      { condition: monster, effect: { type: "heal" } },
    ] });
  });

  it("also gates the battleline alternative of the default sentence, so a monster never returns models", () => {
    const text = "Return up to 1 destroyed model to your unit or up to D3 destroyed models instead if your unit is a BATTLELINE unit. If your unit is a MONSTER unit, one model regains up to D3+1 lost wounds instead.";
    const mechanics = mechanicsOf(text, [
      ["Return up to 1 destroyed model to your unit", "return-models", { subject: "this-unit", count: "1" }],
      ["up to D3 destroyed models", "return-models", { subject: "this-unit", count: "D3" }],
      ["instead if", "instead", {}],
      ["BATTLELINE unit", "unit-keyword", keyword("BATTLELINE")],
      ["If your unit is a MONSTER unit", "unit-keyword", keyword("MONSTER")],
      ["one model regains up to D3+1 lost wounds", "regain-wounds", { subject: "this-unit", amount: "D3+1", per: "model" }],
      ["instead.", "instead", {}],
    ]);
    const battleline = KEYWORD_NODE("BATTLELINE");
    const monster = KEYWORD_NODE("MONSTER");
    const notMonster = { operator: "not", operands: [monster] };
    expect(mechanics.effect).toMatchObject({ type: "sequence", steps: [
      { condition: { operator: "and", operands: [{ operator: "not", operands: [battleline] }, notMonster] }, effect: { type: "return-models" } },
      { condition: { operator: "and", operands: [battleline, notMonster] }, effect: { type: "return-models" } },
      { condition: monster, effect: { type: "heal" } },
    ] });
  });

  it("does not reach a restoration effect two sentences back", () => {
    const text = "Return up to 1 destroyed model to your unit. Add 1 to Move. If your unit is a MONSTER unit, one model regains up to D3+1 lost wounds instead.";
    const errors = errorsOf(text, [
      ["Return up to 1 destroyed model to your unit", "return-models", { subject: "this-unit", count: "1" }],
      ["Add 1 to Move", "characteristic-modifier", stat("M", 1)],
      ["If your unit is a MONSTER unit", "unit-keyword", keyword("MONSTER")],
      ["one model regains up to D3+1 lost wounds", "regain-wounds", { subject: "this-unit", amount: "D3+1", per: "model" }],
      ["instead", "instead", {}],
    ]);
    expect(errors).toEqual(['"Instead" has no earlier regain-wounds effect to replace.']);
  });
});

describe("a returned-model exclusion after a replacement instead binds the replacement (compile-returned-model-exclusions.ts, SS-3)", () => {
  const exclusion: Piece = ["(excluding CHARACTER models)", "returned-model-exclusion", { keywords: ["CHARACTER"] }];
  const battlelineText = "Return up to 1 destroyed model to your unit or up to D3 destroyed models instead (excluding CHARACTER models) if your unit is a BATTLELINE unit.";
  const battlelinePieces: Piece[] = [
    ["Return up to 1 destroyed model to your unit", "return-models", { subject: "this-unit", count: "1" }],
    ["up to D3 destroyed models", "return-models", { subject: "this-unit", count: "D3" }],
    ["instead", "instead", {}],
    exclusion,
    ["BATTLELINE unit", "unit-keyword", keyword("BATTLELINE")],
  ];

  it("excludes CHARACTER models from the replacement only", () => {
    const mechanics = mechanicsOf(battlelineText, battlelinePieces);
    const battleline = KEYWORD_NODE("BATTLELINE");
    const steps = mechanics.effect.steps as Array<{ condition: unknown; effect: { target: unknown } }>;
    expect(steps).toHaveLength(2);
    expect(steps[0]!.condition).toEqual({ operator: "not", operands: [battleline] });
    expect(steps[0]!.effect.target).toBe("this-unit");
    expect(steps[1]!.condition).toEqual(battleline);
    expect(steps[1]!.effect.target).toEqual({ level: "model", member_of: "this-unit", none_of: ["CHARACTER"] });
  });

  it("refuses a trailing exclusion with no restoration effect of its own", () => {
    const text = "Gain 1 CP instead (excluding CHARACTER models).";
    expect(errorsOf(text, [
      ["Gain 1 CP", "characteristic-modifier", stat("M", 1)],
      ["instead", "instead", {}],
      exclusion,
    ])).toEqual(["A returned-model exclusion needs a restoration effect in its own clause."]);
  });

  it("does not skip an instead whose own gap is a clause boundary", () => {
    const text = "Return up to 1 destroyed model to your unit instead; (excluding CHARACTER models).";
    expect(errorsOf(text, [
      ["Return up to 1 destroyed model to your unit", "return-models", { subject: "this-unit", count: "1" }],
      ["instead", "instead", {}],
      exclusion,
    ])).toEqual(["A returned-model exclusion needs a restoration effect in its own clause."]);
  });

  it("stops at a clause boundary between the return and the instead", () => {
    const text = "Return up to 1 destroyed model to your unit; instead (excluding CHARACTER models).";
    expect(errorsOf(text, [
      ["Return up to 1 destroyed model to your unit", "return-models", { subject: "this-unit", count: "1" }],
      ["instead", "instead", {}],
      exclusion,
    ])).toEqual(["A returned-model exclusion needs a restoration effect in its own clause."]);
  });

  it("stops at the first effect it meets, which is not a return", () => {
    const text = "Return up to 1 destroyed model to your unit then add 1 to Move instead (excluding CHARACTER models).";
    expect(errorsOf(text, [
      ["Return up to 1 destroyed model to your unit", "return-models", { subject: "this-unit", count: "1" }],
      ["add 1 to Move", "characteristic-modifier", stat("M", 1)],
      ["instead", "instead", {}],
      exclusion,
    ])).toEqual(["A returned-model exclusion needs a restoration effect in its own clause."]);
  });

  it("does not pass over a choice instead", () => {
    const text = "Return up to 1 destroyed model to your unit or up to D3 destroyed models instead (excluding CHARACTER models).";
    const errors = errorsOf(text, [
      ["Return up to 1 destroyed model to your unit", "return-models", { subject: "this-unit", count: "1" }],
      ["up to D3 destroyed models", "return-models", { subject: "this-unit", count: "D3" }],
      ["instead", "instead", { choice: true }],
      exclusion,
    ]);
    expect(errors).toEqual(["A returned-model exclusion needs a restoration effect in its own clause."]);
  });
});
