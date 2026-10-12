import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
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

const TEXT = "In your Command phase, select one friendly ALPHA model. Each model can only be selected for this ability once per turn. The selected model adds 1 to its Hit roll.";
const SELECT: Item[] = [
  ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
  ["select one", "select-unit", { distance: "any", visible: false }],
  ["friendly ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
  ["The selected model adds 1 to its Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
];

/** The selection items with one usage placed where its sentence falls in TEXT. */
const withUsage = (usage: Item): Item[] => [SELECT[0]!, SELECT[1]!, SELECT[2]!, usage, SELECT[3]!];

function resultOf(items: Item[], text = TEXT, abilityId?: string) {
  return compileLeaves(placed(text, ...items), text, { abilityId });
}

/** The selection node in the compiled effect: the select-units whose selector targets a model. */
function selectorOf(mechanics: Record<string, any>): Record<string, any> {
  const find = (node: unknown): Record<string, any> | undefined => {
    if (node === null || typeof node !== "object") return undefined;
    if (Array.isArray(node)) return node.map(find).find((hit) => hit !== undefined);
    const record = node as Record<string, any>;
    if (record.type === "select-units") return record.selector;
    return Object.values(record).map(find).find((hit) => hit !== undefined);
  };
  const selector = find(mechanics.effect);
  if (selector === undefined) throw new Error("no select-units in the effect");
  return selector;
}

describe("Round 5C per-model usage as the selection's selection_limit", () => {
  it("lowers a once-per-turn per-model usage to selection_limit on the model selection", () => {
    const result = resultOf(withUsage(["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-turn", per: "model" }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mechanics = result.mechanics as unknown as Record<string, any>;
    expect(selectorOf(mechanics)).toMatchObject({ target_kind: "model", selection_limit: { count: 1, period: "turn" } });
    // The cap belongs to each selected model, not to the ability's usage.
    expect(mechanics.usage).toBeUndefined();
  });

  it("maps once-per-battle to a battle period of one", () => {
    const result = resultOf(withUsage(["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-battle", per: "model" }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(selectorOf(result.mechanics as unknown as Record<string, any>).selection_limit).toEqual({ count: 1, period: "battle" });
  });

  it("maps once-per-command-phase to a phase period when the window is the Command phase", () => {
    const result = resultOf(withUsage(["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-command-phase", per: "model" }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(selectorOf(result.mechanics as unknown as Record<string, any>).selection_limit).toEqual({ count: 1, period: "phase" });
  });

  it("refuses once-per-command-phase when the ability's window is another phase", () => {
    const result = resultOf([["In your Command phase", "phase-window", { phase: "shooting", turn: "your" }], ...withUsage(["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-command-phase", per: "model" }]).slice(1)]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/Command phase/u);
  });

  it("refuses a per-model frequency with no selection period", () => {
    const result = resultOf(withUsage(["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-opponent-turn", per: "model" }]));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/no selection period/u);
  });

  it("keeps a per-model usage as the ability's usage when no model is selected", () => {
    const text = "Select one friendly ALPHA unit. Each model can only be selected for this ability once per turn. It adds 1 to its Hit roll.";
    const result = resultOf([
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-turn", per: "model" }],
      ["It adds 1 to its Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ], text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.mechanics)).not.toContain("selection_limit");
    expect((result.mechanics as unknown as Record<string, any>).usage).toEqual({ frequency: "once-per-turn", per: "model" });
  });

  it("refuses two per-model usage limits on one model selection", () => {
    const text = "In your Command phase, select one friendly ALPHA model. Each model can only be selected once per turn. Each model can only be selected once per battle. The selected model adds 1 to its Hit roll.";
    const result = resultOf([
      ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["friendly ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["once per turn", "usage-limit", { frequency: "once-per-turn", per: "model" }],
      ["once per battle", "usage-limit", { frequency: "once-per-battle", per: "model" }],
      ["The selected model adds 1 to its Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ], text);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/More than one per-model usage limit/u);
  });

  it("keeps the refusal of a per-model usage-scope on a model selection", () => {
    const result = resultOf(withUsage(["Each model can only be selected for this ability once per turn", "usage-scope", { per: "model" }]));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/usage scope/u);
  });
});

const BEAST_MODEL = { side: "friendly", keywords: ["BEAST"], level: "model" };
const HIT_ROLL = ["The selected model adds 1 to its Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }] as Item;

describe("Round 5C model selection in the bearer's unit (membership@2)", () => {
  it("folds \"in your unit\" after a model unit-filter into the bearer's unit eligibility", () => {
    const text = "Select one BEAST model in your unit. The selected model adds 1 to its Hit roll.";
    const result = resultOf([
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["BEAST model", "unit-filter", BEAST_MODEL],
      ["in your unit", "membership", { relation: "in", of: "this-unit" }],
      HIT_ROLL,
    ], text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(selectorOf(result.mechanics as unknown as Record<string, any>)).toMatchObject({
      target_kind: "model", keywords: ["BEAST"],
      eligibility: { type: "same-unit", parameters: { as: "ability-unit" } },
    });
  });

  it("folds a Stratagem's \"in your unit\" as the same unit as the Stratagem's target", () => {
    const text = "Fight phase. One friendly ALPHA unit. Select one friendly BEAST model in your unit. The selected model adds 1 to its Hit roll.";
    const result = resultOf([
      ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }],
      ["One", "stratagem-target", { count: "one" }],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["BEAST model", "unit-filter", BEAST_MODEL],
      ["in your unit", "membership", { relation: "in", of: "stratagem-target" }],
      HIT_ROLL,
    ], text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.mechanics)).toContain('"as":"stratagem-target"');
    expect(selectorOf(result.mechanics as unknown as Record<string, any>).eligibility).toEqual({ type: "same-unit", parameters: { as: "stratagem-target" } });
  });

  it("refuses this-unit on a Stratagem, which has no bearer", () => {
    const text = "Fight phase. One friendly ALPHA unit. Select one friendly BEAST model in your unit. The selected model adds 1 to its Hit roll.";
    const result = resultOf([
      ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }],
      ["One", "stratagem-target", { count: "one" }],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["BEAST model", "unit-filter", BEAST_MODEL],
      ["in your unit", "membership", { relation: "in", of: "this-unit" }],
      HIT_ROLL,
    ], text);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/no bearer/u);
  });

  it("refuses the Stratagem target as an ability's membership", () => {
    const text = "Select one BEAST model in your unit. The selected model adds 1 to its Hit roll.";
    const result = resultOf([
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["BEAST model", "unit-filter", BEAST_MODEL],
      ["in your unit", "membership", { relation: "in", of: "stratagem-target" }],
      HIT_ROLL,
    ], text);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/names this unit/u);
  });

  it("refuses a selected model's membership other than in its unit", () => {
    const text = "Select one BEAST model embarked within your unit. The selected model adds 1 to its Hit roll.";
    const result = resultOf([
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["BEAST model", "unit-filter", BEAST_MODEL],
      ["embarked within your unit", "membership", { relation: "embarked-in", of: "this-unit" }],
      HIT_ROLL,
    ], text);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/only being a model of its unit/u);
  });

  it("accepts stratagem-target only in membership version 2", () => {
    expect(currentFamilyVersion("membership")).toBe(3);
    // Version 3 (family-extensions-16-model-keyword-scope.ts) adds antecedent; version 2 still refuses it.
    expect(() => normalizeFingerprintParameters("membership", { relation: "in", of: "antecedent" }, 2)).toThrow();
    expect(normalizeFingerprintParameters("membership", { relation: "in", of: "antecedent" }, 3)).toEqual({ relation: "in", of: "antecedent" });
    expect(normalizeFingerprintParameters("membership", { relation: "in", of: "stratagem-target" }, 2)).toEqual({ relation: "in", of: "stratagem-target" });
    expect(() => normalizeFingerprintParameters("membership", { relation: "in", of: "stratagem-target" }, 1)).toThrow();
    expect(() => normalizeFingerprintParameters("membership", { relation: "embarked-in", of: "stratagem-target" }, 2)).toThrow(/relation in/u);
    expect(normalizeFingerprintParameters("membership", { relation: "in", of: "this-unit" }, 2)).toEqual({ relation: "in", of: "this-unit" });
  });
});

// The bearer ability ids are real record ids: a one-model Knights enhancement, and a multi-model unit's ability.
const ONE_MODEL_BEARER = "bearer-of-the-evanescent-ion-valourstrike-lance-imperial-knights";
const MULTI_MODEL_BEARER = "sworn-protectors-adepta-sororitas";

describe("Round 5C other-model selection on a one-model bearer", () => {
  const text = "Select one other IMPERIAL KNIGHTS model in your army. The selected model adds 1 to its Hit roll.";
  const items: Item[] = [
    ["Select one", "select-unit", { distance: "any", visible: false }],
    ["other IMPERIAL KNIGHTS model in your army", "unit-filter", { side: "friendly", keywords: ["IMPERIAL KNIGHTS"], other: true, level: "model" }],
    HIT_ROLL,
  ];

  it("excludes only the bearer's unit when the bearer is one model", () => {
    const result = resultOf(items, text, ONE_MODEL_BEARER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(selectorOf(result.mechanics as unknown as Record<string, any>)).toMatchObject({
      target_kind: "model", keywords: ["IMPERIAL KNIGHTS"],
      eligibility: { operator: "not", operands: [{ type: "same-unit", parameters: { as: "ability-unit" } }] },
    });
  });

  it("refuses when the bearer's unit can have several models", () => {
    const result = resultOf(items, text, MULTI_MODEL_BEARER);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/one model/u);
  });

  it("refuses when no bearer's unit size is known", () => {
    const result = resultOf(items, text, "no-such-ability");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/one model/u);
    expect(!resultOf(items, text).ok).toBe(true);
  });
});

describe("Round 5C model selection with an attack gate", () => {
  it("refuses an attack made by the selected model, whose gate would otherwise be dropped", () => {
    const text = "Select one friendly ALPHA model. Each model can only be selected for this ability once per turn. Each time that ALPHA model makes an attack, add 1 to the Hit roll.";
    const result = resultOf([
      ["Select one friendly", "select-unit", { distance: "any", visible: false }],
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-turn", per: "model" }],
      ["Each time that ALPHA model makes an attack", "attack", { direction: "makes", unit: "this-model", attack_type: "any" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ], text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("attack gate");
  });
});

describe("Round 5C per-model cap in a compound ability", () => {
  it("refuses a per-model cap when a later part follows the model selection", () => {
    const text = "In your Command phase, select one friendly ALPHA model. Each model can only be selected once per Command phase. The selected model regains D3 wounds. When it attacks, add 1 to the Hit roll.";
    const result = resultOf([
      ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["friendly ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["Each model can only be selected once per Command phase", "usage-limit", { frequency: "once-per-command-phase", per: "model" }],
      ["The selected model regains D3 wounds", "regain-wounds", { subject: "selected-unit", amount: "D3" }],
      ["When it attacks", "event", { kind: "attacks-resolved", action_kind: "attack", subject: "antecedent" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ], text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("no decided reading yet");
  });
});

