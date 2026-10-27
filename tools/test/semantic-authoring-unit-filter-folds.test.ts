import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";

/** A registered designation, so a designate-target compiles (compile-wrappers.ts designationIdFor). */
const FIXTURE_RULE_NAME = "A Trap Well Laid";

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

function compile(text: string, ...items: Array<[string, string, Record<string, unknown>]>) {
  return compileLeaves(placed(text, ...items), text, { name: FIXTURE_RULE_NAME });
}

function mechanics(text: string, ...items: Array<[string, string, Record<string, unknown>]>): Record<string, any> {
  const result = compile(text, ...items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

const errors = (result: ReturnType<typeof compileLeaves>) => (result.ok ? "" : result.errors.join(" "));

// B1: a filter after a select that names the other side is the attackers, not the select's filter.
// Set from a run on the unpatched tree (checklist item 6): the side-any outcome that must not change.
const BASE_TREE_SIDE_ANY_OK = false;

describe("a friendly filter after an enemy-scoped select", () => {
  const TEXT = "In your Command phase, select one enemy unit. Friendly Alpha units' attacks that target that enemy unit have [Lethal Hits].";
  const LEAVES: Array<[string, string, Record<string, unknown>]> = [
    ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
    ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["Friendly Alpha units'", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
    ["attacks that target", "weapon-property-scope", { subject: "antecedent", weapon_type: "all" }],
    ["that enemy unit", "target-is-selected", {}],
    ["Lethal Hits", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
  ];

  it("names the friendly units as the weapon grant's recipients", () => {
    const json = JSON.stringify(mechanics(TEXT, ...LEAVES));
    expect(json).toContain('"type":"weapon-ability-grant"');
    expect(json).toContain('"owner":"friendly","all_of":["ALPHA"]');
  });

  it("still claims an enemy filter for the enemy-scoped select", () => {
    const text = "In your Command phase, select one enemy unit. Enemy Beta units are marked.";
    const result = compile(text, LEAVES[0]!, LEAVES[1]!, ["Enemy Beta units", "unit-filter", { side: "enemy", keywords: ["BETA"] }], ["are marked", "apply-mark", { subject: "antecedent", tag: "marked" }]);
    // Positive shape: the compile succeeds and the enemy filter is the select's eligibility, not a friendly recipient.
    expect(errors(result)).toBe("");
    expect(result.ok).toBe(true);
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).toContain('"type":"select-units"');
    expect(json).toContain('"owner":"enemy"');
    expect(json).toContain('"BETA"');
    expect(json).not.toContain('"owner":"friendly"');
  });

  // B3: an open select (no scope) still claims a same-side filter.
  it("still claims a same-side filter for an open select", () => {
    const text = "In your Command phase, select one Beta unit. That unit is marked.";
    const result = compile(text,
      ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["Beta unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }],
      ["That unit is marked", "apply-mark", { subject: "antecedent", tag: "marked" }]);
    expect(errors(result)).toBe("");
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).toContain('"BETA"');
  });

  // B4: a side-`any` filter after a scoped select is not "the other side"; it anchors as on the base tree.
  it("still anchors a side-any filter after a scoped select", () => {
    const text = "In your Command phase, select one enemy unit. Beta units are marked.";
    const withAny = compile(text, LEAVES[0]!, LEAVES[1]!, ["Beta units", "unit-filter", { side: "any", keywords: ["BETA"] }], ["are marked", "apply-mark", { subject: "antecedent", tag: "marked" }]);
    // Record the base-tree outcome (ok or refusal) and require the same one here: run on the unpatched tree first and
    // pin the observed result; the change must not move it. A moved result means oppositeSelect widened.
    expect(withAny.ok).toBe(BASE_TREE_SIDE_ANY_OK);
  });
});

// B2: a bare filter after the last selection is the nearer unit for "that unit".
describe("a bare filter after an earlier selection", () => {
  const TEXT = "After this model shoots, select one enemy unit hit by those attacks. That unit is marked until the end of the turn. While an enemy unit is marked, that unit has -1 to Leadership rolls.";
  const BASE: Array<[string, string, Record<string, unknown>]> = [
    ["After this model shoots", "event", { kind: "after-shooting" }],
    ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["hit by those attacks", "hit-by-attacks", { subject: "selected-unit" }],
    ["That unit is marked", "apply-mark", { subject: "antecedent", tag: "marked" }],
    ["until the end of the turn", "duration", { endpoint: "end-of-turn" }],
    ["enemy unit is marked, that unit", "unit-filter", { side: "enemy" }],
  ];

  it("lets the second sentence's designation and modifier name the filtered units", () => {
    const result = mechanics(TEXT,
      ["After this model shoots", "event", { kind: "after-shooting" }], BASE[1]!, BASE[2]!, BASE[3]!, BASE[4]!,
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["is marked", "designated-filter", { tag: "marked", subject: "antecedent" }],
      ["-1 to Leadership rolls", "roll-modifier", { roll: "leadership", operation: "subtract", value: 1, subject: "antecedent" }]);
    expect(result.effect.effect.steps[1]).toMatchObject({
      type: "conditional",
      condition: { type: "matches", parameters: { subject: "recipient", filter: { designated: "marked" } } },
      effect: { type: "roll-modifier", target: { owner: "enemy" } },
    });
  });

  it("keeps the selected unit for a condition measured to a following filter", () => {
    const text = "In your Shooting phase, select one enemy unit that is not within Engagement Range of one or more friendly units and is visible to this unit. That unit suffers 1 mortal wound.";
    const json = JSON.stringify(mechanics(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["is not within Engagement Range of", "unit-state", { states: ["engaged"], subject: "antecedent", negated: true, with: "following-filter" }],
      ["one or more friendly units", "unit-filter", { side: "friendly" }],
      ["is visible to this unit", "visible", { subject: "antecedent", to: "this-unit" }],
      ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]));
    expect(json).toContain('"type":"matches","parameters":{"subject":"selected-unit","filter":{"visible":{"to":"this-unit"}}}');
  });
});

// C: a designation the quantifier names before its noun.
describe("a designation between a select and its unit-filter", () => {
  const TEXT = "In your Command phase, select one unravelling enemy unit. That unit must take a Battle-shock test.";
  const HEAD: Array<[string, string, Record<string, unknown>]> = [
    ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
    ["select one", "select-unit", { distance: "any", visible: false }],
  ];
  const TAIL: [string, string, Record<string, unknown>] = ["That unit must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }];

  it("gates the selected unit on the designation", () => {
    const json = JSON.stringify(mechanics(TEXT, ...HEAD, ["unravelling", "designated-filter", { tag: "unravelling", subject: "antecedent" }], ["enemy unit", "unit-filter", { side: "enemy" }], TAIL));
    expect(json).toContain('"type":"matches","parameters":{"subject":"selected-unit","filter":{"designated":"unravelling"}}');
  });

  it("leaves a counted designation where it is", () => {
    const result = compile(TEXT, ...HEAD, ["unravelling", "designated-filter", { tag: "unravelling", subject: "antecedent", count_min: 2 }], ["enemy unit", "unit-filter", { side: "enemy" }], TAIL);
    expect(result.ok).toBe(false);
    expect(errors(result)).toMatch(/select-unit without a scope needs a unit-filter/u);
  });
});

// D: "While a friendly X unit is Y, each time a model in that unit makes an attack".
describe("a bare filter and its conditions before an attack by 'that unit'", () => {
  const TEXT = "While a friendly Alpha unit from your army is below Starting Strength, each time a model in that unit makes an attack, re-roll a Hit roll of 1.";
  const LEAVES = (side: string): Array<[string, string, Record<string, unknown>]> => [
    ["Alpha unit", "unit-filter", { side, keywords: ["ALPHA"] }],
    ["from your army", "unit-owner", { owner: "friendly" }],
    ["is below Starting Strength", "unit-state", { states: ["below-starting-strength"], subject: "antecedent", negated: false }],
    ["each time a model in that unit makes an attack", "attack", { direction: "makes", unit: "that-unit", attack_type: "any" }],
    ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }],
  ];

  it("makes the filter the attackers and gates the re-roll on the attacker's strength", () => {
    const json = JSON.stringify(mechanics(TEXT, ...LEAVES("friendly")));
    expect(json).toContain('"type":"re-roll","target":{"owner":"friendly","all_of":["ALPHA"]}');
    expect(json).toContain('"strength","parameters":{"subject":"attacker","below":"starting"}');
  });

  it("refuses a filter that names no side", () => {
    expect(compile(TEXT, ...LEAVES("any")).ok).toBe(false);
  });

  // D3: "that unit" can name an earlier selection; the filter must not be rebound as the attacker.
  it("does not rebind 'that unit' to the filter when a select precedes it", () => {
    const text = "In your Command phase, select one enemy unit. While a friendly Alpha unit from your army is below Starting Strength, each time a model in that unit makes an attack, re-roll a Hit roll of 1.";
    const result = compile(text,
      ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
      ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ...LEAVES("friendly").slice(0, 5));
    expect(result.ok).toBe(false);
    expect(errors(result)).toMatch(/needs a select-unit or attack right before it|selected unit needs an attack leaf/u);
  });
});

// E: "The following friendly X units have K: A units. B units."
describe("a colon list of units after a grant", () => {
  const LEAVES: Array<[string, string, Record<string, unknown>]> = [
    ["friendly Alpha units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
    ["have Gamma", "keyword-grant", { subject: "antecedent", keywords: ["GAMMA"] }],
    ["Beta units", "unit-filter", { side: "friendly", keywords: ["BETA"] }],
    ["Delta Echo units", "unit-filter", { side: "friendly", keywords: ["DELTA", "ECHO"] }],
  ];

  it("narrows the recipients to the listed alternatives", () => {
    const json = JSON.stringify(mechanics("The following friendly Alpha units have Gamma:Beta units.Delta Echo units.", ...LEAVES));
    expect(json).toContain('"all_of":["ALPHA"],"any_of_filters":[{"all_of":["BETA"]},{"all_of":["DELTA","ECHO"]}]');
  });

  it("refuses the same filters after a sentence break instead of a colon", () => {
    const result = compile("The following friendly Alpha units have Gamma. Beta units. Delta Echo units.", ...LEAVES);
    expect(result.ok).toBe(false);
    expect(errors(result)).toMatch(/needs a select-unit or attack right before it/u);
  });
});

// H: an enemy model's destruction names no model of this unit.
describe("an enemy model destroyed", () => {
  it("does not make the destroyed model a member of this unit", () => {
    const text = "Just after an enemy CHARACTER model is destroyed, you gain 1CP.";
    const json = JSON.stringify(mechanics(text,
      ["enemy CHARACTER model", "unit-filter", { side: "enemy", keywords: ["CHARACTER"], level: "model" }],
      ["is destroyed", "event", { kind: "model-destroyed" }],
      ["you gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]));
    expect(json).toContain('"owner":"enemy"');
    expect(json).not.toContain("member_of");
  });
});

// F: a filter between a composition rule and a later list-building rule is the nearer group.
describe("a list-building rule after a composition rule", () => {
  const COMPOSITION: [string, string, Record<string, unknown>] = ["include Beta units in your army, up to 3 units", "army-construction", { rule: "composition", with_keywords: ["BETA"], max: 3, measure: "units" }];

  it("targets the filter between them, not the composition group", () => {
    const text = "You can include Beta units in your army, up to 3 units. An Alpha model must be your Warlord.";
    const result = mechanics(text, COMPOSITION,
      ["Alpha model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["must be your Warlord", "army-construction", { rule: "warlord-required", subject: "antecedent" }]);
    expect(result.effect.steps).toContainEqual(expect.objectContaining({
      target: { owner: "friendly", all_of: ["ALPHA"], level: "model" },
      modifier: { rule: "warlord-required" },
    }));
  });

  it("keeps the composition group when no filter sits between them", () => {
    const text = "You can include Beta units in your army, up to 3 units. They must be your Warlord.";
    const json = JSON.stringify(mechanics(text, COMPOSITION, ["must be your Warlord", "army-construction", { rule: "warlord-required", subject: "antecedent" }]));
    expect(json).toContain('"rule":"warlord-required"');
    expect(json).toContain('"all_of":["BETA"]');
  });
});

const DESIGNATED_TEXT = "After a unit shoots, select one enemy Alpha or Beta unit hit by those attacks. Friendly Gamma units' ranged attacks that target that unit have +1 AP.";

/** A designated-unit ability whose selected unit's filter is `enemy`, with the bearer's attack aimed at that unit. */
function designated(filter: Record<string, unknown>, attack: Record<string, unknown> = { direction: "makes", unit: "friendly-unit", attack_type: "ranged", target: "that-unit" }) {
  return placed(DESIGNATED_TEXT,
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
  const result = compileLeaves(list, DESIGNATED_TEXT, { name: FIXTURE_RULE_NAME });
  if (!result.ok) throw new Error(result.errors.join("; "));
  const effect = (result.mechanics as unknown as { effect: Record<string, any> }).effect;
  expect(effect.type).toBe("designate-target");
  return effect.select.selector;
}

// Sub-shape F: a designated select takes its unit-filter's keywords, so the attacks aimed at the
// designated unit keep the restriction "enemy X unit" carries.
describe("Semantic authoring designate-target select keywords from a folded unit-filter", () => {
  it("preserves any-of keywords in the selection filter", () => {
    const select = designateSelect(designated({ any_keywords: ["ALPHA", "BETA"] }));
    expect(select).toMatchObject({ filter: { owner: "enemy", any_of: ["ALPHA", "BETA"] }, count: { min: 1, max: 1 } });
  });

  it("preserves all-of keywords in the selection filter", () => {
    const select = designateSelect(designated({ keywords: ["ALPHA"] }));
    expect(select.filter).toEqual({ owner: "enemy", all_of: ["ALPHA"] });
  });

  it("preserves excluded keywords in the selection filter", () => {
    const select = designateSelect(designated({ keywords: ["ALPHA"], excluded_keywords: ["MONSTER"] }));
    expect(select).toMatchObject({ filter: { owner: "enemy", all_of: ["ALPHA"], none_of: ["MONSTER"] } });
  });

  it("preserves all-of and any-of lists together on the selection filter", () => {
    const select = designateSelect(designated({ keywords: ["ALPHA"], any_keywords: ["BETA", "GAMMA"] }));
    expect(select.filter).toEqual({ owner: "enemy", all_of: ["ALPHA"], any_of: ["BETA", "GAMMA"] });
  });

  it("preserves state restrictions alongside the selection keywords", () => {
    const select = designateSelect(designated({ any_keywords: ["ALPHA", "BETA"], states: ["battle-shocked"] }));
    expect(select.filter).toEqual({ owner: "enemy", any_of: ["ALPHA", "BETA"], state: "battle-shocked" });
  });

  it("refuses a selected unit with filter keywords whose bearer's attacks do not target it", () => {
    // Without "that unit" the filter would narrow the selection only; the +1 AP would reach every
    // friendly Gamma ranged attack. Refused, not compiled with the restriction dropped.
    const result = compileLeaves(designated({ any_keywords: ["ALPHA", "BETA"] }, { direction: "makes", unit: "friendly-unit", attack_type: "ranged" }), DESIGNATED_TEXT, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.join(" ")).toMatch(/must target that unit/);
  });
});

describe("Semantic authoring selection filter without an attack aimed at the selected unit", () => {
  it("compiles when the selected unit is the attacker, its own attacks being the restricted ones", () => {
    const text = "After a unit shoots, select one enemy Alpha or Beta unit. That unit's ranged attacks have -1 to the Hit roll.";
    const list = placed(text,
      ["After a unit shoots", "event", { kind: "after-shooting" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["enemy Alpha or Beta unit", "unit-filter", { side: "enemy", any_keywords: ["ALPHA", "BETA"] }],
      ["That unit's ranged attacks", "attack", { direction: "makes", unit: "that-unit", attack_type: "ranged" }],
      ["-1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "subtract", value: 1 }],
    );
    const result = compileLeaves(list, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(true);
  });
});

describe("Semantic authoring persistent designation with a filtered selection", () => {
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
    const result = compileLeaves(list, text, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(true);
  });
});

// A selection's side and its exclusion: "select one enemy X unit within 8\" (excluding Y units)".
// Fabricated wording; each leaf sits on its own wording, as the parser would place it.
const SELECT_TEXT = 'Command phase. Select one enemy Alpha unit within 8" of this unit (excluding Beta and Gamma units). That unit must take a test.';
const SELECT_WINDOW: [string, string, Record<string, unknown>] = ["Command phase", "phase-window", { phase: "command", turn: "your" }];
const SELECT_TEST: [string, string, Record<string, unknown>] = ["That unit must take a test", "test", { target: "selected-unit", test: "battle-shock" }];

function selectionOf(text: string, ...items: Array<[string, string, Record<string, unknown>]>) {
  return compileLeaves(placed(text, ...items), text, { name: FIXTURE_RULE_NAME });
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
describe("Semantic authoring select-unit side and exclusion fold", () => {
  it("folds an exclusion right after a select that names the same side", () => {
    // The select's scope equals the exclusion's side; the selection keeps both.
    const text = "Command phase. Select one enemy unit (excluding Beta units). That unit must take a test.";
    const result = selectionOf(text, SELECT_WINDOW, ["Select one", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["(excluding Beta units)", "unit-filter", { side: "enemy", excluded_keywords: ["BETA"] }], ["That unit must take a test", SELECT_TEST[1], SELECT_TEST[2]]);
    expect(result.ok).toBe(true);
    const selector = selectorOf(result);
    expect(selector).toMatchObject({ filter: { owner: "enemy", none_of: ["BETA"] }, count: { min: 1, max: 1 } });
  });

  it("folds an exclusion past a side-less distance, measured to the bearer's unit", () => {
    // Fabricated copy of the enhancement shape: select, distance, then the exclusion of the same side.
    const result = selectionOf(SELECT_TEXT, SELECT_WINDOW, ["Select one", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ['within 8" of this unit', "aura-range", { inches: 8, of: "this-unit" }],
      ["(excluding Beta and Gamma units)", "unit-filter", { side: "enemy", excluded_keywords: ["BETA", "GAMMA"] }], SELECT_TEST);
    expect(result.ok).toBe(true);
    expect(selectorOf(result)).toMatchObject({ filter: { owner: "enemy", none_of: ["BETA", "GAMMA"], within: { range: { inches: 8 }, of: "this-unit" } }, count: { min: 1, max: 1 } });
  });

  it("folds an exclusion past a unit-position measured to the selected unit, into a scope-less select's filter", () => {
    const text = "Command phase. Select one friendly Alpha unit within 12\" of this model (excluding Beta units). That unit must take a test.";
    const result = selectionOf(text, SELECT_WINDOW, ["Select one", "select-unit", { distance: "any", visible: false }],
      ["friendly Alpha unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ['within 12" of this model', "unit-position", { kind: "within", inches: 12, of: "this-model", subject: "selected-unit", negated: false }],
      ["(excluding Beta units)", "unit-filter", { side: "friendly", excluded_keywords: ["BETA"] }], SELECT_TEST);
    expect(result.ok).toBe(true);
    const selector = selectorOf(result);
    expect(selector).toMatchObject({ filter: { owner: "friendly", all_of: ["ALPHA"], none_of: ["BETA"] }, count: { min: 1, max: 1 } });
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
describe("Semantic authoring aura-range side against the unit-filter before it", () => {
  const AURA_TEXT = 'While an enemy Alpha unit (excluding Beta units) is within 3" of this unit, that enemy unit has -1 OC.';
  const aura = (side: string) => placed(AURA_TEXT,
    ["an enemy Alpha unit", "unit-filter", { side: "enemy" }],
    ["(excluding Beta units)", "unit-filter", { side: "enemy", excluded_keywords: ["BETA"] }],
    ['within 3" of this unit', "aura-range", { inches: 3, of: "this-unit", side }],
    ["-1 OC", "characteristic-modifier", { subject: "antecedent", characteristics: ["OC"], operation: "worsen", value: 1 }]);

  it("folds an aura whose side equals the filter's side into the aura", () => {
    const result = compileLeaves(aura("enemy"), AURA_TEXT, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).toContain('"none_of":["BETA"]');
  });

  it("refuses an aura whose side differs from the filter's side", () => {
    const result = compileLeaves(aura("friendly"), AURA_TEXT, { name: FIXTURE_RULE_NAME });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/aura-range's side differs/);
  });
});
