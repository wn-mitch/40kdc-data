import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { menuActionsForAbility } from "../src/semantic-authoring/named-ability-checks.js";

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
