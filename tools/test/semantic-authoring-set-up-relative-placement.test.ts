import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";

const effectSchema = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: fragment ?? "RAW_TEXT" };
  });
}

function mechanicsOf(text: string, ...items: Item[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(text: string, ...items: Item[]): string {
  const result = compileLeaves(placed(text, ...items), text);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics.effect)}`);
  return result.errors.join("; ");
}

const ADD: Item = ["add a new Spore Pod unit to your army", "add-unit", { source: "datasheet", datasheet: "spore-pod", count: "1" }];
const TRIGGER: Item = ["Each time this model shoots", "event", { kind: "after-shooting" }];
const PERMITTED_LIMIT = (wording = "within Engagement Range of the destroyed model's unit"): Item =>
  [wording, "unit-position", { kind: "within", range_ref: "engagement", of: "event-object", subject: "antecedent", negated: false }];
const PERMISSION_UNIT: Item = ["that Spore Pod unit", "unit-filter", { side: "friendly", keywords: ["SPORE POD"] }];

describe("Semantic authoring set-up relative placement: the add-unit permission (SS4)", () => {
  const text = "Each time this model shoots, add a new Spore Pod unit to your army and set it up within 3\" of this model. If you do, that Spore Pod unit can be set up within Engagement Range of the destroyed model's unit.";
  const permitted: Item[] = [
    TRIGGER, ADD,
    ["set it up", "set-up", { subject: "antecedent", to: "battlefield" }],
    ["within 3\" of this model", "unit-position", { kind: "within", inches: 3, of: "this-model", subject: "antecedent", negated: false }],
    PERMISSION_UNIT,
    ["can be set up", "set-up", { subject: "antecedent", to: "battlefield" }],
    PERMITTED_LIMIT(),
  ];
  // The add-unit directly followed by the permission sentence (no placement limit before it).
  const bare = "Each time this model shoots, add a new Spore Pod unit to your army. If you do, that Spore Pod unit can be set up within Engagement Range of the destroyed model's unit.";
  const bareLeaves = (...extra: Item[]): Item[] => [TRIGGER, ADD, PERMISSION_UNIT, ["can be set up", "set-up", { subject: "antecedent", to: "battlefield" }], ...extra];

  it("lowers the permission to allow_engagement_with and keeps the set-up's near limit on the add-unit", () => {
    const mechanics = mechanicsOf(text, ...permitted);
    expect(mechanics.effect).toEqual({
      type: "add-unit", target: "this-unit",
      modifier: { datasheet: "spore-pod", count: 1, near: [{ of: "this-model", range: { inches: 3 } }], allow_engagement_with: "event-object" },
    });
  });

  it("lowers a permission with no placement limit before it, and emits no set-up effect for the permission", () => {
    const mechanics = mechanicsOf(bare, ...bareLeaves(PERMITTED_LIMIT()));
    expect(mechanics.effect).toEqual({ type: "add-unit", target: "this-unit", modifier: { datasheet: "spore-pod", count: 1, allow_engagement_with: "event-object" } });
  });

  it("emits an add-unit whose allow_engagement_with the effect schema accepts", () => {
    const mechanics = mechanicsOf(bare, ...bareLeaves(PERMITTED_LIMIT()));
    expect(effectSchema(mechanics.effect)).toBe(true);
  });

  it("refuses a permission limit that measures to a different unit than the destroyed one", () => {
    expect(errorsOf(bare, ...bareLeaves(["within Engagement Range of the destroyed model's unit", "unit-position",
      { kind: "within", range_ref: "engagement", of: "this-model", subject: "antecedent", negated: false }]))).toMatch(/no DSL form beyond Engagement Range/u);
  });

  it("refuses a permission limit that is negated or has a distance", () => {
    expect(errorsOf(bare, ...bareLeaves(["within Engagement Range of the destroyed model's unit", "unit-position",
      { kind: "within", range_ref: "engagement", of: "event-object", subject: "antecedent", negated: true }]))).toMatch(/no DSL form beyond Engagement Range/u);
    expect(errorsOf(bare, ...bareLeaves(["within Engagement Range of the destroyed model's unit", "unit-position",
      { kind: "within", inches: 1, of: "event-object", subject: "antecedent", negated: false }]))).toMatch(/no DSL form beyond Engagement Range/u);
  });

  it("refuses a permission set-up that carries its own placement", () => {
    expect(errorsOf(bare, TRIGGER, ADD, PERMISSION_UNIT,
      ["can be set up", "set-up", { subject: "antecedent", to: "battlefield", placement: "unengaged" }], PERMITTED_LIMIT())).toMatch(/own placement/u);
  });

  it("refuses a permission whose sentence has no add-unit before it", () => {
    const selected = "Select one friendly unit. If you do, that Spore Pod unit can be set up within Engagement Range of the destroyed model's unit.";
    expect(errorsOf(selected, ["Select one friendly unit", "select-unit", { scope: "friendly", distance: "any", visible: false }],
      PERMISSION_UNIT, ["can be set up", "set-up", { subject: "antecedent", to: "battlefield" }], PERMITTED_LIMIT())).toMatch(/must follow the add-unit/u);
  });

  it("refuses a permission whose set-up does not put the unit on the battlefield", () => {
    expect(errorsOf(bare, TRIGGER, ADD, PERMISSION_UNIT,
      ["can be set up", "set-up", { subject: "antecedent", to: "strategic-reserves" }], PERMITTED_LIMIT())).toMatch(/sets it up on the battlefield/u);
  });

  it("refuses a second permission on the same added unit", () => {
    const two = `${bare} If you do, that Spore Pod unit can be set up within Engagement Range of the destroyed model's unit.`;
    expect(errorsOf(two, ...bareLeaves(PERMITTED_LIMIT()),
      ["that Spore Pod unit", "unit-filter", { side: "friendly", keywords: ["SPORE POD"] }],
      ["can be set up", "set-up", { subject: "antecedent", to: "battlefield" }], PERMITTED_LIMIT())).toMatch(/one set-up permission/u);
  });

  it("refuses a permission with no range, because it would have no DSL form", () => {
    expect(errorsOf(bare, ...bareLeaves())).toMatch(/names no range/u);
  });

  it("does not read a set-up after \"If you do,\" with a this-unit subject as a permission", () => {
    const own = "Each time this model shoots, add a new Spore Pod unit to your army. If you do, this unit can be set up.";
    const result = compileLeaves(placed(own, TRIGGER, ADD, ["this unit can be set up", "set-up", { subject: "this-unit", to: "battlefield" }]), own);
    expect(JSON.stringify(result)).not.toContain("allow_engagement_with");
  });
});

describe("Semantic authoring set-up relative placement: engagement of the event object (SS4a)", () => {
  it("normalizes range_ref engagement of event-object in the new version and refuses it in the previous", () => {
    // unit-position 22 introduced engagement of event-object; later versions keep accepting it.
    const introduced = 22;
    const input = { kind: "within", range_ref: "engagement", of: "event-object", subject: "antecedent", negated: false };
    for (const version of [introduced, currentFamilyVersion("unit-position")]) {
      expect(normalizeFingerprintParameters("unit-position", input, version)).toMatchObject({ of: "event-object", range_ref: "engagement" });
    }
    expect(() => normalizeFingerprintParameters("unit-position", input, introduced - 1)).toThrow(/event-object|matching-unit/u);
  });

  it("still refuses range_ref engagement of matching-unit in the new version", () => {
    const version = currentFamilyVersion("unit-position");
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", range_ref: "engagement", of: "matching-unit", subject: "antecedent", negated: false }, version)).toThrow();
  });
});

describe("Semantic authoring set-up placement: an enemy floor measured by Engagement Range (crash fix, SS1 shape)", () => {
  it("folds a permitted set-up's negated engagement limit to away_from instead of throwing", () => {
    const text = "This unit can be set up not within Engagement Range of any enemy unit.";
    const mechanics = mechanicsOf(text,
      ["This unit can be set up", "set-up", { subject: "this-unit", to: "battlefield" }],
      ["not within Engagement Range of", "unit-position", { kind: "within", range_ref: "engagement", of: "following-filter", subject: "this-unit", negated: true }],
      ["any enemy unit", "unit-filter", { side: "enemy" }]);
    expect(mechanics.effect.modifier.away_from).toEqual([{ of: { owner: "enemy" }, range: "engagement" }]);
    expect(mechanics.effect.modifier.min_enemy_distance).toBeUndefined();
  });
});

describe("Semantic authoring set-up placement from a named marker with an enemy floor (SS1 shape)", () => {
  const text = "This unit must be set up within 3\" of that Teleport Homer token and not within 8\" of an enemy unit.";
  const leaves: Item[] = [
    ["This unit must be set up", "set-up", { subject: "this-unit", to: "battlefield", mandatory: true }],
    ["within 3\" of that Teleport Homer token", "unit-position", { kind: "within", inches: 3, of: "marker", of_marker: "teleport-homer-token", subject: "this-unit", negated: false }],
    ["not within 8\" of an enemy unit", "unit-position", { kind: "within", inches: 8, of: "matching-unit", of_side: "enemy", subject: "this-unit", negated: true }],
  ];

  it("lowers a marker distance to near and an enemy floor to min_enemy_distance", () => {
    const mechanics = mechanicsOf(text, ...leaves);
    expect(mechanics.effect.modifier).toEqual({ to: "battlefield", mandatory: true, near: [{ of: { marker: "teleport-homer-token" }, range: { inches: 3 } }], min_enemy_distance: { inches: 8 } });
  });
});

describe("Semantic authoring set-up placement in a Stratagem with several targets (SS2)", () => {
  const WINDOW: Item = ["Movement phase", "use-window", { your_phases: ["movement"], opponent_phases: [], either_phases: [] }, "WHEN"];
  const TARGETS: Item[] = [
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly INFANTRY unit", "unit-filter", { side: "friendly", keywords: ["INFANTRY"] }, "TARGET"],
    ["one", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly MONOLITH model", "unit-filter", { side: "friendly", keywords: ["MONOLITH"], level: "model" }, "TARGET"],
  ];
  const text = "Movement phase. One friendly INFANTRY unit, and one friendly MONOLITH model. Set it back up anywhere on the battlefield that is wholly within 6\" of your MONOLITH model and not within Engagement Range of one or more enemy units.";
  const setUp: Item = ["Set it back up", "set-up", { subject: "antecedent", to: "battlefield" }, "EFFECT"];
  const wholly: Item = ["wholly within 6\" of", "unit-position", { kind: "within", inches: 6, of: "following-filter", subject: "antecedent", negated: false, wholly: true }, "EFFECT"];
  const among: Item = ["your MONOLITH model", "unit-filter", { side: "friendly", keywords: ["MONOLITH"], level: "model", among: "stratagem-targets", targets: "one" }, "EFFECT"];
  const notEngaged: Item = ["not within Engagement Range of one or more enemy units", "unit-state", { states: ["engaged"], subject: "antecedent", negated: true }, "EFFECT"];

  it("refuses a bare set-up antecedent that names a model-level target, since a set-up places a unit", () => {
    expect(errorsOf(text, WINDOW, ...TARGETS, setUp, wholly, among, notEngaged)).toMatch(/model-level Stratagem target/u);
  });

  it("binds a bare set-up antecedent to a unit-level last target and keeps the model limit on the other target", () => {
    const unitLast = "Movement phase. One friendly MONOLITH model, and one friendly INFANTRY unit. Set it back up anywhere on the battlefield that is wholly within 6\" of your MONOLITH model and not within Engagement Range of one or more enemy units.";
    const targets: Item[] = [
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly MONOLITH model", "unit-filter", { side: "friendly", keywords: ["MONOLITH"], level: "model" }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly INFANTRY unit", "unit-filter", { side: "friendly", keywords: ["INFANTRY"] }, "TARGET"],
    ];
    const mechanics = mechanicsOf(unitLast, WINDOW, ...targets, setUp, wholly, among, notEngaged);
    const modifier = mechanics.effect.modifier ?? mechanics.effect.effect?.modifier;
    const subject = JSON.stringify(mechanics.effect.target);
    const measured = JSON.stringify(modifier.near[0].of);
    expect(subject).toContain("stratagem_target");
    expect(measured).toContain("stratagem_target");
    expect(subject).not.toBe(measured);
  });

  // The last target is a unit, so a bare "it" names the unit (a set-up cannot place a model-level target).
  const UNIT_LAST: Item[] = [
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly MONOLITH model", "unit-filter", { side: "friendly", keywords: ["MONOLITH"], level: "model" }, "TARGET"],
    ["one", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly INFANTRY unit", "unit-filter", { side: "friendly", keywords: ["INFANTRY"] }, "TARGET"],
  ];
  const UNIT_LAST_TEXT = "Movement phase. One friendly MONOLITH model, and one friendly INFANTRY unit.";

  it("folds the wholly limit to the first target and the engaged limit past the among-filter to unengaged", () => {
    const unitLast = `${UNIT_LAST_TEXT} Set it back up anywhere on the battlefield that is wholly within 6" of your MONOLITH model and not within Engagement Range of one or more enemy units.`;
    const mechanics = mechanicsOf(unitLast, WINDOW, ...UNIT_LAST, setUp, wholly, among, notEngaged);
    const modifier = mechanics.effect.modifier ?? mechanics.effect.effect?.modifier;
    expect(modifier.placement).toBe("unengaged");
    expect(modifier.near).toHaveLength(1);
    expect(modifier.near[0]).toMatchObject({ range: { inches: 6 }, wholly: true });
    expect(JSON.stringify(modifier.near[0].of)).toContain("stratagem_target");
  });

  it("refuses a placement limit that names this unit as its measure, though its subject is exempt", () => {
    const named = `${UNIT_LAST_TEXT} Set it back up anywhere on the battlefield that is wholly within 6" of this unit.`;
    expect(errorsOf(named, WINDOW, ...UNIT_LAST, setUp, ["wholly within 6\" of this unit", "unit-position",
      { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false, wholly: true }, "EFFECT"])).toMatch(/names this unit \(of\)/u);
  });

  it("breaks the limit run at an among-filter that no limit follows, so a later engaged limit is not folded", () => {
    const roll = `${UNIT_LAST_TEXT} Set it back up anywhere on the battlefield that is wholly within 6" of your MONOLITH model and add 1 to the Hit roll. Not within Engagement Range of one or more enemy units.`;
    const mechanics = mechanicsOf(roll, WINDOW, ...UNIT_LAST, setUp, wholly, among,
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "antecedent" }, "EFFECT"],
      ["Not within Engagement Range of one or more enemy units", "unit-state", { states: ["engaged"], subject: "antecedent", negated: true }, "EFFECT"]);
    expect(JSON.stringify(mechanics)).not.toContain("\"placement\":\"unengaged\"");
  });
});

describe("Semantic authoring set-up placement: among-filter matches inside a set-up limit (SS2, T9)", () => {
  const WINDOW: Item = ["Movement phase", "use-window", { your_phases: ["movement"], opponent_phases: [], either_phases: [] }, "WHEN"];
  const setUp: Item = ["Set it back up", "set-up", { subject: "antecedent", to: "battlefield" }, "EFFECT"];
  const wholly: Item = ["wholly within 6\" of", "unit-position", { kind: "within", inches: 6, of: "following-filter", subject: "antecedent", negated: false, wholly: true }, "EFFECT"];
  const among: Item = ["your MONOLITH model", "unit-filter", { side: "friendly", keywords: ["MONOLITH"], level: "model", among: "stratagem-targets", targets: "one" }, "EFFECT"];
  const tail = " Set it back up anywhere on the battlefield that is wholly within 6\" of your MONOLITH model and not within Engagement Range of one or more enemy units.";

  it("refuses an among-filter that matches none of the targets when it sits inside a set-up limit", () => {
    const text = `Movement phase. One friendly INFANTRY unit, and one friendly VEHICLE model.${tail}`;
    expect(errorsOf(text, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"], ["friendly INFANTRY unit", "unit-filter", { side: "friendly", keywords: ["INFANTRY"] }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"], ["friendly VEHICLE model", "unit-filter", { side: "friendly", keywords: ["VEHICLE"], level: "model" }, "TARGET"],
      setUp, wholly, among)).toMatch(/matches none/u);
  });

  it("refuses an among-filter that matches several targets when it sits inside a set-up limit", () => {
    const text = `Movement phase. One friendly MONOLITH model, and one friendly MONOLITH model.${tail}`;
    expect(errorsOf(text, WINDOW,
      ["One", "stratagem-target", { count: "one" }, "TARGET"], ["friendly MONOLITH model", "unit-filter", { side: "friendly", keywords: ["MONOLITH"], level: "model" }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"], ["friendly MONOLITH model", "unit-filter", { side: "friendly", keywords: ["MONOLITH"], level: "model" }, "TARGET"],
      setUp, wholly, among)).toMatch(/names one target but matches 2/u);
  });
});
