import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeCondition } from "../src/translate/condition.js";
import { describeAbility } from "../src/translate/index.js";

// Fabricated wording and identities; no rules text.

type Item = [string, string, Record<string, unknown>];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const TEXT = "At the start of the battle round, if your **WARLORD** is on the battlefield, you must vow a number of enemy units to fell this battle round. "
  + "At the end of the battle round, if the number of enemy units destroyed this battle round is greater than or equal to your vow, you gain a number of Glory points equal to your vow. "
  + "Otherwise, your **WARLORD** model suffers D3 mortal wounds.\n"
  + "**GLOOM WARDENS** units from your army gain a bonus by how many Glory points you have, as shown below.\n"
  + "If you have 2 or more Glory points, each time a model in this unit makes an attack, re-roll a Hit roll of 1. If you have 4 or more Glory points, each time a model in this unit makes an attack, re-roll a Wound roll of 1.";

const WARLORD = (wording: string): Item => [wording, "unit-filter", { side: "friendly", designated: "warlord", level: "model" }];
const COMPARE = (extra: Record<string, unknown> = { window: "battle-round" }): Item => ["if the number of enemy units destroyed this battle round is greater than or equal to your vow", "history-compare",
  { comparison: "greater-or-equal", right_kind: "pool", right_pool: "vow", ...extra }];
const ITEMS = (compare = COMPARE()): Item[] => [
  ["At the start of the battle round", "turn-start", { turn: "battle-round" }],
  WARLORD("your **WARLORD"),
  ["is on the battlefield", "unit-state", { states: ["on-battlefield"], subject: "antecedent", negated: false }],
  ["you must vow a number of enemy units to fell this battle round", "resource-gain", { pool: "vow", amount: "any", set: true }],
  ["At the end of the battle round", "event", { kind: "round-ended" }],
  compare,
  ["you gain a number of Glory points equal to your vow", "resource-gain", { pool: "glory-points", amount: { pool: "vow" } }],
  ["Otherwise", "otherwise", {}],
  WARLORD("your **WARLORD** model"),
  ["suffers D3 mortal wounds", "mortal-wounds", { recipient: "antecedent", count: "D3" }],
  ["GLOOM WARDENS** units from your army", "unit-filter", { side: "friendly", keywords: ["GLOOM WARDENS"] }],
  ["gain a bonus by how many Glory points you have, as shown below", "ability-record-grant", { subject: "antecedent", printed: "unnamed" }],
  ["If you have 2 or more Glory points", "resource", { pool: "glory-points", at_least: 2 }],
  ["each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
  ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }],
  ["If you have 4 or more Glory points", "resource", { pool: "glory-points", at_least: 4 }],
  ["each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
  ["re-roll a Wound roll of 1", "reroll", { roll: "wound", subset: "ones", weapon_type: "all" }],
];

function compiled(items: Item[], text = TEXT) {
  return compileLeaves(placed(text, ...items), text, {});
}

function stepsOf(items: Item[], text = TEXT): any[] {
  const result = compiled(items, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return (result.mechanics as any).effect.steps;
}

const WARLORD_MODEL = { owner: "friendly", level: "model", designated: "warlord" };
const destroyed = (window: string) => ({ event: "destroyed", object: { owner: "enemy" }, window });

describe("a number the player pledges, then gains as points (resource-gain set and amount {pool})", () => {
  it("sets the pledge pool to a number you pick while the Warlord is on the battlefield", () => {
    expect(stepsOf(ITEMS())[0]).toEqual({ type: "ability-part", trigger: { event: "round-started" }, effect: { type: "conditional",
      condition: { type: "matches", parameters: { subject: WARLORD_MODEL, filter: { state: "on-battlefield" } } },
      effect: { type: "resource-gain", target: "this-model", modifier: { pool: "vow", amount: "any", set: true } } } });
  });

  it("gains as many points as the pledge, and wounds the Warlord model otherwise", () => {
    const compare = { type: "happened-compare", parameters: { left: destroyed("battle-round"), comparison: "gte", right: { pool: "vow" } } };
    expect(stepsOf(ITEMS())[1].effect.steps).toEqual([
      { type: "conditional", condition: compare, effect: { type: "resource-gain", target: "this-model", modifier: { pool: "glory-points", amount: { pool: "vow" } } } },
      { type: "conditional", condition: { operator: "not", operands: [compare] }, effect: { type: "mortal-wounds", target: WARLORD_MODEL, modifier: { count: "D3" } } },
    ]);
  });

  it("counts the whole battle when the comparison names no window", () => {
    const condition = stepsOf(ITEMS(COMPARE({})))[1].effect.steps[0].condition;
    expect(condition.parameters.left).toEqual(destroyed("battle"));
  });

  it("takes set true only with a number, and a pool amount only from another pool, without set", () => {
    const version = currentFamilyVersion("resource-gain");
    const normalize = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("resource-gain", parameters, version);
    expect(normalize({ pool: "vow", amount: "D3", set: true })).toEqual({ pool: "vow", amount: "D3", set: true });
    expect(normalize({ pool: "glory-points", amount: { pool: "vow" } })).toEqual({ pool: "glory-points", amount: { pool: "vow" } });
    expect(() => normalize({ pool: "vow", amount: "any", set: false })).toThrow(/true or omitted/u);
    expect(() => normalize({ pool: "vow", amount: "variable", set: true })).toThrow(/needs a number/u);
    expect(() => normalize({ pool: "glory-points", amount: { pool: "vow" }, set: true })).toThrow(/does not take an amount read from another pool/u);
    expect(() => normalize({ pool: "vow", amount: { pool: "vow" } })).toThrow(/another pool than the one gained/u);
    expect(() => normalize({ pool: "glory-points", amount: { pool: "vow", min: 1 } })).toThrow(/only a kebab-case pool id/u);
    expect(() => normalize({ pool: "glory-points", amount: { pool: "Vow" } })).toThrow(/only a kebab-case pool id/u);
  });

  it("takes window battle-round only", () => {
    const version = currentFamilyVersion("history-compare");
    expect(() => normalizeFingerprintParameters("history-compare", { comparison: "greater-or-equal", right_kind: "pool", right_pool: "vow", window: "turn" }, version)).toThrow(/history-compare\.window/u);
  });

  it("renders the pledge, the gain, the round's tally and the player's pool", () => {
    const effect = { type: "sequence", steps: stepsOf(ITEMS()) };
    const text = describeAbility({ id: "sample", name: "Sample", effect } as any);
    expect(text).toContain("declare a number as your vow");
    expect(text).toContain("If you destroyed at least as many enemy units this battle round as your vow, you gain a number of Glory points equal to your vow");
    expect(text).toContain("While you have 2+ glory points");
    const set = { type: "resource-gain", target: "this-model", modifier: { pool: "vow", amount: "D3", set: true } };
    expect(describeAbility({ id: "sample", name: "Sample", effect: set } as any)).toBe("Your vow becomes D3.");
    expect(describeCondition({ operator: "not", operands: [{ type: "resource", parameters: { pool: "glory-points", count: { min: 2 } } }] } as any)).toBe("you do not have 2+ glory points");
  });
});

describe("a unit-filter naming the Warlord (compile-unit-filters.ts)", () => {
  it("stays refused before a list-building rule, which a unit-ref target would strip of its mustering restriction", () => {
    const text = "Your **WARLORD** model must have the **GLOOM** keyword.";
    const result = compiled([WARLORD("Your **WARLORD** model"), ["must have the **GLOOM** keyword", "army-construction", { rule: "warlord-required", subject: "antecedent" }]], text);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/naming the Warlord needs an army test/u);
  });

  it("stays refused at unit level, where it would also match the Warlord's unit", () => {
    const items = ITEMS().map((item): Item => item[0] === "your **WARLORD** model" ? [item[0], "unit-filter", { side: "friendly", designated: "warlord" }] : item);
    const result = compiled(items);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/naming the Warlord needs an army test/u);
  });
});

describe("an unnamed printed grant whose bonus is printed on the next line (compile-granted.ts belowEnd)", () => {
  it("takes the paragraph after the header as the body", () => {
    const grant = stepsOf(ITEMS())[2];
    expect(grant.type).toBe("ability-grant");
    expect(grant.target).toEqual({ owner: "friendly", all_of: ["GLOOM WARDENS"] });
    expect(grant.modifier.definition.effect.steps.map((step: any) => [step.condition.parameters.count.min, step.effect.modifier.roll])).toEqual([[2, "hit"], [4, "wound"]]);
  });

  it("keeps a body that has its effect in the header's own paragraph to that paragraph", () => {
    const text = "**GLOOM WARDENS** units from your army have the following: this unit has a 5+ invulnerable save.\nAt the end of your turn, this unit suffers 1 mortal wound.";
    const steps = stepsOf([
      ["GLOOM WARDENS** units from your army", "unit-filter", { side: "friendly", keywords: ["GLOOM WARDENS"] }],
      ["have the following", "ability-record-grant", { subject: "antecedent", printed: "unnamed" }],
      ["this unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }],
      ["At the end of your turn", "event", { kind: "turn-ended", turn: "your" }],
      ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }],
    ], text);
    expect(steps[0].modifier.definition.effect.type).toBe("invulnerable-save");
    expect(JSON.stringify(steps[0])).not.toContain("mortal-wounds");
    expect(steps[1].effect.type).toBe("mortal-wounds");
  });
});

describe("a unit's own pool as large as one of its characteristics (resource-gain amount {characteristic})", () => {
  const BUDGET = "In a battle round, a friendly **GLOOM WARDENS PSYKER** unit can use powers whose total cost does not exceed that unit's mind rank.";
  const FILTER: Item = ["a friendly **GLOOM WARDENS PSYKER** unit", "unit-filter", { side: "friendly", keywords: ["GLOOM WARDENS", "PSYKER"] }];
  const GAIN = (extra: Record<string, unknown>): Item => ["can use powers whose total cost does not exceed that unit's mind rank", "resource-gain",
    { pool: "psychic-level", set: true, amount: { characteristic: "psyker-level" }, label: "Psychic Level", ...extra }];
  const ROUND: Item = ["In a battle round", "turn-start", { turn: "battle-round" }];

  it("fills the pool of every unit the filter names each battle round, not the army's pool", () => {
    const result = compiled([ROUND, FILTER, GAIN({ subject: "antecedent" })], BUDGET);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics).toMatchObject({ trigger: { event: "round-started" }, effect: { type: "resource-gain", target: { owner: "friendly", all_of: ["GLOOM WARDENS", "PSYKER"] },
      modifier: { pool: "psychic-level", amount: { characteristic: "psyker-level" }, set: true } } });
  });

  it("fills the bearer's unit's pool with no subject, where a fixed amount stays on this-model", () => {
    const text = "In a battle round, this unit can use powers whose total cost does not exceed that unit's mind rank.";
    const result = compiled([ROUND, GAIN({})], text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect((result.mechanics as any).effect.target).toBe("this-unit");
    const fixed = compiled([ROUND, ["can use powers whose total cost does not exceed that unit's mind rank", "resource-gain", { pool: "psychic-level", amount: 2, set: true }]], text);
    if (!fixed.ok) throw new Error(fixed.errors.join("; "));
    expect((fixed.mechanics as any).effect.target).toBe("this-model");
  });

  it("takes only a unit's own characteristic, alone, and a subject only with it", () => {
    const version = currentFamilyVersion("resource-gain");
    const normalize = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("resource-gain", parameters, version);
    expect(normalize({ pool: "psychic-level", amount: { characteristic: "psyker-level" }, set: true, subject: "this-unit" }))
      .toEqual({ pool: "psychic-level", amount: { characteristic: "psyker-level" }, set: true, subject: "this-unit" });
    expect(() => normalize({ pool: "fury", amount: { characteristic: "S" } })).toThrow(/characteristic must be one of/u);
    expect(() => normalize({ pool: "fury", amount: { characteristic: "W", max: 3 } })).toThrow(/takes only the characteristic/u);
    expect(() => normalize({ pool: "fury", amount: 2, subject: "this-unit" })).toThrow(/needs amount \{characteristic\}/u);
    expect(() => normalize({ pool: "fury", amount: { characteristic: "W" }, subject: "this-model" })).toThrow(/resource-gain\.subject/u);
  });

  it("says whose pool and whose characteristic, in the number the subject takes", () => {
    const one = { type: "resource-gain", target: "this-unit", modifier: { pool: "psychic-level", amount: { characteristic: "psyker-level" }, set: true } };
    expect(describeAbility({ id: "sample", name: "Sample", effect: one } as any)).toBe("The unit's psychic level becomes its Psyker Level characteristic.");
    const many = { ...one, target: { owner: "friendly", all_of: ["GLOOM WARDENS", "PSYKER"] } };
    expect(describeAbility({ id: "sample", name: "Sample", effect: many } as any)).toBe("All friendly GLOOM WARDENS PSYKER units' psychic level becomes their Psyker Level characteristic.");
    const gain = { type: "resource-gain", target: "this-unit", modifier: { pool: "fury", amount: { characteristic: "W" } } };
    expect(describeAbility({ id: "sample", name: "Sample", effect: gain } as any)).toBe("You gain a number of Fury equal to its Wounds characteristic.");
  });
});
