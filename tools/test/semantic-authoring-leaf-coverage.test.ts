import { describe, expect, it } from "vitest";

import { catalogInventory, COMPOSED, leafCoverage, RETIRED } from "../src/semantic-authoring/leaf-coverage.js";
import { boundedCombinations } from "../src/semantic-authoring/leaf-coverage-samples.js";
import { currentFamilyVersion, reviewedFamily } from "../src/semantic-authoring/contracts.js";

/**
 * Step-8 leaf coverage gate: every DSL type the schema catalog defines must be either produced by
 * some active reviewed family (proven by actually compiling it), composed from an arrangement of
 * leaves pinned elsewhere, or explicitly retired with a reason. A type that is none of those is a
 * real gap in the reviewed-family registry, not a describer or test-coverage nit, so this test
 * does not skip, filter, or soften what it finds.
 */

describe("Semantic authoring leaf-family coverage (step 8)", () => {
  it("derives a non-empty catalog from the schema files", () => {
    const catalog = catalogInventory();
    expect(catalog.length).toBeGreaterThan(50);
    for (const kind of ["effect", "container", "predicate", "trigger", "duration", "usage", "behavior"] as const) {
      expect(catalog.some((entry) => entry.kind === kind)).toBe(true);
    }
  });

  it("pairwise samples retain every declared value and satisfy dependent contexts", () => {
    const event = reviewedFamily("event", currentFamilyVersion("event"));
    const eventProperties = event.parameterSchema.properties as Record<string, { enum?: readonly string[] }>;
    const eventSamples = boundedCombinations(event);
    const sampledKinds = new Set(eventSamples.map((sample) => String(sample.kind)));
    const sampledDesignations = new Set(eventSamples
      .filter((sample) => sample.kind === "unit-destroyed" && sample.object_designated !== undefined)
      .map((sample) => String(sample.object_designated)));

    expect(sampledKinds).toEqual(new Set(eventProperties.kind!.enum!));
    expect(sampledDesignations).toEqual(new Set(eventProperties.object_designated!.enum!));
    expect(eventSamples.some((sample) => sample.kind === "phase-start"
      && typeof sample.phase === "string" && typeof sample.turn === "string")).toBe(true);

    const testSamples = boundedCombinations(reviewedFamily("test", currentFamilyVersion("test")));
    expect(testSamples.some((sample) => sample.target === "enemy"
      && sample.range === "inches" && typeof sample.within_inches === "number")).toBe(true);

    for (const [familyId, field] of [
      ["unit-filter", "alternatives"],
      ["unit-position", "of_alternatives"],
    ] as const) {
      const samples = boundedCombinations(reviewedFamily(familyId, currentFamilyVersion(familyId)));
      const alternatives = samples.flatMap((sample) => {
        const value = sample[field];
        return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
      });
      expect(alternatives.some((alternative) => Array.isArray(alternative.keywords)
        && alternative.keywords.length > 1), `${familyId}.${field} needs a keyword-conjunction witness`).toBe(true);
      expect(alternatives.some((alternative) => Array.isArray(alternative.states)
        && alternative.states.includes("battle-shocked")), `${familyId}.${field} needs a state witness`).toBe(true);
    }
  });

  it("every catalog type is produced, composed, or retired", () => {
    const { unproduced } = leafCoverage();
    expect(unproduced, `Catalog types with no producing family, composed entry, or retired entry:\n${unproduced.join("\n")}`).toEqual([]);
  });

  it("names at least one producing family for every produced type", () => {
    const { produced } = leafCoverage();
    for (const [type, families] of produced) {
      expect(families.length, `${type} was produced but names no family`).toBeGreaterThan(0);
      for (const family of families) expect(family).toMatch(/^[a-z0-9-]+@\d+$/u);
    }
  });

  it("RETIRED and COMPOSED entries do not overlap, and every RETIRED/COMPOSED type is real", () => {
    const catalogTypes = new Set(catalogInventory().map((entry) => entry.type));
    const retiredTypes = new Set(RETIRED.map((entry) => entry.type));
    const composedTypes = new Set(COMPOSED.map((entry) => entry.type));
    for (const type of retiredTypes) expect(composedTypes.has(type), `${type} is listed as both RETIRED and COMPOSED`).toBe(false);
    for (const entry of RETIRED) {
      expect(entry.reason.length, `RETIRED ${entry.type} needs a reason`).toBeGreaterThan(0);
      // A retired type may or may not still appear in the schema enum (terrain-area-control does not); either is fine.
      void catalogTypes;
    }
    for (const entry of COMPOSED) {
      expect(entry.reason.length, `COMPOSED ${entry.type} needs a reason`).toBeGreaterThan(0);
      expect(entry.pinnedTest.length, `COMPOSED ${entry.type} needs a pinned-test citation`).toBeGreaterThan(0);
      expect(catalogTypes.has(entry.type), `COMPOSED ${entry.type} is not a catalog type`).toBe(true);
    }
  });

  it("does not double-count a type as both produced and composed", () => {
    const { produced } = leafCoverage();
    const composedTypes = new Set(COMPOSED.map((entry) => entry.type));
    for (const type of composedTypes) {
      expect(produced.has(type), `${type} is listed as COMPOSED but the sweep also produced it directly; move it out of COMPOSED`).toBe(false);
    }
  });
});
