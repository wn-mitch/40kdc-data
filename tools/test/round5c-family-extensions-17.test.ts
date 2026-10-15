import { describe, expect, it } from "vitest";
import { normalizeFingerprintParameters } from "../src/round5c/contracts.js";

/**
 * Round 17 of family extensions: characteristic-modifier v15 leaves its amount optional for the
 * additive operations; halve and multiply keep their rules; v14 still requires an integer or a dice
 * amount. Fabricated parameters only.
 */

const base = { characteristics: ["OC"], weapon_type: "all" };

describe("Round 5C characteristic-modifier v15 optional amount", () => {
  it("v14 takes a whole amount and dice amounts", () => {
    expect(normalizeFingerprintParameters("characteristic-modifier", { ...base, operation: "improve", value: 10 }, 14)).toMatchObject({ value: 10 });
    expect(normalizeFingerprintParameters("characteristic-modifier", { ...base, operation: "add", value: "D3" }, 14)).toMatchObject({ value: "D3" });
    expect(normalizeFingerprintParameters("characteristic-modifier", { ...base, operation: "add", value: "D6+1" }, 14)).toMatchObject({ value: "D6+1" });
  });

  it("v14 refuses zero, a string number, and an additive change with no amount", () => {
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { ...base, operation: "improve", value: 0 }, 14)).toThrow();
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { ...base, operation: "improve", value: "2" }, 14)).toThrow();
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { ...base, operation: "improve" }, 14)).toThrow();
  });

  it("v15 accepts an additive change with no amount and returns no value", () => {
    for (const operation of ["add", "subtract", "improve", "worsen"]) {
      const normalized = normalizeFingerprintParameters("characteristic-modifier", { ...base, operation }, 15);
      expect(normalized).toEqual({ ...base, operation });
      expect("value" in normalized).toBe(false);
    }
  });

  it("v15 still takes an amount when one is given, and keeps the dice amount", () => {
    expect(normalizeFingerprintParameters("characteristic-modifier", { ...base, operation: "subtract", value: 3 }, 15)).toMatchObject({ value: 3 });
    expect(normalizeFingerprintParameters("characteristic-modifier", { ...base, operation: "add", value: "D6" }, 15)).toMatchObject({ value: "D6" });
  });

  it("v15 halves with no amount, and refuses a multiply with no factor", () => {
    expect(normalizeFingerprintParameters("characteristic-modifier", { ...base, operation: "halve" }, 15)).toMatchObject({ operation: "halve" });
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { ...base, operation: "multiply" }, 15)).toThrow();
    expect(normalizeFingerprintParameters("characteristic-modifier", { ...base, operation: "multiply", value: 2 }, 15)).toMatchObject({ operation: "multiply", value: 2 });
  });
});
