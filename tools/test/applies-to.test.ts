import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { keywordMatchesPredicate, unitMatchesAppliesTo, type AppliesToFilter } from "../src/scope.js";
import { Dataset } from "../src/data/dataset.js";
import { abilities, units } from "../src/data/index.js";

const CONFORMANCE = join(dirname(fileURLToPath(import.meta.url)), "../../conformance/applies-to");

interface AppliesToCase {
  caseId: string;
  applies_to: AppliesToFilter | null;
  units: { id: string; keywords?: string[]; faction_keywords?: string[] }[];
  expected: { matchedIds: string[] };
}

describe("applies-to conformance golden", () => {
  const cases = JSON.parse(readFileSync(join(CONFORMANCE, "cases.json"), "utf-8")) as AppliesToCase[];

  it("ships cases", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    it(`matches ${c.caseId}`, () => {
      const matched = c.units
        .filter((u) => unitMatchesAppliesTo(c.applies_to ?? undefined, u))
        .map((u) => u.id);
      expect(matched).toEqual(c.expected.matchedIds);
    });
  }
});

describe("canonical keyword predicates", () => {
  const unit = { keywords: ["Character", "Infantry"], faction_keywords: ["T’au Empire"] };

  it("distinguishes absent scope from an unrestricted explicit predicate", () => {
    expect(unitMatchesAppliesTo(null, unit)).toBe(false);
    expect(unitMatchesAppliesTo(undefined, unit)).toBe(false);
    expect(unitMatchesAppliesTo({}, unit)).toBe(true);
  });

  it("combines all four clauses across normalised unit and faction keywords", () => {
    const filter = {
      all_of: ["T'AU EMPIRE"],
      any_of: ["INFANTRY", "VEHICLE"],
      none_of: ["MONSTER"],
      not_all_of: ["CHARACTER", "FLY"],
    };
    expect(unitMatchesAppliesTo(filter, unit)).toBe(true);
    expect(unitMatchesAppliesTo({ ...filter, all_of: ["FLY"] }, unit)).toBe(false);
    expect(unitMatchesAppliesTo({ ...filter, any_of: ["VEHICLE"] }, unit)).toBe(false);
    expect(unitMatchesAppliesTo({ ...filter, none_of: ["CHARACTER"] }, unit)).toBe(false);
    expect(unitMatchesAppliesTo({ ...filter, not_all_of: ["CHARACTER", "INFANTRY"] }, unit)).toBe(false);
  });

  it("uses ordinary empty-set predicate semantics", () => {
    expect(keywordMatchesPredicate({ all_of: [], none_of: [] }, [])).toBe(true);
    expect(keywordMatchesPredicate({ any_of: [] }, [])).toBe(false);
    expect(keywordMatchesPredicate({ not_all_of: [] }, [])).toBe(false);
  });
});

describe("AbilityView applies_to (integration)", () => {
  const ds = Dataset.embedded();

  it("exposes brazen-fury's curated filter", () => {
    expect(ds.abilities.getAny("brazen-fury-world-eaters")?.appliesTo).toEqual({ all_of: ["POSSESSED"] });
  });

  it("resolves brazen-fury to exactly the World Eaters Possessed units", () => {
    const rule = abilities.get("brazen-fury-world-eaters")!;
    const worldEaters = units.all.filter((u) => u.raw.faction_id === "world-eaters");
    const affected = rule
      .affectedUnits(worldEaters)
      .map((u) => u.id)
      .sort();
    expect(affected).toEqual(["eightbound", "exalted-eightbound", "slaughterbound"]);
  });

  it("army-wide rules with no filter highlight nothing", () => {
    const rule = abilities.get("relentless-rage-world-eaters")!;
    expect(rule.appliesTo).toBeUndefined();
    expect(rule.affectedUnits(units.all)).toEqual([]);
  });
});
