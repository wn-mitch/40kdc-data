import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters, reviewedFamily } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { familyCombinations } from "../src/round5c/leaf-coverage-samples.js";
import { resourceNoun } from "../src/translate/effect-words.js";

// Fabricated wording and records only; no GW rule prose.

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = () => {
  const entries = JSON.parse(readFileSync(join(dataRoot, "world-eaters", "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  return entries.find((item) => item.ability_id === "blessings-of-khorne-world-eaters")!;
};

let offset = 0;
function leaf(parameters: Record<string, unknown>, familyVersion: number): CompileLeaf {
  offset += 10;
  return { role: "EFFECT", family_id: "resource-gain", family_version: familyVersion, parameters, start_byte: offset };
}

const normalize = (parameters: Record<string, unknown>, version: number) => normalizeFingerprintParameters("resource-gain", parameters, version);
const current = (parameters: Record<string, unknown>) => normalize(parameters, currentFamilyVersion("resource-gain"));

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}

function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
}

describe("resource-gain v4: dice amounts and plain pool ids", () => {
  it("normalizes a dice amount to uppercase, trimmed", () => {
    expect(current({ pool: "miracle-dice-pool", amount: " d3 " })).toMatchObject({ pool: "miracle-dice-pool", amount: "D3" });
  });

  it("accepts the other dice forms the quantity pattern admits", () => {
    expect(current({ pool: "miracle-dice-pool", amount: "2D6" })).toMatchObject({ amount: "2D6" });
    expect(current({ pool: "miracle-dice-pool", amount: "D3+1" })).toMatchObject({ amount: "D3+1" });
  });

  it("refuses dice forms outside the pattern and keeps the integer message", () => {
    expect(() => current({ pool: "miracle-dice-pool", amount: "D4" })).toThrow(/integer or an exact source snippet/u);
    expect(() => current({ pool: "miracle-dice-pool", amount: "D3+" })).toThrow(/integer or an exact source snippet/u);
  });

  it("refuses a dice amount at v3, so existing v3 leaves keep their meaning", () => {
    expect(() => normalize({ pool: "miracle-dice-pool", amount: "D3" }, 3)).toThrow(/integer or an exact source snippet/u);
  });

  it("gives every value v3 accepted the same normal form at the current version", () => {
    const accepted: Record<string, unknown>[] = [
      { pool: "miracle-dice-pool", amount: 1 },
      { pool: "resurgence-points", amount: 2 },
      { pool: "command-point", amount: "any" },
      { pool: "command-point", amount: "variable" },
      { pool: "resurgence-points", amount: { incursion: 6, "strike-force": 10, onslaught: 14 } },
      { pool: { source: "Resurgence points" }, amount: 2 },
      { pool: "miracle-dice-pool", amount: { source: "D3" } },
    ];
    for (const parameters of accepted) {
      expect(current(parameters)).toEqual(normalize(parameters, 3));
    }
  });

  it("keeps a quoted-source dice amount refused at compile time", () => {
    const parameters = current({ pool: "miracle-dice-pool", amount: { source: "D3" } });
    expect(() => compiled([leaf(parameters, 4)])).toThrow(/amount is quoted source text/u);
  });

  it("accepts a plain kebab-case pool id at v3 and compiles it as the pool", () => {
    const parameters = normalize({ pool: "resurgence-points", amount: 2 }, 3);
    const mechanics = compiled([leaf(parameters, 3)]);
    const gain = nodes(mechanics, (node) => node.type === "resource-gain")[0]!;
    expect(gain.modifier).toMatchObject({ pool: "resurgence-points", amount: 2 });
  });

  it("compiles a dice amount to a DSL quantity and describes it as dice", () => {
    const mechanics = compiled([leaf(current({ pool: "miracle-dice-pool", amount: "D3" }), currentFamilyVersion("resource-gain"))]);
    const gain = nodes(mechanics, (node) => node.type === "resource-gain")[0]!;
    expect(gain.modifier).toMatchObject({ pool: "miracle-dice-pool", amount: "D3" });
    const check = checkEntry(entryWithMechanics(base(), mechanics as never));
    expect(check.errors).toEqual([]);
    expect(check.rendered_text).toContain("You gain D3 Miracle dice.");
  });

  it("describes a plain pool id with its count, singular or plural", () => {
    expect(resourceNoun("resurgence-points", undefined, 2)).toBe("Resurgence points");
    expect(resourceNoun("resurgence-points", undefined, 1)).toBe("Resurgence point");
    expect(resourceNoun("miracle-dice-pool", undefined, "D3")).toBe("Miracle dice");
  });

  it("samples the dice amount and every known pool id, and each combination normalizes", () => {
    const combinations = familyCombinations(reviewedFamily("resource-gain", 4));
    expect(combinations.some((combination) => combination.amount === "D3")).toBe(true);
    expect(combinations.some((combination) => combination.amount === 2)).toBe(true);
    for (const pool of ["command-point", "miracle-dice-pool", "pain-token-pool", "blood-tithe-pool", "yp-pool", "battle-focus-pool", "fate-dice-pool"]) {
      expect(combinations.some((combination) => combination.pool === pool)).toBe(true);
      expect(() => current({ pool, amount: "D3" })).not.toThrow();
    }
  });

  it("compiles the blood-tithe dice leaf at the current version", () => {
    const parameters = current({ pool: "blood-tithe-pool", amount: "D3" });
    const mechanics = compiled([leaf(parameters, currentFamilyVersion("resource-gain"))]);
    expect(nodes(mechanics, (node) => node.type === "resource-gain")[0]!.modifier).toMatchObject({ pool: "blood-tithe-pool", amount: "D3" });
    expect(checkEntry(entryWithMechanics(base(), mechanics as never)).errors).toEqual([]);
  });

  it("pins the current version at 4", () => {
    expect(currentFamilyVersion("resource-gain")).toBe(4);
  });
});
