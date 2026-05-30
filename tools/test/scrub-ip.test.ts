import { describe, expect, it } from "vitest";
import { isLeak, scrubNote, scrubAbilities, SCRUB_CITATION } from "../src/scrub-ip.js";

describe("scrub-ip", () => {
  it("detects the GW-text dump marker", () => {
    expect(isLeak("auto-generated stub — needs manual authoring. Original: While this model...")).toBe(true);
  });

  it("detects the GW bullet glyph", () => {
    expect(isLeak("■ Eligible to perform an Action...")).toBe(true);
  });

  it("leaves genuinely-authored notes untouched", () => {
    expect(isLeak("defensive ability (skipped for damage calc)")).toBe(false);
    expect(scrubNote("Models 1 Miracle Die per activation as a guaranteed crit hit")).toBe(
      "Models 1 Miracle Die per activation as a guaranteed crit hit",
    );
    expect(isLeak(undefined)).toBe(false);
  });

  it("rewrites a leaking note to the citation", () => {
    expect(scrubNote("foo. Original: bar")).toBe(SCRUB_CITATION);
  });

  it("scrubs only the leaking entries in an array and reports the count", () => {
    const abilities = [
      { ability_id: "a", community_notes: "x. Original: GW text" },
      { ability_id: "b", community_notes: "defensive ability (skipped for damage calc)" },
      { ability_id: "c" },
    ];
    const changed = scrubAbilities(abilities);
    expect(changed).toBe(1);
    expect(abilities[0].community_notes).toBe(SCRUB_CITATION);
    expect(abilities[1].community_notes).toBe("defensive ability (skipped for damage calc)");
    expect(abilities[2].community_notes).toBeUndefined();
  });

  it("is idempotent — the citation itself is not a leak", () => {
    expect(isLeak(SCRUB_CITATION)).toBe(false);
  });
});
