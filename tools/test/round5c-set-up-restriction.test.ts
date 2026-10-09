import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { designationLabel, DESIGNATION_IDS } from "../src/translate/designations.js";
import { describeEffect, type Effect } from "../src/translate/index.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
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

const beyondEnemy = (wording: string, inches: number, extra: Record<string, unknown> = {}): Item =>
  [wording, "unit-position", { kind: "beyond", inches, of: "matching-unit", of_side: "enemy", subject: "antecedent", negated: false, ...extra }];

describe("Wave 10 family versions: unit-size dice, objective and zone distances, designated units", () => {
  it("accepts a dice amount for an added unit's models and keeps the 1 to 20 bound on a whole number", () => {
    const size = currentFamilyVersion("unit-size");
    expect(normalizeFingerprintParameters("unit-size", { models: "D3" }, size)).toEqual({ models: "D3" });
    expect(normalizeFingerprintParameters("unit-size", { models: "d3+1" }, size)).toEqual({ models: "D3+1" });
    expect(normalizeFingerprintParameters("unit-size", { models: 10 }, size)).toEqual({ models: 10 });
    expect(() => normalizeFingerprintParameters("unit-size", { models: "D5" }, size)).toThrow(/dice amount/u);
    expect(() => normalizeFingerprintParameters("unit-size", { models: 21 }, size)).toThrow();
  });

  it("measures a distance to an objective marker by its designation and controller", () => {
    const position = currentFamilyVersion("unit-position");
    expect(normalizeFingerprintParameters("unit-position", { kind: "within", inches: 6, of: "objective", objective_tag: "warded", controlled_by: "you", subject: "this-unit", negated: false }, position))
      .toMatchObject({ of: "objective", objective_tag: "warded", controlled_by: "you", inches: 6 });
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", inches: 6, of: "objective", subject: "this-unit", negated: false }, position)).toThrow(/objective_tag/u);
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", inches: 6, of: "objective", objective_tag: "not-registered", subject: "this-unit", negated: false }, position)).toThrow(/registered designation/u);
    // The v11 objective-range form keeps its own rules: a distance kind cannot take objective: designated.
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", inches: 6, objective: "designated", objective_tag: "warded", subject: "this-unit", negated: false }, position)).toThrow();
  });

  it("measures a beyond distance from the enemy deployment zone, and no within distance from it", () => {
    const position = currentFamilyVersion("unit-position");
    expect(normalizeFingerprintParameters("unit-position", { kind: "beyond", inches: 8, of: "enemy-deployment-zone", subject: "antecedent", negated: false }, position))
      .toMatchObject({ of: "enemy-deployment-zone", inches: 8 });
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", inches: 8, of: "enemy-deployment-zone", subject: "antecedent", negated: false }, position)).toThrow(/beyond distance/u);
  });

  it("names units that carry or lack a designation, with their side, and refuses them on other places", () => {
    const position = currentFamilyVersion("unit-position");
    const base = { kind: "beyond", inches: 6, subject: "antecedent", negated: false };
    expect(normalizeFingerprintParameters("unit-position", { ...base, of: "matching-unit", of_side: "enemy", of_designated: "afflicted" }, position))
      .toMatchObject({ of: "matching-unit", of_side: "enemy", of_designated: "afflicted" });
    expect(normalizeFingerprintParameters("unit-position", { ...base, of: "matching-unit", of_side: "enemy", of_keywords: ["DAEMON"], of_not_designated: "afflicted" }, position))
      .toMatchObject({ of_keywords: ["DAEMON"], of_not_designated: "afflicted" });
    expect(() => normalizeFingerprintParameters("unit-position", { ...base, of: "matching-unit", of_designated: "afflicted" }, position)).toThrow(/of_side/u);
    expect(() => normalizeFingerprintParameters("unit-position", { ...base, of: "this-unit", of_designated: "afflicted" }, position)).toThrow(/matching-unit only/u);
    expect(() => normalizeFingerprintParameters("unit-position", { ...base, of: "matching-unit", of_side: "enemy", of_designated: "not-registered" }, position)).toThrow(/registered designation/u);
  });

  it("widens apply-mark to the selected objective and to the warded and corrupted tags, and nothing else", () => {
    const mark = currentFamilyVersion("apply-mark");
    expect(normalizeFingerprintParameters("apply-mark", { subject: "selected-objective", tag: "warded" }, mark)).toEqual({ subject: "selected-objective", tag: "warded" });
    expect(normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: "corrupted" }, mark)).toEqual({ subject: "this-unit", tag: "corrupted" });
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: "not-registered" }, mark)).toThrow();
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: "sabotaged" }, mark)).not.toThrow();
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "event-object", tag: "warded" }, mark)).toThrow();
  });

  it("makes deployment-window a condition that takes only during: deployment", () => {
    expect(normalizeFingerprintParameters("deployment-window", { during: "deployment" }, 1)).toEqual({ during: "deployment" });
    expect(() => normalizeFingerprintParameters("deployment-window", { during: "battle" }, 1)).toThrow();
  });

  it("registers warded and corrupted as designations, with their rules terms", () => {
    expect(DESIGNATION_IDS.has("warded")).toBe(true);
    expect(DESIGNATION_IDS.has("corrupted")).toBe(true);
    expect(designationLabel("warded")).toBe("Warded");
    expect(designationLabel("sabotaged")).toBe("Sabotaged");
  });
});

describe("Wave 10 placement after a set-up (SS1, SS2)", () => {
  it("adds a set-up's distance from an enemy's zone to a unit added and placed in one add-unit (SS1b)", () => {
    // "add a new unit containing D3 models … set it up … within 6\" of this model and more than 8\" from all enemy units"
    const text = "Add a new SPORE MINES unit containing D3 models to your army and set it up anywhere on the battlefield that is within 6\" of this model and more than 8\" away from all enemy units.";
    const mechanics = mechanicsOf(text,
      ["Add a new SPORE MINES unit containing D3 models to your army", "add-unit", { source: "datasheet", datasheet: "spore-mines", count: "1", models: "D3" }],
      ["set it up", "set-up", { subject: "antecedent", to: "battlefield" }],
      ["within 6\" of this model", "unit-position", { kind: "within", inches: 6, of: "this-model", subject: "antecedent", negated: false }],
      beyondEnemy("more than 8\" away from all enemy units", 8));
    expect(mechanics.effect.modifier).toMatchObject({ count: 1, model_count: "D3", near: [{ of: "this-model", range: { inches: 6 } }], away_from: [{ of: { owner: "enemy" }, range: { inches: 8 } }] });
  });

  it("places a one-unit add with a wholly-within-48 limit on this unit and a distance from enemies (SS1a, 9843 shape)", () => {
    // "add one new SPORE MINES unit to your army and set it up … wholly within 48\" of this unit and more than 8\" horizontally away from all enemy units"
    const text = "Add one new SPORE MINES unit to your army and set it up anywhere on the battlefield that is wholly within 48\" of this unit and more than 8\" away from all enemy units.";
    const mechanics = mechanicsOf(text,
      ["Add one new SPORE MINES unit to your army", "add-unit", { source: "datasheet", datasheet: "spore-mines", count: "1" }],
      ["set it up", "set-up", { subject: "antecedent", to: "battlefield" }],
      ["wholly within 48\" of this unit", "unit-position", { kind: "within", inches: 48, of: "this-unit", subject: "antecedent", negated: false, wholly: true }],
      beyondEnemy("more than 8\" away from all enemy units", 8));
    expect(mechanics.effect.modifier).toMatchObject({ count: 1, near: [{ of: "this-unit", range: { inches: 48 }, wholly: true }], away_from: [{ of: { owner: "enemy" }, range: { inches: 8 } }] });
    expect(mechanics.effect.modifier.model_count).toBeUndefined();
  });

  it("refuses a dice model count on a copy of a destroyed unit, and on a count other than one", () => {
    const add = currentFamilyVersion("add-unit");
    expect(() => normalizeFingerprintParameters("add-unit", { source: "copy", count: "1", models: "D3" }, add)).toThrow(/named datasheet/u);
    expect(() => normalizeFingerprintParameters("add-unit", { source: "datasheet", datasheet: "spore-mines", count: "D3", models: "D3" }, add)).toThrow(/count is 1/u);
    expect(normalizeFingerprintParameters("add-unit", { source: "datasheet", datasheet: "spore-mines", count: "1", models: "d3" }, add)).toMatchObject({ models: "D3" });
  });

  it("places the unit a destruction leaves: the destroyed unit is the trigger's object (SS1c)", () => {
    // Fabricated wording: a stratagem that sets up a friendly unit within 9" of the destroyed unit and more than 6" from enemies.
    const text = "When a unit is destroyed, select one friendly unit. Set that unit up wholly within 9\" of that destroyed unit and more than 6\" away from all enemy units.";
    const mechanics = mechanicsOf(text,
      ["When a unit is destroyed", "event", { kind: "unit-destroyed" }],
      ["select one friendly unit", "unit-filter", { side: "friendly", keywords: ["GRUNT"] }],
      ["Set that unit up", "set-up", { subject: "antecedent", to: "battlefield" }],
      ["wholly within 9\" of that destroyed unit", "unit-position", { kind: "within", inches: 9, of: "event-object", subject: "antecedent", negated: false, wholly: true }],
      beyondEnemy("more than 6\" away from all enemy units", 6));
    expect(mechanics.trigger).toMatchObject({ event: "destroyed", object: "event-object" });
    expect(mechanics.effect.modifier.near).toEqual([{ of: "event-object", range: { inches: 9 }, wholly: true }]);
  });

  it("keeps a destroyed trigger without an event-object placement as it was", () => {
    const text = "When a unit is destroyed, that unit can be set up anywhere on the battlefield.";
    const mechanics = mechanicsOf(text,
      ["When a unit is destroyed", "event", { kind: "unit-destroyed" }],
      ["that unit can be set up", "set-up", { subject: "event-subject", to: "battlefield" }]);
    expect(mechanics.trigger).toEqual({ event: "destroyed" });
  });

  it("makes an ingress set-up ignore the usual limits and place within a distance of its unit, unengaged (SS2)", () => {
    const text = "While making that ingress move, that unit must be set up wholly within 6\" of this unit and unengaged, even if that is within your opponent's deployment zone.";
    const mechanics = mechanicsOf(text,
      ["that unit must be set up", "set-up", { subject: "antecedent", to: "battlefield", mandatory: true, ignore_limits: true }],
      ["wholly within 6\" of this unit", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false, wholly: true }],
      ["unengaged", "unit-state", { states: ["engaged"], subject: "antecedent", negated: true }]);
    expect(mechanics.effect.modifier).toEqual({
      to: "battlefield", mandatory: true, ignore_limits: true, near: [{ of: "this-unit", range: { inches: 6 }, wholly: true }], placement: "unengaged",
    });
    expect(describeEffect(mechanics.effect as Effect)).toContain("ignoring the usual set-up limits");
    expect(describeEffect(mechanics.effect as Effect)).not.toContain("Strategic Reserves");
  });

  it("gates the ingress set-up on the opponent's deployment zone when that leaf is left in place", () => {
    // Leaving the zone leaf authored gates the set-up: the leaf must be superseded, not kept.
    const text = "That unit must be set up wholly within 6\" of this unit, even if that is within your opponent's deployment zone.";
    const mechanics = mechanicsOf(text,
      ["That unit must be set up", "set-up", { subject: "antecedent", to: "battlefield", mandatory: true, ignore_limits: true }],
      ["wholly within 6\" of this unit", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false, wholly: true }],
      ["within your opponent's deployment zone", "in-region", { region_kind: "territory", territory: "enemy-deployment-zone", subject: "antecedent" }]);
    expect(mechanics.effect.type).toBe("conditional");
  });
});

describe("Wave 10 objective and designation limits (SS3)", () => {
  const select = (wording = "one objective marker you control"): Item => [wording, "select-objective-open", { bind_as: "warded_marker", controlled_by: "you" }];

  it("tags the selected objective marker, lasting as long as the printed duration (SS3)", () => {
    const text = "Select one objective marker you control. That objective marker is said to be Warded and remains under your control until your opponent controls it.";
    const mechanics = mechanicsOf(text,
      select(),
      ["That objective marker is said to be Warded", "apply-mark", { subject: "selected-objective", tag: "warded" }],
      ["until your opponent controls it", "duration", { endpoint: "control-lost" }]);
    expect(mechanics.effect.type).toBe("select-objective");
    const designate = mechanics.effect.effect.effect;
    expect(designate).toMatchObject({ type: "designate", target: "this-unit", modifier: { tag: "warded", clears_on: "control-lost", subject: { objective: { selection_var: "warded_marker" } } } });
    expect(describeEffect(designate as Effect)).toMatch(/Warded/u);
  });

  it("refuses a designation on the selected objective with no selected objective, and with no duration", () => {
    expect(errorsOf("Stratagem text: That objective marker is said to be Warded until your opponent controls it.",
      ["That objective marker is said to be Warded", "apply-mark", { subject: "selected-objective", tag: "warded" }],
      ["until your opponent controls it", "duration", { endpoint: "control-lost" }]))
      .toMatch(/selects no objective marker/u);
    expect(errorsOf("Select one objective marker you control. That objective marker is said to be Warded.",
      select(), ["That objective marker is said to be Warded", "apply-mark", { subject: "selected-objective", tag: "warded" }]))
      .toMatch(/needs its duration printed/u);
  });

  it("limits a set-up to enemy units with a keyword, measured from a warded objective marker under your control (SS3)", () => {
    const text = "Enemy DAEMON units cannot be set up on the battlefield within 6\" of a warded objective marker you control.";
    const mechanics = mechanicsOf(text,
      ["Enemy DAEMON units", "unit-filter", { side: "enemy", keywords: ["DAEMON"] }],
      ["cannot be set up on the battlefield", "set-up", { subject: "antecedent", to: "battlefield", allow: false }],
      ["within 6\" of a warded objective marker you control", "unit-position", { kind: "within", inches: 6, of: "objective", objective_tag: "warded", controlled_by: "you", subject: "antecedent", negated: false }]);
    expect(mechanics.effect.target).toEqual({ owner: "enemy", all_of: ["DAEMON"] });
    expect(mechanics.effect.modifier).toMatchObject({ allow: false, near: [{ of: { objective: { designated: "warded", controlled_by: "friendly" } }, range: { inches: 6 } }] });
  });
});

describe("Wave 10 designated-unit distances and deployment-zone distances (SS4, SS5)", () => {
  it("keeps a distance to designated units and to other units as two away-from limits (SS4)", () => {
    const text = "This unit can be set up anywhere on the battlefield more than 6\" away from all AFFLICTED enemy units and more than 8\" away from all other enemy units.";
    const mechanics = mechanicsOf(text,
      ["This unit can be set up", "set-up", { subject: "this-unit", to: "battlefield" }],
      beyondEnemy("more than 6\" away from all AFFLICTED enemy units", 6, { subject: "this-unit", of_designated: "afflicted" }),
      beyondEnemy("more than 8\" away from all other enemy units", 8, { subject: "this-unit", of_not_designated: "afflicted" }));
    expect(mechanics.effect.modifier.away_from).toEqual([
      { of: { owner: "enemy", designated: "afflicted" }, range: { inches: 6 } },
      { of: { owner: "enemy", not_designated: "afflicted" }, range: { inches: 8 } },
    ]);
  });

  it("keeps a 9\" distance from other enemy units on the same shape (SS4, 3017)", () => {
    const text = "This unit can be set up anywhere on the battlefield more than 6\" away from all AFFLICTED enemy units and more than 9\" away from all other enemy units.";
    const mechanics = mechanicsOf(text,
      ["This unit can be set up", "set-up", { subject: "this-unit", to: "battlefield" }],
      beyondEnemy("more than 6\" away from all AFFLICTED enemy units", 6, { subject: "this-unit", of_designated: "afflicted" }),
      beyondEnemy("more than 9\" away from all other enemy units", 9, { subject: "this-unit", of_not_designated: "afflicted" }));
    expect(mechanics.effect.modifier.away_from[1]).toEqual({ of: { owner: "enemy", not_designated: "afflicted" }, range: { inches: 9 } });
  });

  it("refuses a designated filter on a selection, which has no designation shape yet", () => {
    expect(errorsOf("Select one enemy unit that is not AFFLICTED.",
      ["Select one enemy unit", "select-unit", { distance: "any", visible: false }],
      ["that is not AFFLICTED", "unit-filter", { side: "enemy", not_designated: "afflicted" }])).toMatch(/designation/u);
  });

  it("sets up a unit more than 8\" from the enemy deployment zone and from all enemy units, in deployment (SS5)", () => {
    const text = "During deployment, this unit can be set up anywhere on the battlefield more than 8\" horizontally from your opponent's deployment zone and all enemy units.";
    const mechanics = mechanicsOf(text,
      ["During deployment", "deployment-window", { during: "deployment" }],
      ["this unit can be set up", "set-up", { subject: "this-unit", to: "battlefield" }],
      ["more than 8\" horizontally from your opponent's deployment zone", "unit-position", { kind: "beyond", inches: 8, of: "enemy-deployment-zone", subject: "antecedent", negated: false }],
      beyondEnemy("and all enemy units", 8, { subject: "this-unit" }));
    expect(JSON.stringify(mechanics.effect)).toContain("\"type\":\"deployment-window\"");
    expect(mechanics.effect.effect.modifier).toEqual({
      to: "battlefield", min_enemy_distance: 8, away_from: [{ of: { territory: "enemy-deployment-zone" }, range: { inches: 8 } }],
    });
    const words = describeEffect(mechanics.effect as Effect);
    expect(words).toContain("during deployment");
    expect(words).toContain("your opponent's deployment zone");
  });

  it("refuses a within distance from the enemy deployment zone, which the set-up has no form for", () => {
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", inches: 8, of: "enemy-deployment-zone", subject: "this-unit", negated: false }, currentFamilyVersion("unit-position"))).toThrow();
  });
});
