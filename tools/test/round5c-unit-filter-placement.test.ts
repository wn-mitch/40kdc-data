import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
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

const TEXT = "After a unit shoots, select one enemy Alpha or Beta unit hit by those attacks. Friendly Gamma units' ranged attacks that target that unit have +1 AP.";

/** A designated-unit ability whose selected unit's filter is `enemy`, with the bearer's attack aimed at that unit. */
function designated(filter: Record<string, unknown>, attack: Record<string, unknown> = { direction: "makes", unit: "friendly-unit", attack_type: "ranged", target: "that-unit" }) {
  return placed(TEXT,
    ["After a unit shoots", "event", { kind: "after-shooting" }],
    ["select one", "select-unit", { distance: "any", visible: false }],
    ["enemy Alpha or Beta unit", "unit-filter", { side: "enemy", ...filter }],
    ["hit by those attacks", "hit-by-attacks", { subject: "selected-unit" }],
    ["Friendly Gamma units'", "unit-filter", { side: "friendly", keywords: ["GAMMA"] }],
    ["ranged attacks that target that unit", "attack", attack],
    ["+1 AP", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1 }],
  );
}

function designateSelect(list: CompileLeaf[]): Record<string, any> {
  const result = compileLeaves(list, TEXT);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const effect = (result.mechanics as unknown as { effect: Record<string, any> }).effect;
  expect(effect.type).toBe("designate-target");
  return effect.select;
}

// Sub-shape F: a designated select takes its unit-filter's keywords, so the attacks aimed at the
// designated unit keep the restriction "enemy X unit" carries.
describe("Round 5C designate-target select keywords from a folded unit-filter", () => {
  it("maps an any-of filter to select keywords with keyword_match any", () => {
    const select = designateSelect(designated({ any_keywords: ["ALPHA", "BETA"] }));
    expect(select).toMatchObject({ scope: "enemy-unit", count: 1, keywords: ["ALPHA", "BETA"], keyword_match: "any" });
  });

  it("maps an all-of filter to select keywords with the default match", () => {
    const select = designateSelect(designated({ keywords: ["ALPHA"] }));
    expect(select.keywords).toEqual(["ALPHA"]);
    expect(select.keyword_match).toBeUndefined();
  });

  it("maps an exclusion to select excluded_keywords", () => {
    const select = designateSelect(designated({ keywords: ["ALPHA"], excluded_keywords: ["MONSTER"] }));
    expect(select).toMatchObject({ keywords: ["ALPHA"], excluded_keywords: ["MONSTER"] });
  });

  it("refuses an all-of and an any-of list on one filter, which one select field cannot hold", () => {
    const result = compileLeaves(designated({ keywords: ["ALPHA"], any_keywords: ["BETA", "GAMMA"] }), TEXT);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.join(" ")).toMatch(/one keyword list/);
  });

  it("refuses a filter field designate-target's select has no place for", () => {
    const result = compileLeaves(designated({ any_keywords: ["ALPHA", "BETA"], states: ["battle-shocked"] }), TEXT);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.join(" ")).toMatch(/cannot carry a unit-filter's .*states/);
  });

  it("refuses a selected unit with filter keywords whose bearer's attacks do not target it", () => {
    // Without "that unit" the filter would narrow the selection only; the +1 AP would reach every
    // friendly Gamma ranged attack. Refused, not compiled with the restriction dropped.
    const result = compileLeaves(designated({ any_keywords: ["ALPHA", "BETA"] }, { direction: "makes", unit: "friendly-unit", attack_type: "ranged" }), TEXT);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.join(" ")).toMatch(/must target that unit/);
  });
});

describe("Round 5C selection filter without an attack aimed at the selected unit", () => {
  it("compiles when the selected unit is the attacker, its own attacks being the restricted ones", () => {
    const text = "After a unit shoots, select one enemy Alpha or Beta unit. That unit's ranged attacks have -1 to the Hit roll.";
    const list = placed(text,
      ["After a unit shoots", "event", { kind: "after-shooting" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["enemy Alpha or Beta unit", "unit-filter", { side: "enemy", any_keywords: ["ALPHA", "BETA"] }],
      ["That unit's ranged attacks", "attack", { direction: "makes", unit: "that-unit", attack_type: "ranged" }],
      ["-1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "subtract", value: 1 }],
    );
    const result = compileLeaves(list, text);
    expect(result.ok).toBe(true);
  });
});

describe("Round 5C persistent designation with a filtered selection", () => {
  it("keeps compiling a mark whose attacks name the mark, not a target that unit", () => {
    const text = "At the start of the first battle round, select one enemy Alpha or Beta unit to be this unit's mark. This unit's attacks against that mark ignore the Hit roll modifiers.";
    const list = placed(text,
      ["At the start of the first battle round", "turn-start", { turn: "battle-round" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["enemy Alpha or Beta unit", "unit-filter", { side: "enemy", any_keywords: ["ALPHA", "BETA"] }],
      ["to be this unit's mark", "persistent-designation-open", { designation: "fabricated-mark", scope: "enemy-unit", timing: "start-of-first-battle-round", beneficiary: "this-unit" }],
      ["This unit's attacks", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["against that mark", "designated-filter", { subject: "defender", tag: "fabricated-mark" }],
      ["ignore the Hit roll modifiers", "ignore-modifiers", { subject: "this-unit", what: ["rolls"], rolls: ["hit"] }],
    );
    const result = compileLeaves(list, text);
    expect(result.ok).toBe(true);
  });
});

// A selection's side and its exclusion: "select one enemy X unit within 8\" (excluding Y units)".
// Fabricated wording; each leaf sits on its own wording, as the parser would place it.
const SELECT_TEXT = 'Command phase. Select one enemy Alpha unit within 8" of this unit (excluding Beta and Gamma units). That unit must take a test.';
const SELECT_WINDOW: [string, string, Record<string, unknown>] = ["Command phase", "phase-window", { phase: "command", turn: "your" }];
const SELECT_TEST: [string, string, Record<string, unknown>] = ["That unit must take a test", "test", { target: "selected-unit", test: "battle-shock" }];

function selectionOf(text: string, ...items: Array<[string, string, Record<string, unknown>]>) {
  return compileLeaves(placed(text, ...items), text);
}

/** The first `selector` object in the compiled mechanics (the select's own selector, under any conditional). */
function selectorOf(result: ReturnType<typeof compileLeaves>): Record<string, unknown> {
  if (!result.ok) throw new Error(result.errors.join("; "));
  const find = (node: unknown): Record<string, unknown> | undefined => {
    if (node === null || typeof node !== "object") return undefined;
    if (!Array.isArray(node) && "selector" in node) return (node as { selector: Record<string, unknown> }).selector;
    for (const child of Object.values(node)) { const hit = find(child); if (hit) return hit; }
    return undefined;
  };
  return find(result.mechanics) ?? {};
}

// Sub-shapes A and D: the select's side and the exclusion that follows it fold into one selection.
describe("Round 5C select-unit side and exclusion fold", () => {
  it("folds an exclusion right after a select that names the same side", () => {
    // The select's scope equals the exclusion's side; the selection keeps both.
    const text = "Command phase. Select one enemy unit (excluding Beta units). That unit must take a test.";
    const result = selectionOf(text, SELECT_WINDOW, ["Select one", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["(excluding Beta units)", "unit-filter", { side: "enemy", excluded_keywords: ["BETA"] }], ["That unit must take a test", ...SELECT_TEST.slice(1)]);
    expect(result.ok).toBe(true);
    const selector = selectorOf(result);
    expect(selector).toMatchObject({ owner: "enemy", count: 1, excluded_keywords: ["BETA"] });
  });

  it("folds an exclusion past a side-less distance, measured to the bearer's unit", () => {
    // Fabricated copy of the enhancement shape: select, distance, then the exclusion of the same side.
    const result = selectionOf(SELECT_TEXT, SELECT_WINDOW, ["Select one", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ['within 8" of this unit', "aura-range", { inches: 8, of: "this-unit" }],
      ["(excluding Beta and Gamma units)", "unit-filter", { side: "enemy", excluded_keywords: ["BETA", "GAMMA"] }], SELECT_TEST);
    expect(result.ok).toBe(true);
    expect(selectorOf(result)).toMatchObject({ owner: "enemy", excluded_keywords: ["BETA", "GAMMA"], within_inches: 8 });
  });

  it("folds an exclusion past a unit-position measured to the selected unit, into a scope-less select's filter", () => {
    const text = "Command phase. Select one friendly Alpha unit within 12\" of this model (excluding Beta units). That unit must take a test.";
    const result = selectionOf(text, SELECT_WINDOW, ["Select one", "select-unit", { distance: "any", visible: false }],
      ["friendly Alpha unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ['within 12" of this model', "unit-position", { kind: "within", inches: 12, of: "this-model", subject: "selected-unit", negated: false }],
      ["(excluding Beta units)", "unit-filter", { side: "friendly", excluded_keywords: ["BETA"] }], SELECT_TEST);
    expect(result.ok).toBe(true);
    const selector = selectorOf(result);
    expect(selector).toMatchObject({ owner: "friendly", keywords: ["ALPHA"], excluded_keywords: ["BETA"] });
  });

  it("refuses an exclusion whose side differs from the select's scope", () => {
    const result = selectionOf(SELECT_TEXT, SELECT_WINDOW, ["Select one", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ['within 8" of this unit', "aura-range", { inches: 8, of: "this-unit" }],
      ["(excluding Beta and Gamma units)", "unit-filter", { side: "friendly", excluded_keywords: ["BETA", "GAMMA"] }], SELECT_TEST);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/exclusion's side differs/);
  });

  it("leaves a filter of the other side after a scoped select to the attack it names", () => {
    // "Friendly X units' attacks that target that enemy unit": the friendly filter is the attacker, not the select's own filter.
    const text = "Shooting phase. Select one enemy unit. Friendly Alpha units' attacks that target that enemy unit have +1 to hit rolls.";
    const result = selectionOf(text, ["Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["Friendly Alpha units'", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["attacks that target that enemy unit", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["+1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).toContain('"all_of":["ALPHA"]');
  });

  it("refuses an exclusion past two distances, which the fold does not read", () => {
    const text = 'Command phase. Select one enemy Alpha unit within 8" of this unit within 3" of this model (excluding Beta and Gamma units). That unit must take a test.';
    const result = selectionOf(text, SELECT_WINDOW, ["Select one", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ['within 8" of this unit', "aura-range", { inches: 8, of: "this-unit" }],
      ['within 3" of this model', "aura-range", { inches: 3, of: "this-model" }],
      ["(excluding Beta and Gamma units)", "unit-filter", { side: "enemy", excluded_keywords: ["BETA", "GAMMA"] }], SELECT_TEST);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/aura-range without a side needs a unit-filter/);
  });
});

// Sub-shape A's aura form: an aura-range may repeat the side of the unit-filter before it.
describe("Round 5C aura-range side against the unit-filter before it", () => {
  const AURA_TEXT = 'While an enemy Alpha unit (excluding Beta units) is within 3" of this unit, that enemy unit has -1 OC.';
  const aura = (side: string) => placed(AURA_TEXT,
    ["an enemy Alpha unit", "unit-filter", { side: "enemy" }],
    ["(excluding Beta units)", "unit-filter", { side: "enemy", excluded_keywords: ["BETA"] }],
    ['within 3" of this unit', "aura-range", { inches: 3, of: "this-unit", side }],
    ["-1 OC", "characteristic-modifier", { subject: "antecedent", characteristics: ["OC"], operation: "worsen", value: 1 }]);

  it("folds an aura whose side equals the filter's side into the aura", () => {
    const result = compileLeaves(aura("enemy"), AURA_TEXT);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).toContain('"excluded_keywords":["BETA"]');
  });

  it("refuses an aura whose side differs from the filter's side", () => {
    const result = compileLeaves(aura("friendly"), AURA_TEXT);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/aura-range's side differs/);
  });
});
