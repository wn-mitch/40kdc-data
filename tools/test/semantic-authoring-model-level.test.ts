import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { destroyerFilterAfter, foldDestroyerFilter, namedDestroyerFilterAfter } from "../src/semantic-authoring/compile-destruction-participants.js";

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
/** A real authored entry, used only as the shell the compiled mechanics are checked in. */
const base = (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)[0]!;

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
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

/** The compiled mechanics, which must also validate, lint and render as a whole entry. */
function mechanicsOf(text: string, ...items: Item[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const check = checkEntry(entryWithMechanics(base, result.mechanics));
  expect(check.errors).toEqual([]);
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(text: string, ...items: Item[]): string {
  const result = compileLeaves(placed(text, ...items), text);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.errors.join("; ");
}

const HOUND = { side: "friendly", keywords: ["GLIMMER", "HOUND"], level: "model" };

describe("Semantic authoring model-level aura recipient", () => {
  const text = "While a friendly GLIMMER HOUND model is wholly within 6\" of this model, that HOUND model has a 4+ invulnerable save against ranged attacks.";
  const leaves = (filter: Record<string, unknown> = HOUND, range: Record<string, unknown> = { inches: 6, of: "this-model", wholly: true }): Item[] => [
    ["friendly GLIMMER HOUND model", "unit-filter", filter],
    ["wholly within 6\" of this model", "aura-range", range],
    ["that HOUND model has a 4+ invulnerable save", "invulnerable-save", { subject: "antecedent", threshold: 4 }],
    ["ranged attacks", "attack-filter", { attack_type: "ranged" }],
  ];

  it("gives the effect to each model in range, not to its unit", () => {
    const mechanics = mechanicsOf(text, ...leaves());
    expect(mechanics.behavior).toBe("aura");
    const effect = JSON.stringify(mechanics.effect);
    expect(effect).not.toContain("\"aura\"");
    expect(effect).not.toContain("\"recipient\"");
    expect(effect).toContain(JSON.stringify({
      owner: "friendly", all_of: ["GLIMMER", "HOUND"], level: "model", within: { range: { inches: 6 }, of: "this-model", wholly: true },
    }));
  });

  it("excludes only this model from an other-model aura", () => {
    const mechanics = mechanicsOf(text, ...leaves({ ...HOUND, other: true }));
    expect(JSON.stringify(mechanics.effect)).toContain("\"excluding\":\"this-model\"");
  });

  it("names the model in range as the attacker of a later attack", () => {
    const attackText = "While a friendly GLIMMER model is within 9\" of this model, each time that model makes an attack, re-roll a Hit roll of 1.";
    const mechanics = mechanicsOf(attackText,
      ["friendly GLIMMER model", "unit-filter", { side: "friendly", keywords: ["GLIMMER"], level: "model" }],
      ["within 9\" of this model", "aura-range", { inches: 9, of: "this-model" }],
      ["each time that model makes an attack", "attack", { direction: "makes", unit: "that-unit", attack_type: "any" }],
      ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }]);
    const effect = JSON.stringify(mechanics.effect);
    expect(effect).not.toContain("\"recipient\"");
    expect(effect).toContain("\"within\":{\"range\":{\"inches\":9},\"of\":\"this-model\"}");
  });

  it("refuses a range that does not say what it is measured from", () => {
    expect(errorsOf(text, ...leaves(HOUND, { inches: 6, wholly: true }))).toContain("must say what its range is measured from");
  });

  it("refuses a capped range", () => {
    expect(errorsOf(text, ...leaves(HOUND, { inches: 6, of: "this-model", range_cap_inches: 9 }))).toContain("cannot carry a cap");
  });

  it("refuses a filter of either side", () => {
    expect(errorsOf(text, ...leaves({ ...HOUND, side: "any" }))).toContain("must say friendly or enemy");
  });

  it("refuses effects that never name the model it reaches (the existential reading)", () => {
    const own = "While a friendly GLIMMER HOUND model is within 6\" of this model, this unit has a 4+ invulnerable save.";
    expect(errorsOf(own,
      ["friendly GLIMMER HOUND model", "unit-filter", HOUND],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["this unit has a 4+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 4 }])).toContain("never name the model it reaches");
  });

  it("refuses a condition on each model it reaches", () => {
    const gated = "While a friendly GLIMMER HOUND model is within 6\" of this model, if that model is engaged, that model has a 4+ invulnerable save.";
    expect(errorsOf(gated,
      ["friendly GLIMMER HOUND model", "unit-filter", HOUND],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["that model is engaged", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false }],
      ["that model has a 4+ invulnerable save", "invulnerable-save", { subject: "antecedent", threshold: 4 }])).toContain("condition on each model");
  });

  it("refuses a trigger whose unit is the model it reaches", () => {
    const moment = "While a friendly GLIMMER model is within 6\" of this model, after that model has resolved its attacks, that model regains 1 lost wound.";
    expect(errorsOf(moment,
      ["friendly GLIMMER model", "unit-filter", { side: "friendly", keywords: ["GLIMMER"], level: "model" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["after that model has resolved its attacks", "event", { kind: "attacks-resolved", action_kind: "attack", subject: "antecedent" }],
      ["that model regains 1 lost wound", "regain-wounds", { subject: "antecedent", amount: "1" }])).toContain("cannot be a trigger's unit");
  });

  it("keeps a unit-level aura as an aura wrapper", () => {
    const units = "While a friendly GLIMMER unit is within 6\" of this model, that unit has a 5+ invulnerable save.";
    const mechanics = mechanicsOf(units,
      ["friendly GLIMMER unit", "unit-filter", { side: "friendly", keywords: ["GLIMMER"] }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["that unit has a 5+ invulnerable save", "invulnerable-save", { subject: "antecedent", threshold: 5 }]);
    expect(mechanics.effect.type).toBe("aura");
    expect(mechanics.effect.target).toBe("friendly-within-aura");
  });
});

describe("Semantic authoring model-level selection", () => {
  const text = "In your Command phase, select one friendly GLIMMER VEHICLE model within 3\" of this model. That model regains up to D3 lost wounds.";
  const items = (filter: Record<string, unknown>): Item[] => [
    ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
    ["select one", "select-unit", { distance: "any", visible: false }],
    ["friendly GLIMMER VEHICLE model", "unit-filter", filter],
    ["within 3\" of this model", "unit-position", { kind: "within", inches: 3, of: "this-model", subject: "selected-unit", negated: false }],
    ["That model regains up to D3 lost wounds", "regain-wounds", { subject: "antecedent", amount: "D3" }],
  ];
  const VEHICLE = { side: "friendly", keywords: ["GLIMMER", "VEHICLE"], level: "model" };

  it("selects a model", () => {
    const mechanics = mechanicsOf(text, ...items(VEHICLE));
    // The Command phase gates the selection.
    const selection = mechanics.effect.effect;
    expect(selection.type).toBe("select-units");
    expect(selection.selector).toMatchObject({ filter: { owner: "friendly", all_of: ["GLIMMER", "VEHICLE"], level: "model" }, count: { min: 1, max: 1 } });
    expect(selection.effect.target).toBe("selected-unit");
  });

  it("keeps a unit selection without a model-level filter", () => {
    const mechanics = mechanicsOf(text.replace("VEHICLE model", "VEHICLE unit"),
      ...items({ side: "friendly", keywords: ["GLIMMER", "VEHICLE"] }).map(([wording, family, parameters]) => [wording.replace("VEHICLE model", "VEHICLE unit"), family, parameters] as Item));
    expect(mechanics.effect.effect.type).toBe("select-units");
    expect(mechanics.effect.effect.selector.filter.level).toBeUndefined();
  });

  it("refuses an other-model selection when no bearer's unit size is known", () => {
    expect(errorsOf(text, ...items({ ...VEHICLE, other: true }))).toContain("excludes only the bearer's unit");
  });

  it("refuses a per-model usage-scope on a model selection, which has two readings", () => {
    const capped = `${text} Each model can only be selected once per turn.`;
    expect(errorsOf(capped, ...items(VEHICLE),
      ["Each model can only be selected once per turn", "usage-scope", { per: "model" }])).toContain("no decided reading yet");
  });

  it("lowers a per-model usage on a model selection to that selection's limit", () => {
    const capped = `${text} Each model can only be selected once per turn.`;
    const mechanics = mechanicsOf(capped, ...items(VEHICLE),
      ["Each model can only be selected once per turn", "usage-limit", { frequency: "once-per-turn", per: "model" }]);
    expect(JSON.stringify(mechanics.effect)).toContain('"limit":{"count":1,"period":"turn"}');
    expect(mechanics.usage).toBeUndefined();
  });

  it("refuses a designated target that is a model", () => {
    const designated = "Select one enemy GLIMMER model. Each time this model makes an attack that targets that model, add 1 to the Hit roll.";
    expect(errorsOf(designated,
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["enemy GLIMMER model", "unit-filter", { side: "enemy", keywords: ["GLIMMER"], level: "model" }],
      ["Each time this model makes an attack", "attack", { direction: "makes", unit: "this-model", attack_type: "any" }],
      ["that targets that model", "target-is-selected", {}],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }])).toContain("designate-target selects units");
  });

  it("still refuses a for-each over models", () => {
    const each = "For each enemy GLIMMER model within 6\" of this model, roll one D6.";
    expect(errorsOf(each,
      ["For each", "for-each-unit-select", {}],
      ["enemy GLIMMER model", "unit-filter", { side: "enemy", keywords: ["GLIMMER"], level: "model" }],
      ["roll one D6", "dice-roll", { dice: "D6" }])).toContain("naming models has no DSL shape for a for-each");
  });
});

describe("Semantic authoring destroyed model of a passive moment", () => {
  const text = "When a friendly GLIMMER model within 6\" of this unit is destroyed, add 1 to the Hit roll for that model's unit.";
  const items = (filter: Record<string, unknown>, kind = "model-destroyed", owner: Record<string, unknown> = { object_owner: "friendly" }): Item[] => [
    ["friendly GLIMMER model", "unit-filter", filter],
    ["within 6\" of this unit", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false }],
    ["is destroyed", "event", { kind, ...owner }],
    ["add 1 to the Hit roll for that model's unit", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "antecedent" }],
  ];

  it("names the destroyed model as the trigger's object and binds later anaphors to it", () => {
    const mechanics = mechanicsOf(text, ...items({ side: "friendly", keywords: ["GLIMMER"], level: "model" }));
    expect(mechanics.trigger).toMatchObject({ event: "model-destroyed", object: { owner: "friendly", all_of: ["GLIMMER"], level: "model" } });
    expect(mechanics.trigger.subject).toBeUndefined();
    // An owner on the destruction makes it any such model, not one of this unit's.
    expect(mechanics.trigger.object.member_of).toBeUndefined();
    const effect = JSON.stringify(mechanics.effect);
    expect(effect).toContain("\"subject\":\"event-object\"");
    expect(effect).toContain("\"target\":\"event-object\"");
    expect(effect).not.toContain("event-subject");
  });

  it("keeps a bare model destruction to this unit's models, which the filter narrows", () => {
    const own = "Each time a GLIMMER model in this unit is destroyed, this unit regains 1 lost wound.";
    const mechanics = mechanicsOf(own,
      ["GLIMMER model", "unit-filter", { side: "friendly", keywords: ["GLIMMER"], level: "model" }],
      ["in this unit is destroyed", "event", { kind: "model-destroyed" }],
      ["this unit regains 1 lost wound", "regain-wounds", { subject: "this-unit", amount: "1" }]);
    expect(mechanics.trigger).toMatchObject({ event: "model-destroyed", object: { owner: "friendly", all_of: ["GLIMMER"], level: "model", member_of: "this-unit" } });
    expect(mechanics.trigger.subject).toBeUndefined();
  });

  it("keeps the filter as the destroyer's side when the destroyed model is the other side's", () => {
    const mechanics = mechanicsOf(text, ...items({ side: "friendly", keywords: ["GLIMMER"] }, "model-destroyed", { object_owner: "enemy" }).slice(0, 3),
      ["add 1 to the Hit roll for that model's unit", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "this-unit" }]);
    expect(mechanics.trigger).toMatchObject({ event: "model-destroyed", subject: { owner: "friendly", all_of: ["GLIMMER"] }, object: { owner: "enemy", level: "model" } });
  });

  it("names a destroyed unit as the object when the filter sits right before the moment", () => {
    const plain = "When a friendly GLIMMER unit is destroyed, this unit regains 1 lost wound.";
    const mechanics = mechanicsOf(plain,
      ["friendly GLIMMER unit", "unit-filter", { side: "friendly", keywords: ["GLIMMER"] }],
      ["is destroyed", "event", { kind: "unit-destroyed" }],
      ["this unit regains 1 lost wound", "regain-wounds", { subject: "this-unit", amount: "1" }]);
    expect(mechanics.trigger).toMatchObject({ event: "destroyed", object: { owner: "friendly", all_of: ["GLIMMER"] } });
    expect(mechanics.trigger.subject).toBeUndefined();
  });

  it("narrows the destroyed unit, not this unit, by a Stratagem's \"that X unit\"", () => {
    const stratagem = "Fight phase. When a friendly GLIMMER unit is destroyed. That HOUND unit: this unit regains 1 lost wound.";
    const result = compileLeaves(placed(stratagem,
      ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }],
      ["friendly GLIMMER unit", "unit-filter", { side: "friendly", keywords: ["GLIMMER"] }],
      ["is destroyed", "event", { kind: "unit-destroyed" }],
      ["That HOUND unit", "triggering-target", { selects: "unit", keywords: ["HOUND"], match: "all" }],
      ["this unit regains 1 lost wound", "regain-wounds", { subject: "this-unit", amount: "1" }]), stratagem);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const trigger = (result.mechanics as unknown as Record<string, any>).trigger;
    expect(trigger.object).toEqual({ owner: "friendly", all_of: ["GLIMMER", "HOUND"] });
    expect(trigger.condition).toBeUndefined();
  });

  it("refuses a model-level filter on a unit's destruction", () => {
    expect(errorsOf(text, ...items({ side: "friendly", keywords: ["GLIMMER"], level: "model" }, "unit-destroyed"))).toContain("cannot be what a unit's destruction destroys");
  });
});

describe("Semantic authoring destruction participant binding", () => {
  it("keeps a preceding destroyer filter as the subject when the victim follows the event", () => {
    const text = "When a friendly GLIMMER unit destroys an enemy unit, this unit regains 1 lost wound.";
    const mechanics = mechanicsOf(text,
      ["friendly GLIMMER unit", "unit-filter", { side: "friendly", keywords: ["GLIMMER"] }],
      ["destroys an", "event", { kind: "unit-destroyed", by: "antecedent" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["this unit regains 1 lost wound", "regain-wounds", { subject: "this-unit", amount: "1" }]);
    expect(mechanics.trigger).toMatchObject({
      event: "destroyed",
      subject: { owner: "friendly", all_of: ["GLIMMER"] },
      object: { owner: "enemy" },
    });
  });

  it("keeps the destroyed model as the object and binds its exact enemy destroyer as the subject", () => {
    const text = "Each time a friendly GLIMMER model is destroyed by an enemy HOUND unit, that enemy unit gains a marked token.";
    const mechanics = mechanicsOf(text,
      ["friendly GLIMMER model", "unit-filter", { side: "friendly", keywords: ["GLIMMER"], level: "model" }],
      ["is destroyed by an", "event", { kind: "model-destroyed", by: "enemy", object_owner: "friendly" }],
      ["enemy HOUND unit", "unit-filter", { side: "enemy", keywords: ["HOUND"] }],
      ["that enemy unit gains a marked token", "apply-mark", { subject: "antecedent", tag: "marked" }]);

    expect(mechanics.trigger).toMatchObject({
      event: "model-destroyed",
      object: { owner: "friendly", all_of: ["GLIMMER"], level: "model" },
      subject: { owner: "enemy", all_of: ["HOUND"] },
    });
    expect(mechanics.effect).toEqual({ type: "designate", target: "event-subject", modifier: { tag: "marked" } });
  });

  it("only accepts a unit-level filter on the destruction's named side", () => {
    const event = placed("is destroyed enemy", ["is destroyed", "event", { kind: "model-destroyed", by: "enemy", object_owner: "friendly" }])[0]!;
    const bound = { ...event, parameters: { ...event.parameters, object_filter: { owner: "friendly", level: "model" } } };
    const enemy = placed("enemy HOUND unit", ["enemy HOUND unit", "unit-filter", { side: "enemy", keywords: ["HOUND"] }])[0]!;
    const friendly = placed("friendly HOUND unit", ["friendly HOUND unit", "unit-filter", { side: "friendly", keywords: ["HOUND"] }])[0]!;
    const model = placed("enemy HOUND model", ["enemy HOUND model", "unit-filter", { side: "enemy", keywords: ["HOUND"], level: "model" }])[0]!;

    expect(namedDestroyerFilterAfter(event, enemy)).toBe(true);
    expect(destroyerFilterAfter(bound, enemy)).toBe(true);
    expect(foldDestroyerFilter(bound, enemy, { owner: "enemy", all_of: ["HOUND"] }).parameters.subject_filter)
      .toEqual({ owner: "enemy", all_of: ["HOUND"] });
    expect(destroyerFilterAfter(bound, friendly)).toBe(false);
    expect(destroyerFilterAfter(bound, model)).toBe(false);
  });
});

describe("Semantic authoring whose roll a roll moment is", () => {
  const text = "When a saving throw is failed for a friendly GLIMMER VEHICLE model within 6\" of this model, you can change the Damage of that attack to 0.";
  const items = (reduction: Record<string, unknown>): Item[] => [
    ["When a saving throw is failed", "event", { kind: "after-roll", roll: "save", result: "failure" }],
    ["friendly GLIMMER VEHICLE model", "unit-filter", { side: "friendly", keywords: ["GLIMMER", "VEHICLE"], level: "model" }],
    ["within 6\" of this model", "unit-position", { kind: "within", inches: 6, of: "this-model", subject: "antecedent", negated: false }],
    ["you can", "optional-use", { who: "you" }],
    ["change the Damage of that attack to 0", "damage-reduction", reduction],
  ];

  it("names the model whose save failed as the roll's subject, the guard's subject and the reduced unit", () => {
    const mechanics = mechanicsOf(text, ...items({ subject: "antecedent", reduction: "to-zero", weapon_type: "all" }));
    expect(mechanics.trigger).toMatchObject({
      event: "after-roll", filter: { roll: "save", result: "failure" }, subject: { owner: "friendly", all_of: ["GLIMMER", "VEHICLE"], level: "model" },
    });
    const effect = JSON.stringify(mechanics.effect);
    expect(effect).toContain("\"subject\":\"event-subject\"");
    expect(effect).toContain("\"type\":\"damage-reduction\",\"target\":\"event-subject\"");
  });

  it("keeps an explicit this-unit reduction on this unit", () => {
    const mechanics = mechanicsOf(text, ...items({ subject: "this-unit", reduction: "to-zero", weapon_type: "all" }));
    expect(JSON.stringify(mechanics.effect)).toContain("\"type\":\"damage-reduction\",\"target\":\"this-unit\"");
  });

  it("accepts antecedent only from damage-reduction's new version", () => {
    const version = currentFamilyVersion("damage-reduction");
    expect(normalizeFingerprintParameters("damage-reduction", { subject: "antecedent", reduction: "1", weapon_type: "all" }, version).subject).toBe("antecedent");
    expect(() => normalizeFingerprintParameters("damage-reduction", { subject: "antecedent", reduction: "1", weapon_type: "all" }, version - 1)).toThrow();
  });
});

describe("Semantic authoring existential model-level condition", () => {
  it("tests whether any such model is in range, keeping the model level", () => {
    const text = "If a friendly GLIMMER OFFICER model is within 6\" of this unit, add 1 to the Hit roll for this unit.";
    const mechanics = mechanicsOf(text,
      ["friendly GLIMMER OFFICER model", "unit-filter", { side: "friendly", keywords: ["GLIMMER", "OFFICER"], level: "model" }],
      ["within 6\" of this unit", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(JSON.stringify(mechanics)).toContain("\"level\":\"model\"");
  });

  it("refuses to fold a conditional bonus into this ability's own dice", () => {
    const text = "Roll one D6 with +1 to the result if a friendly GLIMMER OFFICER model is within 6\" of this unit: on a 5+, you gain 1CP.";
    expect(errorsOf(text,
      ["Roll one D6", "dice-roll", { dice: "D6" }],
      ["with +1 to the result", "roll-modifier", { roll: "preceding", operation: "add", value: 1 }],
      ["friendly GLIMMER OFFICER model", "unit-filter", { side: "friendly", keywords: ["GLIMMER", "OFFICER"], level: "model" }],
      ["within 6\" of this unit", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false }],
      ["on a 5+", "roll-result", { from: 5 }],
      ["you gain 1CP", "resource-gain", { pool: "command-point", amount: 1 }])).toContain("conditional change to this ability's own roll");
  });
});
