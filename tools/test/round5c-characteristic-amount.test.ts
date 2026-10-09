import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { effect } from "../src/round5c/compile-fragments.js";
import { bindCharacteristicAmounts } from "../src/round5c/compile-characteristic-amount.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

/**
 * A characteristic change written without its amount, a recipient filter, then the amount
 * ("Raise the Zorn characteristic of K models from your army by 2"). Fabricated wording.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

/** Leaves placed on fabricated wording in order, each spanning its phrase. */
function placedIn(text: string, ...items: Array<[string, string, Record<string, unknown>, string?]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family_id, parameters, fragment = "RAW_TEXT"]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const family_version = currentFamilyVersion(family_id);
    return { role: familyRole(family_id, family_version), family_id, family_version, parameters, start_byte: start, end_byte: from, fragment };
  });
}

const text = "Raise the Zorn characteristic of FOO BAR models from your army by 2.";
const change = ["Raise the Zorn characteristic of", "characteristic-modifier", { subject: "antecedent", characteristics: ["OC"], operation: "improve", weapon_type: "all" }] as const;
const recipient = ["FOO BAR models", "unit-filter", { side: "friendly", keywords: ["FOO BAR", "BAZ QUX"], level: "model" }] as const;
const owner = ["from your army", "unit-owner", { owner: "friendly" }] as const;
const amount = (wording: string, value: unknown) => [wording, "characteristic-amount", { value }] as const;

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

describe("Round 5C characteristic-amount parameter values", () => {
  it("takes a whole amount from 1 and a dice amount, and refuses zero, a text number and a fraction", () => {
    for (const value of [2, 10, "D6+1"]) {
      expect(normalizeFingerprintParameters("characteristic-amount", { value }, 1)).toEqual({ value });
    }
    for (const value of [0, "2", 1.5]) {
      expect(() => normalizeFingerprintParameters("characteristic-amount", { value }, 1)).toThrow();
    }
  });
});

describe("Round 5C characteristic amounts after a recipient filter", () => {
  it("gives the amount to the change before the recipient filter", () => {
    const result = compileLeaves(placedIn(text, [...change], [...recipient], [...owner], [...amount("by 2", 2)]), text);
    expect(result.ok).toBe(true);
    expect(result.mechanics.effect).toEqual({
      type: "stat-modifier",
      target: { owner: "friendly", all_of: ["FOO BAR", "BAZ QUX"], level: "model" },
      modifier: { stat: "OC", operation: "improve", value: 2 },
    });
  });

  it("binds a dice amount and lowers it as the string, which the DSL entry validates", () => {
    const diceText = text.replace("by 2", "by D6+1");
    const result = compileLeaves(placedIn(diceText, [...change], [...recipient], [...owner], [...amount("by D6+1", "D6+1")]), diceText);
    expect(result.ok).toBe(true);
    expect((result.mechanics.effect as { modifier: { value: unknown } }).modifier.value).toBe("D6+1");
    const base = authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");
    const check = checkEntry(entryWithMechanics(base, result.mechanics));
    expect(check.errors).toEqual([]);
  });

  it("refuses an amount with no change before it", () => {
    const result = compileLeaves(placedIn("By 2.", [...amount("By 2", 2)]), "By 2.");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("has no characteristic change before it");
  });

  it("refuses a change with no amount", () => {
    const result = compileLeaves(placedIn(text, [...change], [...recipient], [...owner]), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("has no amount");
  });

  it("refuses two amounts for one change", () => {
    const doubled = "Raise the Zorn characteristic of FOO BAR models from your army by 2 by 3.";
    const two = compileLeaves(placedIn(doubled, [...change], [...recipient], [...owner], [...amount("by 2", 2)], [...amount("by 3", 3)]), doubled);
    expect(two.ok).toBe(false);
    expect(two.ok ? "" : two.errors.join(" ")).toContain("has two amounts");
  });

  it("refuses an amount on a change that already has one", () => {
    const valued = placedIn(text, ["Raise the Zorn characteristic of", "characteristic-modifier", { subject: "antecedent", characteristics: ["OC"], operation: "improve", value: 1, weapon_type: "all" }], [...amount("by 2", 2)]);
    expect(() => bindCharacteristicAmounts(valued)).toThrow("already has an amount");
  });

  it("refuses an amount on a change that takes no amount (halve)", () => {
    const halved = placedIn("Halve the Damage characteristic of that unit by 2.", ["Halve the Damage characteristic of", "characteristic-modifier", { subject: "antecedent", characteristics: ["D"], operation: "halve", weapon_type: "all" }], ["by 2", "characteristic-amount", { value: 2 }]);
    expect(() => bindCharacteristicAmounts(halved)).toThrow("takes no amount");
  });

  it("refuses any leaf other than the recipient between the change and its amount", () => {
    const conditional = "Raise the Zorn characteristic of while on an objective FOO BAR models by 2.";
    const withCondition = placedIn(conditional, [...change], ["while on an objective", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false }], [...recipient], [...amount("by 2", 2)]);
    expect(() => bindCharacteristicAmounts(withCondition)).toThrow("separated from its characteristic change by unit-state");
  });

  it("refuses a change and its amount in different clauses", () => {
    const split = placedIn(text, [...change], [...recipient, "WHEN"], [...amount("by 2", 2), "EFFECT"]);
    expect(() => bindCharacteristicAmounts(split)).toThrow("another clause");
  });

  it("refuses an additive change with no amount through the lowering path too", () => {
    const bare = placedIn(text, [...change]);
    expect(() => effect(bare[0]!, { attached: false, incoming: false })).toThrow("Stat adjustment needs an amount");
    const result = compileLeaves(bare, text);
    expect(result.ok).toBe(false);
  });

  it("refuses an unclaimed change inside a nested container option as well as at top level", () => {
    const menu = "Select one of the options below. Aegis: Raise the Zorn characteristic of this unit. Zeal: this unit is engaged.";
    const leaves = placedIn(menu,
      ["Select one of the options below", "choice-open", { min_choices: 1, max_choices: 1 }],
      ["Aegis", "named-option", { label: "Aegis" }],
      ["Raise the Zorn characteristic of", "characteristic-modifier", { subject: "this-unit", characteristics: ["OC"], operation: "improve", weapon_type: "all" }],
      ["Zeal", "named-option", { label: "Zeal" }],
      ["this unit is engaged", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false }]);
    const result = compileLeaves(leaves, menu);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("has no amount");
  });

  it("sets the amount on the change and keeps its other parameters", () => {
    const bound = bindCharacteristicAmounts(placedIn(text, [...change], [...recipient], [...owner], [...amount("by 2", 2)]));
    expect(bound.map((leaf) => leaf.family_id)).toEqual(["characteristic-modifier", "unit-filter", "unit-owner"]);
    expect(bound[0]!.parameters).toEqual({ subject: "antecedent", characteristics: ["OC"], operation: "improve", weapon_type: "all", value: 2 });
    expect(normalizeFingerprintParameters("characteristic-modifier", bound[0]!.parameters, 15)).toMatchObject({ value: 2 });
  });
});
