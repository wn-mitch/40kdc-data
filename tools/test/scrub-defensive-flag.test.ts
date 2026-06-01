import { describe, expect, it } from "vitest";
import {
  STALE_FLAG,
  producesDefensiveBuff,
  scrubDefensiveFlags,
} from "../src/scrub-defensive-flag.js";

describe("scrubDefensiveFlags", () => {
  it("clears the flag from an invulnerable-save entry the engine can read", () => {
    const abilities = [
      {
        ability_id: "test-invuln",
        ability_type: "unit",
        effect: {
          type: "invulnerable-save",
          target: "self",
          modifier: { invuln_sv: 4 },
        },
        community_notes: STALE_FLAG,
      },
    ];
    expect(scrubDefensiveFlags(abilities)).toBe(1);
    expect(abilities[0].community_notes).toBeUndefined();
  });

  it("leaves the flag on a damage-reduction 'half' entry (deliberately unsupported)", () => {
    const abilities = [
      {
        ability_id: "test-half",
        ability_type: "unit",
        effect: {
          type: "damage-reduction",
          target: "self",
          modifier: { reduction: "half" },
        },
        community_notes: STALE_FLAG,
      },
    ];
    expect(scrubDefensiveFlags(abilities)).toBe(0);
    expect(abilities[0].community_notes).toBe(STALE_FLAG);
  });

  it("leaves the flag on an ability-grant entry (genuinely outside the buff layer)", () => {
    // Grants are not stat mods — the buff layer doesn't model them, and they
    // legitimately remain in the residue worklist for downstream consumers.
    const abilities = [
      {
        ability_id: "test-grant",
        ability_type: "unit",
        effect: {
          type: "ability-grant",
          target: "unit",
          modifier: { grant_type: "label", value: "stealth" },
        },
        community_notes: STALE_FLAG,
      },
    ];
    expect(scrubDefensiveFlags(abilities)).toBe(0);
    expect(abilities[0].community_notes).toBe(STALE_FLAG);
  });

  it("respects non-matching community_notes — only the exact sentinel scrubs", () => {
    const abilities = [
      {
        ability_id: "test-other",
        ability_type: "unit",
        effect: {
          type: "invulnerable-save",
          target: "self",
          modifier: { invuln_sv: 4 },
        },
        community_notes: "some authored note about this ability",
      },
    ];
    expect(scrubDefensiveFlags(abilities)).toBe(0);
    expect(abilities[0].community_notes).toBe("some authored note about this ability");
  });

  it("is idempotent: re-running on a cleared entry is a no-op", () => {
    const abilities = [
      {
        ability_id: "test-idem",
        ability_type: "unit",
        effect: {
          type: "damage-reduction",
          target: "unit",
          modifier: { reduction: 1 },
        },
        community_notes: STALE_FLAG,
      },
    ];
    expect(scrubDefensiveFlags(abilities)).toBe(1);
    expect(scrubDefensiveFlags(abilities)).toBe(0);
    expect(abilities[0].community_notes).toBeUndefined();
  });

  it("clears the flag when the readable effect is wrapped in a conditional", () => {
    const abilities = [
      {
        ability_id: "test-cond",
        ability_type: "unit",
        effect: {
          type: "conditional",
          condition: { type: "phase-is", parameters: { phase: "fight" } },
          effect: {
            type: "damage-reduction",
            target: "unit",
            modifier: { reduction: 1 },
          },
        },
        community_notes: STALE_FLAG,
      },
    ];
    expect(scrubDefensiveFlags(abilities)).toBe(1);
  });

  it("leaves the flag when effect is absent (defensive nothing-to-translate)", () => {
    const abilities = [
      {
        ability_id: "test-no-effect",
        ability_type: "unit",
        community_notes: STALE_FLAG,
      },
    ];
    expect(scrubDefensiveFlags(abilities)).toBe(0);
    expect(abilities[0].community_notes).toBe(STALE_FLAG);
  });
});

describe("producesDefensiveBuff", () => {
  it("returns true for an FNP-vs-mortal target buff", () => {
    expect(
      producesDefensiveBuff({
        ability_id: "x",
        ability_type: "unit",
        effect: {
          type: "feel-no-pain",
          target: "unit",
          modifier: { threshold: 5, scope: "mortal" },
        },
      }),
    ).toBe(true);
  });

  it("returns false for an attacker-side stat-modifier (out of scope here)", () => {
    expect(
      producesDefensiveBuff({
        ability_id: "x",
        ability_type: "unit",
        effect: {
          type: "stat-modifier",
          target: "self",
          modifier: { stat: "A", operation: "add", value: 1 },
        },
      }),
    ).toBe(false);
  });
});
