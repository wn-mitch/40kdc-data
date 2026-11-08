import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import {
  canonicalDslCases,
  isCanonicalDslCase,
  refreshResolverDslCases,
  withCanonicalDslCases,
  type ResolverDslCase,
} from "../src/gen-conformance-resolver-dsl.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../conformance/abilities-resolver");
const ds = Dataset.embedded();

// The seeded refresh and the canonical generator share these files; each must leave the other's
// rows alone, or the committed goldens depend on which generator `gen-conformance.ts` runs first.
describe.each([
  ["from-dsl.json", "attacker"],
  ["defensive-from-dsl.json", "target"],
] as const)("abilities-resolver/%s generators", (filename, perspective) => {
  const committed = (JSON.parse(readFileSync(join(dir, filename), "utf8")) as { cases: ResolverDslCase[] }).cases;
  const canonical = canonicalDslCases();
  const refresh = (cases: unknown[]) => refreshResolverDslCases(cases as ResolverDslCase[], ds);
  const append = (cases: unknown[]) => withCanonicalDslCases(cases as ResolverDslCase[], perspective, canonical);

  it("produce the same corpus in either order", () => {
    expect(append(refresh(committed))).toEqual(refresh(append(committed)));
  });

  it("reproduce the committed corpus in either order", () => {
    expect(refresh(append(committed))).toEqual(committed);
    expect(append(refresh(committed))).toEqual(committed);
  });

  it("refresh leaves every canonical row as its builder wrote it", () => {
    const rows = committed.filter(isCanonicalDslCase);
    expect(rows.length).toBeGreaterThan(0);
    expect(refresh(rows)).toEqual(rows);
  });
});

describe("isCanonicalDslCase", () => {
  it("owns only the canonical generator's prefixes, not every canonical/ id", () => {
    expect(isCanonicalDslCase({ caseId: "canonical/scenario/guided-true" })).toBe(true);
    // A hand-seeded row under canonical/ that the canonical generator does not write.
    expect(isCanonicalDslCase({ caseId: "canonical/save-characteristic/example" })).toBe(false);
    expect(isCanonicalDslCase({})).toBe(false);
  });
});
