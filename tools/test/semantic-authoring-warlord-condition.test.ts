import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { bindDesignationSubjects } from "../src/semantic-authoring/compile-conditions.js";
import { dslUnitFilter } from "../src/semantic-authoring/compile-unit-filter-dsl.js";
import { foldWarlordTests } from "../src/semantic-authoring/compile-warlord-test.js";
import { DESIGNATION_IDS, designationLabel, LIST_BUILDING_DESIGNATIONS } from "../src/translate/designations.js";
import { describeAbility } from "../src/translate/index.js";
import { stoplist } from "../src/mfm/mirror/outside.js";

type Item = [string, string, Record<string, unknown>];

/** Normalized leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT",
    };
  });
}

const warlordTest = (wording: string, subject: string | undefined = "antecedent"): Item =>
  [wording, "designated-filter", subject === undefined ? { tag: "warlord" } : { subject, tag: "warlord" }];

function compiledEffect(list: CompileLeaf[], text: string, abilityId?: string): Record<string, any> {
  const result = compileLeaves(list, text, abilityId === undefined ? undefined : { abilityId });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(list: CompileLeaf[], text: string): string[] {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics)}`);
  return result.errors;
}

/** "At the start of the battle round, if a model with this ability is your Warlord, gain 1CP." (fabricated) */
const BEARER_TEXT = (gain: string) => `At the start of the battle round, if a model with this ability is your Warlord, gain ${gain}.`;
const bearerLeaves = (gain: string): CompileLeaf[] => placed(BEARER_TEXT(gain),
  ["At the start of the battle round", "turn-start", { turn: "battle-round" }],
  ["a model with this ability", "unit-has-ability", { own: true, subject: "this-model" }],
  ["is your Warlord", "designated-filter", { subject: "this-model", tag: "warlord" }],
  [`gain ${gain.replace(/\*\*/g, "")}`.replace(/^gain /, "gain "), "resource-gain", { pool: "command-point", amount: 1 }]);

// Warlord is the list-building designation: the model chosen at mustering (wave 10 ruling).
describe("Warlord designation registry and refusals (T1, T12)", () => {
  it("registers warlord as a designation with the definite label the rules print", () => {
    expect(DESIGNATION_IDS.has("warlord")).toBe(true);
    expect(designationLabel("warlord")).toBe("the Warlord");
    expect(designationLabel("warlord", true)).toBe("the Warlord");
    expect([...LIST_BUILDING_DESIGNATIONS]).toEqual(["warlord"]);
  });

  it("reads warlord as a designated-filter tag and a unit-filter designation", () => {
    expect(() => normalizeFingerprintParameters("designated-filter", { subject: "this-model", tag: "warlord" }, currentFamilyVersion("designated-filter"))).not.toThrow();
    expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", keywords: ["ALPHA"], designated: "warlord" }, currentFamilyVersion("unit-filter"))).not.toThrow();
  });

  it("refuses warlord as an apply-mark tag, an event tag and an objective tag", () => {
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: "warlord" }, currentFamilyVersion("apply-mark"))).toThrow(/list-building designation/);
    expect(() => normalizeFingerprintParameters("event", { kind: "designation-changed", tag: "warlord" }, currentFamilyVersion("event"))).toThrow(/list-building designation/);
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "objective-range", objective: "designated", objective_tag: "warlord" }, currentFamilyVersion("unit-position"))).toThrow(/list-building designation/);
  });

  it("refuses a count of Warlords and a Warlord test with no subject", () => {
    const text = "While two units are your Warlord, add 1 to the Hit roll.";
    expect(errorsOf(placed(text,
      ["While two units are your Warlord", "designated-filter", { subject: "this-model", tag: "warlord", count_min: 2 }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text).join()).toMatch(/count of Warlords/);
    expect(() => compileLeaves(placed("If it is your Warlord, add 1 to the Hit roll.",
      ["is your Warlord", "designated-filter", { subject: "this-model", tag: "warlord" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), "If it is your Warlord, add 1 to the Hit roll.")).not.toThrow();
  });

  it("keeps a Warlord test out of the subject binding that gives a subject-less designation its next effect's unit", () => {
    const text = "While a unit is your Warlord, add 1 to the Hit roll.";
    const list = placed(text,
      ["While a unit is your Warlord", "designated-filter", { tag: "warlord" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    const bound = bindDesignationSubjects(list);
    expect(bound[0]!.parameters.subject).toBeUndefined();
    expect(errorsOf(list, text).join()).toMatch(/A Warlord test has no subject/);
  });

  it("names the Warlord in the stop-set that keeps code literals untouched", () => {
    expect(stoplist(fileURLToPath(new URL("../../", import.meta.url))).has("warlord")).toBe(true);
  });
});

describe("Warlord test on a unit-filter (T2, T3, T4)", () => {
  it("refuses a Warlord unit-filter on a selection or a Stratagem target", () => {
    const text = "One friendly ALPHA unit that is your Warlord.";
    const errors = errorsOf(placed(text,
      ["One", "stratagem-target", { count: "one" }],
      ["friendly ALPHA unit that is your Warlord", "unit-filter", { side: "friendly", keywords: ["ALPHA"], designated: "warlord" }]), text);
    expect(errors.join()).toMatch(/static Stratagem TARGET metadata/u);
  });

  it("throws when dslUnitFilter reads a Warlord filter without the opt-in", () => {
    const [filter] = placed("friendly ALPHA unit that is your Warlord", ["friendly ALPHA unit that is your Warlord", "unit-filter", { side: "friendly", keywords: ["ALPHA"], designated: "warlord" }]);
    expect(() => dslUnitFilter(filter!)).toThrow(/Warlord/);
    expect(dslUnitFilter(filter!, { warlordTest: true })).toMatchObject({ owner: "friendly", all_of: ["ALPHA"], designated: "warlord" });
  });

  it("preserves a Warlord designation on an attack's target filter", () => {
    const text = "Each time a model in this unit makes an attack that targets a friendly ALPHA unit that is your Warlord, add 1 to the Hit roll.";
    const mechanics = compiledEffect(placed(text,
      ["Each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["that targets a friendly ALPHA unit that is your Warlord", "unit-filter", { side: "friendly", keywords: ["ALPHA"], designated: "warlord" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    expect(mechanics.effect.condition).toEqual({ type: "matches", parameters: { subject: "defender", filter: { all_of: ["ALPHA"], designated: "warlord" } } });
  });
});

describe("\"Your army includes a Warlord\" gate (S2: 7163 shape)", () => {
  const text = "If a friendly Alpha Officer model is your Warlord, friendly Beta units have:\rBattleline.\r+1 OC.";
  const gate = (): CompileLeaf[] => placed(text,
    ["If a", "army-includes", { quantifier: "some", with: "following-filter" }],
    ["friendly Alpha Officer model", "unit-filter", { side: "friendly", keywords: ["ALPHA", "OFFICER"], level: "model" }],
    warlordTest("is your Warlord"),
    ["friendly Beta units", "unit-filter", { side: "friendly", keywords: ["BETA"] }],
    ["Battleline", "keyword-grant", { subject: "antecedent", keywords: ["BATTLELINE"] }],
    ["+1 OC", "characteristic-modifier", { subject: "antecedent", characteristics: ["OC"], operation: "improve", value: 1 }]);

  it("folds the Warlord test onto the Officer filter as designated: warlord, keeping its level", () => {
    const folded = foldWarlordTests(gate());
    expect(folded.some((leaf) => leaf.family_id === "designated-filter")).toBe(false);
    const officer = folded.find((leaf) => leaf.parameters.keywords && (leaf.parameters.keywords as string[]).includes("OFFICER"))!;
    expect(officer.parameters).toEqual({ side: "friendly", keywords: ["ALPHA", "OFFICER"], level: "model", designated: "warlord" });
    const beta = folded.find((leaf) => leaf.family_id === "unit-filter" && (leaf.parameters.keywords as string[] | undefined)?.includes("BETA"))!;
    expect(beta.parameters.designated).toBeUndefined();
  });

  it("gates the Beta effects on the army including a Warlord Officer model", () => {
    const effect = compiledEffect(gate(), text).effect;
    expect(effect).toMatchObject({
      type: "conditional",
      condition: { type: "army-includes", parameters: { filter: { owner: "friendly", all_of: ["ALPHA", "OFFICER"], level: "model", designated: "warlord" } } },
      effect: { type: "sequence", steps: [
        { type: "keyword-grant", target: { owner: "friendly", all_of: ["BETA"] }, modifier: { keywords: ["BATTLELINE"] } },
        { type: "stat-modifier", target: { owner: "friendly", all_of: ["BETA"] }, modifier: { stat: "OC", operation: "improve", value: 1 } },
      ] },
    });
  });

  it("throws when a Warlord test has no unit-filter before it", () => {
    const list = placed("If it is your Warlord, friendly Beta units have Battleline.",
      ["If it is your Warlord", "designated-filter", { subject: "antecedent", tag: "warlord" }],
      ["friendly Beta units", "unit-filter", { side: "friendly", keywords: ["BETA"] }]);
    expect(() => foldWarlordTests(list)).toThrow(/needs the unit it tests named just before it/);
  });

  it("throws when the unit it tests already carries another designation", () => {
    const list = placed("If a friendly Alpha model is afflicted and your Warlord, friendly Beta units have Battleline.",
      ["friendly Alpha model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model", designated: "afflicted" }],
      warlordTest("your Warlord"));
    expect(() => foldWarlordTests(list)).toThrow(/already afflicted/);
  });
});

describe("Bearer condition on the Warlord (S3: 9113 shape and duplicates, T5 and T6)", () => {
  it("compiles the turn-start gate to has-ability and designated on this model, with one command point", () => {
    const mechanics = compiledEffect(bearerLeaves("1CP"), BEARER_TEXT("1CP"), "da-boss-orks");
    expect(mechanics.trigger).toEqual({ event: "round-started" });
    expect(mechanics.effect).toEqual({
      type: "conditional",
      condition: { operator: "and", operands: [
        { type: "matches", parameters: { subject: "this-model", filter: { has_ability: ["da-boss-orks"] } } },
        { type: "matches", parameters: { subject: "this-model", filter: { designated: "warlord" } } },
      ] },
      effect: { type: "cp-gain", target: "this-model", modifier: { amount: 1 } },
    });
  });

  it("gives the same tree for a duplicate whose wording differs only in bold markup", () => {
    const plain = compiledEffect(bearerLeaves("1CP"), BEARER_TEXT("1CP"), "da-boss-orks");
    const bold = compiledEffect(placed(BEARER_TEXT("1**CP**"),
      ["At the start of the battle round", "turn-start", { turn: "battle-round" }],
      ["a model with this ability", "unit-has-ability", { own: true, subject: "this-model" }],
      ["is your Warlord", "designated-filter", { subject: "this-model", tag: "warlord" }],
      ["gain 1**CP", "resource-gain", { pool: "command-point", amount: 1 }]), BEARER_TEXT("1**CP**"), "da-boss-orks");
    expect(bold).toEqual(plain);
  });

  it("describes the gate as \"while this model is the Warlord\"", () => {
    const mechanics = compiledEffect(bearerLeaves("1CP"), BEARER_TEXT("1CP"), "da-boss-orks");
    const text = describeAbility({ effect: mechanics.effect as never, scope: { duration: "permanent" } });
    expect(text).toContain("while this model is the Warlord");
  });
});

describe("Attack named again by its attacker (S4 refusal, 7087 shape)", () => {
  it("refuses a made-by attacker on an earlier attack rather than binding the unit as the target", () => {
    const text = "Until the end of the phase, each time a model in your unit makes an attack, re-roll a Wound roll of 1. If that attack is made by an OFFICIO model, you can re-roll the Wound roll instead.";
    const errors = errorsOf(placed(text,
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["each time a model in your unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["re-roll a Wound roll of 1", "reroll", { roll: "wound", subset: "ones", weapon_type: "all" }],
      ["that attack", "attack", { refers: "earlier-attack" }],
      ["OFFICIO model", "unit-filter", { side: "friendly", keywords: ["OFFICIO"], level: "model" }]), text);
    expect(errors.join()).toMatch(/named again by its attacker/);
  });
});

describe("Warlord test refused on an aura, a for-each and a unit-filter target (T2, T3)", () => {
  const warlordRefusal = /Warlord|designat/iu;

  it("refuses a Warlord unit-filter on an aura's range", () => {
    const text = "Friendly ALPHA units within 6 inches that are your Warlord have Battleline.";
    expect(errorsOf(placed(text,
      ["Friendly ALPHA units within 6 inches", "aura-range", { side: "friendly", inches: 6 }],
      ["that are your Warlord", "unit-filter", { side: "friendly", keywords: ["ALPHA"], designated: "warlord" }],
      ["have Battleline", "keyword-grant", { subject: "antecedent", keywords: ["BATTLELINE"] }]), text).join()).toMatch(warlordRefusal);
  });

  it("refuses a Warlord unit-filter on a for-each's units", () => {
    const text = "For each friendly ALPHA unit that is your Warlord, add 1 to the Hit roll.";
    expect(errorsOf(placed(text,
      ["For each", "for-each-unit-select", {}],
      ["friendly ALPHA unit that is your Warlord", "unit-filter", { side: "friendly", keywords: ["ALPHA"], designated: "warlord" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text).join()).toMatch(warlordRefusal);
  });

  it("compiles a Warlord unit-filter as an attack's target: the defender is the Warlord's unit (T7 SS-L)", () => {
    const text = "Each time a model in this unit makes an attack that targets the enemy WARLORD, add 1 to the Hit roll.";
    const [attack, roll] = placed(text,
      ["Each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    // unit-filter-target is derived by the folds, not a reviewed family, so the leaf is built directly.
    const wording = "that targets the enemy WARLORD";
    const start = text.indexOf(wording);
    const target: CompileLeaf = { role: "CONDITION", family_id: "unit-filter-target", family_version: 1, parameters: { side: "enemy", designated: "warlord" }, start_byte: start, end_byte: start + wording.length, fragment: "RAW_TEXT" };
    const effect = compiledEffect([attack!, target, roll!], text).effect;
    expect(JSON.stringify(effect)).toContain('{"type":"matches","parameters":{"subject":"defender","filter":{"designated":"warlord"}}}');
  });
});

describe("Army construction names no designation but the Warlord (T4)", () => {
  it("refuses a Warlord filter in a composition rule, since composition has no designation shape", () => {
    const text = "You must include one ALPHA model that is your Warlord.";
    expect(errorsOf(placed(text,
      ["You must include", "army-construction", { rule: "composition", max: 1, with: "following-filter" }],
      ["one ALPHA model that is your Warlord", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model", designated: "warlord" }]), text).join()).toMatch(/Warlord/);
  });

  it("refuses a composition group that names a battle-time designation", () => {
    const text = "You must include one ALPHA model that is afflicted.";
    expect(errorsOf(placed(text,
      ["You must include", "army-construction", { rule: "composition", max: 1, with: "following-filter" }],
      ["one ALPHA model that is afflicted", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model", designated: "afflicted" }]), text).join()).toMatch(/designation/);
  });
});

describe("A trigger sentence after a Warlord-gated list (7163 shape)", () => {
  it("refuses the record instead of gating the trigger's ability-part on the Warlord", () => {
    const text = "If a friendly Alpha Officer model is your Warlord, friendly Beta units have:\rBattleline.\r+1 OC.\rWhen a friendly Alpha unit is selected to shoot, that unit's attacks have +1 to hit rolls.";
    const list = placed(text,
      ["If a", "army-includes", { quantifier: "some", with: "following-filter" }],
      ["friendly Alpha Officer model", "unit-filter", { side: "friendly", keywords: ["ALPHA", "OFFICER"], level: "model" }],
      warlordTest("is your Warlord"),
      ["friendly Beta units", "unit-filter", { side: "friendly", keywords: ["BETA"] }],
      ["Battleline", "keyword-grant", { subject: "antecedent", keywords: ["BATTLELINE"] }],
      ["+1 OC", "characteristic-modifier", { subject: "antecedent", characteristics: ["OC"], operation: "improve", value: 1 }],
      ["friendly Alpha unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["is selected to shoot", "event", { kind: "selected", to: "shoot" }],
      ["+1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(errorsOf(list, text).join()).toMatch(/separate rule/);
  });
});
