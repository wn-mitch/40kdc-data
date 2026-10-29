import { describe, expect, it } from "vitest";

import { canonicalJson, conditionFactKey, conditionNeeds } from "../src/cruncher/condition-facts.js";
import { Dataset } from "../src/data/dataset.js";

const ds = Dataset.embedded();
// Executioner: +1 to hit with ranged attacks against a unit that is not below Half-strength.
const executioner = ds.abilities.getInFaction("executioner-adeptus-astartes", "adeptus-astartes")!;
const source = { kind: "ability" as const, abilityId: executioner.id, abilityKind: "unit" as const };

describe("canonicalJson", () => {
  it("serializes equal objects to equal text whatever their key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, "x"], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, "x"] }, b: 1 }));
    expect(canonicalJson({ b: 1, a: { d: [1, "x"], c: null } })).toBe('{"a":{"c":null,"d":[1,"x"]},"b":1}');
  });

  it("drops undefined members and keeps non-ASCII text unescaped", () => {
    expect(canonicalJson({ a: undefined, name: "Nurgle’s Gift" })).toBe('{"name":"Nurgle’s Gift"}');
  });
});

describe("condition facts", () => {
  const unset = executioner.describeBuffs(source, { phase: "shooting" }, "attacker");
  const needs = unset.unsupported.flatMap((fragment) => fragment.needs ?? []);

  it("reports only the undecided leaf, not the ranged-attack leaf the phase decides", () => {
    expect(unset.applied).toHaveLength(0);
    expect(needs).toHaveLength(1);
    expect(needs[0].condition.type).toBe("strength");
    expect(needs[0].key).toBe(conditionFactKey(needs[0].condition, "attacker"));
  });

  it("decides the leaf from a declared answer", () => {
    const declared = (answer: boolean) =>
      executioner.describeBuffs(source, { phase: "shooting", conditionFacts: { [needs[0].key]: answer } }, "attacker");
    // Exactly one answer applies the +1: the leaf sits under a "not".
    const below = declared(true);
    const notBelow = declared(false);
    expect(below.unsupported).toHaveLength(0);
    expect(notBelow.unsupported).toHaveLength(0);
    expect(below.applied.length + notBelow.applied.length).toBe(1);
  });

  it("lets context facts win over a declared answer", () => {
    const full = executioner.describeBuffs(source, { phase: "shooting", targetStrength: "full", conditionFacts: { [needs[0].key]: true } }, "attacker");
    expect(full.applied).toHaveLength(1);
  });

  it("ignores an answer declared from the other perspective", () => {
    const other = conditionFactKey(needs[0].condition, "target");
    expect(other).not.toBe(needs[0].key);
    expect(executioner.describeBuffs(source, { phase: "shooting", conditionFacts: { [other]: true } }, "attacker").applied).toHaveLength(0);
  });

  it("skips an operand that already decides an and", () => {
    const leaf = { type: "unit-state", parameters: { states: ["engaged"], subject: "target" } };
    const decided = conditionNeeds({ operator: "and", operands: [{ type: "x" }, leaf] }, "attacker", (node) =>
      node.operator ? false : node.type === "x" ? false : "unknown");
    expect(decided).toEqual([]);
    const open = conditionNeeds({ operator: "and", operands: [{ type: "x" }, leaf, leaf] }, "attacker", (node) =>
      node.type === "x" ? true : "unknown");
    expect(open.map((need) => need.condition)).toEqual([leaf]);
  });

  it("returns needs from stackableBuffsFor, tagged with the raising ability", () => {
    const unit = ds.units.all.find((u) => u.raw.ability_ids?.some((id) => (typeof id === "string" ? id : id.id) === executioner.id));
    expect(unit).toBeDefined();
    const { needs: leverNeeds } = ds.stackableBuffsFor(
      { unitId: unit!.id, factionId: unit!.raw.faction_id },
      { phase: "shooting" },
    );
    expect(leverNeeds.some((need) => need.abilityId === executioner.id && need.key === needs[0].key)).toBe(true);
  });

  it("returns the defending unit's undecided leaves from defensiveNeedsFor", () => {
    // Find a defensive rule whose condition the bare context leaves open, then answer it.
    const candidates = ds.units.all.slice(0, 400);
    const found = candidates
      .map((unit) => ({ unit, needs: ds.defensiveNeedsFor({ unitId: unit.id, factionId: unit.raw.faction_id }, { phase: "shooting" }) }))
      .find((entry) => entry.needs.length > 0);
    expect(found).toBeDefined();
    const need = found!.needs[0];
    expect(need.perspective).toBe("target");
    const answered = ds.defensiveNeedsFor(
      { unitId: found!.unit.id, factionId: found!.unit.raw.faction_id },
      { phase: "shooting", conditionFacts: { [need.key]: true } },
    );
    expect(answered.some((n) => n.key === need.key && n.abilityId === need.abilityId)).toBe(false);
  });
});
