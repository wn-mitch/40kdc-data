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
