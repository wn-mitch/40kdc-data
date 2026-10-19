import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";
import { foldAlternativeConditions } from "../src/semantic-authoring/compile-alternative-conditions.js";
import { normalizeOptionalCostParameters } from "../src/semantic-authoring/optional-cost-families.js";
import { DESIGNATION_IDS, designationLabel } from "../src/translate/designations.js";
import { createValidator } from "../src/schema-loader.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
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

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

/** Every node of a JSON tree whose `type` is `type`. */
function nodesOf(tree: unknown, type: string): Record<string, any>[] {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodesOf(item, type));
  if (tree === null || typeof tree !== "object") return [];
  const record = tree as Record<string, any>;
  return [...(record.type === type ? [record] : []), ...Object.values(record).flatMap((value) => nodesOf(value, type))];
}

const SHOOTING_WINDOW = { your_phases: ["shooting"], opponent_phases: [], either_phases: [] };
const grant = (wording: string, keyword: string): Array<[string, string, Record<string, unknown>]> => [
  [wording, "weapon-ability-grant", { subject: "this-unit", weapon_type: "ranged" }],
  [keyword, "weapon-ability-keyword", { keyword: keyword === "SUSTAINED HITS 1" ? "Sustained Hits 1" : "Sustained Hits 2" }],
];

// Use-time spend (S1): "you can spend YP" is an optional part of the ability, and a later clause
// reads the designation that part set on the target unit.
const S1_TEXT = "Your Shooting phase. One ORBITAL unit from your army. Each time you use this Stratagem, you can spend 3YP. "
  + "Until the end of the phase, ranged weapons equipped by models in that unit have the SUSTAINED HITS 1 ability. "
  + "If you spent YP during this use of this Stratagem, until the end of the phase, those weapons have the SUSTAINED HITS 2 ability instead.";

function s1Leaves(text: string, read: Record<string, unknown> = { pool: "yp-pool", window: "use", subject: "this-unit" }): CompileLeaf[] {
  // Version 1 leaves: a use that names no tag reads the legacy designation (version 2 names its own).
  return placed(text,
    ["Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }],
    ["One", "stratagem-target", { count: "one" }],
    ["ORBITAL unit", "unit-filter", { side: "friendly", keywords: ["ORBITAL"] }],
    ["Each time you use this Stratagem", "event", { kind: "used", activity: "stratagem" }],
    ["you can", "optional-use", { who: "you" }],
    ["spend 3YP", "resource-spend", { pool: "yp-pool", amount: 3 }],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ...grant("ranged weapons equipped by models in that unit have the", "SUSTAINED HITS 1"),
    ["If you spent YP during this use of this Stratagem", "optional-cost-paid", read],
    ...grant("those weapons have the", "SUSTAINED HITS 2"),
    ["instead", "instead", {}],
  ).map((leaf) => leaf.family_id === "optional-cost-paid" ? { ...leaf, family_version: 1 } : leaf);
}

describe("optional-cost-paid parameters", () => {
  it("accepts window use with a subject and window turn with negation", () => {
    expect(normalizeOptionalCostParameters("optional-cost-paid", { pool: "yp-pool", window: "use", subject: "attacker" })).toEqual({ pool: "yp-pool", window: "use", subject: "attacker" });
    expect(normalizeOptionalCostParameters("optional-cost-paid", { pool: "yp-pool", window: "turn", negated: true })).toEqual({ pool: "yp-pool", window: "turn", negated: true });
  });

  it("refuses window use with no subject: the spender is never defaulted", () => {
    expect(() => normalizeOptionalCostParameters("optional-cost-paid", { pool: "yp-pool", window: "use" })).toThrow(/subject/);
  });

  it("refuses negation on window use and a subject on window turn", () => {
    expect(() => normalizeOptionalCostParameters("optional-cost-paid", { pool: "yp-pool", window: "use", subject: "this-unit", negated: true })).toThrow(/negated/);
    expect(() => normalizeOptionalCostParameters("optional-cost-paid", { pool: "yp-pool", window: "turn", subject: "this-unit" })).toThrow();
  });

  it("refuses a pool with no designation", () => {
    expect(() => normalizeOptionalCostParameters("optional-cost-paid", { pool: "cp-pool", window: "turn" })).toThrow();
  });
});

describe("use-time spend, gated clause later in the same use (S1)", () => {
  it("makes the spend an optional part and leaves the use itself mandatory", () => {
    const mechanics = mechanicsOf(s1Leaves(S1_TEXT), S1_TEXT);
    expect(mechanics.triggers?.[0]?.optional).toBeUndefined();
    const parts = nodesOf(mechanics, "ability-part").filter((part) => part.optional === true);
    expect(parts).toHaveLength(1);
    const steps = parts[0]!.effect.steps as Record<string, any>[];
    expect(steps.map((step) => step.type)).toEqual(["resource-spend", "designate"]);
    expect(steps[0]!.modifier.pool).toBe("yp-pool");
    expect(steps[1]).toEqual({ type: "designate", target: "this-unit", modifier: { tag: "yp-spent-this-use", clears_on: "phase" } });
  });

  it("gates the instead clause on the designation on the target unit", () => {
    const mechanics = mechanicsOf(s1Leaves(S1_TEXT), S1_TEXT);
    const steps = (mechanics.effect.steps as Record<string, any>[]).filter((step) => step.type === "conditional");
    expect(steps).toHaveLength(2);
    // "instead": the base grant holds only while the designation is absent; the replacement holds when it is set.
    const [base, replacement] = steps as [Record<string, any>, Record<string, any>];
    expect(base.effect.modifier.keywords).toEqual([{ keyword_id: "sustained-hits", parameters: { value: 1 } }]);
    expect(base.condition).toEqual({ operator: "not", operands: [{ type: "matches", parameters: { subject: "this-unit", filter: { designated: "yp-spent-this-use" } } }] });
    expect(replacement.effect.modifier.keywords).toEqual([{ keyword_id: "sustained-hits", parameters: { value: 2 } }]);
    expect(replacement.condition).toEqual({ type: "matches", parameters: { subject: "this-unit", filter: { designated: "yp-spent-this-use" } } });
  });

  it("refuses a read whose pool has no spend in the same ability", () => {
    const text = S1_TEXT.replace("spend 3YP", "spend 3YP and gain 1CP");
    const leaves = s1Leaves(text).filter((leaf) => leaf.family_id !== "resource-spend");
    expect(() => mechanicsOf(leaves, text)).toThrow(/exactly one spend/);
  });

  it("refuses a read with two spends of the pool before it", () => {
    const leaves = s1Leaves(S1_TEXT);
    const extra: CompileLeaf = { ...leaves.find((leaf) => leaf.family_id === "resource-spend")!, start_byte: 0, end_byte: 1 };
    expect(() => mechanicsOf([...leaves, extra], S1_TEXT)).toThrow(/exactly one spend/);
  });

  it("refuses a use read with no used event that starts the ability", () => {
    const leaves = s1Leaves(S1_TEXT).filter((leaf) => leaf.family_id !== "event");
    expect(() => mechanicsOf(leaves, S1_TEXT)).toThrow(/used event/);
  });
});

describe("turn-scoped absence (S3)", () => {
  const TURN_TEXT = "Your Shooting phase. One ORBITAL unit from your army. If you spent no YP in that turn, add 1 to the Hit roll.";

  it("reads the resource-spent events of the turn under not", () => {
    const leaves = placed(TURN_TEXT,
      ["Your Shooting phase", "use-window", SHOOTING_WINDOW],
      ["One", "stratagem-target", { count: "one" }],
      ["ORBITAL unit", "unit-filter", { side: "friendly", keywords: ["ORBITAL"] }],
      ["If you spent no YP in that turn", "optional-cost-paid", { pool: "yp-pool", window: "turn", negated: true }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    const mechanics = mechanicsOf(leaves, TURN_TEXT);
    const gates = nodesOf(mechanics, "happened");
    expect(gates).toHaveLength(1);
    expect(gates[0]!.parameters).toEqual({ event: "resource-spent", filter: { pool: "yp-pool" }, window: "turn" });
    expect(JSON.stringify(mechanics)).toContain("\"operator\":\"not\"");
  });

  it("reads a spend of the turn without negation when not negated", () => {
    const text = TURN_TEXT.replace("If you spent no YP in that turn", "If you spent YP in that turn");
    const leaves = placed(text,
      ["Your Shooting phase", "use-window", SHOOTING_WINDOW],
      ["One", "stratagem-target", { count: "one" }],
      ["ORBITAL unit", "unit-filter", { side: "friendly", keywords: ["ORBITAL"] }],
      ["If you spent YP in that turn", "optional-cost-paid", { pool: "yp-pool", window: "turn" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    const mechanics = mechanicsOf(leaves, text);
    expect(JSON.stringify(mechanics)).not.toContain("\"operator\":\"not\"");
    expect(nodesOf(mechanics, "happened")[0]!.parameters.window).toBe("turn");
  });
});

describe("and/or joins alternative conditions (connective)", () => {
  const TEXT = "If your unit is ready and/or that unit is near, add 1.";
  const cond = (wording: string, start: number, end: number): CompileLeaf => ({
    role: "CONDITION", family_id: "unit-state", family_version: currentFamilyVersion("unit-state"), parameters: { state: wording },
    start_byte: start, end_byte: end, fragment: "RAW_TEXT",
  });
  const bytes = Buffer.from(TEXT, "utf8");
  const a = bytes.indexOf("your unit is ready") ;
  const b = bytes.indexOf("that unit is near");
  const left = cond("ready", a, a + "your unit is ready".length);
  const right = cond("near", b, b + "that unit is near".length);

  it("folds two conditions joined by and/or into one any-of", () => {
    const folded = foldAlternativeConditions([left, right], TEXT);
    expect(folded).toHaveLength(1);
    expect(folded[0]!.family_id).toBe("__any-of");
  });

  it("does not fold two conditions joined by a plain and", () => {
    const andText = TEXT.replace("and/or", "and");
    const folded = foldAlternativeConditions([left, right], andText);
    expect(folded).toHaveLength(2);
  });
});

describe("designation registry", () => {
  it("registers the spend designation with a label the describers can print", () => {
    expect(DESIGNATION_IDS.has("yp-spent-this-use")).toBe(true);
    expect(designationLabel("yp-spent-this-use")).toBe("YP-spent this use");
  });
});

describe("compiled optional part is a valid DSL effect", () => {
  it("validates the optional spend part against the effect schema", () => {
    const mechanics = mechanicsOf(s1Leaves(S1_TEXT), S1_TEXT);
    const part = nodesOf(mechanics, "ability-part").find((node) => node.optional === true)!;
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
    expect(validate(part)).toBe(true);
  });
});
