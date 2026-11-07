import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/index.js";

// Fabricated wording and identities; no rules text.

type Item = [string, string, Record<string, unknown>];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const TEXT = "At the start of your Shooting phase, one or more models from your army with this ability can attempt Rites from those listed below. "
  + "To do so, select one model from your army with this ability that has not yet attempted a Rite this turn and select one Rite no model from your army has attempted this turn, then take a Psychic test for that model.\n"
  + "Roll 2D6.\nOptionally, you can roll one additional D6.\n"
  + "Then, if one or more doubles were rolled during this test, that model's unit suffers D3 mortal wounds.\n"
  + "If that model is not destroyed and the total equals or exceeds the Warp Charge value of the Rite, that model manifests that Rite.\n"
  + "**Gloom Bolt (Psychic)**\nSelect one enemy unit within 18\" of the manifesting model; that unit suffers D3 mortal wounds. If the Psychic test result for this Rite was 10+, that unit suffers D6 mortal wounds instead.\n"
  + "**Hush (Psychic)**\nSelect one friendly unit within 12\" of the manifesting model. That unit can make a Normal move of up to D6\". Until the end of the turn, that unit cannot declare a charge.";

const BOLT = (parameters: Record<string, unknown> = { label: "Gloom Bolt", option_id: "gloom-bolt", warp_charge: 6 }): Item => ["Gloom Bolt (Psychic", "named-option", parameters];
const HEAD = {
  moment: ["At the start of your Shooting phase", "event", { kind: "phase-start", phase: "shooting", turn: "your" }] as Item,
  opener: ["can attempt Rites from those listed below", "ritual-menu-open", {}] as Item,
  perModel: ["that has not yet attempted a Rite this turn", "usage-limit", { frequency: "once-per-turn", per: "model" }] as Item,
  perArmy: ["select one Rite no model from your army has attempted this turn", "usage-limit", { frequency: "once-per-turn", per: "army" }] as Item,
  roll: ["Roll 2D6", "dice-roll", { dice: "2D6" }] as Item,
  offer: ["you can", "optional-use", { who: "you" }] as Item,
  extra: ["roll one additional D6", "dice-roll", { dice: "D6" }] as Item,
  doubles: ["if one or more doubles were rolled during this test", "test-doubles", { on: "double" }] as Item,
  perils: ["that model's unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "this-unit", count: "D3" }] as Item,
  manifest: ["that model manifests that Rite", "ritual-manifest", {}] as Item,
};
type Head = typeof HEAD;
const BODIES = (bolt = BOLT()): Item[] => [
  bolt,
  ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
  ["within 18\" of the manifesting model", "unit-position", { kind: "within", inches: 18, of: "this-model", subject: "selected-unit", negated: false }],
  ["that unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }],
  ["the Psychic test result for this Rite was 10+", "roll-total", { roll_var: "psychic-test", min: 10 }],
  ["that unit suffers D6 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D6" }],
  ["instead", "instead", {}],
  ["Hush (Psychic", "named-option", { label: "Hush", option_id: "hush", warp_charge: 5 }],
  ["Select one", "select-unit", { distance: "any", visible: false }],
  ["friendly unit", "unit-filter", { side: "friendly" }],
  ["within 12\" of the manifesting model", "unit-position", { kind: "within", inches: 12, of: "this-model", subject: "selected-unit", negated: false }],
  ["That unit can make a Normal move of up to D6", "make-move", { subject: "antecedent", move_type: "normal", distance: "D6" }],
  ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
  ["that unit cannot declare a charge", "eligibility-permission", { subject: "antecedent", activity: "declare-charge", allow: false }],
];
const ITEMS = (head: Partial<Head> = {}, bodies = BODIES()): Item[] => [...Object.values({ ...HEAD, ...head }).filter((item): item is Item => item !== undefined), ...bodies];
const without = (key: keyof Head) => ({ [key]: undefined }) as Partial<Head>;

function compiled(items: Item[], text = TEXT) {
  return compileLeaves(placed(text, ...items), text, { name: "Sample Rites" });
}

function mechanicsOf(items: Item[] = ITEMS()): any {
  const result = compiled(items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}

const errorsOf = (items: Item[], text = TEXT) => {
  const result = compiled(items, text);
  return result.ok ? "" : result.errors.join(" ");
};

const atLeast = (min: number) => ({ type: "roll-total", parameters: { roll_var: "psychic-test", min } });

describe("Rituals attempted with a Psychic test (compile-ritual-menu.ts)", () => {
  it("compiles the test, the limit on each Ritual and each Ritual's Warp Charge, and leaves the per-model limit to the record", () => {
    const mechanics = mechanicsOf();
    expect(mechanics.usage).toEqual({ frequency: "once-per-turn", per: "model" });
    expect(mechanics.effect).toMatchObject({
      type: "ritual-menu",
      test: { dice: "2D6", kind: "psychic", roll_var: "psychic-test", extra_die: { dice: "D6", optional: true },
        perils: { on: "double", effect: { type: "mortal-wounds", target: "this-unit", modifier: { count: "D3" } } } },
      ritual_limit: { frequency: "once-per-turn", per: "army" },
    });
    expect(mechanics.effect.rituals.map((ritual: any) => [ritual.id, ritual.name, ritual.warp_charge])).toEqual([["gloom-bolt", "Gloom Bolt", 6], ["hush", "Hush", 5]]);
  });

  it("reads the test result inside a Ritual, the stronger effect replacing the weaker", () => {
    const steps = mechanicsOf().effect.rituals[0].effect.effect.steps;
    expect(steps).toEqual([
      { type: "conditional", condition: { operator: "not", operands: [atLeast(10)] }, effect: { type: "mortal-wounds", target: "selected-unit", modifier: { count: "D3" } } },
      { type: "conditional", condition: atLeast(10), effect: { type: "mortal-wounds", target: "selected-unit", modifier: { count: "D6" } } },
    ]);
  });

  it("keeps a Ritual's own duration on the Ritual, so the Shooting phase does not bound the record", () => {
    const mechanics = mechanicsOf();
    expect(mechanics.scope.duration).toBe("permanent");
    expect(mechanics.effect.rituals[1].effect).toMatchObject({ type: "ability-part", duration: "turn" });
  });

  it("takes no extra die without a second roll, and refuses an extra die nobody offers", () => {
    expect(mechanicsOf(ITEMS({ ...without("offer"), ...without("extra") })).effect.test.extra_die).toBeUndefined();
    expect(errorsOf(ITEMS(without("offer")))).toMatch(/needs the optional-use before it/u);
    expect(errorsOf(ITEMS(without("extra")))).toMatch(/no second die follows/u);
  });

  it("refuses a third die and a second doubles check (a heading's \"Roll 2D6\" is no roll of its own)", () => {
    const rolls = TEXT.replace("Roll 2D6.\n", "**Roll 2D6**\nRoll 2D6.\n");
    expect(errorsOf(ITEMS({}).flatMap((item): Item[] => item === HEAD.roll ? [item, item] : [item]), rolls)).toMatch(/found 3 dice rolls/u);
    const twice = TEXT.replace("that model's unit suffers D3 mortal wounds.", "that model's unit suffers D3 mortal wounds; if one or more doubles were rolled during this test, it suffers 1 more.");
    const items = ITEMS({}).flatMap((item): Item[] => item === HEAD.perils ? [item, HEAD.doubles] : [item]);
    expect(errorsOf(items, twice)).toMatch(/checks its doubles once/u);
  });

  it("needs the manifest rule and the limit on each Ritual", () => {
    expect(errorsOf(ITEMS(without("manifest")))).toMatch(/needs exactly one ritual-manifest/u);
    expect(errorsOf(ITEMS(without("perArmy")))).toMatch(/once-per-turn limit per army on each Ritual/u);
  });

  it("needs the doubles check before what it causes, and something it causes", () => {
    expect(errorsOf(ITEMS(without("doubles")))).toMatch(/needs the doubles check that causes it/u);
    expect(errorsOf(ITEMS(without("perils")))).toMatch(/needs the effect it causes after it/u);
    const text = TEXT.replace("Then, if one or more doubles were rolled during this test, that model's unit suffers D3 mortal wounds.", "Then that model's unit suffers D3 mortal wounds, if one or more doubles were rolled during this test.");
    const items = ITEMS({ doubles: undefined, perils: undefined }).flatMap((item): Item[] => item[0] === "roll one additional D6" ? [item, HEAD.perils, HEAD.doubles] : [item]);
    expect(errorsOf(items, text)).toMatch(/test effect comes after its doubles check/u);
  });

  it("needs each Ritual's Warp Charge, which only a Ritual takes", () => {
    expect(errorsOf(ITEMS({}, BODIES(BOLT({ label: "Gloom Bolt", option_id: "gloom-bolt" }))))).toMatch(/The Ritual Gloom Bolt needs its warp_charge/u);
    const text = "Select one of the following:\n**Gloom**\nThis unit suffers 1 mortal wound.\n**Hush**\nThis unit suffers 2 mortal wounds.";
    expect(errorsOf([
      ["Select one of the following", "choice-open", {}],
      ["Gloom", "named-option", { label: "Gloom", option_id: "gloom", warp_charge: 6 }],
      ["This unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }],
      ["Hush", "named-option", { label: "Hush", option_id: "hush" }],
      ["This unit suffers 2 mortal wounds", "mortal-wounds", { recipient: "this-unit", count: "2" }],
    ], text)).toMatch(/carries a warp_charge, which only a Ritual of a ritual menu has/u);
  });

  it("names a Ritual's designation after the Ritual, not the record", () => {
    const text = TEXT.replace("; that unit suffers D3 mortal wounds. If the Psychic test result for this Rite was 10+, that unit suffers D6 mortal wounds instead.", ". Until the end of the phase, each time a model from your army makes an attack that targets that unit, re-roll a Hit roll of 1.");
    const bodies = BODIES().slice(0, 3).concat([
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["that targets that unit", "target-is-selected", {}],
      ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }],
    ], BODIES().slice(7));
    expect(errorsOf(ITEMS({}, bodies), text)).toMatch(/Designation "gloom-bolt-target" is not registered/u);
  });

  it("refuses a doubles check outside a ritual menu", () => {
    const text = "If one or more doubles were rolled during this test, this unit suffers 1 mortal wound.";
    expect(errorsOf([
      ["If one or more doubles were rolled during this test", "test-doubles", { on: "double" }],
      ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }],
    ], text)).toMatch(/reads a ritual menu's Psychic test/u);
  });

  it("takes warp_charge 2-18 and a roll-total on the Psychic test only", () => {
    const named = (warp_charge: unknown) => normalizeFingerprintParameters("named-option", { label: "Gloom", option_id: "gloom", warp_charge }, currentFamilyVersion("named-option"));
    expect(named(18)).toMatchObject({ warp_charge: 18 });
    expect(() => named(1)).toThrow(/warp_charge/u);
    expect(() => named(19)).toThrow(/warp_charge/u);
    const total = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("roll-total", parameters, currentFamilyVersion("roll-total"));
    expect(total({ roll_var: "psychic-test", min: 10 })).toEqual({ roll_var: "psychic-test", min: 10 });
    expect(() => total({ roll_var: "charge", min: 10 })).toThrow(/roll-total\.roll_var/u);
    expect(() => total({ roll_var: "psychic-test", min: 19 })).toThrow(/roll-total\.min/u);
  });

  it("renders the test once, then each Ritual with its Warp Charge", () => {
    const text = describeAbility({ id: "sample", name: "Sample", effect: mechanicsOf().effect } as any);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Attempt one of the Rituals below (each Ritual can be attempted once per turn across your army). To do so, take a Psychic test: roll 2D6, and you can roll one additional D6; if any two of its dice show the same result, the unit suffers D3 mortal wounds; if this model is not destroyed and the total of all its dice equals or exceeds the Ritual's Warp Charge, this model manifests that Ritual:");
    expect(lines[1]).toMatch(/^ {2}- Gloom Bolt \(Warp Charge 6\): .*unless the Psychic test result is 10\+, that unit suffers D3 mortal wounds; if the Psychic test result is 10\+, that unit suffers D6 mortal wounds\.$/u);
    expect(lines[2]).toMatch(/^ {2}- Hush \(Warp Charge 5\): /u);
    expect(lines).toHaveLength(3);
  });
});
