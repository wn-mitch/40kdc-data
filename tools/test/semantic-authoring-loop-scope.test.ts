import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { replacingConditions } from "../src/semantic-authoring/compile-instead-scope.js";
import { unscopedRecipientEffect } from "../src/semantic-authoring/compile-recipient-scope.js";

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
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function compiled(text: string, ...items: Item[]): Record<string, unknown> {
  const result = compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-loop-scope" });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, unknown>;
}

/** Every node of a type in a compiled tree. */
function nodes(tree: unknown, type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if ((node as Record<string, unknown>).type === type) found.push(node as Record<string, unknown>);
      Object.values(node).forEach(walk);
    }
  };
  walk(tree);
  return found;
}

describe("Semantic authoring loop scope", () => {
  const TEXT = "At the end of your Command phase, each enemy unit within 6\" of this unit must take a Battle-shock test. When a unit uses its rite, that unit heals D3 wounds.";
  const LOOP: Item[] = [
    ["At the end of your Command phase", "event", { kind: "phase-end", phase: "command", turn: "your" }],
    ["each", "for-each-unit-select", {}],
    ["enemy unit", "unit-filter", { side: "enemy" }],
    ["within 6\" of this unit", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false }],
    ["must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }],
  ];

  it("binds \"that unit\" after a later moment of a unit to that moment's unit, not a pass of the loop", () => {
    const mechanics = compiled(TEXT, ...LOOP,
      ["a unit uses its rite", "event", { kind: "used", activity: "ability", owner: "friendly", id: "reanimation-protocols-necrons" }],
      ["that unit heals D3 wounds", "regain-wounds", { subject: "antecedent", amount: "D3" }]);
    const heals = nodes(mechanics, "heal");
    expect(heals.map((node) => node.target)).toEqual(["event-subject"]);
    // The loop's own effect still names each pass's unit.
    expect(nodes(nodes(mechanics, "for-each-unit")[0], "test").map((node) => node.target)).toEqual(["recipient"]);
  });

  it("reads a use of a named ability with no owner as the using unit's moment too", () => {
    const mechanics = compiled(TEXT, ...LOOP,
      ["a unit uses its rite", "event", { kind: "used", activity: "ability", id: "reanimation-protocols-necrons" }],
      ["that unit heals D3 wounds", "regain-wounds", { subject: "antecedent", amount: "D3" }]);
    expect(nodes(mechanics, "heal").map((node) => node.target)).toEqual(["event-subject"]);
  });

  // An Army Faction gate holds both parts in one leaf list, as the antecedent binder then sees them.
  const GATED = "If your Army Faction is NECRONS, at the end of your Command phase, each friendly unit that is on the battlefield must take a Battle-shock test:\n■ When a unit uses its rite, that unit heals D3 wounds.";
  const GATE: Item = ["If your Army Faction is NECRONS", "army-faction", { faction: "necrons" }];
  const LOOP_GATED: Item[] = [GATE, ["at the end of your Command phase", "event", { kind: "phase-end", phase: "command", turn: "your" }],
    ["each", "for-each-unit-select", {}], ["friendly unit", "unit-filter", { side: "friendly" }],
    ["that is on the battlefield", "unit-state", { states: ["on-battlefield"], subject: "antecedent", negated: false }],
    ["must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }]];
  const USE: Item = ["a unit uses its rite", "event", { kind: "used", activity: "ability", owner: "friendly", id: "reanimation-protocols-necrons" }];
  const HEAL: Item = ["that unit heals D3 wounds", "regain-wounds", { subject: "antecedent", amount: "D3" }];

  it("ends the loop's binding at a later part's moment when one leaf list holds both parts", () => {
    const use: Item = ["a unit uses its rite", "event", { kind: "used", activity: "ability", id: "reanimation-protocols-necrons" }];
    expect(nodes(compiled(GATED, ...LOOP_GATED, use, HEAL), "heal").map((node) => node.target)).toEqual(["event-subject"]);
  });

  it("keeps a moment right after the loop, with no effect of the loop before it, inside the loop", () => {
    const text = "If your Army Faction is NECRONS, for each enemy unit within 6\" of this unit, when a unit uses its rite, that unit heals D3 wounds.";
    const mechanics = compiled(text, GATE, ["for each", "for-each-unit-select", {}], ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\" of this unit", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false }], USE, HEAL);
    expect(nodes(mechanics, "heal").map((node) => node.target)).toEqual(["recipient"]);
  });

  it("keeps \"that unit\" the loop's unit when no later moment opens a part", () => {
    const text = "At the end of your Command phase, each enemy unit within 6\" of this unit must take a Battle-shock test, and that unit heals D3 wounds.";
    const mechanics = compiled(text, ...LOOP, ["that unit heals D3 wounds", "regain-wounds", { subject: "antecedent", amount: "D3" }]);
    expect(nodes(mechanics, "heal").map((node) => node.target)).toEqual(["recipient"]);
  });
});

describe("Semantic authoring instead over filtered units", () => {
  const warlord = { type: "happened", parameters: { event: "model-destroyed", object: { owner: "enemy", designated: "warlord", level: "model" }, window: "event" } };
  const within = { type: "matches", parameters: { subject: "recipient", filter: { within: { of: "this-unit", range: { inches: 6 } } } } };
  const noRoll = () => false;

  it("leaves out of the negation the conditions that only say which units a filtered replacement reaches", () => {
    const replacement = { node: { type: "test", target: { owner: "enemy" } }, gate: [warlord, within] };
    expect(replacingConditions(replacement, [{ node: { type: "test", target: "selected-unit" } }], noRoll)).toEqual([warlord]);
  });

  it("keeps a recipient condition when the default applies to a recipient too (an aura's \"if that unit is K … instead\")", () => {
    const replacement = { node: { type: "roll-modifier", target: { owner: "friendly" } }, gate: [within] };
    expect(replacingConditions(replacement, [{ node: { type: "roll-modifier", target: "recipient" } }], noRoll)).toEqual([within]);
  });

  it("keeps a recipient condition when the replacement applies to one unit, not a filter's units", () => {
    const replacement = { node: { type: "test", target: "recipient" }, gate: [warlord, within] };
    expect(replacingConditions(replacement, [{ node: { type: "test", target: "selected-unit" } }], noRoll)).toEqual([warlord, within]);
  });
});

describe("Semantic authoring recipient scope", () => {
  it("refuses an effect bound to the recipient when no aura or loop applies it to any unit", () => {
    const text = "At the start of the Fight phase, that unit must take a Battle-shock test.";
    const result = compileLeaves(placed(text,
      ["At the start of the Fight phase", "event", { kind: "phase-start", phase: "fight", turn: "either" }],
      ["that unit must take a Battle-shock test", "test", { target: "recipient", test: "battle-shock" }]), text, { abilityId: "fabricated-loop-scope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("; ")).toContain("no aura or for-each-unit applies it");
  });

  it("accepts a recipient inside an aura or a loop, and a condition on the recipient of a filtered effect", () => {
    const test = { type: "test", target: "recipient", modifier: { test: "battle-shock" } };
    expect(unscopedRecipientEffect({ type: "aura", effect: test })).toBeNull();
    expect(unscopedRecipientEffect({ type: "for-each-unit", selector: { filter: { owner: "enemy" } }, effect: test })).toBeNull();
    expect(unscopedRecipientEffect({ type: "conditional", condition: { type: "matches", parameters: { subject: "recipient" } }, effect: { ...test, target: { owner: "enemy" } } })).toBeNull();
    expect(unscopedRecipientEffect({ type: "sequence", steps: [{ type: "conditional", effect: test }] })).toBe("test");
  });
});

describe("Semantic authoring gates after a selection", () => {
  const COVER = "At the start of your Command phase, select up to two friendly ALPHA units. Until the end of the turn, each time a ranged attack targets one of those units, models in that unit have the Benefit of Cover against that attack.";
  const SELECT: Item[] = [
    ["At the start of your Command phase", "event", { kind: "phase-start", phase: "command", turn: "your" }],
    ["select up to two", "select-unit", { distance: "any", visible: false, count: 2, up_to: true }],
    ["friendly ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
  ];
  const UNTIL: Item = ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }];

  it("gates the effects inside the selection, and only on attacks against a selected unit", () => {
    const mechanics = compiled(COVER, ...SELECT, UNTIL,
      ["each time a ranged attack targets one of those units", "attack", { direction: "targeted", unit: "that-unit", attack_type: "ranged" }],
      ["models in that unit have the Benefit of Cover against that attack", "core-ability-grant", { subject: "antecedent", ability: "benefit-of-cover" }]);
    const selection = nodes(mechanics, "select-units");
    expect(selection).toHaveLength(1);
    // The selection is made at the moment, before any attack: no attack gate outside it.
    expect(nodes(mechanics, "attack-is")).toEqual(nodes(selection[0], "attack-is"));
    expect(nodes(selection[0], "attack-is")).toHaveLength(1);
    expect(nodes(selection[0], "same-unit").map((node) => node.parameters)).toEqual([{ subject: "defender", as: "selected-unit" }]);
    expect(nodes(selection[0], "ability-grant").map((node) => node.target)).toEqual(["selected-unit"]);
  });

  it("keeps an owner after the selection out of the selected units' effects", () => {
    const text = "At the start of your Command phase, select up to two friendly ALPHA units from your army. Until the end of the turn, models in that unit have the Benefit of Cover.";
    const mechanics = compiled(text, ...SELECT, ["from your army", "unit-owner", { owner: "friendly" }], UNTIL,
      ["models in that unit have the Benefit of Cover", "core-ability-grant", { subject: "antecedent", ability: "benefit-of-cover" }]);
    expect(nodes(nodes(mechanics, "select-units")[0], "conditional")).toEqual([]);
  });

  it("gates every sentence a colon lists after the gate, and only its own sentence otherwise", () => {
    const listed = "At the start of your Command phase, select up to two friendly ALPHA units. Their ranged attacks can: Re-roll Hit rolls of 1. Re-roll Wound rolls of 1.";
    const items = (text: string): Item[] => [...SELECT,
      ["Their ranged attacks", "attack-filter", { attack_type: "ranged" }],
      [text.includes("can:") ? "Re-roll Hit rolls of 1" : "re-roll Hit rolls of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }],
      ["Re-roll Wound rolls of 1", "reroll", { roll: "wound", subset: "ones", weapon_type: "all" }]];
    const gatedRerolls = (mechanics: Record<string, unknown>) => nodes(mechanics, "conditional")
      .filter((node) => (node.condition as Record<string, unknown>).type === "attack-is").flatMap((node) => nodes(node, "re-roll"));
    expect(gatedRerolls(compiled(listed, ...items(listed)))).toHaveLength(2);
    const unlisted = "At the start of your Command phase, select up to two friendly ALPHA units. Their ranged attacks re-roll Hit rolls of 1. Re-roll Wound rolls of 1.";
    expect(gatedRerolls(compiled(unlisted, ...items(unlisted)))).toHaveLength(1);
  });
});

describe("Semantic authoring effects before a selection", () => {
  const PHASE: Item = ["At the start of your Command phase", "event", { kind: "phase-start", phase: "command", turn: "your" }];
  const HEAL: Item = ["this unit heals D3 wounds", "regain-wounds", { subject: "this-unit", amount: "D3" }];
  const SELECT: Item[] = [["select one", "select-unit", { distance: "any", visible: false }], ["enemy unit", "unit-filter", { side: "enemy" }],
    ["that unit must take a Battle-shock test", "test", { target: "selected-unit", test: "battle-shock" }]];

  it("keeps the effects of a sentence before the selection's outside the select", () => {
    const text = "At the start of your Command phase, this unit heals D3 wounds. Then select one enemy unit: that unit must take a Battle-shock test.";
    const effect = compiled(text, PHASE, HEAL, ...SELECT).effect as Record<string, unknown>;
    expect(effect.type).toBe("sequence");
    const [first, second] = effect.steps as Record<string, unknown>[];
    expect(first!.type).toBe("heal");
    expect(second!.type).toBe("select-units");
    expect(nodes(second, "heal")).toEqual([]);
  });

  it("keeps a sentence's effects inside the select when the selection opens that sentence", () => {
    const text = "At the start of your Command phase, select one enemy unit: that unit must take a Battle-shock test, and this unit heals D3 wounds.";
    const effect = compiled(text, PHASE, ...SELECT, HEAL).effect as Record<string, unknown>;
    expect(effect.type).toBe("select-units");
    expect(nodes(effect, "heal")).toHaveLength(1);
  });
});
