import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
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

const moment = (wording: string, from?: string): Item => [wording, "event", { kind: "set-up", owner: "enemy", ...(from ? { from } : {}) }];
const forbidden = (wording = "cannot be set up"): Item => [wording, "set-up", { subject: "antecedent", to: "battlefield", allow: false }];
const within = (wording: string, inches: number, of: string, extra: Record<string, unknown> = {}): Item =>
  [wording, "unit-position", { kind: "within", inches, of, subject: "antecedent", negated: false, ...extra }];
const beyondEnemy = (wording: string, inches: number, extra: Record<string, unknown> = {}): Item =>
  [wording, "unit-position", { kind: "beyond", inches, of: "matching-unit", of_side: "enemy", subject: "antecedent", negated: false, ...extra }];

describe("Round 5C set-up restriction (an enemy exclusion zone)", () => {
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

describe("Round 5C placement limits after a set-up or add-unit", () => {
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

describe("Round 5C wave 8 set-up families", () => {
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
