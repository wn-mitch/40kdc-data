import { describe, expect, it } from "vitest";
import { compositionSizes, errorCountRules, evaluateMaxCap, fitCap } from "../src/bsdata-caps.js";

const capOf = (entries: [number, number][]) => new Map(entries);
const range = (lo: number, hi: number, f: (n: number) => number): [number, number][] =>
  Array.from({ length: hi - lo + 1 }, (_, i) => [lo + i, f(lo + i)]);

describe("BSData size-dependent caps", () => {
  it("fits a constant as a flat count and a stepped cap as a ratio", () => {
    expect(fitCap(capOf(range(5, 10, () => 2)))).toEqual([{ count: 2, per_models: 0 }]);
    expect(fitCap(capOf(range(5, 10, (n) => (n >= 10 ? 2 : 1))))).toEqual([{ count: 1, per_models: 5 }]);
    expect(fitCap(capOf(range(3, 6, (n) => (n === 6 ? 2 : 1))))).toEqual([{ count: 1, per_models: 3 }]);
  });

  it("refuses a cap no flat or ratio form reproduces", () => {
    // Two, four at ten, none below five.
    expect(fitCap(capOf(range(3, 10, (n) => (n < 5 ? 0 : n >= 10 ? 4 : 2))))).toBeUndefined();
  });

  it("keeps an open-ended limit scaling instead of freezing it flat", () => {
    // One below ten models, unbounded at ten: a flat 1 would reject two at ten.
    expect(fitCap(capOf(range(5, 10, (n) => (n < 10 ? 1 : Infinity))))).toEqual([{ count: 1, per_models: 5 }]);
  });

  it("evaluates set, increment and per-N repeats only on the model count", () => {
    const node = (modifiers: unknown[]) => ({ constraints: [{ id: "m", field: "selections", type: "max", value: 1 }], modifiers });
    const model = (type: string, value: number) => ({ childId: "model", field: "selections", scope: "unit", type, value });
    expect([...evaluateMaxCap(node([{ field: "m", type: "set", value: 2, conditions: [model("atLeast", 10)] }]), [5, 10])!.cap]).toEqual([[5, 1], [10, 2]]);
    expect([...evaluateMaxCap(node([{ field: "m", type: "increment", value: 1, repeats: [{ childId: "model", field: "selections", scope: "unit", value: 5, repeats: 1 }] }]), [5, 10])!.cap]).toEqual([[5, 2], [10, 3]]);
    expect(evaluateMaxCap(node([{ field: "m", type: "set", value: 2, conditions: [{ childId: "other", field: "selections", scope: "unit", type: "atLeast", value: 1 }] }]), [5])).toBeUndefined();
  });

  it("reads count limits from structured error conditions, skipping clauses with other conditions", () => {
    const rules = errorCountRules({ modifiers: [{ field: "error", type: "add", value: "any text", conditionGroups: [{ type: "or", conditionGroups: [
      { type: "and", conditions: [{ childId: "model", field: "selections", scope: "unit", type: "lessThan", value: 10 }, { childId: "x", field: "selections", scope: "unit", type: "greaterThan", value: 1 }] },
      { type: "and", conditions: [{ childId: "x", field: "selections", scope: "unit", type: "greaterThan", value: 1 }, { childId: "y", field: "selections", scope: "unit", type: "atLeast", value: 1 }] },
    ] }] }] });
    expect(rules.map((rule) => [rule.target, rule.limit, rule.when(9), rule.when(10)])).toEqual([["x", 1, true, false]]);
  });

  it("lists every buildable size of a tiered composition", () => {
    expect(compositionSizes({ tiers: [{ models: [{ min: 1, max: 1 }, { min: 4, max: 4 }] }, { models: [{ min: 1, max: 1 }, { min: 5, max: 9 }] }] })).toEqual([5, 6, 7, 8, 9, 10]);
  });
});
