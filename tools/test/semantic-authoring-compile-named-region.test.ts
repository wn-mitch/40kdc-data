import type { NamedRegionStateEffect } from "../src/generated.js";
import { describe, expect, it } from "vitest";
import { createValidator } from "../src/schema-loader.js";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters, reviewedFamily } from "../src/semantic-authoring/contracts.js";

/**
 * named-region-state lowers directly to the canonical producer/consumer contract. These checks
 * assert the contract rather than comparing against legacy authored output.
 */
function leaf(parameters: Record<string, unknown>): CompileLeaf {
  return {
    role: "EFFECT",
    family_id: "named-region-state",
    family_version: currentFamilyVersion("named-region-state"),
    parameters: normalizeFingerprintParameters("named-region-state", parameters),
    start_byte: 0,
  };
}

function compiled(parameters: Record<string, unknown>) {
  const result = compileLeaves([leaf(parameters)]);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

const effectOk = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;

const PARAMETERS = {
  region_id: "custom-region",
  owner_faction: "custom-faction",
  behavior: "aura",
  membership_scope: "model",
  beneficiary_operator: "and",
  beneficiary_keywords: ["CUSTOM"],
  default_branch: { kind: "reroll", roll: "hit", subset: "ones", optional: false },
  qualified_branch: { kind: "reroll", roll: "hit", subset: "any", optional: false },
} as const;

const CUSTOM_PHASE = {
  region: { territory: "enemy-deployment-zone" },
  condition: {
    type: "controls",
    parameters: {
      by: "friendly",
      objective: { territory: "enemy-territory" },
      proportion: { comparison: "gte", fraction: 0.75 },
    },
  },
  trigger: { event: "round-started" },
  duration: "turn",
  evaluation: "snapshot-once",
} as const;

describe("Semantic authoring named-region-state compiler", () => {
  it("emits a schema-valid canonical consumer, branch wrapper and catalog weapon selector", () => {
    const result = compiled({
      region_id: "flow-of-magic", owner_faction: "thousand-sons", behavior: "aura", membership_scope: "model",
      beneficiary_operator: "and", beneficiary_keywords: ["THOUSAND SONS"],
      default_branch: { kind: "reroll", roll: "wound", subset: "ones", weapon_keyword: "Psychic", optional: false },
      qualified_branch: { kind: "roll-modifier", roll: "wound", operation: "add", value: 1, weapon_keyword: "Psychic", optional: false },
    });
    expect(effectOk(result.mechanics.effect), JSON.stringify(effectOk.errors)).toBe(true);
    const effect = result.mechanics.effect as unknown as NamedRegionStateEffect;
    const { modifier } = effect;
    const { producer, consumer } = modifier;
    if (!consumer) throw new Error("expected a consumer");
    expect(producer.baseline).toEqual([{ region: { territory: "your-deployment-zone" }, duration: "permanent" }]);
    expect(producer.phase_extensions).toEqual([
      { region: { territory: "no-mans-land" }, condition: { type: "controls", parameters: { by: "friendly", objective: { territory: "no-mans-land" }, proportion: { comparison: "gte", fraction: 0.5 } } }, trigger: { event: "phase-started" }, duration: "phase", evaluation: "snapshot-once" },
      { region: { territory: "enemy-deployment-zone" }, condition: { type: "controls", parameters: { by: "friendly", objective: { territory: "enemy-deployment-zone" }, proportion: { comparison: "gte", fraction: 0.5 } } }, trigger: { event: "phase-started" }, duration: "phase", evaluation: "snapshot-once" },
    ]);
    expect(consumer.beneficiary_filter).toEqual({ owner: "friendly", all_of: ["THOUSAND SONS"] });
    expect(consumer).not.toHaveProperty("eligibility");
    const defaultPart = consumer.default_branch.effect;
    const qualifiedPart = consumer.qualified_branch.effect;
    expect(defaultPart.type).toBe("ability-part");
    expect(qualifiedPart.type).toBe("ability-part");
    expect(defaultPart.effect).toMatchObject({ modifier: { weapons: { keyword: { keyword_id: "psychic" } } } });
    expect(defaultPart.trigger).toBeUndefined();
    expect(qualifiedPart.duration).toBeUndefined();
    expect(modifier.branch_precedence).toBe("qualified-replaces-default");
  });

  it("uses matches predicates for qualified keyword/visibility and a canonical proximity extension", () => {
    const result = compiled({
      region_id: "hallowed-ground", owner_faction: "grey-knights", behavior: "passive", membership_scope: "whole-unit",
      beneficiary_operator: "and", beneficiary_keywords: ["GREY KNIGHTS"],
      qualifies_by_keyword: "PURIFIER SQUAD", melee_or_visible_ranged: true,
      proximity_extension: { gate_ref: "purifier-sources", keywords: ["PURIFIER SQUAD"], radius_inches: 6 },
      default_branch: { kind: "reroll", roll: "hit", subset: "ones", optional: false },
      qualified_branch: { kind: "reroll", roll: "hit", subset: "any", optional: true },
    });
    const effect = result.mechanics.effect as unknown as NamedRegionStateEffect;
    const { producer, consumer } = effect.modifier;
    if (!consumer) throw new Error("expected a consumer");
    expect(producer.additive_extensions).toEqual([
      { kind: "unit-proximity", filter: { owner: "friendly", all_of: ["PURIFIER SQUAD"] }, range: { inches: 6 } },
    ]);
    expect(JSON.stringify(consumer.qualified_condition)).toContain("\"type\":\"matches\"");
    expect(JSON.stringify(consumer.attack_condition)).toContain("\"type\":\"matches\"");
  });

  it.each([
    {
      name: "historical defaults",
      recipe: {},
      baseline: [{ region: { territory: "your-deployment-zone" }, duration: "permanent" }],
      phases: 2,
    },
    {
      name: "baseline only",
      recipe: { baseline_region: { territory: "no-mans-land" } },
      baseline: [{ region: { territory: "no-mans-land" }, duration: "permanent" }],
      phases: 2,
    },
    {
      name: "phase extensions only",
      recipe: { phase_extensions: [CUSTOM_PHASE] },
      baseline: [{ region: { territory: "your-deployment-zone" }, duration: "permanent" }],
      phases: [CUSTOM_PHASE],
    },
    {
      name: "baseline and phase extensions",
      recipe: { baseline_region: { territory: "enemy-deployment-zone" }, phase_extensions: [CUSTOM_PHASE] },
      baseline: [{ region: { territory: "enemy-deployment-zone" }, duration: "permanent" }],
      phases: [CUSTOM_PHASE],
    },
  ])("lowers $name independently", ({ recipe, baseline, phases }) => {
    const result = compiled({ ...PARAMETERS, ...recipe });
    expect(effectOk(result.mechanics.effect), JSON.stringify(effectOk.errors)).toBe(true);
    const effect = result.mechanics.effect as unknown as NamedRegionStateEffect;
    const { producer } = effect.modifier;
    expect(producer.baseline).toEqual(baseline);
    if (typeof phases === "number") expect(producer.phase_extensions).toHaveLength(phases);
    else expect(producer.phase_extensions).toEqual(phases);
  });

  it("rejects malformed canonical recipe fragments during normalization", () => {
    const normalize = (recipe: Record<string, unknown>) =>
      normalizeFingerprintParameters("named-region-state", { ...PARAMETERS, ...recipe });
    for (const baseline_region of [{}, { territory: "no-mans-land", bogus: true }, { territory: "void" }]) {
      expect(() => normalize({ baseline_region })).toThrow(/canonical named-region contract/u);
    }
    for (const phase_extensions of [
      [],
      [{ bogus: true }],
      [{ ...CUSTOM_PHASE, bogus: true }],
      [{ ...CUSTOM_PHASE, condition: { type: "controls", parameters: { proportion: { comparison: "gte", fraction: -0.1 } } } }],
      [{ ...CUSTOM_PHASE, condition: { type: "controls", parameters: { proportion: { comparison: "gte", fraction: 1.1 } } } }],
      [{ ...CUSTOM_PHASE, trigger: { event: "lunchtime" } }],
      [{ ...CUSTOM_PHASE, duration: "eventually" }],
    ]) {
      expect(() => normalize({ phase_extensions })).toThrow();
    }
  });

  it.each([
    ["region id", { region_id: "" }],
    ["owner faction", { owner_faction: "" }],
    ["beneficiary faction", { beneficiary_faction: "" }],
    ["qualifying keyword", { qualifies_by_keyword: "" }],
    ["whitespace qualifying keyword", { qualifies_by_keyword: "   " }],
  ])("rejects a blank %s at the family boundary", (_label, override) => {
    expect(() => normalizeFingerprintParameters("named-region-state", { ...PARAMETERS, ...override })).toThrow();
  });

  it("rejects malformed entity ids without applying entity-id syntax to a keyword", () => {
    expect(() => normalizeFingerprintParameters("named-region-state", { ...PARAMETERS, owner_faction: "Not A Faction" }))
      .toThrow(/kebab-case entity id/u);
    expect(normalizeFingerprintParameters("named-region-state", { ...PARAMETERS, qualifies_by_keyword: "PURIFIER SQUAD" }))
      .toMatchObject({ qualifies_by_keyword: "PURIFIER SQUAD" });
  });

  it("refuses an empty faction and a blank qualifying keyword", () => {
    const blank = { ...PARAMETERS, owner_faction: "", beneficiary_faction: "", qualifies_by_keyword: "   " };
    expect(() => normalizeFingerprintParameters("named-region-state", blank)).toThrow();
  });

  it("types region and faction ids as entity ids and the baseline region as a region-ref", () => {
    const properties = reviewedFamily("named-region-state").parameterSchema.properties as Record<string, unknown>;
    expect(properties.baseline_region).toEqual({
      "$ref": "https://40kdc.dev/schemas/defs/common.schema.json#/$defs/region-ref",
      "x-optional": true,
    });
    expect(properties.region_id).toMatchObject({ type: "string", pattern: expect.any(String) });
    expect(properties.owner_faction).toMatchObject({ type: "string", pattern: expect.any(String) });
  });

  it("refuses a named-region-state leaf that shares an ability with any other leaf", () => {
    const result = compileLeaves([
      leaf({
        region_id: "example-region", owner_faction: "example-faction", behavior: "passive", membership_scope: "model",
        beneficiary_operator: "and", beneficiary_keywords: ["X"],
        default_branch: { kind: "reroll", roll: "hit", subset: "ones", optional: false },
        qualified_branch: { kind: "reroll", roll: "hit", subset: "any", optional: false },
      }),
      { role: "EFFECT", family_id: "fights-first", family_version: currentFamilyVersion("fights-first"), parameters: { subject: "this-model" }, start_byte: 10 },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("named-region-producer", () => {
  const producerLeaf = (parameters: Record<string, unknown>): CompileLeaf => ({
    role: "EFFECT", family_id: "named-region-producer", family_version: currentFamilyVersion("named-region-producer"),
    parameters: normalizeFingerprintParameters("named-region-producer", parameters), start_byte: 0,
  });

  it("declares the region alone: a schema-valid named-region-state with a producer and no consumer", () => {
    const result = compileLeaves([producerLeaf({ region_id: "custom-region", owner_faction: "custom-faction" })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const effect = result.mechanics.effect as unknown as NamedRegionStateEffect;
    expect(effect.type).toBe("named-region-state");
    expect(effect.modifier).not.toHaveProperty("consumer");
    expect(effect.modifier).not.toHaveProperty("branch_precedence");
    expect(effect.modifier.producer).toMatchObject({
      region_ref: { region_id: "custom-region", owner_faction: "custom-faction" }, mode: "complete", parent_ref: null,
      baseline: [{ region: { territory: "your-deployment-zone" }, duration: "permanent" }], additive_extensions: [],
    });
    expect(effect.modifier.producer.phase_extensions.map((item) => item.region)).toEqual([{ territory: "no-mans-land" }, { territory: "enemy-deployment-zone" }]);
    // Each extension counts the objective markers within the zone it extends into, not a whole territory.
    expect(effect.modifier.producer.phase_extensions.map((item) => (item.condition as { parameters: { objective: unknown } }).parameters.objective))
      .toEqual([{ territory: "no-mans-land" }, { territory: "enemy-deployment-zone" }]);
    expect(effectOk(effect)).toBe(true);
  });

  it("keeps a consumer and its branch precedence together in the schema", () => {
    const result = compileLeaves([producerLeaf({ region_id: "custom-region", owner_faction: "custom-faction" })]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = structuredClone(result.mechanics.effect) as { modifier: Record<string, unknown> };
    effect.modifier.branch_precedence = "qualified-replaces-default";
    expect(effectOk(effect)).toBe(false);
  });

  it("refuses a region id that is not an entity id", () => {
    expect(() => normalizeFingerprintParameters("named-region-producer", { region_id: "Shadow", owner_faction: "custom-faction" })).toThrow();
  });

  it("refuses ids and keywords that are not strings instead of reading their string form", () => {
    expect(() => normalizeFingerprintParameters("named-region-state", { ...PARAMETERS, region_id: 123 })).toThrow(/region_id must be a kebab-case entity id/u);
    expect(() => normalizeFingerprintParameters("named-region-state", { ...PARAMETERS, region_id: ["custom-region"] })).toThrow(/region_id must be a kebab-case entity id/u);
    expect(() => normalizeFingerprintParameters("named-region-state", { ...PARAMETERS, owner_faction: ["custom-faction"] })).toThrow(/owner_faction must be a kebab-case entity id/u);
    expect(() => normalizeFingerprintParameters("named-region-state", { ...PARAMETERS, beneficiary_faction: ["custom-faction"] })).toThrow(/beneficiary_faction must be a kebab-case entity id/u);
    expect(() => normalizeFingerprintParameters("named-region-state", { ...PARAMETERS, qualifies_by_keyword: 7 })).toThrow(/qualifies_by_keyword must be a nonblank keyword/u);
    expect(() => normalizeFingerprintParameters("named-region-state", { ...PARAMETERS, default_branch: { ...PARAMETERS.default_branch, optional: "yes" } }))
      .toThrow(/default_branch\.optional must be true or false/u);
    expect(() => normalizeFingerprintParameters("named-region-state", { ...PARAMETERS, qualified_branch: { ...PARAMETERS.qualified_branch, optional: 0 } }))
      .toThrow(/qualified_branch\.optional must be true or false/u);
  });
});
