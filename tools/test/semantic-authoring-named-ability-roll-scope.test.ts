import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { markCountedSubjects } from "../src/semantic-authoring/compile-count-scale.js";
import { coreCheckErrors } from "../src/semantic-authoring/core-checks.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Fabricated wording only: each leaf sits on its own words in the text below.
const DATA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");

/** Leaves on their own wording in `text`, in order, each at the current version of its family unless one is given. */
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

function compiled(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result as unknown as Record<string, any>;
}

function refusal(list: CompileLeaf[], text: string): string {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error("expected a refusal, but the leaves compiled");
  return result.errors.join("; ");
}

const MANOEUVRE_TEXT = "Re-roll the rolls made for that unit while it performs a Sample Manoeuvre.";
const manoeuvreReroll: [string, string, Record<string, unknown>] = ["Re-roll the rolls made for that unit", "reroll", { roll: "manoeuvre", subset: "all", weapon_type: "all", subject: "this-unit" }];
const manoeuvreNow: [string, string, Record<string, unknown>] = ["while it performs a Sample Manoeuvre", "ability-used", { subject: "this-unit", activity: "manoeuvre", window: "now", negated: false }];

const RP_TEXT = "Each time this unit's Sample Aura activates, you can re-roll the dice to see how many marks are added.";
const RP_EVENT: [string, string, Record<string, unknown>] = ["Each time this unit's Sample Aura activates", "event", { kind: "used", activity: "ability", id: "reanimation-protocols-necrons", subject: "this-unit" }];
const RP_REROLL: [string, string, Record<string, unknown>] = ["re-roll the dice to see how many marks are added", "reroll", { roll: { ability: "reanimation-protocols-necrons" }, subset: "all", weapon_type: "all" }];

const CALTROPS_TEXT = "Each time you make a wound roll using this unit's Sample Ability, you can re-roll one D6 for each model in this unit that carries cluster caltrops.";
const CALTROPS_LEAVES: Array<[string, string, Record<string, unknown>]> = [
  ["Each time you make a wound roll", "event", { kind: "before-roll", roll: "wound" }],
  ["using this unit's Sample Ability", "ability-used", { subject: "this-unit", activity: "ability", id: "eviscerating-fly-by-aeldari", window: "now", negated: false }],
  ["re-roll one D6", "reroll", { roll: "wound", subset: "all", weapon_type: "all", count: 1 }],
  ["for each model in this unit that carries cluster caltrops", "count-scale", { per: 1, counts: "models-equipped-with", wargear: "cluster-caltrops" }],
];

describe("Manoeuvre roll on a re-roll (reroll v6)", () => {
  it("compiles the manoeuvre's own dice as re-rolled while the unit performs the manoeuvre", () => {
    const mechanics = compiled(placed(MANOEUVRE_TEXT, manoeuvreReroll, manoeuvreNow), MANOEUVRE_TEXT).mechanics;
    expect(mechanics.effect.type).toBe("conditional");
    expect(mechanics.effect.condition).toEqual({ type: "happened", parameters: { event: "used", filter: { kind: "manoeuvre" }, window: "event" } });
    expect(mechanics.effect.effect).toEqual({ type: "re-roll", target: "this-unit", modifier: { roll: "manoeuvre", result_scope: "any-result" } });
  });

  it("refuses a manoeuvre re-roll with no manoeuvre moment in its clause", () => {
    expect(refusal(placed(MANOEUVRE_TEXT, manoeuvreReroll), MANOEUVRE_TEXT)).toMatch(/re-roll of a manoeuvre roll .* has no manoeuvre moment/);
  });

  it("refuses a manoeuvre re-roll whose only moment is a stratagem in progress", () => {
    const stratagem: [string, string, Record<string, unknown>] = ["while it performs a Sample Manoeuvre", "ability-used", { subject: "this-unit", activity: "stratagem", window: "now", negated: false }];
    expect(refusal(placed(MANOEUVRE_TEXT, manoeuvreReroll, stratagem), MANOEUVRE_TEXT)).toMatch(/has no manoeuvre moment/);
  });

  it("refuses a manoeuvre re-roll whose only moment is a used-manoeuvre that comes after it", () => {
    const after: [string, string, Record<string, unknown>] = ["while it performs a Sample Manoeuvre", "event", { kind: "used", activity: "manoeuvre", subject: "this-unit" }];
    // An event is only a moment before the re-roll; an ability-used in progress counts from anywhere in its clause.
    expect(refusal(placed(MANOEUVRE_TEXT, manoeuvreReroll, after), MANOEUVRE_TEXT)).toMatch(/has no manoeuvre moment/);
  });

  it("still refuses a roll-modifier of a manoeuvre roll on a plain used-manoeuvre guard", () => {
    const text = "Add 1 to the result of the roll while it performs a Sample Manoeuvre.";
    const guard: [string, string, Record<string, unknown>] = ["while it performs a Sample Manoeuvre", "ability-used", { subject: "this-unit", activity: "manoeuvre", window: "now", negated: false }];
    const modifier: [string, string, Record<string, unknown>] = ["Add 1 to the result of the roll", "roll-modifier", { roll: "manoeuvre", operation: "add", value: 1, subject: "event-subject" }];
    expect(refusal(placed(text, modifier, guard), text)).toMatch(/roll-modifier of a manoeuvre roll .* has no manoeuvre-own-roll moment/);
  });

  it("refuses a roll-modifier of a manoeuvre roll with no moment at all", () => {
    const text = "Add 1 to the result of the roll.";
    const modifier: [string, string, Record<string, unknown>] = ["Add 1 to the result of the roll", "roll-modifier", { roll: "manoeuvre", operation: "add", value: 1, subject: "event-subject" }];
    expect(refusal(placed(text, modifier), text)).toMatch(/has no manoeuvre-own-roll moment/);
  });

  it("accepts a manoeuvre roll value on version 6 only", () => {
    expect(normalizeFingerprintParameters("reroll", { roll: "manoeuvre", subset: "all", weapon_type: "all" }, 6)).toMatchObject({ roll: "manoeuvre" });
    expect(() => normalizeFingerprintParameters("reroll", { roll: "manoeuvre", subset: "all", weapon_type: "all" }, 5)).toThrow();
  });

  it("keeps every roll value version 5 accepted", () => {
    const values = ["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage", "attacks", "psychic", "surge", "hazard", "any", "resource-die", "blessings-of-khorne", "desperate-escape", "deadly-demise", "all"];
    for (const roll of values) expect(normalizeFingerprintParameters("reroll", { roll, subset: "all", weapon_type: "all" }, 6)).toMatchObject({ roll });
  });
});

describe("Named ability's own dice (reroll v6, roll-modifier v7)", () => {
  it("re-rolls the dice an ability rolls, once the ability is used in the clause", () => {
    const mechanics = compiled(placed(RP_TEXT, RP_EVENT, RP_REROLL), RP_TEXT).mechanics;
    expect(mechanics.trigger).toEqual({ event: "used", filter: { kind: "ability", id: "reanimation-protocols-necrons" } });
    expect(mechanics.effect).toEqual({ type: "re-roll", target: "this-unit", modifier: { roll: { of_ability: "reanimation-protocols-necrons" }, result_scope: "any-result" } });
    expect(mechanics.behavior).toBe("reactive");
  });

  it("adds to an ability's own dice on a roll-modifier with subject this-unit", () => {
    const text = "Sample unit only. When this unit activates its Sample Aura, add 1 to the roll.";
    const mechanics = compiled(placed(text,
      ["When this unit activates its Sample Aura", "event", { kind: "used", activity: "ability", id: "reanimation-protocols-necrons", subject: "this-unit" }],
      ["add 1 to the roll", "roll-modifier", { roll: { ability: "reanimation-protocols-necrons" }, operation: "add", value: 1 }]), text).mechanics;
    expect(mechanics.effect).toEqual({ type: "roll-modifier", target: "this-unit", modifier: { roll: { of_ability: "reanimation-protocols-necrons" }, operation: "add", value: 1 } });
  });

  it("refuses an ability's dice with no use of that ability before the roll", () => {
    const text = "You can re-roll the dice to see how many marks are added.";
    expect(refusal(placed(text, ["re-roll the dice", "reroll", { roll: { ability: "reanimation-protocols-necrons" }, subset: "all", weapon_type: "all" }]), text))
      .toMatch(/roll of ability reanimation-protocols-necrons .* has no use of reanimation-protocols-necrons before it/);
  });

  it("refuses an ability's dice when the ability is only activated, not used", () => {
    const text = "Activate the Sample Aura ability. You can re-roll the dice to see how many marks are added.";
    expect(refusal(placed(text,
      ["Activate the Sample Aura ability", "ability-activate", { subject: "this-unit" }],
      ["re-roll the dice", "reroll", { roll: { ability: "reanimation-protocols-necrons" }, subset: "all", weapon_type: "all" }]), text))
      .toMatch(/has no use of reanimation-protocols-necrons/);
  });

  it("refuses an ability's dice naming a different ability than the one used", () => {
    const text = "Each time this unit's Sample Aura activates, you can re-roll the dice to see how many marks are added.";
    expect(refusal(placed(text, RP_EVENT, ["re-roll the dice", "reroll", { roll: { ability: "their-number-is-legion-necrons" }, subset: "all", weapon_type: "all" }]), text))
      .toMatch(/has no use of their-number-is-legion-necrons/);
  });

  it("rejects an ability roll whose id is not a kebab-case id, or that carries more keys", () => {
    expect(() => normalizeFingerprintParameters("reroll", { roll: { ability: "Sample Aura" }, subset: "all", weapon_type: "all" }, 6)).toThrow();
    expect(() => normalizeFingerprintParameters("roll-modifier", { roll: { ability: "reanimation-protocols-necrons", source: "x" }, operation: "add", value: 1 }, 7)).toThrow();
  });

  it("keeps a quoted-source roll refused at compile time", () => {
    const text = "Add 1 to the result of the roll.";
    expect(refusal(placed(text, ["Add 1 to the result of the roll", "roll-modifier", { roll: { source: "the roll" }, operation: "add", value: 1 }]), text)).toMatch(/quoted source text/);
    const reroll = "Re-roll the roll.";
    expect(refusal(placed(reroll, ["Re-roll the roll", "reroll", { roll: { source: "the roll" }, subset: "all", weapon_type: "all" }]), reroll)).toMatch(/quoted source text/);
  });

  it("refuses a bare reanimation-protocols id, which names no ability record", () => {
    const list = placed(RP_TEXT, ["Each time this unit's Sample Aura activates", "event", { kind: "used", activity: "ability", id: "reanimation-protocols", subject: "this-unit" }],
      ["re-roll the dice", "reroll", { roll: { ability: "reanimation-protocols" }, subset: "all", weapon_type: "all" }]);
    const result = compiled(list, RP_TEXT);
    expect(coreCheckErrors(DATA_ROOT, "their-number-is-legion-necrons", result.checks).join(" ")).toMatch(/reanimation-protocols is no ability record/);
  });

  it("resolves the canonical reanimation id against the record's faction", () => {
    const result = compiled(placed(RP_TEXT, RP_EVENT, RP_REROLL), RP_TEXT);
    expect(coreCheckErrors(DATA_ROOT, "their-number-is-legion-necrons", result.checks)).toEqual([]);
  });
});

describe("Count of models equipped with a wargear item (count-scale v3)", () => {
  it("re-rolls one die for each model that carries the wargear, on the named ability's wound roll", () => {
    const mechanics = compiled(placed(CALTROPS_TEXT, ...CALTROPS_LEAVES), CALTROPS_TEXT).mechanics;
    expect(mechanics.trigger).toEqual({ event: "before-roll", filter: { roll: "wound" } });
    expect(mechanics.effect.condition).toEqual({ type: "happened", parameters: { event: "used", filter: { kind: "ability", id: "eviscerating-fly-by-aeldari" }, window: "event" } });
    expect(mechanics.effect.effect.modifier.count).toEqual({ count_of: "models-equipped-with", wargear: "cluster-caltrops" });
    expect(mechanics.effect.effect.modifier.subset).toBeUndefined();
  });

  it("compiles the same shape for the drukhari ability id, with the same wargear", () => {
    const text = CALTROPS_TEXT;
    const leaves = CALTROPS_LEAVES.map(([wording, family, parameters]): [string, string, Record<string, unknown>] => [
      wording, family, family === "ability-used" ? { ...parameters, id: "eviscerating-fly-by-drukhari" } : parameters,
    ]);
    const result = compiled(placed(text, ...leaves), text);
    expect(result.mechanics.effect.effect.modifier.count).toEqual({ count_of: "models-equipped-with", wargear: "cluster-caltrops" });
    expect(result.mechanics.effect.condition.parameters.filter).toEqual({ kind: "ability", id: "eviscerating-fly-by-drukhari" });
    expect(coreCheckErrors(DATA_ROOT, "eviscerating-fly-by-drukhari", result.checks).filter((error) => error.includes("wargear"))).toEqual([]);
  });

  it("scales a per-count amount by the wargear it names", () => {
    const text = "Add 1 to the Hit roll for each model in this unit that carries cluster caltrops.";
    const mechanics = compiled(placed(text,
      ["Add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["for each model in this unit that carries cluster caltrops", "count-scale", { per: 2, counts: "models-equipped-with", wargear: "cluster-caltrops" }]), text).mechanics;
    expect(mechanics.effect.modifier.value).toBe(1);
    expect(mechanics.effect.scaling).toEqual({ per: 2, of: "models-equipped-with", wargear: "cluster-caltrops" });
  });

  it("refuses a models-equipped-with count with no wargear, and any wargear on another count", () => {
    expect(() => normalizeFingerprintParameters("count-scale", { per: 1, counts: "models-equipped-with" }, 3)).toThrow(/wargear/);
    expect(() => normalizeFingerprintParameters("count-scale", { per: 1, counts: "following-filter", wargear: "cluster-caltrops" }, 3)).toThrow(/wargear/);
    expect(() => normalizeFingerprintParameters("count-scale", { per: 1, counts: "models-equipped-with", wargear: "cluster-caltrops", timing: "on-apply" }, 3)).toThrow(/live/);
  });

  it("refuses the count taking a following unit-filter", () => {
    const text = "Add 1 to the Hit roll for each model in this unit that carries cluster caltrops, and each enemy unit.";
    expect(refusal(placed(text,
      ["Add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["for each model in this unit that carries cluster caltrops", "count-scale", { per: 1, counts: "models-equipped-with", wargear: "cluster-caltrops" }],
      ["each enemy unit", "unit-filter", { side: "enemy", keywords: ["INFANTRY"] }]), text))
      .toMatch(/takes no unit-filter after it/);
  });

  it("refuses a wargear id that is not a core wargear record", () => {
    const text = "Each time you make a wound roll, you can re-roll one D6 for each model in this unit that carries cluster caltrops.";
    const result = compiled(placed(text,
      ["Each time you make a wound roll", "event", { kind: "before-roll", roll: "wound" }],
      ["re-roll one D6", "reroll", { roll: "wound", subset: "all", weapon_type: "all", count: 1 }],
      ["for each model in this unit that carries cluster caltrops", "count-scale", { per: 1, counts: "models-equipped-with", wargear: "cluster-caltrops-x" }]), text);
    expect(coreCheckErrors(DATA_ROOT, "eviscerating-fly-by-aeldari", result.checks).join(" ")).toMatch(/cluster-caltrops-x is not a core wargear record/);
  });

  it("accepts a core wargear id", () => {
    const result = compiled(placed(CALTROPS_TEXT, ...CALTROPS_LEAVES), CALTROPS_TEXT);
    expect(coreCheckErrors(DATA_ROOT, "eviscerating-fly-by-aeldari", result.checks).filter((error) => error.includes("wargear"))).toEqual([]);
  });
});

describe("Counts of models equipped with wargear leave their qualifiers alone (markCountedSubjects)", () => {
  // Fabricated wording. A qualifier that points back at the counted set ("that unit") is marked COUNTED
  // only for a following-filter count, which takes a unit-filter after it. The models-equipped-with
  // count takes no filter, so the qualifier stays as authored and nothing is required after it.
  const counted = { per: 1, counts: "models-equipped-with", wargear: "cluster-caltrops" };
  const qualifier = { subject: "antecedent", subject_kind: "unit", activity: "ability", window: "now", negated: false };
  const leafAt = (family: string, parameters: Record<string, unknown>, role: CompileLeaf["role"], start: number): CompileLeaf => ({
    role, family_id: family, family_version: 1, parameters, start_byte: start, end_byte: start + 1, fragment: "RAW_TEXT",
  });

  it("does not rewrite a qualifier after a models-equipped-with count to COUNTED", () => {
    const list = [
      leafAt("count-scale", counted, "EFFECT", 0),
      leafAt("ability-used", qualifier, "CONDITION", 1),
    ];
    const marked = markCountedSubjects(list);
    expect(marked[1]!.parameters.subject).toBe("antecedent");
  });

  it("does not rewrite a qualifier even when a unit-filter follows the count", () => {
    const list = [
      leafAt("count-scale", counted, "EFFECT", 0),
      leafAt("unit-filter", { side: "friendly" }, "EFFECT", 0),
      leafAt("ability-used", qualifier, "CONDITION", 1),
    ];
    const marked = markCountedSubjects(list);
    expect(marked[2]!.parameters.subject).toBe("antecedent");
  });
});
