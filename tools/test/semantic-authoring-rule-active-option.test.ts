import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { mapToLatest } from "../src/semantic-authoring/family-versions.js";

/**
 * rule-active v2: the active rule can be one option of an option-bearing rule
 * ({ability_id, option_id}: "the Protector Imperative is active for that unit"), lowered to the
 * condition schema's option reference. The string form keeps naming a whole ability record.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const option = { ability_id: "example-doctrines", option_id: "example-stance" };

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

function leaf(role: string, familyId: string, parameters: Record<string, unknown>, familyVersion: number, startByte: number): CompileLeaf {
  return { role, family_id: familyId, family_version: familyVersion, parameters, start_byte: startByte };
}

function compiledEffect(rule: Record<string, unknown>): unknown {
  const result = compileLeaves([
    leaf("CONDITION", "rule-active", normalizeFingerprintParameters("rule-active", rule, 2), 2, 10),
    leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" }, 1, 20),
  ]);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect;
}

describe("rule-active v2 option references", () => {
  it("is the current version, and v1 still takes only a whole-record id", () => {
    expect(currentFamilyVersion("rule-active")).toBe(2);
    expect(normalizeFingerprintParameters("rule-active", { rule: "oath-of-moment" }, 1)).toEqual({ rule: "oath-of-moment" });
    expect(() => normalizeFingerprintParameters("rule-active", { rule: option }, 1)).toThrow();
  });

  it("v2 canonicalises an option reference and keeps the string form and negation", () => {
    expect(normalizeFingerprintParameters("rule-active", { rule: { option_id: "example-stance", ability_id: "example-doctrines" }, negated: false }, 2))
      .toEqual({ rule: option, negated: false });
    expect(JSON.stringify(normalizeFingerprintParameters("rule-active", { rule: { option_id: "example-stance", ability_id: "example-doctrines" } }, 2)))
      .toBe('{"rule":{"ability_id":"example-doctrines","option_id":"example-stance"}}');
    expect(normalizeFingerprintParameters("rule-active", { rule: "oath-of-moment", negated: true }, 2)).toEqual({ rule: "oath-of-moment", negated: true });
  });

  it("v2 refuses an option reference that is incomplete, padded, or names a display label", () => {
    for (const rule of [
      { ability_id: "example-doctrines" },
      { option_id: "example-stance" },
      { ...option, name: "Example Stance" },
      { ability_id: "example-doctrines", option_id: "Example Stance" },
      { ability_id: "Example Doctrines", option_id: "example-stance" },
      { ability_id: "example-doctrines", option_id: "" },
      ["example-doctrines", "example-stance"],
    ]) expect(() => normalizeFingerprintParameters("rule-active", { rule }, 2)).toThrow();
    expect(() => normalizeFingerprintParameters("rule-active", { rule: option, extra: true }, 2)).toThrow();
  });

  it("moves a v1 leaf to v2 unchanged", () => {
    expect(mapToLatest("rule-active", 1, { rule: "oath-of-moment", negated: false })).toMatchObject({ version: 2, parameters: { rule: "oath-of-moment", negated: false } });
  });

  it("lowers an option reference to the condition schema's {ability_id, option_id} rule", () => {
    const reroll = { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } };
    expect(compiledEffect({ rule: option })).toEqual({ type: "conditional", condition: { type: "rule-active", parameters: { rule: option } }, effect: reroll });
    expect(compiledEffect({ rule: option, negated: true })).toEqual({
      type: "conditional", condition: { operator: "not", operands: [{ type: "rule-active", parameters: { rule: option } }] }, effect: reroll,
    });
    expect(compiledEffect({ rule: "oath-of-moment" })).toEqual({ type: "conditional", condition: { type: "rule-active", parameters: { rule: "oath-of-moment" } }, effect: reroll });
  });

  it("produces an entry that validates and renders on a real stance-consumer base", () => {
    const base = authored("adeptus-mechanicus", "murderous-imperative-adeptus-mechanicus");
    const result = compileLeaves([
      leaf("CONDITION", "rule-active", { rule: { ability_id: "doctrina-imperatives-adeptus-mechanicus", option_id: "option-1" } }, 2, 10),
      leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" }, 1, 20),
    ]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const check = checkEntry(entryWithMechanics(base, result.mechanics));
    expect(check.errors).toEqual([]);
    expect(check.rendered_text).toMatch(/active/iu);
  });
});
