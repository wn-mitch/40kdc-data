import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/round5c/compile.js";
import type { CompileLeaf } from "../src/round5c/compile-fragments.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

// Fabricated wording and records only; no GW rule prose.

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

/** Leaves placed on a fabricated source text, each at its own wording, in an optional fragment. */
function placed(text: string, parts: Array<[string, string, Record<string, unknown>, string?]>): { leaves: CompileLeaf[]; text: string } {
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

/** A real authored entry, so a compiled body is checked against the full DSL schema. */
function authored(faction: string, abilityId: string): Record<string, unknown> {
  const enrichment = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
  return (JSON.parse(readFileSync(join(enrichment, faction, "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
    .find((item) => item.ability_id === abilityId)!;
}
const schemaErrors = (mechanics: unknown) => checkEntry(entryWithMechanics(authored("world-eaters", "blessings-of-khorne-world-eaters"), mechanics as never)).errors;

const FNP = (threshold: number) => ({ subject: "this-unit", threshold, against: "all" });

describe("battle-size table rows", () => {
  it("gates each row's effect by its own size, never all sizes at once", () => {
    const mechanics = compiled(placed("In an Incursion battle, this unit has the Feel No Pain 6+ ability. In an Onslaught battle, this unit has the Feel No Pain 5+ ability.", [
      ["In an Incursion battle", "battle-size", { size: "incursion" }],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP(6)],
      ["In an Onslaught battle", "battle-size", { size: "onslaught" }],
      ["this unit has the Feel No Pain 5+ ability", "feel-no-pain", FNP(5)],
    ]));
    // No condition anywhere requires two battle sizes together.
    const both = nodes(mechanics, (node) => node.operator === "and" && nodes(node.operands, (inner) => inner.type === "battle-size").length > 1);
    expect(both).toEqual([]);
    const gated = nodes(mechanics, (node) => node.type === "conditional");
    expect(gated.map((node) => [(node.condition as { parameters: { size: string } }).parameters.size, ((node.effect as { modifier: { threshold: number } }).modifier.threshold)]))
      .toEqual([["incursion", 6], ["onslaught", 5]]);
  });

  it("folds a row into the count-by-battle-size its sentence holds", () => {
    const mechanics = compiled(placed("Select up to 1 unit from your army in an Incursion battle. In an Incursion battle, you can select up to 1 unit. In an Onslaught battle, you can select up to 3 units. Those units have the Feel No Pain 6+ ability.", [
      ["Select up to 1 unit", "select-unit", { scope: "friendly", distance: "any", visible: false }],
      ["In an Incursion battle", "battle-size", { size: "incursion" }],
      ["select up to 1 unit", "count-by-battle-size", { incursion: 1, "strike-force": 2, onslaught: 3 }],
      ["In an Onslaught battle", "battle-size", { size: "onslaught" }],
      ["select up to 3 units", "count-by-battle-size", { incursion: 1, "strike-force": 2, onslaught: 3 }],
      ["Those units have the Feel No Pain 6+ ability", "feel-no-pain", FNP(6)],
    ]));
    expect(nodes(mechanics, (node) => node.type === "battle-size")).toEqual([]);
  });

  it("refuses a heading row that decides nothing in its sentence", () => {
    expect(refusal(placed("Incursion. Onslaught. This unit has the Feel No Pain 6+ ability.", [
      ["Incursion", "battle-size", { size: "incursion" }],
      ["Onslaught", "battle-size", { size: "onslaught" }],
      ["This unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP(6)],
    ]))).toMatch(/no effect or count in its sentence/u);
  });
});

describe("a permission that acts as if it were another phase", () => {
  const permission = { subject: "this-unit", activity: "shoot", allow: true };
  it("folds a hypothetical Shooting phase into the permission's as_if, not a phase gate", () => {
    const mechanics = compiled(placed("Your unit can shoot as if it were your Shooting phase.", [
      ["Your unit can shoot", "eligibility-permission", permission],
      ["as if it were your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ]));
    expect(nodes(mechanics, (node) => node.type === "phase-is")).toEqual([]);
    expect(nodes(mechanics, (node) => node.type === "permission")[0]!.modifier).toMatchObject({ as_if: "shooting-phase" });
  });

  it("refuses a hypothetical phase the DSL's as_if cannot name, instead of gating on that phase", () => {
    expect(refusal(placed("Your unit can declare a charge as if it were your Charge phase.", [
      ["Your unit can declare a charge", "eligibility-permission", { ...permission, activity: "declare-charge" }],
      ["as if it were your Charge phase", "phase-window", { phase: "charge", turn: "your" }],
    ]))).toMatch(/DSL_GAP.*charge phase/u);
  });

  it("refuses a hypothetical phase with no permission before it in its sentence", () => {
    expect(refusal(placed("Your unit can shoot. Then, as if it were your Shooting phase, it gains the Feel No Pain 6+ ability.", [
      ["Your unit can shoot", "eligibility-permission", permission],
      ["as if it were your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["it gains the Feel No Pain 6+ ability", "feel-no-pain", FNP(6)],
    ]))).toMatch(/no permission before it in its sentence/u);
  });

  it("still lowers a real phase window as a gate", () => {
    const mechanics = compiled(placed("In your Shooting phase, this unit has the Feel No Pain 6+ ability.", [
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP(6)],
    ]));
    expect(nodes(mechanics, (node) => node.type === "phase-is")).toHaveLength(1);
  });
});

describe("compositions that name a unit", () => {
  it("names the unit an enemy targets with a unit-filter after the targeting moment", () => {
    const mechanics = compiled(placed("Just after an enemy unit selects targets for an ADEPTUS ASTARTES unit, that unit has the Feel No Pain 5+ ability.", [
      ["Just after an enemy unit selects targets for an", "event", { kind: "enemy-selected-targets" }],
      ["ADEPTUS ASTARTES unit", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES"] }],
      ["that unit has the Feel No Pain 5+ ability", "feel-no-pain", FNP(5)],
    ]));
    expect(mechanics.trigger).toMatchObject({ event: "targets-selected", object: { owner: "friendly", all_of: ["ADEPTUS ASTARTES"] } });
  });

  it("narrows the targeted unit, not the enemy that targets it, by a Stratagem's \"That X unit\"", () => {
    const mechanics = compiled(placed("Just after an enemy unit selects targets for a friendly ADEPTUS ASTARTES unit. That ADEPTUS ASTARTES unit. Your unit has the Feel No Pain 5+ ability.", [
      ["Just after an enemy unit selects targets for a", "event", { kind: "enemy-selected-targets" }, "WHEN"],
      ["friendly ADEPTUS ASTARTES unit", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES"] }, "WHEN"],
      ["That ADEPTUS ASTARTES unit", "triggering-target", { selects: "unit", keywords: ["ADEPTUS ASTARTES"], match: "all" }, "TARGET"],
      ["Your unit has the Feel No Pain 5+ ability", "feel-no-pain", FNP(5), "EFFECT"],
    ]));
    expect(mechanics.trigger).toMatchObject({ subject: { owner: "enemy" }, object: { owner: "friendly", all_of: ["ADEPTUS ASTARTES"] } });
    expect((mechanics.trigger as { subject: Record<string, unknown> }).subject.all_of).toBeUndefined();
  });

  it("gives an effect to the units a unit-filter after it names (\"of K models from your army\")", () => {
    const mechanics = compiled(placed("Add 1 to the Strength characteristic of ADEPTUS ASTARTES models from your army.", [
      ["Add 1 to the Strength characteristic of", "characteristic-modifier", { subject: "antecedent", characteristics: ["S"], operation: "add", value: 1, weapon_type: "all" }],
      ["ADEPTUS ASTARTES models", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
    ]));
    const stat = nodes(mechanics, (node) => node.type === "stat-modifier")[0]!;
    expect(stat.target).toMatchObject({ owner: "friendly", all_of: ["ADEPTUS ASTARTES"] });
    expect(stat.target).not.toBe("this-unit");
  });

  it("leaves a filter to the back-referring effect after it, not the effect before it", () => {
    const mechanics = compiled(placed("This unit has the Feel No Pain 6+ ability. ADEPTUS ASTARTES units from your army have the Feel No Pain 5+ ability.", [
      ["This unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP(6)],
      ["ADEPTUS ASTARTES units", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES"] }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["have the Feel No Pain 5+ ability", "feel-no-pain", { ...FNP(5), subject: "antecedent" }],
    ]));
    const saves = nodes(mechanics, (node) => node.type === "feel-no-pain");
    expect(saves.map((node) => [node.target, (node.modifier as { threshold: number }).threshold])).toEqual([["this-unit", 6], [expect.objectContaining({ all_of: ["ADEPTUS ASTARTES"] }), 5]]);
  });

  it("gives mortal wounds to the unit whose action fired the trigger", () => {
    const mechanics = compiled(placed("Each time an enemy unit ends a Normal move, that unit suffers D3 mortal wounds.", [
      ["Each time an enemy unit ends a Normal move", "event", { kind: "move-ended", owner: "enemy", move_types: ["normal"] }],
      ["that unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "event-subject", count: "D3" }],
    ]));
    expect(nodes(mechanics, (node) => node.type === "mortal-wounds")[0]).toMatchObject({ target: "event-subject" });
    expect(schemaErrors(mechanics)).toEqual([]);
  });
});

describe("menus and their targets", () => {
  const menu = (grant: boolean) => placed(`Select one of the following abilities.${grant ? " This model has that ability." : ""} Swift: this unit has the Feel No Pain 6+ ability. Stern: this unit has the Feel No Pain 5+ ability.`, [
    ["Select one of the following abilities", "choice-open", { min_choices: 1, max_choices: 1 }],
    ...(grant ? [["This model has that ability", "chosen-option-grant", { holder: "this-model" }] as [string, string, Record<string, unknown>]] : []),
    ["Swift", "named-option", { label: "Swift" }],
    ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP(6)],
    ["Stern", "named-option", { label: "Stern" }],
    ["this unit has the Feel No Pain 5+ ability", "feel-no-pain", FNP(5)],
  ]);

  it("folds \"this model has that ability\" into the menu before it, which already applies the chosen option", () => {
    expect(compiled(menu(true))).toEqual(compiled(menu(false)));
  });

  it("refuses a chosen-option grant with no menu before it", () => {
    expect(refusal(placed("This model has that ability. This unit has the Feel No Pain 6+ ability.", [
      ["This model has that ability", "chosen-option-grant", { holder: "this-model" }],
      ["This unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP(6)],
    ]))).toMatch(/no menu opens before it/u);
  });

  it("refuses a second Stratagem target, naming the missing effect binding", () => {
    expect(refusal(placed("One ADEPTUS ASTARTES unit and one ADEPTUS ASTARTES unit. Your unit has the Feel No Pain 5+ ability.", [
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ADEPTUS ASTARTES unit", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES"] }, "TARGET"],
      ["one", "stratagem-target", { count: "one" }, "TARGET"],
      ["ADEPTUS ASTARTES unit", "unit-filter", { side: "friendly", keywords: ["ADEPTUS ASTARTES"] }, "TARGET"],
      ["Your unit has the Feel No Pain 5+ ability", "feel-no-pain", FNP(5), "EFFECT"],
    ]))).toMatch(/names 2 targets; no effect leaf can yet say which target/u);
  });
});
