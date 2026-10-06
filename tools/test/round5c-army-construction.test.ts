import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { sentenceSegments } from "../src/round5c/compile-segments.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

// Fabricated wording throughout: ALPHA/BETA/GAMMA keywords, not rules text.

/** Leaves on their own wording in `text`, in order, all in one fragment. */
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

function effectOf(list: CompileLeaf[], text: string): any {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return (result.mechanics as unknown as Record<string, any>).effect;
}

function errorsOf(list: CompileLeaf[], text: string): string {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics.effect)}`);
  return result.errors.join("; ");
}

/** Every army-rule in an effect tree, in order. */
function armyRules(node: unknown): any[] {
  if (Array.isArray(node)) return node.flatMap(armyRules);
  if (node === null || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  return [...(record.type === "army-rule" ? [record] : []), ...Object.values(record).flatMap(armyRules)];
}

const army = "army-construction";
const normalize = (parameters: Record<string, unknown>) => normalizeFingerprintParameters(army, parameters, currentFamilyVersion(army));
const filter = (wording: string, parameters: Record<string, unknown>): [string, string, Record<string, unknown>] => [wording, "unit-filter", parameters];

describe("army-construction family, wave 8", () => {
  it("moves a previous-version leaf across unchanged", () => {
    expect(normalize({ rule: "composition", with_keywords: ["ALPHA"], max: 500, measure: "points" }))
      .toEqual({ rule: "composition", with_keywords: ["ALPHA"], max: 500, measure: "points" });
  });

  it("takes a group from the filter after it or from an earlier leaf, but only one source", () => {
    expect(normalize({ rule: "composition", max: 0, with: "following-filter" })).toEqual({ rule: "composition", max: 0, with: "following-filter" });
    expect(normalize({ rule: "warlord-forbidden", subject: "antecedent" })).toEqual({ rule: "warlord-forbidden", subject: "antecedent" });
    expect(() => normalize({ rule: "composition", with_keywords: ["ALPHA"], with: "following-filter" })).toThrow(/group once/);
    expect(() => normalize({ rule: "warlord-forbidden", with: "following-filter", subject: "antecedent" })).toThrow(/group once/);
    expect(() => normalize({ rule: "warlord-forbidden", with_keywords: ["ALPHA"], subject: "this-model" })).toThrow(/names the subject itself/);
  });

  it("refuses a group on a rule about the whole list", () => {
    expect(() => normalize({ rule: "single-chapter", with: "following-filter" })).toThrow(/list as a whole/);
    expect(() => normalize({ rule: "faction-forbidden", subject: "antecedent" })).toThrow(/list as a whole/);
  });

  it("ties exemptions, objects and Enhancement kinds to their rules", () => {
    expect(normalize({ rule: "limit-exemption", subject: "antecedent", exempt_from: ["strategic-reserves-points"] }))
      .toEqual({ rule: "limit-exemption", subject: "antecedent", exempt_from: ["strategic-reserves-points"] });
    expect(normalize({ rule: "enhancement-source" })).toEqual({ rule: "enhancement-source" });
    expect(() => normalize({ rule: "limit-exemption" })).toThrow(/exempt_from/);
    expect(() => normalize({ rule: "composition", exempt_from: ["enhancement-limit"] })).toThrow(/limit-exemption/);
    expect(() => normalize({ rule: "limit-exemption", exempt_from: ["retinue-limit"] })).toThrow(/composition/);
    expect(() => normalize({ rule: "composition", object: "this-unit" })).toThrow(/attachment/);
    expect(() => normalize({ rule: "warlord-forbidden", enhancement_kind: "relic" })).toThrow(/enhancement-slot or unique/);
    expect(normalize({ rule: "unique", enhancement_kind: "relic" })).toEqual({ rule: "unique", enhancement_kind: "relic" });
  });
});

describe("army-construction groups (sub-shape A)", () => {
  it("counts the units of the filter after the rule, with its exclusion", () => {
    const text = "Your army cannot include any ALPHA units (excluding BETA units).";
    const [rule] = armyRules(effectOf(placed(text,
      ["cannot include any", army, { rule: "composition", max: 0, with: "following-filter" }],
      filter("ALPHA units", { side: "friendly", keywords: ["ALPHA"] }),
      filter("excluding BETA units", { side: "friendly", excluded_keywords: ["BETA"] })), text));
    expect(rule).toEqual({ type: "army-rule", target: "this-unit", modifier: { rule: "composition", max: 0, with: { owner: "friendly", all_of: ["ALPHA"], none_of: ["BETA"] } } });
  });

  it("puts a subject rule's keywords in its target, not in with", () => {
    // Authoring-only path (A′): one leaf over the whole clause.
    const text = "You cannot select an ALPHA model to be your Warlord.";
    const [rule] = armyRules(effectOf(placed(text, ["You cannot select an ALPHA model to be your Warlord", army, { rule: "warlord-forbidden", with_keywords: ["ALPHA"] }]), text));
    expect(rule).toEqual({ type: "army-rule", target: { owner: "friendly", all_of: ["ALPHA"] }, modifier: { rule: "warlord-forbidden" } });
  });

  it("binds \"none of these models\" to the group of the composition rule before it", () => {
    const text = "You can include up to 2 ALPHA or BETA units. None of these models can be your Warlord.";
    const effect = effectOf(placed(text,
      ["You can", "optional-use", { who: "you" }],
      ["include up to 2", army, { rule: "composition", max: 2, with: "following-filter" }],
      filter("ALPHA or BETA units", { side: "friendly", any_keywords: ["ALPHA", "BETA"] }),
      ["None of these models can be your Warlord", army, { rule: "warlord-forbidden", subject: "antecedent" }]), text);
    const rules = armyRules(effect);
    expect(rules).toHaveLength(2);
    expect(rules[0].modifier.with).toEqual({ owner: "friendly", any_of: ["ALPHA", "BETA"] });
    expect(rules[1]).toEqual({ type: "army-rule", target: { owner: "friendly", any_of: ["ALPHA", "BETA"] }, modifier: { rule: "warlord-forbidden" } });
  });

  it("keeps a sentence that points back to a composition rule in that rule's part", () => {
    const text = "Each time this unit is selected to fight, add 1 to the Hit roll. You can include up to 2 ALPHA units. None of these models can be your Warlord.";
    const leaves = placed(text,
      ["Each time this unit is selected to fight", "event", { kind: "selected-to-fight" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["include up to 2", army, { rule: "composition", max: 2, with: "following-filter" }],
      filter("ALPHA units", { side: "friendly", keywords: ["ALPHA"] }),
      ["None of these models can be your Warlord", army, { rule: "warlord-forbidden", subject: "antecedent" }]);
    const parts = sentenceSegments(leaves, text)!;
    expect(parts.map((part) => part.map((leaf) => leaf.family_id))).toEqual([["event", "roll-modifier"], [army, "unit-filter", army]]);
    const rules = armyRules(effectOf(leaves, text));
    expect(rules[1].target).toEqual({ owner: "friendly", all_of: ["ALPHA"] });
  });

  it("binds an antecedent with no composition before it to the filter right before it", () => {
    const text = "ALPHA units from your army cannot be given Enhancements.";
    const [rule] = armyRules(effectOf(placed(text,
      filter("ALPHA units", { side: "friendly", keywords: ["ALPHA"] }),
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["cannot be given Enhancements", army, { rule: "enhancement-forbidden", subject: "antecedent" }]), text));
    expect(rule).toEqual({ type: "army-rule", target: { owner: "friendly", all_of: ["ALPHA"] }, modifier: { rule: "enhancement-forbidden" } });
  });

  it("counts a composition limit once per unit a \"for each\" filter names", () => {
    const text = "For each ALPHA unit you include in your army, you can include one BETA unit.";
    const [rule] = armyRules(effectOf(placed(text,
      ["For each", "for-each-unit-select", {}],
      filter("ALPHA unit", { side: "friendly", keywords: ["ALPHA"] }),
      ["you include in your army", "unit-owner", { owner: "friendly" }],
      ["you can", "optional-use", { who: "you" }],
      ["include one", army, { rule: "composition", max: 1, with: "following-filter", exempt_from: ["retinue-limit"] }],
      filter("BETA unit", { side: "friendly", keywords: ["BETA"] })), text));
    expect(rule.modifier).toEqual({ rule: "composition", max: 1, with: { owner: "friendly", all_of: ["BETA"] }, per: { owner: "friendly", all_of: ["ALPHA"] }, exempt_from: ["retinue-limit"] });
  });

  it("names one Army Faction by its keyword, and refuses two", () => {
    const text = "You cannot select GAMMA SEPT as your Army Faction.";
    const [rule] = armyRules(effectOf(placed(text, ["You cannot select GAMMA SEPT as your Army Faction", army, { rule: "faction-forbidden", with_keywords: ["GAMMA SEPT"] }]), text));
    expect(rule.modifier).toEqual({ rule: "faction-forbidden", faction: "gamma-sept" });
    const two = "You cannot select ALPHA or BETA as your Army Faction.";
    expect(errorsOf(placed(two, ["You cannot select ALPHA or BETA as your Army Faction", army, { rule: "faction-forbidden", with_keywords: ["ALPHA", "BETA"] }]), two)).toMatch(/one Army Faction/);
  });
});

describe("army-construction refusals", () => {
  it("refuses a following-filter rule with no filter after it", () => {
    const text = "Your army cannot include any of them.";
    expect(errorsOf(placed(text, ["cannot include any", army, { rule: "composition", max: 0, with: "following-filter" }]), text)).toMatch(/unit-filter right after it/);
  });

  it("refuses an antecedent with nothing to point back to", () => {
    const text = "Your army has rules. None of these models can be your Warlord.";
    expect(errorsOf(placed(text, ["None of these models can be your Warlord", army, { rule: "warlord-forbidden", subject: "antecedent" }]), text)).toMatch(/no earlier composition rule or unit-filter/);
  });

  it("refuses an enemy group, and a group qualified by battlefield state", () => {
    const enemy = "Your army cannot include enemy ALPHA units.";
    expect(errorsOf(placed(enemy,
      ["cannot include", army, { rule: "composition", max: 0, with: "following-filter" }],
      filter("enemy ALPHA units", { side: "enemy", keywords: ["ALPHA"] })), enemy)).toMatch(/units of your army/);
    const shocked = "Your army cannot include Battle-shocked ALPHA units.";
    expect(errorsOf(placed(shocked,
      ["cannot include", army, { rule: "composition", max: 0, with: "following-filter" }],
      filter("Battle-shocked ALPHA units", { side: "friendly", keywords: ["ALPHA"], states: ["battle-shocked"] })), shocked)).toMatch(/nothing when mustering/);
  });

  it("does not yet lower the new rule values or Leader attachment objects", () => {
    const text = "ALPHA units do not count towards the points limit for Strategic Reserves.";
    expect(errorsOf(placed(text,
      filter("ALPHA units", { side: "friendly", keywords: ["ALPHA"] }),
      ["do not count towards the points limit for Strategic Reserves", army, { rule: "limit-exemption", subject: "antecedent", exempt_from: ["strategic-reserves-points"] }]), text)).toMatch(/no DSL army-rule value yet/);
  });
});
