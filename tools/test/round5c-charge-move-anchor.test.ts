import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

/**
 * A positive "must end that charge move" restriction anchored to a declared charge, and the nested
 * engaged-with chain it may carry. Every leaf is fabricated wording; each case pins one binding,
 * one fold or one refusal. Leaves are compiled without source text, as the other round5c tests do.
 */

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>, fragment = "EFFECT"): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: currentFamilyVersion(familyId), parameters, start_byte: offset, end_byte: offset + 5, fragment };
}

const declare = (action = "charge") => leaf("EVENT", "event", { kind: "targets-selected", action_kind: action });
const reroll = () => leaf("EFFECT", "reroll", { roll: "charge", subset: "all", weapon_type: "all" });
const mustEnd = (match = "all", extra: Record<string, unknown> = {}) => leaf("RESTRICTION", "move-must-end", { match, ...extra });
const engagedWith = (subject: string, withValue: string, extra: Record<string, unknown> = {}) =>
  leaf("CONDITION", "unit-state", { states: ["engaged"], subject, with: withValue, negated: false, ...extra });
const optionalUse = () => leaf("RESTRICTION", "optional-use", { who: "you" });
const engagedAny = (subject: string) => leaf("CONDITION", "unit-state", { states: ["engaged"], subject, negated: false });
const enemy = () => leaf("CONDITION", "unit-filter", { side: "enemy" });
const friendlyCharacter = () => leaf("CONDITION", "unit-filter", { side: "friendly", keywords: ["CHARACTER"] });

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}
function refused(leaves: CompileLeaf[]): string {
  const result = compileLeaves(leaves);
  if (result.ok) throw new Error("expected a refusal");
  return result.errors.join("; ");
}
const json = (value: unknown) => JSON.stringify(value);

describe("positive must-end anchored to a declared charge", () => {
  it("lowers to a charge move-modifier on the declaring unit, in the declaration's part with the reroll", () => {
    const mechanics = json(compiled([declare(), reroll(), mustEnd(), engagedAny("this-unit")]));
    // The subject this-unit is rewritten to event-subject, the moving unit the declaration names.
    expect(mechanics).toContain(json({ type: "move-modifier", target: "event-subject", modifier: { applies_to_moves: ["charge"], ends_when: { type: "unit-state", parameters: { subject: "event-subject", state: "engaged" } } } }));
    // Same sequence as the reroll: the move-modifier is one of the steps the declaration starts.
    const sequence = JSON.parse(mechanics).effect ?? JSON.parse(mechanics);
    expect(json(sequence)).toMatch(/"re-roll"[\s\S]*"move-modifier"/u);
  });

  it("joins several conditions with or for match any and with and for match all", () => {
    const anyOf = json(compiled([declare(), reroll(), mustEnd("any"), engagedAny("this-unit"), engagedAny("event-subject")]));
    expect(anyOf).toContain('"operator":"or"');
    const allOf = json(compiled([declare(), reroll(), mustEnd("all"), engagedAny("this-unit"), engagedAny("event-subject")]));
    expect(allOf).toContain('"operator":"and"');
  });

  it("takes a nested engaged-with chain: the enemy filter is engaged with the friendly filter after the inner state", () => {
    const mechanics = json(compiled([
      declare(), optionalUse(), reroll(), mustEnd(), engagedWith("event-subject", "following-filter"), enemy(),
      engagedWith("antecedent", "following-filter"), friendlyCharacter(),
    ]));
    expect(mechanics).toContain(json({ owner: "enemy", engaged_with: { owner: "friendly", all_of: ["CHARACTER"] } }));
    expect(mechanics).toContain(json({ type: "unit-state", parameters: { subject: "event-subject", state: "engaged", with: { owner: "enemy", engaged_with: { owner: "friendly", all_of: ["CHARACTER"] } } } }));
    // The inner state and the partner are consumed: no stray condition or unit-filter is left.
    expect(mechanics).not.toContain('"owner":"friendly","all_of":["CHARACTER"]},"effect"');
    // The move-modifier stays inside the optional charge part, so the optional-use gate still wraps it.
    expect(mechanics).toContain('"trigger":{"event":"targets-selected","filter":{"kind":"charge"},"optional":true}');
  });

  it("refuses a nested chain whose inner state has at, negation, or no antecedent subject", () => {
    const outer = [declare(), reroll(), mustEnd(), engagedWith("event-subject", "following-filter"), enemy()];
    const plainMessage = "An engaged-with chain takes a plain engaged state that names its unit";
    expect(refused([...outer, engagedWith("antecedent", "following-filter", { at: "phase-start" }), friendlyCharacter()])).toContain(plainMessage);
    expect(refused([...outer, engagedWith("antecedent", "following-filter", { negated: true }), friendlyCharacter()])).toContain(plainMessage);
  });

  it("refuses a nested chain nested a second level", () => {
    const refusal = refused([
      declare(), reroll(), mustEnd(), engagedWith("event-subject", "following-filter"), enemy(),
      engagedWith("antecedent", "following-filter"), friendlyCharacter(), engagedWith("antecedent", "following-filter"), enemy(),
    ]);
    expect(refusal).toContain("takes one level of nesting");
  });

  it("refuses a positive must-end whose nearest trigger is not a declared charge", () => {
    const generic = "\"Must end that move\" has no move before it.";
    expect(refused([leaf("EVENT", "event", { kind: "move-ended" }), reroll(), mustEnd(), engagedWith("this-unit", "antecedent")])).toContain(generic);
    expect(refused([declare("shoot"), reroll(), mustEnd(), engagedWith("this-unit", "antecedent")])).toContain(generic);
    expect(refused([leaf("EVENT", "event", { kind: "selected", move_types: ["charge"] }), reroll(), mustEnd(), engagedWith("this-unit", "antecedent")])).toContain(generic);
    // A move-ended trigger after a declared charge is the nearest event: the charge is not borrowed.
    expect(refused([declare(), leaf("EVENT", "event", { kind: "move-ended" }), reroll(), mustEnd(), engagedWith("this-unit", "antecedent")])).toContain(generic);
  });

  it("refuses move types other than charge, zero conditions, and a this-model subject", () => {
    expect(refused([declare(), reroll(), mustEnd("all", { move_types: ["normal"] }), engagedWith("this-unit", "antecedent")])).toContain("names a move type the trigger does not name");
    expect(refused([declare(), reroll(), mustEnd()])).toContain("names no condition for where the move ends");
    expect(refused([declare(), reroll(), mustEnd(), engagedWith("this-model", "antecedent")])).toContain("names a model, which the charge path does not take");
  });

  it("keeps the make-move path when the ability makes the move, with no charge move-modifier", () => {
    const mechanics = json(compiled([declare(), reroll(), leaf("EFFECT", "make-move", { move: "normal" }), mustEnd(), engagedWith("this-unit", "antecedent")]));
    expect(mechanics).not.toContain('"applies_to_moves":["charge"]');
    expect(mechanics).toContain('"ends_when"');
  });

  it("keeps the cannot-end path refusing a charge declaration with no move-ended trigger", () => {
    const cannot = refused([declare(), reroll(), mustEnd("all", { polarity: "cannot" }), engagedAny("this-unit")]);
    expect(cannot).toContain("no move-ended trigger precedes it");
  });
});

describe("engaged distance partner (unit-filter state engaged)", () => {
  it("lowers a distance to an engaged enemy unit to the enemy filter's state, not an engaged_with partner", () => {
    // Reading (a): engaged with any unit. Pins the existing lowering the record's WHEN relies on.
    const mechanics = json(compiled([
      declare(), friendlyCharacter(), leaf("CONDITION", "unit-position", { kind: "within", inches: 12, of: "following-filter", subject: "this-unit", negated: false }),
      leaf("CONDITION", "unit-filter", { side: "enemy", states: ["engaged"] }), reroll(),
    ]));
    expect(mechanics).toContain(json({ type: "within", parameters: { of: { owner: "enemy", state: "engaged" }, range: { inches: 12 } } }));
  });
});

describe("authored shapes the charge anchor compiles from", () => {
  // Each leaf the drafter authors for these records must pass the save gate, or it cannot be stored.
  it("accepts the unit-state shapes at the current version (this-unit bound, event-subject, nested inner)", () => {
    const version = currentFamilyVersion("unit-state");
    const shapes: Record<string, unknown>[] = [
      { states: ["engaged"], subject: "this-unit", with: "antecedent", negated: false },
      { states: ["engaged"], subject: "event-subject", with: "following-filter", negated: false },
      { states: ["engaged"], subject: "antecedent", with: "following-filter", negated: false },
    ];
    for (const shape of shapes) expect(() => normalizeFingerprintParameters("unit-state", shape, version)).not.toThrow();
  });

  it("accepts the move-must-end and reroll shapes the charge path reads", () => {
    expect(() => normalizeFingerprintParameters("move-must-end", { match: "all" }, currentFamilyVersion("move-must-end"))).not.toThrow();
    expect(() => normalizeFingerprintParameters("move-must-end", { match: "any", polarity: "cannot" }, currentFamilyVersion("move-must-end"))).not.toThrow();
  });
});
