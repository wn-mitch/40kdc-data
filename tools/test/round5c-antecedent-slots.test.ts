import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = (): Record<string, unknown> => (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((entry) => entry.ability_id === "control-edict-adeptus-mechanicus")!;

/** The compiled entry validates against the ability schema and renders. */
function checked(list: CompileLeaf[], text: string): string {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const check = checkEntry(entryWithMechanics(base(), result.mechanics));
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

function effectOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return (result.mechanics as unknown as Record<string, any>).effect;
}

const ALPHA = { owner: "friendly", all_of: ["ALPHA"] };
const friendlyAlpha = (wording: string): [string, string, Record<string, unknown>] => [wording, "unit-filter", { side: "friendly", keywords: ["ALPHA"] }];

describe("Round 5C antecedent slots: \"that unit\" after an earlier filter", () => {
  it("moves each filtered unit that meets its own condition", () => {
    const text = "If a friendly ALPHA unit is within range of an objective marker, that unit can make a Normal move of up to 3\".";
    const effect = effectOf(placed(text,
      friendlyAlpha("friendly ALPHA unit"),
      ["is within range of an objective marker", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "antecedent", negated: false }],
      ["that unit can make a Normal move of up to 3\"", "make-move", { subject: "antecedent", move_type: "normal", distance: 3 }]), text);
    expect(effect.type).toBe("conditional");
    expect(JSON.stringify(effect.condition)).toContain('"recipient"');
    expect(effect.effect).toMatchObject({ type: "move", target: ALPHA });
  });

  it("makes each filtered unit take its own test, and marks the filtered units", () => {
    const text = "If an enemy unit is within 6\" of this model, that unit must take a Battle-shock test. If an enemy unit is within 3\" of this model, that unit is Afflicted.";
    const effect = effectOf(placed(text,
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["is within 6\" of this model", "unit-position", { kind: "within", inches: 6, of: "this-model", subject: "antecedent", negated: false }],
      ["that unit must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["is within 3\" of this model", "unit-position", { kind: "within", inches: 3, of: "this-model", subject: "antecedent", negated: false }],
      ["that unit is Afflicted", "apply-mark", { subject: "antecedent", tag: "afflicted" }]), text);
    const text_ = JSON.stringify(effect);
    expect(checked(placed(text,
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["is within 6\" of this model", "unit-position", { kind: "within", inches: 6, of: "this-model", subject: "antecedent", negated: false }],
      ["that unit must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["is within 3\" of this model", "unit-position", { kind: "within", inches: 3, of: "this-model", subject: "antecedent", negated: false }],
      ["that unit is Afflicted", "apply-mark", { subject: "antecedent", tag: "afflicted" }]), text)).toMatch(/Battle-shock test/iu);
    expect(text_).not.toContain("filtered-units");
    expect(text_).toContain('"type":"test","target":{"owner":"enemy"}');
    expect(text_).toContain('"type":"designate","target":{"owner":"enemy"}');
  });

  it("names the filtered unit as the destroyer of a unit-destroyed moment", () => {
    const text = "Each time a friendly ALPHA unit destroys an enemy unit, that unit can make a Normal move of up to 3\".";
    const result = compileLeaves(placed(text,
      friendlyAlpha("friendly ALPHA unit"),
      ["destroys an enemy unit", "event", { kind: "unit-destroyed", by: "antecedent" }],
      ["that unit can make a Normal move of up to 3\"", "make-move", { subject: "antecedent", move_type: "normal", distance: 3 }]), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    const mechanics = result.mechanics as unknown as Record<string, any>;
    expect(mechanics.trigger.subject).toEqual(ALPHA);
    expect(JSON.stringify(mechanics)).not.toContain("filtered-units");
  });

  it("lets in-region test each filtered unit", () => {
    expect(normalizeFingerprintParameters("in-region", { subject: "antecedent", region_kind: "terrain-area", terrain_tag: "ruins" }, currentFamilyVersion("in-region")))
      .toMatchObject({ subject: "antecedent" });
    const text = "If a friendly ALPHA unit is within a ruins terrain area, that unit can make a Normal move of up to 3\".";
    const effect = effectOf(placed(text,
      friendlyAlpha("friendly ALPHA unit"),
      ["is within a ruins terrain area", "in-region", { subject: "antecedent", region_kind: "terrain-area", terrain_tag: "ruins" }],
      ["that unit can make a Normal move of up to 3\"", "make-move", { subject: "antecedent", move_type: "normal", distance: 3 }]), text);
    expect(effect.condition).toMatchObject({ type: "in-region", parameters: { subject: "recipient" } });
    expect(effect.effect).toMatchObject({ type: "move", target: ALPHA });
  });

  it("lets a filter's units move through models and be set up in Strategic Reserves", () => {
    const text = "Friendly ALPHA units can be placed into Strategic Reserves.";
    const effect = effectOf(placed(text,
      friendlyAlpha("Friendly ALPHA units"),
      ["can be placed into Strategic Reserves", "set-up", { subject: "antecedent", to: "strategic-reserves" }]), text);
    expect(effect).toMatchObject({ type: "set-up", target: ALPHA });
    expect(checked(placed(text,
      friendlyAlpha("Friendly ALPHA units"),
      ["can be placed into Strategic Reserves", "set-up", { subject: "antecedent", to: "strategic-reserves" }]), text)).toMatch(/ALPHA/u);
  });
});

describe("Round 5C attackers named by an earlier unit", () => {
  it("lets an enemy unit make the attack, narrowed by a filter right before it", () => {
    const bare = "Each time an enemy model makes an attack, subtract 1 from the Hit roll.";
    expect(effectOf(placed(bare,
      ["Each time an enemy model makes an attack", "attack", { direction: "makes", unit: "enemy-unit", attack_type: "any" }],
      ["subtract 1 from the Hit roll", "roll-modifier", { roll: "hit", operation: "subtract", value: 1 }]), bare))
      .toMatchObject({ type: "roll-modifier", target: { owner: "enemy" } });
    const filtered = "Each time an enemy MONSTER model makes an attack, subtract 1 from the Hit roll.";
    expect(effectOf(placed(filtered,
      ["enemy MONSTER model", "unit-filter", { side: "enemy", keywords: ["MONSTER"], level: "model" }],
      ["makes an attack", "attack", { direction: "makes", unit: "enemy-unit", attack_type: "any" }],
      ["subtract 1 from the Hit roll", "roll-modifier", { roll: "hit", operation: "subtract", value: 1 }]), filtered))
      .toMatchObject({ type: "roll-modifier", target: { owner: "enemy", all_of: ["MONSTER"], level: "model" } });
  });

  it("binds \"a model in that unit makes an attack\" to the aura's recipient, not this unit", () => {
    const text = "While a friendly ALPHA unit is within 6\" of this model, each time a model in that unit makes an attack, re-roll a Hit roll of 1.";
    const effect = effectOf(placed(text,
      friendlyAlpha("friendly ALPHA unit"),
      ["is within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["each time a model in that unit makes an attack", "attack", { direction: "makes", unit: "that-unit", attack_type: "any" }],
      ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }]), text);
    expect(effect.type).toBe("aura");
    expect(JSON.stringify(effect.modifier.effect)).toContain('"target":"recipient"');
    expect(JSON.stringify(effect.modifier.effect)).not.toContain('"target":"this-unit"');
  });

  it("gates the attack on a condition between the attacker's filter and the attack", () => {
    const text = "Each time a friendly model that made a Charge move this turn makes an attack, add 1 to the Hit roll.";
    const effect = effectOf(placed(text,
      ["friendly model", "unit-filter", { side: "friendly", level: "model" }],
      ["that made a Charge move this turn", "unit-activity", { activities: ["charged-this-turn"], subject: "antecedent", negated: false }],
      ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    expect(effect.type).toBe("conditional");
    expect(JSON.stringify(effect.condition)).toContain('"subject":"attacker"');
    expect(effect.effect).toMatchObject({ type: "roll-modifier", target: { owner: "friendly", level: "model" } });
  });

  it("reads the filter after \"an attack made by a\" as the attacker, not the target", () => {
    const text = "Each time an attack made by a friendly ALPHA model is resolved, add 1 to the Wound roll.";
    const effect = effectOf(placed(text,
      ["Each time an attack made by a", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["friendly ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }]), text);
    expect(effect).toMatchObject({ type: "roll-modifier", target: { owner: "friendly", all_of: ["ALPHA"], level: "model" } });
  });
});

/** The key paths at which a compiled tree holds a node that passes `test`. */
function pathsWhere(root: unknown, test: (node: Record<string, any>) => boolean, path = "$", out: string[] = []): string[] {
  if (Array.isArray(root)) root.forEach((item, index) => pathsWhere(item, test, `${path}[${index}]`, out));
  else if (root !== null && typeof root === "object") {
    if (test(root as Record<string, any>)) out.push(path);
    for (const [key, value] of Object.entries(root)) pathsWhere(value, test, `${path}.${key}`, out);
  }
  return out;
}
const attackerGate = (node: Record<string, any>) => node.type === "happened" && node.parameters?.subject === "attacker";

describe("Round 5C attacker gates on a designation are checked per attack", () => {
  // "In your Shooting phase ... select one enemy unit ..., each time a friendly ALPHA model that
  // disembarked from this TRANSPORT this turn makes an attack that targets that enemy unit": the
  // designation's effect is the attack's re-roll, gated on the attacker's disembark.
  const SHOT = "In your Shooting phase, after this model has shot, select one enemy unit hit by one or more of those attacks. Until the end of the phase, each time a friendly ALPHA model that disembarked from this TRANSPORT this turn makes an attack that targets that enemy unit, you can re-roll the Wound roll.";
  const SHOT_LEAVES: Array<[string, string, Record<string, unknown>]> = [
    ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["after this model has shot", "event", { kind: "after-shooting" }],
    ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["hit by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["friendly ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
    ["that disembarked from this TRANSPORT this turn", "unit-activity", { activities: ["disembarked-from-this-transport-this-turn"], subject: "antecedent", negated: false }],
    ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
    ["that targets that enemy unit", "target-is-selected", {}],
    ["you can re-roll the Wound roll", "reroll", { roll: "wound", subset: "all", weapon_type: "all" }],
  ];
  const swap = (from: string, to: [string, string, Record<string, unknown>]) =>
    SHOT_LEAVES.map((leaf) => (leaf[0] === from ? to : leaf));
  const compiled = (text: string, leaves: Array<[string, string, Record<string, unknown>]>): Record<string, any> => {
    const result = compileLeaves(placed(text, ...leaves), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result.mechanics as unknown as Record<string, any>;
  };

  it("checks the attacker's disembark gate on each attack, inside the designation", () => {
    const mechanics = compiled(SHOT, SHOT_LEAVES);
    expect(pathsWhere(mechanics.effect.condition, attackerGate)).toEqual([]);
    const applies = mechanics.effect.effect.applies.effect;
    expect(applies).toMatchObject({ type: "conditional", condition: { type: "happened", parameters: { subject: "attacker" } } });
    expect(applies.effect).toMatchObject({ type: "re-roll", modifier: { roll: "wound" } });
    checked(placed(SHOT, ...SHOT_LEAVES), SHOT);
  });

  it("keeps the attack type gate beside the attacker gate for a psychic attack", () => {
    const text = SHOT.replace("makes an attack", "makes a Psychic Attack");
    const leaves = swap("makes an attack", ["makes a Psychic Attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "psychic" }]);
    const mechanics = compiled(text, leaves);
    expect(pathsWhere(mechanics.effect.condition, attackerGate)).toEqual([]);
    expect(mechanics.effect.effect.applies.effect).toMatchObject({
      type: "conditional",
      condition: { operator: "and", operands: [{ type: "happened", parameters: { subject: "attacker" } }, { type: "attack-is", parameters: { attack_type: "psychic" } }] },
    });
  });

  it("keeps the usage limit at the top level while the attacker gate moves into the designation", () => {
    const text = "In your Shooting phase, after this model has shot, select one enemy unit hit by one or more of those attacks. Until the end of the turn, each time a friendly ALPHA model that disembarked from this TRANSPORT this turn makes an attack that targets that enemy unit, improve the Armour Penetration characteristic of that attack by 1. The same enemy unit can only be affected by this ability once per turn.";
    const leaves: Array<[string, string, Record<string, unknown>]> = [
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["after this model has shot", "event", { kind: "after-shooting" }],
      ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["hit by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }],
      ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
      ["friendly ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["that disembarked from this TRANSPORT this turn", "unit-activity", { activities: ["disembarked-from-this-transport-this-turn"], subject: "antecedent", negated: false }],
      ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["that targets that enemy unit", "target-is-selected", {}],
      ["improve the Armour Penetration characteristic of that attack by 1", "characteristic-modifier", { subject: "attack", characteristics: ["AP"], operation: "improve", value: 1, weapon_type: "all" }],
      ["once per turn", "usage-limit", { frequency: "once-per-turn", per: "unit" }],
    ];
    const mechanics = compiled(text, leaves);
    expect(mechanics.usage).toEqual({ frequency: "once-per-turn", per: "unit" });
    expect(pathsWhere(mechanics.effect.condition, attackerGate)).toEqual([]);
    expect(mechanics.effect.effect.applies.effect.condition).toMatchObject({ type: "happened", parameters: { subject: "attacker" } });
  });

  it("refuses the disembark gate when the attack verb has no attack leaf", () => {
    const leaves = SHOT_LEAVES.filter((leaf) => leaf[0] !== "makes an attack");
    expect(() => compiled(SHOT, leaves)).toThrow(/needs a select-unit or attack right before it|selected unit needs an attack leaf/);
  });

  it("refuses the disembark wording written as one attacks-resolved event (no attack leaf)", () => {
    // Record shape: the event spans "a model that disembarked ... makes an attack"; the target and the re-roll follow it.
    const text = "In your Shooting phase, after this model has shot, select one enemy unit hit by one or more of those attacks. Until the end of the phase, each time a model that disembarked from this TRANSPORT this turn makes an attack that targets that enemy unit, you can re-roll the Hit roll.";
    const leaves: Array<[string, string, Record<string, unknown>]> = [
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["after this model has shot", "event", { kind: "after-shooting" }],
      ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["hit by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["a model that disembarked from this TRANSPORT this turn makes an attack", "event", { kind: "attacks-resolved" }],
      ["that targets that enemy unit", "target-is-selected", {}],
      ["you can re-roll the Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all" }],
    ];
    expect(() => compiled(text, leaves)).toThrow(/needs an attack leaf/);
  });

  it("compiles the attacks-resolved rewrite as a unit-filter, a unit-activity and an attack", () => {
    const text = SHOT.replace("a friendly ALPHA model", "a model");
    const leaves = SHOT_LEAVES.map((leaf): [string, string, Record<string, unknown>] => leaf[0] === "friendly ALPHA model" ? ["a model", "unit-filter", { side: "friendly", level: "model" }] : leaf);
    const mechanics = compiled(text, leaves);
    expect(pathsWhere(mechanics.effect.condition, attackerGate)).toEqual([]);
    expect(mechanics.effect.effect.applies.effect.condition).toMatchObject({ type: "happened", parameters: { subject: "attacker" } });
  });
});
