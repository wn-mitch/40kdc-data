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
