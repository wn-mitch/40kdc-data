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
