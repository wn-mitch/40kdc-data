import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { mapToLatest } from "../src/round5c/family-versions.js";
import { prefillFromSource, type PrefillFamily } from "../src/round5c/leaf-prefill.js";
import { previewLeaf } from "../src/round5c/leaf-preview.js";

/**
 * Batch 1 (dice & rolls): ignore-modifiers, roll-auto-result, end-attack-sequence, and the
 * extended re-roll@2. Split out of round5c-compile.test.ts so this batch's cases live in their
 * own file, per the leaf-family batching brief.
 */

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

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

/** The compiled entry on a real authored base must validate against the ability schema, lint, and render. */
function rendered(base: Record<string, unknown>, leaves: CompileLeaf[]): string {
  const entry = entryWithMechanics(base, compiled(leaves).mechanics);
  const check = checkEntry(entry);
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

describe("Round 5C dice-family compiler", () => {
  const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("compiles ignore-modifiers, roll-auto-result and end-attack-sequence to the DSL's fixed shapes", () => {
    const cases: Array<[CompileLeaf, Record<string, unknown>]> = [
      [leaf("EFFECT", "ignore-modifiers", { subject: "this-unit", what: "characteristics" }),
        { type: "ignore-modifiers", target: "this-unit", modifier: { what: "characteristics" } }],
      [leaf("EFFECT", "ignore-modifiers", { subject: "this-unit", what: "characteristics", stats: ["WS", "BS"] }),
        { type: "ignore-modifiers", target: "this-unit", modifier: { what: "characteristics", stats: ["WS", "BS"] } }],
      [leaf("EFFECT", "ignore-modifiers", { subject: "this-model", what: "rolls", rolls: ["hit"], only: "worsening", weapon_type: "ranged" }),
        { type: "ignore-modifiers", target: "this-model", modifier: { what: "rolls", rolls: ["hit"], only: "worsening", weapon_type: "ranged" } }],
      [leaf("EFFECT", "roll-auto-result", { roll: "hit", outcome: "succeeds-on", value: 4, weapon_type: "ranged" }),
        { type: "roll-result", target: "this-unit", modifier: { roll: "hit", succeeds_on: 4, weapon_type: "ranged" } }],
      [leaf("EFFECT", "roll-auto-result", { roll: "hit", outcome: "counts-as-6" }),
        { type: "roll-result", target: "this-unit", modifier: { roll: "hit", result: 6 } }],
      [leaf("EFFECT", "roll-auto-result", { roll: "battle-shock", outcome: "auto-pass" }),
        { type: "roll-result", target: "this-unit", modifier: { roll: "battle-shock", result: "pass" } }],
      [leaf("EFFECT", "end-attack-sequence", {}), { type: "end-attack-sequence", target: "attacker" }],
    ];
    for (const [input, expected] of cases) {
      expect(compiled([input]).mechanics.effect).toEqual(expected);
      expect(rendered(base(), [input]).length).toBeGreaterThan(0);
    }
  });

  it("keeps the rolls/stats fields apart from what they belong to, in every render", () => {
    expect(previewLeaf({ family_id: "ignore-modifiers", parameters: { subject: "this-unit", what: "rolls", rolls: ["hit", "wound"] } }).text)
      .toBe("The unit ignores any modifiers to its Hit and Wound rolls.");
    expect(previewLeaf({ family_id: "ignore-modifiers", parameters: { subject: "this-model", what: "characteristics", stats: ["M"] } }).text)
      .toBe("This model ignores any modifiers to its Move characteristics.");
  });

  it("moves the attacker's rolls to the attacker when the effect targets this unit", () => {
    const attack = leaf("EVENT", "event", { kind: "attack-made" }, 2);
    const targeted = compiled([attack, leaf("EFFECT", "roll-auto-result", { roll: "hit", outcome: "auto-pass" })]);
    expect(targeted.mechanics.effect).toEqual({ type: "roll-result", target: "this-unit", modifier: { roll: "hit", result: "pass" } });
  });

  it("extends re-roll with an optional count and a weapon_type that defaults to omitted", () => {
    // Version 1 leaves have neither field and compile exactly as before.
    expect(compiled([leaf("EFFECT", "reroll", { roll: "hit", subset: "failed" })]).mechanics.effect)
      .toEqual({ type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "all-failures" } });
    // Version 2 adds them; "all" weapon_type is the DSL's default and is left off the fragment.
    expect(compiled([leaf("EFFECT", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }, 2)]).mechanics.effect)
      .toEqual({ type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } });
    expect(compiled([leaf("EFFECT", "reroll", { roll: "psychic", subset: "all", weapon_type: "melee", count: 1 }, 2)]).mechanics.effect)
      .toEqual({ type: "re-roll", target: "this-unit", modifier: { roll: "psychic", result_scope: "any-result", weapon_type: "melee", count: 1 } });
    expect(rendered(base(), [leaf("EFFECT", "reroll", { roll: "surge", subset: "ones", weapon_type: "all" }, 2)]).length).toBeGreaterThan(0);
  });

  it("widens re-roll's roll enum to the values the old proposal named", () => {
    for (const roll of ["attacks", "psychic", "surge", "hazard", "any", "resource-die", "blessings-of-khorne"]) {
      expect(() => normalizeFingerprintParameters("reroll", { roll, subset: "all", weapon_type: "all" }, 2)).not.toThrow();
    }
  });

  it("refuses a weapon_type on a roll that is a test, not an attack", () => {
    expect(() => normalizeFingerprintParameters("roll-auto-result", { roll: "leadership", outcome: "auto-pass", weapon_type: "melee" }, 1))
      .toThrow(/no meaning for the leadership test/u);
    expect(() => normalizeFingerprintParameters("roll-auto-result", { roll: "desperate-escape", outcome: "auto-pass", weapon_type: "ranged" }, 1))
      .toThrow(/no meaning for the desperate-escape test/u);
  });

  it("refuses rolls and stats on the wrong side of what, and a rolls leaf with no rolls named", () => {
    expect(() => normalizeFingerprintParameters("ignore-modifiers", { subject: "this-unit", what: "rolls", stats: ["M"] }, 1)).toThrow(/must be subject, what/u);
    expect(() => normalizeFingerprintParameters("ignore-modifiers", { subject: "this-unit", what: "characteristics", rolls: ["hit"] }, 1)).toThrow(/must be subject, what/u);
    expect(() => normalizeFingerprintParameters("ignore-modifiers", { subject: "this-unit", what: "rolls" }, 1)).toThrow(/ignore-modifiers.rolls/u);
  });

  it("previews end-attack-sequence with no modifier at all", () => {
    expect(compiled([leaf("EFFECT", "end-attack-sequence", {})]).mechanics.effect).toEqual({ type: "end-attack-sequence", target: "attacker" });
    expect(previewLeaf({ family_id: "end-attack-sequence", parameters: {} }).text).toBeTruthy();
  });

  it("extends fight-on-death with a shoot act that is a plain grant, no timing or roll", () => {
    // Version 1 (fight only) still compiles exactly as before.
    expect(compiled([leaf("EFFECT", "fight-on-death", { timing: "when-its-unit-fights" })]).mechanics.effect)
      .toEqual({ type: "act-on-death", target: "event-object", modifier: { act: "fight", resolution: "when-unit-fights", removal: "after-unit-fights-or-phase-end" } });
    // Version 2's shoot act names a subject instead of a timing, and carries no resolution/removal.
    expect(compiled([leaf("EFFECT", "fight-on-death", { act: "shoot", subject: "this-model" }, 2)]).mechanics.effect)
      .toEqual({ type: "act-on-death", target: "this-model", modifier: { act: "shoot" } });
    expect(compiled([leaf("EFFECT", "fight-on-death", { act: "shoot", subject: "this-unit" }, 2)]).mechanics.effect)
      .toEqual({ type: "act-on-death", target: "this-unit", modifier: { act: "shoot" } });
    // Version 2's fight act is unchanged from version 1.
    expect(compiled([leaf("EFFECT", "fight-on-death", { act: "fight", timing: "after-the-attacking-unit-finishes" }, 2)]).mechanics.effect)
      .toEqual({ type: "act-on-death", target: "event-object", modifier: { act: "fight", resolution: "after-attacking-unit-finishes", removal: "after-destroyed-model-fights" } });
    expect(rendered(base(), [leaf("EFFECT", "fight-on-death", { act: "shoot", subject: "this-unit" }, 2)])).toMatch(/can shoot before being removed/u);
  });

  it("migrates a fight-on-death@1 leaf to @2 by naming its act as fight", () => {
    expect(normalizeFingerprintParameters("fight-on-death", { timing: "when-its-unit-fights" }, 1)).toEqual({ timing: "when-its-unit-fights" });
    expect(mapToLatest("fight-on-death", 1, { timing: "when-its-unit-fights" })).toEqual({
      family: "fight-on-death", version: 2, parameters: { timing: "when-its-unit-fights", act: "fight" },
    });
  });

  it("refuses timing on a shoot act and a subject on a fight act", () => {
    expect(() => normalizeFingerprintParameters("fight-on-death", { act: "shoot", timing: "when-its-unit-fights" }, 2)).toThrow(/exactly: act, subject/u);
    expect(() => normalizeFingerprintParameters("fight-on-death", { act: "fight", subject: "this-model" }, 2)).toThrow(/exactly: act, timing/u);
  });
});

describe("Round 5C dice-family prefill", () => {
  const family = (id: string) => REVIEWED_FAMILY_REGISTRY.find((item) => item.id === id && item.version === currentFamilyVersion(id)) as unknown as PrefillFamily;
  const prefill = (id: string, text: string) => prefillFromSource(family(id), text);

  it("reads how many rolls a re-roll allows, when the wording names one", () => {
    expect(prefill("reroll", "you can re-roll one Hit roll")).toMatchObject({ count: 1 });
    expect(prefill("reroll", "you can re-roll a single Wound roll")).toMatchObject({ count: 1 });
    expect(prefill("reroll", "you can re-roll the Hit roll")).not.toHaveProperty("count");
  });

  it("reads ignore-modifiers' subject, what, and only from regular wording", () => {
    expect(prefill("ignore-modifiers", "This model's characteristics cannot be modified")).toMatchObject({ subject: "this-model", what: "characteristics" });
    expect(prefill("ignore-modifiers", "This unit's hit rolls cannot be modified")).toMatchObject({ subject: "this-unit", what: "rolls" });
    expect(prefill("ignore-modifiers", "the bearer's rolls cannot be affected by any negative modifiers")).toMatchObject({ subject: "this-model", what: "rolls", only: "worsening" });
  });

  it("reads roll-auto-result's outcome and its value when it succeeds only on an unmodified N+", () => {
    expect(prefill("roll-auto-result", "Hit rolls of 1 always automatically fail")).toEqual({});
    expect(prefill("roll-auto-result", "This model automatically passes Battle-shock tests")).toMatchObject({ outcome: "auto-pass" });
    expect(prefill("roll-auto-result", "This unit's hit rolls succeed only on an unmodified 5+")).toMatchObject({ outcome: "succeeds-on", value: 5 });
    expect(prefill("roll-auto-result", "This unit's hit rolls of 6 always count as an unmodified 6")).toMatchObject({ outcome: "counts-as-6" });
  });

  it("reads fight-on-death's act and, for shoot, its subject", () => {
    expect(prefill("fight-on-death", "When its unit fights, this model can fight")).toMatchObject({ act: "fight", timing: "when-its-unit-fights" });
    expect(prefill("fight-on-death", "This model can shoot before being removed from play")).toEqual({ act: "shoot", subject: "this-model" });
    expect(prefill("fight-on-death", "This unit can shoot before being removed from play")).toEqual({ act: "shoot", subject: "this-unit" });
  });
});
