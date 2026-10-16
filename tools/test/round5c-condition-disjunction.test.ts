import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

/** Leaves placed on their own wording in `text`, in order, so the words between them are real source. */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

const onObjective = (subject: string) => ({ kind: "objective-range", controlled_by: "any", subject, negated: false });
const within = (inches: number, of: string, subject: string) => ({ kind: "within", inches, of, subject, negated: false });
const friendly = (keywords: string[]) => ({ side: "friendly", keywords, level: "model" });

describe("and/or between conditions (SS-C)", () => {
  const text = "If this unit and/or the target unit are within range of an **objective**, add 1 to the Hit roll.";
  const leaves = () => placed(text,
    ["this unit", "unit-position", onObjective("this-unit")],
    ["the target unit are within range of an **objective**", "unit-position", onObjective("target")],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);

  it("joins two conditions written \"and/or\" as one any-of", () => {
    const result = compileLeaves(leaves(), text);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).toContain('"operator":"or"');
  });

  it("keeps two conditions written \"and\" stacked as AND", () => {
    const and = text.replace("and/or", "and");
    const result = compileLeaves(placed(and,
      ["this unit", "unit-position", onObjective("this-unit")],
      ["the target unit are within range of an **objective**", "unit-position", onObjective("target")],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), and);
    expect(result.ok).toBe(true);
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).toContain('"operator":"and"');
    expect(json).not.toContain('"operator":"or"');
  });
});

describe("or between range clauses that each take a following filter (SS-E)", () => {
  // Fabricated wording with the shape of a record that names two friendly unit-filters by distance.
  const text = "While this unit is within 6\" of a friendly ALPHA CHARACTER model (excluding BETA models) or within 12\" of a friendly GAMMA LEADER model, this unit is not Battle-shocked, add 1 to the Hit roll.";
  const leaves = (joint = "or") => placed(joint === "or" ? text : text.replace(" or ", " and "),
    ["within 6\"", "unit-position", within(6, "following-filter", "this-unit")],
    ["a friendly ALPHA CHARACTER model", "unit-filter", friendly(["ALPHA CHARACTER"])],
    ["(excluding BETA models)", "unit-filter", { side: "friendly", excluded_keywords: ["BETA"], level: "model" }],
    ["within 12\"", "unit-position", within(12, "following-filter", "this-unit")],
    ["a friendly GAMMA LEADER model", "unit-filter", friendly(["GAMMA LEADER"])],
    ["this unit is not Battle-shocked", "unit-state", { states: ["battle-shocked"], subject: "this-unit", negated: true }],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);

  it("joins the two distances as one any-of inside the condition", () => {
    const result = compileLeaves(leaves(), text);
    expect(result.ok ? "ok" : result.errors.join(" | ")).toBe("ok");
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).toMatch(/"operator":"and","operands":\[\{"operator":"or","operands":\[\{"type":"matches".*"type":"matches"/u);
  });

  it("refuses an \"or\" between a filtered distance and a condition of another subject", () => {
    const cross = "While this unit is within 6\" of a friendly ALPHA CHARACTER model or the target is within 12\" of a friendly GAMMA LEADER model, add 1 to the Hit roll.";
    const result = compileLeaves(placed(cross,
      ["within 6\"", "unit-position", within(6, "following-filter", "this-unit")],
      ["a friendly ALPHA CHARACTER model", "unit-filter", friendly(["ALPHA CHARACTER"])],
      ["the target is within 12\"", "unit-position", within(12, "following-filter", "target")],
      ["a friendly GAMMA LEADER model", "unit-filter", friendly(["GAMMA LEADER"])],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), cross);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/"or" joins a condition with an absorbed filter/u);
  });

  it("keeps a filtered distance joined to the next condition by \"and\" as AND", () => {
    const result = compileLeaves(leaves("and"), text.replace(" or ", " and "));
    expect(result.ok).toBe(true);
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).not.toContain('"operator":"or"');
  });
});

describe("attack kind or attacker keyword gating an invulnerable save (SS-F)", () => {
  // Fabricated wording with the shape of a record that gives a 4+ save against an attack kind and
  // against attacks a keyword's models make, joined by "and".
  const text = "While this model is leading a unit, models in that unit have a 6+ invulnerable save, and a 4+ invulnerable save against Psychic Attacks and attacks made by ALPHA models.";
  const leaves = () => placed(text,
    ["While this model is leading a unit", "leading-unit", { subject: "this-model", attachment: "leading" }],
    ["models in that unit have a 6+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 6 }],
    ["a 4+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 4 }],
    ["against Psychic Attacks", "attack-filter", { attack_type: "psychic" }],
    ["attacks made by ALPHA models", "unit-keyword", { keywords: ["ALPHA"], subject: "attacker", negated: false }]);

  it("joins the attack kind and the attacker keyword as one any-of", () => {
    const result = compileLeaves(leaves(), text);
    expect(result.ok ? "ok" : result.errors.join(" | ")).toBe("ok");
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).toContain('"operator":"or"');
    expect(json).toContain('"attack_type":"psychic"');
    expect(json).toContain('"all_of":["ALPHA"]');
    // The 4+ save is the one gated by the attack condition; the 6+ save is not.
    expect(json).toMatch(/"condition":\{"operator":"or".*"invuln_sv":4/u);
  });

  it("stacks an \"and\" between an attack kind and any other condition as AND", () => {
    const other = "Against Psychic Attacks and while this unit is Battle-shocked, add 1 to the Hit roll.";
    const result = compileLeaves(placed(other,
      ["Against Psychic Attacks", "attack-filter", { attack_type: "psychic" }],
      ["while this unit is Battle-shocked", "unit-state", { states: ["battle-shocked"], subject: "this-unit", negated: false }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), other);
    const json = JSON.stringify(result.ok ? result.mechanics : result.errors);
    expect(json).not.toContain('"operator":"or"');
  });
});
