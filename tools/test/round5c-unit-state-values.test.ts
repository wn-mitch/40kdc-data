import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { familyExtension } from "../src/round5c/family-extensions.js";
import { FAMILY_EXTENSIONS_20_UNIT_STATE_AND_PRESENCE_VALUES } from "../src/round5c/family-extensions-20-unit-state-and-presence-values.js";

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

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(list: CompileLeaf[], text: string): string {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error("expected a refusal, but the leaves compiled");
  return result.errors.join("; ");
}

/** The version just below this wave's extension of `family`; later extensions may sit above it. */
function previousVersion(family: string): number {
  for (let version = currentFamilyVersion(family); version > 1; version -= 1) {
    const extension = familyExtension(family, version);
    if (extension !== undefined && FAMILY_EXTENSIONS_20_UNIT_STATE_AND_PRESENCE_VALUES.includes(extension)) return version - 1;
  }
  throw new Error(`The unit-state-and-presence-values wave does not extend ${family}.`);
}

const norm = (family: string, parameters: Record<string, unknown>, version = currentFamilyVersion(family)) => normalizeFingerprintParameters(family, parameters, version);

describe("filtered-units presence (a condition on the units a bare unit-filter names)", () => {
  const text = "If one or more ALPHA units from your army are on the battlefield when you use the Beacon, subtract 1 from the Battle-shock test each enemy unit must take as a result.";
  const leaves = (state: Record<string, unknown>) => placed(text,
    ["ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
    ["from your army", "unit-owner", { owner: "friendly" }],
    ["are on the battlefield", "unit-state", state],
    ["when you use the Beacon", "event", { kind: "used", activity: "ability" }],
    ["subtract 1 from the Battle-shock test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1, subject: "antecedent" }],
    ["each enemy unit", "unit-filter", { side: "enemy" }]);

  it("gates the effect on any such unit being on the battlefield and leaves the trigger without a subject", () => {
    const mechanics = mechanicsOf(leaves({ states: ["on-battlefield"], subject: "filtered-units", negated: false }), text);
    expect(mechanics.effect.condition).toEqual({ type: "unit-state", parameters: { subject: { owner: "friendly", all_of: ["ALPHA"] }, state: "on-battlefield" } });
    expect(mechanics.effect.effect.target).toEqual({ owner: "enemy" });
    expect(mechanics.trigger.subject).toBeUndefined();
  });

  it("still binds the antecedent form of the same leaves to the moment's unit", () => {
    const mechanics = mechanicsOf(leaves({ states: ["on-battlefield"], subject: "antecedent", negated: false }), text);
    expect(mechanics.effect.condition.parameters.subject).toBe("event-subject");
    expect(mechanics.trigger.subject).toEqual({ owner: "friendly", all_of: ["ALPHA"] });
  });

  it("refuses filtered-units with no unit-filter before it", () => {
    const bare = "If they are on the battlefield, subtract 1 from the Battle-shock test each enemy unit must take.";
    const list = placed(bare,
      ["are on the battlefield", "unit-state", { states: ["on-battlefield"], subject: "filtered-units", negated: false }],
      ["subtract 1 from the Battle-shock test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }]);
    expect(errorsOf(list, bare)).toMatch(/names the units of a unit-filter, but none sits right before it/u);
  });
});

describe("no other friendly units engaged with that enemy unit", () => {
  const own = "When making ranged attacks with its mortar, this model can target enemy units within Engagement Range of it (provided no other friendly units are also within Engagement Range of that enemy unit). In addition, when making ranged attacks, this model ignores the hit penalty.";
  const ownLeaves = () => placed(own,
    ["ranged attacks", "attack-filter", { attack_type: "ranged" }],
    ["with its mortar", "attack-filter", { weapon_name: "mortar" }],
    ["this model can target enemy units within Engagement Range of it", "targeting-restriction", { subject: "this-model", may: "target", kind: "shoot", weapon_type: "ranged" }],
    ["no other friendly units", "unit-filter", { side: "friendly", other: true }],
    ["are also within Engagement Range of that enemy unit", "unit-state", { states: ["engaged"], subject: "filtered-units", negated: true, with: "target" }],
    ["ranged attacks", "attack-filter", { attack_type: "ranged" }],
    ["this model ignores the hit penalty", "ignore-modifiers", { subject: "this-model", what: ["rolls"], rolls: ["hit"], only: "worsening" }]);

  it("gates only the targeting effect, as other than this unit; an In addition sentence keeps its own gate", () => {
    const [targeting, ignoring] = mechanicsOf(ownLeaves(), own).effect.steps;
    expect(targeting.effect.condition).toEqual({ operator: "not", operands: [{ type: "unit-state", parameters: { subject: { owner: "friendly", excluding: "this-unit" }, state: "engaged", with: "defender" } }] });
    expect(targeting.effect.effect.type).toBe("targeting");
    expect(JSON.stringify(ignoring)).not.toContain("engaged");
  });

  const shot = "When a friendly unit is selected to shoot, it can target enemy units within Engagement Range of it (provided no other friendly units are also within Engagement Range of that enemy unit).";
  const shotLeaves = (filter: Record<string, unknown>) => placed(shot,
    ["a friendly unit", "unit-filter", { side: "friendly" }],
    ["is selected to shoot", "event", { kind: "selected", to: "shoot" }],
    ["it can target enemy units within Engagement Range of it", "eligibility-permission", { subject: "antecedent", activity: "shoot", allow: true, despite: ["engaged"] }],
    ["no other friendly units", "unit-filter", filter],
    ["are also within Engagement Range of that enemy unit", "unit-state", { states: ["engaged"], subject: "filtered-units", negated: true, with: "target" }]);

  it("other_than event-subject excludes the selected unit and the proviso gates the permission to that unit", () => {
    const { effect } = mechanicsOf(shotLeaves({ side: "friendly", other: true, other_than: "event-subject" }), shot);
    expect(effect.condition.operands[0].parameters.subject).toEqual({ owner: "friendly", excluding: "event-subject" });
    expect(effect.effect).toMatchObject({ type: "permission", target: "event-subject" });
  });

  it("other without other_than still excludes the unit with the ability", () => {
    const { effect } = mechanicsOf(shotLeaves({ side: "friendly", other: true }), shot);
    expect(effect.condition.operands[0].parameters.subject).toEqual({ owner: "friendly", excluding: "this-unit" });
  });

  it("refuses other_than without other, and any other_than value", () => {
    const version = currentFamilyVersion("unit-filter");
    expect(norm("unit-filter", { side: "friendly", other: true, other_than: "event-subject" })).toMatchObject({ other: true, other_than: "event-subject" });
    expect(() => norm("unit-filter", { side: "friendly", other_than: "event-subject" })).toThrow();
    expect(() => norm("unit-filter", { side: "friendly", other: false, other_than: "event-subject" })).toThrow();
    expect(() => norm("unit-filter", { side: "friendly", other: true, other_than: "this-unit" })).toThrow();
    expect(() => norm("unit-filter", { side: "friendly", other: true, other_than: "event-subject" }, version - 1)).toThrow();
    expect(norm("unit-filter", { side: "friendly", other: true })).toEqual(norm("unit-filter", { side: "friendly", other: true }, previousVersion("unit-filter")));
  });
});

describe("a conditional bonus on the ability's own roll (filtered-units position)", () => {
  const text = "Each time you target the bearer's unit with a Stratagem, roll one D6, adding 1 to the result if there are one or more friendly ALPHA models within 6\": on a 5+, you gain 1CP.";
  const leaves = (subject: string) => placed(text,
    ["Each time you target the bearer's unit with a Stratagem", "event", { kind: "used", activity: "stratagem" }],
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["adding 1 to the result", "roll-modifier", { roll: "preceding", operation: "add", value: 1 }],
    ["friendly ALPHA models", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
    ["within 6\"", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject, negated: false }],
    ["on a 5+", "roll-result", { from: 5 }],
    ["you gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]);

  it("selects the boosted dice when any such model is within range, and the plain dice otherwise", () => {
    const [boosted, plain] = mechanicsOf(leaves("filtered-units"), text).effect.steps;
    const within = { type: "within", parameters: { subject: { owner: "friendly", all_of: ["ALPHA"], level: "model" }, of: "this-unit", range: { inches: 6 } } };
    expect(boosted.condition).toEqual(within);
    expect(boosted.effect.dice).toBe("D6+1");
    expect(plain.condition).toEqual({ operator: "not", operands: [within] });
    expect(plain.effect.dice).toBe("D6");
  });

  it("still refuses the antecedent form (a conditional change to the ability's own roll)", () => {
    expect(errorsOf(leaves("antecedent"), text)).toMatch(/conditional change to this ability's own roll/u);
  });

  it("accepts filtered-units on unit-position at the current version and not the one before", () => {
    const params = { kind: "within", inches: 6, of: "this-unit", subject: "filtered-units", negated: false };
    expect(norm("unit-position", params)).toEqual(params);
    expect(() => norm("unit-position", params, previousVersion("unit-position"))).toThrow();
    const earlier = { kind: "within", inches: 6, of: "this-unit", subject: "this-unit", negated: false };
    expect(norm("unit-position", earlier)).toEqual(norm("unit-position", earlier, previousVersion("unit-position")));
  });
});

describe("unit-state: filtered-units and a this-model engagement", () => {
  const version = () => currentFamilyVersion("unit-state");
  const engagedModel = { states: ["engaged"], subject: "this-model", negated: false };

  it("accepts filtered-units with every state and qualifier a this-unit subject takes, and not at the previous version", () => {
    for (const params of [
      { states: ["on-battlefield"], subject: "filtered-units", negated: false },
      { states: ["engaged"], subject: "filtered-units", negated: true, with: "target" },
    ]) {
      expect(norm("unit-state", params)).toEqual(params);
      expect(() => norm("unit-state", params, previousVersion("unit-state"))).toThrow();
    }
    expect(() => norm("unit-state", { states: ["battle-shocked"], subject: "this-model", negated: false })).toThrow();
  });

  it("accepts a this-model engagement negated, with a target, and at the phase start; refuses the model engaged with itself", () => {
    for (const extra of [{ negated: true }, { with: "target", at: "phase-start" }, { with: "following-filter" }]) {
      const params = { ...engagedModel, ...extra };
      expect(norm("unit-state", params)).toEqual(params);
      expect(() => norm("unit-state", params, previousVersion("unit-state"))).toThrow();
    }
    expect(() => norm("unit-state", { ...engagedModel, with: "this-model" })).toThrow(/cannot be engaged with itself/u);
  });

  it("still refuses a this-model battle-shocked or multi-state condition", () => {
    expect(() => norm("unit-state", { states: ["battle-shocked"], subject: "this-model", negated: false })).toThrow(/only being on the battlefield/u);
    expect(() => norm("unit-state", { states: ["engaged", "on-battlefield"], subject: "this-model", negated: false })).toThrow(/only being on the battlefield/u);
  });

  it("returns the previous version's result for every input it accepted", () => {
    const accepted: Array<Record<string, unknown>> = [
      { states: ["engaged"], subject: "this-unit", negated: true },
      { states: ["engaged"], subject: "this-model", negated: false },
      { states: ["on-battlefield"], subject: "this-model", negated: false },
      { states: ["engaged"], subject: "antecedent", negated: false, with: "event-subject", at: "phase-start" },
      { states: ["in-strategic-reserves"], subject: "this-unit", negated: false },
    ];
    for (const params of accepted) expect(norm("unit-state", params)).toEqual(norm("unit-state", params, previousVersion("unit-state")));
    expect(version()).toBeGreaterThan(previousVersion("unit-state"));
  });

  it("lowers a negated this-model engagement to not(unit-state this-model engaged)", () => {
    const text = "Once per turn, when an enemy unit ends a Normal move within 8\" of this model, if this model is not within Engagement Range of one or more enemy units, it can shoot as if it were your Shooting phase.";
    const list = placed(text,
      ["Once per turn", "usage-limit", { frequency: "once-per-turn", per: "unit" }],
      ["an enemy unit", "unit-filter", { side: "enemy" }],
      ["ends a Normal move", "event", { kind: "move-ended", move_types: ["normal"] }],
      ["within 8\" of this model", "unit-position", { kind: "within", inches: 8, of: "this-model", subject: "event-subject", negated: false }],
      ["this model is not within Engagement Range of one or more enemy units", "unit-state", { ...engagedModel, negated: true }],
      ["it can shoot as if it were your Shooting phase", "eligibility-permission", { subject: "this-model", activity: "shoot", allow: true, as_if: "shooting-phase" }]);
    const mechanics = mechanicsOf(list, text);
    expect(mechanics.effect.condition.operands[1]).toEqual({ operator: "not", operands: [{ type: "unit-state", parameters: { subject: "this-model", state: "engaged" } }] });
    expect(mechanics.effect.effect.target).toBe("this-model");
  });
});

describe("condition-exclusion (a group of conditions excluded together)", () => {
  const text = "In your Shooting phase, select one enemy unit within 18\" of and visible to this model (excluding units with the Beacon ability that are not part of an Attached unit and are not within 12\" of this model) and roll four D6: for each 4+, that enemy unit suffers 1 mortal wound.";
  const base = (middle: Array<[string, string, Record<string, unknown>]>) => placed(text,
    ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["within 18\" of", "unit-position", { kind: "within", inches: 18, of: "this-model", subject: "antecedent", negated: false }],
    ["visible to this model", "visible", { subject: "antecedent", to: "this-model" }],
    ...middle,
    ["are not within 12\" of this model", "unit-position", { kind: "within", inches: 12, of: "this-model", subject: "antecedent", negated: true }],
    ["roll four D6", "dice-roll", { dice: "D6", count: 4 }],
    ["for each 4+", "roll-result", { from: 4 }],
    ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]);
  const group: Array<[string, string, Record<string, unknown>]> = [
    ["excluding", "condition-exclusion", {}],
    ["units with the Beacon ability", "unit-has-ability", { subject: "antecedent", ability: "beacon" }],
    ["that are not part of an Attached unit", "leading-unit", { subject: "antecedent", attachment: "any", negated: true }]];

  it("excludes the units meeting every condition of the group, inside the selection's eligibility", () => {
    const eligibility = mechanicsOf(base(group), text).effect.effect.selector.eligibility.operands;
    expect(eligibility).toHaveLength(3);
    expect(eligibility[2]).toEqual({ operator: "not", operands: [{ operator: "and", operands: [
      { type: "has-ability", parameters: { subject: "selected-unit", ability: "beacon" } },
      { operator: "not", operands: [{ type: "attachment", parameters: { subject: "selected-unit", role: "attached" } }] },
      { operator: "not", operands: [{ type: "within", parameters: { subject: "selected-unit", of: "this-model", range: { inches: 12 } } }] },
    ] }] });
  });

  it("without the marker the same conditions are read as separate requirements, not an exclusion", () => {
    const [, , , , ...rest] = base(group);
    const without = mechanicsOf([...base(group).slice(0, 4), ...rest.slice(1)], text).effect.effect.selector.eligibility.operands;
    expect(JSON.stringify(without)).not.toContain('"operator":"not","operands":[{"operator":"and"');
  });

  it("refuses a marker with no condition before its group ends", () => {
    const bare = "Select one enemy unit (excluding) and roll a D6.";
    const list = placed(bare, ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }], ["excluding", "condition-exclusion", {}], ["roll a D6", "dice-roll", { dice: "D6" }]);
    expect(errorsOf(list, bare)).toMatch(/no condition after it before its group ends/u);
  });

  it("refuses a unit-filter inside the group", () => {
    const list = base([...group.slice(0, 1), ["units with the Beacon ability", "unit-filter", { side: "enemy" }], group[2]!]);
    expect(errorsOf(list, text)).not.toBe("");
  });

  it("refuses a marker when the source text is missing", () => {
    const result = compileLeaves(base(group));
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join("; ")).toMatch(/needs the source text/u);
  });
});
