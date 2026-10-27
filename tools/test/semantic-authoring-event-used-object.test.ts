import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Fabricated wording only; no rules text.

const normalize = (parameters: Record<string, unknown>, version: number) => normalizeFingerprintParameters("event", parameters, version);

function leaf(text: string, wording: string, family: string, version: number, parameters: Record<string, unknown>): CompileLeaf {
  const start = Buffer.from(text).indexOf(Buffer.from(wording));
  if (start < 0) throw new Error(`"${wording}" is not in the text`);
  return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: start + Buffer.byteLength(wording), fragment: "RAW_TEXT" };
}

describe("event object on a used rule (the unit an Order is issued to)", () => {
  const order = { kind: "used", activity: "order" };

  it("accepts object on a used event at version 35 and not before", () => {
    expect(normalize({ ...order, object: "this-unit" }, 35)).toEqual({ ...order, object: "this-unit" });
    expect(() => normalize({ ...order, object: "this-unit" }, 34)).toThrow();
    expect(() => normalize({ ...order, object: "antecedent" }, 35)).toThrow(/event.object/);
    expect(normalize(order, 35)).toEqual(order);
  });

  it("lowers to a used trigger aimed at the unit, not one the unit makes", () => {
    const text = "Each time this squad is given an Order, it can move 1\".";
    const result = compileLeaves([
      leaf(text, "Each time this squad is given an Order", "event", 35, normalize({ ...order, object: "this-unit" }, 35)),
      leaf(text, "it can move 1\"", "make-move", 6, { subject: "this-unit", move_type: "normal", inches: 1 }),
    ], text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const mechanics = result.mechanics as Record<string, any>;
    expect(mechanics.trigger).toEqual({ event: "used", filter: { kind: "order" }, object: "this-unit" });
  });
});
