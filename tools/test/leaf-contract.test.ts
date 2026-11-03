import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { outsideContract } from "./leaf-contract.js";
import { placed } from "./semantic-authoring-connective-fixture.js";

// The test-wide leaf guard (setup/leaf-contract-guard.ts) on fabricated wording.

const text = "Each time this unit makes an attack, add 1 to the Hit roll.";
const valid = () => placed(text,
  ["Each time this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
  ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
const withParameters = (leaves: CompileLeaf[], index: number, parameters: Record<string, unknown>) =>
  leaves.map((leaf, at) => at === index ? { ...leaf, parameters } : leaf);

describe("the test leaf contract guard", () => {
  it("compiles leaves a reviewer could store", () => {
    expect(compileLeaves(valid(), text).ok).toBe(true);
  });

  it("refuses a leaf the family contract rejects", () => {
    const leaves = withParameters(valid(), 1, { roll: "hit", operation: "add", value: 1, weapon: "fabricated" });
    expect(() => compileLeaves(leaves, text)).toThrow(/Test leaf roll-modifier@\d+ .*the contract rejects it/u);
  });

  it("refuses a leaf whose parameters are not in stored form", () => {
    const leaves = placed("Each FOO or BAR unit", ["FOO or BAR unit", "unit-filter", { side: "friendly", any_keywords: ["FOO", "BAR"] }]);
    const stored = leaves[0]!.parameters.any_keywords as string[];
    const unsorted = withParameters(leaves, 0, { ...leaves[0]!.parameters, any_keywords: [...stored].reverse() });
    expect(() => compileLeaves(unsorted, "Each FOO or BAR unit")).toThrow(/not in stored form: normalization gives/u);
  });

  it("lets a test compile marked leaves outside the contract, and refuses a stale mark", () => {
    const leaves = outsideContract(withParameters(valid(), 1, { roll: "hit", operation: "add", value: 1, weapon: "fabricated" }));
    expect(() => compileLeaves(leaves, text)).not.toThrow();
    // A copy of a marked array is not marked.
    expect(() => compileLeaves([...leaves], text)).toThrow(/the contract rejects it/u);
    expect(() => outsideContract(valid())).toThrow(/every leaf meets the contract/u);
  });
});
