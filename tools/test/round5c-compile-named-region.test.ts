import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

/**
 * named-region-state (batch 5, follow-up): one leaf compiles a whole ability. Pinned against the
 * three authored records exactly — the fixed producer template (baseline, phase_extensions,
 * branch shape) is asserted by equality with what's actually on disk, not hand-copied.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

function leaf(parameters: Record<string, unknown>): CompileLeaf {
  return { role: "EFFECT", family_id: "named-region-state", family_version: 1, parameters, start_byte: 0 };
}

function compiled(parameters: Record<string, unknown>) {
  const result = compileLeaves([leaf(parameters)]);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

describe("Round 5C named-region-state compiler", () => {
  it("reproduces flow-of-magic-thousand-sons exactly: the aura-behavior, model-membership, weapon_keyword branch case", () => {
    const entry = authored("thousand-sons", "flow-of-magic-thousand-sons");
    const result = compiled({
      region_id: "flow-of-magic", owner_faction: "thousand-sons", behavior: "aura", membership_scope: "model",
      beneficiary_operator: "and", beneficiary_keywords: ["THOUSAND SONS"], beneficiary_faction: "thousand-sons",
      default_branch: { kind: "reroll", roll: "wound", subset: "ones", weapon_keyword: "Psychic", optional: false },
      qualified_branch: { kind: "roll-modifier", roll: "wound", operation: "add", value: 1, weapon_keyword: "Psychic", optional: false },
    });
    expect(result.mechanics.effect).toEqual(entry.effect);
    expect(result.mechanics.behavior).toEqual(entry.behavior);
    expect(result.mechanics.scope).toEqual(entry.scope);
  });

  it("reproduces power-matrix-necrons exactly: the passive-behavior, whole-unit-membership, any-result branch case", () => {
    const entry = authored("necrons", "power-matrix-necrons");
    const result = compiled({
      region_id: "power-matrix", owner_faction: "necrons", behavior: "passive", membership_scope: "whole-unit",
      beneficiary_operator: "or", beneficiary_keywords: ["CRYPTEK", "CANOPTEK"], beneficiary_faction: "necrons",
      default_branch: { kind: "reroll", roll: "hit", subset: "ones", optional: true },
      qualified_branch: { kind: "reroll", roll: "hit", subset: "any", optional: true },
    });
    expect(result.mechanics.effect).toEqual(entry.effect);
    expect(result.mechanics.behavior).toEqual(entry.behavior);
  });

  it("reproduces hallowed-ground-grey-knights exactly: the qualifies-by-keyword, attack_condition and proximity_extension case", () => {
    const entry = authored("grey-knights", "hallowed-ground-grey-knights");
    const result = compiled({
      region_id: "hallowed-ground", owner_faction: "grey-knights", behavior: "passive", membership_scope: "whole-unit",
      beneficiary_operator: "and", beneficiary_keywords: ["GREY KNIGHTS"],
      qualifies_by_keyword: "PURIFIER SQUAD", melee_or_visible_ranged: true,
      proximity_extension: { gate_ref: "purifier-sources", keywords: ["PURIFIER SQUAD"], radius_inches: 6 },
      default_branch: { kind: "reroll", roll: "hit", subset: "ones", optional: false },
      qualified_branch: { kind: "reroll", roll: "hit", subset: "any", optional: true },
    });
    expect(result.mechanics.effect).toEqual(entry.effect);
    expect(result.mechanics.behavior).toEqual(entry.behavior);
  });

  it("validates against the ability schema end to end", () => {
    const base = authored("grey-knights", "hallowed-ground-grey-knights");
    const result = compiled({
      region_id: "hallowed-ground", owner_faction: "grey-knights", behavior: "passive", membership_scope: "whole-unit",
      beneficiary_operator: "and", beneficiary_keywords: ["GREY KNIGHTS"],
      qualifies_by_keyword: "PURIFIER SQUAD", melee_or_visible_ranged: true,
      proximity_extension: { gate_ref: "purifier-sources", keywords: ["PURIFIER SQUAD"], radius_inches: 6 },
      default_branch: { kind: "reroll", roll: "hit", subset: "ones", optional: false },
      qualified_branch: { kind: "reroll", roll: "hit", subset: "any", optional: true },
    });
    const entry = entryWithMechanics(base, result.mechanics);
    const check = checkEntry(entry);
    expect(check.errors).toEqual([]);
  });

  it("refuses a named-region-state leaf that shares an ability with any other leaf", () => {
    const result = compileLeaves([
      leaf({
        region_id: "x", owner_faction: "y", behavior: "passive", membership_scope: "model",
        beneficiary_operator: "and", beneficiary_keywords: ["X"],
        default_branch: { kind: "reroll", roll: "hit", subset: "ones", optional: false },
        qualified_branch: { kind: "reroll", roll: "hit", subset: "any", optional: false },
      }),
      { role: "EFFECT", family_id: "fights-first", family_version: 2, parameters: { subject: "this-model" }, start_byte: 10 },
    ]);
    expect(result.ok).toBe(false);
  });
});
