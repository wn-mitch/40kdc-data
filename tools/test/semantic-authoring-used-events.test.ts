import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { foldAbilityUseRefresh } from "../src/semantic-authoring/compile-ability-use-refresh.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { menuActionsForAbility } from "../src/semantic-authoring/named-ability-checks.js";

type Node = Record<string, unknown>;
function fixture(per: "model" | "army", sources: string[], printedDuration = true): CompileLeaf[] {
  const rows: Array<[string, string, Node]> = [
    ["WHEN", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["command", "movement", "shooting", "charge", "fight"] }],
    ["WHEN", "unit-filter", { side: "friendly", level: "model", keywords: ["EXAMPLE"] }],
    ["WHEN", "event", { kind: "used", activity: "ability", source: sources, usage: { frequency: "n-per-battle", count: 1 }, bind_as: "used-ability" }],
    ["WHEN", "usage-limit", { frequency: "once-per-battle" }],
    ["TARGET", "triggering-target", { selects: "model", keywords: ["EXAMPLE"], match: "all" }],
    ["EFFECT", "usage-limit", { frequency: "once-per-battle" }],
    ["EFFECT", "ability-modifier", { subject: "this-model", ability: { event: "used", event_var: "used-ability" }, aspect: "uses", operation: "add", value: 1, not_same: "phase" }],
    ["EFFECT", "duration", { endpoint: "end-of-battle" }],
    ["RESTRICTIONS", "usage-limit", { frequency: "once-per-battle", per }],
  ].filter(([, family]) => printedDuration || family !== "duration") as Array<[string, string, Node]>;
  return rows.map(([fragment, family_id, parameters], index) => {
    const family_version = currentFamilyVersion(family_id);
    return { fragment, family_id, family_version, role: familyRole(family_id, family_version), parameters: normalizeFingerprintParameters(family_id, parameters, family_version), start_byte: index * 10, end_byte: index * 10 + 4 };
  });
}
function effects(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(effects);
  if (value === null || typeof value !== "object") return [];
  const node = value as Node;
  return [...(node.type === "ability-modifier" ? [node] : []), ...Object.values(node).flatMap(effects)];
}

describe("exact used-ability additional allowance", () => {
  it("is not bounded by the Stratagem's phase when the extra use cannot be spent in the same phase", () => {
    const result = compileLeaves(fixture("model", ["unit"], false));
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.scope).toEqual({ duration: "permanent" });
  });

  it.each(["model", "army"] as const)("preserves the parent's per-%s limit and bound ability identity", (per) => {
    const sources = per === "model" ? ["unit"] : ["unit", "enhancement"];
    const result = compileLeaves(fixture(per, sources));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.trigger).toMatchObject({ event: "used", binds_event_variable: "used-ability", filter: { kind: "ability", source: sources, usage: { frequency: "n-per-battle", count: 1 } } });
    expect(result.mechanics.usage).toMatchObject({ frequency: "n-per-battle", count: 1, per });
    expect(effects(result.mechanics.effect)).toContainEqual(expect.objectContaining({ modifier: expect.objectContaining({ ability: { event: "used", event_var: "used-ability" }, aspect: "uses", operation: "add", value: 1, not_same: "phase" }) }));
  });

  it("keeps the Warlord as a designation on the actual model, not a static keyword", () => {
    const leaves = fixture("army", ["unit", "enhancement"]);
    const actor = leaves.find((leaf) => leaf.family_id === "unit-filter")!;
    actor.parameters.designated = "warlord";
    const result = compileLeaves(leaves);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.trigger).toMatchObject({
      subject: { owner: "friendly", level: "model", all_of: ["EXAMPLE"], designated: "warlord" },
    });
    expect(result.core?.target_restrictions).toMatchObject({ required_keywords: ["EXAMPLE"], selects: "model", bound_to: "triggering-unit" });
  });

  it("does not consume a granting restriction or a quote without the qualified actual event", () => {
    const leaves = fixture("model", ["unit"]);
    expect(foldAbilityUseRefresh(leaves).filter((leaf) => leaf.family_id === "usage-limit").map((leaf) => leaf.fragment)).toEqual(["RESTRICTIONS"]);
    expect(() => foldAbilityUseRefresh(leaves.filter((leaf) => leaf.family_id !== "event"))).toThrow();
  });
});

/**
 * Wave-10 own-dice manoeuvre roll (compile-manoeuvre-own-roll.ts). Wording is fabricated: the
 * stub menu names two manoeuvres that roll a D6 and one that does not.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");

const stub = (die: string) => die === "D6"
  ? { actions: ["alpha-move", "beta-move", "gamma-stance"], withDie: ["alpha-move", "beta-move"] }
  : null;

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>, fragment = "A", version = 1): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: version, parameters, start_byte: offset, end_byte: offset + 5, fragment };
}

const usedManoeuvre = (fragment = "A") => leaf("EVENT", "event", { kind: "used", activity: "manoeuvre" }, fragment, 18);
const dieCondition = (die = "D6", fragment = "A") => leaf("CONDITION", "manoeuvre-own-roll", { die }, fragment);
const manoeuvreRoll = (fragment = "A", extra: Record<string, unknown> = {}) => leaf("EFFECT", "roll-modifier", {
  roll: "manoeuvre", operation: "add", value: 1, subject: "event-subject", ...extra,
}, fragment, 6);

describe("manoeuvre-own-roll compile", () => {
  it("lowers the used-manoeuvre trigger to an or over the D6 manoeuvres and keeps the roll on the performing unit", () => {
    const result = compileLeaves([usedManoeuvre(), dieCondition(), manoeuvreRoll()], undefined, { menuActions: stub });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.mechanics)).toContain('"operator":"or"');
    expect(JSON.stringify(result.mechanics)).toContain('"id":"alpha-move"');
    expect(JSON.stringify(result.mechanics)).toContain('"id":"beta-move"');
    expect(JSON.stringify(result.mechanics)).not.toContain("gamma-stance");
    expect(JSON.stringify(result.mechanics)).toContain('"target":"event-subject"');
    expect(JSON.stringify(result.mechanics)).not.toContain('"type":"conditional"');
  });

  it("refuses a set that is empty, the full menu, a missing die, or a missing faction, each with its reason", () => {
    const errorsWith = (menuActions: ((die: string) => unknown) | undefined) => {
      const result = compileLeaves(
        [usedManoeuvre(), dieCondition(), manoeuvreRoll()], undefined,
        menuActions === undefined ? {} : { menuActions: menuActions as never },
      );
      return result.ok ? [] : result.errors;
    };
    expect(errorsWith(() => ({ actions: ["a"], withDie: [] }))).toEqual([expect.stringContaining("finds no manoeuvre whose own move rolls D6.")]);
    expect(errorsWith(() => ({ actions: ["a", "b"], withDie: ["a", "b"] }))).toEqual([expect.stringContaining("names every manoeuvre of the menus; drop it.")]);
    expect(errorsWith(() => null)).toEqual([expect.stringContaining("no faction holds this ability.")]);
    expect(errorsWith(undefined)).toEqual([expect.stringContaining("no faction holds this ability.")]);
  });

  it("reads the D6 manoeuvres from the record's own faction when no menuActions stub is given", () => {
    const result = compileLeaves([usedManoeuvre(), dieCondition(), manoeuvreRoll()], undefined, { abilityId: "martial-grace-aeldari" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.mechanics);
    expect(text).toContain('"id":"fade-back"');
    expect(text).toContain('"id":"opportunity-seized"');
    expect(text).not.toContain('"id":"sudden-strike"');
    expect(text).not.toContain('"id":"swift-as-the-wind"');
  });

  it("refuses a manoeuvre-own-roll with no used-manoeuvre moment in its clause", () => {
    const result = compileLeaves([leaf("EVENT", "event", { kind: "used", activity: "ability" }, "A", 18), dieCondition(), manoeuvreRoll()], undefined, { menuActions: stub });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([expect.stringContaining("names a manoeuvre, but no used-manoeuvre moment sits before it")]);
  });

  it("refuses a manoeuvre roll with no folded manoeuvre moment before it in its clause", () => {
    const result = compileLeaves([usedManoeuvre("B"), dieCondition("D6", "B"), manoeuvreRoll("A")], undefined, { menuActions: stub });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([expect.stringContaining("has no manoeuvre-own-roll moment before it in its clause.")]);
  });

  it("refuses a manoeuvre-own-roll that already names an id on its moment", () => {
    const named = { ...usedManoeuvre(), parameters: { kind: "used", activity: "manoeuvre", id: "alpha-move" } };
    const result = compileLeaves([named, dieCondition(), manoeuvreRoll()], undefined, { menuActions: stub });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([expect.stringContaining("names the manoeuvres of a moment that already names one or a subject.")]);
  });

  it("refuses a manoeuvre roll that subtracts, names weapons, or lacks the performing unit as subject", () => {
    expect(() => normalizeFingerprintParameters("roll-modifier", { roll: "manoeuvre", operation: "subtract", value: 1, subject: "event-subject" }, 6)).toThrow();
    expect(() => normalizeFingerprintParameters("roll-modifier", { roll: "manoeuvre", operation: "add", value: 1, weapon_type: "all", subject: "event-subject" }, 6)).toThrow();
    expect(() => normalizeFingerprintParameters("roll-modifier", { roll: "manoeuvre", operation: "add", value: 1 }, 6)).toThrow();
    expect(() => normalizeFingerprintParameters("roll-modifier", { roll: "manoeuvre", operation: "add", value: 1, subject: "this-unit" }, 6)).toThrow();
  });

  it("accepts the own-roll form and refuses any die but D6", () => {
    expect(() => normalizeFingerprintParameters("manoeuvre-own-roll", { die: "D6" }, 1)).not.toThrow();
    expect(() => normalizeFingerprintParameters("manoeuvre-own-roll", { die: "D3" }, 1)).toThrow();
  });

  it("finds the D6 manoeuvres of the aeldari menus from their distances, not their stat changes", () => {
    expect(menuActionsForAbility(dataRoot, "martial-grace-aeldari", "D6")?.withDie).toEqual(["fade-back", "opportunity-seized"]);
    expect(menuActionsForAbility(dataRoot, "martial-grace-aeldari", "D6")?.withDie).not.toContain("sudden-strike");
    expect(menuActionsForAbility(dataRoot, "not-an-ability-anywhere", "D6")).toBeNull();
  });
});
