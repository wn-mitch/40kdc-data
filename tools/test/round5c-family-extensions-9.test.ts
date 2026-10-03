import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/round5c/compile.js";
import type { CompileLeaf } from "../src/round5c/compile-fragments.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { describeCondition } from "../src/translate/condition.js";
import { describeAbility } from "../src/translate/effect.js";
import { describeTrigger } from "../src/translate/trigger.js";

// Fabricated wording and records only; no GW rule prose.

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

function placed(text: string, parts: Array<[string, string, Record<string, unknown>]>): { leaves: CompileLeaf[]; text: string } {
  let from = 0;
  const leaves = parts.map(([wording, family_id, parameters]) => {
    const index = text.indexOf(wording, from);
    if (index < 0) throw new Error(`"${wording}" is not in the fixture text after byte ${from}.`);
    from = index + wording.length;
    const start = Buffer.byteLength(text.slice(0, index));
    const version = currentFamilyVersion(family_id);
    return { role: familyRole(family_id, version), family_id, family_version: version, start_byte: start, end_byte: start + Buffer.byteLength(wording), parameters: normalize(family_id, parameters) };
  });
  return { leaves, text };
}

function compiled(parts: { leaves: CompileLeaf[]; text: string }) {
  const result = compileLeaves(parts.leaves, parts.text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}

function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
}

function authored(faction: string, abilityId: string): Record<string, unknown> {
  const enrichment = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
  return (JSON.parse(readFileSync(join(enrichment, faction, "abilities.json"), "utf8")) as Array<Record<string, unknown>>).find((item) => item.ability_id === abilityId)!;
}
const schemaErrors = (mechanics: unknown) => checkEntry(entryWithMechanics(authored("world-eaters", "blessings-of-khorne-world-eaters"), mechanics as never)).errors;

const FNP = { subject: "this-unit", threshold: 6, against: "all" };

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
  it("names Strategic Reserves and Cult Ambush as unit states", () => {
    for (const state of ["in-strategic-reserves", "in-cult-ambush"] as const) {
      const mechanics = compiled(placed("While this unit is held aside, this unit has the Feel No Pain 6+ ability.", [
        ["While this unit is held aside", "unit-state", { states: [state], subject: "this-unit", negated: false }],
        ["this unit has the Feel No Pain 6+ ability", "feel-no-pain", FNP],
      ]));
      expect(nodes(mechanics, (node) => node.type === "unit-state")[0]!.parameters).toMatchObject({ state });
      expect(schemaErrors(mechanics)).toEqual([]);
    }
    expect(describeCondition({ type: "unit-state", parameters: { state: "in-cult-ambush" } } as never)).toBe("the unit is in Cult Ambush");
    // "Reserves" is Strategic Reserves in the rules; there is no wider any-Reserves state.
    expect(() => normalize("unit-state", { states: ["in-reserves"], subject: "this-unit", negated: false })).toThrow();
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

  it("refuses an aura whose units must not be Battle-shocked, which its eligible list cannot say", () => {
    const result = compileLeaves(...Object.values(placed("While a friendly not battle-shocked unit is within 6\" of this model, that unit has the Feel No Pain 6+ ability.", [
      ["friendly not battle-shocked unit", "unit-filter", { side: "friendly", states: ["not-battle-shocked"] }],
      ["is within 6\" of this model", "aura-range", { inches: 6 }],
      ["that unit has the Feel No Pain 6+ ability", "feel-no-pain", { ...FNP, subject: "antecedent" }],
    ])) as [CompileLeaf[], string]);
    expect(result.ok ? "compiled" : result.errors.join()).toMatch(/not Battle-shocked|aura|anchor/u);
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
