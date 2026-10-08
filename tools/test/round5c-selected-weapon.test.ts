import { describe, expect, it } from "vitest";

import type { CompileLeaf } from "../src/round5c/compile-fragments.js";
import { compileLeaves } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

// Fabricated wording and parameters only. Leaves go through the registry's normalizer, as authored leaves do.

let offset = 0;
function leaf(family: string, parameters: Record<string, unknown>): CompileLeaf {
  const version = currentFamilyVersion(family);
  offset += 10;
  return {
    role: familyRole(family, version), family_id: family, family_version: version, start_byte: offset, end_byte: offset + 5,
    parameters: normalizeFingerprintParameters(family, parameters, version),
  };
}

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect;
}

function refusal(leaves: CompileLeaf[]): string {
  const result = compileLeaves(leaves);
  if (result.ok) throw new Error("expected a refusal");
  return result.errors.join("; ");
}

/** Every node in an effect tree, depth first. */
function nodes(node: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (node === null || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(nodes)];
}

describe("selected weapon: weapon-ability-grant weapon antecedent", () => {
  // "Once per turn, select one ranged weapon equipped by this model. That weapon has the [DEVASTATING WOUNDS] ability."
  const selectRanged = () => leaf("select-weapon", { target: "this-model", count: 1, weapon_type: "ranged", bind_as: "selected-weapon" });

  it("gives the keyword to the bound weapon, not every weapon of the type", () => {
    const effect = compiled([selectRanged(), leaf("weapon-ability-grant", { subject: "this-model", weapon: "antecedent", keyword: "Devastating Wounds" })]);
    const grants = nodes(effect).filter((node) => node.type === "weapon-ability-grant");
    expect(grants).toEqual([{
      type: "weapon-ability-grant", target: "this-model",
      modifier: { abilities: ["Devastating Wounds"], weapon_type: "ranged", weapon_ref: { weapon_var: "selected-weapon" } },
    }]);
    expect(nodes(effect).filter((node) => node.type === "select-weapon")).toHaveLength(1);
  });

  it("takes the bound weapon's type when the grant leaves it out", () => {
    const grant = leaf("weapon-ability-grant", { subject: "this-model", weapon: "antecedent", keyword: "Lethal Hits" });
    expect(grant.parameters).not.toHaveProperty("weapon_type");
    const grants = nodes(compiled([selectRanged(), grant])).filter((node) => node.type === "weapon-ability-grant");
    expect((grants[0]!.modifier as Record<string, unknown>).weapon_type).toBe("ranged");
  });

  it("refuses a grant with no earlier select-weapon to bind", () => {
    expect(refusal([leaf("weapon-ability-grant", { subject: "this-model", weapon: "antecedent", keyword: "Lethal Hits" })]))
      .toMatch(/no earlier select-weapon/);
  });

  it("refuses two select-weapon leaves before the grant, since the antecedent would be ambiguous", () => {
    expect(refusal([
      selectRanged(),
      leaf("select-weapon", { target: "this-model", count: 1, weapon_type: "melee", bind_as: "other-weapon" }),
      leaf("weapon-ability-grant", { subject: "this-model", weapon: "antecedent", keyword: "Lethal Hits" }),
    ])).toMatch(/ambiguous/);
  });

  it("refuses a select-weapon that binds several weapons", () => {
    expect(refusal([
      leaf("select-weapon", { target: "this-model", count: 2, weapon_type: "ranged", bind_as: "pair" }),
      leaf("weapon-ability-grant", { subject: "this-model", weapon: "antecedent", keyword: "Lethal Hits" }),
    ])).toMatch(/exactly one weapon/);
  });

  it("refuses a select-weapon with no weapon type, since the grant cannot say which weapon it means", () => {
    expect(refusal([
      leaf("select-weapon", { target: "this-model", bind_as: "any-weapon" }),
      leaf("weapon-ability-grant", { subject: "this-model", weapon: "antecedent", keyword: "Lethal Hits" }),
    ])).toMatch(/must name the bound weapon's type/);
  });

  it("refuses a select on another model's weapons", () => {
    expect(refusal([
      leaf("select-weapon", { target: "this-unit", count: 1, weapon_type: "ranged", bind_as: "unit-weapon" }),
      leaf("weapon-ability-grant", { subject: "this-model", weapon: "antecedent", keyword: "Lethal Hits" }),
    ])).toMatch(/on this model/);
  });

  it("refuses a stated weapon_type that differs from the bound weapon's", () => {
    expect(refusal([selectRanged(), leaf("weapon-ability-grant", { subject: "this-model", weapon: "antecedent", weapon_type: "melee", keyword: "Lethal Hits" })]))
      .toMatch(/conflicts with the bound ranged weapon/);
  });

  it("refuses the antecedent with a weapon filter, a frame, or a non-model subject, at the registry", () => {
    const grant = (extra: Record<string, unknown>) => () => leaf("weapon-ability-grant", { subject: "this-model", weapon: "antecedent", keyword: "Lethal Hits", ...extra });
    expect(grant({ weapon_name: "Blitzkannon" })).toThrow(/cannot also name weapon_name/);
    expect(grant({ weapon_keyword: "Assault" })).toThrow(/cannot also name weapon_keyword/);
    expect(grant({ weapon_type: "all" })).toThrow(/not all/);
    expect(() => leaf("weapon-ability-grant", { subject: "this-unit", weapon: "antecedent", keyword: "Lethal Hits" })).toThrow(/subject this-model/);
    expect(() => leaf("weapon-ability-grant", { subject: "this-model", weapon: "antecedent" })).toThrow(/one keyword/);
    expect(() => leaf("weapon-ability-grant", { subject: "this-model", weapon: "bearer", keyword: "Lethal Hits" })).toThrow(/antecedent or absent/);
  });

  it("keeps a grant without the antecedent unchanged: it still needs its weapon_type", () => {
    expect(() => leaf("weapon-ability-grant", { subject: "this-model", keyword: "Lethal Hits" })).toThrow(/needs weapon_type/);
    const plain = compiled([leaf("weapon-ability-grant", { subject: "this-model", keyword: "Lethal Hits", weapon_type: "ranged" })]);
    expect(plain).toEqual({ type: "weapon-ability-grant", target: "this-model", modifier: { abilities: ["Lethal Hits"], weapon_type: "ranged" } });
  });
});

describe("selected weapon: attack-filter weapon antecedent", () => {
  // "Ranged weapons of this unit have the [PSYCHIC] ability. Each time an attack is made with such a weapon, ..."
  const keywordGrant = (weaponType: string) => leaf("weapon-ability-grant", { subject: "this-unit", weapon_type: weaponType, keyword: "Lethal Hits" });

  it("names the attacks made with the weapons the earlier grant gave the keyword", () => {
    const effect = compiled([keywordGrant("ranged"), leaf("attack-filter", { weapon: "antecedent" })]);
    expect(nodes(effect).filter((node) => node.type === "attack-is")).toEqual([{ type: "attack-is", parameters: { weapon_keyword: "Lethal Hits", attack_type: "ranged" } }]);
  });

  it("names no attack type when the grant covers all weapons", () => {
    const effect = compiled([keywordGrant("all"), leaf("attack-filter", { weapon: "antecedent" })]);
    expect(nodes(effect).filter((node) => node.type === "attack-is")).toEqual([{ type: "attack-is", parameters: { weapon_keyword: "Lethal Hits" } }]);
  });

  it("keeps negation, and a stated attack_type that matches the grant", () => {
    const effect = compiled([keywordGrant("melee"), leaf("attack-filter", { weapon: "antecedent", attack_type: "melee", negated: true })]);
    expect(nodes(effect).filter((node) => node.type === "attack-is" || node.type === "not")).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "attack-is", parameters: { weapon_keyword: "Lethal Hits", attack_type: "melee" } }),
    ]));
  });

  it("refuses with no earlier keyword grant to bind", () => {
    expect(refusal([leaf("attack-filter", { weapon: "antecedent" })])).toMatch(/no earlier keyword grant/);
  });

  it("refuses a stated attack_type that differs from the grant's weapon type", () => {
    expect(refusal([keywordGrant("ranged"), leaf("attack-filter", { weapon: "antecedent", attack_type: "melee" })])).toMatch(/conflicts with the granted ranged/);
  });

  it("refuses to name the attacks of a grant already bound to one weapon, which would widen to its type", () => {
    const bound = [
      leaf("select-weapon", { target: "this-model", count: 1, weapon_type: "ranged", bind_as: "selected-weapon" }),
      leaf("weapon-ability-grant", { subject: "this-model", weapon: "antecedent", keyword: "Lethal Hits" }),
    ];
    expect(refusal([...bound, leaf("attack-filter", { weapon: "antecedent" })])).toMatch(/also names weapon_var/);
  });

  it("refuses to name the attacks of a grant narrowed by name, keyword or incoming attacks", () => {
    const narrowed = (extra: Record<string, unknown>) => refusal([
      leaf("weapon-ability-grant", { subject: "this-unit", weapon_type: "ranged", keyword: "Lethal Hits", ...extra }),
      leaf("attack-filter", { weapon: "antecedent" }),
    ]);
    expect(narrowed({ weapon_name: "Blitzkannon" })).toMatch(/also names weapon_name/);
    expect(narrowed({ weapon_keyword: "Assault" })).toMatch(/also names weapon_keyword/);
    expect(narrowed({ incoming: true })).toMatch(/also names incoming/);
  });

  it("refuses when the nearest keyword grant is narrowed, even after a broad one", () => {
    expect(refusal([
      keywordGrant("ranged"),
      leaf("weapon-ability-grant", { subject: "this-unit", weapon_type: "melee", keyword: "Lethal Hits", weapon_name: "Blitzkannon" }),
      leaf("attack-filter", { weapon: "antecedent" }),
    ])).toMatch(/also names weapon_name/);
  });

  it("refuses the antecedent beside the attacks of an earlier moment, or a filter that narrows it, at the registry", () => {
    expect(() => leaf("attack-filter", { weapon: "antecedent", weapon_name: "Exitus rifle" })).toThrow(/cannot narrow them/);
    expect(() => leaf("attack-filter", { weapon: "antecedent", shooting_type: "ranged" })).toThrow(/cannot narrow them/);
    expect(() => leaf("attack-filter", { weapon: "bearer" })).toThrow(/antecedent or absent/);
  });

  it("refuses the antecedent with of: antecedent, which names a different set of attacks", () => {
    expect(() => leaf("attack-filter", { weapon: "antecedent", of: "antecedent" })).toThrow();
  });
});

describe("selected weapon: the bound weapon across a sentence break", () => {
  // Two sentences: the select is in the first, the grant in the second. Sentence segmentation compiles each alone
  // and fails the grant, so the whole record compiles as one part and the grant still binds.
  const text = "At the start of the battle, select one ranged weapon. Each time the bearer is selected to fight, that weapon has the [LETHAL HITS] ability.";

  function placedAt(wording: string, family: string, parameters: Record<string, unknown>): CompileLeaf {
    const start = Buffer.byteLength(text.slice(0, text.indexOf(wording)));
    return { ...leaf(family, parameters), start_byte: start, end_byte: start + Buffer.byteLength(wording) };
  }

  it("binds the select in the first sentence to the grant in the second", () => {
    const leaves = [
      placedAt("select one ranged weapon", "select-weapon", { target: "this-model", count: 1, weapon_type: "ranged", bind_as: "selected-weapon" }),
      placedAt("that weapon has the [LETHAL HITS] ability", "weapon-ability-grant", { subject: "this-model", weapon: "antecedent", keyword: "Lethal Hits" }),
    ];
    const result = compileLeaves(leaves, text);
    expect(result.ok).toBe(true);
    const grants = nodes(result.ok ? result.mechanics.effect : null).filter((node) => node.type === "weapon-ability-grant");
    expect(grants).toHaveLength(1);
    expect((grants[0]!.modifier as Record<string, unknown>).weapon_ref).toEqual({ weapon_var: "selected-weapon" });
  });

  it("refuses the grant when the select is not in the record", () => {
    const leaves = [placedAt("that weapon has the [LETHAL HITS] ability", "weapon-ability-grant", { subject: "this-model", weapon: "antecedent", keyword: "Lethal Hits" })];
    const result = compileLeaves(leaves, text);
    expect(result.ok).toBe(false);
  });
});

describe("selected weapon: the unbound weapon-scope guard", () => {
  // Fabricated: "Once per battle, select one ranged weapon equipped by this model. Ranged weapons of this model have +2 A."
  const select = () => leaf("select-weapon", { target: "this-model", count: 1, weapon_type: "ranged", bind_as: "selected-weapon" });

  it("refuses a weapon-scoped stat with no weapon name beside a select-weapon, rather than widening it", () => {
    expect(refusal([
      select(),
      leaf("characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "improve", value: 2, weapon_type: "ranged" }),
    ])).toMatch(/sits beside a select-weapon.*must name its weapon/);
  });

  it("refuses a weapon-scoped grant with no weapon name beside a select-weapon", () => {
    expect(refusal([
      select(),
      leaf("weapon-ability-grant", { subject: "this-unit", weapon_type: "ranged", keyword: "Lethal Hits" }),
    ])).toMatch(/sits beside a select-weapon/);
  });

  it("accepts the same stat once it names its weapon", () => {
    const named = compiled([
      select(),
      leaf("characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "improve", value: 2, weapon_type: "ranged", weapon_name: "Test cannon" }),
    ]);
    expect(nodes(named).some((node) => node.type === "stat-modifier")).toBe(true);
  });

  it("leaves a record with no select-weapon unchanged: an unnamed weapon-type stat still compiles", () => {
    expect(() => compiled([
      leaf("characteristic-modifier", { subject: "this-unit", characteristics: ["A"], operation: "improve", value: 2, weapon_type: "ranged" }),
    ])).not.toThrow();
  });

  it("does not touch the keyword-grant and granted-weapon anaphor shapes, which name no select", () => {
    const grant = leaf("weapon-ability-grant", { subject: "this-unit", weapon_type: "ranged", keyword: "Psychic" });
    const filter = leaf("attack-filter", { weapon: "antecedent" });
    expect(() => compiled([grant, filter, leaf("roll-modifier", { roll: "wound", operation: "add", value: 1 })])).not.toThrow();
  });
});

describe("selected weapon: a bound grant with the usage, event and phase leaves around it", () => {
  // Fabricated wording. Shape of the once-per-battle "select a weapon, then it gains a keyword until the end of the phase" ability.
  const text = "Once per battle, when this unit is selected to shoot in your Shooting phase, select one ranged weapon equipped by this model. Until the end of the phase, that weapon has the [LETHAL HITS] ability.";
  function at(wording: string, family: string, parameters: Record<string, unknown>): CompileLeaf {
    const start = Buffer.byteLength(text.slice(0, text.indexOf(wording)));
    return { ...leaf(family, parameters), start_byte: start, end_byte: start + Buffer.byteLength(wording) };
  }

  it("compiles to a phase-bound, once-per-battle grant to the selected weapon only", () => {
    const leaves = [
      at("Once per battle", "usage-limit", { frequency: "once-per-battle", per: "unit" }),
      at("when this unit is selected to shoot", "event", { kind: "selected", to: "shoot" }),
      at("in your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }),
      at("select one ranged weapon equipped by this model", "select-weapon", { target: "this-model", count: 1, weapon_type: "ranged", bind_as: "selected-weapon" }),
      at("Until the end of the phase", "duration", { endpoint: "end-of-phase" }),
      at("that weapon has the [LETHAL HITS] ability", "weapon-ability-grant", { subject: "this-model", weapon: "antecedent", keyword: "Lethal Hits" }),
    ];
    const result = compileLeaves(leaves, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.scope).toEqual({ duration: "phase" });
    expect(result.mechanics.trigger).toEqual({ event: "selected", filter: { to: "shoot" } });
    const grants = nodes(result.mechanics.effect).filter((node) => node.type === "weapon-ability-grant");
    expect(grants).toEqual([expect.objectContaining({ modifier: expect.objectContaining({ weapon_ref: { weapon_var: "selected-weapon" } }) })]);
  });
});
