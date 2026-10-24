import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import type { CompileLeaf } from "../src/semantic-authoring/compile-fragments.js";
import { coreCheckErrors } from "../src/semantic-authoring/core-checks.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { mapToLatest } from "../src/semantic-authoring/family-versions.js";

let at = 0;
function leaf(family_id: string, parameters: Record<string, unknown>): CompileLeaf {
  const family_version = currentFamilyVersion(family_id);
  at += 10;
  return { role: familyRole(family_id, family_version), family_id, family_version, parameters: normalizeFingerprintParameters(family_id, parameters, family_version), start_byte: at };
}
const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

/** Every node in a compiled tree that satisfies a test. */
function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
}
function compiled(leaves: CompileLeaf[]): Record<string, unknown> {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, unknown>;
}

const heal = () => leaf("regain-wounds", { subject: "this-unit", amount: "1" });
const selectEnemy = () => leaf("select-unit", { scope: "enemy", distance: "any", visible: false });
const enemyEndsMove = () => leaf("event", { kind: "move-ended", owner: "enemy", move_types: ["normal"] });

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Semantic authoring family extensions", () => {
  it("keeps every earlier leaf of an extended family, which moves across unchanged", () => {
    for (const [family, parameters] of [
      ["bearer-eligibility", { keywords: ["CAPTAIN"], match: "all", excluded_keywords: [] }],
      ["unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "selected-unit", negated: false }],
      ["leading-unit", { subject: "this-model", attachment: "leading" }],
      ["event", { kind: "move-ended", owner: "enemy" }],
      ["roll-modifier", { roll: "charge", operation: "add", value: 1 }],
      ["rule-state", { subject: "this-unit", direction: "suppressed", rule_kind: "core-rule", rule: "benefit-of-cover" }],
      ["characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" }],
      ["make-move", { subject: "this-unit", move_type: "normal", distance: 6 }],
    ] as const) {
      const version = currentFamilyVersion(family);
      expect(normalizeFingerprintParameters(family, parameters, version - 1), family).toEqual(normalizeFingerprintParameters(family, parameters, version));
      expect(mapToLatest(family, version - 1, parameters), family).toEqual({ family, version, parameters: normalizeFingerprintParameters(family, parameters, version) });
    }
  });

  it("reads 'every keyword plus one of these' bearers and checks them against core groups", () => {
    const eligible = normalize("bearer-eligibility", { keywords: ["Adeptus Astartes"], any_keywords: ["MOUNTED", "INFANTRY"], match: "all", excluded_keywords: [] });
    expect(eligible).toEqual({ keywords: ["ADEPTUS ASTARTES"], any_keywords: ["INFANTRY", "MOUNTED"], match: "all", excluded_keywords: [] });
    // One-of keywords add to keywords all must have; with match any the reading is contradictory.
    expect(() => normalize("bearer-eligibility", { keywords: ["ADEPTUS ASTARTES"], any_keywords: ["INFANTRY", "MOUNTED"], match: "any", excluded_keywords: [] })).toThrow(/match must be all/u);
    expect(() => normalize("bearer-eligibility", { keywords: ["INFANTRY"], any_keywords: ["INFANTRY", "MOUNTED"], match: "all", excluded_keywords: [] })).toThrow(/both as required and as one of several/u);
    expect(() => normalize("bearer-eligibility", { keywords: ["ADEPTUS ASTARTES"], any_keywords: ["INFANTRY"], match: "all", excluded_keywords: [] })).toThrow(/at least 2/u);

    const root = mkdtempSync(join(tmpdir(), "semantic-authoring-extensions-"));
    roots.push(root);
    mkdirSync(join(root, "core", "alpha"), { recursive: true });
    // Fabricated fixture records only.
    writeFileSync(join(root, "core", "alpha", "enhancements.json"), JSON.stringify([
      { id: "split", keyword_restriction_groups: [["Adeptus Astartes", "Infantry"], ["Adeptus Astartes", "Mounted"]] },
      { id: "single", keyword_restriction_groups: [["Adeptus Astartes", "Infantry"]] },
      { id: "other", keyword_restriction_groups: [["Adeptus Astartes", "Infantry"], ["Adeptus Astartes", "Fly"]] },
    ]));
    const check = (abilityId: string) => coreCheckErrors(root, abilityId, [{ kind: "bearer-eligibility", parameters: eligible }]);
    expect(check("split")).toEqual([]);
    expect(check("single")[0]).toMatch(/ADEPTUS ASTARTES \+ \(INFANTRY or MOUNTED\), but core requires/u);
    expect(check("other")).toHaveLength(1);
  });

  it("measures a distance to any friendly unit with the named keywords, other than the subject when it says so", () => {
    const near = (extra: Record<string, unknown>) => leaf("unit-position", { kind: "within", inches: 6, subject: "this-model", negated: false, of: "matching-unit", of_keywords: ["harvester"], of_side: "friendly", ...extra });
    const ordinary = nodes(compiled([near({}), heal()]), (node) => node.type === "matches")[0]!;
    expect(ordinary.parameters).toEqual({ subject: "this-model", filter: { within: { of: { owner: "friendly", all_of: ["HARVESTER"] }, range: { inches: 6 } } } });
    const other = nodes(compiled([near({ of_other: true }), heal()]), (node) => node.type === "matches")[0]!;
    expect(other.parameters).toEqual({ subject: "this-model", filter: { within: { of: { owner: "friendly", all_of: ["HARVESTER"], excluding: "this-model" }, range: { inches: 6 } } } });
    // The filter belongs only to a measured distance to matching units.
    expect(() => normalize("unit-position", { kind: "within", inches: 6, subject: "this-unit", negated: false, of: "this-unit", of_keywords: ["HARVESTER"] })).toThrow(/only describes of: matching-unit/u);
    expect(() => normalize("unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, of: "matching-unit", of_keywords: ["HARVESTER"], of_side: "friendly" })).toThrow();
    expect(() => normalize("unit-position", { kind: "within", inches: 6, subject: "this-unit", negated: false, of: "matching-unit", of_keywords: ["HARVESTER"] })).toThrow(/of_side/u);
  });

  it("reads attached in any role as part of an attached unit, for the model or the unit", () => {
    const attached = (subject: string) => nodes(compiled([leaf("leading-unit", { subject, attachment: "any" }), heal()]), (node) => node.type === "attachment")[0];
    expect(attached("this-model")).toEqual({ type: "attachment", parameters: { role: "attached", subject: "this-model" } });
    expect(attached("this-unit")!.parameters).toEqual({ role: "attached", subject: "this-unit" });
    // Leading still means leading.
    expect(nodes(compiled([leaf("leading-unit", { subject: "this-model", attachment: "leading" }), heal()]), (node) => node.type === "attachment")[0]!.parameters)
      .toMatchObject({ role: "leading" });
  });

  it("names whose moment an event is, binding 'that unit' to the unit an earlier leaf introduced", () => {
    const moves = (subject: string) => leaf("event", { kind: "move-ended", move_types: ["normal"], subject });
    const trigger = (leaves: CompileLeaf[]) => compiled(leaves).trigger as Record<string, unknown>;
    expect(trigger([selectEnemy(), moves("antecedent"), heal()]).subject).toBe("selected-unit");
    // This unit is the default subject, so it is not written.
    expect(trigger([moves("this-unit"), heal()]).subject).toBeUndefined();
    expect(trigger([moves("this-model"), heal()]).subject).toBe("this-model");
    // Only a unit's own moment has a subject, and subject and owner never both say whose it is.
    expect(() => normalize("event", { kind: "phase-start", phase: "command", turn: "your", subject: "this-unit" })).toThrow();
    expect(() => normalize("event", { kind: "move-ended", owner: "enemy", subject: "antecedent" })).toThrow(/not both/u);
  });

  it("applies one roll change to each listed roll together", () => {
    const both = compiled([leaf("roll-modifier", { rolls: ["charge", "advance"], operation: "add", value: 1 })]);
    const steps = nodes(both, (node) => node.type === "roll-modifier").map((node) => (node.modifier as Record<string, unknown>).roll);
    expect(steps.sort()).toEqual(["advance", "charge"]);
    expect(nodes(both, (node) => node.type === "sequence")).toHaveLength(1);
    expect(() => normalize("roll-modifier", { roll: "hit", rolls: ["charge", "advance"], operation: "add", value: 1 })).toThrow(/not both/u);
    expect(() => normalize("roll-modifier", { operation: "add", value: 1 })).toThrow(/a roll or rolls/u);
    // Each listed roll must be one the single-roll leaf accepts.
    expect(() => normalize("roll-modifier", { rolls: ["charge", "psychic"], operation: "add", value: 1 })).toThrow();
  });

  it("denies cover to a selected unit or the attack's target as a suppressed core rule", () => {
    const denied = (subject: string, leaves: CompileLeaf[] = []) => nodes(compiled([...leaves, leaf("rule-state", { subject, direction: "suppressed", rule_kind: "core-rule", rule: "benefit-of-cover" })]), (node) => node.type === "rule-state")[0];
    expect(denied("antecedent", [selectEnemy()])).toMatchObject({ target: "selected-unit", modifier: { direction: "suppressed", rule: "benefit-of-cover" } });
    expect(denied("target")).toMatchObject({ target: "defender" });
  });

  it("changes a characteristic by a dice amount, a weapon's Range, or the triggering unit's models", () => {
    const stat = (parameters: Record<string, unknown>, leaves: CompileLeaf[] = []) => nodes(compiled([...leaves, leaf("characteristic-modifier", parameters)]), (node) => node.type === "stat-modifier")[0];
    expect(stat({ subject: "this-unit", characteristics: ["A"], operation: "add", value: "d3", weapon_type: "melee" })).toMatchObject({ modifier: { stat: "A", value: "D3", weapons: { type: "melee" } } });
    expect(stat({ subject: "this-unit", characteristics: ["Range"], operation: "add", value: 6, weapon_type: "ranged" })).toMatchObject({ modifier: { stat: "Range", value: 6, weapons: { type: "ranged" } } });
    // Range is a weapon characteristic: it needs a reviewed weapon scope before it compiles.
    expect(compileLeaves([leaf("characteristic-modifier", { subject: "this-unit", characteristics: ["Range"], operation: "add", value: 6 })]))
      .toMatchObject({ ok: false, errors: [expect.stringMatching(/weapon scope/u)] });
    expect(() => normalize("characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: "D7", weapon_type: "all" })).toThrow(/dice amount/u);
    expect(() => normalize("characteristic-modifier", { subject: "this-unit", characteristics: ["Range"], operation: "add", value: 6, weapon_type: "all" })).not.toThrow();
    expect(stat({ subject: "antecedent", characteristics: ["M"], operation: "subtract", value: 2, weapon_type: "all" }, [enemyEndsMove()])).toMatchObject({ target: "event-subject" });
  });

  it("lets the triggering unit make a move", () => {
    const move = nodes(compiled([enemyEndsMove(), leaf("make-move", { subject: "antecedent", move_type: "normal", distance: 6 })]), (node) => node.type === "move")[0];
    expect(move).toMatchObject({ target: "event-subject", modifier: { move_type: "normal", distance: 6 } });
  });
});
