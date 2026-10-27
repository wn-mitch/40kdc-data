import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { foldAlternativeConditions } from "../src/semantic-authoring/compile-alternative-conditions.js";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { mapToLatest } from "../src/semantic-authoring/family-versions.js";

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

// semantic-authoring-alternative-conditions
{
const onObjective = (subject: string) => ({ kind: "objective-range", controlled_by: "any", subject, negated: false });
const conditionOf = (text: string, leaves: CompileLeaf[]) => {
  const result = compileLeaves(leaves, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return JSON.stringify(result.mechanics);
};

describe("alternative conditions", () => {
  const list = "In your Shooting phase, if any of the following apply, this unit’s ranged attacks have +1 **AP**:\rThis unit is within range of an **objective**.\rThe target of that attack is within range of an **objective**.";
  const listLeaves = () => placed(list,
    ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["this unit’s ranged attacks have", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }],
    ["+1 **AP", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1 }],
    ["This unit is within range of an **objective", "unit-position", onObjective("this-unit")],
    ["The target of that attack is within range of an **objective", "unit-position", onObjective("target")]);

  it("makes each line after \"if any of the following apply:\" one alternative", () => {
    const mechanics = conditionOf(list, listLeaves());
    expect(mechanics).toContain('"operator":"or"');
    expect(mechanics).toMatch(/"operator":"or","operands":\[\{"type":"matches".*"subject":"defender"/u);
  });

  it("keeps two conditions on one list line together", () => {
    const text = "If any of the following apply, add 1 to the Hit roll:\rThis unit is within range of an **objective** and is below its Starting Strength.\rThe target is within range of an **objective**.";
    const folded = foldAlternativeConditions(placed(text,
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["This unit is within range of an **objective", "unit-position", onObjective("this-unit")],
      ["is below its Starting Strength", "unit-state", { states: ["below-starting-strength"], subject: "this-unit", negated: false }],
      ["The target is within range of an **objective", "unit-position", onObjective("target")]), text);
    const anyOf = folded.find((leaf) => leaf.family_id === "__any-of")!;
    expect((anyOf.parameters.alternatives as CompileLeaf[][]).map((line) => line.length)).toEqual([2, 1]);
  });

  it("joins conditions written with \"or\" between them", () => {
    const text = "Each time this unit makes an attack that targets a unit within range of an objective marker or below its Starting Strength, add 1 to the Hit roll.";
    const mechanics = conditionOf(text, placed(text,
      ["makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["within range of an objective marker", "unit-position", onObjective("target")],
      ["below its Starting Strength", "unit-state", { states: ["below-starting-strength"], subject: "target", negated: false }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]));
    expect(mechanics).toContain('"operator":"or"');
  });

  it("leaves conditions joined by \"and\", and lists that are not conditional, alone", () => {
    const and = "If this unit is within range of an objective marker and below its Starting Strength, add 1 to the Hit roll.";
    const andLeaves = placed(and,
      ["this unit is within range of an objective marker", "unit-position", onObjective("this-unit")],
      ["below its Starting Strength", "unit-state", { states: ["below-starting-strength"], subject: "this-unit", negated: false }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(foldAlternativeConditions(andLeaves, and)).toEqual(andLeaves);
    const menu = "This unit gains one or more of the following abilities:\rThis unit is within range of an **objective**.\rThe target is within range of an **objective**.";
    const menuLeaves = placed(menu,
      ["This unit is within range of an **objective", "unit-position", onObjective("this-unit")],
      ["The target is within range of an **objective", "unit-position", onObjective("target")]);
    expect(foldAlternativeConditions(menuLeaves, menu)).toEqual(menuLeaves);
  });

  it("refuses a conditional list that holds an effect, rather than guessing which lines are alternatives", () => {
    const text = "If any of the following apply:\rThis unit is within range of an **objective**.\rAdd 1 to the Hit roll.";
    expect(() => foldAlternativeConditions(placed(text,
      ["This unit is within range of an **objective", "unit-position", onObjective("this-unit")],
      ["Add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text)).toThrow(/not a condition/u);
  });
});
}

// semantic-authoring-condition-disjunction
{
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
}

// semantic-authoring-rule-active-option
{
/**
 * rule-active v2: the active rule can be one option of an option-bearing rule
 * ({ability_id, option_id}: "the Protector Imperative is active for that unit"), lowered to the
 * condition schema's option reference. The string form keeps naming a whole ability record.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const option = { ability_id: "example-doctrines", option_id: "example-stance" };

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

function leaf(role: string, familyId: string, parameters: Record<string, unknown>, familyVersion: number, startByte: number): CompileLeaf {
  return { role, family_id: familyId, family_version: familyVersion, parameters, start_byte: startByte };
}

function compiledEffect(rule: Record<string, unknown>): unknown {
  const result = compileLeaves([
    leaf("CONDITION", "rule-active", normalizeFingerprintParameters("rule-active", rule, 2), 2, 10),
    leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" }, 1, 20),
  ]);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect;
}

describe("rule-active v2 option references", () => {
  it("is the current version, and v1 still takes only a whole-record id", () => {
    expect(currentFamilyVersion("rule-active")).toBe(2);
    expect(normalizeFingerprintParameters("rule-active", { rule: "oath-of-moment" }, 1)).toEqual({ rule: "oath-of-moment" });
    expect(() => normalizeFingerprintParameters("rule-active", { rule: option }, 1)).toThrow();
  });

  it("v2 canonicalises an option reference and keeps the string form and negation", () => {
    expect(normalizeFingerprintParameters("rule-active", { rule: { option_id: "example-stance", ability_id: "example-doctrines" }, negated: false }, 2))
      .toEqual({ rule: option, negated: false });
    expect(JSON.stringify(normalizeFingerprintParameters("rule-active", { rule: { option_id: "example-stance", ability_id: "example-doctrines" } }, 2)))
      .toBe('{"rule":{"ability_id":"example-doctrines","option_id":"example-stance"}}');
    expect(normalizeFingerprintParameters("rule-active", { rule: "oath-of-moment", negated: true }, 2)).toEqual({ rule: "oath-of-moment", negated: true });
  });

  it("v2 refuses an option reference that is incomplete, padded, or names a display label", () => {
    for (const rule of [
      { ability_id: "example-doctrines" },
      { option_id: "example-stance" },
      { ...option, name: "Example Stance" },
      { ability_id: "example-doctrines", option_id: "Example Stance" },
      { ability_id: "Example Doctrines", option_id: "example-stance" },
      { ability_id: "example-doctrines", option_id: "" },
      ["example-doctrines", "example-stance"],
    ]) expect(() => normalizeFingerprintParameters("rule-active", { rule }, 2)).toThrow();
    expect(() => normalizeFingerprintParameters("rule-active", { rule: option, extra: true }, 2)).toThrow();
  });

  it("moves a v1 leaf to v2 unchanged", () => {
    expect(mapToLatest("rule-active", 1, { rule: "oath-of-moment", negated: false })).toMatchObject({ version: 2, parameters: { rule: "oath-of-moment", negated: false } });
  });

  it("lowers an option reference to the condition schema's {ability_id, option_id} rule", () => {
    const reroll = { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } };
    expect(compiledEffect({ rule: option })).toEqual({ type: "conditional", condition: { type: "rule-active", parameters: { rule: option } }, effect: reroll });
    expect(compiledEffect({ rule: option, negated: true })).toEqual({
      type: "conditional", condition: { operator: "not", operands: [{ type: "rule-active", parameters: { rule: option } }] }, effect: reroll,
    });
    expect(compiledEffect({ rule: "oath-of-moment" })).toEqual({ type: "conditional", condition: { type: "rule-active", parameters: { rule: "oath-of-moment" } }, effect: reroll });
  });

  it("produces an entry that validates and renders on a real stance-consumer base", () => {
    const base = authored("adeptus-mechanicus", "murderous-imperative-adeptus-mechanicus");
    const result = compileLeaves([
      leaf("CONDITION", "rule-active", { rule: { ability_id: "doctrina-imperatives-adeptus-mechanicus", option_id: "option-1" } }, 2, 10),
      leaf("EFFECT", "reroll", { roll: "hit", subset: "ones" }, 1, 20),
    ]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const check = checkEntry(entryWithMechanics(base, result.mechanics));
    expect(check.errors).toEqual([]);
    expect(check.rendered_text).toMatch(/active/iu);
  });
});
}
