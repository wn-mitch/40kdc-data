import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createValidator } from "../src/schema-loader.js";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { familyExtension } from "../src/semantic-authoring/families/index.js";

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

// semantic-authoring-unit-state-values
{
/** The family versions the extensions under test create. */
const UNIT_STATE_AND_PRESENCE_VALUES_VERSIONS: ReadonlySet<string> = new Set(["unit-state@17", "unit-position@25", "unit-filter@15"]);

/** The version just below this wave's extension of `family`; later extensions may sit above it. */
function previousVersion(family: string): number {
  for (let version = currentFamilyVersion(family); version > 1; version -= 1) {
    const extension = familyExtension(family, version);
    if (extension !== undefined && UNIT_STATE_AND_PRESENCE_VALUES_VERSIONS.has(`${extension.family}@${extension.version}`)) return version - 1;
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
    expect(mechanics.effect.condition).toEqual({ type: "matches", parameters: { subject: { owner: "friendly", all_of: ["ALPHA"] }, filter: { state: "on-battlefield" } } });
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
    expect(targeting.effect.condition).toEqual({ operator: "not", operands: [{ type: "matches", parameters: { subject: { owner: "friendly", excluding: "this-unit" }, filter: { engaged_with: "defender" } } }] });
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
    expect(norm("unit-filter", { side: "friendly", other: true, other_than: "event-subject" })).toMatchObject({ other: true, other_than: "event-subject" });
    expect(() => norm("unit-filter", { side: "friendly", other_than: "event-subject" })).toThrow();
    expect(() => norm("unit-filter", { side: "friendly", other: false, other_than: "event-subject" })).toThrow();
    expect(() => norm("unit-filter", { side: "friendly", other: true, other_than: "this-unit" })).toThrow();
    expect(() => norm("unit-filter", { side: "friendly", other: true, other_than: "event-subject" }, previousVersion("unit-filter"))).toThrow();
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
    const within = { type: "matches", parameters: { subject: { owner: "friendly", all_of: ["ALPHA"], level: "model" }, filter: { within: { of: "this-unit", range: { inches: 6 } } } } };
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
    expect(mechanics.effect.condition.operands[1]).toEqual({ operator: "not", operands: [{ type: "matches", parameters: { subject: "this-model", filter: { state: "engaged" } } }] });
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
      { type: "matches", parameters: { subject: "selected-unit", filter: { has_ability: ["beacon"] } } },
      { operator: "not", operands: [{ type: "attachment", parameters: { subject: "selected-unit", role: "attached" } }] },
      { operator: "not", operands: [{ type: "matches", parameters: { subject: "selected-unit", filter: { within: { of: "this-model", range: { inches: 12 } } } } }] },
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
}

// semantic-authoring-unit-position-values-t8
{
/** The family versions the extensions under test create. */
const UNIT_POSITION_AND_REGION_VALUES_VERSIONS: ReadonlySet<string> = new Set(["unit-position@24"]);

const REGION = { region_id: "the-shadow-of-chaos", owner_faction: "chaos-daemons" };
const AREA_TEXT = "The area around this model is held in the Zed zone.";
const areaLeaves = (side: string) => placed(AREA_TEXT,
  ["The area around this model", "unit-filter", { side }],
  ["around this model", "aura-range", { inches: 6, of: "this-model" }],
  ["is held in the Zed zone", "counts-as", { subject: "antecedent", region: REGION }]);

const validEffect = createValidator().compile({ $ref: "https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json#/$defs/effect-node" });

/** The version just before this extension of unit-position; later extensions may sit above it. */
const PREVIOUS = (() => {
  for (let version = currentFamilyVersion("unit-position"); version > 1; version -= 1) {
    const extension = familyExtension("unit-position", version);
    if (extension !== undefined && UNIT_POSITION_AND_REGION_VALUES_VERSIONS.has(`${extension.family}@${extension.version}`)) return version - 1;
  }
  throw new Error("The unit-position and region values extension is not registered.");
})();
const CURRENT = currentFamilyVersion("unit-position");
const normalize = (parameters: Record<string, unknown>, version = CURRENT) => normalizeFingerprintParameters("unit-position", parameters, version);
const WITHIN = { kind: "within", inches: 3, subject: "this-unit", negated: false };

describe("unit-position place values (family version)", () => {
  it("accepts a distance from the battlefield centre and refuses it one version earlier", () => {
    const leaf = { ...WITHIN, of: "battlefield-centre" };
    expect(normalize(leaf)).toEqual(leaf);
    expect(() => normalize(leaf, PREVIOUS)).toThrow();
    expect(normalize({ ...leaf, kind: "beyond" })).toMatchObject({ kind: "beyond", of: "battlefield-centre" });
  });

  it("refuses the centre for objective-range and closest-eligible", () => {
    expect(() => normalize({ kind: "objective-range", subject: "this-unit", negated: false, of: "battlefield-centre" })).toThrow();
    expect(() => normalize({ kind: "closest-eligible", subject: "this-unit", negated: false, of: "battlefield-centre" })).toThrow();
  });

  it("refuses a named range, a weapon distance or an every-model test against a place", () => {
    for (const extra of [{ range_ref: "contagion" }, { distance: "half-weapon" }, { weapon_range: "half" }, { models: "every" }]) {
      expect(() => normalize({ ...WITHIN, of: "battlefield-centre", ...extra })).toThrow();
      expect(() => normalize({ ...WITHIN, of: "enemy-deployment-zone", ...extra })).toThrow();
    }
  });

  it("accepts wholly within the enemy deployment zone, and keeps the beyond rule", () => {
    const leaf = { ...WITHIN, inches: 12, of: "enemy-deployment-zone", wholly: true };
    expect(normalize(leaf)).toEqual(leaf);
    expect(() => normalize(leaf, PREVIOUS)).toThrow();
    const { wholly: _wholly, ...plain } = leaf;
    expect(normalize(plain)).toEqual(plain);
    expect(() => normalize({ ...leaf, kind: "beyond" })).toThrow();
    expect(normalize({ ...WITHIN, kind: "beyond", of: "enemy-deployment-zone" })).toMatchObject({ kind: "beyond", of: "enemy-deployment-zone" });
    expect(normalize({ ...WITHIN, kind: "beyond", of: "enemy-deployment-zone" }, PREVIOUS)).toMatchObject({ kind: "beyond" });
  });

  it("refuses an objective marker's fields on the deployment zone", () => {
    expect(() => normalize({ ...WITHIN, of: "enemy-deployment-zone", objective_tag: "alpha-tag" })).toThrow();
    expect(() => normalize({ ...WITHIN, of: "enemy-deployment-zone", controlled_by: "you" })).toThrow();
  });

  it("accepts the event's object as the subject and refuses it for closest-eligible", () => {
    const leaf = { ...WITHIN, of: "this-model", subject: "event-object" };
    expect(normalize(leaf)).toEqual(leaf);
    expect(() => normalize(leaf, PREVIOUS)).toThrow();
    expect(normalize({ kind: "objective-range", subject: "event-object", controlled_by: "any", negated: false })).toMatchObject({ subject: "event-object" });
    expect(() => normalize({ kind: "closest-eligible", subject: "event-object", negated: false, to: "this-unit" })).toThrow();
  });

  it("keeps every authored value when two new values share one leaf", () => {
    const centre = { ...WITHIN, of: "battlefield-centre", subject: "event-object" };
    expect(normalize(centre)).toEqual(centre);
    const zone = { ...WITHIN, inches: 12, of: "enemy-deployment-zone", wholly: true, subject: "event-object" };
    expect(normalize(zone)).toEqual(zone);
  });

  it("still accepts every of and subject value the previous version accepted", () => {
    for (const of of ["this-unit", "this-model", "target", "attacker", "event-subject", "recipient", "selected-unit", "event-object", "antecedent", "battlefield-edge", "following-filter"]) {
      const leaf = { ...WITHIN, of };
      expect(normalize(leaf)).toEqual(normalize(leaf, PREVIOUS));
      expect(normalize(leaf)).toEqual(leaf);
    }
    for (const subject of ["this-unit", "this-model", "target", "attacker", "event-subject", "recipient", "selected-unit", "antecedent", "bearer-transport", "each-target"]) {
      const leaf = { kind: "objective-range", subject, controlled_by: "any", negated: false };
      expect(normalize(leaf)).toEqual(normalize(leaf, PREVIOUS));
    }
    const edge = { ...WITHIN, of: "battlefield-edge", wholly: true };
    expect(normalize(edge)).toEqual(edge);
    expect(normalize({ kind: "closest-eligible", subject: "target", negated: false, to: "this-unit", range: 6 })).toBeDefined();
  });
});

describe("unit-position place values (compile)", () => {
  it("lowers a distance from the centre of the battlefield of the event's object", () => {
    const text = "Just after an enemy unit selects targets, if that unit is within 3 of the centre, this model gains Zed.";
    const mechanics = mechanicsOf(placed(text,
      ["Just after an enemy unit selects targets", "event", { kind: "enemy-selected-targets" }],
      ["that unit is within 3 of the centre", "unit-position", { kind: "within", inches: 3, of: "battlefield-centre", subject: "event-object", negated: false }],
      ["this model gains Zed", "core-ability-grant", { subject: "this-model", ability: "benefit-of-cover" }]), text);
    expect(mechanics.effect.condition).toEqual({ type: "matches", parameters: { subject: "event-object", filter: { within: { of: "battlefield-centre", range: { inches: 3 } } } } });
    expect(validEffect(mechanics.effect), JSON.stringify(validEffect.errors?.slice(0, 2))).toBe(true);
  });

  it("keeps wholly on a distance from the centre and negates a beyond distance", () => {
    const text = "While this unit is wholly within 6 of the centre, it gains Zed.";
    const wholly = mechanicsOf(placed(text,
      ["While this unit is wholly within 6 of the centre", "unit-position", { kind: "within", inches: 6, wholly: true, of: "battlefield-centre", subject: "this-unit", negated: false }],
      ["it gains Zed", "core-ability-grant", { subject: "this-unit", ability: "benefit-of-cover" }]), text);
    expect(JSON.stringify(wholly.effect)).toContain('"of":"battlefield-centre","range":{"inches":6},"wholly":true');
    const beyond = mechanicsOf(placed(text,
      ["While this unit is wholly within 6 of the centre", "unit-position", { kind: "beyond", inches: 6, of: "battlefield-centre", subject: "this-unit", negated: false }],
      ["it gains Zed", "core-ability-grant", { subject: "this-unit", ability: "benefit-of-cover" }]), text);
    expect(JSON.stringify(beyond.effect)).toMatch(/"operator":"not".*"of":"battlefield-centre"/u);
  });

  it("lowers wholly within a distance of the enemy deployment zone with the wholly flag", () => {
    const text = "While this model is wholly within 12 of the far zone, it gains Zed.";
    const body = ["it gains Zed", "core-ability-grant", { subject: "this-model", ability: "benefit-of-cover" }] as [string, string, Record<string, unknown>];
    const position = (extra: Record<string, unknown>): [string, string, Record<string, unknown>] =>
      ["While this model is wholly within 12 of the far zone", "unit-position", { kind: "within", inches: 12, of: "enemy-deployment-zone", subject: "this-model", negated: false, ...extra }];
    const wholly = mechanicsOf(placed(text, position({ wholly: true }), body), text);
    expect(JSON.stringify(wholly.effect)).toContain('"subject":"this-model","filter":{"within":{"of":{"territory":"enemy-deployment-zone"},"range":{"inches":12},"wholly":true}}');
    expect(validEffect(wholly.effect), JSON.stringify(validEffect.errors?.slice(0, 2))).toBe(true);
    const plain = mechanicsOf(placed(text, position({}), body), text);
    expect(JSON.stringify(plain.effect)).not.toContain('"wholly"');
  });

  const SET_UP = ["Set this unit up on the battlefield", "set-up", { subject: "this-unit", to: "battlefield" }] as [string, string, Record<string, unknown>];

  it("carries a set-up's distance from the centre into placement.near, never drops it", () => {
    const text = "Set this unit up on the battlefield within 9 of the centre.";
    const mechanics = mechanicsOf(placed(text, SET_UP,
      ["within 9 of the centre", "unit-position", { kind: "within", inches: 9, of: "battlefield-centre", subject: "antecedent", negated: false }]), text);
    expect(mechanics.effect.modifier.near).toEqual([{ of: "battlefield-centre", range: { inches: 9 } }]);
    expect(validEffect(mechanics.effect), JSON.stringify(validEffect.errors?.slice(0, 2))).toBe(true);
  });

  it("carries a set-up's wholly-within distance of the enemy deployment zone into placement.near, and the beyond form into away_from", () => {
    const text = "Set this unit up on the battlefield wholly within 9 of the far zone.";
    const near = mechanicsOf(placed(text, SET_UP,
      ["wholly within 9 of the far zone", "unit-position", { kind: "within", inches: 9, wholly: true, of: "enemy-deployment-zone", subject: "antecedent", negated: false }]), text);
    expect(near.effect.modifier.near).toEqual([{ of: { territory: "enemy-deployment-zone" }, range: { inches: 9 }, wholly: true }]);
    expect(validEffect(near.effect), JSON.stringify(validEffect.errors?.slice(0, 2))).toBe(true);
    const away = mechanicsOf(placed("Set this unit up on the battlefield more than 9 from the far zone.", SET_UP,
      ["more than 9 from the far zone", "unit-position", { kind: "beyond", inches: 9, of: "enemy-deployment-zone", subject: "antecedent", negated: false }]), "Set this unit up on the battlefield more than 9 from the far zone.");
    expect(away.effect.modifier.away_from).toEqual([{ of: { territory: "enemy-deployment-zone" }, range: { inches: 9 } }]);
    expect(away.effect.modifier.near).toBeUndefined();
  });
});

describe("an area held in a rule region reaches units of either side", () => {
  const REGION = { region_id: "the-zed-zone", owner_faction: "alpha-faction" };
  const TEXT = "The area around this model is held in the Zed zone.";
  const leaves = (side: string, body: [string, string, Record<string, unknown>] = ["is held in the Zed zone", "counts-as", { subject: "antecedent", region: REGION }]) => placed(TEXT,
    ["The area", "unit-filter", { side }],
    ["around this model", "aura-range", { inches: 6, of: "this-model" }],
    body);

  it("lowers to one counts-as over the units of either side within the range, not an aura or a sequence", () => {
    const mechanics = mechanicsOf(leaves("any"), TEXT);
    expect(mechanics.effect).toEqual({
      type: "counts-as",
      target: { owner: "any", within: { range: { inches: 6 }, of: "this-model" } },
      modifier: { in_region: { rule_region: REGION } },
    });
    expect(validEffect(mechanics.effect), JSON.stringify(validEffect.errors?.slice(0, 2))).toBe(true);
  });

  it("keeps wholly on the range", () => {
    const list = leaves("any");
    list[1] = { ...list[1]!, parameters: { ...list[1]!.parameters, wholly: true } };
    expect(mechanicsOf(list, TEXT).effect.target.within).toEqual({ range: { inches: 6 }, of: "this-model", wholly: true });
  });

  it("still refuses an aura over either side whose body is not a region grant", () => {
    const body: [string, string, Record<string, unknown>] = ["is held in the Zed zone", "characteristic-modifier", { subject: "antecedent", characteristic: "move", operation: "add", value: 1 }];
    expect(errorsOf(leaves("any", body), TEXT)).toMatch(/must say friendly or enemy/u);
  });

  it("refuses a model-level either-side aura but preserves a keyword-limited region grant", () => {
    const model = placed(TEXT,
      ["The area", "unit-filter", { side: "any", level: "model" }],
      ["around this model", "aura-range", { inches: 6, of: "this-model" }],
      ["is held in the Zed zone", "counts-as", { subject: "antecedent", region: REGION }]);
    expect(errorsOf(model, TEXT)).toMatch(/must say friendly or enemy/u);
    const keyworded = placed(TEXT,
      ["The area", "unit-filter", { side: "any", keywords: ["ALPHA"] }],
      ["around this model", "aura-range", { inches: 6, of: "this-model" }],
      ["is held in the Zed zone", "counts-as", { subject: "antecedent", region: REGION }]);
    expect(mechanicsOf(keyworded, TEXT).effect.target).toEqual({ owner: "any", all_of: ["ALPHA"], within: { range: { inches: 6 }, of: "this-model" } });
  });

  it("compiles friendly and enemy auras as before", () => {
    const friendly = mechanicsOf(leaves("friendly"), TEXT);
    expect(friendly.effect).toMatchObject({ type: "aura", target: "friendly-within-aura", modifier: { range: { inches: 6 }, effect: { type: "counts-as" } } });
    const enemy = mechanicsOf(leaves("enemy"), TEXT);
    expect(enemy.effect).toMatchObject({ type: "aura", target: "enemy-within-aura" });
  });
});

describe("the round-6 overrides for a region grant", () => {
  it("give every counts-as in the Shadow of Chaos to units of either side", () => {
    const overrides = JSON.parse(readFileSync(new URL("../src/round6/vocab-overrides.json", import.meta.url), "utf8")) as unknown;
    const grants: Array<{ target?: { owner?: string } }> = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node !== null && typeof node === "object") {
        const record = node as Record<string, any>;
        if (record.type === "counts-as" && record.modifier?.in_region?.rule_region?.region_id === "the-shadow-of-chaos") grants.push(record);
        Object.values(record).forEach(walk);
      }
    };
    walk(overrides);
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) expect(grant.target?.owner).toBe("any");
  });
});
}
