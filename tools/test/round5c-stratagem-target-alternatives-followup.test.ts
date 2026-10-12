import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { createValidator } from "../src/schema-loader.js";

/**
 * Stratagem target alternatives, follow-up: a move-through and a move permission on the triggering
 * unit (event-subject), a move-must-end cannot-end restriction bound to that unit, and the plural
 * wording guard for a set-up that names several targets. Every leaf is fabricated wording; each case
 * pins one binding, one version boundary, or one refusal.
 */

const ajv = createValidator();
const effectOk = ajv.getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;

/**
 * A leaf at the first (or nth) occurrence of `phrase` in `text`. Byte offsets equal character offsets
 * because every text here is ASCII.
 */
function at(text: string, phrase: string, family: string, parameters: Record<string, unknown>, fragment: string, nth = 0): CompileLeaf {
  let start = -1;
  let from = 0;
  for (let count = 0; count <= nth; count += 1) {
    start = text.indexOf(phrase, from);
    if (start < 0) throw new Error(`"${phrase}" is not in the text`);
    from = start + 1;
  }
  const version = currentFamilyVersion(family);
  return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: start + phrase.length, fragment };
}

function run(text: string, leaves: CompileLeaf[]) {
  return compileLeaves(leaves, text);
}

function compiled(text: string, leaves: CompileLeaf[]): string {
  const result = run(text, leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return JSON.stringify({ mechanics: result.mechanics, core: result.core });
}

function refused(text: string, leaves: CompileLeaf[]): string {
  const result = run(text, leaves);
  if (result.ok) throw new Error("expected a refusal");
  return result.errors.join("; ");
}

const MOVE_TYPES = ["normal", "advance", "fall-back"];
const BEFORE = "After a friendly unit makes a Normal move, ";

describe("move-through version: the triggering unit and a pair of passthrough tokens", () => {
  const V = currentFamilyVersion("move-through");
  const PREVIOUS = V - 1;

  it("widens the previous version: every value it accepted still normalizes the same", () => {
    expect(V).toBeGreaterThanOrEqual(4);
    const accepted: Array<Record<string, unknown>> = [
      { subject: "this-unit", passthrough: "models" },
      { subject: "this-model", passthrough: "all-terrain" },
      { subject: "this-unit", passthrough: { kind: "models", owner: "enemy", excluding: ["VEHICLE"] } },
      { subject: "this-unit", passthrough: "models", applies_to_moves: ["normal"] },
    ];
    for (const parameters of accepted) {
      expect(normalizeFingerprintParameters("move-through", parameters, V)).toEqual(normalizeFingerprintParameters("move-through", parameters, PREVIOUS));
    }
  });

  it("accepts the triggering unit as subject, and a pair of tokens in canonical order", () => {
    const pair = { subject: "event-subject", passthrough: ["models", "all-terrain"] };
    expect(normalizeFingerprintParameters("move-through", pair, V)).toEqual({ subject: "event-subject", passthrough: ["all-terrain", "models"] });
    expect(normalizeFingerprintParameters("move-through", { ...pair, passthrough: ["all-terrain", "models"] }, V)).toEqual({ subject: "event-subject", passthrough: ["all-terrain", "models"] });
  });

  it("refuses the new forms at the previous version", () => {
    expect(() => normalizeFingerprintParameters("move-through", { subject: "event-subject", passthrough: "models" }, PREVIOUS)).toThrow();
    expect(() => normalizeFingerprintParameters("move-through", { subject: "this-unit", passthrough: ["models", "all-terrain"] }, PREVIOUS)).toThrow();
  });

  it("refuses a pair that is not two distinct listed tokens, and a typed item inside a pair", () => {
    const with_ = (passthrough: unknown) => normalizeFingerprintParameters("move-through", { subject: "this-unit", passthrough }, V);
    expect(() => with_(["models", "models"])).toThrow(/twice/u);
    expect(() => with_(["models"])).toThrow(/exactly two/u);
    expect(() => with_(["models", "all-terrain", "tall-terrain"])).toThrow(/exactly two/u);
    expect(() => with_(["models", "bogus-token"])).toThrow(/must be one of/u);
    expect(() => with_([{ kind: "models" }, "all-terrain"])).toThrow(/stands alone/u);
  });

  it("lowers a pair as one passthrough list and the triggering unit as event-subject", () => {
    const text = `${BEFORE}it can move through models and all-terrain features.`;
    const move = normalizeFingerprintParameters("move-through", { subject: "event-subject", passthrough: ["models", "all-terrain"] }, V);
    const trigger = at(text, "After a friendly unit makes a Normal move", "event", { kind: "move-ended", owner: "friendly", move_types: ["normal"] }, "WHEN");
    const result = JSON.parse(compiled(text, [trigger, at(text, "it can move through models and all-terrain features", "move-through", move, "EFFECT")])).mechanics;
    expect(result.effect).toEqual({ type: "move-modifier", target: "event-subject", modifier: { passthrough: ["all-terrain", "models"] } });
    expect(effectOk(result.effect)).toBe(true);
  });

  it("lowers a single token and a typed item as version 3 did", () => {
    const text = "it can move through models.";
    const single = compiled(text, [at(text, "it can move through models", "move-through", { subject: "this-unit", passthrough: "models" }, "EFFECT")]);
    expect(JSON.parse(single).mechanics.effect).toEqual({ type: "move-modifier", target: "this-unit", modifier: { passthrough: ["models"] } });
  });
});

describe("eligibility-permission: the triggering unit as subject", () => {
  // The version that first accepts event-subject: the lowest one that does, not the current top (later versions widen it further).
  const accepts = (version: number) => { try { normalizeFingerprintParameters("eligibility-permission", { subject: "event-subject", activity: "move", allow: true }, version); return true; } catch { return false; } };
  const V = Array.from({ length: currentFamilyVersion("eligibility-permission") }, (_, at) => at + 1).find(accepts)!;
  const PREVIOUS = V - 1;

  it("keeps every value the previous version accepted, and accepts event-subject only from this version", () => {
    const plain = { subject: "this-unit", activity: "move", allow: true };
    expect(normalizeFingerprintParameters("eligibility-permission", plain, V)).toEqual(normalizeFingerprintParameters("eligibility-permission", plain, PREVIOUS));
    const moved = { subject: "event-subject", activity: "move", allow: true };
    expect(normalizeFingerprintParameters("eligibility-permission", moved, V)).toEqual(moved);
    expect(() => normalizeFingerprintParameters("eligibility-permission", moved, PREVIOUS)).toThrow();
    const modelPlain = { subject: "this-model", activity: "move", allow: true };
    expect(normalizeFingerprintParameters("eligibility-permission", modelPlain, V)).toEqual(normalizeFingerprintParameters("eligibility-permission", modelPlain, PREVIOUS));
  });

  it("refuses a permission on the triggering unit after a selection, which does not name the moving unit", () => {
    const text = "After a friendly unit is selected to move, it can move within Engagement Range.";
    const selected = at(text, "After a friendly unit is selected to move", "event", { kind: "selected", owner: "friendly", move_types: ["normal"] }, "WHEN");
    const permission = at(text, "it can move within Engagement Range", "eligibility-permission", { subject: "event-subject", activity: "move", allow: true }, "EFFECT");
    expect(refused(text, [selected, permission])).toMatch(/no move-ended event precedes it/u);
  });

  it("refuses a move-through on the triggering unit with no move-ended event before it", () => {
    const text = "After a friendly unit is selected to move, it can move through models.";
    const selected = at(text, "After a friendly unit is selected to move", "event", { kind: "selected", owner: "friendly", move_types: ["normal"] }, "WHEN");
    const through = at(text, "it can move through models", "move-through", { subject: "event-subject", passthrough: "models" }, "EFFECT");
    expect(refused(text, [selected, through])).toMatch(/no move-ended event precedes it/u);
  });

  it("binds a move permission on the triggering unit to that unit after a move-ended trigger", () => {
    const text = `${BEFORE}it can move within Engagement Range.`;
    const permission = at(text, "it can move within Engagement Range", "eligibility-permission", { subject: "event-subject", activity: "move", allow: true }, "EFFECT");
    const trigger = at(text, "After a friendly unit makes a Normal move", "event", { kind: "move-ended", owner: "friendly", move_types: ["normal"] }, "WHEN");
    const effect = JSON.parse(compiled(text, [trigger, permission])).mechanics.effect;
    expect(effect.type).toBe("permission");
    expect(effect.target).toBe("event-subject");
    expect(effectOk(effect)).toBe(true);
  });
});

describe("move-must-end cannot-end restriction on the triggering unit", () => {
  const cannotEnd = (text: string, trigger: CompileLeaf, subject: string) => [
    trigger,
    at(text, "it can move through models and all-terrain features", "move-through", normalizeFingerprintParameters("move-through", { subject: "event-subject", passthrough: ["models", "all-terrain"] }, currentFamilyVersion("move-through")), "EFFECT"),
    at(text, "it cannot end that move", "move-must-end", { match: "any", polarity: "cannot", move_types: MOVE_TYPES }, "RESTRICTION"),
    at(text, "within Engagement Range of them", "unit-state", { states: ["engaged"], subject, negated: false }, "CONDITION"),
  ];
  const text = `${BEFORE}it can move through models and all-terrain features, and it cannot end that move within Engagement Range of them.`;
  const moved = () => at(text, "After a friendly unit makes a Normal move", "event", { kind: "move-ended", owner: "friendly", move_types: MOVE_TYPES }, "WHEN");

  it("binds the engaged condition on the triggering unit to the move-through that names it", () => {
    const out = compiled(text, cannotEnd(text, moved(), "event-subject"));
    expect(out).toContain('"no_end_in_engagement":true');
    expect(out).toContain('"target":"event-subject"');
  });

  it("refuses the same condition after a selection, which does not name the moving unit", () => {
    const selected = at(text, "After a friendly unit makes a Normal move", "event", { kind: "selected", owner: "friendly", move_types: MOVE_TYPES }, "WHEN");
    expect(refused(text, cannotEnd(text, selected, "event-subject"))).toMatch(/no move-ended event precedes it/u);
  });

  it("refuses the condition on another subject, as before", () => {
    expect(refused(text, cannotEnd(text, moved(), "selected-unit"))).toMatch(/covers only "engaged" with this unit or model/u);
  });

  it("refuses the triggering unit's engagement when no move-through or permission in its sentence names it", () => {
    const bare = `${BEFORE}it cannot end that move within Engagement Range of them.`;
    const leaves = [
      at(bare, "After a friendly unit makes a Normal move", "event", { kind: "move-ended", owner: "friendly", move_types: MOVE_TYPES }, "WHEN"),
      at(bare, "it cannot end that move", "move-must-end", { match: "any", polarity: "cannot", move_types: MOVE_TYPES }, "RESTRICTION"),
      at(bare, "within Engagement Range of them", "unit-state", { states: ["engaged"], subject: "event-subject", negated: false }, "CONDITION"),
    ];
    expect(refused(bare, leaves)).toMatch(/no move-through or move permission in its sentence/u);
  });
});

describe("plural wording guard for a set-up after several targets", () => {
  const text = "Up to two VANGUARD units, or one TYRANIDS unit. Remove the targeted units from the battlefield and place them into Strategic Reserves.";
  const targets = (): CompileLeaf[] => [
    at(text, "Up to two", "stratagem-target", { count: "up-to", count_max: 2 }, "TARGET"),
    at(text, "VANGUARD units", "unit-filter", { side: "friendly", keywords: ["VANGUARD"] }, "TARGET"),
    at(text, "or one", "stratagem-target", { count: "one" }, "TARGET"),
    at(text, "TYRANIDS unit", "unit-filter", { side: "friendly", keywords: ["TYRANIDS"] }, "TARGET"),
  ];
  const setUp = () => at(text, "Remove the targeted units from the battlefield and place them into Strategic Reserves", "set-up", { subject: "antecedent", to: "strategic-reserves" }, "EFFECT");
  const amongFilter = () => at(text, "the targeted units", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "every" }, "EFFECT");

  it("refuses a set-up that points back to several targets with no among-filter", () => {
    expect(refused(text, [...targets(), setUp()])).toMatch(/points back to several of the Stratagem's targets; name them with an among-filter/u);
  });

  it("compiles the same set-up once an among-filter names every target it returns", () => {
    const out = compiled(text, [...targets(), amongFilter(), setUp()]);
    expect(out).toContain("first");
    expect(out).toContain("second");
  });

  it("keeps a singular reference after several targets on the focus fallback", () => {
    const singular = "Up to two VANGUARD units, or one TYRANIDS unit. Remove that unit from the battlefield.";
    const leaves = [
      at(singular, "Up to two", "stratagem-target", { count: "up-to", count_max: 2 }, "TARGET"),
      at(singular, "VANGUARD units", "unit-filter", { side: "friendly", keywords: ["VANGUARD"] }, "TARGET"),
      at(singular, "or one", "stratagem-target", { count: "one" }, "TARGET"),
      at(singular, "TYRANIDS unit", "unit-filter", { side: "friendly", keywords: ["TYRANIDS"] }, "TARGET"),
      at(singular, "Remove that unit from the battlefield", "set-up", { subject: "antecedent", to: "battlefield" }, "EFFECT"),
    ];
    expect(compiled(singular, leaves)).toContain("second");
  });
});

describe("set-up after several targets: the distance each target keeps (5725 shape)", () => {
  const text = "Up to two VANGUARD units, or one TYRANIDS unit. Remove the targeted units from the battlefield and place them into Strategic Reserves.";
  const full = `${text} The targeted units must be more than 3" away from all enemy units.`;
  const distance = { kind: "beyond", inches: 3, of: "matching-unit", of_side: "enemy", subject: "each-target", negated: false };

  it("normalizes a distance from every enemy unit, which names no keyword", () => {
    expect(normalizeFingerprintParameters("unit-position", distance, currentFamilyVersion("unit-position"))).toMatchObject({ kind: "beyond", inches: 3, of_side: "enemy", subject: "each-target" });
  });

  it("holds each target at that distance from every enemy unit, with the among-filter binding the set-up", () => {
    const leaves = [
      at(full, "Up to two", "stratagem-target", { count: "up-to", count_max: 2 }, "TARGET"),
      at(full, "VANGUARD units", "unit-filter", { side: "friendly", keywords: ["VANGUARD"] }, "TARGET"),
      at(full, "or one", "stratagem-target", { count: "one" }, "TARGET"),
      at(full, "TYRANIDS unit", "unit-filter", { side: "friendly", keywords: ["TYRANIDS"] }, "TARGET"),
      at(full, "the targeted units", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "every" }, "EFFECT"),
      at(full, "Remove the targeted units from the battlefield and place them into Strategic Reserves", "set-up", { subject: "antecedent", to: "strategic-reserves" }, "EFFECT"),
      at(full, 'The targeted units must be more than 3" away from all enemy units', "unit-position", distance, "RESTRICTION"),
    ];
    const out = compiled(full, leaves);
    expect(out).toContain("first");
    expect(out).toContain("second");
    expect(out).toContain("eligibility");
  });
});

describe("the 2256 leaf fixes on the triggering unit compile and validate", () => {
  const text = "After a friendly unit makes a Normal move, any Desperate Escape test that unit takes is automatically passed, and the Super-heavy Walker ability does not apply to it.";
  const trigger = () => at(text, "After a friendly unit makes a Normal move", "event", { kind: "move-ended", owner: "friendly", move_types: ["normal"] }, "WHEN");

  it("keeps the unit-state engaged condition on the triggering unit at the current version", () => {
    expect(normalizeFingerprintParameters("unit-state", { states: ["engaged"], subject: "event-subject", negated: false }, currentFamilyVersion("unit-state")))
      .toEqual({ states: ["engaged"], subject: "event-subject", negated: false });
  });

  it("automatically passes the triggering unit's Desperate Escape test, as a valid effect", () => {
    const effect = JSON.parse(compiled(text, [trigger(), at(text, "any Desperate Escape test that unit takes is automatically passed", "roll-auto-result", { subject: "event-subject", roll: "desperate-escape", outcome: "auto-pass" }, "EFFECT")])).mechanics.effect;
    expect(effectOk(effect)).toBe(true);
    expect(JSON.stringify(effect)).toContain('"event-subject"');
  });

  it("suppresses the Super-heavy Walker ability on the triggering unit, as a valid effect", () => {
    const effect = JSON.parse(compiled(text, [trigger(), at(text, "the Super-heavy Walker ability does not apply to it", "rule-state", { subject: "event-subject", direction: "suppressed", rule_kind: "ability", rule: "super-heavy-walker" }, "EFFECT")])).mechanics.effect;
    expect(effectOk(effect)).toBe(true);
    expect(JSON.stringify(effect)).toContain('"event-subject"');
  });
});
