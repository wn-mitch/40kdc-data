import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeEffect, type Effect } from "../src/translate/index.js";

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

const moment = (wording: string, from?: string): Item => [wording, "event", { kind: "set-up", owner: "enemy", ...(from ? { from } : {}) }];
const forbidden = (wording = "cannot be set up"): Item => [wording, "set-up", { subject: "antecedent", to: "battlefield", allow: false }];
const within = (wording: string, inches: number, of: string, extra: Record<string, unknown> = {}): Item =>
  [wording, "unit-position", { kind: "within", inches, of, subject: "antecedent", negated: false, ...extra }];
const beyondEnemy = (wording: string, inches: number, extra: Record<string, unknown> = {}): Item =>
  [wording, "unit-position", { kind: "beyond", inches, of: "matching-unit", of_side: "enemy", subject: "antecedent", negated: false, ...extra }];

describe("Semantic authoring set-up restriction (an enemy exclusion zone)", () => {
  const text = "Enemy units placed from the Vault cannot be set up within 12\" of this model.";

  it("turns the set-up moment into whose set-ups are forbidden, not a trigger", () => {
    const mechanics = mechanicsOf(text, moment("Enemy units placed from the Vault", "strategic-reserves"), forbidden(), within("within 12\" of this model", 12, "this-model"));
    expect(mechanics.trigger).toBeNull();
    expect(mechanics.behavior).toBe("passive");
    expect(mechanics.effect).toEqual({
      type: "set-up", target: { owner: "enemy" },
      modifier: { to: "battlefield", from: "strategic-reserves", allow: false, near: [{ of: "this-model", range: { inches: 12 } }] },
    });
    expect(describeEffect(mechanics.effect as Effect)).toBe("Enemy units cannot be set up on the battlefield from Strategic Reserves within 12\" of this model.");
  });

  it("reads a set-up as Relief and a level distance with the same values as from Reserves and within", () => {
    const relief = "Enemy units placed as Relief cannot be set up within 9\" level of your unit.";
    const mechanics = mechanicsOf(relief, moment("Enemy units placed as Relief", "strategic-reserves"), forbidden(),
      within("within 9\" level of your unit", 9, "this-unit"));
    expect(mechanics.effect).toEqual({
      type: "set-up", target: { owner: "enemy" },
      modifier: { to: "battlefield", from: "strategic-reserves", allow: false, near: [{ of: "this-unit", range: { inches: 9 } }] },
    });
  });

  it("is gated by a While condition before it and bounded by a printed duration", () => {
    const gatedText = "Until the end of the turn, while this model is on the battlefield, enemy units placed from the Vault cannot be set up within 6\" of this model.";
    const mechanics = mechanicsOf(gatedText,
      ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
      ["while this model is on the battlefield", "unit-state", { states: ["on-battlefield"], subject: "this-model", negated: false }],
      moment("enemy units placed from the Vault", "strategic-reserves"), forbidden(), within("within 6\" of this model", 6, "this-model"));
    expect(mechanics.scope).toEqual({ duration: "turn" });
    expect(mechanics.effect.type).toBe("conditional");
    expect(mechanics.effect.effect.modifier.allow).toBe(false);
  });

  it("refuses a moment that does not say where the units come from, which would also forbid deployment", () => {
    expect(errorsOf(text, moment("Enemy units placed from the Vault"), forbidden(), within("within 12\" of this model", 12, "this-model")))
      .toMatch(/would also forbid deployment/u);
  });

  it("refuses a moment that names one unit rather than a side", () => {
    expect(errorsOf(text, ["Enemy units placed from the Vault", "event", { kind: "set-up", subject: "selected-unit", from: "strategic-reserves" }], forbidden(), within("within 12\" of this model", 12, "this-model")))
      .toMatch(/names one unit, not a side/u);
  });

  it("refuses a forbidden set-up with two zones", () => {
    const two = "Enemy units placed from the Vault cannot be set up within 12\" of this model and within 3\" of a beacon marker.";
    expect(errorsOf(two, moment("Enemy units placed from the Vault", "strategic-reserves"), forbidden(), within("within 12\" of this model", 12, "this-model"),
      within("within 3\" of a beacon marker", 3, "marker", { of_marker: "beacon-marker" }))).toMatch(/more than one placement limit/u);
  });

  it("refuses a restriction with no zone after it", () => {
    const bare = "Enemy units placed from the Vault cannot be set up.";
    expect(errorsOf(bare, moment("Enemy units placed from the Vault", "strategic-reserves"), forbidden())).toMatch(/names no zone/u);
  });

  it("refuses a consumed moment that also opens another effect in its sentence", () => {
    const more = "Enemy units placed from the Vault cannot be set up within 12\" of this model and they suffer 1 mortal wound.";
    expect(errorsOf(more, moment("Enemy units placed from the Vault", "strategic-reserves"), forbidden(), within("within 12\" of this model", 12, "this-model"),
      ["they suffer 1 mortal wound", "mortal-wounds", { recipient: "event-subject", count: "1" }])).toMatch(/cannot also open another effect/u);
  });

  it("refuses a unit-filter on the moment, which the restriction would drop", () => {
    const filtered = "Enemy GRUNT units placed from the Vault cannot be set up within 12\" of this model.";
    expect(errorsOf(filtered, ["GRUNT units", "unit-filter", { side: "enemy", keywords: ["GRUNT"] }], moment("placed from the Vault", "strategic-reserves"), forbidden(),
      within("within 12\" of this model", 12, "this-model"))).toMatch(/unit-filter on a set-up restriction/u);
  });

  it("leaves a permitted set-up after a set-up moment reactive", () => {
    const reactive = "When this unit is placed from the Vault, it can be set up within 6\" of a beacon marker.";
    const mechanics = mechanicsOf(reactive,
      ["When this unit is placed from the Vault", "event", { kind: "set-up", from: "strategic-reserves" }],
      ["it can be set up", "set-up", { subject: "antecedent", to: "battlefield" }],
      within("within 6\" of a beacon marker", 6, "marker", { of_marker: "beacon-marker" }));
    expect(mechanics.trigger).toEqual({ event: "set-up", filter: { from: "strategic-reserves" } });
    expect(mechanics.effect.modifier.near).toEqual([{ of: { marker: "beacon-marker" }, range: { inches: 6 } }]);
  });

});

describe("Semantic authoring placement limits after a set-up or add-unit", () => {
  it("folds an add-unit's set-up and its limits into the add-unit, not the moment's unit", () => {
    const text = "Each time this model shoots, add a new Spore Pod unit to your army and set it up anywhere on the battlefield that is wholly within 18\" of this model and more than 8\" away from all enemy units.";
    const mechanics = mechanicsOf(text,
      ["Each time this model shoots", "event", { kind: "after-shooting" }],
      ["add a new Spore Pod unit to your army", "add-unit", { source: "datasheet", datasheet: "spore-pod", count: "1" }],
      ["set it up", "set-up", { subject: "antecedent", to: "battlefield" }],
      within("wholly within 18\" of this model", 18, "this-model", { wholly: true }),
      beyondEnemy("more than 8\" away from all enemy units", 8));
    expect(mechanics.effect).toEqual({
      type: "add-unit", target: "this-unit",
      modifier: { datasheet: "spore-pod", count: 1, near: [{ of: "this-model", range: { inches: 18 }, wholly: true }], away_from: [{ of: { owner: "enemy" }, range: { inches: 8 } }] },
    });
  });

  it("refuses an add-unit held in Strategic Reserves that is also set up", () => {
    const text = "Add a new Spore Pod unit to your army in Strategic Reserves and set it up.";
    expect(errorsOf(text, ["Add a new Spore Pod unit to your army in Strategic Reserves", "add-unit", { source: "datasheet", datasheet: "spore-pod", count: "1", held_in: "strategic-reserves" }],
      ["set it up", "set-up", { subject: "antecedent", to: "battlefield" }])).toMatch(/not also set up on the battlefield/u);
  });

  it("places a set-up within a region instead of gating it on the region", () => {
    const text = "In your Movement phase, this unit can be set up within your opponent's deployment zone.";
    const mechanics = mechanicsOf(text,
      ["In your Movement phase", "phase-window", { phase: "movement", turn: "your" }],
      ["this unit can be set up", "set-up", { subject: "this-unit", to: "battlefield", from: "strategic-reserves" }],
      ["within your opponent's deployment zone", "in-region", { region_kind: "territory", territory: "enemy-deployment-zone" }]);
    expect(JSON.stringify(mechanics.effect)).not.toContain("\"type\":\"in-region\"");
    expect(mechanics.effect.effect).toEqual({ type: "set-up", target: "this-unit", modifier: { to: "battlefield", from: "strategic-reserves", in_region: { region: { territory: "enemy-deployment-zone" } } } });
  });

  it("keeps a region after \"if\" as a gate", () => {
    const text = "This unit can be set up, if it is within your opponent's deployment zone.";
    const mechanics = mechanicsOf(text,
      ["This unit can be set up", "set-up", { subject: "this-unit", to: "battlefield" }],
      ["within your opponent's deployment zone", "in-region", { region_kind: "territory", territory: "enemy-deployment-zone", subject: "this-unit" }]);
    expect(mechanics.effect.type).toBe("conditional");
    expect(mechanics.effect.effect.modifier.in_region).toBeUndefined();
  });

  it("reads more than a distance from all enemy units as the set-up's min_enemy_distance, and unengaged as a placement", () => {
    const text = "This unit must be set up more than 6\" away from all enemy units, not engaged.";
    const mechanics = mechanicsOf(text,
      ["This unit must be set up", "set-up", { subject: "this-unit", to: "battlefield", mandatory: true }],
      beyondEnemy("more than 6\" away from all enemy units", 6, { subject: "this-unit" }),
      ["not engaged", "unit-state", { states: ["engaged"], subject: "this-unit", negated: true }]);
    expect(mechanics.effect.modifier).toEqual({ to: "battlefield", mandatory: true, min_enemy_distance: { inches: 6 }, placement: "unengaged" });
  });

  it("folds a level distance from enemy units into min_enemy_distance like any other", () => {
    const text = "This unit can be set up more than 9\" level away from all enemy units.";
    const mechanics = mechanicsOf(text,
      ["This unit can be set up", "set-up", { subject: "this-unit", to: "battlefield" }],
      beyondEnemy("more than 9\" level away from all enemy units", 9, { subject: "this-unit" }));
    expect(mechanics.effect.modifier).toEqual({ to: "battlefield", min_enemy_distance: { inches: 9 } });
  });

  it("keeps a distance from enemy units on a forbidden set-up as away_from", () => {
    const text = "Enemy units placed from the Vault cannot be set up more than 9\" away from all enemy units.";
    const mechanics = mechanicsOf(text, moment("Enemy units placed from the Vault", "strategic-reserves"), forbidden(),
      beyondEnemy("more than 9\" away from all enemy units", 9));
    expect(mechanics.effect.modifier).toEqual({ to: "battlefield", from: "strategic-reserves", allow: false, away_from: [{ of: { owner: "enemy" }, range: { inches: 9 } }] });
  });

  it("refuses a folded distance that contradicts the set-up's own min_enemy_distance", () => {
    const text = "This unit can be set up more than 6\" away from all enemy units.";
    expect(errorsOf(text, ["This unit can be set up", "set-up", { subject: "this-unit", to: "battlefield", min_enemy_distance: 9 }],
      beyondEnemy("more than 6\" away from all enemy units", 6, { subject: "this-unit" }))).toMatch(/already sets up more than 9"/u);
  });

  it("refuses limits the DSL placement cannot say", () => {
    const outside = "This unit can be set up not within your deployment zone.";
    expect(errorsOf(outside, ["This unit can be set up", "set-up", { subject: "this-unit", to: "battlefield" }],
      ["not within your deployment zone", "in-region", { region_kind: "territory", territory: "your-deployment-zone", negated: true }])).toMatch(/outside a region/u);
    const wholly = "This unit can be set up more than 6\" away from this model.";
    expect(errorsOf(wholly, ["This unit can be set up", "set-up", { subject: "this-unit", to: "battlefield" }],
      ["more than 6\" away from this model", "unit-position", { kind: "within", inches: 6, of: "this-model", subject: "this-unit", negated: true, wholly: true }])).toMatch(/wholly qualifies only within/u);
    const earlier = "This unit can be set up within 6\" of it.";
    expect(errorsOf(earlier, ["This unit can be set up", "set-up", { subject: "this-unit", to: "battlefield" }],
      ["within 6\" of it", "unit-position", { kind: "within", inches: 6, of: "antecedent", subject: "this-unit", negated: false }])).toMatch(/instead of antecedent/u);
  });
});

describe("Semantic authoring wave 8 set-up families", () => {
  const setUp = currentFamilyVersion("set-up");
  it("accepts allow false and mandatory on set-up, and no reinforcements source", () => {
    expect(normalizeFingerprintParameters("set-up", { subject: "antecedent", to: "battlefield", allow: false }, setUp)).toMatchObject({ allow: false });
    expect(normalizeFingerprintParameters("set-up", { subject: "this-unit", to: "battlefield", mandatory: true }, setUp)).toMatchObject({ mandatory: true });
    expect(() => normalizeFingerprintParameters("set-up", { subject: "this-unit", to: "battlefield", from: "reinforcements" }, setUp)).toThrow();
  });

  it("refuses a set-up both forbidden and required, and a forbidden set-up that places itself", () => {
    expect(() => normalizeFingerprintParameters("set-up", { subject: "this-unit", to: "battlefield", allow: false, mandatory: true }, setUp)).toThrow(/both forbidden/u);
    expect(() => normalizeFingerprintParameters("set-up", { subject: "this-unit", to: "battlefield", allow: false, min_enemy_distance: 9 }, setUp)).toThrow(/min_enemy_distance places a permitted set-up/u);
    expect(() => normalizeFingerprintParameters("set-up", { subject: "this-unit", to: "battlefield", allow: true }, setUp)).toThrow(/allow is false or absent/u);
  });

  it("puts from on set-up moments only, with no reinforcements source, and no horizontal distance", () => {
    const event = currentFamilyVersion("event");
    expect(normalizeFingerprintParameters("event", { kind: "set-up", owner: "enemy", from: "strategic-reserves" }, event)).toMatchObject({ from: "strategic-reserves" });
    expect(() => normalizeFingerprintParameters("event", { kind: "set-up", owner: "enemy", from: "reinforcements" }, event)).toThrow();
    expect(() => normalizeFingerprintParameters("event", { kind: "move-ended", owner: "enemy", from: "strategic-reserves" }, event)).toThrow();
    const position = currentFamilyVersion("unit-position");
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", inches: 12, of: "this-model", subject: "antecedent", negated: false, horizontal: true }, position)).toThrow();
  });
});

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
