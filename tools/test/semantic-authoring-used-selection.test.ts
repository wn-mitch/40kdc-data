import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Fabricated wording only; no rules text.

function leaf(text: string, wording: string, family: string, version: number, parameters: Record<string, unknown>): CompileLeaf {
  const start = Buffer.from(text).indexOf(Buffer.from(wording));
  if (start < 0) throw new Error(`"${wording}" is not in the text`);
  return {
    role: familyRole(family, version), family_id: family, family_version: version,
    parameters: normalizeFingerprintParameters(family, parameters, version),
    start_byte: start, end_byte: start + Buffer.byteLength(wording), fragment: "RAW_TEXT",
  };
}

type Node = Record<string, any>;

describe("the unit another ability's use selected", () => {
  const text = "Each time the bearer uses its Gear Blessing ability, until the start of your next Command phase, add 2\" to the Move characteristic of the selected **WALKER** model.";
  const use = (parameters: Record<string, unknown>) => leaf(text, "Each time the bearer uses its Gear Blessing ability", "event", 35,
    { kind: "used", activity: "ability", id: "gear-blessing-astra-militarum", subject: "this-model", ...parameters });
  const lasting = () => leaf(text, "until the start of your next Command phase", "duration", 5, { endpoint: "start-of-next-command-phase" });
  const change = () => leaf(text, "add 2\" to the Move characteristic of the selected **WALKER** model", "characteristic-modifier", 19,
    { subject: "selected-unit", characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" });

  it("binds the selected model to the use's object, under a trigger on that ability's use", () => {
    const result = compileLeaves([use({}), lasting(), change()], text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const mechanics = result.mechanics as Node;
    expect(mechanics.trigger).toEqual({ event: "used", filter: { kind: "ability", id: "gear-blessing-astra-militarum" }, subject: "this-model" });
    expect(mechanics.effect).toEqual({ type: "stat-modifier", target: "event-object", modifier: { stat: "M", operation: "add", value: 2 } });
    expect(mechanics.scope).toEqual({ duration: "until-next-command-phase" });
  });

  it("still refuses a selected unit when the use names no ability", () => {
    const { id: _id, ...bare } = use({}).parameters;
    const result = compileLeaves([{ ...use({}), parameters: bare }, lasting(), change()], text);
    expect(result.ok).toBe(false);
  });

  it("refuses a use aimed at this unit, whose object is no unit it selected", () => {
    const result = compileLeaves([use({ object: "this-unit" }), lasting(), change()], text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("; ")).toMatch(/aimed at this-unit/u);
  });
});
