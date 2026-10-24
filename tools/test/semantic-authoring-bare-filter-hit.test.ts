import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { bindBareFilterHits } from "../src/semantic-authoring/compile-weapon-qualified.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";

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

const SHOOTING = ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }] as const;
const AFTER_SHOT = ["after this model has shot", "event", { kind: "after-shooting" }] as const;
const INFANTRY = ["enemy INFANTRY unit", "unit-filter", { side: "enemy", keywords: ["INFANTRY"] }] as const;
const HIT_BY = ["was hit by one or more of those attacks", "hit-by-attacks", { subject: "antecedent" }] as const;
const ZAP = ["made with a zap cannon", "attack-filter", { weapon_name: "zap cannon" }] as const;
const PINNED = ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }] as const;

/** "each enemy INFANTRY unit was hit by … made with a zap cannon. … that enemy unit is pinned." */
const TEXT = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";

describe("a bare unit-filter gated by a hit-by condition after it", () => {
  it("binds the hit and its attack-filter to a per-unit pass over the filter's units", () => {
    const mechanics = mechanicsOf(placed(TEXT, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ZAP, PINNED), TEXT);
    const json = JSON.stringify(mechanics);
    expect(json).toContain('"type":"for-each-unit"');
    expect(json).toContain('"filter":{"owner":"enemy","all_of":["INFANTRY"]}');
    expect(json).toContain('"weapons":{"name":"zap cannon"}');
    expect(json).toContain('"object":"this-unit"');
  });

  it("gates on no weapon when the hit-by condition has no attack-filter", () => {
    const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks. Until the end of the turn, that enemy unit is pinned.";
    const json = JSON.stringify(mechanicsOf(placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, PINNED), text));
    expect(json).toContain('"type":"for-each-unit"');
    expect(json).not.toContain('"weapons"');
  });

  it("refuses a hit-by condition with no 'that unit' after it", () => {
    const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon.";
    const result = compileLeaves(placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ZAP), text);
    expect(result.ok).toBe(false);
    expect(result.errors?.join(" ")).toContain("needs a 'that unit' after it");
  });

  it("leaves a hit-by condition with subject this-unit alone", () => {
    const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
    const list = placed(text, SHOOTING, AFTER_SHOT, INFANTRY, ["was hit by one or more of those attacks", "hit-by-attacks", { subject: "this-unit" }], ZAP, PINNED);
    expect(bindBareFilterHits(list, text)).toEqual(list);
  });

  it("refuses a moment that is not this unit's own after-shooting event", () => {
    const text = "After enemy units have shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
    const list = placed(text, ["After enemy units have shot", "event", { kind: "attacks-resolved", subject: "enemy" }], INFANTRY, HIT_BY, ZAP, PINNED);
    expect(() => bindBareFilterHits(list, text)).toThrow("needs the attacks of this unit's own moment");
  });

  it("refuses an attacks-resolved moment that names no subject (this model's own attacks)", () => {
    const text = "After all of this model's attacks are resolved, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
    const list = placed(text, ["After all of this model's attacks are resolved", "event", { kind: "attacks-resolved" }], INFANTRY, HIT_BY, ZAP, PINNED);
    expect(() => bindBareFilterHits(list, text)).toThrow("needs the attacks of this unit's own moment");
  });

  it("refuses a negated attack-filter instead of dropping it", () => {
    const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
    const list = placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ["made with a zap cannon", "attack-filter", { weapon_name: "zap cannon", negated: true }], PINNED);
    expect(() => bindBareFilterHits(list, text)).toThrow("cannot be negated");
  });

  it("refuses an attack-filter field the hit filter does not have", () => {
    const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
    const list = placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ["made with a zap cannon", "attack-filter", { side: "enemy" }], PINNED);
    expect(() => bindBareFilterHits(list, text)).toThrow("names side");
  });

  it("refuses a per-unit pass that shares a record with a count-scale", () => {
    const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
    const list = placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ZAP, PINNED);
    const scaled = [...list, { role: "EFFECT", family_id: "count-scale", family_version: currentFamilyVersion("count-scale"), parameters: {}, start_byte: 0, end_byte: 1, fragment: "RAW_TEXT" } as CompileLeaf];
    expect(() => bindBareFilterHits(scaled, text)).toThrow("cannot share a record");
  });

  it("refuses a per-unit pass that shares a record with an army composition", () => {
    const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
    const list = placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ZAP, PINNED);
    const composed = [...list, { role: familyRole("army-construction", currentFamilyVersion("army-construction")), family_id: "army-construction", family_version: currentFamilyVersion("army-construction"), parameters: { rule: "composition" }, start_byte: 0, end_byte: 1, fragment: "RAW_TEXT" } as CompileLeaf];
    expect(() => bindBareFilterHits(composed, text)).toThrow("cannot share a record");
  });

  it("refuses a second hit-by condition on the same bare filter", () => {
    const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks, and was hit by one or more of those attacks. Until the end of the turn, that enemy unit is pinned.";
    const list = placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ["and was hit by one or more of those attacks", "hit-by-attacks", { subject: "antecedent" }], PINNED);
    expect(() => bindBareFilterHits(list, text)).toThrow("takes one hit-by condition");
  });
});

/** The record's shape with fabricated wording: the hit, its weapon filter, the mark, and the two effects on "that unit". */
const MIRROR = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned. While a unit is pinned, subtract 2 from that unit's Move. Subtract 2 from Charge rolls made for that unit.";

describe("the full hit-by shape compiles once the leaves are authored", () => {
  it("binds the Charge roll-modifier to the hit unit when its subject is the antecedent", () => {
    const list = placed(MIRROR, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ZAP,
      ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }],
      ["While a unit is pinned", "rule-active", { rule: "pinned" }],
      ["subtract 2 from that unit's Move", "characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "subtract", value: 2, weapon_type: "all" }],
      ["Subtract 2 from Charge rolls made for that unit", "roll-modifier", { roll: "charge", operation: "subtract", value: 2, subject: "antecedent" }]);
    const result = compileLeaves(list, MIRROR);
    expect(result.ok).toBe(true);
    const json = JSON.stringify(result.ok ? result.mechanics : null);
    expect(json).toContain('"type":"for-each-unit"');
    expect(json).toContain('"weapons":{"name":"zap cannon"}');
  });
});
