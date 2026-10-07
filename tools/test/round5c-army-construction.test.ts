import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { sentenceSegments } from "../src/round5c/compile-segments.js";
import { coreCheckErrors } from "../src/round5c/core-checks.js";
import { round5cDataRoot } from "../src/round5c/entries.js";
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

  it("widens unit-filter, army-faction and leading-unit by optional parameters", () => {
    const at = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));
    expect(at("unit-filter", { side: "friendly", datasheets: ["beta-squad", "alpha-squad"] })).toEqual({ side: "friendly", datasheets: ["alpha-squad", "beta-squad"] });
    expect(() => at("unit-filter", { side: "friendly", datasheets: ["Alpha Squad"] })).toThrow(/kebab-case/);
    expect(at("army-faction", { faction: "alpha-legion", negated: true })).toEqual({ faction: "alpha-legion", negated: true });
    expect(at("leading-unit", { subject: "antecedent", attachment: "can-attach", object: "following-filter" })).toEqual({ subject: "antecedent", attachment: "can-attach", object: "following-filter" });
    expect(() => at("leading-unit", { subject: "this-model", attachment: "can-attach" })).toThrow(/object: following-filter/);
    expect(() => at("leading-unit", { subject: "this-model", attachment: "leading", object: "following-filter" })).toThrow(/can-attach/);
    expect(() => normalize({ rule: "attachment", subject: "antecedent", object: "this-unit", max: 1 })).toThrow(/takes no max/);
    expect(() => normalize({ rule: "attachment", subject: "antecedent", object: "this-unit", led_by: "Alpha" })).toThrow(/takes no led_by/);
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

});

describe("army-construction limit exemptions and Enhancement sourcing (sub-shape C)", () => {
  it("exempts the units of the filter before the rule from the Strategic Reserves points limit", () => {
    const text = "Friendly ALPHA units do not count towards the points limit for Strategic Reserves.";
    const [rule] = armyRules(effectOf(placed(text,
      filter("Friendly ALPHA units", { side: "friendly", keywords: ["ALPHA"] }),
      ["do not count towards the points limit for Strategic Reserves", army, { rule: "limit-exemption", subject: "antecedent", exempt_from: ["strategic-reserves-points"] }]), text));
    expect(rule).toEqual({ type: "army-rule", target: { owner: "friendly", all_of: ["ALPHA"] }, modifier: { rule: "limit-exemption", exempt_from: ["strategic-reserves-points"] } });
  });

  it("keeps this Detachment's Enhancements out of the Enhancement limit", () => {
    const text = "Enhancements from this Detachment do not count towards your Enhancement limit.";
    const [rule] = armyRules(effectOf(placed(text,
      ["Enhancements from this Detachment do not count towards your Enhancement limit", army, { rule: "limit-exemption", exempt_from: ["enhancement-limit"] }]), text));
    expect(rule).toEqual({ type: "army-rule", target: "this-unit", modifier: { rule: "limit-exemption", exempt_from: ["enhancement-limit"] } });
  });

  it("restricts the units of a composition group to this Detachment's Enhancements", () => {
    const text = "You can include up to 2 ALPHA units. They can only be given Enhancements from this Detachment.";
    const rules = armyRules(effectOf(placed(text,
      ["include up to 2", army, { rule: "composition", max: 2, with: "following-filter" }],
      filter("ALPHA units", { side: "friendly", keywords: ["ALPHA"] }),
      ["They can only be given Enhancements from this Detachment", army, { rule: "enhancement-source", subject: "antecedent" }]), text));
    expect(rules[1]).toEqual({ type: "army-rule", target: { owner: "friendly", all_of: ["ALPHA"] }, modifier: { rule: "enhancement-source" } });
  });
});

describe("army-construction datasheet lists (sub-shape B)", () => {
  it("counts units of the listed datasheets, with the core check on their ids", () => {
    const text = "Your army cannot include the following datasheets: Alpha Squad, Beta Squad.";
    const result = compileLeaves(placed(text,
      ["cannot include the following datasheets", army, { rule: "composition", max: 0, with: "following-filter" }],
      filter("Alpha Squad, Beta Squad", { side: "friendly", datasheets: ["alpha-squad", "beta-squad"] })), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(armyRules(result.mechanics.effect)[0].modifier).toEqual({ rule: "composition", max: 0, datasheets: ["alpha-squad", "beta-squad"] });
    expect(result.checks).toContainEqual({ kind: "datasheets", parameters: { ids: ["alpha-squad", "beta-squad"] } });
  });

  it("keeps a keyword filter beside the datasheets", () => {
    const text = "You can include up to 2 ALPHA Alpha Squad units.";
    const [rule] = armyRules(effectOf(placed(text,
      ["include up to 2", army, { rule: "composition", max: 2, with: "following-filter" }],
      filter("ALPHA Alpha Squad units", { side: "friendly", keywords: ["ALPHA"], datasheets: ["alpha-squad"] })), text));
    expect(rule.modifier).toEqual({ rule: "composition", max: 2, with: { owner: "friendly", all_of: ["ALPHA"] }, datasheets: ["alpha-squad"] });
  });

  it("refuses a datasheet list outside a list-building group, and as a Warlord subject", () => {
    const select = "Select one Alpha Squad unit. That unit can make a Normal move.";
    expect(errorsOf(placed(select,
      ["Select one", "select-unit", { count: 1 }],
      filter("Alpha Squad unit", { side: "friendly", datasheets: ["alpha-squad"] }),
      ["That unit can make a Normal move", "make-move", { subject: "antecedent", move_type: "normal" }]), select)).toMatch(/outside army construction/);
    const warlord = "You cannot select an Alpha Squad model to be your Warlord.";
    expect(errorsOf(placed(warlord,
      ["You cannot select", army, { rule: "warlord-forbidden", with: "following-filter" }],
      filter("Alpha Squad model", { side: "friendly", datasheets: ["alpha-squad"] })), warlord)).toMatch(/cannot name its subject by datasheets/);
  });
});

describe("army-construction core checks", () => {
  it("checks a faction-forbidden rule's Army Faction and a group's datasheets against core", () => {
    const compiled = (text: string, ...leaves: Array<[string, string, Record<string, unknown>]>) => {
      const result = compileLeaves(placed(text, ...leaves), text);
      if (!result.ok) throw new Error(result.errors.join("; "));
      return coreCheckErrors(round5cDataRoot(), "fabricated-ability", result.checks);
    };
    const faction = "You cannot select DEATH GUARD as your Army Faction.";
    expect(compiled(faction, ["You cannot select DEATH GUARD as your Army Faction", army, { rule: "faction-forbidden", with_keywords: ["DEATH GUARD"] }])).toEqual([]);
    // A unit keyword is not an Army Faction: the ban is a composition rule with max 0.
    const unit = "You cannot select ALPHA as your Army Faction.";
    expect(compiled(unit, ["You cannot select ALPHA as your Army Faction", army, { rule: "faction-forbidden", with_keywords: ["ALPHA"] }]).join()).toMatch(/no core Army Faction: alpha/);
    const sheets = "Your army cannot include the following datasheets: Intercessor Squad, Alpha Squad.";
    expect(compiled(sheets,
      ["cannot include the following datasheets", army, { rule: "composition", max: 0, with: "following-filter" }],
      filter("Intercessor Squad, Alpha Squad", { side: "friendly", datasheets: ["intercessor-squad", "alpha-squad"] })).join()).toMatch(/no core unit: alpha-squad\.$/);
  });
});

describe("army contents as a condition (sub-shape D)", () => {
  it("gates a ban on the army including a filtered group", () => {
    const text = "If your army includes any ALPHA units (excluding BETA units), it cannot include GAMMA.";
    const effect = effectOf(placed(text,
      ["If your army includes any", "army-includes", { quantifier: "some", with: "following-filter" }],
      filter("ALPHA units", { side: "friendly", keywords: ["ALPHA"] }),
      filter("excluding BETA units", { side: "friendly", excluded_keywords: ["BETA"] }),
      ["it cannot include GAMMA", army, { rule: "composition", max: 0, with_keywords: ["GAMMA"] }]), text);
    expect(effect).toEqual({
      type: "conditional",
      condition: { type: "army-includes", parameters: { filter: { owner: "friendly", all_of: ["ALPHA"], none_of: ["BETA"] } } },
      effect: { type: "army-rule", target: "this-unit", modifier: { rule: "composition", max: 0, with: { all_of: ["GAMMA"] } } },
    });
  });

  it("reads \"every model has the keyword\" inline, and \"more than one\" as a minimum", () => {
    const every = "If every model in your army has the ALPHA or BETA keyword, you can include one GAMMA unit.";
    const gated = effectOf(placed(every,
      ["If every model in your army has the ALPHA or BETA keyword", "army-includes", { quantifier: "every", any_keywords: ["ALPHA", "BETA"], level: "model" }],
      ["include one", army, { rule: "composition", max: 1, with: "following-filter" }],
      filter("GAMMA unit", { side: "friendly", keywords: ["GAMMA"] })), every);
    expect(gated.condition).toEqual({ type: "army-includes", parameters: { filter: { owner: "friendly", any_of: ["ALPHA", "BETA"], level: "model" }, every: true } });
    const more = "If your army includes more than one ALPHA unit, it cannot include GAMMA.";
    const counted = effectOf(placed(more,
      ["If your army includes more than one", "army-includes", { quantifier: "some", with: "following-filter", min: 2 }],
      filter("ALPHA unit", { side: "friendly", keywords: ["ALPHA"] }),
      ["it cannot include GAMMA", army, { rule: "composition", max: 0, with_keywords: ["GAMMA"] }]), more);
    expect(counted.condition.parameters).toEqual({ filter: { owner: "friendly", all_of: ["ALPHA"] }, min: 2 });
  });

  it("negates an Army Faction", () => {
    const text = "If your Army Faction is not ALPHA LEGION, you can include one GAMMA unit.";
    const effect = effectOf(placed(text,
      ["If your Army Faction is not ALPHA LEGION", "army-faction", { faction: "alpha-legion", negated: true }],
      ["include one", army, { rule: "composition", max: 1, with: "following-filter" }],
      filter("GAMMA unit", { side: "friendly", keywords: ["GAMMA"] })), text);
    expect(effect.condition).toEqual({ operator: "not", operands: [{ type: "army-faction", parameters: { faction: "alpha-legion" } }] });
  });

  it("refuses a some-condition with no filter, and keyword or count misuse", () => {
    const text = "If your army includes any, it cannot include GAMMA.";
    expect(errorsOf(placed(text,
      ["If your army includes any", "army-includes", { quantifier: "some", with: "following-filter" }],
      ["it cannot include GAMMA", army, { rule: "composition", max: 0, with_keywords: ["GAMMA"] }]), text)).toMatch(/unit-filter right after it/);
    const includes = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("army-includes", parameters, currentFamilyVersion("army-includes"));
    expect(() => includes({ quantifier: "some", keywords: ["ALPHA"] })).toThrow(/unit-filter after it/);
    expect(() => includes({ quantifier: "every", keywords: ["ALPHA"] })).toThrow(/level model/);
    expect(() => includes({ quantifier: "every", keywords: ["ALPHA"], level: "model", min: 2 })).toThrow(/no min/);
  });
});

describe("Leader attachment eligibility (sub-shape E)", () => {
  const leaderGroup: Array<[string, string, Record<string, unknown>]> = [
    filter("CHARACTER unit", { side: "friendly", keywords: ["CHARACTER"] }),
    ["from your army", "unit-owner", { owner: "friendly" }],
    ["with the Leader ability", "unit-has-ability", { subject: "antecedent", ability: "leader" }],
    filter("excluding EPIC HEROES", { side: "friendly", excluded_keywords: ["EPIC HERO"] }),
  ];

  it("folds \"a Leader that can be attached to X can be attached to this unit instead\" into one rule", () => {
    const text = "If a CHARACTER unit from your army with the Leader ability (excluding EPIC HEROES) can be attached to an ALPHA unit, it can be attached to this unit instead.";
    const [rule] = armyRules(effectOf(placed(text,
      ...leaderGroup,
      ["can be attached to an", "leading-unit", { subject: "antecedent", attachment: "can-attach", object: "following-filter" }],
      filter("ALPHA unit", { side: "friendly", keywords: ["ALPHA"] }),
      ["it can be attached to this unit", army, { rule: "attachment", subject: "antecedent", object: "this-unit" }],
      ["instead", "instead", {}]), text));
    expect(rule).toEqual({ type: "army-rule", target: "this-unit", modifier: {
      rule: "attachment",
      with: { owner: "friendly", all_of: ["CHARACTER"], none_of: ["EPIC HERO"], has_ability: ["leader"] },
      attach_as: { owner: "friendly", all_of: ["ALPHA"] },
    } });
  });

  it("lets the bearer join a filtered unit, absorbing the Declare Battle Formations step", () => {
    const text = "In the Declare Battle Formations step, the bearer can be attached to an ALPHA or BETA unit.";
    const [rule] = armyRules(effectOf(placed(text,
      ["In the Declare Battle Formations step", "event", { kind: "battle-formations-declared" }],
      ["the bearer can be attached to an", army, { rule: "attachment", subject: "this-model", object: "following-filter" }],
      filter("ALPHA or BETA unit", { side: "friendly", any_keywords: ["ALPHA", "BETA"] })), text));
    expect(rule).toEqual({ type: "army-rule", target: "this-model", modifier: { rule: "attachment", can_lead: { owner: "friendly", any_of: ["ALPHA", "BETA"] } } });
  });

  it("refuses a can-attach outside the pattern, and an attachment antecedent without it", () => {
    const stray = "While this model can be attached to an ALPHA unit, add 1 to the Hit roll.";
    expect(errorsOf(placed(stray,
      ["can be attached to an", "leading-unit", { subject: "this-model", attachment: "can-attach", object: "following-filter" }],
      filter("ALPHA unit", { side: "friendly", keywords: ["ALPHA"] }),
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), stray)).toMatch(/can-attach/);
    const bare = "A CHARACTER unit can be attached to this unit.";
    expect(errorsOf(placed(bare,
      filter("CHARACTER unit", { side: "friendly", keywords: ["CHARACTER"] }),
      ["can be attached to this unit", army, { rule: "attachment", subject: "antecedent", object: "this-unit" }]), bare)).toMatch(/points back to a Leader/);
  });

  it("does not absorb an instead that follows anything else", () => {
    const text = "Your army cannot include ALPHA units instead.";
    expect(compileLeaves(placed(text,
      ["cannot include", army, { rule: "composition", max: 0, with: "following-filter" }],
      filter("ALPHA units", { side: "friendly", keywords: ["ALPHA"] }),
      ["instead", "instead", {}]), text).ok).toBe(false);
  });
});
