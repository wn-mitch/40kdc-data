import { describe, expect, it } from "vitest";

import { resolveBuffs } from "../src/cruncher/buffs.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/effect.js";
import { expectCompiled, placed, type Item } from "./semantic-authoring-connective-fixture.js";

// An optional, per-modifier ignore ("can ignore any or all modifiers") and a moment that is either of two
// attack resolutions ("has shot or fought"). Wording is fabricated; record names are designation ids only.

const compiled = (text: string, items: Item[], name?: string) => {
  const result = compileLeaves(placed(text, ...items), text, name ? { abilityId: "fabricated", name } : {});
  expectCompiled(result);
  return result;
};
const normalize = (family: string, parameters: Record<string, unknown>) =>
  normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));
const render = (mechanics: Record<string, unknown>) => describeAbility({ ...mechanics, ability_id: "fabricated" } as Parameters<typeof describeAbility>[0]);

describe("an ignore of any or all modifiers", () => {
  it("takes choice any-or-all and refuses any other choice", () => {
    expect(normalize("ignore-modifiers", { subject: "attack", what: ["characteristics"], stats: ["AP", "D"], choice: "any-or-all" }))
      .toEqual({ subject: "attack", what: ["characteristics"], stats: ["AP", "D"], choice: "any-or-all" });
    expect(() => normalize("ignore-modifiers", { subject: "attack", what: ["characteristics"], stats: ["AP"], choice: "all" })).toThrow();
    expect(() => normalize("ignore-modifiers", { subject: "attack", what: ["characteristics"], stats: ["AP"], choice: true })).toThrow();
  });

  const text = "Until the end of the phase, each time a model in this unit makes an attack, you can ignore any or all modifiers to that attack's Armour Penetration and Damage characteristics.";
  const items = (choice: Record<string, unknown>): Item[] => [
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
    ["makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }, "EFFECT"],
    ["you can ignore any or all modifiers to that attack's Armour Penetration and Damage characteristics", "ignore-modifiers", { subject: "attack", what: ["characteristics"], stats: ["AP", "D"], ...choice }, "EFFECT"],
  ];

  it("carries the choice onto the DSL modifier and renders it as the player's option", () => {
    const optional = compiled(text, items({ choice: "any-or-all" }));
    expect(JSON.stringify(optional.mechanics.effect)).toContain('"choice":"any-or-all"');
    const english = render(optional.mechanics);
    expect(english).toContain("you can ignore any or all modifiers to");
    expect(english).not.toMatch(/ignores any modifiers/u);
    // Without the choice every named modifier is ignored, as before.
    const all = compiled(text, items({}));
    expect(JSON.stringify(all.mechanics.effect)).not.toContain("choice");
    expect(render(all.mechanics)).not.toContain("any or all");
  });

  it("never strips a beneficial Hit roll modifier from the cruncher's attacker", () => {
    const source = { kind: "ability" as const, abilityId: "fabricated", abilityKind: "detachment-stratagem" as const };
    const effect = { type: "ignore-modifiers", target: "this-unit", modifier: { what: "rolls", rolls: ["hit"], choice: "any-or-all" } };
    const result = effectToBuffs(effect, source, { phase: "shooting" });
    expect(result.unsupported).toEqual([]);
    expect(result.applied).toEqual([{ source, contribution: { type: "ignore-modifiers", roll: "hit" } }]);
    const other = { kind: "ability" as const, abilityId: "other", abilityKind: "unit" as const };
    const plus = resolveBuffs([...result.applied, { source: other, contribution: { type: "hit-mod", value: 1 } }], { phase: "shooting" });
    expect(plus.hitMod.value).toBe(1);
    const minus = resolveBuffs([...result.applied, { source: other, contribution: { type: "hit-mod", value: -1 } }], { phase: "shooting" });
    expect(minus.hitMod.value).toBe(0);
  });

  it("leaves an Armour Penetration and Damage ignore outside the damage path", () => {
    const source = { kind: "ability" as const, abilityId: "fabricated", abilityKind: "detachment-stratagem" as const };
    const effect = { type: "ignore-modifiers", target: "this-unit", modifier: { what: "characteristics", stats: ["AP", "D"], choice: "any-or-all" } };
    const result = effectToBuffs(effect, source, { phase: "shooting" });
    expect(result.applied).toEqual([]);
    expect(result.unsupported.map((fragment) => fragment.reason)).toEqual(["ignore-modifiers: only hit and wound rolls and WS/BS are modelled"]);
  });
});

describe("a moment that is a shot or a fight", () => {
  const text = "Your opponent's Shooting phase or the Fight phase, just after an enemy unit has shot or fought.\nOne FOO unit from your army.\nUntil the end of the battle, each time a BAR model from your army makes an attack that targets that enemy unit, add 1 to the Hit roll.";
  const items: Item[] = [
    ["Your opponent's Shooting phase or the Fight phase", "use-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: ["fight"] }, "WHEN"],
    ["just after an enemy unit has shot", "event", { kind: "attacks-resolved", owner: "enemy", action_kind: "shoot" }, "WHEN"],
    ["fought", "event", { kind: "attacks-resolved", owner: "enemy", action_kind: "fight" }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["FOO unit", "unit-filter", { side: "friendly", keywords: ["FOO"] }, "TARGET"],
    ["Until the end of the battle", "duration", { endpoint: "end-of-battle" }, "EFFECT"],
    ["BAR model", "unit-filter", { side: "friendly", keywords: ["BAR"], level: "model" }, "EFFECT"],
    ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }, "EFFECT"],
    ["that targets that enemy unit", "target-is-selected", { unit: "event-subject" }, "EFFECT"],
    ["add 1 to the Hit roll", "roll-modifier", { operation: "add", value: 1, roll: "hit" }, "EFFECT"],
  ];

  it("fires on either resolution and still designates the moment's unit", () => {
    const { mechanics } = compiled(text, items, "Avenge the Star Children");
    const trigger = JSON.stringify(mechanics.trigger);
    expect(trigger).toContain('"shoot"');
    expect(trigger).toContain('"fight"');
    const english = render(mechanics);
    expect(english).toMatch(/shoots or .*fights/u);
    expect(english).toContain("Select the triggering unit (your Avenge the Star Children Target)");
  });
});
