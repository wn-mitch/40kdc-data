import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { compileLeaves, leafFragment, type CompileLeaf } from "../src/round5c/compile.js";
import { CompileError } from "../src/round5c/compile-fragments.js";
import { trigger, triggerLeaves } from "../src/round5c/compile-triggers.js";
import { TRIGGER_ROLL_KINDS } from "../src/round5c/dice-families.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

// Fabricated wording only; no GW rule prose.

/** Leaves on their own wording in `text`, in order. `versions` pins a family below its current version. */
function placed(text: string, items: Array<[string, string, Record<string, unknown>]>, versions: Record<string, number> = {}): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = versions[family] ?? currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version),
      start_byte: start, end_byte: from, fragment: "RAW_TEXT",
    };
  });
}

const compiled = (leaves: CompileLeaf[], text: string) => {
  const result = compileLeaves(leaves, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
};

const refusal = (leaves: CompileLeaf[], text: string): string | null => {
  const result = compileLeaves(leaves, text);
  return result.ok ? null : result.errors.join("; ");
};

// Each mechanics result must also be a valid DSL entry (the schema the data files are checked against).
function authored(faction: string, abilityId: string): Record<string, unknown> {
  const enrichment = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
  return (JSON.parse(readFileSync(join(enrichment, faction, "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
    .find((item) => item.ability_id === abilityId)!;
}
const schemaErrors = (mechanics: unknown) => checkEntry(entryWithMechanics(authored("world-eaters", "blessings-of-khorne-world-eaters"), mechanics as never)).errors;

const NORMALIZE_EVENT = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("event", parameters, currentFamilyVersion("event"));

describe("event rolls list (event version 19)", () => {
  // "Each time that enemy unit takes a Battle-shock or Leadership test": one list moment, two triggers.
  const AURA_TEXT = "While an enemy unit is within 6\" of this unit, each time that enemy unit takes a Battle-shock or Leadership test, subtract 1 from the result.";
  const aura: Array<[string, string, Record<string, unknown>]> = [
    ["an enemy unit", "unit-filter", { side: "enemy" }],
    ["within 6\" of this unit", "aura-range", { inches: 6, of: "this-unit" }],
  ];
  const subtract: [string, string, Record<string, unknown>] = ["subtract 1 from the result", "roll-modifier", { operation: "subtract", value: 1, rolls: ["battle-shock", "leadership"] }];

  it("lowers a list moment to the same mechanics as one leaf per roll kind", () => {
    const list = compiled(placed(AURA_TEXT, [
      ...aura,
      ["each time that enemy unit takes a Battle-shock or Leadership test", "event", { kind: "before-roll", rolls: ["battle-shock", "leadership"] }],
      subtract,
    ]), AURA_TEXT);
    const singles = compiled(placed(AURA_TEXT, [
      ...aura,
      ["each time that enemy unit takes a Battle-shock", "event", { kind: "before-roll", roll: "battle-shock" }],
      ["Leadership test", "event", { kind: "before-roll", roll: "leadership" }],
      subtract,
    ]), AURA_TEXT);
    expect(list).toEqual(singles);
    expect(list.trigger).toEqual([{ event: "before-roll", filter: { roll: "battle-shock" } }, { event: "before-roll", filter: { roll: "leadership" } }]);
    expect(schemaErrors(list)).toEqual([]);
  });

  it("keeps the moment's subject on every trigger it lowers to", () => {
    const text = "Once per battle, after making a Hit roll, Wound roll or saving throw for this model, you can change the result of that roll to an unmodified 6.";
    const mechanics = compiled(placed(text, [
      ["Once per battle", "usage-limit", { frequency: "once-per-battle", per: "unit" }],
      ["after making a Hit roll, Wound roll or saving throw for this model", "event", { kind: "after-roll", rolls: ["hit", "wound", "save"], subject: "this-model" }],
      ["you can", "optional-use", { who: "you" }],
      ["change the result of that roll to an unmodified 6", "roll-auto-result", { roll: "any", outcome: "counts-as-6", subject: "this-model" }],
    ]), text);
    expect(mechanics.trigger).toHaveLength(3);
    for (const item of mechanics.trigger as Array<Record<string, unknown>>) expect(item).toMatchObject({ event: "after-roll", subject: "this-model", optional: true });
    expect((mechanics.trigger as Array<{ filter: { roll: string } }>).map((item) => item.filter.roll)).toEqual(["hit", "wound", "save"]);
    expect(mechanics.effect).toMatchObject({ type: "roll-result", target: "this-model", modifier: { roll: "any", result: 6 } });
    expect(schemaErrors(mechanics)).toEqual([]);
  });

  it("gives a list moment with no subject the unit's own rolls, one optional change per roll", () => {
    const text = "When this unit makes hit rolls or wound rolls, you can use this ability. If you do, change one of those rolls to an unmodified 6.";
    const mechanics = compiled(placed(text, [
      ["When this unit makes hit rolls or wound rolls", "event", { kind: "after-roll", rolls: ["hit", "wound"] }],
      ["you can use this ability", "optional-use", { who: "you" }],
      ["change one of those rolls to an unmodified 6", "roll-auto-result", { roll: "any", outcome: "counts-as-6" }],
    ]), text);
    expect(mechanics.trigger).toEqual([
      { event: "after-roll", filter: { roll: "hit" }, optional: true },
      { event: "after-roll", filter: { roll: "wound" }, optional: true },
    ]);
    expect(mechanics.effect).toMatchObject({ target: "this-unit" });
    expect(mechanics.usage).toBeUndefined();
    expect(schemaErrors(mechanics)).toEqual([]);
  });

  it("names the roll-auto-result's own subject as its target", () => {
    const text = "After making a Hit roll for this model, you can change the result of that roll to an unmodified 6.";
    const mechanics = compiled(placed(text, [
      ["After making a Hit roll for this model", "event", { kind: "after-roll", roll: "hit", subject: "this-model" }],
      ["change the result of that roll to an unmodified 6", "roll-auto-result", { roll: "hit", outcome: "counts-as-6", subject: "this-model" }],
    ]), text);
    expect(mechanics.effect).toMatchObject({ type: "roll-result", target: "this-model" });
  });

  it("refuses a roll-auto-result subject that names no unit the roll can belong to", () => {
    // An unknown subject is refused by the family's own check, before any compile.
    expect(() => normalizeFingerprintParameters("roll-auto-result", { roll: "hit", outcome: "counts-as-6", subject: "everyone" }, currentFamilyVersion("roll-auto-result"))).toThrow();
  });

  it("refuses a list with the single roll too", () => {
    expect(() => NORMALIZE_EVENT({ kind: "after-roll", roll: "hit", rolls: ["hit", "wound"] })).toThrow(/not both/u);
  });

  it("refuses a list of one roll kind (the single roll is the roll parameter)", () => {
    expect(() => NORMALIZE_EVENT({ kind: "after-roll", rolls: ["hit"] })).toThrow(/two or more/u);
  });

  it("refuses a list that names a kind a trigger cannot name", () => {
    expect(() => NORMALIZE_EVENT({ kind: "after-roll", rolls: ["hit", "any"] })).toThrow(/must be one of/u);
    expect(() => NORMALIZE_EVENT({ kind: "before-roll", rolls: ["attacks", "hit"] })).toThrow(/must be one of/u);
    expect(() => NORMALIZE_EVENT({ kind: "before-roll", rolls: ["surge", "resource-die"] })).toThrow(/must be one of/u);
  });

  it("refuses a list that names one kind twice", () => {
    expect(() => NORMALIZE_EVENT({ kind: "after-roll", rolls: ["hit", "hit"] })).toThrow(/twice/u);
  });

  it("refuses rolls on a moment that is not a roll", () => {
    expect(() => NORMALIZE_EVENT({ kind: "unit-destroyed", rolls: ["hit", "wound"] })).toThrow(/before-roll or after-roll/u);
  });

  it("refuses a single roll kind a trigger cannot name", () => {
    expect(() => NORMALIZE_EVENT({ kind: "before-roll", roll: "any" })).toThrow(/must be one of/u);
  });

  it("keeps list order canonical, so equal lists normalize alike", () => {
    expect(NORMALIZE_EVENT({ kind: "after-roll", rolls: ["wound", "hit"] })).toEqual({ kind: "after-roll", rolls: ["hit", "wound"] });
  });

  it("lists exactly the roll kinds the DSL trigger's roll-kind enum names", () => {
    const schema = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../schemas/$defs/common.schema.json"), "utf8"));
    const dslKinds = (schema.$defs["roll-kind"].oneOf[0].enum as string[]).filter((kind) => kind !== "dark-pact" && kind !== "manoeuvre" && kind !== "channelling");
    expect([...TRIGGER_ROLL_KINDS].sort()).toEqual([...dslKinds].sort());
  });
});

describe("triggers from a list moment", () => {
  it("lowers one list leaf to one leaf per kind, in the listed order", () => {
    const [list] = placed("after making a Wound roll or a Hit roll", [
      ["after making a Wound roll or a Hit roll", "event", { kind: "after-roll", rolls: ["hit", "wound"] }],
    ]);
    expect(triggerLeaves(list!).map((leaf) => leaf.parameters.roll)).toEqual(["hit", "wound"]);
    expect(triggerLeaves(list!).every((leaf) => leaf.parameters.rolls === undefined)).toBe(true);
  });

  it("refuses to lower a list moment to a single trigger", () => {
    const [list] = placed("after making a Hit roll or a Wound roll", [
      ["after making a Hit roll or a Wound roll", "event", { kind: "after-roll", rolls: ["hit", "wound"] }],
    ]);
    expect(() => trigger(list!)).toThrow(CompileError);
  });

  it("describes a list moment as one trigger per kind", () => {
    const [list] = placed("after making a Hit roll or a Wound roll", [
      ["after making a Hit roll or a Wound roll", "event", { kind: "after-roll", rolls: ["hit", "wound"] }],
    ]);
    const fragment = leafFragment(list!);
    expect(fragment.kind).toBe("trigger");
    expect(fragment.kind === "trigger" && Array.isArray(fragment.node) ? fragment.node.length : 0).toBe(2);
  });
});

describe("roll-kind refusals for a trigger (earlier versions)", () => {
  // Version 18 takes any ROLL_KINDS value; the trigger check refuses what the DSL cannot name.
  const text = "After making a roll, change the result to an unmodified 6.";
  const effect: [string, string, Record<string, unknown>] = ["change the result to an unmodified 6", "roll-auto-result", { roll: "hit", outcome: "counts-as-6" }];

  for (const roll of ["any", "all", "attacks", "surge", "resource-die"]) {
    it(`refuses an after-roll moment that names roll ${roll}`, () => {
      const error = refusal(placed(text, [["After making a roll", "event", { kind: "after-roll", roll }], effect], { event: 18 }), text);
      expect(error).toMatch(/cannot name/u);
    });

    it(`refuses a before-roll moment that names roll ${roll}`, () => {
      const error = refusal(placed(text, [["After making a roll", "event", { kind: "before-roll", roll }], effect], { event: 18 }), text);
      expect(error).toMatch(/cannot name/u);
    });
  }

  it("still compiles a single trigger roll kind", () => {
    const mechanics = compiled(placed(text, [["After making a roll", "event", { kind: "after-roll", roll: "hit" }], effect], { event: 18 }), text);
    expect(mechanics.trigger).toMatchObject({ event: "after-roll", filter: { roll: "hit" } });
  });
});

describe("a roll modifier that means that roll, after a moment over several rolls", () => {
  it("refuses 'that roll' after a list moment: the change has no single roll to bind", () => {
    const text = "Each time a Hit roll or Wound roll is made, subtract 2 from that roll.";
    const error = refusal(placed(text, [
      ["Each time a Hit roll or Wound roll is made", "event", { kind: "after-roll", rolls: ["hit", "wound"] }],
      ["subtract 2 from that roll", "roll-modifier", { roll: "preceding", operation: "subtract", value: 2 }],
    ]), text);
    expect(error).toMatch(/author a rolls list/u);
  });

  it("still binds 'that roll' to a single before-roll moment", () => {
    const text = "Each time a Battle-shock test is taken, add 1 to that roll.";
    const mechanics = compiled(placed(text, [
      ["Each time a Battle-shock test is taken", "event", { kind: "before-roll", roll: "battle-shock" }],
      ["add 1 to that roll", "roll-modifier", { roll: "preceding", operation: "add", value: 1 }],
    ]), text);
    expect(mechanics.effect).toMatchObject({ type: "roll-modifier", modifier: { roll: "battle-shock", operation: "add", value: 1 } });
  });

  it("keeps the same list change for each kind a rolls list names", () => {
    const text = "Each time a Battle-shock or Leadership test is taken for that unit, subtract 1 from that test instead.";
    const mechanics = compiled(placed(text, [
      ["Each time a Battle-shock or Leadership test is taken", "event", { kind: "before-roll", rolls: ["battle-shock", "leadership"] }],
      ["subtract 1 from that test", "roll-modifier", { operation: "subtract", value: 1, rolls: ["battle-shock", "leadership"] }],
    ]), text);
    expect(mechanics.effect).toMatchObject({ type: "sequence", steps: [
      { type: "roll-modifier", modifier: { roll: "battle-shock", operation: "subtract", value: 1 } },
      { type: "roll-modifier", modifier: { roll: "leadership", operation: "subtract", value: 1 } },
    ] });
  });
});

describe("trigger wiring", () => {
  it("builds the trigger from the family version the leaf names", () => {
    const [leaf] = placed("after making a Hit roll", [["after making a Hit roll", "event", { kind: "after-roll", roll: "hit" }]]);
    expect(trigger(leaf!)).toMatchObject({ event: "after-roll", filter: { roll: "hit" } });
  });
});

describe("a menu action whose trigger is a list moment (compile-containers path)", () => {
  // Fragment-tagged leaves, as a resource-action-menu record carries them. Versions are the current
  // ones except characteristic-modifier, which the existing menu fixtures pin at 3.
  const menuLeaf = (family: string, parameters: Record<string, unknown>, fragment: string, version = currentFamilyVersion(family), start = 0): CompileLeaf => ({
    role: familyRole(family, version), family_id: family, family_version: version, fragment,
    parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: start + 1,
  });
  const menu = (eventParameters: Record<string, unknown>): CompileLeaf[] => [
    menuLeaf("resource-action-menu-open", { menu_id: "wave-ten-menu", pool_id: "wave-ten-pool" }, "A", undefined, 0),
    menuLeaf("menu-action", { action_id: "wave-ten-action", label: "Wave Ten Action", cost_amount: 1 }, "B", undefined, 10),
    menuLeaf("event", eventParameters, "B", undefined, 20),
    menuLeaf("characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" }, "B", 3, 30),
  ];

  it("lowers the action's when to one trigger per listed roll kind, in canonical order", () => {
    const result = compileLeaves(menu({ kind: "after-roll", rolls: ["wound", "hit"] }), "");
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    const action = (result.mechanics as unknown as { effect: { actions: Array<{ when: unknown[] }> } }).effect.actions[0]!;
    expect(action.when).toEqual([
      { event: "after-roll", filter: { roll: "hit" } },
      { event: "after-roll", filter: { roll: "wound" } },
    ]);
    expect(schemaErrors(result.mechanics)).toEqual([]);
  });

  it("refuses a roll kind in the action's list that a trigger cannot name", () => {
    const result = compileLeaves(menu({ kind: "after-roll", rolls: ["hit", "any"] }), "");
    expect(result.ok).toBe(false);
  });
});
