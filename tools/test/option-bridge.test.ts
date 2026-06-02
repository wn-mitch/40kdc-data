import { describe, it, expect } from "vitest";

import {
  bridgeOptionsToUnits,
  modelNameFromComposition,
  normModelName,
} from "../src/converters/option-bridge.js";

describe("modelNameFromComposition", () => {
  it("strips leading counts and ranges", () => {
    expect(modelNameFromComposition("1 Khorne Berzerker Champion")).toBe("khorne berzerker champion");
    expect(modelNameFromComposition("9-19 Khorne Berzerkers")).toBe("khorne berzerkers");
  });
});

describe("bridgeOptionsToUnits", () => {
  it("maps a numeric id to the faction UUID by model-name overlap", () => {
    const modelsByUuid = new Map([
      ["uuid-bz", new Set([normModelName("Khorne Berzerker"), normModelName("Khorne Berzerker Champion")])],
      ["uuid-other", new Set([normModelName("Chaos Space Marine")])],
    ]);
    const compByNumeric = new Map([
      ["000002627", new Set([normModelName("Khorne Berzerker"), normModelName("Khorne Berzerker Champion")])],
    ]);
    const { byNumeric, ambiguous } = bridgeOptionsToUnits(
      ["uuid-bz", "uuid-other"],
      modelsByUuid,
      compByNumeric,
      ["000002627"],
    );
    expect(byNumeric.get("000002627")).toBe("uuid-bz");
    expect(ambiguous).toEqual([]);
  });

  it("reports a tie as ambiguous rather than guessing", () => {
    const shared = new Set([normModelName("Warrior")]);
    const { byNumeric, ambiguous } = bridgeOptionsToUnits(
      ["a", "b"],
      new Map([
        ["a", shared],
        ["b", new Set(shared)],
      ]),
      new Map([["999", new Set([normModelName("Warrior")])]]),
      ["999"],
    );
    expect(byNumeric.size).toBe(0);
    expect(ambiguous).toEqual(["999"]);
  });

  it("drops a numeric id with no overlap (another faction)", () => {
    const { byNumeric, ambiguous } = bridgeOptionsToUnits(
      ["a"],
      new Map([["a", new Set([normModelName("Ork Boy")])]]),
      new Map([["111", new Set([normModelName("Necron Warrior")])]]),
      ["111"],
    );
    expect(byNumeric.size).toBe(0);
    expect(ambiguous).toEqual([]);
  });
});
