import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

// Fabricated wording only. The compiler reads the punctuation and joining words between leaves,
// so each shape keeps the structure of a record with invented words.

type Piece = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];

/** Leaves at the byte offsets of their wording in `text`, in order. */
function placed(text: string, pieces: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return pieces.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: fragment ?? "RAW_TEXT" };
  });
}

function mechanicsOf(text: string, pieces: Piece[]): Record<string, any> {
  const result = compileLeaves(placed(text, pieces), text);
  if (!result.ok) throw new Error(`expected a compiled record, got: ${result.errors.join(" | ")}`);
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(text: string, pieces: Piece[]): string[] {
  const result = compileLeaves(placed(text, pieces), text);
  return result.ok ? [] : result.errors;
}

const keyword = (word: string): Record<string, unknown> => ({ keywords: [word], subject: "this-unit", negated: false });
const damage: Record<string, unknown> = { subject: "attack", characteristics: ["D"], operation: "add", value: 1, weapon_type: "all" };
const has = (word: string) => ({ type: "matches", parameters: { filter: { all_of: [word] } } });
const defenderHas = (words: string[]) => ({ type: "matches", parameters: { subject: "defender", filter: { any_of: words, level: "model" } } });

describe("an attack-target filter after a condition names the target the attack named (compile-unit-filters.ts)", () => {
  const text = "Until the end of the phase, each time an attack made by a model in your unit is allocated to an enemy model, if your unit has the ALPHA keyword and that enemy model is not a BETA or GAMMA, add 1 to the Damage characteristic of that attack. If your unit has the DELTA keyword and that enemy model is a BETA or GAMMA, add 1 to the Damage characteristic of that attack instead.";
  const pieces: Piece[] = [
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["attack made by a model in your unit", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
    ["enemy model", "unit-filter", { side: "enemy", level: "model" }],
    ["your unit has the ALPHA keyword", "unit-keyword", keyword("ALPHA")],
    ["that enemy model is not a BETA or GAMMA", "unit-filter", { side: "enemy", excluded_keywords: ["BETA", "GAMMA"], level: "model" }],
    ["add 1 to the Damage characteristic of that attack", "characteristic-modifier", damage],
    ["your unit has the DELTA keyword", "unit-keyword", keyword("DELTA")],
    ["that enemy model is a BETA or GAMMA", "unit-filter", { side: "enemy", any_keywords: ["BETA", "GAMMA"], level: "model" }],
    ["add 1 to the Damage characteristic of that attack", "characteristic-modifier", damage],
    ["instead", "instead", {}],
  ];

  it("gates each damage bonus on its own unit keyword and the defender's keywords", () => {
    const steps = mechanicsOf(text, pieces).effect.steps as Record<string, any>[];
    expect(steps).toHaveLength(2);
    expect(steps[1]!.condition).toEqual({ operator: "and", operands: [has("DELTA"), defenderHas(["BETA", "GAMMA"])] });
    expect(JSON.stringify(steps[0]!.condition)).toContain('"subject":"defender","filter":{"none_of":["BETA","GAMMA"],"level":"model"}');
  });

  it("does not let the first sentence's gate guard the instead sentence", () => {
    const steps = mechanicsOf(text, pieces).effect.steps as Record<string, any>[];
    expect(JSON.stringify(steps[1]!.condition)).not.toContain("ALPHA");
    expect(JSON.stringify(steps[0]!.condition)).toContain("ALPHA");
  });

  it("keeps a first-sentence condition that no 'if' opens as a gate on the instead sentence too", () => {
    const whileText = "While your unit has the ALPHA keyword, each time a model in your unit makes an attack, add 1 to the Damage characteristic of that attack. If your unit has the DELTA keyword, add 2 to the Damage characteristic of that attack instead.";
    const mechanics = mechanicsOf(whileText, [
      ["your unit has the ALPHA keyword", "unit-keyword", keyword("ALPHA")],
      ["attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["add 1 to the Damage characteristic of that attack", "characteristic-modifier", damage],
      ["your unit has the DELTA keyword", "unit-keyword", keyword("DELTA")],
      ["add 2 to the Damage characteristic of that attack", "characteristic-modifier", { ...damage, value: 2 }],
      ["instead", "instead", {}],
    ]);
    expect(mechanics.effect.condition).toEqual(has("ALPHA"));
  });

  it("keeps the refusal when no attack names the target", () => {
    const bare = "If your unit has the ALPHA keyword and that enemy model is a BETA, add 1 to the Damage characteristic of this unit.";
    const errors = errorsOf(bare, [
      ["your unit has the ALPHA keyword", "unit-keyword", keyword("ALPHA")],
      ["that enemy model is a BETA", "unit-filter", { side: "enemy", keywords: ["BETA"], level: "model" }],
      ["add 1 to the Damage characteristic of this unit", "characteristic-modifier", { ...damage, subject: "this-unit" }],
    ]);
    expect(errors.join(" ")).toContain("A unit-filter needs a select-unit or attack right before it");
  });

  it("keeps the refusal when the filter names the other side than the attack's target", () => {
    const wrongSide = pieces.map((piece): Piece => piece[0] === "that enemy model is a BETA or GAMMA" ? [piece[0], piece[1], { ...piece[2], side: "friendly" }] : piece);
    expect(errorsOf(text, wrongSide).join(" ")).toContain("A unit-filter needs a select-unit or attack right before it");
  });
});

describe("a leading destroyer filter and the object filter that restates the object owner (compile-unit-filters.ts)", () => {
  const text = "Just after a BETA unit from your army destroys an enemy unit, that unit can make a Normal move of up to 3\".";
  const destroyed = (extra: Record<string, unknown> = {}): Piece[] => [
    ["BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "WHEN"],
    ["from your army", "unit-owner", { owner: "friendly" }, "WHEN"],
    ["destroys an", "event", { kind: "unit-destroyed", by: "antecedent", object_owner: "enemy" }, "WHEN"],
    ["enemy unit", "unit-filter", { side: "enemy", ...extra }, "WHEN"],
    ["that unit can make a Normal move of up to 3\"", "make-move", { subject: "antecedent", move_type: "normal", distance: 3 }, "EFFECT"],
  ];

  it("names the filter before the owner as the destroyer and the enemy as the object", () => {
    const result = compileLeaves(placed(text, destroyed()), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    const mechanics = result.mechanics as unknown as Record<string, any>;
    expect(mechanics.trigger).toMatchObject({ event: "destroyed", subject: { owner: "friendly", all_of: ["BETA"] }, object: { owner: "enemy" } });
  });

  it("refuses an object filter that adds keywords the moment does not say", () => {
    expect(errorsOf(text, destroyed({ keywords: ["GAMMA"] })).join(" ")).toContain("A unit-filter needs a select-unit or attack right before it");
  });

  it("refuses an object filter of the other side than the object owner", () => {
    const pieces = destroyed();
    pieces[3] = ["enemy unit", "unit-filter", { side: "friendly" }, "WHEN"];
    expect(errorsOf(text, pieces).join(" ")).toContain("A unit-filter needs a select-unit or attack right before it");
  });
});

describe("a later Stratagem target measured from an earlier target (compile-target-refs.ts)", () => {
  const text = "Start of your Movement phase. One ALPHA unit from your army and up to three friendly BETA units within 6\" of that ALPHA unit. Until the end of the phase, those BETA units add 1 to their Move characteristic.";
  const pieces = (position: Piece): Piece[] => [
    ["Start of your Movement phase", "event", { kind: "phase-start", phase: "movement", turn: "your" }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
    ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
    ["up to three", "stratagem-target", { count: "up-to", count_max: 3 }, "TARGET"],
    ["friendly BETA units", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"],
    position,
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
    ["those BETA units", "unit-filter", { side: "friendly", keywords: ["BETA"], among: "stratagem-targets", targets: "any" }, "EFFECT"],
    ["add 1 to their Move characteristic", "characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "add", value: 1, weapon_type: "all" }, "EFFECT"],
  ];

  it("binds an antecedent distance to the first target", () => {
    const mechanics = mechanicsOf(text, pieces(["within 6\" of that ALPHA unit", "unit-position", { kind: "within", inches: 6, subject: "target", of: "antecedent", negated: false }, "TARGET"]));
    expect(JSON.stringify(mechanics)).not.toContain("this-unit");
    const result = compileLeaves(placed(text, pieces(["within 6\" of that ALPHA unit", "unit-position", { kind: "within", inches: 6, subject: "target", of: "antecedent", negated: false }, "TARGET"])), text);
    const second = (result.ok ? (result.core as any).target_restrictions : [])[1];
    expect(second.eligibility).toMatchObject({ operator: "and", operands: expect.arrayContaining([
      { type: "matches", parameters: { filter: { within: { of: { stratagem_target: "first" }, range: { inches: 6 } } } } },
    ]) });
  });
});

describe("a set-up that holds the among-filter naming its unit folds the placement limits after it (compile-set-up-placement.ts)", () => {
  const text = "Movement phase. One friendly ALPHA unit, and one friendly BETA model. Remove your ALPHA unit from the battlefield and then set it back up anywhere on the battlefield that is wholly within 6\" of your BETA model and not within Engagement Range of one or more enemy units.";
  const base = (setUp: Piece): Piece[] => [
    ["Movement phase", "use-window", { your_phases: ["movement"], opponent_phases: [], either_phases: [] }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
    ["one", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly BETA model", "unit-filter", { side: "friendly", keywords: ["BETA"], level: "model" }, "TARGET"],
    setUp,
    ["your ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"], among: "stratagem-targets", targets: "one" }, "EFFECT"],
    ["wholly within 6\" of", "unit-position", { kind: "within", inches: 6, of: "following-filter", subject: "antecedent", negated: false, wholly: true }, "EFFECT"],
    ["your BETA model", "unit-filter", { side: "friendly", keywords: ["BETA"], level: "model", among: "stratagem-targets", targets: "one" }, "EFFECT"],
    ["not within Engagement Range of one or more enemy units", "unit-state", { states: ["engaged"], subject: "antecedent", negated: true }, "EFFECT"],
  ];
  // The set-up's own wording opens at "Remove" so the among-filter sits inside its span; the limits come after its end.
  const containing: Piece = ["Remove your ALPHA unit from the battlefield and then set it back up anywhere on the battlefield", "set-up", { subject: "antecedent", to: "battlefield", from: "battlefield" }, "EFFECT"];

  /** `placed` walks forward, so the nested among-filter is moved ahead of the set-up that contains it. */
  function leavesOf(setUp: Piece): CompileLeaf[] {
    const all = placed(text, base(setUp).filter((piece) => piece !== setUp && piece[0] !== "your ALPHA unit"));
    const [set] = placed(text, [setUp]);
    const [among] = placed(text, [["your ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"], among: "stratagem-targets", targets: "one" }, "EFFECT"]]);
    return [...all, set!, among!].sort((left, right) => left.start_byte - right.start_byte || (right.end_byte ?? 0) - (left.end_byte ?? 0));
  }

  it("binds the set-up to the unit target and folds the near and unengaged limits", () => {
    const result = compileLeaves(leavesOf(containing), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    const effect = (result.mechanics as unknown as Record<string, any>).effect;
    expect(effect).toMatchObject({ type: "set-up", target: { stratagem_target: "first" } });
    expect(effect.modifier.near).toEqual([{ of: { stratagem_target: "second" }, range: { inches: 6 }, wholly: true }]);
    expect(effect.modifier.placement).toBe("unengaged");
  });

  it("still refuses a bare set-up when no among-filter names its unit target", () => {
    const bare: Piece = ["Remove your ALPHA unit from the battlefield and then set it back up anywhere on the battlefield", "set-up", { subject: "antecedent", to: "battlefield", from: "battlefield" }, "EFFECT"];
    const result = compileLeaves(placed(text, base(bare).filter((piece) => piece[0] !== "your ALPHA unit")), text);
    // The bare "it" names the last target, a model; a set-up places a unit.
    expect(result.ok ? [] : result.errors.join(" ")).toMatch(/model-level Stratagem target/u);
  });
});
