import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/round5c/compile.js";
import { targetRestrictions } from "../src/round5c/compile-conditions.js";
import type { CompileLeaf } from "../src/round5c/compile-fragments.js";
import { dslUnitFilter } from "../src/round5c/compile-unit-filters.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { coreCheckErrors } from "../src/round5c/core-checks.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

// Fabricated wording and records only; no GW rule prose.

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

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
function isHasAbilityMatch(node: Record<string, unknown>): boolean {
  if (node.type !== "matches" || typeof node.parameters !== "object" || node.parameters === null || Array.isArray(node.parameters)) return false;
  const filter = (node.parameters as Record<string, unknown>).filter;
  return typeof filter === "object" && filter !== null && !Array.isArray(filter)
    && Array.isArray((filter as Record<string, unknown>).has_ability);
}

function authored(faction: string, abilityId: string): Record<string, unknown> {
  const enrichment = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
  return (JSON.parse(readFileSync(join(enrichment, faction, "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
    .find((item) => item.ability_id === abilityId)!;
}
const schemaErrors = (mechanics: unknown) => checkEntry(entryWithMechanics(authored("world-eaters", "blessings-of-khorne-world-eaters"), mechanics as never)).errors;

const FNP = { subject: "this-unit", threshold: 6, against: "all" };

describe("characteristic scaling", () => {
  it("halves without a value and multiplies by a factor, as the DSL stat-modifier does", () => {
    const halved = compiled(placed("This unit halves its Objective Control characteristic.", [["halves its Objective Control characteristic", "characteristic-modifier", { subject: "this-unit", characteristics: ["OC"], operation: "halve" }]]));
    expect(nodes(halved, (node) => node.type === "stat-modifier")[0]!.modifier).toEqual({ stat: "OC", operation: "halve" });
    expect(schemaErrors(halved)).toEqual([]);
    const tripled = compiled(placed("This unit triples its Move characteristic.", [["triples its Move characteristic", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "multiply", value: 3 }]]));
    expect(nodes(tripled, (node) => node.type === "stat-modifier")[0]!.modifier).toEqual({ stat: "M", operation: "multiply", value: 3 });
  });

  it("refuses a halve with a value and a factor outside 2 to 4", () => {
    expect(() => normalize("characteristic-modifier", { subject: "this-unit", characteristics: ["OC"], operation: "halve", value: 2 })).toThrow(/no value/u);
    expect(() => normalize("characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "multiply", value: 5 })).toThrow(/2 to 4/u);
  });
});

describe("battlefield edges", () => {
  it("measures wholly within a distance of a battlefield edge", () => {
    const mechanics = compiled(placed("While this unit is wholly within 6\" of a battlefield edge, this unit has the Feel No Pain 6+ ability.", [
      ["this unit is wholly within 6\" of a battlefield edge", "unit-position", { kind: "within", inches: 6, of: "battlefield-edge", subject: "this-unit", negated: false, wholly: true }],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    expect(nodes(mechanics, (node) => node.type === "matches" && (node.parameters as Record<string, any> | undefined)?.filter?.within !== undefined)[0]!.parameters)
      .toEqual({ filter: { within: { of: "battlefield-edge", range: { inches: 6 }, wholly: true } } });
  });
});

describe("unit history", () => {
  it("names the destroyer as filter.by and the destroyed units as the object", () => {
    const mechanics = compiled(placed("If this unit destroyed one or more enemy units this phase, this unit has the Feel No Pain 6+ ability.", [
      ["this unit destroyed one or more enemy units this phase", "unit-activity", { activities: ["destroyed-enemy-unit-this-phase"], subject: "this-unit", negated: false }],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    // Not "this unit was destroyed": the subject did the destroying.
    expect(nodes(mechanics, (node) => node.type === "happened")[0]!.parameters).toEqual({ event: "destroyed", object: { owner: "enemy" }, filter: { by: "this-unit" }, window: "phase" });
    expect(schemaErrors(mechanics)).toEqual([]);
  });

  it("records a Deep Strike arrival and models lost to the triggering attacks", () => {
    const arrived = compiled(placed("If this unit was set up using Deep Strike this turn, this unit has the Feel No Pain 6+ ability.", [
      ["this unit was set up using Deep Strike this turn", "unit-activity", { activities: ["set-up-by-deep-strike-this-turn"], subject: "this-unit", negated: false }],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    expect(nodes(arrived, (node) => node.type === "happened")[0]!.parameters).toEqual({ event: "set-up", filter: { from: "deep-strike" }, window: "turn" });
    const lost = compiled(placed("If this unit had models destroyed by those attacks, this unit has the Feel No Pain 6+ ability.", [
      ["this unit had models destroyed by those attacks", "unit-activity", { activities: ["lost-models-to-triggering-attacks"], subject: "this-unit", negated: false }],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    expect(nodes(lost, (node) => node.type === "happened")[0]!.parameters).toEqual({ event: "model-destroyed", object: "model-in-this-unit", filter: { by: "event-subject" }, window: "event" });
    expect(schemaErrors(lost)).toEqual([]);
  });
});

describe("transport occupancy", () => {
  it("reads no models embarked as no unit embarked within the subject", () => {
    const mechanics = compiled(placed("While there are no models embarked within this unit, this unit has the Feel No Pain 6+ ability.", [
      ["there are no models embarked within this unit", "unit-state", { states: ["carrying-units"], subject: "this-unit", negated: true }],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    const state = nodes(mechanics, (node) => node.type === "matches" && typeof node.parameters === "object" && node.parameters !== null && !Array.isArray(node.parameters)
      && (node.parameters as Record<string, unknown>).subject !== undefined
      && typeof (node.parameters as Record<string, unknown>).filter === "object"
      && (node.parameters as Record<string, unknown>).filter !== null
      && ((node.parameters as Record<string, unknown>).filter as Record<string, unknown>).state === "embarked")[0]!;
    expect(state.parameters).toEqual({ subject: { embarked_in: "this-unit" }, filter: { state: "embarked" } });
    expect(nodes(mechanics, (node) => node.operator === "not" && nodes(node.operands, (inner) => inner === state).length > 0)).toHaveLength(1);
    expect(schemaErrors(mechanics)).toEqual([]);
    expect(() => normalize("unit-state", { states: ["carrying-units", "engaged"], subject: "this-unit", negated: false })).toThrow(/other states/u);
  });
});

describe("triggering-target keyword prefix", () => {
  it("requires every prefix keyword and any one of the slash list", () => {
    const parameters = normalize("triggering-target", { selects: "unit", keywords: ["ADEPTUS ASTARTES"], match: "all", any_keywords: ["INFANTRY", "MOUNTED"] });
    const leaf = { role: "RESTRICTION", family_id: "triggering-target", family_version: currentFamilyVersion("triggering-target"), start_byte: 0, end_byte: 1, parameters } as CompileLeaf;
    const restrictions = targetRestrictions([leaf], [])!;
    expect(restrictions.required_keywords).toEqual(["ADEPTUS ASTARTES"]);
    expect(restrictions.eligibility).toEqual({ type: "matches", parameters: { filter: { any_of: ["INFANTRY", "MOUNTED"] } } });
    expect(() => normalize("triggering-target", { selects: "unit", keywords: ["ADEPTUS ASTARTES"], match: "any", any_keywords: ["INFANTRY", "MOUNTED"] })).toThrow(/match must be all/u);
  });
});

describe("weapon ability for the attack being made", () => {
  it("grants the ability to the attacking unit's weapon", () => {
    const mechanics = compiled(placed("Each time a model in this unit makes an attack, that attack has the [LETHAL HITS] ability.", [
      ["Each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["that attack has the [LETHAL HITS] ability", "weapon-ability-grant", { subject: "attack", keyword: "Lethal Hits", weapon_type: "all" }],
    ]));
    expect(nodes(mechanics, (node) => node.type === "weapon-ability-grant")[0]).toMatchObject({ target: "this-unit", modifier: { keywords: [{ keyword_id: "lethal-hits" }] } });
  });
});

describe("ability exclusions", () => {
  it("retains ability exclusions in a selection's canonical unit filter", () => {
    const filter = { role: "CONDITION", family_id: "unit-filter", family_version: currentFamilyVersion("unit-filter"), start_byte: 0, end_byte: 1,
      parameters: normalize("unit-filter", { side: "enemy", excluded_abilities: ["lone-operative"] }) } as CompileLeaf;
    expect(dslUnitFilter(filter)).toEqual({ owner: "enemy", lacks_ability: ["lone-operative"] });
    const mechanics = compiled(placed("Select one enemy unit (excluding units with the Lone Operative ability). That unit has the Feel No Pain 6+ ability.", [
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["excluding units with the Lone Operative ability", "unit-filter", { side: "enemy", excluded_abilities: ["lone-operative"] }],
      ["That unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    const selector = nodes(mechanics, (node) => node.type === "select-units")[0]!.selector as Record<string, any>;
    expect(selector.filter).toMatchObject({ lacks_ability: ["lone-operative"] });
    expect(nodes(mechanics, isHasAbilityMatch)).toEqual([]);
    expect(schemaErrors(mechanics)).toEqual([]);
    // A stacked visible filter merges with it and keeps the exclusion rather than dropping it.
    const merged = compiled(placed("Select one visible enemy unit (excluding units with the Lone Operative ability). That unit has the Feel No Pain 6+ ability.", [
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["visible enemy unit", "unit-filter", { side: "enemy", visible: true }],
      ["excluding units with the Lone Operative ability", "unit-filter", { side: "enemy", excluded_abilities: ["lone-operative"] }],
      ["That unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    expect(nodes(merged, (node) => node.type === "select-units")[0]!.selector)
      .toMatchObject({ filter: { owner: "enemy", lacks_ability: ["lone-operative"], visible: { to: "this-model" } } });
  });
});

describe("Deadly Demise rolls", () => {
  it("names a moment before or after a Deadly Demise roll with the DSL's deadly-demise roll", () => {
    const text = "Each time you roll for this model's Deadly Demise ability, this unit has the Feel No Pain 6+ ability.";
    for (const kind of ["before-roll", "after-roll"]) {
      const mechanics = compiled(placed(text, [
        ["Each time you roll for this model's Deadly Demise ability", "event", { kind, roll: "deadly-demise" }],
        ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
      ]));
      expect(mechanics.trigger).toMatchObject({ event: kind, filter: { roll: "deadly-demise" } });
      expect(schemaErrors(mechanics)).toEqual([]);
    }
  });
});

describe("core rules Stratagems", () => {
  it("checks a WHEN against the core rules' own stratagem file", () => {
    const root = mkdtempSync(join(tmpdir(), "core-strat-"));
    mkdirSync(join(root, "core", "alpha"), { recursive: true });
    writeFileSync(join(root, "core", "stratagems.json"), JSON.stringify([{ id: "overwatch", ability_id: "overwatch", phases: ["movement"], player_turn: "opponent-turn" }]));
    writeFileSync(join(root, "core", "alpha", "stratagems.json"), "[]");
    const check = (opponent: string[]) => [{ kind: "use-window", parameters: { your_phases: [], opponent_phases: opponent, either_phases: [] } }] as never;
    expect(coreCheckErrors(root, "overwatch", check(["movement"]))).toEqual([]);
    expect(coreCheckErrors(root, "overwatch", check(["charge"]))[0]).toMatch(/core says movement/u);
  });
});
