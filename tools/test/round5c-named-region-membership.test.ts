import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

/**
 * Named army regions (wave 9): a condition tests a unit against a region an army rule defines
 * (in-region@3 rule-region), a counts-as grant puts a unit inside one for a duration (counts-as@2
 * region), and a whole named-region-state ability admits no other leaf. Wording is fabricated.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = (): Record<string, unknown> => (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((entry) => entry.ability_id === "control-edict-adeptus-mechanicus")!;

const RULE_REGION = { region_kind: "rule-region", region_id: "flow-of-magic", owner_faction: "thousand-sons" };
const HALLOWED = { region_id: "hallowed-ground", owner_faction: "grey-knights" };

function leaf(role: "CONDITION" | "EFFECT", familyId: string, parameters: Record<string, unknown>, version = currentFamilyVersion(familyId)): CompileLeaf {
  return { role: familyRole(familyId, version), family_id: familyId, family_version: version, parameters, start_byte: 0 };
}

/** Leaves placed on their own wording in `text`, in order (fabricated wording). */
function placed(text: string, items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    return { ...leaf("EFFECT", family, parameters), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function conditionCase(parameters: Record<string, unknown>, expected: Record<string, unknown>): void {
  const result = compileLeaves([leaf("CONDITION", "in-region", parameters), leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })]);
  if (!result.ok) throw new Error(result.errors.join("; "));
  expect(result.mechanics.effect).toEqual({ type: "conditional", condition: expected, effect: { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } } });
}

describe("Round 5C named army regions: in-region rule-region", () => {
  it("is at version 3 and compiles a rule region as the rule_region of an in-region test", () => {
    expect(currentFamilyVersion("in-region")).toBe(3);
    conditionCase({ ...RULE_REGION, wholly: true, models: "every" },
      { type: "in-region", parameters: { region: { rule_region: { region_id: "flow-of-magic", owner_faction: "thousand-sons" } }, wholly: true, models: "every" } });
  });

  it("gates a melee re-roll on the bearer being on the defensive line (the 8751 shape)", () => {
    const text = "Each time the bearer makes a melee attack, if the bearer is on your defensive line, re-roll a Hit roll of 1.";
    const result = compileLeaves(placed(text, [
      ["Each time the bearer makes a melee attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "melee" }],
      ["if the bearer is on your defensive line", "in-region", { subject: "this-unit", region_kind: "rule-region", region_id: "defensive-line", owner_faction: "imperial-knights" }],
      ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }],
    ]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(JSON.stringify(result.mechanics.effect)).toContain('{"type":"in-region","parameters":{"subject":"this-unit","region":{"rule_region":{"region_id":"defensive-line","owner_faction":"imperial-knights"}}}}');
  });

  it("places a set-up wholly within a named army region (the 9751 shape)", () => {
    const text = "In your Movement phase, this unit can be set up anywhere on the battlefield that is wholly within your army's Flow of Magic.";
    const result = compileLeaves(placed(text, [
      ["In your Movement phase", "phase-window", { phase: "movement", turn: "your" }],
      ["this unit can be set up", "set-up", { subject: "this-unit", to: "battlefield", from: "strategic-reserves" }],
      ["wholly within your army's Flow of Magic", "in-region", { ...RULE_REGION, wholly: true }],
    ]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = (result.mechanics as unknown as { effect: { effect: Record<string, unknown> } }).effect;
    expect(effect.effect).toEqual({
      type: "set-up", target: "this-unit",
      modifier: { to: "battlefield", from: "strategic-reserves", in_region: { region: { rule_region: { region_id: "flow-of-magic", owner_faction: "thousand-sons" } }, wholly: true } },
    });
  });

  it("keeps the subject of a test on the attack's target (defender)", () => {
    conditionCase({ ...RULE_REGION, subject: "defender" },
      { type: "in-region", parameters: { subject: "defender", region: { rule_region: { region_id: "flow-of-magic", owner_faction: "thousand-sons" } } } });
  });

  it("refuses a rule region that carries a terrain tag or territory, or lacks its owner or id", () => {
    const normalize = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("in-region", parameters, 3);
    expect(() => normalize({ ...RULE_REGION, terrain_tag: "ruins" })).toThrow(/not terrain_tag or territory/u);
    expect(() => normalize({ ...RULE_REGION, territory: "no-mans-land" })).toThrow(/not terrain_tag or territory/u);
    expect(() => normalize({ region_kind: "rule-region", region_id: "flow-of-magic" })).toThrow(/owner_faction/u);
    expect(() => normalize({ region_kind: "rule-region", owner_faction: "thousand-sons" })).toThrow(/region_id/u);
    expect(() => normalize({ ...RULE_REGION, region_id: "Flow of Magic" })).toThrow(/kebab-case/u);
  });

  it("still refuses the rule region's keys on the terrain-area and territory kinds", () => {
    const normalize = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("in-region", parameters, 3);
    expect(() => normalize({ region_kind: "terrain-area", terrain_tag: "ruins", region_id: "flow-of-magic" })).toThrow();
    expect(() => normalize({ region_kind: "territory", territory: "no-mans-land", owner_faction: "thousand-sons" })).toThrow();
  });
});

describe("Round 5C named army regions: counts-as region grant", () => {
  const grant = (parameters: Record<string, unknown>) => {
    const result = compileLeaves([leaf("EFFECT", "counts-as", parameters)]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result.mechanics.effect;
  };

  it("is at version 2 and compiles a region grant to modifier.in_region", () => {
    expect(currentFamilyVersion("counts-as")).toBe(2);
    expect(grant({ subject: "this-unit", region: HALLOWED })).toEqual({
      type: "counts-as", target: "this-unit", modifier: { in_region: { rule_region: HALLOWED } },
    });
  });

  it("keeps the range form at version 2 exactly as before", () => {
    expect(grant({ subject: "this-model", within: 6 })).toEqual({ type: "counts-as", target: "this-model", modifier: { within: { inches: 6 } } });
  });

  it("refuses a range and a region together, a region on an enemy subject, and a malformed region", () => {
    const normalize = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("counts-as", parameters, 2);
    expect(() => normalize({ subject: "this-unit", within: 6, region: HALLOWED })).toThrow(/within or region, not both/u);
    expect(() => normalize({ subject: "enemy-units", region: HALLOWED })).toThrow();
    expect(() => normalize({ subject: "this-unit", region: { region_id: "hallowed-ground" } })).toThrow(/exactly region_id and owner_faction/u);
    expect(() => normalize({ subject: "this-unit", region: { ...HALLOWED, extra: 1 } })).toThrow(/exactly region_id and owner_faction/u);
    expect(() => normalize({ subject: "this-unit" })).toThrow();
  });

  it("binds the subject to the unit an earlier filter introduced (\"that unit is within your army's Hallowed Ground\")", () => {
    const list: CompileLeaf[] = [
      leaf("EFFECT", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }),
      leaf("EFFECT", "counts-as", { subject: "antecedent", region: HALLOWED }),
    ];
    const result = compileLeaves(list);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(JSON.stringify(result.mechanics.effect)).toContain('"in_region":{"rule_region":{"region_id":"hallowed-ground","owner_faction":"grey-knights"}}');
    expect(JSON.stringify(result.mechanics.effect)).toContain('"all_of":["ALPHA"]');
  });

  it("validates a grant for the rest of the phase against the ability schema", () => {
    const text = "Select one friendly ALPHA unit. That unit is within your army's Hallowed Ground until the end of the phase.";
    const bytes = Buffer.from(text, "utf8");
    const at = (wording: string) => bytes.indexOf(Buffer.from(wording, "utf8"));
    const span = (wording: string, family: string, parameters: Record<string, unknown>): CompileLeaf => ({
      ...leaf("EFFECT", family, parameters), start_byte: at(wording), end_byte: at(wording) + Buffer.byteLength(wording, "utf8"), fragment: "RAW_TEXT",
    });
    const result = compileLeaves([
      span("friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }),
      span("That unit is within your army's Hallowed Ground", "counts-as", { subject: "antecedent", region: HALLOWED }),
      span("until the end of the phase", "duration", { endpoint: "end-of-phase" }),
    ], text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect((result.mechanics as unknown as Record<string, any>).scope.duration).toBe("phase");
    expect(checkEntry(entryWithMechanics(base(), result.mechanics)).errors).toEqual([]);
  });
});

describe("Round 5C named army regions: named-region-state is the whole ability", () => {
  it("refuses the region leaf beside any other leaf, the same as an ability with two regions", () => {
    const region = leaf("EFFECT", "named-region-state", {
      region_id: "power-matrix", owner_faction: "necrons", behavior: "passive", membership_scope: "whole-unit",
      beneficiary_operator: "or", beneficiary_keywords: ["CRYPTEK", "CANOPTEK"], beneficiary_faction: "necrons",
      default_branch: { kind: "reroll", roll: "hit", subset: "ones", optional: true },
      qualified_branch: { kind: "reroll", roll: "hit", subset: "any", optional: true },
    });
    const alone = compileLeaves([region]);
    expect(alone.ok).toBe(true);
    const beside = compileLeaves([region, leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" })]);
    expect(beside.ok).toBe(false);
    if (!beside.ok) expect(beside.errors).toEqual(["named-region-state must be the ability's only leaf."]);
  });
});
