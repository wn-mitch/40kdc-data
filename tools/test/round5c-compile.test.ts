import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, shapeSignature, type CompileLeaf } from "../src/round5c/compile.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>, familyVersion = 1): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: familyVersion, parameters, start_byte: offset };
}
const lead = () => leaf("CONDITION", "leading-unit", { subject: "this-model", attachment: "leading" }, 2);
const attack = () => leaf("EVENT", "event", { kind: "attack-made" }, 2);

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

/** The compiled entry on a real authored base must validate, lint, and render. */
function rendered(base: Record<string, unknown>, leaves: CompileLeaf[]): string {
  const entry = entryWithMechanics(base, compiled(leaves).mechanics);
  const check = checkEntry(entry);
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

describe("Round 5C leaf compiler", () => {
  it("reproduces authored leader auras exactly, condition included", () => {
    const edict = authored("adeptus-mechanicus", "control-edict");
    const result = compiled([lead(), attack(), leaf("EFFECT", "reroll", { roll: "hit", subset: "failed" })]);
    expect(result.mechanics.effect).toEqual(edict.effect);
    expect(result.mechanics.scope).toEqual(edict.scope);
    expect(result.mechanics.behavior).toBe(edict.behavior);
    expect(rendered(edict, [lead(), attack(), leaf("EFFECT", "reroll", { roll: "hit", subset: "failed" })])).toMatch(/attached|leading/iu);

    const hero = authored("aeldari", "piratical-hero");
    const two = compiled([lead(), leaf("EFFECT", "roll-modifier", { roll: "hit", operation: "add", value: 1 }),
      leaf("EFFECT", "weapon-ability-grant", { subject: "this-unit", keyword: "Sustained Hits 1", weapon_type: "all" }, 2)]);
    expect(two.mechanics.effect).toEqual(hero.effect);
  });

  it("gives every family one fragment that validates and renders", () => {
    const base = authored("adeptus-mechanicus", "control-edict");
    const cases: Array<[CompileLeaf, Record<string, unknown>]> = [
      [leaf("EFFECT", "reroll", { roll: "wound", subset: "ones" }), { type: "re-roll", target: "unit", modifier: { roll: "wound", subset: "ones" } }],
      [leaf("EFFECT", "reroll", { roll: "hit", subset: "all" }), { type: "re-roll", target: "unit", modifier: { roll: "hit", result_scope: "any-result" } }],
      [leaf("EFFECT", "roll-modifier", { roll: "wound", operation: "subtract", value: 1 }), { type: "roll-modifier", target: "unit", modifier: { roll: "wound", operation: "subtract", value: 1 } }],
      [leaf("EFFECT", "critical-hit-threshold", { value: 5 }), { type: "roll-modifier", target: "unit", modifier: { roll: "hit", critical_on: 5 } }],
      [leaf("EFFECT", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }), { type: "cp-gain", target: "self", modifier: { amount: 1 } }],
      [leaf("EFFECT", "resource-action", { resource: "miracle-dice", operation: "gain", amount: 1 }), { type: "resource-gain", target: "self", modifier: { pool_id: "miracle-dice-pool", amount: 1 } }],
      [leaf("EFFECT", "characteristic-set", { subject: "this-model", characteristic: "M", value: 7 }), { type: "stat-modifier", target: "self", modifier: { stat: "M", operation: "set", value: 7 } }],
      [leaf("EFFECT", "weapon-ability-grant", { subject: "bearer", keyword: "Lethal Hits", weapon_type: "melee" }, 2), { type: "keyword-grant", target: "bearer", modifier: { keywords: ["Lethal Hits"], weapon_type: "melee" } }],
    ];
    for (const [input, expected] of cases) {
      expect(compiled([input]).mechanics.effect).toEqual(expected);
      expect(rendered(base, [input]).length).toBeGreaterThan(0);
    }
  });

  it("wraps conditions, sequences effects, sets duration, and turns state events into triggers", () => {
    const leaves = [
      leaf("EVENT", "event", { kind: "phase-start" }, 2),
      leaf("CONDITION", "below-starting-strength", { subject: "this-unit" }),
      lead(),
      leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" }),
      leaf("EFFECT", "roll-modifier", { roll: "wound", operation: "add", value: 1 }),
      leaf("DURATION", "duration", { endpoint: "end-of-turn" }),
    ];
    const result = compiled(leaves);
    expect(result.mechanics).toEqual({
      effect: {
        type: "conditional",
        condition: { operator: "and", operands: [{ type: "unit-below-starting-strength" }, { type: "is-attached" }] },
        effect: { type: "sequence", steps: [
          { type: "re-roll", target: "unit", modifier: { roll: "hit", subset: "ones" } },
          { type: "roll-modifier", target: "unit", modifier: { roll: "wound", operation: "add", value: 1 } },
        ] },
      },
      scope: { range: "unit", duration: "turn" },
      behavior: "reactive",
      trigger: { event: "start-of-phase" },
    });
    expect(result.signature).toBe("EVENT(event:phase-start) · CONDITION(below-starting-strength) · CONDITION(leading-unit) · EFFECT(reroll) · EFFECT(roll-modifier) · DURATION(duration)");
    expect(rendered(authored("adeptus-mechanicus", "control-edict"), leaves).length).toBeGreaterThan(0);
  });

  it("keeps attack events implicit and names them only as attack in the shape", () => {
    const left = [lead(), attack(), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })];
    const right = [lead(), leaf("EVENT", "event", { kind: "wound-roll" }, 2), leaf("EFFECT", "reroll", { roll: "wound", subset: "all" })];
    expect(shapeSignature(left)).toBe(shapeSignature(right));
    expect(compiled(left).mechanics.trigger).toBeNull();
  });

  it("refuses what it cannot express instead of guessing", () => {
    const fail = (leaves: CompileLeaf[]) => {
      const result = compileLeaves(leaves);
      expect(result.ok).toBe(false);
      return result.ok ? [] : result.errors;
    };
    expect(fail([lead()])).toEqual(["There is no effect leaf to compile."]);
    expect(fail([leaf("EFFECT", "reroll", { roll: { source: "Hit" }, subset: "ones" })])[0]).toMatch(/quoted source text/u);
    expect(fail([leaf("EFFECT", "resource-action", { resource: "command-point", operation: "spend", amount: 1 })])[0]).toMatch(/Only resource gains/u);
    expect(fail([leaf("CONDITION", "army-faction", { faction: { source: "Fabricated" } }), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })])[0]).toMatch(/army-faction has no DSL fragment/u);
    expect(fail([leaf("EVENT", "event", { kind: "phase-start" }, 2), leaf("EVENT", "event", { kind: "phase-end" }, 2), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })]))
      .toContain("More than one trigger event; the shape needs a combinator the compiler does not have.");
  });
});
