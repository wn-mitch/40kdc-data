import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, shapeSignature, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, REVIEWED_FAMILY_REGISTRY } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { prefillFromSource, type PrefillFamily } from "../src/round5c/leaf-prefill.js";
import { previewLeaf } from "../src/round5c/leaf-preview.js";

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

const leavesOf8561 = () => [
  leaf("EVENT", "select-unit", { scope: "friendly", distance: "any", visible: false }),
  leaf("CONDITION", "in-region", { subject: "selected-unit", region_kind: "territory", territory: "your-deployment-zone", wholly: true }),
  leaf("RESTRICTION", "count-by-battle-size", { incursion: 1, "strike-force": 2, onslaught: 3 }),
  leaf("EFFECT", "set-up", { subject: "selected-unit", to: "strategic-reserves", from: "battlefield" }),
  leaf("RESTRICTION", "reserves-arrival", { allow_first_round: true }),
];

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
  it("binds a selection inside the part of a compound ability that holds it", () => {
    const result = compiled([
      leaf("EFFECT", "reroll", { roll: "charge", subset: "all", weapon_type: "all" }, 2),
      leaf("EVENT", "event", { kind: "move-ended", owner: "friendly", move_types: ["charge"] }, 9),
      leaf("EVENT", "select-unit", { scope: "enemy", distance: "any", visible: false }),
      leaf("EFFECT", "mortal-wounds", { recipient: "that-unit", count: "D3" }),
    ]);
    const parts = (result.mechanics.effect as { steps: Array<{ trigger: unknown; effect: { type: string } }> }).steps;
    expect(parts).toHaveLength(2);
    expect(parts[1]!.effect.type).toBe("select-units");
  });

  it("reads a battle-size count and selected-unit conditions as the selection's cap and eligibility, and returns a set-up unit next Movement phase", () => {
    const result = compiled(leavesOf8561());
    const effect = result.mechanics.effect as { type: string; selector: Record<string, unknown>; effect: { modifier: Record<string, unknown> } };
    expect(effect.type).toBe("select-units");
    expect(effect.selector).toMatchObject({ max_count: { incursion: 1, "strike-force": 2, onslaught: 3 }, eligibility: { type: expect.any(String) } });
    expect(effect.selector.count).toBeUndefined();
    expect(effect.effect.modifier).toMatchObject({ arrives: "next-movement-phase", allow_first_round: true });
    // The eligibility is the selection's, not a gate on the whole ability.
    expect(result.mechanics.condition).toBeUndefined();
    expect(rendered(authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus"), leavesOf8561()).length).toBeGreaterThan(0);
  });

  it("narrows a selected unit's engagement to the one unit it is engaged with", () => {
    const leaves = [
      leaf("EVENT", "select-unit", { scope: "enemy", distance: "any", visible: false }),
      leaf("CONDITION", "unit-state", { states: ["engaged"], subject: "selected-unit", negated: false, with: "this-model" }, 5),
      leaf("EFFECT", "set-up", { subject: "selected-unit", to: "strategic-reserves", from: "battlefield" }),
    ];
    const selector = (compiled(leaves).mechanics.effect as { selector: { eligibility: unknown } }).selector;
    expect(selector.eligibility).toEqual({ type: "unit-state", parameters: { subject: "selected-unit", state: "engaged", with: "this-model" } });
    expect(rendered(authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus"), leaves)).toMatch(/Engagement Range of this model|engaged with this model/iu);
  });

  it("lowers a move-distance bonus to a move-modifier on the named moves", () => {
    const result = compiled([leaf("EFFECT", "move-distance", { subject: "this-unit", move_types: ["pile-in", "consolidation"], bonus: 3 })]);
    const leaves = [leaf("EFFECT", "move-distance", { subject: "this-unit", move_types: ["pile-in", "consolidation"], bonus: 3 })];
    expect(rendered(authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus"), leaves)).toContain("3");
    expect(result.mechanics.effect).toEqual({ type: "move-modifier", target: "this-unit", modifier: { applies_to_moves: ["pile-in", "consolidation"], distance_bonus: 3 } });
  });

  it("folds \"must end that move either … or …\" into the move's end condition, gating nothing", () => {
    const result = compiled([
      leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "fall-back", distance: 6 }, 2),
      leaf("RESTRICTION", "move-must-end", { match: "any" }),
      leaf("CONDITION", "in-region", { subject: "this-unit", region_kind: "territory", territory: "your-deployment-zone", wholly: true }),
      leaf("CONDITION", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false }, 3),
    ]);
    const effect = result.mechanics.effect as { type: string; modifier: { ends_when?: { operator: string; operands: unknown[] } } };
    expect(effect.type).toBe("move");
    expect(effect.modifier.ends_when?.operator).toBe("or");
    expect(effect.modifier.ends_when?.operands).toHaveLength(2);
  });

  it("gates a whole non-Stratagem ability on its own phase window, in the turn each phase belongs to", () => {
    const window = leaf("RESTRICTION", "activation-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: ["fight"] });
    const result = compiled([window, leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })]);
    // The gate: the opponent's Shooting phase, or the Fight phase in either turn.
    expect(JSON.stringify(result.mechanics)).toContain(JSON.stringify({ operator: "or", operands: [
      { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "shooting" } }, { type: "player-turn-is", parameters: { turn: "opponent-turn" } }] },
      { type: "phase-is", parameters: { phase: "fight" } },
    ] }));
  });

  it("reproduces authored leader auras exactly, condition included", () => {
    const edict = authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");
    const result = compiled([lead(), attack(), leaf("EFFECT", "reroll", { roll: "hit", subset: "failed" })]);
    expect(result.mechanics.effect).toEqual(edict.effect);
    expect(result.mechanics.scope).toEqual(edict.scope);
    expect(result.mechanics.behavior).toBe(edict.behavior);
    expect(rendered(edict, [lead(), attack(), leaf("EFFECT", "reroll", { roll: "hit", subset: "failed" })])).toMatch(/attached|leading/iu);

    const hero = authored("aeldari", "piratical-hero-aeldari");
    const two = compiled([lead(), leaf("EFFECT", "roll-modifier", { roll: "hit", operation: "add", value: 1 }),
      leaf("EFFECT", "weapon-ability-grant", { subject: "this-unit", keyword: "Sustained Hits 1", weapon_type: "all" }, 2)]);
    expect(two.mechanics.effect).toEqual(hero.effect);
  });

  it("gives every family one fragment that validates and renders", () => {
    const base = authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");
    const cases: Array<[CompileLeaf, Record<string, unknown>]> = [
      [leaf("EFFECT", "reroll", { roll: "wound", subset: "ones" }), { type: "re-roll", target: "this-unit", modifier: { roll: "wound", subset: "ones" } }],
      [leaf("EFFECT", "reroll", { roll: "hit", subset: "all" }), { type: "re-roll", target: "this-unit", modifier: { roll: "hit", result_scope: "any-result" } }],
      [leaf("EFFECT", "roll-modifier", { roll: "wound", operation: "subtract", value: 1 }), { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "subtract", value: 1 } }],
      [leaf("EFFECT", "critical-hit-threshold", { value: 5 }), { type: "roll-result", target: "this-unit", modifier: { roll: "hit", critical_on: 5 } }],
      [leaf("EFFECT", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }), { type: "cp-gain", target: "this-model", modifier: { amount: 1 } }],
      [leaf("EFFECT", "resource-action", { resource: "miracle-dice", operation: "gain", amount: 1 }), { type: "resource-gain", target: "this-model", modifier: { pool: "miracle-dice-pool", amount: 1 } }],
      [leaf("EFFECT", "characteristic-set", { subject: "this-model", characteristic: "M", value: 7 }), { type: "stat-modifier", target: "this-model", modifier: { stat: "M", operation: "set", value: 7 } }],
      // The bearer's weapon keyword is a weapon ability on this model, never a unit keyword.
      [leaf("EFFECT", "weapon-ability-grant", { subject: "this-model", keyword: "Lethal Hits", weapon_type: "melee" }, 3), { type: "weapon-ability-grant", target: "this-model", modifier: { abilities: ["Lethal Hits"], weapon_type: "melee" } }],
      [leaf("EFFECT", "feel-no-pain", { subject: "this-unit", threshold: 5, against: "all" }), { type: "feel-no-pain", target: "this-unit", modifier: { threshold: 5 } }],
      [leaf("EFFECT", "feel-no-pain", { subject: "this-model", threshold: 4, against: "psychic" }), { type: "feel-no-pain", target: "this-model", modifier: { threshold: 4, against: "psychic" } }],
      [leaf("EFFECT", "invulnerable-save", { subject: "this-unit", threshold: 4 }), { type: "invulnerable-save", target: "this-unit", modifier: { invuln_sv: 4 } }],
      [leaf("EFFECT", "fights-first", { subject: "this-unit" }), { type: "ability-grant", target: "this-unit", modifier: { ability: "fights-first" } }],
      [leaf("EFFECT", "characteristic-modifier", { subject: "this-unit", characteristic: "OC", operation: "add", value: 1 }), { type: "stat-modifier", target: "this-unit", modifier: { stat: "OC", operation: "add", value: 1 } }],
      [leaf("EFFECT", "characteristic-modifier", { subject: "this-unit", characteristics: ["AP"], operation: "improve", value: 1, weapon_type: "melee" }, 2),
        { type: "stat-modifier", target: "this-unit", modifier: { stat: "AP", operation: "improve", value: 1, weapon_type: "melee" } }],
      [leaf("EFFECT", "characteristic-modifier", { subject: "this-model", characteristics: ["A", "S"], operation: "add", value: 1, weapon_type: "all" }, 2),
        { type: "sequence", steps: [{ type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 1 } }, { type: "stat-modifier", target: "this-model", modifier: { stat: "S", operation: "add", value: 1 } }] }],
      [leaf("EFFECT", "regain-wounds", { subject: "this-model", amount: "1" }), { type: "heal", target: "this-model", modifier: { amount: 1 } }],
      [leaf("EFFECT", "sticky-objective", {}), { type: "objective-sticky", target: "this-unit" }],
      [leaf("EFFECT", "act-after-move", { subject: "this-unit", moves: ["advance"], acts: ["charge"] }), { type: "permission", target: "this-unit", modifier: { activity: "declare-charge", allow: true, after: ["advance"] } }],
      [leaf("EFFECT", "act-after-move", { subject: "this-unit", moves: ["fall-back"], acts: ["charge"] }), { type: "permission", target: "this-unit", modifier: { activity: "declare-charge", allow: true, after: ["fall-back"] } }],
      [leaf("EFFECT", "act-after-move", { subject: "this-unit", moves: ["fall-back"], acts: ["shoot", "charge"] }), { type: "sequence", steps: [
        { type: "permission", target: "this-unit", modifier: { activity: "shoot", allow: true, after: ["fall-back"] } },
        { type: "permission", target: "this-unit", modifier: { activity: "declare-charge", allow: true, after: ["fall-back"] } }] }],
      [leaf("EFFECT", "act-after-move", { subject: "this-unit", moves: ["fall-back"], acts: ["shoot"] }), { type: "permission", target: "this-unit", modifier: { activity: "shoot", allow: true, after: ["fall-back"] } }],
      // Shooting after an Advance is [ASSAULT] on ranged weapons; after a Fall Back it is a permission.
      [leaf("EFFECT", "act-after-move", { subject: "this-unit", moves: ["advance", "fall-back"], acts: ["shoot"] }), { type: "sequence", steps: [
        { type: "weapon-ability-grant", target: "this-unit", modifier: { abilities: ["Assault"], weapon_type: "ranged" } },
        { type: "permission", target: "this-unit", modifier: { activity: "shoot", allow: true, after: ["fall-back"] } }] }],
      [leaf("EFFECT", "regain-wounds", { subject: "this-model", amount: "D3" }, 2), { type: "heal", target: "this-model", modifier: { amount: "D3" } }],
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
        condition: { operator: "and", operands: [{ type: "strength", parameters: { below: "starting" } }, { type: "attachment", parameters: { subject: "this-model", role: "leading" } }] },
        effect: { type: "sequence", steps: [
          { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } },
          { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "add", value: 1 } },
        ] },
      },
      scope: { duration: "turn" },
      behavior: "reactive",
      trigger: { event: "phase-started" },
    });
    expect(result.signature).toBe("EVENT(event:phase-start) · CONDITION(below-starting-strength) · CONDITION(leading-unit) · EFFECT(reroll) · EFFECT(roll-modifier) · DURATION(duration)");
    expect(rendered(authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus"), leaves).length).toBeGreaterThan(0);
  });

  it("gives each later moment its own part of one compound ability", () => {
    const result = compiled([
      leaf("CONDITION", "leading-unit", { subject: "this-model", attachment: "leading" }),
      leaf("EVENT", "event", { kind: "phase-start", phase: "movement", turn: "your" }, 3),
      leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" }),
      leaf("EVENT", "event", { kind: "phase-end", phase: "movement", turn: "your" }, 3),
      leaf("EVENT", "event", { kind: "phase-end", phase: "shooting", turn: "your" }, 3),
      leaf("EFFECT", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }),
    ]);
    const window = (phase: string) => ({ operator: "and", operands: [{ type: "phase-is", parameters: { phase } }, { type: "player-turn-is", parameters: { turn: "your-turn" } }] });
    // One ability: no trigger of its own, its leading condition gates both parts, and the two
    // moments with no effect between them are alternatives for the second part.
    expect(result.mechanics).toMatchObject({ behavior: "reactive", trigger: null, effect: { type: "conditional", condition: { type: "attachment", parameters: { subject: "this-model", role: "leading" } }, effect: { type: "sequence", steps: [
      { type: "ability-part", trigger: { event: "phase-started", condition: window("movement") }, effect: { type: "re-roll" } },
      { type: "ability-part", trigger: [{ event: "phase-ended", condition: window("movement") }, { event: "phase-ended", condition: window("shooting") }], effect: { type: "cp-gain" } },
    ] } } });
  });

  it("fires on any of several leading moments", () => {
    const either = compiled([leaf("EVENT", "event", { kind: "selected-to-shoot" }), leaf("EVENT", "event", { kind: "selected-to-fight" }), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })]);
    expect(either.mechanics).toMatchObject({ behavior: "reactive", trigger: [{ event: "selected", filter: { to: "shoot" } }, { event: "selected", filter: { to: "fight" } }] });
  });

  it("narrows a phase-boundary trigger by phase and whose turn", () => {
    const command = compiled([leaf("EVENT", "event", { kind: "phase-start", phase: "command", turn: "your" }, 3), leaf("EFFECT", "resource-action", { resource: "command-point", operation: "gain", amount: 1 })]);
    expect(command.mechanics.trigger).toEqual({ event: "phase-started", condition: { operator: "and", operands: [
      { type: "phase-is", parameters: { phase: "command" } }, { type: "player-turn-is", parameters: { turn: "your-turn" } },
    ] } });
    expect(compiled([leaf("EVENT", "event", { kind: "phase-end", phase: "fight", turn: "opponent" }, 3), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })]).mechanics.trigger)
      .toEqual({ event: "phase-ended", condition: { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "fight" } }, { type: "player-turn-is", parameters: { turn: "opponent-turn" } }] } });
    expect(rendered(authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus"), [leaf("EVENT", "event", { kind: "phase-start", phase: "command", turn: "your" }, 3), leaf("EFFECT", "resource-action", { resource: "command-point", operation: "gain", amount: 1 })]))
      .toMatch(/Command phase/iu);
    expect(compiled([leaf("EVENT", "event", { kind: "phase-end", phase: "any", turn: "either" }, 3), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })]).mechanics.trigger).toEqual({ event: "phase-ended" });
    expect(shapeSignature([leaf("EVENT", "event", { kind: "phase-start", phase: "fight", turn: "opponent" }, 3)])).toBe("EVENT(event:phase-start)");
  });

  it("previews each leaf through the describer and names invalid parameters", () => {
    expect(previewLeaf({ family_id: "event", parameters: { kind: "phase-start", phase: "command", turn: "your" } }).text).toBe("at the start of your Command phase");
    expect(previewLeaf({ family_id: "event", parameters: { kind: "phase-end", phase: "fight", turn: "opponent" } }).text).toBe("at the end of your opponent's Fight phase");
    expect(previewLeaf({ family_id: "event", parameters: { kind: "phase-start", phase: "shooting", turn: "either" } }).text).toBe("at the start of the Shooting phase");
    expect(previewLeaf({ family_id: "event", parameters: { kind: "phase-start" } }).problem).toMatch(/exactly: kind, phase, turn/u);
    expect(previewLeaf({ family_id: "event", parameters: { kind: "charge", phase: "command", turn: "your" } }).problem).toMatch(/exactly: kind/u);
    expect(previewLeaf({ family_id: "feel-no-pain", parameters: { subject: "this-unit", threshold: 5, against: "mortal" } }).text).toMatch(/Feel No Pain 5\+/u);
    expect(previewLeaf({ family_id: "leading-unit", parameters: { subject: "this-model", attachment: "leading" } }).text).toBeTruthy();
    expect(previewLeaf({ family_id: "duration", parameters: { endpoint: "end-of-turn" } }).text).toBe("until the end of the turn");
    expect(previewLeaf({ family_id: "attack", parameters: { direction: "makes", unit: "this-model", attack_type: "any" } }).text).toMatch(/part of the effect/u);
    expect(previewLeaf({ family_id: "attack", parameters: { direction: "makes", unit: "this-model", attack_type: "melee" } }).text).toMatch(/melee/u);
    // Attacks left the event family in version 4.
    expect(previewLeaf({ family_id: "event", parameters: { kind: "attack-made" } }).problem).toMatch(/event.kind/u);
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
    // A quoted (not yet reviewer-resolved) army-faction still cannot compile; a resolved kebab-case id does (batch 6).
    expect(fail([leaf("CONDITION", "army-faction", { faction: { source: "Fabricated" } }), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })])[0]).toMatch(/quoted source text/u);
    expect(compiled([leaf("CONDITION", "army-faction", { faction: "ultramarines" }, 2), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })]).mechanics.effect)
      .toEqual({ type: "conditional", condition: { type: "army-faction", parameters: { faction: "ultramarines" } }, effect: { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } } });
    expect(fail([leaf("EVENT", "event", { kind: "selected-to-shoot" }), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" }), leaf("EVENT", "event", { kind: "selected-to-fight" })]))
      .toContain("A moment ends the ability with no effect after it.");
  });

  it("compiles each meaning to the trigger or condition form the authored data uses", () => {
    const base = authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");
    // Leaves compile in source order, so each effect is made after its moment.
    const heal = () => leaf("EFFECT", "regain-wounds", { subject: "this-unit", amount: "1" }, 2);
    // "When this model is destroyed" is the model itself, before it is removed; not any model in its unit.
    const own = [leaf("EVENT", "event", { kind: "this-model-destroyed" }, 6), heal()];
    expect(compiled(own).mechanics.trigger).toEqual({ event: "model-destroyed", object: "this-model", filter: { timing: "before-removal" } });
    expect(rendered(base, own).length).toBeGreaterThan(0);
    expect(compiled([leaf("EVENT", "event", { kind: "model-destroyed" }, 6), heal()]).mechanics.trigger).toEqual({ event: "model-destroyed", object: "model-in-this-unit" });
    // Having shot is the unit's shooting attacks resolved, in any phase; not a Shooting-phase condition.
    const shot = [leaf("EVENT", "event", { kind: "after-shooting" }, 6), heal()];
    expect(compiled(shot).mechanics.trigger).toEqual({ event: "attacks-resolved", filter: { kind: "shoot" } });
    expect(JSON.stringify(compiled(shot).mechanics)).not.toMatch(/phase-is/u);
    expect(rendered(base, shot).length).toBeGreaterThan(0);
  });

  it("compiles a supporting model as part of an attached unit, never as leading", () => {
    const grant = leaf("EFFECT", "fights-first", { subject: "this-unit" }, 2);
    const supporting = compiled([leaf("CONDITION", "leading-unit", { subject: "this-model", attachment: "supporting" }, 2), grant]);
    expect(supporting.mechanics.effect).toEqual({ type: "conditional", condition: { type: "attachment", parameters: { subject: "this-model", role: "attached" } }, effect: { type: "ability-grant", target: "this-unit", modifier: { ability: "fights-first" } } });
    expect(rendered(authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus"), [leaf("CONDITION", "leading-unit", { subject: "this-model", attachment: "supporting" }, 2), grant]).length).toBeGreaterThan(0);
    // A unit is attached whether it is led or supported: a supporting unit has no DSL condition.
    const unit = compileLeaves([leaf("CONDITION", "leading-unit", { subject: "this-unit", attachment: "supporting" }, 2), grant]);
    expect(unit.ok ? [] : unit.errors).toEqual([expect.stringMatching(/leading-unit supporting .*no DSL condition/u)]);
    expect(compiled([leaf("CONDITION", "leading-unit", { subject: "bearers-unit", attachment: "leading" }, 2), grant]).mechanics.effect)
      .toMatchObject({ condition: { type: "attachment", parameters: { subject: "this-model", role: "leading" } } });
  });

  it("writes once per battle as a usage count of one, never a one-use duration", () => {
    const once = compiled([leaf("RESTRICTION", "usage-limit", { frequency: "once-per-battle", per: "any" }), leaf("EFFECT", "fights-first", { subject: "this-unit" }, 2)]);
    expect(once.mechanics.usage).toEqual({ frequency: "n-per-battle", count: 1 });
    expect(JSON.stringify(once.mechanics)).not.toMatch(/one-use/u);
  });

  it("refuses a leaf still spelling the bearer, which only a retired version carries", () => {
    const stale = compileLeaves([leaf("EFFECT", "invulnerable-save", { subject: "bearer", threshold: 4 })]);
    expect(stale.ok ? [] : stale.errors).toEqual([expect.stringMatching(/subject "bearer" has no DSL target/u)]);
  });
});

describe("Round 5C leaf prefill", () => {
  const family = (id: string) => REVIEWED_FAMILY_REGISTRY.find((item) => item.id === id && item.version === currentFamilyVersion(id)) as unknown as PrefillFamily;
  const prefill = (id: string, text: string) => prefillFromSource(family(id), text);

  it("reads the bearer as this model and the bearer's unit as its unit, with either apostrophe", () => {
    for (const apostrophe of ["'", "\u2019"]) {
      expect(prefill("attack", `Each time a model in the bearer${apostrophe}s unit makes an attack`)).toMatchObject({ direction: "makes", unit: "bearers-unit" });
      expect(prefill("characteristic-modifier", `add 1 to the Strength characteristic of melee weapons equipped by models in the bearer${apostrophe}s unit`)).toMatchObject({ subject: "this-unit" });
      expect(prefill("act-after-move", `the bearer${apostrophe}s unit is eligible to shoot in a turn in which it Fell Back`)).toMatchObject({ subject: "this-unit" });
    }
    expect(prefill("attack", "Each time an attack targets the bearer")).toEqual({ direction: "targeted", attack_type: "any", unit: "this-model" });
    expect(prefill("regain-wounds", "the bearer regains D3 lost wounds")).toEqual({ subject: "this-model", amount: "D3" });
    expect(prefill("no-advance-roll", "the bearer does not make an Advance roll")).toEqual({ subject: "this-model" });
    expect(prefill("optional-use", "the bearer can use this Enhancement")).toEqual({ who: "this-model" });
  });

  it("reads curly apostrophes wherever a pattern names one", () => {
    expect(prefill("usage-limit", "once per your opponent\u2019s turn")).toMatchObject({ frequency: "once-per-opponent-turn" });
    expect(prefill("event", "At the start of your opponent\u2019s Command phase")).toEqual({ kind: "phase-start", phase: "command", turn: "opponent" });
    expect(prefill("unit-keyword", "that target can\u2019t **FLY**")).toMatchObject({ negated: true });
  });

  it("tells this model being destroyed from a model in this unit being destroyed", () => {
    expect(prefill("event", "When this model is destroyed")).toEqual({ kind: "this-model-destroyed" });
    expect(prefill("event", "Each time a model in this unit is destroyed")).toEqual({ kind: "model-destroyed" });
    expect(prefill("event", "After this unit has shot")).toEqual({ kind: "after-shooting" });
  });
});
