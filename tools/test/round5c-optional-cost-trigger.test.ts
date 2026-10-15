import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { DESIGNATION_IDS } from "../src/translate/designations.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/effect.js";

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

function errorsOf(list: CompileLeaf[], text: string): string[] {
  const result = compileLeaves(list, text);
  return result.ok ? [] : result.errors;
}

/** Every node of a JSON tree whose `type` is `type`. */
function nodesOf(tree: unknown, type: string): Record<string, any>[] {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodesOf(item, type));
  if (tree === null || typeof tree !== "object") return [];
  const record = tree as Record<string, any>;
  return [...(record.type === type ? [record] : []), ...Object.values(record).flatMap((value) => nodesOf(value, type))];
}

const v2 = (input: Record<string, unknown>) => normalizeFingerprintParameters("optional-cost-paid", input, 2);
const refused = (input: Record<string, unknown>) => expect(() => v2(input)).toThrow();

describe("optional-cost-paid version 2 parameters", () => {
  it("is the current version, and version 1 leaves keep their normalized form", () => {
    expect(currentFamilyVersion("optional-cost-paid")).toBe(2);
    expect(normalizeFingerprintParameters("optional-cost-paid", { pool: "yp-pool", window: "use", subject: "this-unit" }, 1))
      .toEqual({ pool: "yp-pool", window: "use", subject: "this-unit" });
  });

  it("keeps a version-1 use leaf readable under version 2 by giving it the legacy tag", () => {
    expect(v2({ pool: "yp-pool", window: "use", subject: "this-unit" })).toEqual({ pool: "yp-pool", window: "use", subject: "this-unit", tag: "yp-spent-this-use" });
    expect(() => v2({ pool: "yp-pool", window: "trigger", subject: "this-unit" })).toThrow(/needs the designation tag/);
  });

  it("accepts a trigger with its subject and tag, and defaults the holder to this unit", () => {
    expect(v2({ pool: "pain-token-pool", window: "trigger", subject: "this-unit", tag: "eye-of-spite-pain-spent" }))
      .toEqual({ pool: "pain-token-pool", window: "trigger", subject: "this-unit", tag: "eye-of-spite-pain-spent", holder: "this-unit" });
  });

  it("accepts a use with its own tag, and a turn with negation unchanged", () => {
    expect(v2({ pool: "yp-pool", window: "use", subject: "attacker", tag: "cyberstimm-infusion-yp-spent" }))
      .toEqual({ pool: "yp-pool", window: "use", subject: "attacker", tag: "cyberstimm-infusion-yp-spent" });
    expect(v2({ pool: "yp-pool", window: "turn", negated: true })).toEqual({ pool: "yp-pool", window: "turn", negated: true });
  });

  it("refuses a Pain token spend read as a use: a use reads YP", () => {
    refused({ pool: "pain-token-pool", window: "use", subject: "this-unit", tag: "x-spent" });
  });

  it("refuses a holder on a use or a turn, and a holder other than the two it names", () => {
    refused({ pool: "yp-pool", window: "use", subject: "this-unit", tag: "x-spent", holder: "this-unit" });
    refused({ pool: "yp-pool", window: "turn", holder: "this-unit" });
    refused({ pool: "yp-pool", window: "trigger", subject: "this-unit", tag: "x-spent", holder: "this-model" });
  });

  it("refuses a trigger with no tag or no subject, and a use with no subject", () => {
    refused({ pool: "yp-pool", window: "use", tag: "x-spent" });
    refused({ pool: "pain-token-pool", window: "trigger", subject: "this-unit" });
    refused({ pool: "pain-token-pool", window: "trigger", tag: "x-spent" });
  });

  it("refuses negation on a trigger, and a subject or tag on a turn", () => {
    refused({ pool: "yp-pool", window: "trigger", subject: "this-unit", tag: "x-spent", negated: true });
    refused({ pool: "yp-pool", window: "turn", subject: "this-unit" });
    refused({ pool: "yp-pool", window: "turn", tag: "x-spent" });
  });

  it("refuses a tag that is not a kebab-case id", () => {
    refused({ pool: "yp-pool", window: "use", subject: "this-unit", tag: "Not A Tag" });
  });
});

// Trigger (8844 shape): the ability's own event offers a spend, and a later "instead" clause reads its designation.
const BASTION_TEXT = "Each time a ranged attack targets the bearer's unit, if the attacking model is within 12\", worsen the Armour Penetration characteristic by 1. "
  + "If you spend 1YP, until the end of the phase, if the attacking model is within 18\", worsen the Armour Penetration characteristic by 1 instead.";

/** The 8844 shape. "you can spend" is the optional-use over the same words as the read (withOptionalUse). */
function bastionLeaves(text = BASTION_TEXT, tag = "bastion-shield-yp-spent", withOptionalUse = true): CompileLeaf[] {
  const leaves = placed(text,
    ["Each time a ranged attack targets the bearer's unit", "attack", { direction: "targeted", unit: "this-unit", attack_type: "ranged" }],
    ["if the attacking model is within 12\"", "unit-position", { kind: "within", inches: 12, of: "this-model", subject: "attacker", negated: false }],
    ["worsen the Armour Penetration characteristic by 1", "characteristic-modifier", { characteristics: ["AP"], operation: "worsen", value: 1, subject: "attack", weapon_type: "ranged" }],
    ["If you", "optional-cost-paid", { pool: "yp-pool", window: "trigger", subject: "this-unit", tag }],
    ["spend 1YP", "resource-spend", { pool: "yp-pool", amount: 1 }],
    ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["if the attacking model is within 18\"", "unit-position", { kind: "within", inches: 18, of: "this-model", subject: "attacker", negated: false }],
    ["worsen the Armour Penetration characteristic by 1", "characteristic-modifier", { characteristics: ["AP"], operation: "worsen", value: 1, subject: "attack", weapon_type: "ranged" }],
    ["instead", "instead", {}],
  );
  // "you can spend" shares the read's words: an optional-use over the same span, not a placed leaf after it.
  if (!withOptionalUse) return leaves;
  const read = leaves.find((leaf) => leaf.family_id === "optional-cost-paid")!;
  return [...leaves, { ...read, family_id: "optional-use", family_version: currentFamilyVersion("optional-use"), role: familyRole("optional-use", currentFamilyVersion("optional-use")), parameters: { who: "you" } }];
}

describe("trigger spend read by a later instead clause (8844 shape)", () => {
  it("compiles, with the instead clause holding one effect after the optional spend", () => {
    const mechanics = mechanicsOf(bastionLeaves(), BASTION_TEXT);
    const parts = nodesOf(mechanics, "ability-part").filter((part) => part.optional === true);
    expect(parts).toHaveLength(1);
    expect(nodesOf(mechanics, "resource-spend")).toHaveLength(1);
  });

  it("offers the spend until it is paid: its part is gated on the designation not being set", () => {
    const mechanics = mechanicsOf(bastionLeaves(), BASTION_TEXT);
    const part = nodesOf(mechanics, "ability-part").find((node) => node.optional === true)!;
    expect(part.effect.type).toBe("conditional");
    expect(part.effect.condition).toEqual({ operator: "not", operands: [{ type: "designated", parameters: { subject: "this-unit", tag: "bastion-shield-yp-spent" } }] });
    const steps = part.effect.effect.steps as Record<string, any>[];
    expect(steps.map((step) => step.type)).toEqual(["resource-spend", "designate"]);
    expect(steps[1]).toEqual({ type: "designate", target: "this-unit", modifier: { tag: "bastion-shield-yp-spent", clears_on: "phase" } });
  });

  it("sets the designation on the triggering attack's unit and clears it at the phase end", () => {
    const mechanics = mechanicsOf(bastionLeaves(), BASTION_TEXT);
    const designates = nodesOf(mechanics, "designate");
    expect(designates.map((node) => node.modifier.clears_on)).toEqual(["phase"]);
  });

  it("keeps the moment non-optional: the spend is the optional part, not the trigger", () => {
    const mechanics = mechanicsOf(bastionLeaves(), BASTION_TEXT);
    expect(mechanics.triggers?.[0]?.optional).toBeUndefined();
  });

  it("refuses a trigger read with no duration for its designation", () => {
    const leaves = bastionLeaves().filter((leaf) => leaf.family_id !== "duration");
    expect(errorsOf(leaves, BASTION_TEXT).join(" ")).toMatch(/names no duration/);
  });
});

describe("trigger pairing: the spend must be optional", () => {
  it("refuses a trigger read whose ability has no spend of its pool", () => {
    const leaves = bastionLeaves().filter((leaf) => leaf.family_id !== "resource-spend");
    expect(errorsOf(leaves, BASTION_TEXT).join(" ")).toMatch(/exactly one spend/);
  });

  it("refuses a trigger read whose ability has two spends of its pool", () => {
    const leaves = bastionLeaves();
    const spend = leaves.find((leaf) => leaf.family_id === "resource-spend")!;
    expect(errorsOf([...leaves, { ...spend, start_byte: 0, end_byte: 1 }], BASTION_TEXT).join(" ")).toMatch(/exactly one spend/);
  });

  it("refuses a mandatory spend read as a trigger: no optional-use and no or-alternative", () => {
    expect(errorsOf(bastionLeaves(BASTION_TEXT, "bastion-shield-yp-spent", false), BASTION_TEXT).join(" ")).toMatch(/mandatory/);
  });

  it("accepts the same spend once an optional-use says the player can spend it", () => {
    expect(errorsOf(bastionLeaves(), BASTION_TEXT)).toEqual([]);
  });
});

/** The condition of each conditional whose effect matches `pattern` (the gates of the matching effects). */
function conditionalsAbove(tree: unknown, pattern: RegExp): unknown[] {
  if (Array.isArray(tree)) return tree.flatMap((item) => conditionalsAbove(item, pattern));
  if (tree === null || typeof tree !== "object") return [];
  const record = tree as Record<string, any>;
  const own = record.type === "conditional" && pattern.test(JSON.stringify(record.effect)) ? [record.condition] : [];
  return [...own, ...Object.values(record).flatMap((value) => conditionalsAbove(value, pattern))];
}

describe("trigger spend in an or-alternative (8925 shape)", () => {
  const OR_TEXT = "Each time a fabricated unit is selected to fight, if it disembarked from a TRANSPORT this turn, or if you spend 2YP, until the end of the phase, the weapons of that unit have the SUSTAINED HITS 2 ability.";
  const orLeaves = (tag = "trivarg-yp-spent") => placed(OR_TEXT,
    ["Each time a fabricated unit is selected to fight", "event", { kind: "selected-to-fight" }],
    ["if it disembarked from a TRANSPORT this turn", "unit-activity", { activities: ["disembarked-this-turn"], subject: "this-unit", negated: false }],
    ["if you", "optional-cost-paid", { pool: "yp-pool", window: "trigger", subject: "this-unit", tag }],
    ["spend 2YP", "resource-spend", { pool: "yp-pool", amount: 2 }],
    ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["the weapons of that unit have the", "weapon-ability-grant", { subject: "this-unit", weapon_type: "all" }],
    ["SUSTAINED HITS 2", "weapon-ability-keyword", { keyword: "Sustained Hits 2" }],
  );

  it("accepts the read as an alternative of the disembark condition, not as a stacked gate", () => {
    const mechanics = mechanicsOf(orLeaves(), OR_TEXT);
    expect(JSON.stringify(mechanics)).toContain("\"operator\":\"or\"");
    // The grant is gated on the either-or: the disembark, or the designation the paid spend set.
    const grantGates = conditionalsAbove(mechanics, /sustain/iu);
    expect(grantGates).toHaveLength(1);
    const gate = JSON.stringify(grantGates[0]);
    expect(gate).toContain("\"operator\":\"or\"");
    expect(gate).toContain("disembarked");
    expect(gate).toContain("\"tag\":\"trivarg-yp-spent\"");
  });

  it("gates the spend on the other alternative not holding, and on the designation not set", () => {
    const mechanics = mechanicsOf(orLeaves(), OR_TEXT);
    const part = nodesOf(mechanics, "ability-part").find((node) => node.optional === true)!;
    expect(part.effect.type).toBe("conditional");
    const condition = JSON.stringify(part.effect.condition);
    expect(condition).toContain("\"operator\":\"not\"");
    expect(condition).toContain("\"type\":\"happened\"");
    expect(condition).toContain("disembarked");
    expect(condition).toContain("trivarg-yp-spent");
  });
});

describe("per-ability designation tags", () => {
  it("takes each read's and spend's tag from the leaf, not a shared one", () => {
    const mechanics = mechanicsOf(bastionLeaves(BASTION_TEXT, "bastion-shield-yp-spent"), BASTION_TEXT);
    expect(JSON.stringify(mechanics)).toContain("bastion-shield-yp-spent");
    expect(JSON.stringify(mechanics)).not.toContain("yp-spent-this-use");
  });

  it("registers every tag the trigger shapes name", () => {
    for (const tag of ["bastion-shield-yp-spent", "trivarg-yp-spent", "eye-of-spite-pain-spent", "instinctive-spite-pain-spent", "cyberstimm-infusion-yp-spent", "exposed-flaws-yp-spent", "honour-of-the-hold-yp-spent", "optimal-expenditure-yp-spent", "privateer-arsenal-yp-spent"]) {
      expect(DESIGNATION_IDS.has(tag)).toBe(true);
    }
  });
});

// Use spend read by an attacker-subject condition inside the attack moment (SS-A, 4213 shape).
const ATTACK_USE_TEXT = "Each time you use this Stratagem, you can spend 2YP. Until the end of the phase, each time a model in this unit makes an attack, "
  + "re-roll a Wound roll of 1. If you spent YP during this use of this Stratagem, re-roll the Wound roll instead.";

function attackUseLeaves(read: Record<string, unknown>): CompileLeaf[] {
  return placed(ATTACK_USE_TEXT,
    ["Each time you use this Stratagem", "event", { kind: "used", activity: "stratagem" }],
    ["you can", "optional-use", { who: "you" }],
    ["spend 2YP", "resource-spend", { pool: "yp-pool", amount: 2 }],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
    ["re-roll a Wound roll of 1", "reroll", { roll: "wound", subset: "ones", weapon_type: "all" }],
    ["If you spent YP during this use of this Stratagem", "optional-cost-paid", read],
    ["re-roll the Wound roll", "reroll", { roll: "wound", subset: "all", weapon_type: "all" }],
    ["instead", "instead", {}],
  );
}

describe("attacker-subject use read in the attack moment (SS-A, 4213 shape)", () => {
  it("reads the attacker's designation and sets it on this unit for the phase", () => {
    const mechanics = mechanicsOf(attackUseLeaves({ pool: "yp-pool", window: "use", subject: "attacker", tag: "cyberstimm-infusion-yp-spent" }), ATTACK_USE_TEXT);
    expect(JSON.stringify(mechanics)).toContain("{\"type\":\"designated\",\"parameters\":{\"subject\":\"attacker\",\"tag\":\"cyberstimm-infusion-yp-spent\"}}");
    const designates = nodesOf(mechanics, "designate");
    expect(designates).toEqual([{ type: "designate", target: "this-unit", modifier: { tag: "cyberstimm-infusion-yp-spent", clears_on: "phase" } }]);
  });

  it("refuses a use read with no tag: version 2 leaves name their designation", () => {
    const leaves = attackUseLeaves({ pool: "yp-pool", window: "use", subject: "attacker" }).map((leaf) => leaf.family_id === "optional-cost-paid" ? { ...leaf, family_version: 2 } : leaf);
    expect(errorsOf(leaves, ATTACK_USE_TEXT).join(" ")).toMatch(/names no designation tag/);
  });
});

// Pain-token trigger (8289 shape): the spend is the ability's own optional part; "if you do" reads it.
const PAIN_TEXT = "Each time the bearer's unit is selected to fight, improve the Armour Penetration characteristic of its weapons by 1. "
  + "You can spend 1 Pain token; if you do, until the end of the phase, improve the Armour Penetration characteristic by 2 instead.";

function painLeaves(holder?: string): CompileLeaf[] {
  return placed(PAIN_TEXT,
    ["Each time the bearer's unit is selected to fight", "event", { kind: "selected-to-fight" }],
    ["improve the Armour Penetration characteristic of its weapons by 1", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1, subject: "this-unit", weapon_type: "all" }],
    ["You can", "optional-use", { who: "you" }],
    ["spend 1 Pain token", "resource-spend", { pool: "pain-token-pool", amount: 1, label: "Pain token" }],
    ["if you do", "optional-cost-paid", { pool: "pain-token-pool", window: "trigger", subject: "this-unit", tag: "eye-of-spite-pain-spent", ...(holder ? { holder } : {}) }],
    ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["improve the Armour Penetration characteristic by 2", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 2, subject: "this-unit", weapon_type: "all" }],
    ["instead", "instead", {}],
  );
}

describe("Pain-token trigger (8289 shape)", () => {
  it("keeps the trigger moment mandatory and makes only the spend an optional part", () => {
    const mechanics = mechanicsOf(painLeaves(), PAIN_TEXT);
    expect(mechanics.triggers?.[0]?.optional).toBeUndefined();
    const parts = nodesOf(mechanics, "ability-part").filter((part) => part.optional === true);
    expect(parts).toHaveLength(1);
    expect(JSON.stringify(parts[0])).toContain("pain-token-pool");
  });

  it("replaces the base AP change with the designated one, on the same unit", () => {
    const mechanics = mechanicsOf(painLeaves(), PAIN_TEXT);
    expect(JSON.stringify(mechanics)).toContain("{\"type\":\"designated\",\"parameters\":{\"subject\":\"this-unit\",\"tag\":\"eye-of-spite-pain-spent\"}}");
    expect(nodesOf(mechanics, "designate")[0]!.modifier).toEqual({ tag: "eye-of-spite-pain-spent", clears_on: "phase" });
  });

  it("refuses a holder the spend-once shape does not compile yet (selected units)", () => {
    expect(errorsOf(painLeaves("selected-unit"), PAIN_TEXT).join(" ")).toMatch(/selected-unit/);
  });
});

// Use spend read by an attacker-subject condition in an instead that changes a characteristic (SS-A, 4243 shape).
const AP_USE_TEXT = "Each time you use this Stratagem, you can spend 1YP. Until the end of the phase, each time a model in this unit makes an attack, "
  + "improve the Armour Penetration characteristic of its weapons by 1. If you spent YP during this use of this Stratagem, improve the Armour Penetration characteristic by 2 instead.";

describe("attacker-subject use read in an instead that changes a characteristic (SS-A, 4243 shape)", () => {
  it("replaces the base change with the paid one, and the spend precedes both", () => {
    const leaves = placed(AP_USE_TEXT,
      ["Each time you use this Stratagem", "event", { kind: "used", activity: "stratagem" }],
      ["you can", "optional-use", { who: "you" }],
      ["spend 1YP", "resource-spend", { pool: "yp-pool", amount: 1 }],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["improve the Armour Penetration characteristic of its weapons by 1", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1, subject: "attack", weapon_type: "all" }],
      ["If you spent YP during this use of this Stratagem", "optional-cost-paid", { pool: "yp-pool", window: "use", subject: "attacker", tag: "exposed-flaws-yp-spent" }],
      ["improve the Armour Penetration characteristic by 2", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 2, subject: "attack", weapon_type: "all" }],
      ["instead", "instead", {}],
    );
    const mechanics = mechanicsOf(leaves, AP_USE_TEXT);
    const json = JSON.stringify(mechanics);
    expect(json.indexOf("\"type\":\"ability-part\"")).toBeLessThan(json.indexOf("\"stat-modifier\""));
    expect(json).toContain("\"subject\":\"attacker\",\"tag\":\"exposed-flaws-yp-spent\"");
  });
});

describe("two-reroll instead (SS-A, 8892 shape)", () => {
  it("replaces the second re-roll, the one it names, not the first", () => {
    const text = "Each time you use this Stratagem, you can spend 2YP. Until the end of the phase, each time a model in this unit makes an attack, "
      + "re-roll a Hit roll of 1 and re-roll a Wound roll of 1. If you spent YP during this use of this Stratagem, re-roll the Wound roll instead.";
    const leaves = placed(text,
      ["Each time you use this Stratagem", "event", { kind: "used", activity: "stratagem" }],
      ["you can", "optional-use", { who: "you" }],
      ["spend 2YP", "resource-spend", { pool: "yp-pool", amount: 2 }],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }],
      ["re-roll a Wound roll of 1", "reroll", { roll: "wound", subset: "ones", weapon_type: "all" }],
      ["If you spent YP during this use of this Stratagem", "optional-cost-paid", { pool: "yp-pool", window: "use", subject: "attacker", tag: "optimal-expenditure-yp-spent" }],
      ["re-roll the Wound roll", "reroll", { roll: "wound", subset: "all", weapon_type: "all" }],
      ["instead", "instead", {}],
    );
    const mechanics = mechanicsOf(leaves, text);
    // Each re-roll with its enclosing gates: the paid instead re-roll is gated on the designation, the base ones are not.
    // "paid": the gate holds only when the spend was paid; "not-paid": the base re-roll the paid instead replaces.
    const classify = (gate: unknown) => {
      const text = JSON.stringify(gate);
      if (!text.includes("optimal-expenditure-yp-spent")) return "other";
      return text.includes("\"operator\":\"not\"") ? "not-paid" : "paid";
    };
    expect(rerollGates(mechanics).map((item) => {
      const modifier = item.modifier as Record<string, string>;
      return { roll: modifier.roll, scope: modifier.result_scope ?? modifier.subset, gates: item.gates.map(classify) };
    })).toEqual([
      { roll: "hit", scope: "ones", gates: [] },
      { roll: "wound", scope: "ones", gates: ["not-paid"] },
      { roll: "wound", scope: "any-result", gates: ["paid"] },
    ]);
  });
});

/** Each re-roll node with the conditions that enclose it. */
function rerollGates(tree: unknown, outer: unknown[] = []): Array<{ modifier: unknown; gates: unknown[] }> {
  if (Array.isArray(tree)) return tree.flatMap((item) => rerollGates(item, outer));
  if (tree === null || typeof tree !== "object") return [];
  const record = tree as Record<string, any>;
  if (record.type === "re-roll") return [{ modifier: record.modifier, gates: outer }];
  const next = record.type === "conditional" ? [...outer, record.condition] : outer;
  return Object.values(record).flatMap((value) => rerollGates(value, next));
}

describe("compiled trigger part is a valid DSL effect", () => {
  it("validates the gated optional part against the effect schema", () => {
    const mechanics = mechanicsOf(bastionLeaves(), BASTION_TEXT);
    const part = nodesOf(mechanics, "ability-part").find((node) => node.optional === true)!;
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
    expect(validate(part)).toBe(true);
  });
});

describe("describer output for the trigger shapes", () => {
  it("prints the Pain-token spend as optional, and the instead as gated on the designation", () => {
    const mechanics = mechanicsOf(painLeaves(), PAIN_TEXT);
    const text = describeAbility({ effect: mechanics.effect, scope: mechanics.scope, trigger: mechanics.trigger } as never);
    expect(text).toContain("You can: ");
    expect(text).toContain("spend 1 Pain token");
    expect(text).toContain("tagged eye of spite pain spent");
    expect(text).toContain("improve the unit's Armour Penetration characteristic by 2");
  });
});

/** The condition nodes that enclose every node of `type` in `tree` (outermost first). */
function enclosingConditions(tree: unknown, type: string, outer: unknown[] = []): unknown[][] {
  if (Array.isArray(tree)) return tree.flatMap((item) => enclosingConditions(item, type, outer));
  if (tree === null || typeof tree !== "object") return [];
  const record = tree as Record<string, any>;
  if (record.type === type) return [outer];
  const next = record.type === "conditional" ? [...outer, record.condition] : outer;
  return Object.values(record).flatMap((value) => enclosingConditions(value, type, next));
}

describe("the offer of a trigger spend is not gated by its own read (8844 shape)", () => {
  it("keeps the optional part outside any gate on the designation it sets", () => {
    const mechanics = mechanicsOf(bastionLeaves(), BASTION_TEXT);
    const tag = "bastion-shield-yp-spent";
    const onTag = (condition: unknown) => JSON.stringify(condition).includes(`"tag":"${tag}"`) && !JSON.stringify(condition).includes("\"operator\":\"not\"");
    for (const gates of enclosingConditions(mechanics, "ability-part")) {
      expect(gates.some(onTag)).toBe(false);
    }
  });
});

describe("and/or of two optional-spend reads on one attack (4224 shape)", () => {
  const TEXT = "Each time you use this Stratagem, you can spend 2YP. Until the end of the phase, each time a model in your unit makes an attack, "
    + "if you spent YP during this use of this Stratagem and/or if that attack targets an assailed unit, re-roll the Wound roll.";
  const leavesFor = (joiner: string) => placed(TEXT.replace("and/or", joiner),
    ["Each time you use this Stratagem", "event", { kind: "used", activity: "stratagem" }],
    ["you can", "optional-use", { who: "you" }],
    ["spend 2YP", "resource-spend", { pool: "yp-pool", amount: 2 }],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["each time a model in your unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
    ["if you spent YP during this use of this Stratagem", "optional-cost-paid", { pool: "yp-pool", window: "use", subject: "attacker", tag: "exposed-flaws-yp-spent" }],
    ["if that attack targets an assailed unit", "designated-filter", { subject: "defender", tag: "assailed" }],
    ["re-roll the Wound roll", "reroll", { roll: "wound", subset: "all", weapon_type: "all" }],
  );

  it("gates the re-roll on either read: an any-of of the paid spend and the assailed target", () => {
    const mechanics = mechanicsOf(leavesFor("and/or"), TEXT);
    const json = JSON.stringify(mechanics);
    expect(json).toContain("\"operator\":\"or\"");
    expect(json).toContain("\"subject\":\"attacker\",\"tag\":\"exposed-flaws-yp-spent\"");
    expect(json).toContain("\"subject\":\"defender\",\"tag\":\"assailed\"");
  });

  it("gates the re-roll on both reads when the words are a plain and, not an alternative", () => {
    const mechanics = mechanicsOf(leavesFor("and"), TEXT.replace("and/or", "and"));
    const json = JSON.stringify(mechanics);
    expect(json).not.toContain("\"operator\":\"or\"");
  });
});
