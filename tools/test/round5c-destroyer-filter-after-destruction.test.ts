import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { bindAntecedents } from "../src/round5c/compile-antecedent.js";
import { foldDestroyedByFilter } from "../src/round5c/compile-destroying-attack.js";
import { isSameAttackResolved } from "../src/round5c/compile-weapon-qualified.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { describeTrigger } from "../src/translate/trigger.js";

// Fabricated wording only: the keywords (ALPHA, BETA, GAMMA) and the sentences are invented; only the sentence shape is kept.
// The shapes mirror the destroyer-filter records: a destruction whose following unit-filter is the destroyer.

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((entry) => entry.ability_id === "control-edict-adeptus-mechanicus")!;

type Item = [wording: string, family: string, parameters: Record<string, unknown>];

/** Leaves placed on their own wording in `text`, in order (a family version the current one by default). */
function placed(text: string, items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    const end = start + Buffer.byteLength(wording, "utf8");
    from = end;
    return { role: familyRole(family, currentFamilyVersion(family)), family_id: family, family_version: currentFamilyVersion(family), parameters, start_byte: start, end_byte: end, fragment: "RAW_TEXT" };
  });
}

function compiled(text: string, items: Item[]) {
  const result = compileLeaves(placed(text, items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const check = checkEntry(entryWithMechanics(base, result.mechanics));
  expect(check.errors).toEqual([]);
  return result.mechanics as unknown as Record<string, any>;
}

const refused = (text: string, items: Item[]): string => {
  const result = compileLeaves(placed(text, items), text);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.errors.join(" ");
};

const ALPHA = ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }] as Item;
const destroyedUnit = (): Item => ["is destroyed", "event", { kind: "unit-destroyed" }];
const ENEMY = ["enemy unit", "unit-filter", { side: "enemy" }] as Item;
const marked = (subject = "antecedent"): Item => ["is marked", "apply-mark", { subject, tag: "afflicted" }];

// 2214 shape: the destroyed unit is named before the moment, the destroyer after it, and the
// effect's antecedent is the destroyer.
const TEXT_2214 = "When a friendly ALPHA unit is destroyed by an enemy unit. That enemy unit is marked.";

describe("Round 5C destroyer filter after a unit-destroyed moment", () => {
  it("names the destroyer as the destruction's subject and the destroyed unit as its object", () => {
    const mechanics = compiled(TEXT_2214, [ALPHA, destroyedUnit(), ENEMY, marked()]);
    expect(mechanics.trigger).toMatchObject({
      event: "destroyed",
      subject: { owner: "enemy" },
      object: { owner: "friendly", all_of: ["ALPHA"] },
    });
    expect(JSON.stringify(mechanics.effect)).toContain('"target":"event-subject"');
  });

  it("refuses a later antecedent that names the destroyed unit's keywords", () => {
    const text = "When a friendly ALPHA unit is destroyed by an enemy unit. That ALPHA unit is marked.";
    expect(refused(text, [ALPHA, destroyedUnit(), ENEMY, marked()])).toContain("names the destroyed unit's keywords");
  });

  it("refuses a later 'that enemy unit' when the destroyed unit is also an enemy unit", () => {
    const text = "When an enemy ALPHA unit is destroyed by a friendly BETA unit. That enemy unit is marked.";
    const items: Item[] = [["enemy ALPHA unit", "unit-filter", { side: "enemy", keywords: ["ALPHA"] }], destroyedUnit(), ["friendly BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }], marked()];
    expect(refused(text, items)).toContain("names the destroyed unit's side (enemy)");
  });

  it("binds 'that friendly unit' to the destroyer when the destroyed unit is the enemy", () => {
    const text = "When an enemy ALPHA unit is destroyed by a friendly BETA unit. That friendly unit is marked.";
    const items: Item[] = [["enemy ALPHA unit", "unit-filter", { side: "enemy", keywords: ["ALPHA"] }], destroyedUnit(), ["friendly BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }], ["That friendly unit is marked", "apply-mark", { subject: "antecedent", tag: "afflicted" }]];
    const mechanics = compiled(text, items);
    expect(mechanics.trigger).toMatchObject({ subject: { owner: "friendly" }, object: { owner: "enemy", all_of: ["ALPHA"] } });
    expect(JSON.stringify(mechanics.effect)).toContain('"target":"event-subject"');
  });

  it("refuses a bare 'that unit' after the destruction, since the wording cannot say which unit", () => {
    const text = "When a friendly ALPHA unit is destroyed by an enemy unit. That unit is marked.";
    expect(refused(text, [ALPHA, destroyedUnit(), ENEMY, ["That unit is marked", "apply-mark", { subject: "antecedent", tag: "afflicted" }]])).toContain("names neither the destroyer's side nor its keywords");
  });

  it("folds a destroyer with side any and a 'from your army' owner into the destruction's subject", () => {
    // Shape of the 6296 row ("destroyed by a X unit from your army"); its stored leaves were not in any scratch database.
    const text = "Each time an enemy unit is destroyed by a GAMMA unit from your army, you gain 1 point.";
    const items: Item[] = [
      ["enemy unit", "unit-filter", { side: "enemy" }],
      destroyedUnit(),
      ["GAMMA unit", "unit-filter", { side: "any", keywords: ["GAMMA"] }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["you gain 1 point", "resource-gain", { pool: "command-point", amount: 1 }],
    ];
    const mechanics = compiled(text, items);
    expect(mechanics.trigger).toMatchObject({ event: "destroyed", subject: { owner: "friendly", all_of: ["GAMMA"] }, object: { owner: "enemy" } });
  });

  it("compiles the 6296 shape: an optional discard, then a Miracle die showing 6, on the destroyer's trigger", () => {
    const text = "Each time an enemy unit is destroyed by a GAMMA unit from your army, you can discard 1 Miracle dice then gain 1 Miracle dice showing a value of 6.";
    const mechanics = compiled(text, [
      ["enemy unit", "unit-filter", { side: "enemy" }],
      destroyedUnit(),
      ["GAMMA unit", "unit-filter", { side: "any", keywords: ["GAMMA"] }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["you can", "optional-use", { who: "this-model" }],
      ["discard 1 Miracle dice", "resource-spend", { pool: "miracle-dice-pool", amount: 1 }],
      ["gain 1 Miracle dice showing a value of 6", "resource-die", { pool: "miracle-dice-pool", operation: "add", value: 6 }],
    ]);
    expect(mechanics.trigger).toMatchObject({ event: "destroyed", subject: { owner: "friendly", all_of: ["GAMMA"] }, object: { owner: "enemy" }, optional: true });
    expect(mechanics.effect).toMatchObject({
      type: "sequence",
      steps: [
        { type: "resource-spend", modifier: { pool: "miracle-dice-pool", amount: 1 } },
        { type: "resource-die", modifier: { pool: "miracle-dice-pool", operation: "add", value: 6 } },
      ],
    });
  });

  it("refuses a 'from your army' owner that disagrees with the destroyer's side", () => {
    const text = "Each time a friendly ALPHA unit is destroyed by an ALPHA unit from your army, you gain 1 point.";
    const items: Item[] = [
      ALPHA,
      destroyedUnit(),
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["from your army", "unit-owner", { owner: "enemy" }],
    ];
    expect(refused(text, items)).toContain('says friendly and the "from your army" after it says enemy');
  });

  it("refuses a model-level destroyer filter, since a unit's destruction takes a unit", () => {
    const text = "When a friendly ALPHA unit is destroyed by an enemy model, you gain 1 point.";
    const items: Item[] = [ALPHA, destroyedUnit(), ["enemy model", "unit-filter", { side: "enemy", level: "model" }], ["you gain 1 point", "resource-gain", { pool: "command-point", amount: 1 }]];
    expect(refused(text, items)).toContain("A unit-filter needs a select-unit or attack");
  });

  it("leaves a destruction that names no 'by' alone: its filter after it is not the destroyer", () => {
    const text = "When a friendly ALPHA unit is destroyed, a friendly BETA unit gains 1 point.";
    const items: Item[] = [ALPHA, destroyedUnit(), ["friendly BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }]];
    expect(refused(text, items)).not.toBe("");
  });

  it("does not fold the trailing filter as the destroyer of a destruction that names its attacks", () => {
    // destroy_filter takes the place of the destroyer: the destruction keeps no subject from the filter.
    const text = "When a friendly ALPHA unit is destroyed by an enemy unit. That enemy unit is marked.";
    const leaves = placed(text, [ALPHA, destroyedUnit(), ENEMY, marked()]);
    leaves[1]!.parameters = { kind: "unit-destroyed", destroy_filter: { weapon: "any" } };
    const result = compileLeaves(leaves, text);
    expect(JSON.stringify(result.ok ? result.mechanics.trigger : null)).not.toContain('"subject"');
  });

  it("leaves a destruction that already names its destroyer by to the existing path, which does not fold the filter", () => {
    const text = "When a friendly ALPHA unit is destroyed by an enemy unit. That enemy unit is marked.";
    const leaves = placed(text, [ALPHA, destroyedUnit(), ENEMY, marked()]);
    leaves[1]!.parameters = { kind: "unit-destroyed", by: "enemy" };
    const result = compileLeaves(leaves, text);
    expect(JSON.stringify(result)).not.toContain('"subject":{"owner":"enemy"}');
  });

  it("refuses a destruction whose subject is already set when the fold runs", () => {
    const out = placed("is destroyed", [["is destroyed", "event", { kind: "unit-destroyed", subject_filter: { owner: "enemy" } }]]);
    expect(() => foldDestroyedByFilter(out, { owner: "enemy" })).toThrow("already has a subject");
  });

  it("binds a membership that names 'that enemy unit' to the destroyer after a destroyed-by moment", () => {
    const text = "When a friendly ALPHA unit is destroyed by an enemy unit. That enemy unit's Character models are marked.";
    const leaves = placed(text, [ALPHA, destroyedUnit(), ENEMY]);
    const membership = { ...placed(text, [["That enemy unit's Character models", "unit-filter", { side: "enemy", keywords: ["CHARACTER"] }]])[0]!, parameters: { side: "enemy", keywords: ["CHARACTER"], member_of: "antecedent" } };
    const bound = bindAntecedents([...leaves, membership], undefined, text);
    expect(bound.at(-1)!.parameters.member_of).toBe("event-subject");
  });
});

describe("Round 5C event and unit-activity family versions for the destroyer shapes", () => {
  it("accepts action_kind fight on attacks-resolved only", () => {
    expect(normalizeFingerprintParameters("event", { kind: "attacks-resolved", action_kind: "fight", subject: "this-model" }, currentFamilyVersion("event")))
      .toMatchObject({ kind: "attacks-resolved", action_kind: "fight", subject: "this-model" });
    expect(() => normalizeFingerprintParameters("event", { kind: "targets-selected", action_kind: "fight" }, currentFamilyVersion("event")))
      .toThrow(/applies only to attacks-resolved/u);
  });

  it("keeps the earlier attacks-resolved action kinds unchanged", () => {
    expect(normalizeFingerprintParameters("event", { kind: "attacks-resolved", action_kind: "attack" }, currentFamilyVersion("event")))
      .toMatchObject({ kind: "attacks-resolved", action_kind: "attack" });
    expect(normalizeFingerprintParameters("event", { kind: "attacks-resolved", action_kind: "shoot" }, currentFamilyVersion("event")))
      .toMatchObject({ kind: "attacks-resolved", action_kind: "shoot" });
    expect(normalizeFingerprintParameters("event", { kind: "targets-selected", action_kind: "attack" }, currentFamilyVersion("event")))
      .toMatchObject({ kind: "targets-selected", action_kind: "attack" });
  });

  it("lowers a fight moment to the fight filter kind with the bearer as its subject", () => {
    const text = "After the bearer finishes its fight, add 1 to the Hit roll.";
    const mechanics = compiled(text, [
      ["After the bearer finishes its fight", "event", { kind: "attacks-resolved", action_kind: "fight", subject: "this-model" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ]);
    expect(mechanics.trigger).toMatchObject({ event: "attacks-resolved", filter: { kind: "fight" }, subject: "this-model" });
  });

  it("accepts destroyer this-model on a destruction activity and lowers it as the by filter", () => {
    expect(normalizeFingerprintParameters("unit-activity", { activities: ["destroyed-models-by-triggering-attacks"], negated: false, named: "before", container: "none", destroyer: "this-model" }, currentFamilyVersion("unit-activity")))
      .toMatchObject({ destroyer: "this-model" });
    expect(normalizeFingerprintParameters("unit-activity", { activities: ["destroyed-models-by-triggering-attacks"], negated: false, named: "before", container: "none", destroyer: "this-unit" }, currentFamilyVersion("unit-activity")))
      .toMatchObject({ destroyer: "this-unit" });
    expect(() => normalizeFingerprintParameters("unit-activity", { activities: ["remained-stationary"], negated: false, subject: "this-unit", destroyer: "this-model" }, currentFamilyVersion("unit-activity")))
      .toThrow();
  });

  it("keeps every destroyer value the previous unit-activity version accepted", () => {
    for (const destroyer of ["this-unit", "event-subject", "stratagem-target"]) {
      expect(normalizeFingerprintParameters("unit-activity", { activities: ["destroyed-models-by-triggering-attacks"], negated: false, named: "before", container: "none", destroyer }, currentFamilyVersion("unit-activity")))
        .toMatchObject({ destroyer });
    }
  });
});

// Shape of the 6242 row: a fight-moment gain gated on the bearer destroying models with those attacks.
const MIRACLE = "Each time the bearer fights, if one or more enemy models are destroyed by those attacks, you gain 1 point.";
const MIRACLE_ITEMS: Item[] = [
  ["Each time the bearer fights", "event", { kind: "attacks-resolved", action_kind: "fight", subject: "this-model" }],
  ["enemy models", "unit-filter", { side: "enemy", level: "model" }],
  ["are destroyed by those attacks", "unit-activity", { negated: false, activities: ["destroyed-models-by-triggering-attacks"], named: "before", container: "none", destroyer: "this-model" }],
  ["you gain 1 point", "resource-gain", { pool: "miracle-dice-pool", amount: 1 }],
];

describe("Round 5C destroyer shapes compile end to end", () => {
  it("gates the bearer's fight-moment gain on the bearer destroying an enemy model with those attacks", () => {
    const mechanics = compiled(MIRACLE, MIRACLE_ITEMS);
    expect(mechanics.trigger).toMatchObject({ event: "attacks-resolved", subject: "this-model", filter: { kind: "fight" } });
    expect(mechanics.effect).toMatchObject({
      type: "conditional",
      condition: { type: "happened", parameters: { event: "model-destroyed", object: { owner: "enemy", level: "model" }, filter: { by: "this-model" }, window: "event" } },
      effect: { type: "resource-gain", modifier: { pool: "miracle-dice-pool", amount: 1 } },
    });
  });

  it("keeps an attack moment that is not a fight on the attack filter, so a shooting moment does not take the fight kind", () => {
    const mechanics = compiled("Each time the bearer shoots, add 1 to the Hit roll.", [
      ["Each time the bearer shoots", "event", { kind: "attacks-resolved", action_kind: "shoot", subject: "this-model" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ]);
    expect(mechanics.trigger.filter).toEqual({ kind: "shoot" });
  });

  it("gates a shooting moment's gain on a destruction by those attacks, the second moment inside one part", () => {
    const text = "After that model has shot this phase, if one or more enemy units were destroyed by those attacks, you gain 2 points.";
    const mechanics = compiled(text, [
      ["After that model has shot this phase", "event", { kind: "attacks-resolved", action_kind: "shoot", subject: "this-model" }],
      ["enemy units", "unit-filter", { side: "enemy" }],
      ["were destroyed by those attacks", "unit-activity", { negated: false, activities: ["destroyed-units-by-triggering-attacks"], named: "before", container: "none", destroyer: "this-model" }],
      ["you gain 2 points", "resource-gain", { pool: "command-point", amount: 2 }],
    ]);
    expect(mechanics.trigger).toMatchObject({ event: "attacks-resolved", subject: "this-model", filter: { kind: "shoot" } });
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: { type: "happened", parameters: { event: "destroyed", object: { owner: "enemy" }, filter: { by: "this-model" } } } });
  });

  it("describes a fight moment with no subject as a fight, not a generic attack resolution", () => {
    expect(describeTrigger({ event: "attacks-resolved", filter: { kind: "fight" } } as never)).toContain("in a fight");
    expect(describeTrigger({ event: "attacks-resolved", filter: { kind: "shoot" } } as never)).not.toContain("in a fight");
  });
});

// Shape of the 8370 row, authored with the condition after its own moment: the critical-wound effect stays ungated.
describe("Round 5C destruction gate scoped to its own part", () => {
  it("gates only the destroy-models effect, leaving the earlier critical-wound effect ungated", () => {
    const text = "This unit's GAMMA attacks score a critical wound on an unmodified 4+. When this unit has fought, if those attacks did not slay an enemy trooper, one trooper in this unit is removed.";
    const mechanics = compiled(text, [
      ["This unit's GAMMA attacks score a critical wound on an unmodified 4+", "critical-hit-threshold", { value: 4, roll: "wound" }],
      ["When this unit has fought", "event", { kind: "attacks-resolved", action_kind: "fight", subject: "this-unit" }],
      ["did not slay an", "unit-activity", { negated: true, activities: ["destroyed-models-by-triggering-attacks"], named: "after", container: "none", destroyer: "this-unit" }],
      ["enemy trooper", "unit-filter", { side: "enemy", level: "model" }],
      ["one trooper in this unit is removed", "destroy-models", { recipient: "this-unit", count: "1" }],
    ]);
    const steps = mechanics.effect.steps as Array<Record<string, any>>;
    expect(steps[0]).toMatchObject({ type: "roll-result", modifier: { roll: "wound", critical_on: 4 } });
    expect(steps[1]).toMatchObject({ type: "ability-part", trigger: { event: "attacks-resolved", filter: { kind: "fight" } } });
    expect(steps[1]!.effect).toMatchObject({ type: "conditional", condition: { operator: "not", operands: [{ type: "happened", parameters: { event: "model-destroyed", object: { owner: "enemy", level: "model" }, filter: { by: "this-unit" }, window: "event" } }] } });
  });
});

// The 9432 shape: the destroyer's side and keyword fold into the subject, the destroyed unit is the
// object, and the +1 OC stays on this unit.
describe("Round 5C destroyer filter for a stratagem-style moment", () => {
  it("folds the friendly destroyer into the subject, the enemy into the object, and keeps the OC on this unit", () => {
    const text = "Your Shooting phase or the Fight phase, when an enemy unit is destroyed by a friendly ALPHA unit. Target: That ALPHA unit. Your unit has +1 OC until the end of the battle.";
    const mechanics = compiled(text, [
      ["Your Shooting phase or the Fight phase", "use-window", { your_phases: ["shooting", "fight"], opponent_phases: [], either_phases: [] }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      destroyedUnit(),
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["That ALPHA unit", "target-binding", { bound_to: "triggering-unit" }],
      ["Your unit has +1 OC", "characteristic-modifier", { subject: "this-unit", characteristics: ["OC"], operation: "improve", value: 1, weapon_type: "all" }],
      ["until the end of the battle", "duration", { endpoint: "end-of-battle" }],
    ]);
    expect(mechanics.trigger).toMatchObject({ event: "destroyed", subject: { owner: "friendly", all_of: ["ALPHA"] }, object: { owner: "enemy" } });
    expect(mechanics.effect).toMatchObject({ type: "stat-modifier", target: "this-unit", modifier: { stat: "OC", operation: "improve", value: 1 } });
  });
});

// Shape of the 3391 row: the first-time usage limit is spent when its trigger fires, so a destruction
// that only gates the effect is refused rather than burning the limit on a fight with no kill.
describe("Round 5C first-time usage limit beside a destruction gate", () => {
  it("refuses a first-time usage limit whose trigger is a fight and whose destruction only gates the effect", () => {
    const text = "Add 1 to the Attacks of the bearer's melee weapons. The first time the bearer makes a melee attack that destroys an enemy model, after all the bearer's attacks have been resolved, add an additional 1 to the Attacks of the bearer's melee weapons.";
    const message = refused(text, [
      ["The first time the bearer makes a melee attack", "usage-limit", { frequency: "first-this-battle", per: "model" }],
      ["that destroys an", "unit-activity", { negated: false, activities: ["destroyed-models-by-triggering-attacks"], named: "after", container: "none", destroyer: "this-model" }],
      ["enemy model", "unit-filter", { side: "enemy", level: "model" }],
      ["after all the bearer's attacks have been resolved", "event", { kind: "attacks-resolved", action_kind: "fight", subject: "this-model" }],
      ["add an additional 1 to the Attacks", "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "add", value: 1, weapon_type: "melee" }],
    ]);
    expect(message).toContain("first-time usage limit cannot wait on a destruction");
  });
});

// A destruction the bearer's own model makes, with no attack moment naming those attacks, is refused.
describe("Round 5C destroyer this-model needs an attack moment", () => {
  it("refuses this-model under a Stratagem header with no attack moment", () => {
    const text = "Your Shooting phase, if one or more enemy models are destroyed by those attacks, you gain 1 point.";
    expect(refused(text, [
      ["Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }],
      ["enemy models", "unit-filter", { side: "enemy", level: "model" }],
      ["are destroyed by those attacks", "unit-activity", { negated: false, activities: ["destroyed-models-by-triggering-attacks"], named: "before", container: "none", destroyer: "this-model" }],
      ["you gain 1 point", "resource-gain", { pool: "command-point", amount: 1 }],
    ])).toContain("needs a moment whose attacks it names");
  });
});

describe("Round 5C fight-kind attacks-resolved matches the same-attack reference", () => {
  it("accepts a fight-kind moment with no owner, and refuses one that names a subject", () => {
    const fight = { family_id: "event", parameters: { kind: "attacks-resolved", action_kind: "fight" } } as unknown as CompileLeaf;
    expect(isSameAttackResolved(fight)).toBe(true);
    expect(isSameAttackResolved({ ...fight, parameters: { ...fight.parameters, subject: "this-model" } } as unknown as CompileLeaf)).toBe(false);
  });
});

// The 8370 shape with its "If you do" gate: the used gate wraps the whole list, and the destruction
// gate sits only on the destroy-models effect.
describe("Round 5C ability-used gate over a destruction-gated list", () => {
  it("wraps the list in the used gate and leaves the critical-wound part ungated by the destruction", () => {
    const text = "When this unit is selected to fight, you can use this ability. If you do: This unit's GAMMA attacks score a critical wound on an unmodified 4+. When this unit has fought, if those attacks did not slay an enemy trooper, one trooper in this unit is removed.";
    const mechanics = compiled(text, [
      ["When this unit is selected to fight", "event", { kind: "selected", to: "fight", subject: "this-unit" }],
      ["you can use this ability", "optional-use", { who: "this-unit" }],
      ["If you do", "ability-used", { subject: "this-unit", activity: "ability", window: "phase", negated: false }],
      ["This unit's GAMMA attacks score a critical wound on an unmodified 4+", "critical-hit-threshold", { value: 4, roll: "wound" }],
      ["When this unit has fought", "event", { kind: "attacks-resolved", action_kind: "fight", subject: "this-unit" }],
      ["did not slay an", "unit-activity", { negated: true, activities: ["destroyed-models-by-triggering-attacks"], named: "after", container: "none", destroyer: "this-unit" }],
      ["enemy trooper", "unit-filter", { side: "enemy", level: "model" }],
      ["one trooper in this unit is removed", "destroy-models", { recipient: "this-unit", count: "1" }],
    ]);
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: { type: "happened", parameters: { event: "used", filter: { kind: "ability" }, window: "phase" } } });
    const steps = (mechanics.effect.effect as { steps: Array<Record<string, any>> }).steps;
    expect(steps[0]!.effect).toMatchObject({ type: "roll-result" });
    expect(steps[1]!.effect).toMatchObject({ type: "conditional", condition: { operator: "not" } });
  });
});
