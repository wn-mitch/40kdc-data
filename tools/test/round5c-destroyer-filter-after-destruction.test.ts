import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { bindAntecedents } from "../src/round5c/compile-antecedent.js";
import { foldDestroyedByFilter } from "../src/round5c/compile-destroying-attack.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { describeTrigger } from "../src/translate/trigger.js";

// Fabricated wording only: the keywords (ALPHA, BETA, PENITENT) and the sentence shapes are invented.
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
    // 6296 shape, as its row describes it: "each time an enemy unit is destroyed by a PENITENT unit from your army". Its stored leaves were not in any scratch database.
    const text = "Each time an enemy unit is destroyed by a PENITENT unit from your army, you gain 1 point.";
    const items: Item[] = [
      ["enemy unit", "unit-filter", { side: "enemy" }],
      destroyedUnit(),
      ["PENITENT unit", "unit-filter", { side: "any", keywords: ["PENITENT"] }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["you gain 1 point", "resource-gain", { pool: "command-point", amount: 1 }],
    ];
    const mechanics = compiled(text, items);
    expect(mechanics.trigger).toMatchObject({ event: "destroyed", subject: { owner: "friendly", all_of: ["PENITENT"] }, object: { owner: "enemy" } });
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
    const text = "After all the bearer's attacks have been resolved in a fight, add 1 to the Hit roll.";
    const mechanics = compiled(text, [
      ["After all the bearer's attacks have been resolved in a fight", "event", { kind: "attacks-resolved", action_kind: "fight", subject: "this-model" }],
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
});

// 6242 shape: "each time the bearer fights, if one or more enemy models are destroyed by those attacks".
const MIRACLE = "Each time the bearer fights, if one or more enemy models are destroyed by those attacks, you gain 1 Miracle dice.";
const MIRACLE_ITEMS: Item[] = [
  ["Each time the bearer fights", "event", { kind: "attacks-resolved", action_kind: "fight", subject: "this-model" }],
  ["enemy models", "unit-filter", { side: "enemy", level: "model" }],
  ["are destroyed by those attacks", "unit-activity", { negated: false, activities: ["destroyed-models-by-triggering-attacks"], named: "before", container: "none", destroyer: "this-model" }],
  ["you gain 1 Miracle dice", "resource-gain", { pool: "miracle-dice-pool", amount: 1 }],
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
    const text = "After that model has shot this phase, if one or more enemy units were destroyed by those attacks, you gain 2 YP.";
    const mechanics = compiled(text, [
      ["After that model has shot this phase", "event", { kind: "attacks-resolved", action_kind: "shoot", subject: "this-model" }],
      ["enemy units", "unit-filter", { side: "enemy" }],
      ["were destroyed by those attacks", "unit-activity", { negated: false, activities: ["destroyed-units-by-triggering-attacks"], named: "before", container: "none", destroyer: "this-model" }],
      ["you gain 2 YP", "resource-gain", { pool: "yp-pool", amount: 2 }],
    ]);
    expect(mechanics.trigger).toMatchObject({ event: "attacks-resolved", subject: "this-model", filter: { kind: "shoot" } });
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: { type: "happened", parameters: { event: "destroyed", object: { owner: "enemy" }, filter: { by: "this-model" } } } });
  });

  it("describes a fight moment with no subject as a fight, not a generic attack resolution", () => {
    expect(describeTrigger({ event: "attacks-resolved", filter: { kind: "fight" } } as never)).toContain("in a fight");
    expect(describeTrigger({ event: "attacks-resolved", filter: { kind: "shoot" } } as never)).not.toContain("in a fight");
  });
});

// 8370 shape, authored with the condition after its own moment: the critical-wound effect stays ungated.
describe("Round 5C destruction gate scoped to its own part", () => {
  it("gates only the destroy-models effect, leaving the earlier critical-wound effect ungated", () => {
    const text = "This unit's melee attacks score a critical wound on an unmodified 3+. When this unit has fought, if those attacks did not destroy an enemy model, one model in this unit is destroyed.";
    const mechanics = compiled(text, [
      ["This unit's melee attacks score a critical wound on an unmodified 3+", "critical-hit-threshold", { value: 3, roll: "wound" }],
      ["When this unit has fought", "event", { kind: "attacks-resolved", action_kind: "fight", subject: "this-unit" }],
      ["did not destroy an", "unit-activity", { negated: true, activities: ["destroyed-models-by-triggering-attacks"], named: "after", container: "none", destroyer: "this-unit" }],
      ["enemy model", "unit-filter", { side: "enemy", level: "model" }],
      ["one model in this unit is destroyed", "destroy-models", { recipient: "this-unit", count: "1" }],
    ]);
    const steps = mechanics.effect.steps as Array<Record<string, any>>;
    expect(steps[0]).toMatchObject({ type: "roll-result", modifier: { roll: "wound", critical_on: 3 } });
    expect(steps[1]).toMatchObject({ type: "ability-part", trigger: { event: "attacks-resolved", filter: { kind: "fight" } } });
    expect(steps[1]!.effect).toMatchObject({ type: "conditional", condition: { operator: "not", operands: [{ type: "happened", parameters: { event: "model-destroyed", object: { owner: "enemy", level: "model" }, filter: { by: "this-unit" }, window: "event" } }] } });
  });
});
