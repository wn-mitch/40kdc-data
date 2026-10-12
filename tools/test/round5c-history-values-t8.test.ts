import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { familyExtension } from "../src/round5c/family-extensions.js";
import { describeTrigger } from "../src/translate/trigger.js";

// Fabricated wording only: the keywords (ALPHA, BETA) and the sentences are invented; only the sentence shape is kept.

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((entry) => entry.ability_id === "control-edict-adeptus-mechanicus")!;
const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];

function placed(text: string, items: Item[]): CompileLeaf[] {
  let from = 0;
  return items.map(([wording, family, parameters, fragment]) => {
    const index = text.indexOf(wording, from);
    if (index < 0) throw new Error(`"${wording}" is not in the text after byte ${from}`);
    from = index + wording.length;
    const start = Buffer.byteLength(text.slice(0, index));
    const version = currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version, start_byte: start, end_byte: start + Buffer.byteLength(wording),
      parameters: normalize(family, parameters), fragment: fragment ?? "RAW_TEXT",
    };
  });
}

type Result = ReturnType<typeof compileLeaves>;
function compiledResult(text: string, items: Item[]): Extract<Result, { ok: true }> {
  const result = compileLeaves(placed(text, items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const check = checkEntry(entryWithMechanics(base, result.mechanics));
  expect(check.errors).toEqual([]);
  return result;
}
const compiled = (text: string, items: Item[]) => compiledResult(text, items).mechanics as unknown as Record<string, any>;
const refused = (text: string, items: Item[]): string => {
  const result = compileLeaves(placed(text, items), text);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.errors.join(" ");
};

function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, any>> {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
}
const happened = (tree: unknown, event: string) => nodes(tree, (node) => node.type === "happened" && (node.parameters as any)?.event === event).map((node) => node.parameters);

const FNP = { subject: "this-unit", threshold: 6, against: "all" };
const FNP_ITEM = (wording: string, fragment?: string): Item => [wording, "feel-no-pain", FNP, fragment];
const ABILITY_ID = "eternity-gate-necrons";

describe("lost wounds to the triggering attacks", () => {
  const STRATAGEM = "When an enemy unit has shot. One friendly ALPHA unit that lost a wound as a result of those attacks. Your unit has the Feel No Pain 6+ ability.";
  const stratagem = (activity: Record<string, unknown> = { activities: ["lost-wounds-to-triggering-attacks"], subject: "target", negated: false }): Item[] => [
    ["When an enemy unit has shot", "event", { kind: "enemy-has-shot" }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
    ["that lost a wound as a result of those attacks", "unit-activity", activity, "TARGET"],
    FNP_ITEM("Your unit has the Feel No Pain 6+ ability", "EFFECT"),
  ];

  it("lowers a Stratagem target's lost wounds to a damage-allocated history of the moment's attacks", () => {
    const result = compiledResult(STRATAGEM, stratagem());
    expect((result as any).core.target_restrictions.eligibility).toEqual({
      type: "happened", parameters: { event: "damage-allocated", object: "this-unit", filter: { by: "event-subject" }, window: "event" },
    });
  });

  it("still lowers wounds-state lost to the any-time wounds condition (older leaves unchanged)", () => {
    const result = compiledResult(STRATAGEM, stratagem()).mechanics;
    expect(JSON.stringify(result)).not.toContain("wounds");
    const legacy = compiledResult(STRATAGEM, [
      ...stratagem().slice(0, 3),
      ["that lost a wound as a result of those attacks", "wounds-state", { kind: "lost", subject: "this-unit", negated: false }, "TARGET"],
      FNP_ITEM("Your unit has the Feel No Pain 6+ ability", "EFFECT"),
    ] as Item[]);
    expect((legacy as any).core.target_restrictions.eligibility).toMatchObject({ type: "wounds", parameters: { lost: true } });
  });

  it("takes each of the three attack-result moments and no other", () => {
    for (const kind of ["attacks-resolved", "enemy-has-shot", "after-shooting"]) {
      const items = stratagem();
      items[0] = ["When an enemy unit has shot", "event", { kind }, "WHEN"];
      expect(compileLeaves(placed(STRATAGEM, items), STRATAGEM).ok, kind).toBe(true);
    }
    const other = stratagem();
    other[0] = ["When an enemy unit has shot", "event", { kind: "unit-destroyed" }, "WHEN"];
    expect(refused(STRATAGEM, other)).toMatch(/Lost wounds to those attacks needs a moment/u);
  });

  it("refuses lost wounds with no moment in the record", () => {
    const text = "If this unit lost a wound as a result of those attacks, this unit has the Feel No Pain 6+ ability.";
    expect(refused(text, [
      ["this unit lost a wound as a result of those attacks", "unit-activity", { activities: ["lost-wounds-to-triggering-attacks"], subject: "this-unit", negated: false }],
      FNP_ITEM("this unit has the Feel No Pain 6+ ability"),
    ])).toMatch(/needs a moment whose attacks/u);
  });

  it("names the subject of an effect-side condition", () => {
    const text = "When this unit has shot, if that unit lost a wound as a result of those attacks, this unit has the Feel No Pain 6+ ability.";
    const mechanics = compiled(text, [
      ["When this unit has shot", "event", { kind: "after-shooting" }],
      ["that unit lost a wound as a result of those attacks", "unit-activity", { activities: ["lost-wounds-to-triggering-attacks"], subject: "event-subject", negated: false }],
      FNP_ITEM("this unit has the Feel No Pain 6+ ability"),
    ]);
    expect(happened(mechanics, "damage-allocated")).toEqual([{ event: "damage-allocated", object: "event-subject", filter: { by: "event-subject" }, window: "event" }]);
  });
});

describe("windowed destruction history", () => {
  const TEXT = "Each time a model in this unit makes a ranged attack that targets an enemy unit that has destroyed one or more ALPHA units from your army during the battle, add 1 to the Hit roll.";
  const items = (over: Partial<Record<string, unknown>> = {}, drop: string[] = []): Item[] => [
    ["Each time a model in this unit makes a ranged attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
    ["targets an enemy unit that has destroyed one or more", "unit-activity", { activities: ["destroyed-units-in-window"], named: "after", container: "none", destroyer: "defender", negated: false, ...over }],
    ["ALPHA units", "unit-filter", { side: "any", keywords: ["ALPHA"] }],
    ["from your army", "unit-owner", { owner: "friendly" }],
    ["during the battle", "history-window", { window: "battle" }],
    ["add 1 to the Hit roll", "roll-modifier", { operation: "add", roll: "hit", value: 1 }],
  ].filter((item) => !drop.includes(item[1] as string)) as Item[];

  it("lowers the victims, the defender as destroyer and the battle window; the owner leaf is consumed", () => {
    const leaves = placed(TEXT, items());
    const result = compileLeaves(leaves, TEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(happened(result.mechanics, "destroyed")).toEqual([{ event: "destroyed", object: { owner: "friendly", all_of: ["ALPHA"] }, filter: { by: "defender" }, window: "battle" }]);
    // No stray condition: the owner and window leaves leave no node of their own.
    expect(JSON.stringify(result.mechanics)).not.toContain("owned-by");
    expect(nodes(result.mechanics, (node) => node.type === "happened")).toHaveLength(1);
    expect(checkEntry(entryWithMechanics(base, result.mechanics)).errors).toEqual([]);
  });

  it("takes the window from the history-window leaf (phase, turn)", () => {
    for (const window of ["phase", "turn"]) {
      const list = items();
      list[4] = ["during the battle", "history-window", { window }];
      expect(happened(compiled(TEXT, list), "destroyed")[0]).toMatchObject({ window });
    }
  });

  it("refuses a windowed destruction with no window leaf", () => {
    expect(refused(TEXT, items({}, ["history-window"]))).toMatch(/names its window with a history-window leaf/u);
  });

  it("refuses a history-window with no host, and a second window for one host", () => {
    const text = "Add 1 to the Hit roll during the battle.";
    expect(refused(text, [["Add 1 to the Hit roll", "roll-modifier", { operation: "add", roll: "hit", value: 1 }], ["during the battle", "history-window", { window: "battle" }]])).toMatch(/none precedes it/u);
    const twice = TEXT.replace("battle,", "battle this phase,");
    const doubled = items();
    doubled.splice(5, 0, ["this phase", "history-window", { window: "phase" }]);
    expect(refused(twice, doubled)).toMatch(/takes one window/u);
  });

  it("refuses a conflicting side between the victim filter and its owner", () => {
    const list = items();
    list[2] = ["ALPHA units", "unit-filter", { side: "enemy", keywords: ["ALPHA"] }];
    expect(refused(TEXT, list)).toMatch(/enemy by their filter and friendly by their owner/u);
  });

  it("keeps a side the filter already names when an owner agrees", () => {
    const list = items();
    list[2] = ["ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }];
    expect(happened(compiled(TEXT, list), "destroyed")[0]).toMatchObject({ object: { owner: "friendly", all_of: ["ALPHA"] } });
  });

  it("needs the attack the defender is the target of", () => {
    const text = "Each time this unit is selected, if an enemy unit has destroyed one or more ALPHA units from your army during the battle, this unit has the Feel No Pain 6+ ability.";
    expect(refused(text, [
      ["Each time this unit is selected", "event", { kind: "selected", to: "shoot" }],
      ["an enemy unit has destroyed one or more", "unit-activity", { activities: ["destroyed-units-in-window"], named: "after", container: "none", destroyer: "defender", negated: false }],
      ["ALPHA units", "unit-filter", { side: "any", keywords: ["ALPHA"] }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["during the battle", "history-window", { window: "battle" }],
      FNP_ITEM("this unit has the Feel No Pain 6+ ability"),
    ])).toMatch(/attack whose target it is/u);
  });

  it("needs no attacks moment for a this-unit destroyer (a plain history)", () => {
    const text = "While this unit has destroyed one or more ALPHA units during the phase, this unit has the Feel No Pain 6+ ability.";
    const mechanics = compiled(text, [
      ["this unit has destroyed one or more", "unit-activity", { activities: ["destroyed-units-in-window"], named: "after", container: "none", destroyer: "this-unit", negated: false }],
      ["ALPHA units", "unit-filter", { side: "any", keywords: ["ALPHA"] }],
      ["during the phase", "history-window", { window: "phase" }],
      FNP_ITEM("this unit has the Feel No Pain 6+ ability"),
    ]);
    expect(happened(mechanics, "destroyed")).toEqual([{ event: "destroyed", object: { all_of: ["ALPHA"] }, filter: { by: "this-unit" }, window: "phase" }]);
  });

  it("leaves the destruction-by-triggering-attacks lowering on the event window", () => {
    const text = "When this unit has resolved its attacks, if those attacks destroyed an ALPHA unit, this unit has the Feel No Pain 6+ ability.";
    const mechanics = compiled(text, [
      ["When this unit has resolved its attacks", "event", { kind: "attacks-resolved" }],
      ["those attacks destroyed", "unit-activity", { activities: ["destroyed-units-by-triggering-attacks"], named: "after", container: "none", destroyer: "this-unit", negated: false }],
      ["an ALPHA unit", "unit-filter", { side: "any", keywords: ["ALPHA"] }],
      FNP_ITEM("this unit has the Feel No Pain 6+ ability"),
    ]);
    expect(happened(mechanics, "destroyed")[0]).toMatchObject({ filter: { by: "this-unit" }, window: "event" });
  });
});

describe("set up through a named ability", () => {
  const SELECTED: Item = ["When this unit is selected to shoot", "event", { kind: "selected", to: "shoot" }];
  const SET_UP: Item = ["this unit was set up", "unit-activity", { activities: ["set-up-this-turn"], subject: "this-unit", negated: false }];
  const BY: Item = ["Eternity Gate ability", "by-ability", { id: ABILITY_ID }];
  const ALPHA_MODEL: Item = ["an ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }];
  const USED = { event: "used", subject: { owner: "friendly", all_of: ["ALPHA"], level: "model" }, object: "this-unit", filter: { kind: "ability", id: ABILITY_ID }, window: "turn" };

  it("folds a leading filter, the ability and a window leaf into the set-up and a linked use", () => {
    const text = "When this unit is selected to shoot, if this unit was set up by an ALPHA model's Eternity Gate ability this turn, this unit has the Feel No Pain 6+ ability.";
    const result = compiledResult(text, [SELECTED, SET_UP, ["an ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }], BY, ["this turn", "history-window", { window: "turn" }], FNP_ITEM("this unit has the Feel No Pain 6+ ability")]);
    const condition = (result.mechanics as any).effect.condition;
    expect(condition).toEqual({ operator: "and", operands: [{ type: "happened", parameters: { event: "set-up", window: "turn" } }, { type: "happened", parameters: USED }] });
    expect(result.checks).toEqual([{ kind: "named-ability", parameters: { id: ABILITY_ID, activity: "ability" } }]);
  });

  it("folds a trailing filter the same way", () => {
    const text = "When this unit is selected to shoot, if this unit was set up using the Eternity Gate ability of an ALPHA model this turn, this unit has the Feel No Pain 6+ ability.";
    const mechanics = compiled(text, [SELECTED, SET_UP, BY, ALPHA_MODEL, ["this turn", "history-window", { window: "turn" }], FNP_ITEM("this unit has the Feel No Pain 6+ ability")]);
    expect(mechanics.effect.condition.operands[1].parameters).toEqual(USED);
  });

  it("uses an owner-any subject when no filter names whose ability", () => {
    const text = "When this unit is selected to shoot, if this unit was set up using the Eternity Gate ability, this unit has the Feel No Pain 6+ ability.";
    const mechanics = compiled(text, [SELECTED, SET_UP, BY, FNP_ITEM("this unit has the Feel No Pain 6+ ability")]);
    expect(mechanics.effect.condition.operands[1].parameters).toMatchObject({ subject: { owner: "any" }, object: "this-unit", window: "turn" });
  });

  it("keeps the filter for a later anaphor that binds to it (two existentials)", () => {
    const text = "When this unit is selected to shoot, if this unit was set up using the Eternity Gate ability of an ALPHA model that started the turn on the battlefield, this unit has the Feel No Pain 6+ ability.";
    const mechanics = compiled(text, [
      SELECTED, SET_UP, BY, ALPHA_MODEL,
      ["that started the turn on the battlefield", "unit-state", { states: ["on-battlefield"], subject: "antecedent", negated: false, at: "turn-start" }],
      FNP_ITEM("this unit has the Feel No Pain 6+ ability"),
    ]);
    const [setUp, state] = mechanics.effect.condition.operands;
    expect(setUp.operands[1].parameters).toEqual(USED);
    expect(state.parameters).toMatchObject({ state: "on-battlefield", at: "turn-start", subject: { owner: "friendly", all_of: ["ALPHA"], level: "model" } });
  });

  it("refuses a window that disagrees with the set-up's own window", () => {
    const text = "When this unit is selected to shoot, if this unit was set up using the Eternity Gate ability this phase, this unit has the Feel No Pain 6+ ability.";
    expect(refused(text, [SELECTED, SET_UP, BY, ["this phase", "history-window", { window: "phase" }], FNP_ITEM("this unit has the Feel No Pain 6+ ability")])).toMatch(/disagrees with the turn window/u);
  });

  it("refuses by-ability after an activity other than a set-up", () => {
    const text = "When this unit is selected to shoot, if this unit charged using the Eternity Gate ability, this unit has the Feel No Pain 6+ ability.";
    expect(refused(text, [SELECTED, ["this unit charged", "unit-activity", { activities: ["charged-this-turn"], subject: "this-unit", negated: false }], BY, FNP_ITEM("this unit has the Feel No Pain 6+ ability")])).toMatch(/names the ability a moment happened through/u);
  });

  it("refuses a filter that is not a side with keywords", () => {
    const text = "When this unit is selected to shoot, if this unit was set up using the Eternity Gate ability of an ALPHA model, this unit has the Feel No Pain 6+ ability.";
    expect(refused(text, [SELECTED, SET_UP, BY, ["an ALPHA model", "unit-filter", { side: "any", keywords: ["ALPHA"], level: "model" }], FNP_ITEM("this unit has the Feel No Pain 6+ ability")])).toMatch(/friendly or enemy/u);
  });

  it("keeps by-ability on a move as before", () => {
    const text = "When this unit has moved using the Eternity Gate ability, this unit has the Feel No Pain 6+ ability.";
    const mechanics = compiled(text, [["When this unit has moved", "event", { kind: "move-ended", move_types: ["normal"] }], BY, FNP_ITEM("this unit has the Feel No Pain 6+ ability")]);
    expect(JSON.stringify(mechanics)).toContain(ABILITY_ID);
  });
});

describe("was charged and the ability's own mortal wounds", () => {
  it("lowers was-charged-this-turn to a charge declaration against the unit", () => {
    const mechanics = compiled("If this unit was charged this turn, this unit has the Feel No Pain 6+ ability.", [
      ["this unit was charged this turn", "unit-activity", { activities: ["was-charged-this-turn"], subject: "this-unit", negated: false }],
      FNP_ITEM("this unit has the Feel No Pain 6+ ability"),
    ]);
    expect(happened(mechanics, "targets-selected")).toEqual([{ event: "targets-selected", subject: { owner: "any" }, object: "this-unit", filter: { kind: "charge" }, window: "turn" }]);
  });

  it("lowers a charge move or being charged to an any-of", () => {
    const mechanics = compiled("If this unit made a Charge move or was charged this turn, this unit has the Feel No Pain 6+ ability.", [
      ["this unit made a Charge move or was charged this turn", "unit-activity", { activities: ["charged-this-turn", "was-charged-this-turn"], subject: "this-unit", negated: false }],
      FNP_ITEM("this unit has the Feel No Pain 6+ ability"),
    ]);
    expect(mechanics.effect.condition.operator).toBe("or");
    expect(mechanics.effect.condition.operands.map((operand: any) => `${operand.parameters.event}:${operand.parameters.filter.kind ?? operand.parameters.filter.move_types[0]}`)).toEqual(["move-ended:charge", "targets-selected:charge"]);
  });

  const MORTAL_TEXT = "When this unit uses its Foo ability, one unit suffers D3 mortal wounds. If that unit suffers mortal wounds as a result of this ability, this unit has the Feel No Pain 6+ ability.";
  const mortal = (activities: string[], drop = false): Item[] => [
    ["When this unit uses its Foo ability", "event", { kind: "used", subject: "this-unit", activity: "ability" }],
    ...(drop ? [] : [["one unit suffers D3 mortal wounds", "mortal-wounds", { count: "D3", recipient: "this-unit" }] as Item]),
    ["that unit suffers mortal wounds as a result of this ability", "unit-activity", { activities, subject: "this-unit", negated: false }],
    FNP_ITEM("this unit has the Feel No Pain 6+ ability"),
  ];

  it("lowers the ability's own mortal wounds and the models they destroy with attack_type mortal", () => {
    const wounds = compiled(MORTAL_TEXT, mortal(["suffered-mortal-wounds-from-this-ability"]));
    expect(happened(wounds, "damage-allocated")).toEqual([{ event: "damage-allocated", object: "this-unit", filter: { attack_type: "mortal" }, window: "event" }]);
    const models = compiled(MORTAL_TEXT, mortal(["lost-models-to-own-mortal-wounds"]));
    expect(happened(models, "model-destroyed")).toEqual([{ event: "model-destroyed", object: { level: "model", member_of: "this-unit" }, filter: { attack_type: "mortal" }, window: "event" }]);
  });

  it("refuses mortal-wounds activities with no mortal-wounds effect before them", () => {
    for (const activity of ["suffered-mortal-wounds-from-this-ability", "lost-models-to-own-mortal-wounds"]) {
      expect(refused(MORTAL_TEXT, mortal([activity], true))).toMatch(/needs the mortal wounds it names/u);
    }
  });
});

describe("outputs pass the describers", () => {
  it("describes the triggers of the new conditions without throwing", () => {
    const text = "When an enemy unit has shot. One friendly ALPHA unit that lost a wound as a result of those attacks. Your unit has the Feel No Pain 6+ ability.";
    const mechanics = compiled(text, [
      ["When an enemy unit has shot", "event", { kind: "enemy-has-shot" }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
      ["that lost a wound as a result of those attacks", "unit-activity", { activities: ["lost-wounds-to-triggering-attacks"], subject: "target", negated: false }, "TARGET"],
      FNP_ITEM("Your unit has the Feel No Pain 6+ ability", "EFFECT"),
    ]);
    expect(() => describeTrigger(mechanics.trigger)).not.toThrow();
  });
});

describe("family versions", () => {
  const PREVIOUS = (family: string) => {
    const version = currentFamilyVersion(family);
    for (let at = version - 1; at >= 1; at -= 1) {
      const extension = familyExtension(family, at);
      if (extension) return (input: Record<string, unknown>) => normalizeFingerprintParameters(family, input, at);
    }
    return (input: Record<string, unknown>) => normalizeFingerprintParameters(family, input, 1);
  };

  it("normalizes the new unit-activity values and every value the previous version accepted", () => {
    const older = { activities: ["charged-this-turn", "fought-this-phase"], subject: "this-unit", negated: false };
    const version = currentFamilyVersion("unit-activity");
    expect(familyExtension("unit-activity", version)).toBeDefined();
    expect(normalizeFingerprintParameters("unit-activity", older, version)).toEqual(PREVIOUS("unit-activity")(older));
    const destruction = { activities: ["destroyed-units-by-triggering-attacks"], named: "after", container: "none", destroyer: "this-model", negated: false };
    expect(normalizeFingerprintParameters("unit-activity", destruction, version)).toEqual(PREVIOUS("unit-activity")(destruction));
    for (const activity of ["lost-wounds-to-triggering-attacks", "was-charged-this-turn", "suffered-mortal-wounds-from-this-ability", "lost-models-to-own-mortal-wounds"]) {
      expect(normalizeFingerprintParameters("unit-activity", { activities: [activity], subject: "this-unit", negated: false }, version).activities).toEqual([activity]);
      expect(() => normalizeFingerprintParameters("unit-activity", { activities: [activity], negated: false }, version)).toThrow();
    }
    expect(normalizeFingerprintParameters("unit-activity", { activities: ["charged-this-turn", "was-charged-this-turn"], subject: "this-unit", negated: false }, version).activities).toEqual(["charged-this-turn", "was-charged-this-turn"]);
    expect(() => normalizeFingerprintParameters("unit-activity", { activities: ["was-charged-this-turn", "was-charged-this-turn"], subject: "this-unit", negated: false }, version)).toThrow();
  });

  it("normalizes destroyed-units-in-window and refuses its misuse", () => {
    const leaf = { activities: ["destroyed-units-in-window"], named: "after", container: "none", destroyer: "defender", negated: false };
    for (const destroyer of ["this-unit", "this-model", "event-subject", "stratagem-target", "defender"]) {
      expect(normalize("unit-activity", { ...leaf, destroyer })).toMatchObject({ destroyer, activities: ["destroyed-units-in-window"] });
    }
    expect(() => normalize("unit-activity", { ...leaf, subject: "this-unit" })).toThrow(/no subject/u);
    expect(() => normalize("unit-activity", { ...leaf, named: "none" })).toThrow(/named: before or after/u);
    expect(() => normalize("unit-activity", { ...leaf, container: "after" })).toThrow(/container none/u);
    expect(() => normalize("unit-activity", { ...leaf, destroyer: "any" })).toThrow(/needs destroyer/u);
    expect(() => normalize("unit-activity", { ...leaf, window: "battle" })).toThrow(/no parameter window/u);
    expect(() => normalize("unit-activity", { ...leaf, activities: ["destroyed-units-in-window", "fought-this-phase"] })).toThrow(/one activity per leaf/u);
    expect(() => normalize("unit-activity", { activities: ["destroyed-units-by-triggering-attacks"], named: "after", container: "none", destroyer: "defender", negated: false })).toThrow(/destroyer defender/u);
    expect(() => normalize("unit-activity", { activities: ["fought-this-phase"], subject: "this-unit", negated: false, destroyer: "defender" })).toThrow();
  });

  it("normalizes history-window and rejects other windows and parameters", () => {
    for (const window of ["phase", "turn", "battle"]) expect(normalize("history-window", { window })).toEqual({ window });
    expect(() => normalize("history-window", { window: "round" })).toThrow();
    expect(() => normalize("history-window", { window: "turn", extra: 1 })).toThrow(/no parameter extra/u);
    expect(() => normalize("history-window", {})).toThrow();
  });
});
