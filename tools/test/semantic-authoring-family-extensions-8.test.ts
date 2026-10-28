import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { targetRestrictions } from "../src/semantic-authoring/compile-conditions.js";
import type { CompileLeaf } from "../src/semantic-authoring/compile-fragments.js";
import { dslUnitFilter } from "../src/semantic-authoring/compile-unit-filter-dsl.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { coreCheckErrors } from "../src/semantic-authoring/core-checks.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { describeCondition } from "../src/translate/condition.js";
import { describeAbility } from "../src/translate/effect.js";
import { describeTrigger } from "../src/translate/trigger.js";

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
    // Deep Strike places an Ingress Move out of Strategic Reserves: the set-up names no source, and the unit used Deep Strike in the same window.
    expect(nodes(arrived, (node) => node.type === "happened").map((node) => node.parameters)).toEqual([
      { event: "set-up", window: "turn" },
      { event: "used", filter: { kind: "ability", id: "deep-strike" }, window: "turn" },
    ]);
    expect(schemaErrors(arrived)).toEqual([]);
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

describe("a move starting", () => {
  it("lowers move-started as its own moment, not as a move ending", () => {
    const mechanics = compiled(placed("At the start of this unit's Normal move, this unit has the Feel No Pain 6+ ability.", [
      ["At the start of this unit's Normal move", "event", { kind: "move-started", move_types: ["normal"] }],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    expect(mechanics.trigger).toEqual({ event: "move-started", filter: { move_types: ["normal"] } });
    expect(schemaErrors(mechanics)).toEqual([]);
    expect(describeTrigger(mechanics.trigger as never)).toBe("when the unit starts a Normal move");
    expect(describeTrigger({ event: "move-started", subject: { owner: "enemy" }, filter: { move_types: ["consolidation"] } })).toBe("each time an enemy unit starts a Consolidation move");
  });

  it("keeps move-ended's own reading", () => {
    expect(normalize("event", { kind: "move-started", move_types: ["advance"] })).toEqual({ kind: "move-started", move_types: ["advance"] });
    expect(describeTrigger({ event: "move-ended", filter: { move_types: ["normal"] } })).toBe("when the unit ends a Normal move");
  });
});

describe("a mortal-wound cap", () => {
  it("carries the cap into the DSL and the English", () => {
    const mechanics = compiled(placed("This unit suffers D6 mortal wounds (to a maximum of 3 mortal wounds).", [
      ["This unit suffers D6 mortal wounds (to a maximum of 3 mortal wounds)", "mortal-wounds", { recipient: "this-unit", count: "D6", max: 3 }],
    ]));
    expect(nodes(mechanics, (node) => node.type === "mortal-wounds")[0]!.modifier).toEqual({ count: "D6", max: 3 });
    expect(schemaErrors(mechanics)).toEqual([]);
    expect(describeAbility({ effect: { type: "mortal-wounds", target: "this-unit", modifier: { count: "D6", max: 3 } }, scope: { duration: "resolution" } } as never))
      .toContain("(to a maximum of 3 mortal wounds)");
  });

  it("refuses a cap that is not a whole number from 1 to 20", () => {
    expect(() => normalize("mortal-wounds", { recipient: "this-unit", count: "D6", max: 0 })).toThrow(/max/u);
    expect(() => normalize("mortal-wounds", { recipient: "this-unit", count: "D6", max: 2.5 })).toThrow(/max/u);
  });
});

describe("Reserves states", () => {
  it("lowers \"in Reserves\" to Strategic Reserves and keeps Cult Ambush as its own state", () => {
    for (const [state, lowered] of [["in-reserves", "in-strategic-reserves"], ["in-strategic-reserves", "in-strategic-reserves"], ["in-cult-ambush", "in-cult-ambush"]] as const) {
      const mechanics = compiled(placed("While this unit is held aside, this unit has the Feel No Pain 6+ ability.", [
        ["While this unit is held aside", "unit-state", { states: [state], subject: "this-unit", negated: false }],
        ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
      ]));
      expect(nodes(mechanics, (node) => node.type === "matches" && typeof node.parameters === "object" && node.parameters !== null && !Array.isArray(node.parameters)
        && typeof (node.parameters as Record<string, unknown>).filter === "object"
        && (node.parameters as Record<string, unknown>).filter !== null
        && ((node.parameters as Record<string, unknown>).filter as Record<string, unknown>).state === lowered)[0]!.parameters)
        .toMatchObject({ filter: { state: lowered } });
      expect(schemaErrors(mechanics)).toEqual([]);
    }
    expect(describeCondition({ type: "matches", parameters: { filter: { state: "in-cult-ambush" } } } as never)).toBe("the unit is in Cult Ambush");
  });

  it("checks a Stratagem target held in Reserves as being in Strategic Reserves", () => {
    const text = "One friendly **JUMP PACK** unit from your army that is in Reserves. Set your unit up on the battlefield.";
    const { leaves } = placed(text, [
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly **JUMP PACK** unit", "unit-filter", { side: "friendly", keywords: ["JUMP PACK"] }, "TARGET"],
      ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
      ["that is in Reserves", "unit-filter", { side: "friendly", held_in: "strategic-reserves" }, "TARGET"],
      ["Set your unit up on the battlefield", "set-up", { subject: "this-unit", to: "battlefield" }, "EFFECT"],
    ]);
    const result = compileLeaves(leaves, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const target = (result.core as { target_restrictions: Record<string, unknown> }).target_restrictions;
    expect(target).toMatchObject({ side: "your-army", required_keywords: ["JUMP PACK"] });
    expect(nodes(target.eligibility, (node) => node.type === "matches").map((node) => node.parameters))
      .toContainEqual({ filter: { state: "in-strategic-reserves" } });
  });

  it("lowers arriving from Reserves as being set up from Strategic Reserves, alone or with another activity", () => {
    const text = "While this unit did not Remain Stationary or arrive from Reserves this phase, this unit has the Feel No Pain 6+ ability.";
    const mechanics = compiled(placed(text, [
      ["While this unit did not Remain Stationary or arrive from Reserves this phase", "unit-activity", { activities: ["remained-stationary", "set-up-from-reserves-this-phase"], subject: "this-unit", negated: true }],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    const happened = nodes(mechanics, (node) => node.type === "happened").map((node) => node.parameters as Record<string, unknown>);
    expect(happened).toContainEqual(expect.objectContaining({ event: "set-up", filter: { from: "strategic-reserves" }, window: "phase" }));
    expect(happened).toHaveLength(2);
    expect(schemaErrors(mechanics)).toEqual([]);
    expect(describeCondition({ type: "happened", parameters: { event: "set-up", filter: { from: "strategic-reserves" }, window: "turn" } } as never)).toMatch(/set up .*Strategic Reserves this turn/u);
  });

  it("sets up using a Cult Ambush marker, within a range of it, and moves only an unmoved marker", () => {
    const text = 'Set your unit up wholly within 6" of that Cult Ambush marker. Move that Cult Ambush marker up to 6".';
    const mechanics = compiled(placed(text, [
      ['Set your unit up wholly within 6" of that Cult Ambush marker', "set-up", { subject: "this-unit", to: "battlefield", via: "cult-ambush-marker", marker_inches: 6, marker_wholly: true }],
      ['Move that Cult Ambush marker up to 6"', "battlefield-marker", { subject: "this-unit", label: "cult-ambush-marker", operation: "relocate", distance: 6, not_moved_this_turn: true }],
    ]));
    expect(nodes(mechanics, (node) => node.type === "set-up")[0]!.modifier).toEqual({ to: "battlefield", via: "cult-ambush", marker_range: { range: { inches: 6 }, wholly: true } });
    expect(nodes(mechanics, (node) => node.type === "marker")[0]!.modifier).toMatchObject({ operation: "relocate", distance: { inches: 6 }, not_moved_this_turn: true });
    expect(schemaErrors(mechanics)).toEqual([]);
    expect(() => normalize("set-up", { subject: "this-unit", to: "battlefield", marker_inches: 6 })).toThrow(/cult-ambush-marker/u);
    expect(() => normalize("battlefield-marker", { subject: "this-unit", label: "cult-ambush-marker", operation: "place", not_moved_this_turn: true })).toThrow(/relocate/u);
    const say = (effect: unknown) => describeAbility({ effect, scope: { duration: "resolution" } } as never);
    expect(say({ type: "set-up", target: "this-unit", modifier: { to: "battlefield", via: "cult-ambush", marker_range: { range: { inches: 6 }, wholly: true } } }))
      .toContain('set up on the battlefield using a Cult Ambush marker, wholly within 6" of that marker');
    expect(say({ type: "marker", target: "this-unit", modifier: { label: "cult-ambush-marker", operation: "relocate", distance: { inches: 6 }, not_moved_this_turn: true } }))
      .toContain('marker that has not been moved this turn up to 6"');
  });

  it("refuses a Reserves state paired with engaged-with", () => {
    expect(() => normalize("unit-state", { states: ["in-cult-ambush"], subject: "this-unit", negated: false, with: "this-unit" })).toThrow();
  });
});

describe("negated filter states and all-of exclusions", () => {
  it("lowers unengaged and not Battle-shocked to not_states on a trigger's unit", () => {
    const mechanics = compiled(placed("Each time an unengaged, not battle-shocked enemy unit ends a move, this unit has the Feel No Pain 6+ ability.", [
      ["unengaged, not battle-shocked enemy unit", "unit-filter", { side: "enemy", states: ["unengaged", "not-battle-shocked"] }],
      ["ends a move", "event", { kind: "move-ended" }],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    expect((mechanics.trigger as { subject: unknown }).subject).toEqual({ owner: "enemy", not_states: ["engaged", "battle-shocked"] });
    expect(schemaErrors(mechanics)).toEqual([]);
  });

  it("excludes only units with every listed keyword", () => {
    const mechanics = compiled(placed("Each time an enemy unit (excluding MONSTER CHARACTER units) ends a move, this unit has the Feel No Pain 6+ ability.", [
      ["enemy unit (excluding MONSTER CHARACTER units)", "unit-filter", { side: "enemy", excluded_all_keywords: ["MONSTER", "CHARACTER"] }],
      ["ends a move", "event", { kind: "move-ended" }],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    expect((mechanics.trigger as { subject: unknown }).subject).toEqual({ owner: "enemy", not_all_of: ["CHARACTER", "MONSTER"] });
    expect(schemaErrors(mechanics)).toEqual([]);
    expect(describeTrigger(mechanics.trigger as never)).toBe("each time an enemy unit ends a move (the triggering unit must not have all of CHARACTER and MONSTER)");
    expect(describeTrigger({ event: "move-ended", subject: { owner: "enemy", not_states: ["engaged", "battle-shocked"] } })).toBe("each time an enemy unit that is unengaged and not Battle-shocked ends a move");
  });

  it("refuses contradictory states and a one-keyword all-of exclusion", () => {
    expect(() => normalize("unit-filter", { side: "enemy", states: ["battle-shocked", "not-battle-shocked"] })).toThrow(/both/u);
    expect(() => normalize("unit-filter", { side: "enemy", excluded_all_keywords: ["MONSTER"] })).toThrow();
  });

  it("retains a not Battle-shocked restriction in an aura's eligible filter", () => {
    const mechanics = compiled(placed("While a friendly not battle-shocked unit is within 6\" of this model, that unit has the Feel No Pain 6+ ability.", [
      ["friendly not battle-shocked unit", "unit-filter", { side: "friendly", states: ["not-battle-shocked"] }],
      ["is within 6\" of this model", "aura-range", { inches: 6 }],
      ["that unit has the Feel No Pain 6+ ability", "feel-no-pain", { ...FNP, subject: "antecedent" }],
    ]));
    expect(nodes(mechanics, (node) => node.type === "aura")[0]!.modifier)
      .toMatchObject({ eligible: { owner: "friendly", not_states: ["battle-shocked"] } });
  });
});

describe("disembarking from a named Transport", () => {
  it("names this Transport in the history and the English", () => {
    const mechanics = compiled(placed("While that unit disembarked from this Transport this turn, this unit has the Feel No Pain 6+ ability.", [
      ["While that unit disembarked from this Transport this turn", "unit-activity", { activities: ["disembarked-from-this-transport-this-turn"], subject: "this-unit", negated: false }],
      ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
    ]));
    const happened = nodes(mechanics, (node) => node.type === "happened")[0]!;
    expect(happened.parameters).toMatchObject({ event: "disembarked", filter: { transport: "this-unit" }, window: "turn" });
    expect(schemaErrors(mechanics)).toEqual([]);
    expect(describeCondition(happened as never)).toBe("the unit disembarked from this Transport this turn");
    expect(describeTrigger({ event: "disembarked", filter: { transport: "this-model" } })).toBe("when the unit disembarks from this Transport");
  });
});

describe("describer readings the earlier rounds pinned as collisions", () => {
  it("tells whose roll and how it came out", () => {
    expect(describeTrigger({ event: "after-roll", filter: { roll: "battle-shock", result: "failure" } })).toBe("when the unit fails a Battle-shock test");
    expect(describeTrigger({ event: "after-roll", filter: { roll: "battle-shock", result: "success" } })).toBe("when the unit passes a Battle-shock test");
    expect(describeTrigger({ event: "after-roll", subject: "this-model", filter: { roll: "save", result: "failure" } })).toBe("after a saving throw made for this model is failed");
    expect(describeTrigger({ event: "after-roll", filter: { roll: "charge", result: "success" } })).toBe("after a successful Charge roll");
    expect(describeTrigger({ event: "before-roll", filter: { roll: "deadly-demise" } })).toBe("before a Deadly Demise roll is made");
  });

  it("names the destroyer and the opponent", () => {
    expect(describeTrigger({ event: "destroyed", subject: "this-unit", object: { owner: "enemy" } })).toBe("each time the unit destroys an enemy unit");
    expect(describeTrigger({ event: "used", subject: { owner: "enemy" }, filter: { kind: "stratagem" } })).toBe("each time your opponent uses a Stratagem");
    expect(describeTrigger({ event: "used", filter: { kind: "stratagem" } })).toBe("each time you use a Stratagem");
  });

  it("says how a unit was set up and what a unit is attached to", () => {
    expect(describeCondition({ type: "happened", parameters: { event: "set-up", filter: { from: "deep-strike" }, window: "turn" } } as never)).toBe("the unit was set up using Deep Strike this turn");
    expect(describeCondition({ type: "happened", parameters: { event: "set-up", window: "turn" } } as never)).toBe("the unit was set up this turn");
    expect(describeCondition({ type: "attachment", parameters: { role: "attached", with: { all_of: ["ALPHA SQUAD"] } } } as never)).toBe("the unit is attached to an ALPHA SQUAD unit");
  });

  it("counts a two-dice table and names an allied faction", () => {
    const table = { type: "dice-table", dice: "D6", count: 2, distinct: true, outcomes: [{ results: [1, 2, 3], effect: { type: "feel-no-pain", target: "this-unit", modifier: { threshold: 6 } } }, { results: [4, 5, 6], effect: { type: "feel-no-pain", target: "this-unit", modifier: { threshold: 5 } } }] };
    expect(describeAbility({ effect: table, scope: { duration: "resolution" } } as never)).toMatch(/Roll 2 D6 and resolve each one \(re-rolling any repeated result\):/u);
    expect(describeAbility({ effect: { type: "army-rule", target: "this-unit", modifier: { rule: "composition", max: 500, measure: "points", faction: "chaos-daemons" } }, scope: { duration: "permanent" } } as never))
      .toContain("at most 500 points of Chaos Daemons units");
  });

  it("acts as if it were the Charge, Command or Movement phase", () => {
    for (const [asIf, words] of [["charge-phase", "Charge"], ["command-phase", "Command"], ["movement-phase", "Movement"]] as const) {
      expect(describeAbility({ effect: { type: "permission", target: "this-unit", modifier: { activity: "declare-charge", allow: true, as_if: asIf } }, scope: { duration: "turn" } } as never))
        .toContain(`as if it were your ${words} phase`);
    }
  });

  it("folds \"as if it were your Movement phase\" into the move before it, and refuses any other phase there", () => {
    const text = 'That unit can make a Normal move of up to 6" as if it were your Movement phase.';
    const move = { subject: "this-unit", move_type: "normal", distance: 6 };
    const mechanics = compiled(placed(text, [
      ["That unit can make a Normal move of up to 6", "make-move", move],
      ["as if it were your Movement phase", "phase-window", { phase: "movement", turn: "your" }],
    ]));
    expect(nodes(mechanics, (node) => node.type === "move")[0]!.modifier).toMatchObject({ move_type: "normal", distance: 6, as_if: "movement-phase" });
    // The hypothetical phase is not a real-phase gate on the ability.
    expect(nodes(mechanics, (node) => node.type === "phase")).toEqual([]);
    expect(schemaErrors(mechanics)).toEqual([]);
    expect(() => compiled(placed(text.replace("Movement", "Charge"), [
      ["That unit can make a Normal move of up to 6", "make-move", move],
      ["as if it were your Charge phase", "phase-window", { phase: "charge", turn: "your" }],
    ]))).toThrow(/DSL_GAP: a move cannot act as if it were the charge phase/u);
    expect(describeAbility({ effect: { type: "move", target: "this-unit", modifier: { move_type: "normal", distance: 6, as_if: "movement-phase" } }, scope: { duration: "resolution" } } as never))
      .toContain('make a Normal move of up to 6" as if it were your Movement phase');
  });
});
