import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import type { CompileLeaf } from "../src/semantic-authoring/compile-fragments.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";

// Fabricated wording and records only; no GW rule prose.

const UNITS = "destroyed-units-by-triggering-attacks";
const MODELS = "destroyed-models-by-triggering-attacks";
const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

type Part = [string, string, Record<string, unknown>, string?];

function placed(text: string, parts: Part[]): { leaves: CompileLeaf[]; text: string } {
  let from = 0;
  const leaves = parts.map(([wording, family_id, parameters, fragment]) => {
    const index = text.indexOf(wording, from);
    if (index < 0) throw new Error(`"${wording}" is not in the fixture text after byte ${from}.`);
    from = index + wording.length;
    const start = Buffer.byteLength(text.slice(0, index));
    const version = currentFamilyVersion(family_id);
    return {
      role: familyRole(family_id, version), family_id, family_version: version, start_byte: start, end_byte: start + Buffer.byteLength(wording),
      parameters: normalize(family_id, parameters), ...(fragment ? { fragment } : {}),
    };
  });
  return { leaves, text };
}

function compiled(parts: { leaves: CompileLeaf[]; text: string }) {
  const result = compileLeaves(parts.leaves, parts.text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}
const refusal = (parts: { leaves: CompileLeaf[]; text: string }) => {
  const result = compileLeaves(parts.leaves, parts.text);
  return result.ok ? null : result.errors.join("; ");
};

function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
}

function authored(faction: string, abilityId: string): Record<string, unknown> {
  const enrichment = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
  return (JSON.parse(readFileSync(join(enrichment, faction, "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
    .find((item) => item.ability_id === abilityId)!;
}
const schemaErrors = (mechanics: unknown) => checkEntry(entryWithMechanics(authored("world-eaters", "blessings-of-khorne-world-eaters"), mechanics as never)).errors;

const FNP = { subject: "this-unit", threshold: 6, against: "all" };
const MOMENT: Part = ["After this unit has resolved its attacks", "event", { kind: "attacks-resolved" }];
const FNP_PART: Part = ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP];
const destroyedNodes = (mechanics: unknown) => nodes(mechanics, (node) => node.type === "happened");

describe("destroyed by the triggering attacks: units", () => {
  it("names the enemy units before the verb, by this unit's attacks, in the event window", () => {
    const mechanics = compiled(placed("After this unit has resolved its attacks, if one or more enemy units were destroyed by those attacks, this unit has the Feel No Pain 6+ ability.", [
      MOMENT,
      ["enemy units", "unit-filter", { side: "enemy" }],
      ["were destroyed by those attacks", "unit-activity", { activities: [UNITS], named: "before", container: "none", destroyer: "this-unit", negated: false }],
      FNP_PART,
    ]));
    expect(destroyedNodes(mechanics).map((node) => node.parameters)).toEqual([
      { event: "destroyed", object: { owner: "enemy" }, filter: { by: "this-unit" }, window: "event" },
    ]);
    expect(schemaErrors(mechanics)).toEqual([]);
  });

  it("reads a unit-filter after the verb and a distance measured from this unit at destruction", () => {
    const mechanics = compiled(placed("When an enemy unit has shot, if those attacks destroyed a friendly DARK ANGELS unit within 6\" of this unit, this unit has the Feel No Pain 6+ ability.", [
      ["When an enemy unit has shot", "event", { kind: "enemy-has-shot" }],
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], named: "after", container: "none", destroyer: "event-subject", negated: false }],
      ["a friendly DARK ANGELS unit", "unit-filter", { side: "friendly", keywords: ["DARK ANGELS"] }],
      ["within 6\" of this unit", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false }],
      FNP_PART,
    ]));
    expect(destroyedNodes(mechanics).map((node) => node.parameters)).toEqual([
      { event: "destroyed", object: { owner: "friendly", all_of: ["DARK ANGELS"] }, filter: { by: "event-subject" }, window: "event", proximity: { of: "this-unit", range: { inches: 6 } } },
    ]);
    expect(schemaErrors(mechanics)).toEqual([]);
  });

  it("reads the side-less aura-range a filter takes as the destroyed unit's distance", () => {
    const mechanics = compiled(placed("When an enemy unit has shot, if those attacks destroyed a friendly DARK ANGELS unit within 6\" of this unit, this unit has the Feel No Pain 6+ ability.", [
      ["When an enemy unit has shot", "event", { kind: "enemy-has-shot" }],
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], named: "after", container: "none", destroyer: "event-subject", negated: false }],
      ["a friendly DARK ANGELS unit", "unit-filter", { side: "friendly", keywords: ["DARK ANGELS"] }],
      ["within 6\" of this unit", "aura-range", { inches: 6, of: "this-unit" }],
      FNP_PART,
    ]));
    expect(destroyedNodes(mechanics).map((node) => node.parameters)).toEqual([
      { event: "destroyed", object: { owner: "friendly", all_of: ["DARK ANGELS"] }, filter: { by: "event-subject" }, window: "event", proximity: { of: "this-unit", range: { inches: 6 } } },
    ]);
  });

  it("refuses an aura-range that names a side as a destroyed unit's distance", () => {
    expect(refusal(placed("When an enemy unit has shot, if those attacks destroyed a friendly DARK ANGELS unit within 6\" of an enemy unit, this unit has the Feel No Pain 6+ ability.", [
      ["When an enemy unit has shot", "event", { kind: "enemy-has-shot" }],
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], named: "after", container: "none", destroyer: "event-subject", negated: false }],
      ["a friendly DARK ANGELS unit", "unit-filter", { side: "friendly", keywords: ["DARK ANGELS"] }],
      ["within 6\" of an enemy unit", "aura-range", { inches: 6, of: "this-unit", side: "enemy" }],
      FNP_PART,
    ]))).toMatch(/takes no wholly, negated or side/);
  });

  it("leaves out proximity when no distance follows the destroyed unit", () => {
    const mechanics = compiled(placed("When an enemy unit has shot, if those attacks destroyed a friendly DARK ANGELS unit, this unit has the Feel No Pain 6+ ability.", [
      ["When an enemy unit has shot", "event", { kind: "enemy-has-shot" }],
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], named: "after", container: "none", destroyer: "event-subject", negated: false }],
      ["a friendly DARK ANGELS unit", "unit-filter", { side: "friendly", keywords: ["DARK ANGELS"] }],
      FNP_PART,
    ]));
    const [node] = destroyedNodes(mechanics).map((item) => item.parameters as Record<string, unknown>);
    expect(node).toEqual({ event: "destroyed", object: { owner: "friendly", all_of: ["DARK ANGELS"] }, filter: { by: "event-subject" }, window: "event" });
    expect("proximity" in node!).toBe(false);
  });

  it("names no unit when the activity has neither a before nor an after filter", () => {
    expect(refusal(placed("After this unit has resolved its attacks, if those attacks destroyed a unit, this unit has the Feel No Pain 6+ ability.", [
      MOMENT,
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], named: "none", container: "none", destroyer: "this-unit", negated: false }],
      FNP_PART,
    ]))).toMatch(/destroyed unit is named by a unit-filter/);
  });

  it("refuses a model-level unit-filter on a destroyed unit", () => {
    expect(refusal(placed("After this unit has resolved its attacks, if one or more enemy models were destroyed by those attacks, this unit has the Feel No Pain 6+ ability.", [
      MOMENT,
      ["enemy models", "unit-filter", { side: "enemy", level: "model" }],
      ["were destroyed by those attacks", "unit-activity", { activities: [UNITS], named: "before", container: "none", destroyer: "this-unit", negated: false }],
      FNP_PART,
    ]))).toMatch(/model-level unit-filter/);
  });

  it("refuses a unit-position after a destroyed model", () => {
    expect(refusal(placed("After this unit has resolved its attacks, if those attacks destroyed an enemy CHARACTER model within 6\" of this unit, this unit has the Feel No Pain 6+ ability.", [
      MOMENT,
      ["those attacks destroyed", "unit-activity", { activities: [MODELS], named: "after", container: "none", destroyer: "this-unit", negated: false }],
      ["an enemy CHARACTER model", "unit-filter", { side: "enemy", keywords: ["CHARACTER"], level: "model" }],
      ["within 6\" of this unit", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false }],
      FNP_PART,
    ]))).toMatch(/distance after a destroyed model/);
  });

  it("refuses a distance whose unit-position is not measured from a unit-ref role", () => {
    expect(refusal(placed("When an enemy unit has shot, if those attacks destroyed a friendly DARK ANGELS unit within 6\" of the battlefield edge, this unit has the Feel No Pain 6+ ability.", [
      ["When an enemy unit has shot", "event", { kind: "enemy-has-shot" }],
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], named: "after", container: "none", destroyer: "event-subject", negated: false }],
      ["a friendly DARK ANGELS unit", "unit-filter", { side: "friendly", keywords: ["DARK ANGELS"] }],
      ["within 6\" of the battlefield edge", "unit-position", { kind: "within", inches: 6, of: "battlefield-edge", subject: "antecedent", negated: false }],
      FNP_PART,
    ]))).toMatch(/unit-ref role/);
  });
});

describe("destroyed by the triggering attacks: models", () => {
  it("names the enemy Character models after the verb, negated when the leaf is", () => {
    const parts = (negated: boolean): Part[] => [
      MOMENT,
      ["those attacks destroyed", "unit-activity", { activities: [MODELS], named: "after", container: "none", destroyer: "this-unit", negated }],
      ["an enemy CHARACTER model", "unit-filter", { side: "enemy", keywords: ["CHARACTER"], level: "model" }],
      FNP_PART,
    ];
    const positive = compiled(placed("After this unit has resolved its attacks, if those attacks destroyed an enemy CHARACTER model, this unit has the Feel No Pain 6+ ability.", parts(false)));
    expect(destroyedNodes(positive).map((node) => node.parameters)).toEqual([
      { event: "model-destroyed", object: { owner: "enemy", all_of: ["CHARACTER"], level: "model" }, filter: { by: "this-unit" }, window: "event" },
    ]);
    const negative = compiled(placed("After this unit has resolved its attacks, if those attacks destroyed an enemy CHARACTER model, this unit has the Feel No Pain 6+ ability.", parts(true)));
    const happened = { type: "happened", parameters: { event: "model-destroyed", object: { owner: "enemy", all_of: ["CHARACTER"], level: "model" }, filter: { by: "this-unit" }, window: "event" } };
    expect(nodes(negative, (node) => node.operator === "not").map((node) => node.operands)).toEqual([[happened]]);
    expect(nodes(positive, (node) => node.operator === "not")).toEqual([]);
  });

  it("negates the destruction of an enemy model with a not wrapping that happened node alone (8370 shape)", () => {
    const mechanics = compiled(placed("When this unit has fought, if those attacks did not destroy an enemy model, this unit has the Feel No Pain 6+ ability.", [
      ["When this unit has fought", "event", { kind: "attacks-resolved" }],
      ["those attacks did not destroy", "unit-activity", { activities: [MODELS], named: "after", container: "none", destroyer: "this-unit", negated: true }],
      ["an enemy model", "unit-filter", { side: "enemy", level: "model" }],
      FNP_PART,
    ]));
    expect(nodes(mechanics, (node) => node.operator === "not").map((node) => node.operands)).toEqual([[
      { type: "happened", parameters: { event: "model-destroyed", object: { owner: "enemy", level: "model" }, filter: { by: "this-unit" }, window: "event" } },
    ]]);
    expect(schemaErrors(mechanics)).toEqual([]);
  });

  it("reads the enemy models before the verb by the attacks of the triggering moment", () => {
    const mechanics = compiled(placed("After this unit has resolved its attacks, if one or more enemy models were destroyed by those attacks, this unit has the Feel No Pain 6+ ability.", [
      MOMENT,
      ["enemy models", "unit-filter", { side: "enemy", level: "model" }],
      ["were destroyed by those attacks", "unit-activity", { activities: [MODELS], named: "before", container: "none", destroyer: "this-unit", negated: false }],
      FNP_PART,
    ]));
    expect(destroyedNodes(mechanics).map((node) => node.parameters)).toEqual([
      { event: "model-destroyed", object: { owner: "enemy", level: "model" }, filter: { by: "this-unit" }, window: "event" },
    ]);
  });

  it("names a destroyed model by the unit it was in, not by the model itself", () => {
    const mechanics = compiled(placed("When an enemy unit has shot, if those attacks destroyed a model in a friendly ADEPTUS ASTARTES unit, this unit has the Feel No Pain 6+ ability.", [
      ["When an enemy unit has shot", "event", { kind: "enemy-has-shot" }],
      ["those attacks destroyed a model", "unit-activity", { activities: [MODELS], named: "none", container: "after", destroyer: "event-subject", negated: false }],
      ["in a friendly ADEPTUS ASTARTES unit", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES"] }],
      FNP_PART,
    ]));
    const [node] = destroyedNodes(mechanics).map((item) => item.parameters as Record<string, unknown>);
    expect(node).toEqual({ event: "model-destroyed", object: { level: "model", member_of: { owner: "friendly", all_of: ["ADEPTUS ASTARTES"] } }, filter: { by: "event-subject" }, window: "event" });
    expect(schemaErrors(mechanics)).toEqual([]);
  });

  it("refuses a destroyed model with neither its own filter nor a container", () => {
    expect(refusal(placed("After this unit has resolved its attacks, if those attacks destroyed a model, this unit has the Feel No Pain 6+ ability.", [
      MOMENT,
      ["those attacks destroyed a model", "unit-activity", { activities: [MODELS], named: "none", container: "none", destroyer: "this-unit", negated: false }],
      FNP_PART,
    ]))).toMatch(/destroyed model names a unit-filter/);
  });

  it("refuses a destroyed model named both by its own filter and its unit", () => {
    expect(refusal(placed("When an enemy unit has shot, if those attacks destroyed an enemy model in a friendly ADEPTUS ASTARTES unit, this unit has the Feel No Pain 6+ ability.", [
      ["When an enemy unit has shot", "event", { kind: "enemy-has-shot" }],
      ["those attacks destroyed", "unit-activity", { activities: [MODELS], named: "after", container: "after", destroyer: "event-subject", negated: false }],
      ["an enemy model", "unit-filter", { side: "enemy", level: "model" }],
      ["in a friendly ADEPTUS ASTARTES unit", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES"] }],
      FNP_PART,
    ]))).toMatch(/one unit-filter/);
  });

  it("refuses a unit-position after a destroyed model in a container", () => {
    expect(refusal(placed("When an enemy unit has shot, if those attacks destroyed a model in a friendly ADEPTUS ASTARTES unit within 6\" of this unit, this unit has the Feel No Pain 6+ ability.", [
      ["When an enemy unit has shot", "event", { kind: "enemy-has-shot" }],
      ["those attacks destroyed a model", "unit-activity", { activities: [MODELS], named: "none", container: "after", destroyer: "event-subject", negated: false }],
      ["in a friendly ADEPTUS ASTARTES unit", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES"] }],
      ["within 6\" of this unit", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false }],
      FNP_PART,
    ]))).toMatch(/distance after a destroyed model/);
  });
});

describe("destroyed by the triggering attacks: moments and destroyers", () => {
  it("refuses a destruction after a selection, which names no attacks", () => {
    expect(refusal(placed("After this unit has been selected to shoot, if those attacks destroyed an enemy unit, this unit has the Feel No Pain 6+ ability.", [
      ["After this unit has been selected to shoot", "event", { kind: "selected", to: "shoot" }],
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], named: "after", container: "none", destroyer: "this-unit", negated: false }],
      ["an enemy unit", "unit-filter", { side: "enemy" }],
      FNP_PART,
    ]))).toMatch(/needs a moment/);
  });

  it("refuses a Stratagem destroyer when no Stratagem target is named", () => {
    expect(refusal(placed("After this unit has resolved its attacks, if those attacks destroyed an enemy unit, this unit has the Feel No Pain 6+ ability.", [
      MOMENT,
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], named: "after", container: "none", destroyer: "stratagem-target", negated: false }],
      ["an enemy unit", "unit-filter", { side: "enemy" }],
      FNP_PART,
    ]))).toMatch(/needs a moment/);
  });

  it("reads the Stratagem target as the destroyer of a fragment's attacks", () => {
    const mechanics = compiled(placed("Select one unit, a friendly unit. After your unit has fought, if one or more enemy CHARACTER models were destroyed as a result of those attacks, this unit has the Feel No Pain 6+ ability.", [
      ["Select one unit", "stratagem-target", { count: "one" }, "TARGET"],
      ["a friendly unit", "unit-filter", { side: "friendly" }, "TARGET"],
      ["After your unit has fought", "event", { kind: "attacks-resolved" }, "EFFECT"],
      ["enemy CHARACTER models", "unit-filter", { side: "enemy", keywords: ["CHARACTER"], level: "model" }, "EFFECT"],
      ["were destroyed as a result of those attacks", "unit-activity", { activities: [MODELS], named: "before", container: "none", destroyer: "stratagem-target", negated: false }, "EFFECT"],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP, "EFFECT"],
    ]));
    expect(destroyedNodes(mechanics).map((node) => (node.parameters as Record<string, unknown>).filter)).toEqual([{ by: "stratagem-target" }]);
  });
});

describe("destroyed by the triggering attacks: no moment", () => {
  it("refuses a destruction with no attacks-resolved, enemy-has-shot, attack or Stratagem moment in the list", () => {
    expect(refusal(placed("If those attacks destroyed an enemy unit, this unit has the Feel No Pain 6+ ability.", [
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], named: "after", container: "none", destroyer: "this-unit", negated: false }],
      ["an enemy unit", "unit-filter", { side: "enemy" }],
      FNP_PART,
    ]))).toMatch(/needs a moment/);
  });
});

describe("destroyed by the triggering attacks: leaf checks", () => {
  it("refuses a subject on a destruction activity", () => {
    expect(() => placed("After this unit has resolved its attacks, if those attacks destroyed an enemy unit.", [
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], subject: "this-unit", named: "after", container: "none", destroyer: "this-unit", negated: false }],
    ])).toThrow(/take no subject/);
  });

  it("refuses a destruction activity without a destroyer", () => {
    expect(() => placed("if those attacks destroyed an enemy unit.", [
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], named: "after", container: "none", negated: false }],
    ])).toThrow(/needs destroyer/);
  });

  it("refuses a destruction activity beside an older activity; a leaf may name a destroyed unit or a destroyed model (T7)", () => {
    // Both destruction activities on one leaf are the destroyed unit or model of one verb (unit-activity@19).
    expect(() => placed("if those attacks destroyed an enemy unit.", [
      ["those attacks destroyed", "unit-activity", { activities: [UNITS, MODELS], named: "after", container: "none", destroyer: "this-unit", negated: false }],
    ])).not.toThrow();
    expect(() => placed("if those attacks destroyed an enemy unit.", [
      ["those attacks destroyed", "unit-activity", { activities: [UNITS, "fought-this-phase"], named: "after", container: "none", destroyer: "this-unit", negated: false }],
    ])).toThrow(/one destruction activity per leaf/);
  });

  it("keeps the older unit-activity leaves as they were", () => {
    const mechanics = compiled(placed("If this unit had models destroyed by those attacks, this unit has the Feel No Pain 6+ ability.", [
      ["this unit had models destroyed by those attacks", "unit-activity", { activities: ["lost-models-to-triggering-attacks"], subject: "this-unit", negated: false }],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    expect(nodes(mechanics, (node) => node.type === "happened")[0]!.parameters).toEqual({ event: "model-destroyed", object: "model-in-this-unit", filter: { by: "event-subject" }, window: "event" });
  });

  it("finds no container from a unit-filter alone, without the destruction activity", () => {
    const mechanics = JSON.stringify(compiled(placed("When an enemy unit has shot, if a friendly ADEPTUS ASTARTES unit is within 6\" of this unit, this unit has the Feel No Pain 6+ ability.", [
      ["When an enemy unit has shot", "event", { kind: "enemy-has-shot" }],
      ["a friendly ADEPTUS ASTARTES unit", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES"] }],
      ["is within 6\" of this unit", "aura-range", { inches: 6, of: "this-unit" }],
      FNP_PART,
    ])));
    expect(mechanics).not.toMatch(/member_of|model-destroyed/u);
  });
});

describe("destroyed by the triggering attacks: paired halves", () => {
  it("joins the two halves of 'an enemy unit or an enemy model' as an or, not an and", () => {
    const mechanics = compiled(placed("When a friendly KILLER unit has attacked, if those attacks destroyed an enemy unit or those attacks destroyed an enemy CHARACTER model, this unit has the Feel No Pain 6+ ability.", [
      ["When a friendly KILLER unit has attacked", "event", { kind: "attacks-resolved" }],
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], named: "after", container: "none", destroyer: "event-subject", negated: false }],
      ["an enemy unit", "unit-filter", { side: "enemy" }],
      ["those attacks destroyed", "unit-activity", { activities: [MODELS], named: "after", container: "none", destroyer: "event-subject", negated: false }],
      ["an enemy CHARACTER model", "unit-filter", { side: "enemy", keywords: ["CHARACTER"], level: "model" }],
      FNP_PART,
    ]));
    const halves = [
      { type: "happened", parameters: { event: "destroyed", object: { owner: "enemy" }, filter: { by: "event-subject" }, window: "event" } },
      { type: "happened", parameters: { event: "model-destroyed", object: { owner: "enemy", all_of: ["CHARACTER"], level: "model" }, filter: { by: "event-subject" }, window: "event" } },
    ];
    expect(nodes(mechanics, (node) => node.operator === "or").map((node) => node.operands)).toEqual([halves]);
    expect(nodes(mechanics, (node) => node.operator === "and")).toEqual([]);
  });

  it("joins the halves with and when the source joins them with and", () => {
    const mechanics = compiled(placed("When a friendly KILLER unit has attacked, if those attacks destroyed an enemy unit and those attacks destroyed an enemy CHARACTER model, this unit has the Feel No Pain 6+ ability.", [
      ["When a friendly KILLER unit has attacked", "event", { kind: "attacks-resolved" }],
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], named: "after", container: "none", destroyer: "event-subject", negated: false }],
      ["an enemy unit", "unit-filter", { side: "enemy" }],
      ["those attacks destroyed", "unit-activity", { activities: [MODELS], named: "after", container: "none", destroyer: "event-subject", negated: false }],
      ["an enemy CHARACTER model", "unit-filter", { side: "enemy", keywords: ["CHARACTER"], level: "model" }],
      FNP_PART,
    ]));
    expect(nodes(mechanics, (node) => node.operator === "or")).toEqual([]);
    expect(nodes(mechanics, (node) => node.operator === "and").length).toBe(1);
  });

  it("refuses the halves when the unit-filter sits in another fragment", () => {
    expect(refusal(placed("When a friendly KILLER unit has attacked, if those attacks destroyed an enemy unit, this unit has the Feel No Pain 6+ ability.", [
      ["When a friendly KILLER unit has attacked", "event", { kind: "attacks-resolved" }],
      ["those attacks destroyed", "unit-activity", { activities: [UNITS], named: "after", container: "none", destroyer: "event-subject", negated: false }, "A"],
      ["an enemy unit", "unit-filter", { side: "enemy" }, "B"],
      FNP_PART,
    ]))).toMatch(/names no unit-filter after/);
  });
});

describe("destroyed by the triggering attacks: later antecedents", () => {
  // 10148 shape: the container filter sits right before the effect's "that unit" antecedent. The
  // antecedent must bind to that filter whether or not the destruction activity sits between them.
  const ANCESTOR = "When an enemy unit has shot, ";
  const effectText = "that unit has the Feel No Pain 6+ ability.";
  const text = `${ANCESTOR}if those attacks destroyed a model in a friendly ADEPTUS ASTARTES unit, ${effectText}`;
  const EFFECT: Part = ["that unit has the Feel No Pain 6+ ability", "feel-no-pain", { subject: "antecedent", threshold: 6, against: "all" }];
  const EVENT: Part = ["When an enemy unit has shot", "event", { kind: "enemy-has-shot" }];
  const CONTAINER: Part = ["in a friendly ADEPTUS ASTARTES unit", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES"] }];
  const ACTIVITY: Part = ["those attacks destroyed a model", "unit-activity", { activities: [MODELS], named: "none", container: "after", destroyer: "event-subject", negated: false }];

  it("binds the later antecedent to the container filter with and without the destruction activity", () => {
    const withActivity = compiled(placed(text, [EVENT, ACTIVITY, CONTAINER, EFFECT]));
    const withoutActivity = compiled(placed(text, [EVENT, CONTAINER, EFFECT]));
    const effectOf = (mechanics: unknown) => nodes(mechanics, (node) => node.type === "feel-no-pain");
    expect(effectOf(withActivity)).toEqual(effectOf(withoutActivity));
    expect(effectOf(withActivity).length).toBe(1);
    expect(JSON.stringify(effectOf(withActivity))).not.toMatch(/"this-unit"/u);
  });

  it("names the container in the destroyed-model object and leaves the effect's antecedent intact", () => {
    const mechanics = compiled(placed(text, [EVENT, ACTIVITY, CONTAINER, EFFECT]));
    expect(destroyedNodes(mechanics).map((node) => node.parameters)).toEqual([
      { event: "model-destroyed", object: { level: "model", member_of: { owner: "friendly", all_of: ["ADEPTUS ASTARTES"] } }, filter: { by: "event-subject" }, window: "event" },
    ]);
  });

  it("keeps the enemy filter of a condition apart from an effect's own enemy filter", () => {
    const fiveSeven = "After this unit has resolved its attacks, if one or more enemy units were destroyed by those attacks, each enemy unit within 6\" of this model has the Feel No Pain 6+ ability.";
    const mechanics = compiled(placed(fiveSeven, [
      MOMENT,
      ["enemy units", "unit-filter", { side: "enemy" }],
      ["were destroyed by those attacks", "unit-activity", { activities: [UNITS], named: "before", container: "none", destroyer: "this-unit", negated: false }],
      ["each enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    expect(destroyedNodes(mechanics).map((node) => (node.parameters as Record<string, unknown>).object)).toEqual([{ owner: "enemy" }]);
  });
});

describe("destroyed by the triggering attacks: any-owner models (8121 shape)", () => {
  it("names destroyed Character models of any owner with no owner key on the object", () => {
    const mechanics = compiled(placed("After the bearer's unit has fought, if one or more CHARACTER models were destroyed as a result of those attacks, this unit has the Feel No Pain 6+ ability.", [
      ["After the bearer's unit has fought", "event", { kind: "attacks-resolved" }],
      ["CHARACTER models", "unit-filter", { side: "any", keywords: ["CHARACTER"], level: "model" }],
      ["were destroyed as a result of those attacks", "unit-activity", { activities: [MODELS], named: "before", container: "none", destroyer: "this-unit", negated: false }],
      FNP_PART,
    ]));
    expect(destroyedNodes(mechanics).map((node) => node.parameters)).toEqual([
      { event: "model-destroyed", object: { level: "model", all_of: ["CHARACTER"] }, filter: { by: "this-unit" }, window: "event" },
    ]);
    expect(schemaErrors(mechanics)).toEqual([]);
  });
});
