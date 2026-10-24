import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

/**
 * Psychic-level cost: each "**Name (psychic level N)**" heading is one psychic ability whose cost
 * is a spend of N from the psychic-level pool. Fabricated wording only.
 */

type Item = [wording: string, family: string, parameters: Record<string, unknown>];

/** Leaves on their own wording in `text`, in order. Each wording is searched from the end of the previous one. */
function placed(text: string, items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const cost = (wording: string, level: number): Item => [wording, "psychic-level-cost", { level }];
/** A psychic test, with its result band ("On a 4+"). */
const psychicTest: Item[] = [
  ["roll one D6 (psychic)", "dice-roll", { dice: "D6", roll_var: "psychic" }],
  ["On a 4+", "roll-result", { from: 4, to: 6 }],
];
const shooting: Item = ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }];
const sv: Item = ["this unit has +1 Sv", "characteristic-modifier", { subject: "this-unit", characteristics: ["Sv"], operation: "improve", value: 1, weapon_type: "all" }];

function compiled(text: string, items: Item[]) {
  return compileLeaves(placed(text, items), text);
}

function errorsOf(result: ReturnType<typeof compiled>): string {
  if (result.ok) throw new Error("expected a refusal");
  return result.errors.join(" ");
}

function spendOf(part: Record<string, unknown>) {
  return part.cost as { type: string; target: string; modifier: Record<string, unknown> };
}

describe("Semantic authoring psychic-level cost", () => {
  it("accepts a level from 1 to 6 and refuses anything else or any extra key", () => {
    expect(normalizeFingerprintParameters("psychic-level-cost", { level: 1 })).toEqual({ level: 1 });
    expect(normalizeFingerprintParameters("psychic-level-cost", { level: 6 })).toEqual({ level: 6 });
    expect(() => normalizeFingerprintParameters("psychic-level-cost", { level: 0 })).toThrow();
    expect(() => normalizeFingerprintParameters("psychic-level-cost", { level: 7 })).toThrow();
    expect(() => normalizeFingerprintParameters("psychic-level-cost", { level: 2, pool: "x" })).toThrow();
  });

  it("compiles one psychic ability to a part whose cost spends its level", () => {
    const text = "**Alpha Hex (psychic level 2)**\nIn your Shooting phase, roll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    const result = compiled(text, [cost("psychic level 2", 2), shooting, ...psychicTest, sv]);
    expect(result.ok).toBe(true);
    const part = (result as { mechanics: { effect: Record<string, unknown> } }).mechanics.effect;
    expect(part.type).toBe("ability-part");
    expect(spendOf(part)).toEqual({ type: "resource-spend", target: "this-unit", modifier: { pool: "psychic-level", amount: 2, label: "Psychic Level" } });
    expect(JSON.stringify(part.effect)).toContain("stat-modifier");
  });

  it("gives each psychic heading its own cost, and keeps a leaf in the ability it sits under", () => {
    const text = "**Alpha Hex (psychic level 2)**\nIn your Shooting phase, roll one D6 (psychic). On a 4+, this unit has +1 Sv.\n**Beta Ward (psychic level 1)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    const result = compiled(text, [cost("psychic level 2", 2), shooting, ...psychicTest, sv, cost("psychic level 1", 1), ...psychicTest, sv]);
    expect(result.ok).toBe(true);
    const effect = (result as { mechanics: { effect: { type: string; steps: Array<Record<string, unknown>> } } }).mechanics.effect;
    expect(effect.type).toBe("sequence");
    expect(effect.steps.map((step) => spendOf(step).modifier.amount)).toEqual([2, 1]);
    // The shooting window belongs to the first ability only.
    expect(effect.steps.map((step) => JSON.stringify(step).includes("shooting"))).toEqual([true, false]);
  });

  it("refuses a cost whose number is not the heading's level", () => {
    const text = "**Alpha Hex (psychic level 3)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    expect(errorsOf(compiled(text, [cost("psychic level 3", 2), ...psychicTest, sv]))).toMatch(/does not match/);
  });

  it("refuses a cost that sits outside any psychic heading", () => {
    const text = "**Alpha Hex (psychic level 2)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv. Costs psychic level 2 here.";
    expect(errorsOf(compiled(text, [...psychicTest, sv, cost("psychic level 2", 2)]))).toMatch(/names no psychic ability heading/);
  });

  it("refuses two costs in one heading", () => {
    const text = "**Alpha Hex (psychic level 2)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    const leaves = placed(text, [cost("psychic level 2", 2), ...psychicTest, sv]);
    expect(errorsOf(compileLeaves([...leaves, { ...leaves[0]! }], text))).toMatch(/two psychic-level costs/);
  });

  it("refuses a psychic ability with no psychic roll in its own text", () => {
    const text = "**Alpha Hex (psychic level 2)**\nIn your Shooting phase, this unit has +1 Sv.";
    expect(errorsOf(compiled(text, [cost("psychic level 2", 2), shooting, sv]))).toMatch(/psychic roll/);
  });

  it("refuses a leaf before the first psychic heading", () => {
    const text = "this unit has +1 Sv. **Alpha Hex (psychic level 2)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    expect(errorsOf(compiled(text, [sv, cost("psychic level 2", 2), ...psychicTest, sv]))).toMatch(/outside every psychic ability heading/);
  });

  it("refuses a psychic heading without a cost beside one that has it", () => {
    const text = "**Alpha Hex (psychic level 2)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv.\n**Beta Ward (psychic level 1)**\nroll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    expect(errorsOf(compiled(text, [cost("psychic level 2", 2), ...psychicTest, sv, ...psychicTest, sv]))).toMatch(/no psychic-level cost leaf/);
  });

  it("emits a part the ability schema accepts, and the describer renders it", () => {
    const text = "**Alpha Hex (psychic level 2)**\nIn your Shooting phase, roll one D6 (psychic). On a 4+, this unit has +1 Sv.";
    const result = compiled(text, [cost("psychic level 2", 2), shooting, ...psychicTest, sv]);
    expect(result.ok).toBe(true);
    const original = { ability_id: "fabricated-alpha-hex", name: "Fabricated Alpha Hex", authored_by: "fabricated", game_version: { edition: "11th", dataslate: "fabricated" }, faction_id: "fabricated-faction", ability_type: "unit", unit_ids: [], source_digest: "0".repeat(64), version: "fabricated-v1" };
    const checked = checkEntry(entryWithMechanics(original, (result as { mechanics: Parameters<typeof entryWithMechanics>[1] }).mechanics));
    expect(checked.errors).toEqual([]);
    expect(checked.rendered_text).not.toBeNull();
  });
});
