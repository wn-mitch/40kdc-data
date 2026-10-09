import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { foldDestroyFilters } from "../src/round5c/compile-weapon-qualified.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { describeTrigger } from "../src/translate/trigger.js";

/** Leaves on their own wording in `text`, in order (the fabricated-wording style of round5c-targeted). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from };
  });
}

function compiled(list: CompileLeaf[], text: string) {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return JSON.stringify(result.mechanics);
}

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

describe("Round 5C weapon-qualified attack reference (wave 10)", () => {
  it("hit-by-attacks version 4 names the unit hit by object, and keeps subject forms", () => {
    expect(currentFamilyVersion("hit-by-attacks")).toBe(4);
    expect(normalize("hit-by-attacks", { subject: "antecedent" })).toEqual({ subject: "antecedent" });
    expect(normalize("hit-by-attacks", { subject: "target", window: "phase", by: "following-filter" })).toEqual({ subject: "target", window: "phase", by: "following-filter" });
    expect(normalize("hit-by-attacks", { object: "following-filter" })).toEqual({ object: "following-filter" });
    expect(normalize("hit-by-attacks", { object: "following-filter", window: "phase" })).toEqual({ object: "following-filter", window: "phase" });
    // Each refusal is a different defect: no unit named, two units named, or the unit-filter named as both hit unit and attacker.
    expect(() => normalize("hit-by-attacks", {})).toThrow(/subject, or object/u);
    expect(() => normalize("hit-by-attacks", { object: "following-filter", subject: "target" })).toThrow(/not both/u);
    expect(() => normalize("hit-by-attacks", { object: "following-filter", by: "following-filter", window: "phase" })).toThrow(/both the unit hit and the attacks' attacker/u);
    expect(() => normalize("hit-by-attacks", { object: "target" })).toThrow();
    // Version 3 keeps its subject form, and has no object form.
    const v3 = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("hit-by-attacks", parameters, 3);
    expect(v3({ subject: "antecedent", window: "phase", by: "following-filter" })).toEqual({ subject: "antecedent", window: "phase", by: "following-filter" });
    expect(() => v3({ object: "following-filter" })).toThrow();
  });

  it("unit-activity attack_type qualifies one destroyed-enemy-unit activity only", () => {
    expect(normalize("unit-activity", { subject: "this-unit", activities: ["destroyed-enemy-unit-this-phase"], negated: false, attack_type: "melee" })).toMatchObject({ attack_type: "melee", activities: ["destroyed-enemy-unit-this-phase"] });
    expect(normalize("unit-activity", { subject: "this-unit", activities: ["destroyed-enemy-unit-this-turn"], negated: false, attack_type: "ranged" })).toMatchObject({ attack_type: "ranged" });
    expect(() => normalize("unit-activity", { subject: "this-unit", activities: ["remained-stationary"], negated: false, attack_type: "melee" })).toThrow(/qualifies only a destroyed-enemy-unit/u);
    expect(() => normalize("unit-activity", { subject: "this-unit", activities: ["destroyed-enemy-unit-this-phase", "destroyed-enemy-unit-this-turn"], negated: false, attack_type: "melee" })).toThrow(/on its own/u);
    expect(() => normalize("unit-activity", { subject: "this-unit", activities: ["destroyed-enemy-unit-this-phase"], negated: false, attack_type: "fight" })).toThrow(/one of melee, ranged, psychic/u);
    // Without attack_type the version 14 leaf is unchanged.
    expect(normalize("unit-activity", { subject: "this-unit", activities: ["destroyed-enemy-unit-this-phase"], negated: false })).toEqual({ subject: "this-unit", activities: ["destroyed-enemy-unit-this-phase"], negated: false });
  });

  it("a melee destruction compiles its attack type into the destroyed history", () => {
    const text = "If this unit's melee attacks destroyed an enemy unit this phase, add 1 to the Wound roll.";
    const out = compiled(placed(text,
      ["If this unit's melee attacks destroyed an enemy unit this phase", "unit-activity", { subject: "this-unit", activities: ["destroyed-enemy-unit-this-phase"], negated: false, attack_type: "melee" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), text);
    expect(out).toContain(JSON.stringify({ type: "happened", parameters: { event: "destroyed", object: { owner: "enemy" }, filter: { by: "this-unit", attack_type: "melee" }, window: "phase" } }));
    // Without attack_type the history names no attack type: the same leaf before this change.
    const plain = compiled(placed(text,
      ["If this unit's melee attacks destroyed an enemy unit this phase", "unit-activity", { subject: "this-unit", activities: ["destroyed-enemy-unit-this-phase"], negated: false }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), text);
    expect(plain).toContain(JSON.stringify({ type: "happened", parameters: { event: "destroyed", object: { owner: "enemy" }, filter: { by: "this-unit" }, window: "phase" } }));
  });

  it("an attack-filter before a hit names the weapon of the hits (after-form, S1)", () => {
    const text = "Each time this model makes a ranged attack that targets a unit that was hit by one or more of those attacks made with a Graviton Crusher, add 1 to the Wound roll.";
    const out = compiled(placed(text,
      ["Each time this model makes a ranged attack", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" }],
      ["that targets a unit", "unit-filter", { side: "enemy" }],
      ["that was hit by one or more", "hit-by-attacks", { subject: "target" }],
      ["of those attacks made with a Graviton Crusher", "attack-filter", { weapon_name: "Graviton Crusher" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), text);
    expect(out).toContain(JSON.stringify({ type: "happened", parameters: { event: "after-roll", subject: "event-subject", object: "defender", filter: { roll: "hit", result: "success", weapon_name: "Graviton Crusher" }, window: "event" } }));
  });

  it("an attack-filter after a hit names the weapon keyword of the hits (S2)", () => {
    const text = "Each time this model makes a ranged attack that targets a unit that was hit by one or more attacks that had the [PSYCHIC] ability, add 1 to the Wound roll.";
    const out = compiled(placed(text,
      ["Each time this model makes a ranged attack", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" }],
      ["that targets a unit", "unit-filter", { side: "enemy" }],
      ["that was hit by one or more", "hit-by-attacks", { subject: "target" }],
      ["attacks that had the [PSYCHIC] ability", "attack-filter", { weapon_keyword: "PSYCHIC" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), text);
    expect(out).toContain('"filter":{"roll":"hit","result":"success","weapon_keyword":"PSYCHIC"}');
  });

  it("a before-form hit names the unit hit by the unit-filter after it (S3)", () => {
    const text = "Each time this model makes a ranged attack, if one or more of those attacks made with its Gloomhound cannon scored a hit against an enemy unit, add 1 to the Wound roll.";
    const list = placed(text,
      ["Each time this model makes a ranged attack", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" }],
      ["one or more of those attacks made with its Gloomhound cannon", "attack-filter", { weapon_name: "Gloomhound cannon" }],
      ["scored a hit against an", "hit-by-attacks", { object: "following-filter" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    );
    const out = compiled(list, text);
    expect(out).toContain(JSON.stringify({ type: "happened", parameters: { event: "after-roll", subject: "event-subject", object: { owner: "enemy" }, filter: { roll: "hit", result: "success", weapon_name: "Gloomhound cannon" }, window: "event" } }));
    expect(out).not.toContain('"object":"defender"');
  });

  it("a before-form hit keeps a printed weapon ability as weapon_keyword (S3, the Indirect Fire shape)", () => {
    const text = "Each time this model makes a ranged attack, if one or more of those attacks made with an Indirect Fire weapon scored a hit against an enemy unit, add 1 to the Wound roll.";
    const out = compiled(placed(text,
      ["Each time this model makes a ranged attack", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" }],
      ["one or more of those attacks made with an Indirect Fire weapon", "attack-filter", { weapon_keyword: "Indirect Fire" }],
      ["scored a hit against an", "hit-by-attacks", { object: "following-filter" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), text);
    expect(out).toContain('"filter":{"roll":"hit","result":"success","weapon_keyword":"Indirect Fire"}');
  });

  it("a before-form hit with a keyworded unit-filter after it keeps both (S3, the earthshaker shape)", () => {
    const text = "Each time this model makes a ranged attack, if one or more of those attacks made with its Ember lance scored a hit against an enemy INFANTRY unit, add 1 to the Wound roll.";
    const out = compiled(placed(text,
      ["Each time this model makes a ranged attack", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" }],
      ["one or more of those attacks made with its Ember lance", "attack-filter", { weapon_name: "Ember lance" }],
      ["scored a hit against an", "hit-by-attacks", { object: "following-filter" }],
      ["enemy INFANTRY unit", "unit-filter", { side: "enemy", keywords: ["INFANTRY"] }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), text);
    expect(out).toContain(JSON.stringify({ type: "happened", parameters: { event: "after-roll", subject: "event-subject", object: { owner: "enemy", all_of: ["INFANTRY"] }, filter: { roll: "hit", result: "success", weapon_name: "Ember lance" }, window: "event" } }));
  });

  it("refuses a before-form hit filter the DSL cannot hold, and a hit with nothing after it", () => {
    const text = "Each time this model makes a ranged attack, if one or more of those attacks made with its Gloomhound cannon scored a hit against an enemy unit, add 1 to the Wound roll.";
    const with_ = (filter: Record<string, unknown>) => placed(text,
      ["Each time this model makes a ranged attack", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" }],
      ["one or more of those attacks made with its Gloomhound cannon", "attack-filter", filter],
      ["scored a hit against an", "hit-by-attacks", { object: "following-filter" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    );
    const shooting = compileLeaves(with_({ weapon_name: "Gloomhound cannon", shooting_type: "indirect" }), text);
    expect(shooting.ok).toBe(false);
    expect(shooting.errors.join(" ")).toMatch(/names shooting_type; the DSL hit filter has no shooting_type/u);
    const negated = compileLeaves(with_({ weapon_name: "Gloomhound cannon", negated: true }), text);
    expect(negated.ok).toBe(false);
    // A leading hit with no unit-filter after it names no unit: the leaf is refused, not folded.
    const bare = compileLeaves(placed(text,
      ["Each time this model makes a ranged attack", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" }],
      ["one or more of those attacks made with its Gloomhound cannon", "attack-filter", { weapon_name: "Gloomhound cannon" }],
      ["scored a hit against an enemy unit", "hit-by-attacks", { object: "following-filter" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), text);
    expect(bare.ok).toBe(false);
  });

  it("refuses a before-form hit whose unit a later anaphor names, instead of binding it to the attacker", () => {
    // "until the start of your next turn, that enemy unit is pinned": the hit's unit is the unit-filter
    // after the hit, which that anaphor cannot reach yet. The compile must refuse, not name this unit.
    const text = "Each time this model makes a ranged attack, if one or more of those attacks made with its Doomweaver scored a hit against an enemy unit, until the start of your next turn, that enemy unit is pinned.";
    const result = compileLeaves(placed(text,
      ["Each time this model makes a ranged attack", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" }],
      ["one or more of those attacks made with its Doomweaver", "attack-filter", { weapon_name: "Doomweaver" }],
      ["scored a hit against an", "hit-by-attacks", { object: "following-filter" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }],
    ), text);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/points back to that unit, which cannot bind yet/u);
  });

  it("a melee attack that destroys an enemy unit makes the destruction a melee one (S4, pattern B)", () => {
    const text = "Each time this unit makes a melee attack that destroys an enemy unit, add 1 to the Wound roll.";
    const out = compiled(placed(text,
      ["Each time this unit makes a melee attack that", "attack", { direction: "makes", unit: "this-unit", attack_type: "melee" }],
      ["destroys an enemy unit", "event", { kind: "unit-destroyed", object_owner: "enemy" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), text);
    expect(JSON.parse(out).trigger).toEqual({ event: "destroyed", subject: "this-unit", object: { owner: "enemy" }, filter: { attack_type: "melee" } });
  });

  it("an attack-filter before a destruction names the weapon that destroys (S4, pattern A)", () => {
    const text = "Each time an attack made with this model's quake cannon destroys an enemy model, add 1 to the Wound roll.";
    const out = compiled(placed(text,
      ["Each time an attack made with this model's quake cannon", "attack-filter", { weapon_name: "quake cannon" }],
      ["destroys an enemy model", "event", { kind: "model-destroyed", by: "this-model", object_owner: "enemy" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), text);
    expect(JSON.parse(out).trigger).toEqual({ event: "model-destroyed", subject: "this-model", object: { owner: "enemy", level: "model" }, filter: { weapon_name: "quake cannon" } });
  });

  it("refuses destruction qualifiers the DSL cannot hold, and the Soul Trap timing gap", () => {
    const text = "Each time an attack made with this model's quake cannon destroys an enemy model, add 1 to the Wound roll.";
    const destroy = (filter: Record<string, unknown>) => compileLeaves(placed(text,
      ["Each time an attack made with this model's quake cannon", "attack-filter", filter],
      ["destroys an enemy model", "event", { kind: "model-destroyed", by: "this-model", object_owner: "enemy" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), text);
    const shooting = destroy({ weapon_name: "quake cannon", shooting_type: "indirect" });
    expect(shooting.ok).toBe(false);
    expect(shooting.errors.join(" ")).toMatch(/can name only/u);
    expect(destroy({ weapon_name: "quake cannon", negated: true }).ok).toBe(false);

    const noDestroyer = compileLeaves(placed(text,
      ["Each time an attack made with this model's quake cannon", "attack-filter", { weapon_name: "quake cannon" }],
      ["destroys an enemy model", "event", { kind: "model-destroyed", object_owner: "enemy" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), text);
    expect(noDestroyer.ok).toBe(false);
    expect(noDestroyer.errors.join(" ")).toMatch(/names its destroyer/u);

    // The gap is the same-attack timing only: an attacks-resolved moment with a subject does not refuse the destruction.
    const subjectText = "The first time the bearer makes a melee attack that destroys an enemy model, after the selected unit's attacks have been resolved, add 1 to the Wound roll.";
    const subjectTiming = compileLeaves(placed(subjectText,
      ["The first time the bearer makes a melee attack that", "attack", { direction: "makes", unit: "this-model", attack_type: "melee" }],
      ["destroys an enemy model", "event", { kind: "model-destroyed", by: "this-model", object_owner: "enemy" }],
      ["after the selected unit's attacks have been resolved", "event", { kind: "attacks-resolved", subject: "selected-unit" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), subjectText);
    expect(subjectTiming.ok ? "" : subjectTiming.errors.join(" ")).not.toMatch(/DSL gap/u);

    // Soul Trap shape: a melee attack that destroys, timed by "after all of that attack's attacks have been resolved".
    const soul = "The first time the bearer makes a melee attack that destroys an enemy model, after all of that attack's attacks have been resolved, add 1 to the Wound roll.";
    const gap = compileLeaves(placed(soul,
      ["The first time the bearer makes a melee attack that", "attack", { direction: "makes", unit: "this-model", attack_type: "melee" }],
      ["destroys an enemy model", "event", { kind: "model-destroyed", object_owner: "enemy" }],
      ["after all of that attack's attacks have been resolved", "event", { kind: "attacks-resolved", action_kind: "attack" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), soul);
    expect(gap.ok).toBe(false);
    expect(gap.errors.join(" ")).toMatch(/DSL gap/u);
  });

  it("describes a destruction by the attacks its filter names", () => {
    const quake = describeTrigger({ event: "model-destroyed", subject: "this-model", object: { owner: "enemy", level: "model" }, filter: { weapon_name: "quake cannon" } } as never);
    expect(quake).toContain("destroys an enemy model with a quake cannon attack");
    // A destruction with no attack filter reads as before: no attack phrase appended.
    const plain = describeTrigger({ event: "destroyed", object: { owner: "enemy" }, subject: "this-unit" } as never);
    expect(plain).not.toMatch(/ attack/u);
    const melee = describeTrigger({ event: "destroyed", object: { owner: "enemy" }, filter: { attack_type: "melee" } } as never);
    expect(melee).toContain("in melee");
    expect(melee.match(/in melee/gu)).toHaveLength(1);
  });

  it("an attack-filter after a hit names the attack type of the hits (S2, the Psychic Attack shape)", () => {
    const text = "Each time this model makes a ranged attack that targets a unit that was hit by one or more Psychic Attacks made by a PSYKER unit this phase, add 1 to the Wound roll.";
    const out = compiled(placed(text,
      ["Each time this model makes a ranged attack", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" }],
      ["that targets a unit", "unit-filter", { side: "enemy" }],
      ["that was hit by one or more", "hit-by-attacks", { subject: "target", window: "phase", by: "following-filter" }],
      ["Psychic Attacks made by a", "attack-filter", { attack_type: "psychic" }],
      ["PSYKER unit", "unit-filter", { side: "friendly", keywords: ["PSYKER"] }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), text);
    expect(out).toContain('"filter":{"roll":"hit","result":"success","attack_type":"psychic"}');
  });

  it("an attack-filter with no hit-by leaf beside it stays a standalone attack condition", () => {
    // "those attacks made with its Gloomhound cannon" with no hit after it: the filter is not folded into a hit.
    const text = "Each time this model makes a ranged attack, if one or more of those attacks made with its Gloomhound cannon, add 1 to the Wound roll.";
    const out = compiled(placed(text,
      ["Each time this model makes a ranged attack", "attack", { direction: "makes", unit: "this-model", attack_type: "ranged" }],
      ["one or more of those attacks made with its Gloomhound cannon", "attack-filter", { weapon_name: "Gloomhound cannon" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ), text);
    expect(out).toContain('"weapon_name":"Gloomhound cannon"');
    expect(out).not.toContain('"roll":"hit"');
  });

  it("refuses a destruction that already carries a destroy filter (fold-level check)", () => {
    const text = "Each time an attack made with this model's quake cannon destroys an enemy model, add 1 to the Wound roll.";
    const leaves = placed(text,
      ["Each time an attack made with this model's quake cannon", "attack-filter", { weapon_name: "quake cannon" }],
      ["destroys an enemy model", "event", { kind: "model-destroyed", by: "this-model", object_owner: "enemy" }],
    );
    const already = [leaves[0]!, { ...leaves[1]!, parameters: { ...leaves[1]!.parameters, destroy_filter: { attack_type: "ranged" } } }];
    expect(() => foldDestroyFilters(already, text)).toThrow(/already has one/u);
    // Without the prior filter the same pair folds into the destruction.
    expect(foldDestroyFilters(leaves, text)).toHaveLength(1);
  });
});
